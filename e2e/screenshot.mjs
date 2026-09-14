// Captures the running shell: node e2e/screenshot.mjs [out.png] [palette|devtools|customers]
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const chromiumPath = () => process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const out = process.argv[2] ?? 'shell.png'
const mode = process.argv[3] ?? 'palette'
const base = process.env.SHELL_URL ?? 'http://localhost:4000'
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`${base}/orders`)
if (mode === 'devtools') await page.evaluate(() => localStorage.setItem('platform.devtools', 'true'))
await page.goto(mode === 'customers' ? `${base}/customers/acme` : `${base}/orders/1003`)
await page.getByTestId('shell.sign-in.orders-manager').click()
await page.getByTestId(mode === 'customers' ? 'customers.details' : 'orders.details').waitFor()
await page.getByTestId('customer-card').waitFor({ timeout: 15_000 })
if (mode === 'palette') {
  await page.keyboard.press('Control+k')
  await page.getByTestId('shell.palette.input').waitFor()
}
if (mode === 'devtools') {
  if (!(await page.getByTestId('devtools.panel').isVisible())) await page.getByTestId('devtools.toggle').click()
  await page.getByTestId('devtools.tab.shared').click()
}
await page.waitForTimeout(500)
await page.screenshot({ path: out })
await browser.close()
