# Enterprise Microfrontend Platform Specification

**Status:** Draft  
**Version:** 0.8.37  
**Date:** 2026-09-14  
**Supersedes:** 0.8.36  
**Audience:** Frontend platform engineers, application teams, architecture, security, developer experience, SRE, design systems

---

## Table of Contents

  - How to read this document
- **Part I — Foundations**
  - 1. Purpose
  - 2. Glossary
  - 3. Design Principles
  - 4. Non-Goals
  - 5. Browser and Toolchain Support
  - 6. Supported Frameworks
- **Part II — The Core Protocol (Core)**
  - 7. Conceptual Model
  - 8. Identifiers
  - 9. Schemas and API Conventions
  - 10. Definitions
  - 11. Mount Contexts
  - 12. Instances
  - 13. Lifecycle
  - 14. Resource Cleanup
  - 15. Errors
  - 16. Capabilities
  - 17. Versioning
  - 18. Manifest and Contributions
  - 19. Registry and Releases
  - 20. Loading and Sharing Libraries
  - 21. Angular Without Zone.js
  - 22. Dev Mode and the Test Host
- **Part III — Navigation, Header, Widgets, and Styles**
  - 23. How Navigation Works (Core)
  - 24. Router Adapters and the Bridge (Core)
  - 25. Linking Between Apps (Core)
  - 26. Navigation Blocking (Core)
  - 27. Header, Page Metadata, and App Switcher (Stable — header v1)
  - 28. Surfaces (Stable — surfaces v1)
  - 29. Widgets (Core)
  - 30. Styles (Core)
  - 31. Shell-Owned Pages and Behaviors (Core)
- **Part IV — Platform Capabilities**
  - 32. Identity and Session (Stable — identity v1)
  - 33. Permissions (Stable — permissions v1)
  - 34. Configuration and Settings (Stable — config v1)
  - 35. Storage (Stable — storage v2)
  - 36. HTTP (Stable — http v1)
  - 37. Server Events (Stable — serverEvents v1)
  - 38. Page Events (Stable — pageEvents v1)
  - 39. Notifications (Stable — notifications v1)
  - 40. Analytics and Audit (Stable — analytics v1)
  - 41. Locale and Theme (Stable — locale v1, theme v1)
  - 42. Performance and Observability (Stable — performance v1, telemetry v1)
  - 43. Service Worker and Connectivity (Stable — sw v1, connectivity v1)
- **Part V — Actions**
  - 44. Actions (Core)
- **Part VI — Governance and Delivery**
  - 45. Security
  - 46. Conformance and Certification
  - 47. Architecture Enforcement
  - 48. Resilience
  - 49. Deprecation and Migration
  - 50. Developer Tooling
  - 51. Adopting the Platform with an Existing App
  - 52. Testing
  - 53. Non-Functional Targets
  - 54. Implementation Phases
  - 55. Deferred
  - 56. Summary
  - 57. References
- **Appendices**
  - Appendix A — Public API
  - Appendix B — Examples
  - Appendix C — Adapter API (React and Angular)
  - Appendix D — Backend Integration Contract
  - Appendix E — Decisions
  - Appendix F — Open Questions
  - Appendix G — Change Log

---

## How to read this document

This specification describes a platform that lets many teams build parts of one product independently and ship them independently, while the user sees one coherent application.

Scope of this version:

- **One web page.** The shell loads once; apps and widgets are mounted into it as the user navigates. Nothing is server-rendered.
- **Two frameworks.** React (with React Router or TanStack Router) and Angular (zoneless only, with the Angular Router).
- **Two building blocks.** *Apps* own a section of the URL space. *Widgets* are reusable pieces of UI that apps place on their pages.
- **English only.** Titles and labels are plain strings.
- **Deployment is the pipeline's job.** The platform only needs to know which version of each app is live.

Everything cut from earlier drafts is listed in §55 (Deferred) so it is not forgotten; nothing in this document depends on it.

Each section starts with *why* the mechanism exists, then defines it. Code blocks that declare interfaces are the contract; prose explains intent.

**Normative words.** MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY have their RFC 2119 meanings when written in capitals.

**Maturity.** Each section is tagged **Core** (part of the protocol; every host implements it), **Stable** (a versioned service that is generally available), or **Experimental** (opt-in; may change).

---

# Part I — Foundations

## 1. Purpose

The platform lets teams build apps and widgets in separate repositories, release them on their own schedules, and have them run together in one product shell. It does this by standardizing the *contracts* between the shell and the apps, not by standardizing how apps are built internally.

Through those contracts it provides: navigation between apps, an app switcher, a shared design system, login and permissions, storage, a channel for backend services to send data to the page, notifications, observability, a command palette with keyboard shortcuts, and contextual help.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Shell** | The one web page the user loads. It owns the header bar (app switcher, page title and actions, notifications, settings, help) and the runtime that loads apps and widgets. Everything below the header is the mounted app's. |
| **Host** | Anything that implements the shell side of the contract: the production shell, the same shell in *dev mode*, and a headless *test host*. |
| **MFE** | Collective term for apps and widgets. |
| **App** | A deployable unit that owns a URL prefix (`/orders`) and is shown as the page content when the URL is under that prefix. |
| **Widget** | A deployable unit of UI (a customer card, an orders table) that an app or another widget places inside its own page. Widgets do not own URL prefixes. |
| **Definition** | The object an MFE exports to describe itself (`createApp`, `createWidget`). |
| **Instance** | The object returned by `mount()` that the host uses to update and unmount a running MFE. |
| **Manifest** | A JSON file produced at build time describing an MFE so the shell and registry can reason about it without running it. |
| **Registry** | The service that stores manifests and the live version of each MFE. Written by the deployment pipeline, read by the shell. |
| **Release** | The list of exact versions (shell, capabilities, every MFE, shared libraries) that one page session uses, fetched once when the page loads. |
| **Capability** | A versioned platform service exposed to MFEs as `platform.<name>`. |
| **Contribution** | Data an MFE adds to a shell-owned page: a static action or a release note. |
| **Action** | A named, permission-checked operation. Its static half (title, icon, shortcut, permission) is in the manifest; its live half (enabled, run) is registered by the component that has the data. |
| **Path** | A URL an app serves and lists in its manifest. Paths are the contract other apps link to; renames are redirects. |
| **Server event** | A message a backend service sends to the page on its own initiative, through the host's shared event service (SignalR in the default provider). |
| **Page event** | A message between things mounted on the same page right now (widget to widget). Never leaves the page. |

## 3. Design Principles

1. **Contracts, not frameworks.** The shell requires nothing about how an app is built beyond the two supported frameworks and the Angular zoneless rule.
2. **Capabilities, not technologies.** App code calls `platform.storage`, not `localStorage`; `platform.serverEvents`, not SignalR. Implementations can change without touching apps.
3. **The shell owns the header bar; the app owns everything below it.** App switcher, page title, page actions, command palette, notifications, help, settings, release notes, the overlay layer and toast region, status banners, and error pages are shell-owned. Navigation inside an app — sidebars, tabs, breadcrumbs — is the app's own.
4. **Standalone is the same shell in dev mode.** An app never branches on "am I standalone?".
5. **Describe statically, run lazily.** Anything the shell needs before an MFE runs is data in the manifest. Anything that depends on live data is registered by a mounted component.
6. **Code in the page is trusted.** There is no sandbox between apps. Safety comes from what is allowed into production, not runtime isolation.
7. **The server is the source of truth.** Apps load fresh data when they mount. Server events tell a mounted app that something changed; page events let things on the same page talk. Nothing else carries state between apps.

## 4. Non-Goals

The platform does not own: application state management, forms, data fetching and caching libraries, GraphQL clients, tables, charts, date libraries, validation libraries, business APIs, deployment pipelines, or any app's internal architecture. Server-side rendering, iframes, other frameworks, and translations are out of scope (§55).

## 5. Browser and Toolchain Support

Target: the last two major releases of Chrome, Edge, Firefox, and Safari (desktop and iOS). The platform team maintains `support-matrix.md`. Features that gate the design:

| Feature | Used for | Policy |
|---|---|---|
| ES modules and dynamic `import()` | Loading MFEs | Required |
| Import maps | Sharing libraries between MFEs | Required; all maps written before any MFE code runs |
| CSS `@scope` | Style isolation | Required; attribute-selector fallback emitted by the build while needed |
| CSS cascade layers | Predictable style ordering | Required |
| `AbortSignal.any` / `.timeout` | Cleanup | Required (polyfilled by the core package) |
| `BroadcastChannel` | Shell cross-tab coordination | Required |
| WebSockets | Server events (SignalR) | Required; SignalR falls back to long polling automatically |
| View Transitions | Nicer cross-app navigation | Optional |

Toolchain: Node.js current LTS; TypeScript ≥ 5.6.

## 6. Supported Frameworks

| Framework | Router | Provided by the platform |
|---|---|---|
| React (current and previous major) | React Router or TanStack Router | `@platform/react`, `@tecton/react`, conformance tests, DevTools |
| Angular ≥ 21, **zoneless only** | Angular Router | `@platform/angular`, `@tecton/angular`, conformance tests, DevTools |

Vanilla DOM / Web Components work with the core package alone, best-effort. **Angular with Zone.js is not supported**; a build that includes `zone.js` fails validation (§21).

---

# Part II — The Core Protocol (Core)

## 7. Conceptual Model

```text
createApp()          owns a URL prefix; mounted into the shell's content area
createWidget()       owns nothing; mounted by an app or widget into an element
Manifest             build output describing an MFE without running it
Registry / Release   which versions are live; the list one page session uses
Capability           platform.storage, platform.navigation, ... — versioned services
Contribution         data only: static actions, release notes
Action               static half in the manifest, live half registered from a component
Path                 a URL an app serves; the contract other apps link to
```

## 8. Identifiers

Lower-case, dot-separated, kebab-case within a segment: `^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)*$`, at most 128 characters.

**Ownership.** Every identifier an MFE defines is prefixed with that MFE's id, and the build does the prefixing: `createAction({ id: 'approve' })` in the Orders app is `orders.approve` in the manifest, at runtime (`approveOrder.id`), and everywhere it is referenced from outside. This applies to everything defined with `create*` — actions, widgets, release notes, storage, preferences. Ids that an MFE *references* rather than defines are written in full, because they come from somewhere else: permissions (Authentik groups), server events, and config from backend catalogs (§16), page events (both sides use the same string), and other MFEs' widgets, actions, and paths. A definition id MUST NOT contain a dot; the registry rejects a manifest whose ids do not carry the owning MFE's prefix. `platform.` is reserved; `shared.` is governed by the platform team. The same rule applies to server-event topics (§37): `orders.*` belongs to the Orders service.

**Namespaces per kind.** Ids are unique per kind; an action and a page event may both be `orders.approve`. Tooling always shows the kind.

**Claiming an id.** An MFE id is claimed once, before first publish, by registering it in the registry with an owning team (`mfe init` does this; the portal shows who owns what). Publishing under an unclaimed or foreign id is rejected. Renaming an MFE is a deprecation (§49), not an edit.

## 9. Schemas and API Conventions

### 9.1 Schemas

The platform ships no validation library. `Schema<T>` means any object implementing **Standard Schema v1** (Zod, Valibot, ArkType, …). Schemas type consumers, validate at trust boundaries (widget props, action input, destination params, storage values, server-event payloads), and are converted to JSON Schema in the manifest. `mfe build` performs that conversion itself for Zod (≥ 4) and Valibot; a schema from any other library MUST expose a `jsonSchema` property holding the equivalent JSON Schema, which the build copies verbatim, otherwise validation fails with the offending definition.

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec'
export type Schema<T = unknown> = StandardSchemaV1<unknown, T>
```

### 9.2 API conventions (TanStack style)

*Why:* teams already know TanStack Query and Router. If the platform's APIs follow the same conventions, there is nothing new to learn and the same type-inference tricks work.

1. **Headless core, thin adapters.** `@platform/core` has no framework code. `@platform/react` and `@platform/angular` only wrap core objects in hooks and injectables.
2. **Options objects for configurable operations; familiar signatures for established patterns.** Use named options for operations such as `navigate({ to, params, search })` and `subscribe({ event, params, onMessage, signal })`. Simple reads/writes, framework hooks, and wrappers around established APIs retain familiar signatures: `store.get(key)`, `store.set(key, value)`, `useAction(action, options)`, `http.fetch(input, init)`, and `observer.subscribe(listener, options?)`. Shared options retain consistent names: `signal`, `onMessage`, `onError`, `params`, `search`, `to`. This clarifies existing signatures; it does not require rewriting them.
3. **`create*` factories carry inference.** `createApp`, `createWidget`, `createAction`, `createReleaseNote`, `createStorage`, … are identity functions like `queryOptions()` / `createRoute()`: they return what you pass in, with types inferred from the schemas inside, so consumers get typed params, payloads, and props without annotations.
4. **Reactive state uses an `Observer`.** A whole-value state service is an observer directly; a keyed service exposes `observe(key)`. Convenience snapshot reads remain available. The shared shape is:

```ts
interface Observer<T> {
  get(): T
  subscribe(listener: (value: T) => void, options?: { signal?: AbortSignal }): () => void
}
```

`platform.identity`, `platform.theme`, `platform.locale`, `platform.connectivity.connection`, `platform.serverEvents.connection`, and handle status observers implement this shape directly. Keyed services expose `platform.permissions.observe(id)` and `platform.config.observe(key)`. React `useObserver(observer, selector?)` and Angular `injectObserver(observer)` wrap this contract (§9.3). State hooks such as `usePermission`, `useConfig`, and `useTheme` delegate to these observers. Event hooks such as `useServerEvent` and `usePageEvent` manage message subscriptions; events are not state snapshots, although a subscription's status may be an observer. Storage's asynchronous reads and change subscriptions retain their existing API.
5. **Stateful handles expose status; request functions retain their documented promise semantics.** MFE and subscription handles expose `status` and `error`; action invocations return `ActionRunResult`. `http.fetch` preserves Fetch response/error behavior, while the HTTP convenience methods reject unsuccessful HTTP statuses so ordinary promise-based clients can handle them (§36). Programming errors and unexpected failures may also reject or throw; expected lifecycle states are not exceptions.
6. **Lifecycle and execution callbacks receive one context object.** `mount(ctx)` and action callbacks `run({ initiator, confirmationId, signal, progress })` use context objects. Observer listeners receive a value and event handlers receive their documented payload. These callback signatures remain distinct; a lifecycle/execution `signal` belongs inside its context.
7. **Global type inference through `Register`.** `mfe types` (run automatically by `mfe dev` and `mfe build`) reads the registry — and, through it, the backend catalogs for permissions, server events, notifications, and config — and writes `platform-registry.d.ts` into the project, which augments one interface:

```ts
declare module '@platform/core' {
  interface Register {
    paths: { '/customers/$customerId': { params: { customerId: string }; search?: { tab?: string } } }
    permissions: 'orders-users' | 'orders-approvers' | 'customers-users'   // Authentik group names
    serverEvents: { 'orders.updated': { params: { orderId: string }; payload: { status: string } } }
    widgets: { 'customer-card': { contract: 2; props: { customerId: string; compact?: boolean }; events: { selected: { customerId: string } } } }
    notifications: { 'orders.approved': { data: { orderId: string } } }
    config: { 'orders.maxExportRows': number }
  }
}
```

Sources: paths, widgets, and page events come from MFE manifests; permissions are Authentik group names (§33); server events and notifications from the platform hub's event catalog (published by the .NET services); config from the control plane. The frontend never re-declares any of the backend-owned ones.

After that, `navigate({ to: '/customers/$customerId', params: … })`, `can('orders-approvers')`, `subscribe({ event: 'orders.updated' })`, `<MfeWidget id="customer-card" contract={2} props={…} />`, and `platform.config.get('orders.maxExportRows')` are all checked and autocompleted, exactly as TanStack Router types `<Link to>` from the registered router. Without the file everything still works, untyped.
8. **Sensible defaults, overridable at two levels.** The shell sets `defaultOptions` per capability at build time (timeouts, retry, ttl; §16.2); a call can override them.
9. **Simple keyed lookups take the key directly.** `can(id)`, `usePermission(id)`, `config.get(key)`, and `config.observe(key)` retain bare-key signatures. Existing configurable operations such as `actions.run({ id, registrationId? })` retain their options objects; argument count alone does not determine the convention.
10. **DevTools are part of the API.** Every `create*` definition and every `Observer` is visible in DevTools by id.

### 9.3 Observation contract

This contract applies to every `Observer<T>`, including observers returned by keyed services. It is additive: `permissions.can(id)` and `config.get(key)` remain supported snapshot reads.

| Concern | Required behavior |
|---|---|
| Read | `get()` synchronously returns the current snapshot without fetching or starting work. Values required by an MFE are initialized before it mounts. |
| Snapshot identity | Snapshots are immutable to consumers. Repeated reads return the same reference until the value changes. Providers preserve references for unchanged object/array values. |
| Subscribe | `subscribe(listener, options?)` registers for future changes only; it does not immediately call the listener. Read with `get()` for the initial value. |
| Notify | Commit the new snapshot before notifying listeners synchronously in registration order. No notification when `Object.is(previous, next)` is true. A throwing listener is reported through telemetry and does not prevent delivery to others. |
| Unsubscribe | Return an idempotent cleanup function. Cleanup or signal abortion prevents subsequent deliveries; an already-running callback may finish. An already-aborted signal registers nothing and returns a no-op cleanup. |
| Lifetime | Instance-bound observers always clean up when their owning MFE unmounts. A supplied signal can shorten that lifetime, never extend it. Reads from a disposed observer return its last snapshot; new subscriptions are no-ops and it never attaches to a new session. |
| Keyed observers | Repeated `observe(key)` calls on the same live client return the same observer. Observing does not start a per-consumer request, poller, or connection. |
| Framework adapters | Read an initial snapshot, subscribe, and reconcile the snapshot again after subscription so an intervening update is not missed. React selectors suppress unchanged selected values using `Object.is`; Angular exposes the current value as a signal. |

React subscriptions also end on component unmount and switch cleanly when the observer/key changes. Angular subscriptions also end with the injecting component/service's destruction scope. Keyed injectables bind their key at construction; recreate the owning view/scope when that key changes. Unmounting one component MUST NOT unsubscribe another component using the same observer. Unrelated key changes do not notify a keyed observer.

**When values change.** Observation standardizes delivery, not the source's refresh policy:

| State | Update boundary |
|---|---|
| Theme and locale | Live when the shell accepts a user preference change |
| Connection and lifecycle status | Live on the corresponding host state transition |
| Identity | Live when the shell accepts a session change or expiry; expiry clears the identity |
| Permissions | Based on the current authenticated session's groups. Backend group edits require a new sign-in in this version; expiry makes checks false before authenticated MFEs are removed. No group polling is introduced. |
| Config | Live when the host accepts a validated control-plane refresh. Refresh transport and cadence are host configuration, not controlled by each observer. Invalid refreshes retain the last valid value and report an error. |
| Release and loaded implementation versions | Pinned for the page session (§19.3); observation does not hot-swap code |

The test host uses these same notification and equality rules for `config.set`, `permissions.set`, theme changes, and lifecycle transitions. `permissions.set` is a test-only simulation of a new group snapshot, not a production permission-edit API.

## 10. Definitions

```ts
interface DefinitionBase {
  id?: string                                   // for an app or widget: defaults to the package name; for anything else: local, the build prefixes the MFE id (§8)
  title: string                                 // plain English
  description?: string
}

