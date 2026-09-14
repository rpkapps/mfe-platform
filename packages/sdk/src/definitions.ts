import type { Schema, InferOutput } from './schema'
import type { AppMountContext, WidgetMountContext, AppInstance, WidgetInstance } from './context'

/** SVG markup the shell sanitises and inlines. `lucide-static` exports these. */
export type Icon = string

/** All of the listed groups, or at least one of them. Never a function. */
export type Requirement = string[] | { any: string[] }

/** */
export interface DependencyDeclarations {
  widgets?: Array<{ id: string; contract: number }>
  links?: string[]
  permissions?: string[]
  serverEvents?: string[]
  capabilities?: string[]
}

export interface DefinitionBase {
  /** App/widget: defaults to the package name. Anything else: local; the build prefixes the MFE id. */
  id?: string
  title: string
  description?: string
}

export interface PathDeclaration {
  params?: Schema
  search?: Schema
}

export interface AppDefinition extends DefinitionBase {
  icon?: Icon
  permissions?: Requirement
  dependencies?: DependencyDeclarations
  basePath: string
  /** Relative to basePath; the build joins them. */
  paths?: Record<string, PathDeclaration>
  redirects?: Record<string, string>
  mount(ctx: AppMountContext): AppInstance | Promise<AppInstance>
}

export interface WidgetDefinition<Props = unknown, Events extends Record<string, unknown> = Record<string, never>> extends DefinitionBase {
  dependencies?: DependencyDeclarations
  contract: { version: number }
  props: Schema<Props>
  events?: { [K in keyof Events]: Schema<Events[K]> }
  mount(ctx: WidgetMountContext<Props, Events>): WidgetInstance<Props> | Promise<WidgetInstance<Props>>
}

export type Placement = 'palette' | 'page' | 'help' | 'settings'
export type ActionEffect = 'read' | 'write' | 'destructive'

/** */
export type ConfirmationContent =
  | { title?: string; message: string; confirmLabel?: string }
  | { custom: (ctx: { signal: AbortSignal }) => Promise<boolean> }

interface ActionBase extends DefinitionBase {
  icon?: Icon
  permissions?: Requirement
  effect?: ActionEffect
  shortcut?: string
  placement?: Placement[]
}

/** A static action that only navigates; works even when its app is not loaded. */
export interface NavigationAction extends ActionBase {
  readonly kind: 'navigation'
  to: string
  confirmation?: Exclude<ConfirmationContent, { custom: unknown }>
}

/** An action whose live half a component registers with `useAction` / `ctx.actions.register`. */
export interface LiveAction extends ActionBase {
  readonly kind: 'live'
}

export type ActionDefinition = NavigationAction | LiveAction

export interface ReleaseNoteDefinition extends DefinitionBase {
  version: string
  date: string
  body?: string
  to?: string
  audience?: { permissions?: Requirement }
}

// ---- factories: identity functions carrying inference ----

export function createApp(definition: AppDefinition): AppDefinition {
  return definition
}

export function createWidget<S extends Schema, E extends Record<string, Schema> = Record<string, never>>(
  definition: Omit<WidgetDefinition<InferOutput<S>, { [K in keyof E]: InferOutput<E[K]> }>, 'props' | 'events'> & { props: S; events?: E },
): WidgetDefinition<InferOutput<S>, { [K in keyof E]: InferOutput<E[K]> }> {
  return definition as unknown as WidgetDefinition<InferOutput<S>, { [K in keyof E]: InferOutput<E[K]> }>
}

type NavigationActionInput = Omit<NavigationAction, 'kind'>
type LiveActionInput = Omit<LiveAction, 'kind'> & { to?: never }

export function createAction(definition: NavigationActionInput): NavigationAction
export function createAction(definition: LiveActionInput): LiveAction
export function createAction(definition: NavigationActionInput | LiveActionInput): ActionDefinition {
  if ('to' in definition && typeof definition.to === 'string') return {...(definition as NavigationActionInput), kind: 'navigation' }
  return {...(definition as LiveActionInput), kind: 'live' }
}

export function createReleaseNote(definition: ReleaseNoteDefinition): ReleaseNoteDefinition {
  return definition
}

export function requirementSatisfied(requirement: Requirement | undefined, groups: ReadonlySet<string> | readonly string[]): boolean {
  if (!requirement) return true
  const has = (g: string) => (groups instanceof Set ? groups.has(g): (groups as readonly string[]).includes(g))
  if (Array.isArray(requirement)) return requirement.every(has)
  return requirement.any.some(has)
}
