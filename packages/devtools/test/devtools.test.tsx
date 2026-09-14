import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createApp } from '@platform/sdk'
import { createTestHost, type TestHost } from '@platform/sdk/testing'
import { PlatformDevtools } from '../src'

let host: TestHost
let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  await host?.dispose()
  localStorage.clear()
})

async function render(ui: React.ReactElement) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(ui))
}

describe('PlatformDevtools', () => {
  it('opens from the toggle, lists MFEs with state, and writes an override for reload', async () => {
    host = createTestHost()
    const app = createApp({ id: 'orders', title: 'Orders', basePath: '/orders', mount: ctx => ((ctx.element.textContent = 'orders'), { unmount() {} }) })
    await host.mount(app)
    document.head.insertAdjacentHTML('beforeend', '<script type="importmap">{"imports":{"react":"/shared/react@19.3.0-abc123.js"},"integrity":{"/shared/react@19.3.0-abc123.js":"sha384-xyz"}}</script>')
    await render(<PlatformDevtools runtime={host.runtime} env={{ PLATFORM_ENVIRONMENT: 'test' }} />)

    expect(document.querySelector('[data-testid="devtools.panel"]')).toBeNull()
    await act(async () => (document.querySelector('[data-testid="devtools.toggle"]') as HTMLButtonElement).click())
    expect(document.querySelector('[data-testid="devtools.panel"]')).not.toBeNull()
    const row = document.querySelector('[data-testid="devtools.mfe.orders"]')!
    expect(row.textContent).toContain('orders')
    expect(row.textContent).toContain('ready')

    const input = row.querySelector('input') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'http://localhost:4200/manifest.json')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const apply = document.querySelector('[data-testid="devtools.overrides.apply"]') as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    const reload = (window.location as unknown as { reload?: () => void }).reload
    let reloaded = false
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: () => (reloaded = true) }, configurable: true })
    await act(async () => apply.click())
    expect(JSON.parse(localStorage.getItem('platform.devtools.overrides')!)).toEqual({ orders: { manifestUrl: 'http://localhost:4200/manifest.json' } })
    expect(reloaded).toBe(true)
    void reload

    await act(async () => (document.querySelector('[data-testid="devtools.tab.shared"]') as HTMLElement).click())
    expect(document.querySelector('[data-testid="devtools.shared.react"]')?.textContent).toContain('19.3.0')
    await act(async () => (document.querySelector('[data-testid="devtools.tab.instances"]') as HTMLElement).click())
    expect(document.querySelectorAll('[data-testid^="devtools.instance."]').length).toBe(1)
  })
})