// Not authored: the protocol version and the capability versions an MFE needs are derived by `mfe build`
// from the SDK version and from which capability clients the code imports (§16).

interface AppDefinition extends DefinitionBase {
  icon?: Icon                                   // see below
  permissions?: Requirement                     // who sees the app (Authentik groups); evaluated by the shell; default: everyone
// type Requirement = string[] | { any: string[] }   — all of the listed ids, or at least one of them (§33)
  dependencies?: DependencyDeclarations         // fallback for dependencies the build cannot infer (§18.3)
  basePath: string                              // URL prefix this app owns
  paths?: Record<string, { params?: Schema; search?: Schema }>   // public paths under basePath for typed cross-app links (§25)
  redirects?: Record<string, string>            // paths relative to basePath; applied by the owning app adapter (§25)
  mount(ctx: AppMountContext): AppInstance | Promise<AppInstance>
}
// `title`, `icon`, and `description` feed the app switcher (§27.3); `permissions` decides who sees the app at all.

// Icons in definitions and contributions are data the SHELL renders (in the switcher, palette, header), often before the app loads
// and regardless of the app's framework — so they are SVG markup strings, never React or Angular components.
type Icon = string                              // SVG markup. `import { Package } from 'lucide-static'` gives one; so does `import x from './x.svg?raw'`.
// The shell sanitizes it, forces currentColor and 1em sizing, and inlines it. Size cap: 4 KB. Apps use any Lucide version they like;
// inside their own area they import icon components as usual (`import { Check } from 'lucide-react'`).
// Framework adapters export their own `createApp` / `createWidget` (the package name says which framework) and replace `mount` with the
// framework's own inputs: `createApp({ basePath, routeTree })` for TanStack Router, `createApp({ basePath, routerRoutes })` for React Router,
// and `createApp({ basePath, angularRoutes, providers? })` from `@platform/angular`. The adapter creates
// the router, wires the platform history and base path, and (Angular) adds zoneless change detection and the router provider itself.

interface WidgetDefinition<Props = unknown, Events extends Record<string, unknown> = {}>
  extends DefinitionBase {
  dependencies?: DependencyDeclarations         // same build fallback as apps (§18.3)
  contract: {
    version: number                             // the single supported contract major (§17)
  }
  props: Schema<Props>
  events?: { [K in keyof Events]: Schema<Events[K]> }
  mount(ctx: WidgetMountContext<Props, Events>): WidgetInstance<Props> | Promise<WidgetInstance<Props>>
}
```

**Entry module.** An MFE's deployable artifact is an ES module whose default export is the definition. It MUST NOT do anything on load except define the export.

## 11. Mount Contexts

*Why:* the mount context is everything an MFE is given. Defining it precisely is what lets the same MFE run in production, dev mode, and tests.

```ts
interface MountContextBase {
  element: HTMLElement                          // render here and nowhere else
  signal: AbortSignal                           // aborted when the instance is being unmounted (§14)
  platform: PlatformClient                      // typed from the capabilities the build recorded (§16)
  instance: { id: string; mfeId: string; version: string; scope: string }
  overlayRoot: HTMLElement                      // where portals/dropdowns/dialogs attach (§30.5)
  reportError(error: unknown, info?: { fatal?: boolean }): void
  locale: Observer<LocaleSnapshot>
  theme: Observer<ThemeSnapshot>
}

interface AppMountContext extends MountContextBase {
  basePath: string                              // the prefix this instance was mounted under
  initialUrl: URL                               // the URL at mount time
  router: RouterBridge                          // §24; adapters use it, app code normally does not
  page: PageController                          // §27
  actions: ActionRegistry                       // register live actions (§44.2)
}

interface WidgetMountContext<Props, Events> extends MountContextBase {
  props: Props
  emit<K extends keyof Events>(options: { event: K; payload: Events[K] }): void
  consumer: { mfeId: string; instanceId: string }
  contractVersion: number                       // the major the consumer asked for
  actions: ActionRegistry
}
```

`PlatformClient` has one property per capability.

## 12. Instances

```ts
interface AppInstance {
  ready?: Promise<void>                         // resolves at first meaningful render; absent = ready on mount
  unmount(): void | Promise<void>
}

interface WidgetInstance<Props> {
  ready?: Promise<void>
  update?(props: Props): void                   // synchronous; whole props object; replace, not merge
  unmount(): void | Promise<void>
}
```

An app has no `update`: route changes go through the router bridge (§24), theme and locale are Observers, and a permission change is a new sign-in. Widgets receive new props through synchronous `update(props): void`. The method accepts the latest props; it does not wait for rendering or data loading. Framework adapters pass props into their normal React/Angular rendering mechanisms. Widgets own asynchronous work and prevent stale results from replacing newer state. The platform has no update queue or scheduler. A thrown update error fails and disposes that widget instance and shows its fallback; updates and events after disposal are ignored.

## 13. Lifecycle

**What MFEs and tests see** is a four-value status on every handle and in the test host: `loading | ready | failed | unmounted`. The finer states below are internal to the host and DevTools, and appear in telemetry spans.

```text
registered → resolving → resolved → loading → loaded → mounting → mounted → ready → unmounting → unmounted
any state except unmounted → failed
resolved | loaded → disabled (the live version was withdrawn)
```

| From | To | Trigger |
|---|---|---|
| registered | resolving | URL matches the app, or a consumer mounts the widget |
| resolving | resolved / failed | Release entry found and requirements satisfiable (§16) / not |
| resolved | loading → loaded / failed | Entry fetched and evaluated; definition valid / not |
| loaded | mounting → mounted / failed | `mount()` resolved / rejected or timed out |
| mounted | ready / failed | `ready` resolved / rejected or timed out |
| mounted, ready | unmounting → unmounted | Navigation away, or the consumer removed it |
| resolving, loading, mounting, mounted, ready | unmounting → unmounted | Navigation superseded or owner removed; cancel and detach without awaiting cleanup |
| failed | resolving | Host retry policy (§48), using a fresh attempt and signal |

Startup timeouts (platform-wide): resolve 5 s, load 15 s, mount 10 s, ready 15 s. On timeout the attempt is cancelled and disposed (§14), and the host shows fallback UI only if that attempt still owns the destination. Navigation never waits for outgoing cleanup; there is no public cleanup timeout. Every transition emits telemetry; DevTools shows every instance's state.

## 14. Resource Cleanup

Every instance gets `ctx.signal`. Capabilities accept `{ signal }` on every asynchronous call and default to the instance's signal, so subscriptions and requests die with the instance. MFEs SHOULD pass it to their own `fetch` calls, timers, and listeners.

**Navigation does not await cleanup.** Once blockers approve leaving, the host aborts the outgoing instance's signal, detaches its UI and overlays, and releases its CSS scope, platform registrations, and capability handles. It starts the destination without waiting for the old instance's `unmount()` promise. Disposed instances cannot publish events, update shell state, or regain control of navigation. The host invokes `unmount()` once for each returned instance and reports cleanup errors through telemetry; those errors never replace the destination UI. Framework adapters destroy their React root or Angular application as part of this ordinary disposal. Cleanup runs on the same main thread, so its synchronous work MUST stay short; an async function is not a background thread.

**Interrupted mounting.** Each mount attempt has its own lifetime signal. Leaving, failure, or a startup timeout aborts it and releases platform-owned resources even if no instance has been returned. An MFE MUST release resources it allocated before a rejected mount, using the signal or its own failure cleanup. If a cancelled mount later returns an instance, the host calls its `unmount()` once and never attaches or marks it ready. Late results from a superseded attempt cannot change the current page. Loading code itself may finish after cancellation; cancellation does not undo module evaluation.

The public status becomes `unmounted` when an instance is detached and its platform handles are released, even if app cleanup is still finishing. A current failed instance retains `failed` while its fallback is shown. The test host can await cleanup for leak checks; production navigation never does. DevTools reports leaked resources. No new cleanup API or platform cache manager is introduced.

## 15. Errors

```ts
class PlatformError extends Error {
  code: string            // 'storage/quota-exceeded'
  capability?: string
  retryable: boolean
  cause?: unknown
  details?: Record<string, unknown>
}
```

Shared codes: `core/aborted`, `core/unavailable` (retryable), `core/unsupported`, `core/forbidden`, `core/invalid-input` (`details.issues`), `core/timeout` (retryable), `core/network` (retryable). Each capability adds its own prefix.

Errors inside MFE code are caught by the adapter's error boundary (React `ErrorBoundary`, Angular `ErrorHandler`) and passed to `ctx.reportError`. Fatal errors move the instance to `failed`; others are recorded and attributed.

## 16. Capabilities

*Why:* platform services evolve at different speeds, so each is versioned on its own. Developers never declare capability version numbers: the SDK ships each capability client at a known major, and the build records imported clients. For usage hidden behind wrappers or dynamic selection, an MFE can list capability names in `dependencies.capabilities` (§18.3); the build still derives their majors from the SDK.

```json
"capabilities": { "navigation": 1, "storage": 2, "permissions": 1 }      // written by `mfe build`, never by hand
```

Before loading, the host checks the protocol major and every recorded capability major against what it provides; a mismatch fails the instance with `core/incompatible`, and the registry refuses to make such a version live in the first place (§19.2). Every capability the shell ships is available to every MFE; there is no runtime capability status. Capabilities are defined by the platform team with `createCapability`, which is not part of the MFE-facing API.

### 16.1 Host-configured infrastructure providers

The shell configures infrastructure providers once at startup. Providers implement platform-owned interfaces; app code sees only instance-scoped capability clients. Authentik and SignalR remain the production defaults, but their SDKs, endpoints, and vendor behavior are contained in provider packages. No MFE registers or replaces a shared provider.

| Provider | Supplies | Host retains |
|---|---|---|
| Identity | Session/user/group snapshots, sign-in and sign-out integration | Session lifecycle, cross-tab coordination, admission checks, credential exposure policy |
| Permission catalog | Known permission/group ids through the configured catalog endpoint | Stable ids, `can`/`observe`, manifest/type validation; backend remains authorization authority |
| Server events | Connection and subscription transport, reconnect support | One shared logical event service, subscription ownership, validation, MFE cleanup |
| Config | Catalog and validated-source value updates | Per-key snapshots, validation, refresh policy, observer delivery |
| Telemetry | Delivery to the chosen telemetry backend | Attribution, redaction, batching policy, public telemetry API |

The provider boundary does not introduce a new permission mapping layer: today's ids remain Authentik group names. A replacement identity provider must preserve those public ids and meanings. Browser catalog access uses the platform's catalog endpoint; privileged identity-provider catalog access stays in the registry/control-plane/CLI provider, never MFE code or browser-held admin credentials.

```ts
// @platform/host — host-only types; not MFE capabilities.
interface ProviderContext {
  signal: AbortSignal                           // lifetime of the whole host
  env: Readonly<Record<string, string>>         // the environment values of §16.2
  reportError(error: unknown): void
}
type ProviderFactory<T> = (ctx: ProviderContext) => T | Promise<T>

interface IdentitySource {
  session: Observer<{ user: UserSnapshot; groups: readonly string[]; expiresAt?: string } | null>   // UserSnapshot as in §32
  login(): Promise<void>
  logout(): Promise<void>
}
interface PermissionCatalogSource {
  load(options: { signal: AbortSignal }): Promise<readonly string[]>
}
interface ConfigSource {
  catalog: Readonly<Record<string, Schema>>
  values: Observer<Readonly<Record<string, unknown>>>
}
interface ServerEventsSource {
  connection: Observer<'connected' | 'reconnecting' | 'disconnected'>
  subscribe(options: {
    event: string; params?: unknown
    onMessage(payload: unknown): void
    onReconnect?(): void
    signal: AbortSignal
  }): {
    status: Observer<'subscribing' | 'live' | 'reconnecting' | 'closed'>
    close(): void
  }
}
interface TelemetrySink {
  write(records: readonly Record<string, unknown>[]): Promise<void>
}
interface HostProviders {
  identity: ProviderFactory<IdentitySource>
  permissionCatalog: ProviderFactory<PermissionCatalogSource>
  serverEvents: ProviderFactory<ServerEventsSource>
  config: ProviderFactory<ConfigSource>
  telemetry: ProviderFactory<TelemetrySink>
}
// createHost({ providers, ...buildTimeOptions }) initializes these once before mounting MFEs (§16.2).
```

Factories resolve when their required initial snapshots are ready. The host owns subscription sharing and hands each MFE a separate client bound to its lifetime. Provider resources stop on the host signal; per-subscription signals close only that subscription. Provider objects and vendor credentials never appear on `PlatformClient`. Normalized observers follow §9.3. Transport reconnect must restore subscriptions before `onReconnect` is delivered. Backend subscription authorization still applies regardless of provider.

Dev mode selects production providers or configured development replacements. The test host uses in-memory sources implementing the same contracts. Provider swaps happen at host startup, not while MFEs are running. A conforming provider change does not require MFE code changes; incompatible public behavior requires normal capability versioning (§17).

### 16.2 Shell configuration

The shell has two kinds of configuration and no runtime UI settings beyond the user preferences on the Settings page (§27.4).

**Environment values** differ per deployment and are supplied as environment variables to the shell container at `docker run`. The container's entrypoint writes them to a small JSON document the page fetches before anything else; they are never compiled into the bundle, so one shell image runs in every environment. Every value is a URL or an origin list; none of them changes behavior.

```text
PLATFORM_ENVIRONMENT        dev | staging | production            (telemetry attribute, dev-mode gate)
PLATFORM_REGISTRY_URL       registry base URL (§19)
PLATFORM_CDN_URL            origin that serves release artifacts and shared libraries (§20)
PLATFORM_API_ORIGINS        comma-separated origins that receive platform credentials and CSRF metadata (§36)
PLATFORM_HUB_URL            platform hub endpoint for server events and notifications (§37)
PLATFORM_IDENTITY_URL       identity provider (Authentik) issuer URL (§32)
PLATFORM_CONFIG_URL         control-plane endpoint for the config catalog and values (§34)
PLATFORM_TELEMETRY_URL      telemetry sink endpoint (§42)
```

Provider factories (§16.1) receive these values through `ProviderContext.env`; MFEs never see them. A missing or malformed value fails shell startup with a maintenance page naming the variable.

**Build-time options** are constants in the shell repository, passed to `createHost` and changed by a shell release: product name and logo, the shell-owned Help menu entries (product docs, support), per-capability `defaultOptions` (§9.2), the release poll interval (§19.3), and the theme defaults. The dev-mode shell and the test host substitute their own values. There is no operator-editable UI configuration: what an operator can change at runtime is the release (§19), the config catalog values (§34), and maintenance mode (§31.1).

## 17. Versioning

| What | Format | Bumped by |
|---|---|---|
| Shell, SDK packages | semver | Platform team |
| **Protocol** (this Part) | integer major | Platform team, via RFC |
| Capability | integer major | Capability owner |
| MFE implementation | semver | App team |
| Widget contract | integer major | Widget owner |
| Manifest schema | integer major | Platform team |

**Support policy.** Protocol and capability majors are recorded in the manifest by the build (§16), never authored. The host supports the current and previous protocol major. Each shell release provides exactly one major of each capability. Prefer backward-compatible additions and preserve existing behavior within that major. Breaking capability upgrades require coordinated shell and affected-MFE releases; the complete new release MUST pass compatibility validation before users receive it. There is no automatic 180-day overlap or runtime adapter for previous capability majors. Older open pages keep their original shell, capabilities, and MFEs together until reload (§19.3). Compatibility CI (§53) verifies the MFEs supported by each new shell release. Framework-major support is separate (§20).

**Widget contracts: one implementation and one contract per widget per release.** A widget declares one `contract.version`; consumers request that exact major. There is no `supports` list or runtime conversion between contract majors. The contract version is fixed for an existing widget id; implementation versions advance independently using semver.

Updates under the same id MUST remain backward compatible with published props, events, and documented behavior. Adding an optional prop with a default that preserves behavior can be compatible; renaming a required prop, making an optional prop required, removing an event, or changing its payload incompatibly is not. Schema checks alone do not prove behavioral compatibility; widget-owner contract tests are required.

A breaking redesign uses a new widget id with its own single contract. Both ids may coexist while consumers migrate through ordinary deployments. Deprecate the old id using §49; do not withdraw it while live consumers depend on it. Pinned page sessions retain their original artifacts through the release retention policy (§19.3). Protocol, capability, and framework-major support policies are unchanged.

## 18. Manifest and Contributions

*Why:* the shell must build the app switcher, menu, command palette, settings, and help for every app without downloading every app. So each MFE ships a **manifest** (JSON, no code) beside its main bundle, and everything the shell needs up front is in it — including the app's contributions (§18.2), which are evaluated at build time.

### 18.1 Manifest (schema v1)

Annotated example; comments are not part of the JSON.

```json
{
  "manifest": 1,
  "id": "orders",
  "kind": "app",
  "version": "18.4.2",
  "protocol": 1,
  "title": "Orders",
  "icon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" …>…</svg>",   // SVG markup, from lucide-static or a file
  "permissions": ["orders-users"],
  "owner": { "team": "commerce-orders", "repo": "git@company:commerce/orders" },            // from CI, not authored
  "basePath": "/orders",
  "paths": {                                                                                 // relative to basePath; params/search are JSON Schema (§9.1)
    "/": {},
    "/$orderId": { "params": { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] },
                   "search": { "type": "object", "properties": { "tab": { "type": "string", "enum": ["summary", "invoices"] } } } },
    "/$orderId/invoices": { "params": { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] } },
    "/reports": {}, "/new": {}
  },
  "redirects": { "/legacy/$id": "/$id" },
  "capabilities": { "navigation": 1, "storage": 2, "permissions": 1, "serverEvents": 1, "http": 1 },   // from imports
  "runtime": {
    "framework": "angular", "frameworkVersion": "21.2.0", "zoneless": true,
    "shared": { "@angular/core": "^21", "@angular/common": "^21", "rxjs": "^7" }
  },
  "entries": {
    "main":          { "url": "./orders.entry.js",   "integrity": "sha384-…" },
    "styles":        [{ "url": "./orders.css",        "integrity": "sha384-…", "scope": "orders@18" }]
  },
  "contributions": {
    "releaseNotes": [{ "id": "orders.18-4", "version": "18.4", "date": "2026-09-01", "title": "Bulk approval", "to": "/orders?whatsnew=18.4" }],
    "actions":    [
      { "id": "orders.approve", "title": "Approve order", "icon": "<svg …>…</svg>", "shortcut": "Mod+Enter", "placement": ["palette", "page"], "description": "Approves the order currently on screen" },
      { "id": "orders.new", "title": "Create order", "icon": "<svg …>…</svg>", "to": "/orders/new", "shortcut": "Mod+N" },
      { "id": "orders.settings", "title": "Order defaults", "icon": "<svg …>…</svg>", "to": "/orders/settings", "permissions": ["orders-admins"], "placement": ["settings"] }
    ]
  },
  "definitions": {
    "pageEvents":   ["orders.preview-generated"],                                // scanned from emit()
    "storage":      [{ "id": "orders.draft", "version": 3 }],
  },
  "dependencies": {
    "widgets": [{ "id": "customer-card", "contract": 2 }],                   // scanned from <MfeWidget> usage
    "links": ["/customers/$customerId"],                                       // scanned from PlatformLink / navigate
    "permissions": ["orders-users", "orders-approvers"],                     // scanned from can() and action permissions
    "serverEvents": ["orders.updated"],                                       // scanned from subscribe()
  },
  "build": { "sdk": "1.4.0", "tailwind": "4.1.x", "commit": "a1b2c3d", "builtAt": "2026-09-11T10:00:00Z" }
}
```

Widgets replace the route fields with `contract`, `props`, and `events` as JSON Schema.

**Almost all of this is derived.** A developer authors `id` (or lets it default), `title`, `icon`, `basePath`, the contributions, and the definitions with schemas. `mfe build` fills in `version` (package.json), `protocol` and `capabilities` (SDK and imports), `owner` (CI), `paths` (route tables, plus authored `params`/`search` schemas), `dependencies` (detected usage plus explicit declarations, §18.3), `runtime`, `entries`, and `build`. An app is visible in the switcher when its `permissions` pass for the user (§27.3).

### 18.2 Contributions

Contributions are **data, not code**: static actions and release notes. `contributions.ts` is a TypeScript file for authoring convenience (types and autocomplete), but `mfe build` evaluates it at build time and emits the result into the manifest; nothing from it runs in the browser. Anything that needs live data — whether an action is enabled — is registered from a component while the app is mounted (§44.2). Consequences: the shell can build the switcher, palette, settings, and release notes for every app from manifests alone, with no per-app code to load at startup.

### 18.3 Dependencies the build cannot infer

`mfe build` detects literal widget ids, contract majors, cross-app path templates, permission ids, event ids, and capability imports in supported API calls and adapter templates. It also resolves same-module constants initialized with literal values. Arbitrary function execution, computed strings, and custom wrapper analysis are not promised. The build publishes the supported patterns in its diagnostics documentation.

When usage is hidden behind a wrapper or selected dynamically, the app or widget lists every possible dependency on its definition:

```ts
interface DependencyDeclarations {
  widgets?: Array<{ id: string; contract: number }>
  links?: string[]
  permissions?: string[]
  serverEvents?: string[]
  capabilities?: string[]                         // names only; SDK supplies the majors (§16)
}

