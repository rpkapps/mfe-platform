// Captures the running shell for a quick look: node e2e/screenshot.mjs [out.png]
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'shell.png'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(`${process.env.SHELL_URL ?? 'http://localhost:4000'}/orders/1003`)
await page.getByTestId('shell.sign-in.orders-manager').click()
await page.getByTestId('orders.details').waitFor()
await page.getByTestId('shell.page-actions').getByRole('button', { name: 'Approve order' }).click()
await page.getByTestId('shell.confirm.ok').waitFor()
await page.waitForTimeout(400)
await page.screenshot({ path: out })
await browser.close()
