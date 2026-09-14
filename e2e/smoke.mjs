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

// The sample API keeps state in the server process; start every run from the same data.
await fetch(`${base}/api/__reset`, { method: 'POST' }).catch(() => {})

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
await step('a cross-app link hands off to the Customers app, and back returns', async () => {
  await page.getByRole('link', { name: 'open in Customers', exact: true }).click()
  await page.getByTestId('customers.details').waitFor({ timeout: 15_000 })
  if (!page.url().includes('/customers/initech')) throw new Error(`url is ${page.url()}`)
  await page.goBack()
  await page.getByTestId('orders.details').waitFor()
})
await step('a URL nobody owns shows the shell 404', async () => {
  await page.goto(`${base}/nowhere`)
  await page.getByTestId('shell.not-found').waitFor()
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
await step('a widget from another team renders inside Orders and its events reach the app', async () => {
  await page.goto(`${base}/orders/1001`)
  await page.getByTestId('orders.details').waitFor()
  await page.getByTestId('customer-card').waitFor({ timeout: 15_000 })
  const scope = await page.getByTestId('customer-card').evaluate(el => el.closest('[data-mfe-scope]')?.getAttribute('data-mfe-scope'))
  if (!scope?.startsWith('customer-card@')) throw new Error(`widget scope is ${scope}`)
  await page.getByTestId('customer-card.select').click()
  await page.getByText('Widget selected customer acme').waitFor()
})
await step('the Customers app runs on React 18 next to the React 19 shell, with the React 19 widget inside it', async () => {
  await page.goto(`${base}/customers`)
  await page.getByTestId('customers.list').waitFor({ timeout: 15_000 })
  const version = await page.getByTestId('customers.root').getAttribute('data-react-version')
  if (!version?.startsWith('18.')) throw new Error(`customers React version is ${version}`)
  const scopes = await page.evaluate(() => Object.keys(JSON.parse(document.querySelector('script[type=importmap]').textContent).scopes))
  if (!scopes.some(s => s.includes('/customers/'))) throw new Error(`no import-map scope for customers: ${scopes.join(', ')}`)
  await page.getByRole('link', { name: 'Acme Corp' }).click()
  await page.getByTestId('customers.details').waitFor()
  await page.getByTestId('customer-card').waitFor({ timeout: 15_000 })
  await page.getByTestId('customer-card.select').click()
  await page.getByText('Widget selected acme').waitFor()
  await page.getByTestId('customers.compact').check()
  await page.locator('[data-testid="customer-card"][data-compact="true"]').waitFor()
  await page.getByTestId('customer-card.more').click()
  await page.locator('.mfe-overlay-root[data-mfe-scope^="customer-card@"] [role="dialog"]').waitFor()
  await page.keyboard.press('Escape')
  await page.getByTestId('customers.favorite').click()
  await page.getByText('Acme Corp ★').waitFor()
})
await step('Tailwind and custom classes do not collide across MFEs', async () => {
  const bg = async selector => page.locator(selector).first().evaluate(el => getComputedStyle(el).backgroundColor)
  const radius = async selector => page.locator(selector).first().evaluate(el => getComputedStyle(el).borderRadius)
  const customersBadge = await bg('[data-testid="customers.badge"]').catch(() => undefined)
  await page.goto(`${base}/customers`)
  await page.getByTestId('customers.badge').waitFor()
  const inCustomers = { bg: await bg('[data-testid="customers.badge"]'), radius: await radius('[data-testid="customers.badge"]') }
  await page.goto(`${base}/customers/acme`)
  await page.getByTestId('customer-card.badge').waitFor({ timeout: 15_000 })
  const widgetInCustomers = { bg: await bg('[data-testid="customer-card.badge"]'), radius: await radius('[data-testid="customer-card.badge"]') }
  await page.goto(`${base}/orders/1001`)
  await page.getByTestId('orders.badge').waitFor()
  await page.getByTestId('customer-card.badge').waitFor({ timeout: 15_000 })
  const inOrders = { bg: await bg('[data-testid="orders.badge"]'), radius: await radius('[data-testid="orders.badge"]') }
  const widgetInOrders = { bg: await bg('[data-testid="customer-card.badge"]'), radius: await radius('[data-testid="customer-card.badge"]') }
  const all = [inCustomers.bg, widgetInCustomers.bg, inOrders.bg]
  if (new Set(all).size !== 3) throw new Error(`.mfe-badge backgrounds collide: ${all.join(' | ')}`)
  if (widgetInCustomers.bg !== widgetInOrders.bg || widgetInCustomers.radius !== widgetInOrders.radius) throw new Error(`the widget is styled differently per host: ${JSON.stringify({ widgetInCustomers, widgetInOrders })}`)
  if (inCustomers.radius === inOrders.radius) throw new Error(`.mfe-badge radius collides: ${inCustomers.radius}`)
  void customersBadge
})
await step('the command palette opens with Mod+K and runs a navigation action', async () => {
  await page.goto(`${base}/orders`)
  await page.getByTestId('orders.list').waitFor()
  await page.keyboard.press('Control+k')
  await page.getByTestId('shell.palette.input').waitFor()
  await page.getByTestId('shell.palette.input').fill('create')
  await page.getByRole('menuitem', { name: /Create order/ }).click()
  await page.getByTestId('orders.new').waitFor()
  await page.keyboard.press('Control+k')
  await page.getByTestId('shell.palette.input').fill('customers')
  await page.getByRole('menuitem', { name: /Customer directory/ }).click()
  await page.getByTestId('customers.list').waitFor({ timeout: 15_000 })
  // The palette closed on selection; if it did not, two Escapes (clear, then close) get rid of it.
  if (await page.getByTestId('shell.palette.input').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  }
})
await step('a manifest shortcut runs the live action on screen', async () => {
  await page.goto(`${base}/orders/1003`)
  await page.getByTestId('orders.details').waitFor()
  await page.getByTestId('shell.page-actions').getByRole('button', { name: 'Approve order' }).waitFor()
  // Shortcuts bind in an effect after the registration renders; give it a frame, then type into the page.
  await page.waitForTimeout(300)
  await page.locator('h1').first().click()
  await page.keyboard.press('Control+Enter')
  await page.getByTestId('shell.confirm.cancel').waitFor()
  await page.getByTestId('shell.confirm.cancel').click()
})
await step('the app finder lists both apps and switches', async () => {
  await page.getByTestId('shell.switcher').click()
  await page.getByTestId('shell.switcher.customers').waitFor()
  await page.getByTestId('shell.switcher.orders').waitFor()
  await page.getByTestId('shell.switcher.customers').click()
  await page.getByTestId('customers.list').waitFor({ timeout: 15_000 })
})
await step('a viewer without the approver group sees a disabled approve action', async () => {
  await page.getByRole('button', { name: /^Account:/ }).click()
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
  const scoped = await page.getByTestId('devtools.shared.customers:react').textContent()
  if (!scoped.includes('18.')) throw new Error(`scoped react row for customers: ${scoped}`)
  await page.getByTestId('devtools.tab.mfes').click()
})
await step('DevTools: an added MFE survives a tab switch and can be removed', async () => {
  await page.getByLabel('MFE id').fill('demo')
  await page.getByLabel('Manifest URL').fill('http://localhost:4299/manifest.json')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByTestId('devtools.mfe.demo').waitFor()
  await page.getByTestId('devtools.tab.telemetry').click()
  await page.getByTestId('devtools.tab.mfes').click()
  await page.getByTestId('devtools.mfe.demo').waitFor()
  await page.getByTestId('devtools.override.remove.demo').click()
  await page.getByTestId('devtools.mfe.demo').waitFor({ state: 'detached' })
  if (await page.getByTestId('devtools.overrides.apply').isEnabled()) throw new Error('draft still dirty after removing the only change')
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