createApp({
  title: 'Orders', basePath: '/orders', routeTree,
  dependencies: {
    widgets: [{ id: 'customer-card', contract: 2 }],
    links: ['/customers/$customerId'],
  },
})
```

The build unions and deduplicates detected and declared dependencies; declarations cannot remove detected usage. Widget dependencies are distinct `{ id, contract }` pairs; conflicting majors for the same widget id fail validation because a release provides one contract for that id. Catalog-backed ids and widget contracts receive the same validation whichever source supplied them. Capability names are converted to the manifest's `capabilities` map, with version numbers taken from the SDK; the other fields populate `dependencies`.

If the build encounters an unresolved dependency argument in a supported call and there is no explicit declaration for that kind, validation fails with its source location and a declaration example. A declaration for that kind is the author's assertion that it lists all possible targets. Completely opaque wrappers require explicit declarations even when no call site is detectable; their authors are responsible for documenting this requirement. Declarations do not redefine backend contracts or bypass compatibility checks. DevTools and `mfe inspect` distinguish detected from declared dependencies.

## 19. Registry and Releases

### 19.1 What the registry is

A small service with two jobs: store every published manifest, and record which version of each MFE is **live**. It does not decide rollouts, canaries, or approvals; those belong to your deployment pipeline. There is one registry per environment (dev, staging, production).

### 19.2 Pipeline interface

```text
POST /mfes                          body: { id, owner: { team, repo } }              ← `mfe init` claims an id (§8)
GET  /mfes · GET /mfes/{id}         ownership, live version, published versions       ← CLI, DevTools, portal
POST /mfes/{id}/versions            body: manifest + artifact URLs + certification    ← `mfe publish` from CI
GET  /mfes/{id}/versions/{version}  the stored manifest and its certification record  ← tooling
PUT  /mfes/{id}/live                body: { version }                                 ← the pipeline promotes (or rolls back) a version
GET  /release                                                                         ← the shell reads the current release list
```

**Certification.** `mfe validate --conformance` writes a record `{ suite, sdk, passed, report }` for the exact build; `mfe publish` uploads it with the manifest in the same CI job, and `PUT /live` requires `passed: true` for that version (§46). **Authentication.** Publish and promote authenticate with the CI workload identity (OIDC); claims and reads use developer SSO, and a claim is accepted only from a member of the owning team. Deprecation records (§49) and the dependency graph behind the portal (§50) are Phase 5 additions to this interface.

`PUT /live` is the only deployment lever. A rollback is the same call with the previous version. Withdrawing an app entirely (`{ version: null }`) makes the shell show it as unavailable. The registry rejects a `PUT /live` that would break compatibility: a protocol or capability major the shell does not provide, a permission or server event the catalogs do not know, a widget/consumer contract mismatch, a change to an existing widget id's contract major, withdrawal of a widget with live consumers, an identifier outside the MFE's ownership prefix, a route prefix that overlaps another live app, or `zone.js` in `runtime.shared`. It also requires the version to be certified (§46).

### 19.3 Releases

*Why:* a user opens the product at 9:00; at 10:00 a team deploys a new version; at 10:05 the user opens that app for the first time. Without care, the page mixes an hour-old shell with a brand-new app, or an old app fails to lazy-load a file the deploy deleted. The fix is simple: fetch the version list once and keep using it.

```ts
interface Release {
  id: string                                    // hash of the contents
  createdAt: string
  shell: string; protocol: number
  capabilities: Record<string, number>
  mfes: Record<string, Manifest>                // the full published manifest of each live version, entries included
  shared: Record<string, { version: string; url: string; integrity: string }>
  importMaps: ImportMap[]
}
```

Rules: the release inlines every live manifest, so one request gives the shell everything §18 needs (switcher, palette, Settings, release notes) and the release id hashes the manifests too. A page uses exactly one release for its lifetime, including its shell, capabilities, and widgets mounted later. All artifacts referenced by a release remain on the CDN for a configurable retention period (default 14 days). The shell checks for a newer release every 60 seconds; when one exists it shows a non-blocking "update available" prompt that reloads on the next navigation with no active blockers. A reload adopts the new release as a whole; the shell never mixes releases in an open page. If required pinned artifacts are no longer available, show a recovery screen with a reload action; reloading respects unsaved-change blockers. Do not silently substitute newer files. Withdrawn versions (`PUT /live { version: null }`) take effect at the next mount of that MFE. The shell caches the last release locally for registry outages while that release remains usable (§48).

## 20. Loading and Sharing Libraries

**One transport.** MFEs are plain ES modules loaded with `import()`; shared libraries resolve through import maps generated by the host from the release. Module Federation and Native Federation are **not used**, at build time or at runtime: their runtime version negotiation solves a problem the release model removes (one pinned version per framework, §17), MF2 is a webpack/Rspack technology that does not fit Angular's esbuild builder, and having two sharing mechanisms in one page produces duplicate framework copies. `mfe build` uses each framework's own bundler (Vite/Rolldown for React, the Angular application builder for Angular), marks shared libraries as externals, and emits the manifest and scoped CSS. The conformance suite fails a bundle that includes a federation runtime.

**Integrity.** Every entry, stylesheet, and shared library carries a subresource-integrity hash from the manifest; the host fails the instance on mismatch.

**Sequence for an app:** resolve from the release → preload shared libraries, entry, CSS → insert the scoped CSS link and wait for it (max 2 s) → `import()` and validate → `mount()`. The navigation coordinator MAY preload on link hover.

**Sharing policy.** Developers `import React from 'react'` or `import { Component } from '@angular/core'` as usual; the build decides:

```text
react, react-dom                                    shared per major (react-dom major = react major)
@angular/core, common, platform-browser, router, forms   shared per major (all @angular/* at one identical version within a major)
rxjs                                                shared
@platform/*                                         singleton — always the host's copy
@tecton/react                                       singleton per React major; bundles react-aria-components, @base-ui/react, sonner (§28)
@platform/styles                                    CSS loaded once by the shell; never in an MFE bundle
zone.js, @microsoft/signalr                         forbidden in MFE bundles (the shell owns them)
everything else                                     bundled into the MFE
```

**Shared per major, pinned per release.** MFEs live in separate repositories and will not all be on the same framework version, and they do not need to be. A release carries one exact version of each framework **major** that any live MFE uses (for example `react@18 → 18.3.1` and `react@19 → 19.2.0` at the same time). `mfe build` records the major an MFE was built against (from its `package.json`); the generated import map maps `react` to the current major globally and adds a **scope** per MFE that needs a different one:

```json
{ "imports": { "react": "/shared/react@19.2.0/index.js" },
  "scopes": { "/mfe/legacy-reports/": { "react": "/shared/react@18.3.1/index.js" } } }
```

Each MFE loads exactly one copy of its major; two majors never share a component tree because every app and widget has its own root (React) or application injector (Angular), so a React 18 widget inside a React 19 app simply works. Minor and patch versions are not per team: an MFE built against 19.1 runs on the release's 19.2, and `mfe validate` checks the framework's peer range. The platform team controls only **how many majors are alive** — current and previous, with a 180-day framework migration window before the oldest is dropped; the registry refuses to make a version live that needs a major the release does not carry, and compatibility CI (§53) warns owners well ahead. Each additional major costs one extra framework download, cached after first load; for Angular it also means a second platform injector, which is a reason to keep the Angular window tight.

Import maps are generated, never hand-written, and inserted before the first MFE module evaluates. If an MFE uses a Web Worker, the worker file MUST be a self-contained bundle (import maps do not apply inside workers).

## 21. Angular Without Zone.js

*Why:* Zone.js patches `Promise`, timers, `addEventListener`, and `fetch` for the entire page, changing how React, the shell, and other Angular apps schedule work, and two Angular apps would share one zone. It is incompatible with the rule that no MFE alters global behavior.

1. Angular MFEs MUST use Angular ≥ 21; the adapter adds `provideZonelessChangeDetection()` and the manifest declares `runtime.zoneless: true`.
2. `zone.js` MUST NOT appear in the bundle, `runtime.shared`, or polyfills. `mfe validate` scans for it and for the `Zone` global.
3. Change detection is driven by signals, `OnPush`, `AsyncPipe`, or explicit `markForCheck()`. The ESLint config in `@platform/angular` enforces `OnPush` and flags `NgZone`.
4. Each Angular app or widget instance creates its own `ApplicationRef` with `createApplication()` and mounts its root component into `ctx.element` with `createComponent()`; the adapter destroys it on unmount. `bootstrapApplication` is not used inside the shell.
5. One Angular platform (`platformBrowser()`) exists per Angular major per page, created lazily by the adapter.
6. Dev-mode globals (`ng`, `ngDevMode`) are set only in dev mode and tests.

`@platform/angular` provides `createApp({ basePath, angularRoutes, providers? })`, `createWidget({ …, component })`, DI tokens for `platform` and each capability, signal wrappers (`injectPlatform()`, `injectMountContext()`, `injectPermission(id)`), an `ErrorHandler` wired to `ctx.reportError`, and the router adapter (§24.3).

## 22. Dev Mode and the Test Host

**Provider parity.** The production shell, dev mode, and test host all compose providers through §16.1. Provider replacement does not alter an MFE's public capability API.

**There is no separate standalone host.** `runStandalone(app)` from `@platform/dev` starts the production shell package in dev mode: same experiences and capability implementations, with providers swapped by configuration (dev SSO; selectable permission profiles from `dev/profiles.json`; a dev registry with **local overrides** served by `mfe dev` using the same CSS transform and manifest extraction as production; real storage in a dev namespace; a scriptable mock for server events; console telemetry). Resolution order: local override → selected dev environment → shared fallback environment. Nobody runs the whole product locally.

**Test host.** `createTestHost()` from `@platform/testing` is a headless implementation of the protocol for Vitest/Jest/Playwright: it runs the lifecycle, records capability calls, injects failures (§50), and detects leaks. The conformance suite runs on it.

**Developing a widget.** `mfe dev` for a widget package opens the shell in dev mode on a **widget playground** page: the widget is mounted with sample props from `dev/props.json` (editable live), emitted events and page events are logged, and the widget can be switched between light/dark and narrow/wide using its single contract. To see the widget inside a real consumer, run that consumer's `mfe dev` with a local override pointing at the widget's dev server.

### 22.1 Test host API

```ts
import { createTestHost } from '@platform/testing'

const host = createTestHost({
  user?: { id, displayName },
  permissions?: string[],                          // groups
  config?: Record<string, unknown>,
  release?: Partial<Release>,                      // other MFEs' manifests the test needs (widgets, paths)
})

// lifecycle
const instance = await host.mount(definition, { url?: string; props?: unknown; contract?: number })
await host.settle()                                // waits for pending promises, effects, and event delivery
await instance.unmount()                           // test-only wait for cleanup; navigation never waits
host.state(instance)                               // 'loading' | 'ready' | 'failed' | 'unmounted'
host.leaks()                                       // resources still alive after unmount: [] when clean

// driving the shell side
host.navigation.navigate({ to, params, search })
host.navigation.back()
host.serverEvents.emit({ event, params, payload })
host.pageEvents.emit({ event, payload })
host.permissions.set([...]); host.config.set({ ... }); host.theme.set('dark')
host.inject({ kind: 'server-events-disconnect' | 'registry-outage' | 'api-timeout' | 'offline' | 'storage-quota-exceeded'
                    | 'permission-denied' | 'session-expired' | 'release-superseded' | 'version-withdrawn' })

// observing what the MFE did
host.actions.registered()                          // [{ id, registrationId, instanceId, target?, confirmation?, enabled, pending, disabledReason }]
host.actions.state({ id: 'orders.approve', registrationId? }) // 'enabled' | 'pending' | { status: 'disabled', reason } | 'absent' | 'target-required'
await host.actions.run({ id: 'orders.approve', registrationId?, confirm? }) // ActionRunResult; same pipeline; confirmations auto-accepted unless confirm: false
host.actions.focus({ instanceId })                // set MFE focus; omit instanceId to clear
host.actions.captureTarget({ id })                // pin as shell UI would; returns { run, release }, or target-required
host.actions.confirmations()                       // recorded { id, registrationId, target?, content, outcome }; test defaults may auto-accept
host.page.get()                                    // title, focusTarget
host.http.calls()                               // [{ url, method, headers, body }]
host.http.mock(url | matcher, response)
host.storage.dump()                                // all keys the MFE wrote, by definition
host.serverEvents.subscriptions()                  // active topics + params
host.pageEvents.log()                              // emitted page events
host.telemetry.records()
host.notifications.log()                           // toasts and published notifications
host.surfaces.open()                               // currently open dialogs/drawers, with their content descriptors
host.blockers.active()                             // whether navigation is currently blocked
```

The test host runs the same lifecycle state machine and the same validation as the production shell; it substitutes in-memory implementations for storage, HTTP, server events, and surfaces.

**Parity.** Production shell, dev mode, and test host of the same SDK version implement the same protocol and capability majors; the SDK release pipeline runs the conformance suite against all three.

---

# Part III — Navigation, Header, Widgets, and Styles

## 23. How Navigation Works (Core)

*Why the platform is involved at all:* there is one address bar and one Back button, shared by every app. Each app's router is fully in charge *inside its own prefix*, but it cannot know that `/customers/123` belongs to another team's app. Something has to know that, hand off between apps, and stop two routers from both writing to `window.history`. That something is the platform — an API gateway for URLs. Like nginx routing `/orders/*` to one service and `/customers/*` to another, it never looks inside an app's routes.

The platform does exactly three things:

1. **Decides which app owns the current URL** (from `basePath` in the manifests) and mounts it.
2. **Hands off between apps.** When Orders links to a customer, the platform cancels and detaches Orders, starts Customers without awaiting Orders cleanup, and lets the Customers router take over.
3. **Is the only thing that touches `window.history`.** Each app's router talks to it through a thin adapter (§24).

Inside an app, nothing changes: nested routes, guards, resolvers, lazy children, and layouts are the app's own.

**Prefix ownership.** An app owns its exact `basePath` and every descendant path, matched at a path-segment boundary: `/orders` owns `/orders` and `/orders/123`, but not `/orders-old`. Once a prefix matches, the shell mounts that app (subject to app-level permissions and availability); the MFE owns route matching, internal redirects, and its not-found page.

**Route listing.** `paths` advertises public routes for typed cross-app links, compatibility checks, and the DevTools product map. It is not a complete route table or a runtime allowlist. `mfe build` extracts static paths when possible; authors declare public paths it cannot extract. Internal routes need not be listed. The shell MUST NOT reject a URL under an owned prefix because it is absent from `paths`.

### 23.1 Ownership

| Platform | App's router |
|---|---|
| Which app owns which prefix | Everything under the prefix |
| Navigation between apps | Navigation within the app |
| `window.history`, Back/Forward, `history.state` | — (through the bridge) |
| Blockers when *leaving* an app | Blockers between the app's own routes (bridged) |
| — | Redirects and not-found pages under the app prefix |
| Scroll position across app boundaries | Scroll inside the app |
| Focus and screen-reader announcement after a cross-app navigation | Focus inside the app |
| Preloading, progress bar, navigation timing | — |

### 23.2 A cross-app navigation, step by step

1. **Requested.** A path (with params) or URL, with `{ replace?, state? }`. History is not touched yet.
2. **Blockers.** Every active blocker (§26) is asked; if one blocks, the navigation pauses until `proceed()` or `reset()`. The current app's router has seen nothing yet.
3. **Resolve.** The target app is resolved from the release by prefix; the shell does not match internal routes.
4. **Leave.** Save the current app's scroll position in the history entry, then cancel and detach it (§14). Its cleanup cannot delay the remaining steps.
5. **Commit.** `pushState`/`replaceState` with `history.state = { __platform: { txId, scroll, appId }, [appId]: <the app router's own state> }`.
6. **Enter.** The shell shows the progress bar (§31.2), loads and mounts the target app. Its router handles the path, including internal redirects or an app-owned not-found page. If loading or mounting fails, the URL stays and the shell shows its error page (§31.1).
7. **Settle.** `ready` resolves; focus moves to the page heading (or `page.focusTarget`); the route is announced to assistive technology; timing is recorded.

Within-app navigation skips 3–7: the app's router asks the bridge to change the URL, blockers run, history is committed, and the app's router is told.

### 23.3 Back/Forward, scroll, links

`popstate` is handled only by the platform: it reads the namespaced state, decides within-app or cross-app, runs blockers (undoing the browser's URL change with `history.go(±1)` while blocked), and dispatches. `history.scrollRestoration` is `manual`; the platform restores document scroll for cross-app Back/Forward. `<PlatformLink>` (React) and `[platformLink]` (Angular) render correct hrefs; a raw `<a href>` outside the app's prefix is intercepted by a document-level click handler. Cross-app navigations are wrapped in `document.startViewTransition()` when supported.

## 24. Router Adapters and the Bridge (Core)

```ts
interface RouterBridge {
  current(): URL
  onNavigate(listener: (url: URL, info: { replace: boolean; state: unknown }) => void): () => void
  navigate(url: URL, options?: { replace?: boolean; state?: unknown }): Promise<'committed' | 'cancelled'>
  registerBlocker(blocker: NavigationBlocker): () => void
  restoreScroll(): { x: number; y: number } | undefined
}
```

**Every adapter:** sets the router's base path from `ctx.basePath`; replaces the router's history implementation so every push/replace goes through `bridge.navigate` and every external change arrives via `bridge.onNavigate`; wires the framework's blocker API to `registerBlocker`; uses `bridge.restoreScroll` for the router's scroll hook; applies the app's declared `redirects` within its prefix before normal route matching, requesting history replacement through the bridge.

**React Router / TanStack Router (§24.2).** The adapter creates the router from the `routeTree` (TanStack) or `routerRoutes` (React Router) the app passes to `@platform/react`'s `createApp`, with a platform `history` implementing `push`, `replace`, `go`, `listen`, `createHref` over the bridge and `basepath`/`basename` from the context; `useBlocker` is wired to `registerBlocker`. Apps never construct the router or touch the bridge.

**Angular Router, zoneless (§24.3).** The adapter bootstraps from the `angularRoutes` the app passes to `@platform/angular`'s `createApp`, adding `provideZonelessChangeDetection()`, `provideRouter(angularRoutes, withDisabledInitialNavigation())`, `APP_BASE_HREF` set to the base path, and a `PlatformLocationStrategy` over the bridge; the app's own `providers` are appended. The adapter calls `router.initialNavigation()` after bootstrap. `CanDeactivate` guards are bridged by a wrapping guard that consults the platform blocker registry. Router events are consumed as signals.

## 25. Linking Between Apps (Core)

*Why:* paths are the contract. An app lists the paths it serves in its manifest (`paths`); other apps link to those paths, and `mfe types` turns the list into types so links are checked at build time — the same way TanStack Router types its own `<Link to>`.

```tsx
<PlatformLink to="/customers/$customerId" params={{ customerId }} search={{ tab: 'orders' }} />
await platform.navigation.navigate({ to: '/customers/$customerId', params: { customerId: '123' }, search: { tab: 'orders' } })   // Promise<'committed' | 'cancelled'>
const href = platform.navigation.href({ to: '/customers/$customerId', params: { customerId: '123' } })
```

Rules:

- Public paths offered for typed cross-app links MUST be listed in the owning app's `paths` (with `params` and `search` schemas when applicable). Declared paths are relative to `basePath`; `mfe build` joins them, so `Register.paths`, `dependencies.links`, and every `to` are absolute (`/orders/$orderId`). Plain URLs and unlisted paths are handed to the owning app at runtime; listing does not determine whether a page exists. The registry warns when a recorded cross-app link names an undeclared path, but that warning does not create a shell 404.
- **Renaming a path is a redirect, not a break.** The owning app declares paths relative to its base prefix, for example `redirects: { '/legacy/$id': '/$id' }` under `/orders`. Its adapter applies these redirects within the MFE's router, through the history bridge, so old links, bookmarks, and emails keep working. Both sides stay under the owning prefix. The manifest records the redirects for link compatibility checks; it does not give the shell authority over internal routes. Removing a path follows deprecation (§49).
- `navigate` resolves with `'committed'` once history is written and `'cancelled'` when a blocker keeps the user on the page or a newer navigation supersedes it; the same values the bridge returns (§24). A load or mount failure of the target is not a navigation failure: the URL is committed and the shell shows its error page (§31.1).
- Backends link with plain paths (`"link": "/orders/123"` in a notification). Paths are relative to the product origin; services never hardcode a host name.
- The consumer's build records cross-app path templates in `dependencies.links`, combining detection and explicit declarations (§18.3), so the registry can show who links where and flag a rename that lacks a redirect.

## 26. Navigation Blocking (Core)

```ts
interface NavigationBlocker {
  shouldBlock(tx: { current: URL; next: URL; kind: 'within-app' | 'cross-app' | 'unload' }): boolean | Promise<boolean>
  prompt?(tx: BlockedTransaction): Promise<'proceed' | 'stay'>    // default: the shell's "unsaved changes" dialog
}
const handle = platform.navigation.block({ shouldBlock, prompt, signal: ctx.signal })
handle.status; handle.proceed(); handle.reset(); handle.release()
```

Blockers run before any URL change. For tab close, the platform registers `beforeunload` only while a blocker currently returns true (the adapter re-evaluates blockers when form state changes). Apps register blockers for their own unsaved state; storage does not register blockers.

## 27. Header, Page Metadata, and App Switcher (Stable — header v1)

*Why:* the shell owns one strip of the screen — the **header bar** — and nothing else. Everything below it is rendered by the mounted app, including the app's own navigation. This keeps the shell small and lets each app lay out its area however it likes.

### 27.1 What the shell renders

The header bar: the app switcher, the current page title, page-header actions (`placement` includes `'page'`, §44), the command palette trigger, notifications, help, settings, release notes, and the user menu. The shell also owns the overlay layer (§28), the progress bar (§31.2), and the error pages (§31.1). It is always visible; there is no fullscreen or alternate layout mode. It renders **no** sidebar, menu tree, or breadcrumbs. Apps that want a sidebar use the UI kit's `Sidebar` component (or their own); it lives in the app's area and is the app's routing concern.

**The Help menu.** Shell-owned entries are build-time options of the shell (§16.2): the keyboard-shortcut sheet (generated from manifests) and a product-docs link. Below them the shell lists every action whose `placement` includes `'help'` (§44) and that is currently available: the mounted app's static `to` help actions, plus any live help actions registered by the page on screen. There is no platform help content, article format, or knowledge base; a help action opens a URL or runs app code (typically a help drawer the app renders itself — see the usage examples).

**Onboarding tours are not a platform feature.** A tour is a UI component: `<Tour id="orders.getting-started" steps={[{ target: '[data-testid="orders.navigation"]', title, content }]} />` in `@tecton/react` / `@tecton/angular`. It finds targets by selector and stores completion in a localStorage-backed key/value store (`persist: true`, §35); completion is local to this browser. A product-wide welcome tour is the shell using the same component.

### 27.2 Page metadata

```ts
interface PageController { set(meta: Partial<PageMeta>): void; get(): PageMeta }
interface PageMeta {
  title: string                  // document title and the header's page title
  focusTarget?: string           // a data-testid to focus after navigation; default: the app's first heading
}
```

The header bar is always present. An app that needs the whole screen (an editor, a board) uses the browser's Fullscreen API on its own element; the platform is not involved.

The shell renders the document title (`${title} · ${product}`), focus after navigation, and route announcements. Apps never touch shell DOM.

### 27.3 App switcher

*Why:* users need one place to see and open every app they have access to, and apps should not each build a launcher.

The switcher (grid or list, in the header) is built from the release: every app whose `permissions` pass for the current user, showing the `title`, `icon`, and `description` from `createApp`, in alphabetical order by title, with the user's favorites and recents on top. Opening an entry navigates to the app's `basePath`. An app whose rules fail does not appear and, if reached by URL, shows the shell's 403 page (§31.1). They are evaluated by the shell; no app code runs. It is re-evaluated when any of those change.

### 27.4 Settings and release notes

These are the only two shell pages that list app-provided entries. A settings entry is a static `to` action placed in `'settings'`; a release note is its own contribution because it is content (a date and a body), not something to run. Both are evaluated at build time into the manifest:

```ts
createAction({ id: 'settings', title: 'Order defaults', icon: Settings, to: '/orders/settings', permissions: ['orders-admins'], placement: ['settings'] })
createReleaseNote({ id: '18-4', version: '18.4', date: '2026-09-01', title: 'Bulk approval', body: '…', to: '/orders?whatsnew=18.4', audience?: { permissions?: Requirement } })
```

**Settings.** The shell's Settings page holds the shell's own settings (theme, keyboard shortcuts, notification preferences, profile) and, below them, every action placed in `'settings'` whose `permissions` pass, grouped by app in manifest order. An app may declare several; the app renders each settings screen itself as one of its routes.

**Release notes.** The shell's "What's new" aggregates notes across apps, ordered by date, with per-user read state (server-backed). A note is shown only once the version that carries it is live (the registry knows), and is hidden if that version is withdrawn. Notes may carry `audience: { permissions: Requirement }`, evaluated like any static requirement (§33). Because notes ship with the code, a wording change is a redeploy; teams that want product people to edit copy without touching TypeScript can keep notes in a `RELEASE_NOTES.md` that the build reads into the same contribution.

## 28. Surfaces (Stable — surfaces v1)

*Why:* dialogs, drawers, popovers, and toasts on a shared page must stack correctly across MFEs, carry the right CSS scope, pause keyboard shortcuts while a modal is open, and disappear when whatever opened them unmounts. Everything else an overlay needs — trapping and restoring focus, Escape, scroll lock, hiding the rest of the page from assistive technology — the UI kit's primitives already do, and the platform does not do it a second time.

### 28.1 Overlay containers (platform)

```ts
const surface = platform.surfaces.open({
  kind: 'modal' | 'nonmodal',          // modal: the container is marked aria-modal, which suspends platform shortcuts (§44)
  signal?: AbortSignal,                // default: the instance signal — the container is removed if the opener unmounts
})
surface.container                      // a child of ctx.overlayRoot: the MFE's CSS scope applies (§30.5); appended after everything already open
surface.close()                        // removes the container; idempotent
```

That is the entire platform API. The shell guarantees: the container sits in the overlay layer above the page content; the MFE's CSS scope applies to whatever is rendered into it; platform shortcuts are suspended while any element in the overlay layer has `aria-modal="true"` (Tecton's dialogs set it; a modal raw surface receives it from the platform); the container is removed when its signal aborts. The platform renders nothing into it and manages no focus.

**Stacking is mount order, then open order.** Each instance's overlay root sits in the shell's overlay layer in mount order, and containers inside it in open order. An app mounts before its widgets, so a widget overlay opened from inside an app dialog stacks above the dialog. The one order this cannot express — an earlier-mounted instance opening a modal over a later-mounted instance's already-open overlay — needs a programmatic open while the user holds another overlay open and is accepted for v1. Page `z-index` values do not reach the overlay layer.

**One UI kit copy.** Focus trapping, Escape routing, and `aria-hidden` on the rest of the page come from React Aria's overlay stack inside `@tecton/react`. That works across an app and its widgets only if every MFE runs the same copy, so `@tecton/react` is an import-map singleton (§20), and MFEs MUST NOT bundle `react-aria-components`, `@base-ui/react`, or `sonner` themselves (§47).

### 28.2 Three ways to put content on a surface

| Level | Use | Provided | Yours |
|---|---|---|---|
| **Tecton components** — `Dialog`, `Sheet`, `AlertDialog`, `Popover`, `Tooltip` from `@tecton/react` | The default; any children, `header: false` for an empty frame | Look, focus, Escape, scroll lock, stacking, close-on-unmount, accessibility | The content |
| **React Aria primitives with your markup** — `ModalOverlay`, `Modal`, `Dialog`, `Popover` re-exported from `@tecton/react/primitives` | An overlay that looks nothing like Tecton's | Focus, Escape, scroll lock, stacking, close-on-unmount | Every pixel, including the close affordance |
| **Raw container** — `platform.surfaces.open` / `useSurface` / `injectSurface` | Custom HTML, a canvas, a third-party widget, a non-modal overlay | Stacking, CSS scope, shortcut suspension, close-on-unmount | Focus management, Escape, and accessibility; `mfe validate` warns on a modal raw surface without a `role="dialog"` element |

All three render inside the MFE's own React tree through a portal, so providers, the query client, and hooks work as they do anywhere else: the React adapter wraps each MFE root in React Aria's portal provider pointing at `ctx.overlayRoot`, and the raw level portals into `surface.container` itself. Content is not restricted: JSX, custom elements, and HTML strings are all allowed. An HTML string that did not originate in the app's own code MUST be sanitized by the app before insertion (the platform sanitizes only icons), and inline scripts and styles remain forbidden by CSP (§45). Tecton names the side panel `Sheet`; where this document says drawer it means that component. Promise-based `useDialog` / `useSheet` wrappers and `injectDialog` / `injectDialogRef` are UI-kit conveniences built on the declarative components, not platform API.

Widgets from other teams are shown in a dialog the same way as any content: `<Dialog …><MfeWidget id="customer-card" contract={2} props={…} /></Dialog>`.

### 28.3 Toasts and confirmations

The shell renders the one toast region and the action confirmation dialog, because both must outlive or sit above the app's own tree. Each has the same escape hatch: the shell keeps the frame, position, timing, buttons, and result, and the app renders arbitrary content into an element inside it — `custom(element, controls)` in core, `content` as JSX in the React adapter (§39, §44.2.2). Custom content is rendered by the opener's own React root, so it is torn down when that instance unmounts; a plain-text toast survives navigation, a custom one does not.

## 29. Widgets (Core)

*Why:* a widget is how one team's UI appears inside another team's page without either knowing the other's framework, repo, or release schedule.

### 29.1 Mounting

```ts
const handle = await platform.widgets.mount({
  id: 'customer-card',
  contract: 2,                                    // REQUIRED: the contract major this consumer was written against
  element,
  props: { customerId: customer.id },
  on: { selected: e => select(e.customerId) },
  signal: ctx.signal,
  fallback?: 'skeleton' | 'hidden' | ((error) => void),
})
handle.status                                      // Observer<'loading' | 'ready' | 'failed' | 'unmounted'>; handle.error
handle.update(nextProps)                           // synchronous, returns void; whole props object
handle.unmount()
```

React: `<MfeWidget id="customer-card" contract={2} props={…} on={{ selected }} />`. Angular: `<mfe-widget id="customer-card" [contract]="2" [props]="…" (selected)="…" />`.

### 29.2 Contracts

The consumer's build records `{ id, contract }` in `dependencies.widgets`. Each widget id has one implementation and one contract per release (§17). The requested major MUST equal the widget's declared major; the registry checks both widget and consumer promotions. Runtime mismatches fail with `core/incompatible` before mounting. Breaking redesigns use new ids, allowing gradual migration without multiple contracts behind one id. If a consumer needs to trigger behavior such as refresh or focus, it changes a prop; there is no separate command channel.

### 29.3 Events

Widgets emit contract events with `ctx.emit({ event, payload })`; payloads are validated; invalid events are dropped and reported. Events go to the consumer only and do not bubble. The consumer normally coordinates siblings by receiving an event and updating their props. Use page events only for loose notifications that do not fit that relationship (§38).

### 29.4 Nesting

Widgets may mount widgets. Mounting an ancestor inside its own subtree is rejected (`widgets/cycle`); the registry rejects static cycles.

### 29.5 Widget state and the URL

A widget has no URL of its own. State that should be shareable or survive Back (a selected tab, a page number) is a **prop in, an event out**: the consumer app reads it from its own search params, passes it as a prop, listens for the widget's change event, and writes the new value back to its URL with its own router. The widget stays a pure function of its props and works the same inside a dialog, where there is no URL to write. A widget that needs real sub-pages with a title and breadcrumbs is an app.

## 30. Styles (Core)

*Why:* every MFE ships Tailwind utilities like `.flex`; without isolation the last-loaded CSS wins everywhere.

**30.1 Layers, declared once.** Platform styles load first and fix the order: `@layer platform.reset, platform.tokens, platform.base, mfe.theme, mfe.base, mfe.components, mfe.utilities, mfe.overrides;`. `mfe build` maps Tailwind's layers onto `mfe.*`, so load order cannot change the cascade.

**30.2 One Preflight.** Tailwind's reset ships once in `@platform/styles`; MFE builds strip it. Tailwind is pinned per SDK major (currently `4.1.x`).

**30.3 Scoping.** MFE CSS is wrapped in `@scope ([data-mfe-scope="orders@18"]) to ([data-mfe-scope]) { … }`, so it applies only inside that MFE and stops at nested MFE boundaries. The host sets `data-mfe-scope` on `ctx.element` and `ctx.overlayRoot`. `mfe dev` applies the same transform. Developers write plain `className="flex gap-4 bg-background"`.

**30.4 Tokens.** Theme tokens are Tecton's shadcn CSS variables on `:root` (`--background`, `--primary`, `--border`, …), generated from the Tecton token map and exposed to Tailwind through Tecton's `@theme` as `--color-*`, so `bg-background` resolves to `var(--color-background)`. `@platform/styles` loads them once; MFE builds use the same `@theme` without re-emitting the variables. An MFE MUST NOT redefine a theme variable; custom properties an MFE defines carry its id as a prefix (`--orders-*`), and `mfe validate` flags both.

**30.5 Overlay roots.** Dropdowns, tooltips, and dialogs render outside the MFE's element. Each instance gets `ctx.overlayRoot`, an element in the shell's overlay layer carrying the MFE's scope; the React adapter points React Aria's portal provider at it, and the Angular adapter Angular CDK's `OverlayContainer`.

**30.6 Global names.** `mfe build` namespaces `@keyframes`, `@property`, timeline names, `view-transition-name`, `@font-face` families, and `@container` names with the scope token.


## 31. Shell-Owned Pages and Behaviors (Core)

### 31.1 Error and status pages

The shell owns these pages so every app fails the same way:

| Situation | Page | Trigger |
|---|---|---|
| Session gone | **Sign in again** (preserves the intended URL) | `platform.identity` transitions to `null`, or a platform request returns 401 |
| No access to this app | **403** with "request access" and a link to the app switcher | The app's `permissions` fail and the URL was entered directly |
| No owning app | **404** with recent pages | No app owns the URL prefix |
| App failed to load or mount | **Something went wrong** with retry and "report a problem" | Lifecycle `failed` (§13) |
| Maintenance | **Maintenance** banner or full page | The platform operator turns on maintenance mode from the control plane |

Apps render their own errors *inside* their content area, including unknown routes anywhere under their prefix, missing records, and form validation errors. The shell handles missing app prefixes, app-level access/session failures, and load or mount failures. It never uses `paths` to decide whether an internal route exists.

### 31.2 Progress indicator

The shell shows a thin progress bar at the top of the viewport from the moment a cross-app navigation is requested until the target app's `ready` resolves, and while a widget that declared `fallback: 'skeleton'` is loading. Apps MUST NOT show a full-page spinner of their own during mount; they render a skeleton inside their content area if they need one.

### 31.3 Responsive behavior

The shell and every app MUST work down to **360 px** wide. Below **1024 px** the header moves page actions into an overflow menu and the overlay layer renders drawers full-width; navigation inside an app is the app's responsibility (the UI kit's `Sidebar` collapses to a drawer on its own). Apps use the Tecton theme's breakpoints through the Tailwind preset's screens. The conformance suite renders each MFE at 360 px and 1280 px and fails on horizontal overflow or hidden primary actions.

---

# Part IV — Platform Capabilities

Each capability is `platform.<id>`, versioned on its own, with a detailed spec under `specs/capabilities/`. Every asynchronous method takes `{ signal? }` as its last option and defaults to the instance's signal.

## 32. Identity and Session (Stable — identity v1)

```ts
interface UserSnapshot { id: string; displayName: string; email: string }              // never tokens
interface IdentitySnapshot { user: UserSnapshot; expiresAt?: string }                  // ISO timestamp when the provider knows it
platform.identity: Observer<IdentitySnapshot | null>                                   // get() / subscribe(listener, { signal? }) (§9.3)
platform.identity.login(); platform.identity.logout()
```

There are no named identity events. Session expiry is the transition to `null`; a user change is a snapshot whose `user.id` differs; the expiry warning is shell UI driven by `expiresAt`. An MFE that needs to react to any of these observes the snapshot. MFEs never receive raw tokens; authenticated calls go through `platform.http` (§36) or the cookie session. Session expiry is coordinated across tabs by the shell and leads to the sign-in-again page (§31.1). Account switching and step-up authentication are not part of this version.

**Ending a session.** Explicit logout uses the existing unsaved-change confirmation before ending the session; expiry cannot wait for approval. Once the session ends, the shell immediately prevents new authenticated work, clears identity and permission snapshots, and cancels and disposes mounted apps, widgets, dialogs, actions, requests, and subscriptions through §14. It clears shared user state and shows sign-in without waiting for app cleanup. Ending a browser request does not undo a server operation already submitted.

Apps own their memory caches and saved drafts. They release caches through normal instance/component disposal and choose when to delete drafts through the existing user-and-app-scoped storage API; logout does not automatically erase saved drafts. A later sign-in creates fresh instance-scoped platform clients and mounts fresh apps, even for the same user. Old clients and late callbacks cannot attach to that new session. There is no cache-management API or configurable logout cleanup pipeline.

## 33. Permissions (Stable — permissions v1)

```ts
platform.permissions.can('orders-approvers'): boolean                    // snapshot read; cached, sync, UI only
platform.permissions.observe('orders-approvers'): Observer<boolean>      // typed via Register
platform.permissions.subscribe(listener, options?)                       // existing aggregate subscription: listener(groups: readonly string[])
```

`can(id)` and `observe(id).get()` return the same boolean. `observe(id)` notifies only when that boolean changes, under §9.3. The existing aggregate `subscribe` remains available: it receives an immutable, sorted group-name array when group membership changes, with no initial emission, idempotent cleanup, and the same signal/lifetime rules. Session groups remain fixed until a new sign-in; adding observation does not change the authorization policy. `usePermission(id)` and `injectPermission(id)` wrap the keyed observer.

**Static requirements are data.** Wherever a definition takes `permissions` (apps, actions), the value is a `Requirement`: `string[]` means every listed id is required; `{ any: string[] }` means at least one. The shell evaluates these from the manifest alone, before any app code loads, so they can gate the app switcher, the Settings page, palette entries, and the 403 page. They are never functions. **Anything more elaborate is code in the app**: `enabled` on a live action, a guard in the app's own router, or `can()` inside a component, all of which run after load with the app's data in hand.

**A permission is an Authentik group.** The identity provider (Authentik) puts the user's groups in the session's `groups` claim; `can(id)` is true when `id` is one of them. There is no separate permission catalog and no mapping layer: the group list *is* the catalog. `mfe types` pulls the group names from Authentik's API so they are autocompleted and typed via `Register`, and `mfe validate` fails on a name Authentik does not know. Groups are named for what they allow (`orders-approvers`, not `team-b`), and a group that gates a UI element gates the matching API. **Frontend authorization controls UX; backend authorization is the security boundary**: every .NET endpoint checks the same `groups` claim. Resource-level rules ("only the order's owner") are not groups; the backend enforces them and the UI reflects them through `enabled` on a live action. Unknown groups return `false` and are reported.

**No entitlements, no feature flags.** One installation means "is this module licensed" is whether the app is in the release. A rollout to some users before everyone is a group (`permissions: ['reports-v2-beta']`, deleted when the feature is for everyone); an installation-wide switch is a `platform.config` value. If a flag service is adopted later, `flags` returns as one more `Requirement` field. Entitlement = this installation is licensed for the module; permission = this user may act; flag = rollout state.

## 34. Configuration and Settings (Stable — config v1)

Configuration is runtime-controlled, read-only, and environment-scoped. Keys and types come from the control plane's catalog via `mfe types`; the frontend does not declare them.

```ts
platform.config.get('orders.maxExportRows'): number                   // snapshot read, unchanged
platform.config.observe('orders.maxExportRows'): Observer<number>     // additive reactive API
```

`get(key)` equals `observe(key).get()`. A host-accepted config refresh updates the cache and notifies only changed keys under §9.3; observing does not trigger a fetch. Required config values are validated and loaded before mounting dependent MFEs. An unknown key raises `core/invalid-input`; an unavailable required initial value blocks mounting with `core/unavailable` rather than returning an untyped placeholder. Invalid later values retain the last valid snapshot and are reported. `useConfig(key)` and `injectConfig(key)` wrap the keyed observer and update when its value changes.

User preferences use a key/value store with `persist: true` (§35), retained in localStorage on this browser. Preferences that must follow a user across devices require a backend API outside this storage capability.
**Settings** is shell-owned as a page of platform preferences plus the actions apps place in `'settings'` (§27.4). An app's settings screen is one of its own routes; there is no settings-widget concept.

## 35. Storage (Stable — storage v2)

Key/value storage backed only by **sessionStorage** or **localStorage**. `persist: false` (the default) selects sessionStorage for the current tab session; `persist: true` selects localStorage for persistence across browser sessions on the same browser profile and origin. There is no IndexedDB backend, structured collection API, indexing, or device synchronization. Values must be JSON-serializable and conform to the definition's schema.

```ts
const orderDraft = createStorage({
  id: 'draft',                                   // prefixed by the build: orders.draft
  schema: OrderDraftSchema,
  version: 3,
  migrations: { 1: v1 => …, 2: v2 => … },       // run lazily on read
  persist: true,                                 // localStorage; false (default) = sessionStorage
  ttl?: number,                                  // ms; entries older than this are dropped on read
})
const store = platform.storage.open(orderDraft)
await store.get(k); await store.set(k, v); await store.delete(k); await store.keys(); await store.clear()
store.subscribe(k | '*', listener)              // same-page writes; localStorage also receives changes from other same-origin tabs
```

Storage is always per user and per MFE; keys are namespaced `${userId}/${mfeId}/${storageId}/${key}`, and the implementation version is not part of the key. There is no cross-MFE storage: data two MFEs both need lives behind an API. Errors: `storage/quota-exceeded`, `storage/migration-failed`, `storage/unavailable`.

**Saving is explicit.** The capability provides key/value operations only; it does not observe forms, schedule autosaves, flush on visibility changes, offer `recover` or `discard` methods, or register navigation blockers. An app that needs drafts uses `set`, `get`, and `delete`, and owns when to save, whether to offer restoration, and how to guard unsaved changes with §26.

## 36. HTTP (Stable — http v1)

The host provides one instance-scoped `platform.http` with two interfaces: Fetch-compatible transport and convenient JSON methods. Both share session handling, CSRF protection, trace/correlation metadata, and lifecycle cancellation. There is no separate client factory or required HTTP hook. This draft renames `network` to `http`, including the capability id in manifests; no `network` alias is part of the draft API.

### 36.1 Fetch-compatible transport

```ts
interface HttpClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  get<T = unknown>(url: string | URL, options?: HttpReadOptions): Promise<T | null>
  post<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
  put<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
  patch<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
  delete<T = unknown>(url: string | URL, options?: HttpWriteOptions): Promise<T | null>
}

type HttpReadOptions = Omit<RequestInit, 'method' | 'body'>
type HttpWriteOptions = Omit<RequestInit, 'method' | 'body'> & (
  | { json?: unknown; body?: never }
  | { body?: BodyInit | null; json?: never }
)
```

`http.fetch(input, init)` accepts the native Fetch inputs, preserves normal `Request`/`RequestInit` precedence, and returns an unconsumed `Response`, including for non-2xx HTTP statuses. Transport failures and aborts reject with native Fetch-compatible errors. It does not parse bodies, translate HTTP statuses into application errors, or patch global `fetch`. Its function is bound to its MFE client and may be passed directly to another client that accepts a Fetch implementation.

The effective caller signal is combined with the MFE's lifetime signal; providing a signal cannot keep a request alive after unmount. Cancellation also applies while consuming the body. There is no implicit HTTP retry, application response cache, or hidden request timeout; apps can supply an `AbortSignal` with their chosen timeout. Session expiry is reported to the shell, but the original response is still returned; the wrapper does not replay a business request after authentication changes.

The browser carries the configured HttpOnly session cookie. MFEs receive no raw session/access/refresh tokens, and there is no public credential-header getter. The host attaches CSRF and other sensitive platform metadata only to approved API destinations and applies its destination policy to redirects. Requests outside that policy receive no platform credentials or sensitive metadata; protected requests must not forward those values across an unapproved redirect. App headers and Fetch options cannot bypass the host's credential-destination policy. These controls reduce accidental credential exposure; they are not runtime isolation between trusted MFEs.

### 36.2 Convenience methods

```ts
const response = await platform.http.fetch('/api/orders/123', { signal })
if (!response.ok) { /* app handles the HTTP status */ }
const order = await platform.http.get<Order>('/api/orders/123', { signal })
await platform.http.post('/api/orders/123/approve', {
  json: { comment: 'Approved' }, signal,
})
```

Convenience methods set their HTTP verb and call the same transport. `json` serializes the supplied value and supplies `Content-Type: application/json` unless the caller already set it; `body` sends a native Fetch body such as `FormData`. `json` and `body` are mutually exclusive; supplying both rejects with `core/invalid-input` before sending. Requests default `Accept` to `application/json` unless supplied. No body is accepted by `get`.

Successful non-empty responses are parsed as JSON. A 204/205 or an empty successful body returns `null`, hence `Promise<T | null>`; callers using an endpoint that guarantees a record may explicitly reject a missing record. Invalid non-empty JSON rejects with `SyntaxError`. `<T>` is a TypeScript assertion, not runtime validation; apps can validate the returned data themselves. Use `fetch` for text, binary, streaming, or custom response handling.

```ts
class HttpError extends PlatformError {
  code: 'http/status'
  status: number
  response: Response
}
```

Non-2xx responses reject with `HttpError`, preserving an unconsumed response for the app to inspect. The helper does not guess business error formats, display a toast, retry, or invalidate a cache. `retryable` is advisory, never an instruction to repeat a request. Network failures and aborts preserve the transport's error semantics.

### 36.3 React and other clients

Apps keep their own `QueryClient`, query keys, retry policies, cache settings, mutation variables, and invalidation. Query keys are not URLs and mutation metadata is not interpreted as a request. There are no platform query/mutation factories or HTTP hooks to learn:

```tsx
const platform = usePlatform()
const order = useQuery({
  queryKey: ['orders', orderId],
  queryFn: ({ signal }) => platform.http.get<Order>(`/api/orders/${encodeURIComponent(orderId)}`, { signal }),
})
const approve = useMutation({
  mutationFn: (input: { orderId: string; comment: string }) =>
    platform.http.post(`/api/orders/${encodeURIComponent(input.orderId)}/approve`, { json: { comment: input.comment } }),
})
```

The app may pass an explicit signal in mutation variables when it needs cancellation; the platform does not assume TanStack mutations supply a query-style cancellation signal. A third-party client such as Ky may use `platform.http.fetch` as its transport. Such clients are optional app dependencies; choose one retry owner to avoid multiplying attempts.

**Angular.** Components/services can call the same `platform.http` methods. Apps using Angular `HttpClient` can retain `provideHttpClient(withInterceptors([...withPlatformInterceptors(platform)]))`; these interceptors use the same host-owned session, destination, CSRF, tracing, and cancellation policies and introduce no automatic retry or business response mapping. They preserve Angular's response/error conventions. Raw browser `fetch` remains available for uses outside the platform transport; it does not acquire platform tracing or cleanup automatically.

**Connectivity.** Read `platform.connectivity.connection` (§43). HTTP has no duplicate `connection` observer. Authenticated calls use `http`; asynchronous backend messages use `serverEvents`.

## 37. Server Events (Stable — serverEvents v1)

*Why:* the browser normally gets data only when it asks. When a backend service needs to tell the page something on its own initiative — "your export finished", "a notification arrived", "order 123 was changed by someone else" — it needs an open channel. This capability is that channel. It is **not** for app-to-app communication: an app that is not on screen simply loads fresh data when it mounts (§3, principle 7).

### 37.1 API

```ts
// Nothing to declare on the frontend. The Orders service publishes its event contract to the platform hub's
// catalog; `mfe types` turns it into types, so `event`, `params`, and `payload` below are all checked.
const sub = platform.serverEvents.subscribe({
  event: 'orders.updated',
  params: { orderId: '123' },
  onMessage: payload => refetch(),
  onReconnect: () => refetch(),                          // fired after a reconnect
  signal: ctx.signal,
})
sub.status                       // Observer<'subscribing' | 'live' | 'reconnecting' | 'closed'>
platform.serverEvents.connection // Observer<'connected' | 'reconnecting' | 'disconnected'>
```

Subscriptions end when the instance unmounts (via `signal`). A message for an app that is not mounted is not delivered anywhere; that is correct.

### 37.2 Default provider implementation (SignalR)

- **One hub, one connection.** The shell configures its SignalR provider (§16.1) to open a single connection to the **platform hub** and keep it open; the host/provider handle authentication, reconnect with backoff, and telemetry. Apps never open connections and never bundle `@microsoft/signalr` (§20, §47).
- **Topics are SignalR groups.** `subscribe(topic, params)` calls the hub's `Subscribe(topic, params)`; the hub checks the user may see that topic and adds the connection to the group `topic:paramsHash`. Unsubscribe removes it. On reconnect the shell re-subscribes everything.
- **Services publish; they do not host hubs.** When the Orders service changes an order it publishes `{ topic: 'orders.updated', params: { orderId }, payload }` to the platform hub, through a message broker (Service Bus, RabbitMQ) the hub listens to, or the SignalR management API. Services never talk to browsers directly.
- **Scale.** Run the hub behind Azure SignalR Service or a Redis backplane so a message published to one hub instance reaches connections held by another. Standard SignalR practice, not a platform concern.
- **Shell topics.** The shell itself subscribes to `platform.notifications` and `platform.release` on the same connection.

### 37.3 Rules for backend teams

Topic names follow the ownership prefix (§8). Payloads carry ids and what changed; the app refetches details. Events are best-effort: a client that was disconnected does not receive a replay, which is fine because apps refetch on mount and on reconnect (`sub.status` goes `reconnecting` → `live` and `onReconnect` fires so apps can refetch). Each service publishes its topics with params and payload schemas (JSON Schema) to the hub's **event catalog**; the hub validates publishers against it, `mfe types` generates frontend types from it, and DevTools shows live traffic against it. The frontend never re-declares an event.

## 38. Page Events (Stable — pageEvents v1)

**Normal widget composition uses props and contract events.** A filter widget emits its new filter to its consuming app; the app stores that state and passes it as props to chart/table widgets. Sibling widgets do not need to know about each other, and the parent controls which instances change. This also works when two independent filter/chart groups share a page.

Page events are for loose notifications among currently mounted components when a direct parent/child relationship does not fit. They are not the default mechanism for passing filters, selections, form state, or required request/response data between widgets.

```ts
// Optional notification: a mounted component completed a local preview operation.
platform.pageEvents.emit({ event: 'orders.preview-generated', payload: { orderId: '123' } })
platform.pageEvents.subscribe<{ orderId: string }>({
  event: 'orders.preview-generated',
  onMessage: ({ orderId }) => recordLocalPreview(orderId),
  signal: ctx.signal,
})
```

Rules: events are synchronous, transient, not stored, do not cross tabs, and are cleared on cross-app navigation. Event ids follow the ownership prefix. The build scans emits/subscriptions for DevTools; shared payload interfaces remain app/team-owned. Consumers must tolerate missed notifications; durable data and changes needed by other pages, tabs, users, or future mounts belong on the server. Server events then notify mounted consumers to refetch. Prefer direct props/events whenever the consuming app already owns the relationship.

## 39. Notifications (Stable — notifications v1)

| Kind | Persistence | Where |
|---|---|---|
| Toast | transient | shell toast region |
| In-app notification | persistent, read/unread, server-backed | Notification Center |

```ts
const handle = platform.notifications.toast({
  title, description?, kind: 'info' | 'success' | 'warning' | 'error', duration?,           // ms; default per kind; Infinity = until dismissed
  action?: { title, to },                                                                    // an optional link
})
handle.dismiss()

