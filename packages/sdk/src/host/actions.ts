import { PlatformError } from '../errors'
import type { Observer } from '../observer'
import { createObserverStore } from '../observer'
import type {
  ActionInitiator,
  ActionRegistrationHandle,
  ActionRegistrationOptions,
  ActionRegistrationStatus,
  ActionRegistry,
  ActionRunResult,
  ActionState,
  NavigateOptions,
  NavigationOutcome,
} from '../context'
import { requirementSatisfied, type ConfirmationContent, type LiveAction, type ManifestAction } from '..'
import type { Telemetry } from './telemetry'
import { anySignal, toPlatformError, uniqueId } from './util'

export interface ConfirmationRequest {
  actionId: string
  registrationId?: string
  targetLabel?: string
  content: Exclude<ConfirmationContent, { custom: unknown }>
  signal: AbortSignal
}

export interface ActionHostOptions {
  groups: Observer<readonly string[]>
  /** Static actions from the release manifests, by id. */
  staticActions: () => ReadonlyMap<string, ManifestAction>
  /** The shell renders text confirmations. */
  confirm: (request: ConfirmationRequest) => Promise<boolean>
  navigate: (options: NavigateOptions) => Promise<NavigationOutcome>
  telemetry: Telemetry
  /** Default error surface when a registration has no `onError` (the shell's toast region). */
  onError?: (error: PlatformError, info: { actionId: string; registrationId: string }) => void
  /** Test-only: auto-answer confirmations. */
  confirmOverride?: () => boolean | undefined
}

export interface RegistrationRecord {
  registrationId: string
  actionId: string
  instanceId: string
  action: LiveAction
  target?: { key: string; label: string }
  confirmation?: ConfirmationContent
  enabled: boolean
  disabledReason?: string
  status: Observer<ActionRegistrationStatus>
  pending: boolean
}

export interface ConfirmationLog {
  id: string
  actionId: string
  registrationId?: string
  target?: { key: string; label: string }
  content: ConfirmationContent
  outcome: 'confirmed' | 'cancelled'
}

interface Registration extends RegistrationRecord {
  options: ActionRegistrationOptions
  store: ReturnType<typeof createObserverStore<ActionRegistrationStatus>>
  released: boolean
  runController?: AbortController
  signal: AbortSignal
}

export interface RunOptions {
  id: string
  registrationId?: string
  initiator?: ActionInitiator
  /** Test host: `false` cancels at the confirmation step. */
  confirm?: boolean
  /** Optional focus hint: the instance whose registrations are preferred. */
  focusedInstanceId?: string
}

