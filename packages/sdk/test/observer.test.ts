import { describe, expect, it, vi } from 'vitest'
import { createObserverStore, selectObserver } from '../src'

describe('Observer contract', () => {
  it('reads synchronously and does not emit on subscribe', () => {
    const store = createObserverStore(1)
    const listener = vi.fn()
    store.subscribe(listener)
    expect(store.get()).toBe(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies synchronously in registration order after committing, and skips Object.is-equal values', () => {
    const store = createObserverStore({ a: 1 })
    const order: string[] = []
    store.subscribe(v => order.push(`first:${v.a}:${store.get().a}`))
    store.subscribe(v => order.push(`second:${v.a}`))
    const same = store.get()
    store.set(same)
    expect(order).toEqual([])
    store.set({ a: 2 })
    expect(order).toEqual(['first:2:2', 'second:2'])
  })

  it('a throwing listener does not prevent delivery to others', () => {
    const report = vi.fn()
    const store = createObserverStore(0, { onListenerError: report })
    const second = vi.fn()
    store.subscribe(() => {
      throw new Error('boom')
    })
    store.subscribe(second)
    store.set(1)
    expect(report).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledWith(1)
  })

  it('cleanup is idempotent and an aborted signal registers nothing', () => {
    const store = createObserverStore(0)
    const listener = vi.fn()
    const cleanup = store.subscribe(listener)
    cleanup()
    cleanup()
    store.set(1)
    expect(listener).not.toHaveBeenCalled()
    const aborted = new AbortController()
    aborted.abort()
    store.subscribe(listener, { signal: aborted.signal })
    store.set(2)
    expect(listener).not.toHaveBeenCalled()
    const controller = new AbortController()
    store.subscribe(listener, { signal: controller.signal })
    store.set(3)
    controller.abort()
    store.set(4)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a disposed observer keeps its last snapshot and ignores new subscriptions', () => {
    const store = createObserverStore('x')
    store.dispose()
    const listener = vi.fn()
    store.subscribe(listener)
    store.set('y')
    expect(store.get()).toBe('x')
    expect(listener).not.toHaveBeenCalled()
  })

  it('selectObserver only notifies when the selected value changes', () => {
    const store = createObserverStore(['a', 'b'] as readonly string[])
    const hasA = selectObserver(store, g => g.includes('a'))
    const listener = vi.fn()
    hasA.subscribe(listener)
    store.set(['a'])
    expect(listener).not.toHaveBeenCalled()
    store.set(['b'])
    expect(listener).toHaveBeenCalledWith(false)
    expect(hasA.get()).toBe(false)
  })
})