// Escape hatch: your own content. The shell keeps the frame, position, timing, and dismissal; you render inside.
platform.notifications.toast({
  kind: 'info', duration: Infinity,
  custom: (element, { dismiss }) => { element.append(node); return () => node.remove() },   // element carries your CSS scope
})
// React: useToast() returns toast(options) where `content: ({ dismiss }) => JSX` replaces `custom` and is portalled from your tree.
// There is no MFE-facing read or subscribe API for the Notification Center: it is shell-owned UI.
```

A text toast survives navigation; a custom toast is dismissed when the instance that opened it unmounts (§28.3).

In-app notifications are published only by backend services (Appendix D); the frontend shows toasts and reads the center. New ones arrive over server events (`platform.notifications` topic). Notification types (id, data schema, title and body templates, default link) are declared by the publishing backend service in the same catalog as server events, so the shell renders them without loading the app and `mfe types` types `publish({ type })`.

## 40. Analytics and Audit (Stable — analytics v1)

`platform.analytics.track({ event: 'orders.approve-clicked', props })` — event names follow the ownership prefix and a lint rule; no declaration needed. Consent handling and provider independence are the shell's job. **Audit** is backend-authoritative; the frontend attaches `actionId`, initiating MFE/instance, route, `initiator`, confirmation id, and trace id to every action execution via `platform.http` headers.

## 41. Locale and Theme (Stable — locale v1, theme v1)

The product is English-only, but dates, numbers, currencies, and time zones still vary by user. `platform.locale` is an `Observer<{ locale, timeZone, currency }>`; apps format with the standard `Intl` APIs using those values.

The shell applies theme (light/dark/high-contrast, density, reduced motion) by switching the theme class on `:root` (Tecton's `dark` class, managed by the shell's theme provider) and the density and motion attributes it defines. MFEs consume the theme variables only and may `ctx.theme` (an `Observer<ThemeSnapshot>`) to re-render canvases. Packages: `@platform/styles` (loads Tecton's `globals.css` once), `@platform/tailwind` (the MFE preset), `@tecton/react` (shadcn/ui on the React Aria base, Tecton style), `@tecton/angular` (zoneless, signal-based, same tokens; not yet available).

## 42. Performance and Observability (Stable — performance v1, telemetry v1)

The shell collects LCP, INP, CLS, FCP, TTFB once. Per instance: resolve, fetch, CSS, evaluate, mount, ready, unmount, and cross-app navigation time. Containers carry `data-mfe-scope` and `data-mfe-instance`, so long tasks, layout shifts, and INP entries are attributed to shell / app / widget. Platform-wide budgets (entry bytes, CSS bytes, mount and ready time) are enforced by `mfe validate` and the conformance suite.

`platform.telemetry` (`log`, `span`, `metric`, `error`) is vendor-neutral; every record carries shell, protocol, MFE id/version/instance, widget id/version, route, release id, trace id, and framework.

## 43. Service Worker and Connectivity (Stable — sw v1, connectivity v1)

The shell owns the one service worker: asset caching (content-hashed; old releases evicted after the retention period), update coordination with §19.3. MFEs MUST NOT register service workers. `platform.connectivity.connection` is an `Observer<'online' | 'offline' | 'degraded'>`.

---

# Part V — Actions

## 44. Actions (Core)

*Why:* "approve order" can be triggered from a button, the command palette, or a keyboard shortcut. The shell needs to know the action exists before the app loads (to list it, to reserve its shortcut), but only the component that has the order knows whether it can run right now and how. So an action has a **static half** in the contributions data and a **live half** registered by the component while it is mounted.

### 44.1 Static half (contributions)

```ts
export const approveOrder = createAction({
  id: 'approve',                                     // 'orders.approve' once built (§8)
  title: 'Approve order',
  icon: Check,                                       // from 'lucide-static' — an SVG string
  permissions: ['orders-approvers'],                 // Authentik groups (§33): all of these, or { any: [...] }
  effect?: 'read' | 'write' | 'destructive',         // default 'write' — see below
  // Static navigation actions may also carry confirmation?: ConfirmationContent (§44.2.2).
  shortcut?: 'Mod+Enter',
  placement?: Array<'palette' | 'page' | 'help' | 'settings'>,   // where it shows while available: palette, page header, Help menu, Settings page (§27); default ['palette']
  description?: 'Approves the order currently on screen',   // shown in the palette; title is used when absent
})
```

A static action that only navigates needs no live half and works even when its app is not loaded:

```ts
export const newOrder = createAction({ id: 'new', title: 'Create order', icon: Plus, to: '/orders/new', shortcut: 'Mod+N' })
```

**`to` or `run`, never both.** `createAction` returns a `NavigationAction` when given `to` and a `LiveAction` otherwise. `useAction`, `injectAction`, and `ctx.actions.register` accept only `LiveAction`, so registering a `run` for a navigation action is a type error (and `PlatformError('actions/static')` at runtime); `mfe validate` warns about a `LiveAction` that no component ever registers.

Help and settings are actions too. An app-wide help link is static and appears in the Help menu whenever the app is mounted; a page-specific one is registered live by the page, with `run` opening whatever the app wants (a docs URL, or its own help drawer):

```ts
export const ordersGuide = createAction({ id: 'guide', title: 'Orders user guide', icon: BookOpen, to: 'https://docs.company.com/orders', placement: ['palette', 'help'] })
export const pageHelp    = createAction({ id: 'page-help', title: 'Help for this page', icon: CircleHelp, placement: ['help'] })
// in the page component: useAction(pageHelp, { run: () => helpDrawer.open({ topic: 'approval' }) })
```

### 44.2 Live half (registered from the component that has the data)

```tsx
// React
const approve = useAction(approveOrder, {
  target: { key: order.id, label: `Order ${order.id}` },
  enabled: order.status === 'pending',
  disabledReason: 'Only pending orders can be approved',
  run: () => api.approve(order.id),                  // a promise; the platform tracks it
  onError?: err => …,                                // default: the shell shows a toast with the message
})
// approve: { registrationId, enabled, run, pending, error }; run targets this registration
<Button onClick={approve.run} disabled={!approve.enabled} loading={approve.pending}>Approve</Button>
```

```ts
// Angular — an options function so the registration follows signals
approve = injectAction(approveOrder, () => ({
  target: { key: this.order().id, label: `Order ${this.order().id}` },
  enabled: this.order().status === 'pending',
  disabledReason: 'Only pending orders can be approved',
  run: () => this.api.approve(this.order().id),
}))
```

**Pending state is per registration.** While confirming or executing, `pending` is true on its component button and every shell control targeting that registration. Its shortcut does not start another execution, and another `run()` returns `pending` without invoking its callback. Other registrations retain their own state; the shell MUST NOT switch targets because the selected registration is pending or disabled. Callback failures set `error` and invoke `onError` or the default shell toast. Duplicate business operations across distinct registrations remain the app/backend's responsibility.

**Longer work.** The callback receives `{ signal, progress }`. `progress(0–1)` displays determinate progress and a cancel affordance that aborts `signal`. Work that survives navigation is a server-side job reporting through server events and notifications.

Registrations appear wherever `placement` says, with shortcuts bound independently of placement. Component unmount removes that registration. Multiple registrations coexist; mount order never chooses the target.

**Registration identity.** Each registration has an opaque `registrationId` and an owning MFE instance. Hook and core-handle `run()` methods are bound to that registration. Entity-specific actions supply `target: { key: string; label: string }`: the key identifies the entity within the registration, and the label identifies it to users in shell controls and target selection. This is live metadata, not action input or a manifest contribution. Changing the key releases the registration and creates a new one automatically in both adapters; old handles and pinned shell interactions become unavailable. Core callers release and re-register when changing keys. State/callback updates for the same key preserve identity. Actions without an entity target may omit `target`; entity changes MUST be represented by key changes.

### 44.2.1 Resolving the target

| Entry point | Target rule |
|---|---|
| Component button using its handle's `run()` | That registration, regardless of focus elsewhere |
| Shortcut | Start at the focused MFE instance, then its consumer ancestors; use the nearest instance with registrations for this action if it has exactly one |
| Palette, page-header action, Help menu | Capture MFE focus before the shell control takes focus; preserve the resolved registration throughout the interaction |
| No applicable focused instance | Use the sole mounted registration if exactly one exists |
| Multiple candidates remain | Require explicit selection; mount order never decides |
| Programmatic call with `registrationId` | That exact registration; stale ids never fall back |

The host identifies focus through instance mount roots and owned overlay containers. Nested-widget focus belongs first to that widget. Multiple registrations within one instance remain ambiguous; component-tree depth does not select between them. Disabled and pending registrations still count: never skip them to find another executable target. Browser editing shortcuts and modal shortcut suspension still apply.

Shell controls capture the last MFE focus context when focus enters the shell, before opening the palette/menu/confirmation or invoking a page-header action. Cross-app navigation and owner unmount clear this context; focus entering another MFE replaces it. Entries display action title and selected target label. Ambiguous user invocations open a chooser using target labels and MFE titles; indistinguishable entries remain unavailable until the app supplies distinguishable labels. Ambiguous programmatic calls return `target-required` without opening UI.

A resolved invocation pins its registration through selection and confirmation. Unmount, a target-key change, or disablement prevents a not-yet-started callback from running. When execution starts, the host captures that callback and provides a signal linked to the registration lifetime and user cancellation. Releasing the registration aborts the signal; running code must cooperate with cancellation, which cannot undo an already-completed server operation. No queued or running invocation switches to another registration.

**`effect`** sets the minimum confirmation rule. `destructive` always requires confirmation. `write` (default) and `read` do not require it by default. Apps describe the consequences; they cannot disable a required confirmation. The distinction remains in audit.

### 44.2.2 App-supplied confirmation content

```ts
interface ConfirmationContent {
  title?: string
  message: string                    // always required: the audit record and the palette preview use it
  confirmLabel?: string
  custom?: (element: HTMLElement, controls: { confirm(): void; cancel(): void }) => () => void
                                     // escape hatch: replaces the message body with your content; React passes `content: ({ confirm, cancel }) => JSX` instead
}