export function createActionHost(options: ActionHostOptions) {
  const registrations = new Map<string, Registration>()
  const confirmations: ConfirmationLog[] = []
  /** Bumps whenever a registration is added, updated, or released; the shell's header reads `registered()` on change. */
  const changes = createObserverStore(0)
  const bump = () => changes.set(changes.get() + 1)

  function snapshot(r: Registration): ActionRegistrationStatus {
    return Object.freeze({ enabled: r.enabled, pending: r.pending, error: r.store.get().error })
  }

  function setStatus(r: Registration, patch: Partial<ActionRegistrationStatus>) {
    const prev = r.store.get()
    const next = {...prev,...patch }
    if (prev.enabled === next.enabled && prev.pending === next.pending && prev.error === next.error) return
    r.store.set(Object.freeze(next))
  }

  function registryFor(instanceId: string, mfeId: string, instanceSignal: AbortSignal): ActionRegistry {
    return {
      register(opts) {
        if ((opts.action as { kind: string }).kind !== 'live') {
          throw new PlatformError('actions/static', `Action "${opts.action.id}" is a navigation action; it has no live half`, { capability: 'actions' })
        }
        if (!opts.action.id) throw new PlatformError('core/invalid-input', 'Action has no id', { capability: 'actions' })
        const signal = anySignal([instanceSignal, opts.signal])
        const record: Registration = {
          registrationId: uniqueId('reg'),
          // A local id ("approve") is the MFE's; the manifest and every shell control know it as "orders.approve".
          actionId: opts.action.id.includes('.') ? opts.action.id: `${mfeId}.${opts.action.id}`,
          instanceId,
          action: opts.action,
          target: opts.target,
          confirmation: opts.confirmation,
          enabled: opts.enabled ?? true,
          disabledReason: opts.disabledReason,
          pending: false,
          options: opts,
          store: createObserverStore<ActionRegistrationStatus>(Object.freeze({ enabled: opts.enabled ?? true, pending: false, error: undefined })),
          get status() {
            return this.store
          },
          released: false,
          signal,
        }
        registrations.set(record.registrationId, record)
        options.telemetry.emit('action.registered', { actionId: record.actionId, registrationId: record.registrationId, instanceId })
        record.store.subscribe(bump)
        bump()
        const release = () => {
          if (record.released) return
          record.released = true
          registrations.delete(record.registrationId)
          record.runController?.abort(new PlatformError('core/aborted', 'Registration released'))
          record.store.dispose()
          options.telemetry.emit('action.released', { actionId: record.actionId, registrationId: record.registrationId })
          bump()
        }
        signal.addEventListener('abort', release, { once: true })
        const handle: ActionRegistrationHandle = {
          registrationId: record.registrationId,
          status: record.store,
          run: () => run({ id: record.actionId, registrationId: record.registrationId, initiator: 'user' }),
          update(patch) {
            if (record.released) return
            if (patch.enabled !== undefined) record.enabled = patch.enabled
            if ('disabledReason' in patch) record.disabledReason = patch.disabledReason
            // Components pass fresh option objects on every render; only a real content change invalidates a pending confirmation.
            if ('confirmation' in patch && !sameConfirmation(record.confirmation, patch.confirmation)) record.confirmation = patch.confirmation
            if (patch.run) record.options = {...record.options, run: patch.run }
            if ('onError' in patch) record.options = {...record.options, onError: patch.onError }
            setStatus(record, { enabled: record.enabled })
          },
          release,
        }
        return handle
      },
    }
  }

  function resolve(opts: RunOptions): { registration?: Registration; result?: ActionRunResult; static?: ManifestAction } {
    if (opts.registrationId) {
      const r = registrations.get(opts.registrationId)
      if (!r) return { result: { status: 'unavailable' } }
      if (r.actionId !== opts.id) throw new PlatformError('core/invalid-input', `Registration ${opts.registrationId} does not belong to action "${opts.id}"`, { capability: 'actions' })
      return { registration: r }
    }
    let candidates = [...registrations.values()].filter(r => r.actionId === opts.id)
    if (opts.focusedInstanceId) {
      const focused = candidates.filter(r => r.instanceId === opts.focusedInstanceId)
      if (focused.length === 1) return { registration: focused[0] }
      if (focused.length > 1) return { result: { status: 'target-required' } }
    }
    if (candidates.length === 1) return { registration: candidates[0] }
    if (candidates.length > 1) return { result: { status: 'target-required' } }
    const s = options.staticActions().get(opts.id)
    if (s?.to) return { static: s }
    return { result: { status: 'unavailable' } }
  }

  function permitted(action: { permissions?: LiveAction['permissions'] }): boolean {
    return requirementSatisfied(action.permissions, options.groups.get())
  }

  async function confirmIfNeeded(content: ConfirmationContent | undefined, r: Registration | undefined, action: { id: string; title: string; effect?: string }, signal: AbortSignal): Promise<{ ok: boolean; id?: string }> {
    const required = action.effect === 'destructive' || content !== undefined
    if (!required) return { ok: true }
    const id = uniqueId('confirm')
    const override = options.confirmOverride?.()
    const effective: ConfirmationContent = content ?? { title: action.title, message: r?.target ? `${action.title}: ${r.target.label}?`: `${action.title}?` }
    let ok: boolean
    if (override !== undefined) ok = override
    else if ('custom' in effective) {
      try {
        ok = await effective.custom({ signal })
      } catch {
        ok = false
      }
    } else ok = await options.confirm({ actionId: action.id, registrationId: r?.registrationId, targetLabel: r?.target?.label, content: effective, signal })
    if (signal.aborted) ok = false
    confirmations.push({ id, actionId: action.id, registrationId: r?.registrationId, target: r?.target, content: effective, outcome: ok ? 'confirmed': 'cancelled' })
    return { ok, id }
  }

  async function run(opts: RunOptions): Promise<ActionRunResult> {
    const initiator = opts.initiator ?? 'system'
    const resolved = resolve(opts)
    if (resolved.result) return resolved.result

    if (resolved.static) {
      const s = resolved.static
      if (!permitted(s)) return { status: 'disabled' }
      const c = await confirmIfNeeded(s.confirmation, undefined, s, new AbortController().signal)
      if (!c.ok) return { status: 'cancelled' }
      try {
        const outcome = await options.navigate({ to: s.to! })
        options.telemetry.emit('action.run', { actionId: s.id, initiator, outcome })
        return outcome === 'committed' ? { status: 'completed' }: { status: 'cancelled' }
      } catch (error) {
        return { status: 'failed', error: toPlatformError(error) }
      }
    }

    const r = resolved.registration!
    if (!permitted(r.action)) return { status: 'disabled' }
    if (!r.enabled) return { status: 'disabled' }
    if (r.pending) return { status: 'pending' }

    // Reserve.
    r.pending = true
    const controller = new AbortController()
    r.runController = controller
    const signal = anySignal([r.signal, controller.signal])
    setStatus(r, { pending: true, error: undefined })
    const key = r.target?.key
    const content = r.confirmation
    const done = (result: ActionRunResult) => {
      if (!r.released) {
        r.pending = false
        r.runController = undefined
        setStatus(r, { pending: false })
      }
      options.telemetry.emit('action.run', { actionId: r.actionId, registrationId: r.registrationId, target: key, initiator, status: result.status })
      return result
    }
    try {
      const forced = opts.confirm === false ? false: undefined
      const c = forced === false ? { ok: false }: await confirmIfNeeded(content, r, {...r.action, id: r.actionId }, signal)
      if (!c.ok) return done({ status: 'cancelled' })
      // Re-check the same registration.
      if (r.released || signal.aborted) return done({ status: 'unavailable' })
      if (r.target?.key !== key || r.confirmation !== content) return done({ status: 'cancelled' })
      if (!permitted(r.action) || !r.enabled) return done({ status: 'disabled' })
      await r.options.run({ initiator, confirmationId: 'id' in c ? c.id: undefined, signal, progress: f => options.telemetry.emit('action.progress', { registrationId: r.registrationId, fraction: f }) })
      if (signal.aborted) return done({ status: 'cancelled' })
      return done({ status: 'completed' })
    } catch (error) {
      if (signal.aborted) return done({ status: 'cancelled' })
      const err = toPlatformError(error, 'actions/failed')
      if (!r.released) setStatus(r, { error: err })
      if (r.options.onError) r.options.onError(err)
      else options.onError?.(err, { actionId: r.actionId, registrationId: r.registrationId })
      return done({ status: 'failed', error: err })
    }
  }

  function state(opts: { id: string; registrationId?: string }): ActionState {
    const resolved = resolve(opts)
    if (resolved.result?.status === 'target-required') return 'target-required'
    if (resolved.static) return permitted(resolved.static) ? 'enabled': { status: 'disabled', reason: 'permission' }
    const r = resolved.registration
    if (!r) return 'absent'
    if (!permitted(r.action)) return { status: 'disabled', reason: 'permission' }
    if (r.pending) return 'pending'
    if (!r.enabled) return { status: 'disabled', reason: r.disabledReason }
    return 'enabled'
  }

  return {
    registryFor,
    run,
    state,
    changes: changes as Observer<number>,
    registered: (): RegistrationRecord[] => [...registrations.values()].map(r => ({...r, status: r.store })),
    confirmations: () => confirmations.slice(),
    /** Every live registration for the given instance and its descendants is released when they unmount; this is the explicit variant. */
    releaseInstance(instanceId: string) {
      for (const r of [...registrations.values()]) if (r.instanceId === instanceId) r.released || registrations.delete(r.registrationId)
    },
  }
}

export type ActionHost = ReturnType<typeof createActionHost>

function sameConfirmation(a: ConfirmationContent | undefined, b: ConfirmationContent | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if ('custom' in a || 'custom' in b) return 'custom' in a && 'custom' in b && a.custom === b.custom
  return a.title === b.title && a.message === b.message && a.confirmLabel === b.confirmLabel
}
