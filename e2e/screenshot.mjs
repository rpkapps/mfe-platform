// Captures the running shell with the DevTools panel open: node e2e/screenshot.mjs [out.png]
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const chromiumPath = () => process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
const out = process.argv[2] ?? 'shell.png'
const base = process.env.SHELL_URL ?? 'http://localhost:4000'
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`${base}/orders`)
await page.evaluate(() => localStorage.setItem('platform.devtools', 'true'))
await page.goto(`${base}/orders/1003`)
await page.getByTestId('shell.sign-in.orders-manager').click()
await page.getByTestId('orders.details').waitFor()
if (!(await page.getByTestId('devtools.panel').isVisible())) await page.getByTestId('devtools.toggle').click()
await page.getByTestId('devtools.tab.mfes').click()
await page.waitForTimeout(400)
await page.screenshot({ path: out })
await browser.close()