const remove = useAction(deleteOrder, {
  target: { key: order.id, label: `Order ${order.id}` },
  enabled: order.canDelete,
  confirmation: {
    title: 'Delete order',
    message: `Delete order ${order.id} and its ${order.invoiceCount} invoices?`,
    confirmLabel: 'Delete order',
  },
  run: ({ signal }) => platform.http.delete(`/api/orders/${encodeURIComponent(order.id)}`, { signal }),
})
```

Live registrations accept optional `confirmation: ConfirmationContent`; Angular supplies it through the existing reactive options function and core callers through `register`/`update`. Static navigation actions may carry the same data in `createAction`, evaluated into the manifest. Supplying content requests confirmation even for a read/write action; omitting it never suppresses the mandatory destructive-action dialog. When required content is absent, the shell supplies a default using the action title and target label.

The shell renders the dialog frame, the title, the buttons, focus, stacking, dismissal, and the confirmation result; with `custom` it renders the app's content where the message would be, from the app's own tree (§28.3). `controls.confirm()` from that content is the same as the shell's Confirm button and goes through the same re-checks and audit; custom content cannot remove the buttons or bypass a required confirmation. Apps do not render a second dialog or return their own confirmation result through this API. Every entry point uses the same content and pipeline. On opening, the shell captures the selected registration and confirmation content. If the target disappears, changes key, or becomes disabled, it cancels that invocation. If the live confirmation content changes before execution, prior approval is invalidated and the updated message must be confirmed. Cancel/Escape never invokes `run`.

### 44.3 Running an action

Every entry point uses one host-owned pipeline: resolve and pin the registration → check permissions, enabled, and pending → reserve that registration → show and confirm the app-supplied content or shell default if required → re-check the same registration's existence, target, confirmation content, permissions, and enabled state → attach audit headers → invoke its callback → telemetry. Reservation is held through confirmation and execution and released on every exit; it drives `pending` and prevents duplicate confirmation dialogs. Audit includes action id, registration id, target key when present, owning MFE/instance, initiator (`'user' | 'shortcut' | 'system'`), confirmation id, and trace id. The callback receives `{ initiator, confirmationId, signal, progress }`.

```ts
type ActionRunResult =
  | { status: 'completed' }
  | { status: 'cancelled' | 'disabled' | 'pending' | 'unavailable' | 'target-required' }
  | { status: 'failed'; error: PlatformError }

