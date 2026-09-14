import type { PlatformError } from '../errors'
import type { InstanceStatus } from '../context'
import type { Observer } from '../observer'
import { createObserverStore } from '../observer'
import type { Telemetry } from './telemetry'
import { toPlatformError, withTimeout } from './util'

/** The fine-grained states are internal to the host, DevTools, and telemetry. */
export type InternalState =
  | 'registered'
  | 'resolving'
  | 'resolved'
  | 'loading'
  | 'loaded'
  | 'mounting'
  | 'mounted'
  | 'ready'
  | 'unmounting'
  | 'unmounted'
  | 'failed'
  | 'disabled'

export interface LifecycleTimeouts {
  resolve: number
  load: number
  mount: number
  ready: number
}

export const DEFAULT_TIMEOUTS: LifecycleTimeouts = { resolve: 5_000, load: 15_000, mount: 10_000, ready: 15_000 }

export function publicStatus(state: InternalState): InstanceStatus {
  switch (state) {
    case 'ready':
      return 'ready'
    case 'failed':
    case 'disabled':
      return 'failed'
    case 'unmounting':
    case 'unmounted':
      return 'unmounted'
    default:
      return 'loading'
  }
}

export interface MountedThing {
  ready?: Promise<void>
  unmount(): void | Promise<void>
}

export interface InstanceRunSteps<Def, Inst extends MountedThing> {
  id: string
  mfeId: string
  kind: 'app' | 'widget'
  resolve(signal: AbortSignal): Promise<void>
  load(signal: AbortSignal): Promise<Def>
  mount(definition: Def, signal: AbortSignal): Promise<Inst>
  /** Releases platform-owned resources (elements, registrations). Runs on every exit, once. */
  cleanup(): void
  /** Runs after the instance's own `unmount()` settled (the framework root is gone by then). */
  afterUnmount?(): void
  timeouts: LifecycleTimeouts
  telemetry: Telemetry
}

export interface InstanceRun<Inst extends MountedThing = MountedThing> {
  readonly id: string
  readonly mfeId: string
  readonly kind: 'app' | 'widget'
  readonly state: Observer<InternalState>
  readonly status: Observer<InstanceStatus>
  readonly error: PlatformError | undefined
  readonly instance: Inst | undefined
  /** Aborted when the instance is being unmounted. */
  readonly signal: AbortSignal
  /** Resolves when the run reaches `ready`, `failed`, or `unmounted`. Never rejects. */
  readonly settled: Promise<void>
  /** Cancels or unmounts. Returns immediately from the caller's point of view; the promise is for tests. */
  unmount(): Promise<void>
}

export function runInstance<Def, Inst extends MountedThing>(steps: InstanceRunSteps<Def, Inst>): InstanceRun<Inst> {
  const controller = new AbortController()
  const state = createObserverStore<InternalState>('registered')
  const status = createObserverStore<InstanceStatus>('loading')
  let error: PlatformError | undefined
  let instance: Inst | undefined
  let cleanedUp = false
  let cleanupPromise: Promise<void> | undefined
  let settle!: () => void
  const settled = new Promise<void>(r => (settle = r))

  const set = (next: InternalState) => {
    if (state.get() === 'unmounted' || state.get() === 'unmounting') return
    state.set(next)
    status.set(publicStatus(next))
    steps.telemetry.emit('instance.state', { instanceId: steps.id, mfeId: steps.mfeId, kind: steps.kind, state: next })
  }

  const cleanupOnce = () => {
    if (cleanedUp) return
    cleanedUp = true
    try {
      steps.cleanup()
    } catch (e) {
      steps.telemetry.emit('instance.cleanup-error', { instanceId: steps.id, error: String(e) })
    }
  }

  const disposeInstance = async (inst: Inst) => {
    try {
      await inst.unmount()
    } catch (e) {
      steps.telemetry.emit('instance.unmount-error', { instanceId: steps.id, mfeId: steps.mfeId, error: String(e) })
    }
  }

  const signal = controller.signal;(async () => {
    try {
      set('resolving')
      await withTimeout(steps.resolve(signal), { ms: steps.timeouts.resolve, signal, what: `resolve ${steps.mfeId}` })
      set('resolved')
      set('loading')
      const definition = await withTimeout(steps.load(signal), { ms: steps.timeouts.load, signal, what: `load ${steps.mfeId}` })
      set('loaded')
      set('mounting')
      const mounted = await withTimeout(steps.mount(definition, signal), { ms: steps.timeouts.mount, signal, what: `mount ${steps.mfeId}` })
      if (signal.aborted) {
        // A cancelled mount that returned late: unmount once, never attach.
        void disposeInstance(mounted)
        return
      }
      instance = mounted
      set('mounted')
      if (mounted.ready) await withTimeout(mounted.ready, { ms: steps.timeouts.ready, signal, what: `ready ${steps.mfeId}` })
      if (signal.aborted) return
      set('ready')
    } catch (e) {
      if (signal.aborted) return
      error = toPlatformError(e)
      steps.telemetry.emit('instance.failed', { instanceId: steps.id, mfeId: steps.mfeId, code: error.code, message: error.message })
      set('failed')
      // A failed attempt is cancelled and disposed; its fallback stays visible while it owns the destination.
      controller.abort(error)
      if (instance) {
        const inst = instance
        instance = undefined
        void disposeInstance(inst)
      }
      cleanupOnce()
    } finally {
      settle()
    }
  })()

  return {
    id: steps.id,
    mfeId: steps.mfeId,
    kind: steps.kind,
    state,
    status,
    get error() {
      return error
    },
    get instance() {
      return instance
    },
    signal,
    settled,
    unmount() {
      if (cleanupPromise) return cleanupPromise
      const current = state.get()
      if (current !== 'unmounted' && current !== 'unmounting') {
        state.set('unmounting')
        status.set('unmounted')
        steps.telemetry.emit('instance.state', { instanceId: steps.id, mfeId: steps.mfeId, kind: steps.kind, state: 'unmounting' })
      }
      controller.abort(new DOMException('Instance unmounted', 'AbortError'))
      cleanupOnce()
      const inst = instance
      instance = undefined
      state.set('unmounted')
      steps.telemetry.emit('instance.state', { instanceId: steps.id, mfeId: steps.mfeId, kind: steps.kind, state: 'unmounted' })
      cleanupPromise = (async () => {
        if (inst) await disposeInstance(inst)
        try {
          steps.afterUnmount?.()
        } catch (e) {
          steps.telemetry.emit('instance.cleanup-error', { instanceId: steps.id, error: String(e) })
        }
        state.dispose()
        status.dispose()
      })()
      return cleanupPromise
    },
  }
}
