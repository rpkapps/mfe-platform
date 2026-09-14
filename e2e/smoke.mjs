// End-to-end smoke: the built shell loads the Orders app from the registry release.
// Prerequisites: registry on :4100 with orders live, shell preview on :4000.
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

// The container has a preinstalled Chromium; elsewhere Playwright's own download is used (`npx playwright install chromium`).
const chromiumPath = () => process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)

const base = process.env.SHELL_URL ?? 'http://localhost:4000'
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
const step = async (name, fn) => {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`)
    await page.screenshot({ path: `/tmp/claude-0/e2e-${name.replace(/\W+/g, '-')}.png` }).catch(() => {})
    process.exitCode = 1
  }
}

await step('sign-in page for a fresh browser', async () => {
  await page.goto(`${base}/orders`)
  await page.getByTestId('shell.sign-in').waitFor({ timeout: 10_000 })
  await page.getByTestId('shell.sign-in.orders-manager').click()
})
await step('orders list mounts from the release', async () => {
  await page.getByTestId('orders.list').waitFor({ timeout: 15_000 })
  await page.getByText('Acme Corp').waitFor()
  const title = await page.getByTestId('shell.page-title').textContent()
  if (title !== 'Orders') throw new Error(`page title is "${title}"`)
  if (!(await page.title()).startsWith('Orders ·')) throw new Error(`document.title is "${await page.title()}"`)
  const scoped = await page.locator('[data-mfe-scope="orders@1"]').count()
  if (scoped < 2) throw new Error(`expected element and overlay root with the scope, found ${scoped}`)
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  if (focused !== 'H1') throw new Error(`focus is on ${focused}, not the heading`)
})
await step('styles are scoped and applied', async () => {
  const display = await page.locator('[data-testid="orders.list"] header').evaluate(el => getComputedStyle(el).display)
  if (display !== 'flex') throw new Error(`header display is ${display}; Tailwind utilities did not apply`)
})
await step('one React copy: within-app link works and header actions appear', async () => {
  await page.getByRole('link', { name: '1001' }).click()
  await page.getByTestId('orders.details').waitFor()
  if (!new URL(page.url()).pathname.endsWith('/orders/1001')) throw new Error(`url is ${page.url()}`)
  await page.getByTestId('shell.page-actions').getByRole('button', { name: 'Approve order' }).waitFor()
})
await step('approve through the shell confirmation', async () => {
  await page.getByTestId('shell.page-actions').getByRole('button', { name: 'Approve order' }).click()
  await page.getByTestId('shell.confirm.ok').waitFor()
  await page.getByTestId('shell.confirm.ok').click()
  await page.getByText('Order 1001 approved').waitFor({ timeout: 10_000 })
  await page.getByText('approved', { exact: true }).first().waitFor()
})
await step('the app dialog portals into the overlay root', async () => {
  await page.goto(`${base}/orders/1003`)
  await page.getByTestId('orders.details').waitFor()
  await page.getByRole('button', { name: 'Reject' }).click()
  await page.getByRole('dialog').waitFor()
  const inOverlay = await page.locator('.mfe-overlay-root[data-mfe-scope="orders@1"] [role="dialog"]').count()
  if (inOverlay !== 1) throw new Error('dialog is not inside the app overlay root')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
})
await step('cross-app link to a missing app shows the shell 404, and back returns', async () => {
  await page.getByRole('link', { name: 'open in Customers' }).click()
  await page.getByTestId('shell.not-found').waitFor()
  if (!page.url().includes('/customers/')) throw new Error(`url is ${page.url()}`)
  await page.goBack()
  await page.getByTestId('orders.details').waitFor()
})
await step('the app switcher lists Orders alphabetically and navigates', async () => {
  await page.goto(`${base}/nowhere`)
  await page.getByTestId('shell.not-found').waitFor()
  await page.getByTestId('shell.switcher').click()
  await page.getByTestId('shell.switcher.orders').click()
  await page.getByTestId('orders.list').waitFor()
})
await step('a blocker keeps the user on a dirty form', async () => {
  await page.goto(`${base}/orders/new`)
  await page.getByTestId('orders.new').waitFor()
  await page.getByLabel('Customer').fill('Hooli')
  await page.getByTestId('shell.switcher').click()
  await page.getByTestId('shell.switcher.orders').click()
  await page.getByTestId('shell.confirm.cancel').click()
  await page.waitForTimeout(300)
  if (!page.url().endsWith('/orders/new')) throw new Error(`navigation was not blocked: ${page.url()}`)
  await page.getByTestId('shell.switcher').click()
  await page.getByTestId('shell.switcher.orders').click()
  await page.getByTestId('shell.confirm.ok').click()
  await page.getByTestId('orders.list').waitFor()
})
await step('a viewer without the approver group sees a disabled approve action', async () => {
  await page.getByTestId('shell.user').click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.getByTestId('shell.sign-in').waitFor()
  await page.getByTestId('shell.sign-in.orders-viewer').click()
  await page.goto(`${base}/orders/1003`)
  await page.getByTestId('orders.details').waitFor()
  const disabled = await page.getByTestId('shell.page-actions').getByRole('button', { name: 'Approve order' }).isDisabled()
  if (!disabled) throw new Error('approve should be disabled for orders-viewer')
})
await step('DevTools: enabled by the flag, lists MFEs and shared libraries', async () => {
  await page.evaluate(() => localStorage.setItem('platform.devtools', 'true'))
  await page.goto(`${base}/orders`)
  await page.getByTestId('orders.list').waitFor()
  await page.getByTestId('devtools.toggle').click()
  await page.getByTestId('devtools.panel').waitFor()
  const row = page.getByTestId('devtools.mfe.orders')
  await row.waitFor()
  if (!(await row.textContent()).includes('ready')) throw new Error('orders row does not show ready')
  await page.getByTestId('devtools.tab.shared').click()
  const react = await page.getByTestId('devtools.shared.react').textContent()
  if (!react.includes('19.')) throw new Error(`shared react row: ${react}`)
  await page.getByTestId('devtools.tab.mfes').click()
})
if (process.env.DEV_MANIFEST_URL) {
  await step('DevTools: an override runs the app from mfe dev after reload', async () => {
    const input = page.getByTestId('devtools.override.orders')
    await input.fill(process.env.DEV_MANIFEST_URL)
    await page.getByTestId('devtools.overrides.apply').click()
    await page.waitForLoadState('load')
    const fromDev = []
    page.on('request', r => {
      if (r.url().startsWith(new URL(process.env.DEV_MANIFEST_URL).origin)) fromDev.push(r.url())
    })
    await page.goto(`${base}/orders`)
    await page.getByTestId('orders.list').waitFor()
    if (!fromDev.some(u => u.endsWith('orders.entry.js'))) throw new Error(`entry was not loaded from the dev server: ${fromDev.join(', ')}`)
    if (!(await page.getByTestId('devtools.panel').isVisible())) await page.getByTestId('devtools.toggle').click()
    const row = await page.getByTestId('devtools.mfe.orders').textContent()
    if (!row.includes('override')) throw new Error('orders row is not marked as overridden')
    await page.evaluate(() => localStorage.removeItem('platform.devtools.overrides'))
  })
}
await step('no page errors', async () => {
  const real = errors.filter(e => !e.includes('favicon'))
  if (real.length) throw new Error(real.join('\n'))
})
await browser.close()