// Optional registrationId must belong to the given live action id.
platform.actions.run({ id, registrationId? }): Promise<ActionRunResult>
// Hook and core handle run() use their own registration and return the same result.
```

Missing/released registrations return `unavailable`; permission or enabled checks return `disabled`; cancelled confirmations or aborted work return `cancelled`. Ambiguity returns `target-required`. Callback failures return `failed` and reach the registration's error handler. Programming errors such as a registration belonging to another action raise `core/invalid-input`. A static `to` action has no instance target: the host still checks its permissions and required confirmation before it navigates through §23 and returns `completed` or `cancelled` according to navigation outcome; a navigation failure returns `failed`, and passing a registration id is invalid.

**No business arguments in v1.** The selected callback already has its entity data. `registrationId` and `target.key` identify a registration, not business input. Optional input schemas and `run({ input, ... })` can be added later without changing the options-object calling convention.

**Shortcuts.** Bound while the action is registered (or, for `to` actions, always). Typing in an input, textarea, or contenteditable always wins for printable keys and standard editing chords; single-character shortcuts are off while typing. The registry detects conflicts at publish; users can remap in Settings; labels are platform-specific (⌘ / Ctrl); the shortcut sheet is generated from manifests. MFEs MUST NOT attach document-level `keydown` listeners.

---

# Part VI — Governance and Delivery

## 45. Security

**Trust model.** Every MFE in the page is trusted code. The controls are what gets *admitted* to production: identifier ownership, integrity hashes on every file, certification, and enforcement rules.

**Required in production:** SRI on every entry, stylesheet, and shared library; publishing only from CI with a workload identity; SBOM and dependency scanning at publish (critical vulnerabilities block promotion); CSP `script-src 'self' <cdn> 'strict-dynamic' 'nonce-…'`, `object-src 'none'`, `connect-src` limited to platform, API, and SignalR origins — MFEs MUST NOT need `unsafe-eval` or `unsafe-inline`; Trusted Types enforced in the shell where supported; no tokens in MFE code; `HttpOnly` session cookies; CSRF handled by `platform.http`; the platform hub authorizes every topic subscription. Manifest signing and SLSA provenance are Phase 2 (§54).

## 46. Conformance and Certification

Every build runs `mfe validate --conformance` on the test host in CI. Only certified builds can be made live. Each check carries the phase (§54) that introduces it: Phase 1 certification runs the `P1` checks, and a later phase's checks become required when that phase ships.

```text
[P1] manifest valid, identifiers within ownership prefix
[P1] protocol and capability ranges satisfiable
[P1] entry module has no side effects; default export validates
[P1] mounts / unmounts cleanly / remounts (3 cycles) with no leaks
[P1] lifecycle: navigation does not await cleanup; cancelled/failed mounts release resources; late mounts are disposed once and cannot change the destination
[P2] widget updates: synchronous props delivery; thrown errors show fallback; disposed instances cannot update or emit
[P1] sessions: logout/expiry cancel and dispose instances; shared user state clears; new sign-in gets fresh clients
[P1] releases: one capability major per shell release; incompatible coordinated upgrades rejected; open pages stay pinned; unavailable artifacts show reload recovery
[P2] router respects basePath and goes through the bridge only; blockers bridged
[P3] storage scoped correctly; only sessionStorage and localStorage backends; no direct localStorage / sessionStorage / indexedDB / cookie access
[P1] no document-level listeners; no service worker registration; no history writes
[P1] no zone.js; no @microsoft/signalr; Angular OnPush / signal rules pass
[P1] no federation runtime; shared dependencies declared and within policy
[P1] no eval / inline scripts; Trusted Types compatible
[P1] CSS: no Preflight, layers mapped, scope applied, global names namespaced, portals use overlayRoot
[P2] surfaces: overlays render inside the overlay layer; modal surfaces suspend shortcuts; custom toast and confirmation content is torn down with its opener; no second copy of the UI kit's overlay stack
[P1] contributions evaluate to data at build time (no functions reach the manifest)
[P1] accessibility smoke tests (axe on mount; focus after navigation)
[P1] responsive: no horizontal overflow at 360 px; primary actions reachable at 360 px and 1280 px
[P1] performance budgets (entry bytes, css bytes, mount ms, ready ms)
[P2] widgets: one contract per id; exact consumer-major matches; schema compatibility checks and owner contract tests
[P4] actions: instance-bound buttons; focused-instance resolution; ambiguous-target selection; pinned target invalidation
[P3] http: Fetch-compatible responses; shared auth/destination/cancellation policy; JSON/body exclusivity; null empty responses; HTTP errors; no implicit retries or caching
[P4] confirmations: app content and shell fallback; no destructive-action bypass; content/target changes invalidate approval
[P1] providers: same public behavior across production/dev/test sources; host-only registration and teardown
[P1] observers: no initial emission; committed snapshots; stable identity and unchanged-value suppression; per-key delivery; cleanup on unsubscribe, abort, and component/instance destruction; read-subscribe race handling
```

## 47. Architecture Enforcement

`@platform/build` ships ESLint rules and a bundle check that error on the following unless an explicit, reviewable escape hatch is present (`// mfe-allow: <rule> -- <reason>`, recorded in the manifest):

```ts
localStorage / sessionStorage / indexedDB / document.cookie
new WebSocket(...) / EventSource / import '@microsoft/signalr'
navigator.serviceWorker.register(...)
document.body.appendChild(...) / document.querySelector(...) outside ctx.element
window.addEventListener('keydown' | 'popstate' | 'beforeunload' | 'message', …)
history.pushState / replaceState
importing another MFE's runtime code
import 'zone.js'
import 'react-aria-components' | '@base-ui/react' | 'sonner'   // use @tecton/react and its primitives re-export (§28)
<script type="importmap">
```

## 48. Resilience

One MFE failing MUST NOT affect others. For load, mount, runtime, and startup timeout failures of the current instance the host shows the shell's error page (apps) or the consumer's fallback (widgets), retries load/mount twice with backoff, reports degraded state, and remounts on the next navigation. Cleanup failures are reported without delaying navigation or changing the new page; attempts cancelled because navigation superseded them or their owner was removed are never retried. Automatic fallback to a previous version is the pipeline's decision (`PUT /live`), not the shell's.

**Registry outage.** The shell caches the last release locally. On outage it boots from the cache within the retention period, shows a status indicator, and retries with backoff. Returning users can continue while the cached release is usable. If its required files are unavailable, show the reload recovery screen (§19.3); first-time users see the maintenance page.

**Server-events outage.** The shell reconnects with backoff; `platform.serverEvents.connection` reports it; apps keep working on request/response.

## 49. Deprecation and Migration

Deprecations are machine-readable in the registry and in `mfe validate` output: what is deprecated, the replacement, announcement and removal dates (≥ 180 days apart for Stable, ≥ 30 for Experimental), impacted MFEs, and a codemod id. `mfe migrate` applies codemods. Removal is blocked if any MFE in the resulting live release still depends on the item. Notice periods do not require serving two capability majors: a breaking capability change ships through the coordinated release policy in §17.

## 50. Developer Tooling

CLI: `mfe init` (React or Angular template), `mfe dev`, `mfe build`, `mfe validate [--conformance]`, `mfe types` (regenerates `platform-registry.d.ts`; runs automatically inside `mfe dev` and `mfe build`), `mfe inspect`, `mfe migrate`, `mfe publish`.

DevTools (extension and in-shell panel in dev mode): instances and lifecycle states, versions and release, routes and navigations, capability versions, registered actions and shortcuts with resolution trace, storage, server-event subscriptions and live traffic, page events (who emits, who listens), performance timeline with attribution, import maps, CSS scopes, local overrides, failures and leak reports, config overrides.

**Failure injection** (dev mode and test host): widget load failure, registry latency or outage, API timeouts, offline, server-events disconnect, storage quota exceeded, permission denied, session expiry, release supersession, withdrawn version.

**Developer portal:** per MFE — owner, live version, routes, widgets published and consumed (with contract majors), framework and zoneless status, capabilities used, performance, dependency graph, deprecations, escape hatches, certification status.

## 51. Adopting the Platform with an Existing App

| Step | What the team does | What they get |
|---|---|---|
| 1. Embedded | Export a `createApp` with the adapter; route through the bridge; Angular goes zoneless | Appears in the switcher and menu, soft navigation, blockers, telemetry, design system |
| 2. Capabilities | Replace direct storage / SignalR / fetch with platform capabilities | Scoped storage, observability, conformance |
| 3. Contributions | Add static actions (palette, help, settings), release notes | Palette, Help menu, Settings, cross-app links |
| 4. Widgets | Extract reusable UI as widgets with contracts | Reuse across apps |

Step 1 is the minimum for production. Angular apps on Zone.js must finish the zoneless migration first.

## 52. Testing

**Unit and integration:** the test host with recorded capability calls and failure injection. **Conformance:** §46. **Compatibility CI (platform team):** nightly runs of every live manifest against the next shell and capability release, notifying owners before anything ships. **End-to-end:** Playwright against the shell in dev mode; tests locate elements by `data-testid`, prefixed with the owning app's id (`orders.approve-button`) so two apps on one page never collide; no other selectors cross an MFE boundary. **Widget contracts:** schema compatibility checks and owner tests for existing props/events/behavior; exact contract-major matches when a widget or consumer goes live. **Action targeting:** two instances of one action, nested instance focus, ambiguity, palette target preservation, and target invalidation during confirmation.

## 53. Non-Functional Targets

These are **initial values**, chosen as sensible defaults. They are to be validated against the first two pilot apps in Phase 1 and then fixed; the same applies to the contributions budget (§18.2), the release retention period (§19.3), and the widget URL-state limits (§29.5).

| Requirement | Target |
|---|---|
| `mfe-core` runtime overhead (gzip) | ≤ 25 KB |
| Shell interactive, cold, cached release, reference hardware | ≤ 2.0 s |
| App mount, resolve → ready, warm, p75 | ≤ 800 ms |
| Widget mount, p75 | ≤ 300 ms |
| Cross-app navigation, requested → settled, p75 | ≤ 1.0 s |
| Server event delivery, hub publish → handler, p95 | ≤ 1.0 s |
| Registry availability | 99.9%, and never blocking for returning users |
| Concurrently mounted widgets per page without override | 20 |
| Minimum supported width | 360 px |
| Accessibility | WCAG 2.2 AA for shell experiences; MFEs responsible for their content |

## 54. Implementation Phases

**Phase 1 — Minimum host.** Protocol and host provider composition; manifest and contributions; registry with the pipeline interface and releases; ESM + import maps; library sharing; React and zoneless Angular adapters; identity, permissions, config, theme tokens, telemetry, error pages, and progress bar; test host; dev mode; CLI; conformance v1; CSS layers and scoping; responsive rule.

**Phase 2 — Navigation and composition.** Navigation coordinator, router adapters, typed paths and redirects, blockers, page metadata, app switcher and menu, surfaces, widgets with contracts and events, overlay roots, performance attribution, manifest signing.

**Phase 3 — Enterprise capabilities.** Session/local key/value storage, server events (platform hub), page events, HTTP adapters, notifications, settings, locale, service worker, connectivity, analytics.

**Phase 4 — Interaction.** Actions and pipeline (palette, page actions, shortcuts, Help menu), release notes; the Tour component in the UI kits.

**Phase 5 — Scale.** Developer portal, dependency graph, compatibility CI, deprecation tooling and codemods.

## 55. Deferred

Listed so they are not forgotten; nothing above depends on them, and each can be added without a new protocol major.

- Server-rendered apps and route "zones" (Next.js, TanStack Start); iframe apps; Vue and other frameworks.
- Translations and localization of UI strings.
- Deployment features inside the platform: channels, percentage rollouts, automatic rollback (the pipeline owns these).
- Multiple implementations of the same widget id in one release; multiple supported contracts and conversion adapters behind one id. Breaking redesigns use a new id (§17).
- Widget command RPC (`execute`).
- A worker-pool capability (apps that need a worker bundle one themselves).
- Actions from apps that are not mounted (beyond static `to` navigation).
- A shell-rendered navigation menu (menu-tree contributions, breadcrumbs, menu badges).
- Multi-tenancy (tenant switching, per-tenant releases and storage scopes); tenant branding; support impersonation; branch-preview overrides for testers.
- Suspend/resume in the lifecycle; a workspace / persistent-tabs model.
- Undo/redo; offline operation queue; files and export capability; experiments.
- Widget URL state (`urlState`, slots, `navigation.href({ widgets })`); props in and events out cover it.
- AI assistant (`platform.assistant`, tool adapter over actions, safety rules); actions keep `description` and `effect` so one can be added without MFE changes.
- Global search (per-app search endpoints aggregated by the shell); the palette searches apps and actions only.
- Feedback and support bundle (`platform.feedback.open`, privacy-safe diagnostic bundle) until a destination for reports exists.
- Tasks (long-running user-facing work with a Task Center); operator announcements; OS push notifications.
- Runtime capability status (`useCapability`); cross-MFE storage (`sharedWith`); explicit per-device storage identities; Shadow DOM widget isolation; the app `update` lifecycle hook.
- Structured/indexed storage and IndexedDB; cross-device storage synchronization (`sync`). The storage capability covers sessionStorage and localStorage only.
- Platform-managed autosave, draft recovery/discard APIs, and storage-owned navigation blockers; apps implement any draft workflow using ordinary key/value operations.
- Entitlements (licensed modules per installation) and feature flags as capabilities (`flags` Requirement, `useFlag`, a flag service); groups and config cover both today.
- Contextual help as a platform capability (`useHelp`, a shell-rendered help panel, a knowledge-base service); help is an action with `placement: ['help']` instead.
- Backend health feed (a status service reporting per-dependency `healthy | degraded | unavailable | maintenance`), health-gated actions (`health: [...]` on `createAction`), `useHealth` / `injectHealth`; client-observed health and operator overrides.
- Cross-tab messaging exposed to apps (the shell uses it internally).
- Multiple capability majors in one shell and compatibility adapters for previous majors; use coordinated breaking upgrades (§17) until a concrete migration need justifies them.

## 56. Summary

```text
                         Shell (production · dev mode · test host)
                                        │
                ┌───────────────────────┴───────────────────────┐
         Shell experiences                                MFE runtime
   app switcher · menu · settings · help          registry · release · lifecycle
   palette · notifications                        navigation · widgets · capabilities
   error pages · progress                         server events (one SignalR hub) · page events
                └───────────────────────┬───────────────────────┘
                                        │
                        Protocol v1 · Manifest v1 (contributions are data)
                                        │
                     ┌──────────────────┴──────────────────┐
                   Apps                                 Widgets
        React (React Router / TanStack)         React or zoneless Angular
        Angular ≥ 21, zoneless                  contract-versioned, one live version
```

Success criterion: application teams think in apps, widgets, capabilities, actions, context, and contributions — not import maps, SignalR hubs, browser storage internals, or shell internals.

## 57. References

Standard Schema — https://standardschema.dev · Angular zoneless — https://angular.dev/guide/zoneless · `createApplication` — https://angular.dev/api/platform-browser/createApplication · ASP.NET Core SignalR — https://learn.microsoft.com/aspnet/core/signalr · Azure SignalR Service — https://learn.microsoft.com/azure/azure-signalr · Tailwind theme and Preflight — https://tailwindcss.com/docs/theme, https://tailwindcss.com/docs/preflight · shadcn registry — https://ui.shadcn.com/docs/registry/getting-started · CSS `@scope` — https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40scope · Cascade layers — https://developer.mozilla.org/en-US/docs/Web/CSS/@layer · Import maps — https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap · Subresource Integrity — https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity · Core Web Vitals — https://web.dev/articles/vitals

---

# Appendices

## Appendix A — Public API

```ts
// @platform/core
createApp · createWidget                 // framework-neutral (mount-based); apps normally use the adapter's createApp/createWidget instead
createAction · createReleaseNote
createStorage

// Deliberately absent: permissions, server events, notifications, and config are owned by backend
// services and typed from their catalogs; widget dependencies and cross-app links are detected or explicitly listed (§18.3);
// protocol and capability versions are derived from the SDK and imports; createCapability is platform-internal.
PlatformError · HttpError · HttpClient · ConfirmationContent
Register (module augmentation) · Observer<T>

// @platform/host — shell composition only, never imported by an MFE
createHost · HostProviders · ProviderFactory

// @platform/react · @platform/angular
createApp · createWidget                 // same names; the import path names the framework — see Appendix C for the full adapter API

// @platform/dev           runStandalone(app | widget, options?)
// @platform/testing       createTestHost(options?)
```

Packages under `@platform`: `core`, `react`, `angular`, `host`, `dev`, `testing`, `build`, `cli`, `devtools`, capability clients, `styles`, and `tailwind`. The UI kits are Tecton: `@tecton/react` today, `@tecton/angular` when it exists; both carry the theme. `@platform/core` stays free of React, Angular, Tailwind, SignalR, and vendor SDKs.

## Appendix B — Examples

### B.1 Angular app (zoneless)

```ts
// mfe.ts
import { createApp } from '@platform/angular'
import { Package } from 'lucide-static'
import { ORDER_ROUTES } from './routes'

export default createApp({
  title: 'Orders',
  icon: Package,                     // from 'lucide-static'
  permissions: ['orders-users'],
  basePath: '/orders',
  angularRoutes: ORDER_ROUTES,       // the adapter adds zoneless change detection, the router, base href, and the platform location strategy
})
```

```ts
// contributions.ts → evaluated at build time into the manifest (data only)
import { createAction } from '@platform/core'
import { Check, Plus, Settings } from 'lucide-static'

export const settings = createAction({ id: 'settings', title: 'Order defaults', icon: Settings, to: '/orders/settings', placement: ['settings'] })
export const newOrder = createAction({ id: 'new', title: 'Create order', icon: Plus, to: '/orders/new', shortcut: 'Mod+N' })

export const approveOrder = createAction({
  id: 'approve', title: 'Approve order', icon: Check,
  permissions: ['orders-approvers'],
  shortcut: 'Mod+Enter',
  placement: ['palette', 'page'],
  description: 'Approves the order currently on screen',
})

```

```ts
// order-details.component.ts — the live half, next to the data
approve = injectAction(approveOrder, () => ({
  target: { key: this.orderId(), label: `Order ${this.orderId()}` },
  enabled: this.order()?.status === 'pending',
  disabledReason: 'Only pending orders can be approved',
  run: () => this.api.approve(this.order()!.id),
}))
```

```ts
// inside a component: refetch when someone else changes this order
const sub = platform.serverEvents.subscribe({ event: 'orders.updated', params: { orderId: order().id }, onMessage: () => reload(), signal })   // typed from the hub catalog
```

### B.2 React widget

```ts
import { createWidget } from '@platform/react'
import { z } from 'zod'
import { CustomerCard } from './CustomerCard'

export default createWidget({
  title: 'Customer card',
  contract: { version: 2 },                      // only contract 2; updates preserve this contract
  props: z.object({ customerId: z.string(), compact: z.boolean().optional() }),
  events: { selected: z.object({ customerId: z.string() }) },
  component: CustomerCard,     // receives props and { emit, platform } via context
})
```

### B.3 Using the widget from Angular

```html
<mfe-widget id="customer-card" [contract]="2" [props]="{ customerId: order().customerId }" (selected)="onSelected($event)" />
```

### B.4 Standalone entry

```ts
import app from './mfe'
import { runStandalone } from '@platform/dev'
runStandalone(app, { profile: 'orders-manager' })      // the production shell, in dev mode
```

### B.5 Pipeline promoting a version

```bash
mfe publish                                   # CI: uploads artifacts + manifest, runs conformance, records the version
curl -X PUT https://registry/mfes/orders/live -d '{ "version": "18.4.3" }'     # pipeline: make it live (rollback = previous number)
```

## Appendix C — Adapter API (React and Angular)

The adapters are what developers touch. Each item wraps a core object from Parts II–V; nothing here adds behavior.

### C.1 What `component` receives

```ts
// The adapter packages export `createApp` and `createWidget`; the import path names the framework.
// React app: createApp({ basePath, routeTree })        — TanStack Router route tree; the adapter builds the router
//            createApp({ basePath, routerRoutes })     — React Router route objects
//            createApp({ basePath, component })        — escape hatch: you build the router; component receives { bridge, basePath }
// React widget: createWidget({ …, component }) — the component receives the widget's props; emit comes from useWidget().

// Angular app: createApp({ basePath, angularRoutes, providers? }) — the adapter bootstraps the root with zoneless change detection,
//              the router, base href, and the platform location strategy; `providers` are appended.
// Angular widget: createWidget({ …, component }) — widget props are signal inputs of the same names.
```

**Registering actions without a hook.** The hooks above are wrappers over the mount context; adapter authors and framework-free code use it directly:

```ts
const handle = ctx.actions.register({ action: approveOrder, target: { key: order.id, label: `Order ${order.id}` }, confirmation, enabled, disabledReason, run, onError, signal })
handle.registrationId  // opaque registration identity
handle.status          // Observer<{ enabled, pending, error }>
await handle.run()     // bound to this registration; Promise<ActionRunResult>
handle.update({ enabled: false }); handle.release()
// New target key: release and register again; do not retarget an existing handle.
```

### C.2 React hooks

| Hook | Returns | Wraps |
|---|---|---|
| `usePlatform()` | `PlatformClient` | `ctx.platform` |
| `useMountContext()` | `AppMountContext \| WidgetMountContext` | the mount context |
| `useObserver(observer, selector?)` | current value, re-rendering on change | any `Observer<T>` |
| `usePage(meta)` | — (sets page metadata; cleans up on unmount) | `ctx.page.set` |
| `usePermission(id)` | `boolean`, reactive | `platform.permissions.observe(id)` |
| `useConfig(key)` | typed value, reactive | `platform.config.observe(key)` |
| `useTheme()` / `useLocale()` | snapshots | `ctx.theme` / `ctx.locale` |
| `useIdentity()` | `IdentitySnapshot \| null` | `platform.identity` |
| `useConnectivity()` | `'online' \| 'offline' \| 'degraded'` | `platform.connectivity.connection` |
| `useServerEvent({ event, params, onMessage, onReconnect, enabled? })` | `{ status }` | `platform.serverEvents.subscribe` |
| `usePageEvent({ event, onMessage })` | — | `platform.pageEvents.subscribe` |
| `useStorage(definition)` | store handle | `platform.storage.open` |
| `useNavigate()` | `(options) => Promise<'committed' \| 'cancelled'>` | `platform.navigation.navigate` |
| `useBlocker(...)` | — (use the router's own; the adapter bridges it) | `platform.navigation.block` |
| `useAction(action, { target?, confirmation?, enabled?, disabledReason?, run, onError? })` | `{ registrationId, enabled, run, pending, error }` | `ctx.actions.register`; target-key changes create new registrations |
| `useWidget()` (inside a widget) | `{ emit, contractVersion, consumer }` | `WidgetMountContext` |
| `useSurface({ kind, enabled? })` | `{ container, close }` | `platform.surfaces.open` (raw container; you own focus and Escape, §28.2) |
| `Dialog` / `Sheet` / `AlertDialog` and `@tecton/react/primitives` — **from `@tecton/react`**, not the adapter | declarative components; promise wrappers are kit conveniences | React Aria overlays inside the MFE's overlay root |
| `useToast()` | `toast(options)` with `content: ({ dismiss }) => JSX` | `platform.notifications.toast` |

Components: `<MfeWidget id contract props on fallback />`, `<PlatformLink to params search replace />` (`to` is a declared path, typed via `Register`).

Every subscribing hook cleans up at component unmount or observer/key replacement and is also bounded by the instance signal (§9.3). Shared observers remain usable by other subscribers. Event hooks retain their event-subscription cleanup semantics.

### C.3 Angular injectables

Same list with `inject` prefixes, returning **signals** where React returns values: `injectPlatform()`, `injectMountContext()`, `injectObserver(observer) → Signal<T>`, `injectPage(() => PageMeta)` (reactive; re-applies when the computed value changes), `injectAction(action, () => options)` (returns `{ enabled, pending, error }` as signals plus bound `run` and `registrationId`; target-key changes create new registrations), `injectPermission(id) → Signal<boolean>`, `injectConfig`, `injectTheme`, `injectLocale`, `injectIdentity`, `injectConnectivity`, `injectServerEvent({ event, params: () => …, onMessage })`, `injectPageEvent`, `injectStorage`, `injectNavigate`, `injectWidget`, `injectSurface(() => ({ kind, enabled, template }))` (renders a template into a raw container while `enabled`; focus and Escape are the template's), `injectToast`. `injectDialog()` / `injectSheet()` / `injectDialogRef<T>()` come from **`@tecton/angular`**, kit conveniences over its declarative components.

Directives and components: `<mfe-widget id [contract] [props] (event) fallback>`, `[platformLink]="'/customers/$customerId'" [platformLinkParams]`.

`injectPermission(id)` and `injectConfig(key)` wrap the keyed observers; `injectObserver` initializes a signal from `get()` and subscribes using the injection destruction scope plus the MFE lifetime. State observation follows §9.3; event injectables handle payload delivery separately.

DI tokens for advanced use: `PLATFORM`, `MOUNT_CONTEXT`, and one token per capability.

## Appendix D — Backend Integration Contract

For .NET (and other backend) teams. Everything the platform needs from services, in one place.

### D.1 Permissions (Authentik groups)

Authentik is the identity provider. The session token carries a `groups` claim; the shell's `permissions.can(id)` is a membership test on it, and `mfe types` / `mfe validate` read the group list from Authentik's API (`GET /api/v3/core/groups/`) so names are typed and checked at build time. Services enforce the same claim on their endpoints (`[Authorize(Roles = "orders-approvers")]` or equivalent) and never trust the UI's check. There is no permission service and no group-to-permission mapping; creating a group in Authentik is what creates a permission.

### D.2 Event and notification catalog (platform hub)

Each service publishes its contracts to the hub at startup or deploy:

```json
POST /hub/catalog
{
  "service": "orders",
  "events": [
    { "topic": "orders.updated",
      "params":  { "type": "object", "properties": { "orderId": { "type": "string" } }, "required": ["orderId"] },
      "payload": { "type": "object", "properties": { "status": { "type": "string" }, "changedBy": { "type": "string" } } },
      "authorize": { "group": "orders-users" } }
  ],
  "notifications": [
    { "type": "orders.approved",
      "data": { "type": "object", "properties": { "orderId": { "type": "string" }, "number": { "type": "string" } } },
      "title": "Order {{number}} approved",
      "body": "Approved by {{approvedBy}}",
      "link": "/orders/{{orderId}}" }
  ]
}
```

Topics MUST start with the service's registered prefix. The hub rejects publishes that do not match the catalog. This is the selected SignalR/backend implementation; MFEs depend on the normalized serverEvents contract, not this transport (§16.1).

### D.3 Publishing an event

```csharp
// via the platform hub client library (wraps a message broker or the SignalR management API)
await _platformHub.PublishAsync(
    topic:   "orders.updated",
    @params: new { orderId = order.Id },
    payload: new { status = order.Status, changedBy = user.Id });
```

Delivery is best-effort to currently subscribed pages. Payloads carry ids and what changed; clients refetch details.

### D.4 Publishing a notification

```csharp
await _platformHub.NotifyAsync(
    type:      "orders.approved",
    userIds:   new[] { order.OwnerId },
    data:      new { orderId = order.Id, number = order.Number, approvedBy = user.DisplayName });
```

The hub persists it (read/unread), pushes it to open pages on the `platform.notifications` topic, and the shell renders it from the catalog's title/body templates and link.

### D.5 Config catalog

`GET /catalog/config` → `[{ "key", "schema" }]` from the control plane; values are served per environment by the config endpoint the shell already calls.

### D.6 Registry (deployment pipeline)

```text
POST /mfes                    { "id", "owner" }                      (mfe init; developer SSO, owning team)
POST /mfes/{id}/versions      manifest + artifact URLs + certification   (mfe publish, CI workload identity only)
PUT  /mfes/{id}/live          { "version": "18.4.3" | null }         (pipeline; rollback = previous version; null = withdraw)
GET  /release                 current release list with manifests    (shell)
```

`PUT /live` is refused if the version is not certified or would break a compatibility rule (§19.2); the response says why.

### D.7 What services never do

Host their own SignalR hubs for browsers; hardcode host names in links (use product-relative paths); send whole records in events; assume a page received an event (pages refetch on mount and reconnect).

## Appendix E — Decisions

Short records of the decisions that shaped this spec, so they are not re-litigated. Each can be revisited with new information.

1. **One client-rendered page; no server-rendered apps, no iframes.** Removes a second shell implementation, edge routing, and cross-document state. Cost: no SSR first paint, which does not matter behind a login. Revisit if a public-facing surface needs SEO.
2. **React and zoneless Angular only.** Two adapters to maintain; Zone.js is excluded because it patches globals for the whole page and would couple change detection across MFEs. Vue and others are a single adapter away if ever needed.
3. **Each app keeps its own router; the shell only routes between apps.** A shell-owned router would mean rewriting every app's navigation and re-implementing router features in two frameworks. The gateway model keeps apps standard.
4. **Consumer-owned composition.** Apps coordinate their widgets through props and contract events. Page events are limited to loose notifications among mounted components; server events describe backend changes, and apps refetch on mount.
5. **Server events over polling, on one SignalR hub.** Backends need to reach the page; one shell-owned connection avoids N connections and N client bundles. Services publish; they never host hubs.
6. **Deployment belongs to the pipeline.** The platform stores manifests and a live version per MFE, and offers one `PUT /live` call. Channels, canaries, and auto-rollback are pipeline features.
7. **Releases are fetched once per page session.** Prevents mixing an old shell with a new app and protects long sessions from deleted assets. Signing and ids were dropped as unnecessary for v1.
8. **One implementation and one contract per widget id per release.** Compatible updates preserve the contract. Breaking redesigns use a new id and gradual migration; the platform does not dispatch between contracts or convert props/events.
9. **Derive what the build can prove.** Protocol and capability version numbers and owner come from the SDK/build/CI. Dependencies and public route paths are detected where possible, with explicit declarations for opaque or dynamic usage (§18.3). Permissions, events, notifications, and config contracts come from backend catalogs.
10. **Familiar calls with explicit reactive contracts.** Configurable operations use options objects; simple reads/writes, hooks, and established wrappers keep their signatures. `create*` factories carry inference, `Observer` defines state read/notification/lifetime behavior, keyed services expose `observe(key)`, and `Register` supplies global typing.
11. **English only.** Titles are plain strings. Adding translation keys later is mechanical.
12. **Contributions are data; live behavior is registered from components.** The shell builds every global surface from manifests alone. Whether an action is enabled, and what it does, is declared by the component that has the data (`useAction`), so there is no separate "context" model and no code to load per app at startup.
13. **Standalone is the shell in dev mode.** A separate host would drift from production and break the "same definition everywhere" promise.
14. **Paths, not destinations.** Other apps link to declared paths, typed via `Register`; renames are redirects. A named-destination layer solved a problem redirects already solve.
15. **If a component knows it, the component registers it.** Actions, page metadata: all registered from mounted components, none declared from outside. What must be known before load (app title/icon/permissions, static actions, release notes, paths) is data in the manifest.
16. **No Module Federation.** Plain ESM plus a generated import map is the only transport. Federation's runtime version negotiation is unnecessary once each major is pinned per release and routed per MFE with import-map scopes, MF2 does not fit Angular's esbuild builder, and two sharing mechanisms in one page duplicate frameworks. The cost is a small loader the platform team owns.
17. **The shell is a header bar.** It renders no navigation; each app owns everything below the header. This removes the menu-tree contribution, breadcrumbs, and menu badges from the platform. Onboarding tours are a UI component, not a platform feature.
18. **Definition ids are local; the build adds the MFE prefix.** Writing `orders.` on every action, link, and store was a rule to learn and a lint to run, for information the build already has. Referenced ids (permissions, events, other MFEs' things) stay fully written because there is no implicit prefix from outside.
19. **Booleans only for binary switches; enums for anything with three or more states.** `modal`-style booleans were rejected for surfaces and action effects because two flags can both be true, and a boolean cannot grow a third value without a breaking change. `effect` (`read | write | destructive`) and `kind` stay enums; `persist`, `enabled`, `replace` stay booleans.

## Appendix F — Open Questions

Decisions the spec deliberately leaves to the organization; each needs an owner before Phase 1 ends.

- Where the registry and platform hub are hosted, and who operates them (platform team vs. shared infrastructure). Their URLs reach the shell as environment variables (§16.2).
- CDN choice and the concrete retention setting for releases.
- Whether the shell is one repository owned by the platform team, and how shell releases map to SDK versions (recommendation: SDK major = protocol major; the shell pins an SDK version).
- The first two pilot apps (one React, one Angular) used to validate the numbers in §53.
- Whether the Angular kit (`@tecton/angular`, not yet started) wraps CDK; the React kit is Tecton on shadcn/ui with the React Aria base.
- Message broker for hub publishing (Service Bus vs. RabbitMQ) and whether Azure SignalR Service is used.
- Analytics and telemetry vendors behind the vendor-neutral APIs.

## Appendix G — Change Log

**0.8.37** — Overlay model settled for the React-first start. The platform provides overlay containers only (stacking by mount then open order, CSS scope, shortcut suspension via `aria-modal`, close-on-unmount); focus trapping, Escape, scroll lock, and `aria-hidden` come from React Aria inside `@tecton/react`, which becomes an import-map singleton, with direct `react-aria-components`, `@base-ui/react`, and `sonner` imports forbidden in MFE bundles. Every surface has an escape hatch down to raw HTML: Tecton components, React Aria primitives re-exported from `@tecton/react/primitives`, or a raw container. Toasts gain `description`, `duration`, a dismiss handle, and `custom` / `content` for app-rendered content; confirmations gain the same `custom` / `content` with `confirm` / `cancel` controls while the shell keeps the frame, buttons, and result. Drawer means Tecton's `Sheet`; promise-based dialog hooks are kit conveniences. Appendix C and the open questions updated.

**0.8.36** — Naming and consistency pass before implementation. Platform packages are `@platform/*` (`core`, `react`, `angular`, `host`, `dev`, `testing`, `build`, `cli`, `devtools`, `styles`, `tailwind`); the UI kits are Tecton (`@tecton/react`, later `@tecton/angular`). Theme tokens are Tecton's shadcn CSS variables with no platform prefix; the theme class on `:root` replaces `data-pf-theme`. Releases inline the full manifest of every live version. Registry interface gains id claiming, version/manifest reads, a certification record uploaded by `mfe publish` and required by `PUT /live`, and its authentication model; deprecations and the dependency graph are Phase 5. Identity is a snapshot observer (`IdentitySnapshot | null`, `UserSnapshot` defined once); the named session events and the MFE-facing notifications subscription are removed. Manifest `paths` carry JSON Schema, the build converts Zod and Valibot and requires `jsonSchema` from other libraries, and declared paths are joined with `basePath` into absolute keys. Conformance checks are tagged with the phase that introduces them. Fixes: manifest icons are SVG strings; adapter factories take `basePath` everywhere; `injectMountContext` / `injectPermission(id)`; test-host context API removed and action calls take options objects; `audience` on release notes; `navigate` resolves `'committed' | 'cancelled'`; Appendix B.2 uses Zod. Shell configuration is §16.2: environment variables supplied to the container for per-deployment URLs, build-time options in the shell repository for everything else; the app switcher lists apps alphabetically.

**0.8.35** — Simplified frontend lifecycle and upgrades: navigation cancels and detaches outgoing instances without awaiting cleanup; late mounts are disposed once; widget updates are synchronous with app-owned asynchronous work. Logout/expiry use ordinary disposal and fresh clients on sign-in, while apps own caches and drafts. Each shell release provides one capability major; breaking upgrades are coordinated and open pages stay pinned until reload, with recovery for unavailable artifacts. Removed the public cleanup timeout and capability-overlap promise; updated examples and conformance expectations.

**0.8.34** — Renamed the request capability to `http`; added JSON convenience methods beside Fetch-compatible transport, with no implicit retries/caching, token exposure, duplicate connection observer, factories, or HTTP hooks. Removed automatic query-key/request mapping and updated React/Angular/test-host examples. Added app-supplied confirmation content with shell-owned execution, host-only provider interfaces for infrastructure, and props/events as the default widget-composition pattern; page events remain loose notifications.

**0.8.33** — Corrected calling conventions to preserve familiar positional reads/writes, hooks, and native wrappers while keeping options objects for configurable operations. Added the explicit Observer snapshot, notification, equality, lifetime, and adapter contract; added permissions/config `observe(key)` alongside existing reads. Clarified session-fixed permissions versus host-refreshed config and updated core, React, and Angular examples.

**0.8.32** — One fixed widget contract per id and one implementation per release; removed multi-contract support and use new ids for breaking redesigns. Actions now have live registration identities, entity target metadata, instance-bound buttons, focus-based resolution, explicit target selection for ambiguity, and pinned palette/confirmation targets. Added execution results, test-host targeting controls, and conformance scenarios; updated framework examples.

**0.8.31** — Removed platform autosave/recover/discard and storage-owned blockers; apps own draft workflows through plain key/value operations. Added explicit dependency declarations merged with build detection. MFEs own all routes, internal redirects, and not-found pages under their prefix; public `paths` are metadata for typed links and tooling, never a shell route allowlist. Widget compatibility and action targeting remain under discussion.

**0.8.30** — Storage restricted to key/value data in sessionStorage (`persist: false`, default) or localStorage (`persist: true`). Removed structured/indexed collections, the `kind` selector, and cross-device synchronization (`sync`); updated preference and tour examples. Autosave and widget compatibility policies remain pending discussion.

**0.8.29** — `MfeLink` renamed back to `PlatformLink` / `[platformLink]` (a platform primitive; `MfeWidget` keeps its name). Widget URL state removed: no `urlState` schema, slots, `useUrlState` / `injectUrlState`, or `navigation.href({ widgets })`; shareable widget state is a prop in and an event out, written to the consumer's own URL (§29.5).

**0.8.28** — Simplification pass: assistant (§47), global search (§46), feedback bundle (§40), and Tasks removed and listed under Deferred; `useCapability` / `injectCapability` and runtime capability status removed; preferences folded into storage as `sync: true` (`createPreference` removed); storage `sharedWith` and `scope: 'device'` removed; `platform.locale` reduced to a snapshot (no formatters); app `update` lifecycle removed (widgets keep `update(props)`); `isolation: 'shadow'` removed; stale `platform.context` and toast `command` references fixed; `effect` reworded without the assistant. Sections renumbered.

**0.8.27** — Entitlements and feature flags removed as concepts: no `entitlements` / `flags` requirements, hooks, catalogs, or capability; group-based rollout and `platform.config` cover the use cases (§33). §40 is Analytics and Audit. Listed under Deferred.

**0.8.26** — Permissions are Authentik groups: `can(id)` is a membership test on the session's `groups` claim; `mfe types` reads group names from Authentik; no permission catalog, mapping, or `permissions.check`; D.1 rewritten; identity-provider open question closed.

**0.8.25** — `Requirement = string[] | { any: string[] }` for static `permissions` / `entitlements` / `flags` on apps, actions, and search endpoints; the rule "static requirements are data, elaborate checks are app code" written into §33.

**0.8.24** — Network: `platformQueryFn` / `platformMutationFn` for TanStack Query `defaultOptions` (key-as-path, `meta.method`); `withPlatformInterceptors` usage shown. Usage examples use the defaults instead of hand-written `queryFn`s.

**0.8.23** — `createSettingsLink` removed: a settings entry is a `to` action with `placement: ['settings']`; the manifest's `settings` array folds into `actions`. `to` and `run` are mutually exclusive by type (`NavigationAction` vs `LiveAction`), with a runtime and `mfe validate` backstop.

**0.8.22** — `placement` is a list and the palette is one of its values: `Array<'palette' | 'page' | 'help'>`, default `['palette']`; an action can be in any combination, and one can be kept out of the palette. Shortcuts and the assistant are tied to registration, not placement.

**0.8.21** — Actions trimmed: `confirmation` removed (`effect` decides); `assistant: { description }` removed in favor of the ordinary `description` (all actions are visible to the assistant, filtered by permissions and effect); the framework-neutral `ctx.actions.register` handle moved to Appendix C; "no arguments in v1" recorded with the additive path for adding them. Appendix C.1 updated for flat `basePath`.

**0.8.20** — Placement is static: `placement: 'page' | 'help'` on `createAction` replaces both the live-half `pageAction: { priority }` and `menu: 'help'`; the live half is behavior only (`enabled`, `disabledReason`, `run`, `onError`). Header and Help menu order is manifest order.

**0.8.19** — Help is an action: `menu: 'help'` on `createAction` lists it in the shell's Help menu while available (static `to` actions of the mounted app; live actions while registered). `useHelp` / `injectHelp`, the help panel, `kb://` articles, and the knowledge base removed (Deferred). Help menu defined in §27.1. Sections after §44 renumbered.

**0.8.18** — Definition ids are local (`createAction({ id: 'approve' })`); `mfe build` prepends the MFE id for everything defined with `create*`. Referenced ids (permissions, events, page events, other MFEs' widgets/actions/paths) stay fully written. §8 rewritten; Appendix E decision 18.

**0.8.17** — Health capability removed (§40, `useHealth` / `injectHealth`, `health` on actions, the manifest `dependencies.health`, and the status-service contract in Appendix D); listed under Deferred. Sections after §39 renumbered.

**0.8.16** — Flattened options: `routes: { basePath, paths, redirects }` and `requires: { permissions, entitlements, flags, health }` become top-level keys on apps, actions, settings links, and search endpoints (and in the manifest). Action `effect` reduced to `read | write | destructive`, default `write`; `navigate` is a `to` action, `external` and `privileged` fold into `destructive`.

**0.8.15** — API consistency pass: `createApp.access` → `requires`; `PlatformLink` → `MfeLink` / `[mfeLink]`; `onResync` → `onReconnect`; `createReleaseNote.link` → `to`; single-id calls take the id directly (`flags.observe(id)`, `health.observe(ids)`); widget URL state is `set(next, { replace? })`; `ctx.host`, `navigation.invalidateBlockers`, and `capabilities.observe` removed from the public surface (`useCapability` / `injectCapability` remain); storage `eviction` reduced to `ttl`; `assistant: true` accepted on actions; Appendix E decision 18 (booleans vs enums).

**0.8.14** — Icons are SVG markup strings (`lucide-static` or a raw `.svg` import); no shell-pinned Lucide version, no icon catalog in `Register`.

**0.8.13** — (superseded) icons as Lucide names typed via `Register`.

**0.8.12** — Settings links and release notes are app contributions again (`createSettingsLink`, `createReleaseNote`), chosen for flexibility; release notes become visible when their version is live and may target an audience. Appendix subsection labels corrected.

**0.8.11** — (reverted in 0.8.12) settings by route convention; release notes from a content endpoint.

**0.8.10** — Layout removed entirely: no `layout` on apps or pages, no `fullscreen`, no `platform.surfaces.fullscreen`; the header bar is always visible and apps use the browser Fullscreen API themselves if they need the whole screen. Page metadata is `title` and `focusTarget`.

**0.8.9** — The shell renders only a header bar; apps own everything below it, including their own navigation. `createNavigation` and the menu tree removed; `title`/`icon`/`access` move onto `createApp`; `createSettingsLink` and `createReleaseNote` are the only shell-listed entries; breadcrumbs and menu badges removed from page metadata; responsive rule updated.

**0.8.8** — Multiple framework majors per release is the documented normal mode: shared per major, pinned per release, per-MFE import-map scopes; the platform controls only how many majors are alive (§20).

**0.8.7** — Module Federation / Native Federation explicitly not used (build or runtime); rationale in §20.

**0.8.6** — Surfaces split: the platform keeps a headless surface manager (`platform.surfaces.open` → stacked container with coordinated focus, Escape, scroll lock, shortcut suspension, close-on-unmount); `Dialog`/`Drawer` components and `useDialog`/`injectDialog` move to the UI kits and are built on it. `platform.surfaces.dialog`/`.drawer`/`.panel` removed.

**0.8.5** — Dialog headers: `title`, custom `header`, or `header: false` with `DialogClose` (§28.1).

**0.8.4** — Dialogs and drawers with framework content: `useDialog` / `useDrawer` (portal into the app's React tree) and `injectDialog` / `injectDrawer` / `injectDialogRef` (component created with the app's injector); `open()` resolves with the `close()` value (§28.1).

**0.8.3** — Adapter factories renamed: `createApp` / `createWidget` from `@platform/react` and `@platform/angular`; the import path names the framework.

**0.8.2** — `useAction` / `injectAction` expose `pending` and `error`; the platform disables every entry point while an action runs and prevents re-entry; `run` receives `progress` and `signal` for longer work; `onError` with a toast default.

**0.8.1** — Anchors removed as a platform concept; tests and the Tour component use `data-testid` prefixed with the app id.

**0.8** — Adapters build the router from the app's own route tree (`routeTree` / `routerRoutes` / `angularRoutes`); no `createPlatformHistory` or `AppProps` in app code. App `title`/`icon` default from the root menu item. Help registered from pages (`useHelp` / `injectHelp`); `createHelp` removed. Settings sections are app routes with `area: 'settings'` menu items; settings widgets removed. Page events need no declaration (`createPageEvent` removed). Frontend cannot publish in-app notifications. Onboarding removed as a platform feature in favor of a `Tour` component in the UI kits.

**0.7** — Context model removed. Actions split into a static half (manifest) and a live half registered from the component that has the data (`useAction` / `injectAction` / `ctx.actions.register`); static `to` actions for navigation; no `when`/`state`/`inputFromContext`/`execute`/`services`. Contributions are data evaluated at build time (no contributions module in the browser); menu `when`/`badge`/`items` replaced by runtime `useMenuItem`; search providers are backend endpoints; help matches on `route`. Destinations removed: declared paths (with params/search schemas) are the contract, typed via `Register`; renames are `routes.redirects`; notifications and backends link with plain paths; `dependencies.links` scanned.

**0.6** — Simplification pass: Axios support dropped (fetch, HttpClient, and TanStack Query only); actions absorb commands and shortcuts (`placement`, `when`, `state`, `inputFromContext`, `shortcut` on `createAction`); multi-tenancy removed entirely (no tenant switching, scopes, or headers — listed under Deferred); public lifecycle status reduced to `loading | ready | failed | unmounted`; context reduced to `entity`/`selection` kinds and three classifications; layout reduced to `default | fullscreen`, `toolbar` merged into `pageActions`, shortcut scopes to `page | global`, notifications to toast + in-app; per-MFE budget/timeout overrides and widget layout hints removed; `createAnalyticsEvent` removed; identity without account switching or step-up; drafts folded into storage as `autosave`.

**0.5** — Engineering-ready pass: context snapshot type (§34.1); test host API (§22.1); widget playground in dev mode (§22); id claiming (§8); full React/Angular adapter API (Appendix C); backend integration contract for .NET teams (Appendix D); decisions log (Appendix E); open questions (Appendix F); numeric targets marked as initial values; consistency fixes after the 0.4.x edits; table of contents.

**0.4.2** — Nothing derivable is authored: `protocol`, `requires`/`optional`, `owner`, and app `access` removed from definitions and derived by the build or from menu items; `createPermission`, `createServerEvent`, `createNotification`, `createFlag`, `createConfig` removed — those are owned by backend services and typed from their catalogs; `createAnchor` removed (scanned from templates); `createShortcut` folded into `createCommand.shortcut`; `createCapability` made platform-internal; `mfe types` runs automatically; `id` defaults to the package name.

**0.4.1** — APIs aligned with TanStack conventions (§9.2): `define*` renamed `create*`; every call takes one options object; readable state exposed as `Observer<T>` with `useObserver` / `injectObserver` wrappers; handlers receive one context object; `Register` module augmentation generated by `mfe types` for typed destinations, permissions, events, widgets, and capabilities; `caps.*` sugar removed.

**0.4** — Registry reduced to "which version is live" with a single pipeline call; channels, rollouts, and auto-rollback removed (pipeline concern). Snapshots renamed *releases* and simplified (fetch once, retention period, reload prompt; no signing or ids in the contract). One live version per widget with `contract.supports`; widget `execute` removed. Workers capability removed. Tasks marked Experimental. Cross-tab messaging internal to the shell. English-only: translation bundles removed, plain strings everywhere. Realtime renamed **server events**, specified on a single SignalR platform hub with topic-as-group semantics and publish-only microservices. Added **page events** for on-page messaging with the "same page → page event; anywhere else → server is the source of truth" rule. Added app switcher and `access` rules, shell-owned error and status pages, progress indicator, responsive rule. Tenant branding, impersonation, and branch previews not adopted.

**0.3.1** — Optional `routes.paths`; navigation menu contributions with permission-based visibility.

**0.3** — Scope narrowed to one client-rendered page with React and zoneless Angular; plain-language rationale per section; Deferred list.

**0.2** — Full rewrite of 0.1 with defined contracts, manifest, registry, navigation, CSS isolation, action pipeline, AI safety, conformance.

**0.1** — Initial draft.
