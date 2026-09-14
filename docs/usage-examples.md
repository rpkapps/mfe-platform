# MFE Platform — Usage Examples

Companion to spec v0.8.40 (adapter API in Appendix C, backend contract in Appendix D). Every example is complete enough to copy. Schemas use Zod, but any Standard Schema library works.

**Calling conventions.** Configurable operations use options objects (`navigate({ to, params, search })`). Familiar reads/writes, hooks, and native wrappers keep their signatures (`store.get(key)`, `store.set(key, value)`, `useAction(action, options)`, `http.fetch(input, init)`). Observer listeners use `subscribe(listener, options?)`. These signatures are intentional; no call-site migration is required.

---

## 1. A React app, end to end

### 1.1 Project layout

```text
orders/
  package.json            name: "orders"  → becomes the app id
  src/
    mfe.ts                the definition (entry module)
    contributions.ts      static actions, release notes — data only, evaluated at build time
    routes.tsx            your normal TanStack Router route tree; the root route provides the QueryClient
```

### 1.2 The definition

```ts
// src/mfe.ts
import { createApp } from '@platform/sdk/react/tanstack'   // the TanStack Router adapter; it is bundled with your app
import { Package } from 'lucide-static'
import { routeTree } from './routes'

export default createApp({
  title: 'Orders',
  icon: Package,                              // an SVG string from 'lucide-static' (or `import x from './x.svg?raw'`); the shell renders it
  permissions: ['orders-users'],   // an Authentik group; who sees the app in the switcher; a direct URL without it gets the 403 page
  basePath: '/orders',
  routeTree,                                  // your TanStack Router tree; the adapter builds the router around it
})
```

That's the whole entry point. `mfe build` produces the manifest and the scoped CSS. The shell renders only the header bar; everything below it — including your own navigation, if you want one — is your app's. `<Sidebar>` from `@tecton/react` is there if you want it to match the others.

### 1.3 The router

There is nothing to write for routing. The adapter creates the TanStack router from `routeTree` with the platform's history and your base path. Your routes, loaders, and `useBlocker` calls are exactly what they'd be in a standalone app. (React Router: pass `routerRoutes` instead of `routeTree`.)

Create an ordinary app-owned `QueryClient` in the root route. The platform does not install request mapping or shared caches:

```tsx
// src/routes.tsx (root route only)
import { useEffect, useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

function Root() {
  const [client] = useState(() => new QueryClient())
  useEffect(() => () => client.clear(), [client]) // app-owned cache cleanup on disposal
  return <QueryClientProvider client={client}><Outlet /></QueryClientProvider>
}
export const rootRoute = createRootRoute({ component: Root })
```

Pages use ordinary query and mutation functions calling `platform.http.get`/`post` or `platform.http.fetch`. Both share session handling, CSRF, trace ids, and MFE-lifetime cancellation. The app owns retries, caching, and invalidation; query keys are independent of request URLs. Keep the client inside the app instance: normal root disposal clears this cache, and a fresh mount creates a fresh client. Do not reuse a user-specific module-level cache across sign-ins.

### 1.4 Contributions

```ts
// src/contributions.ts
import { createAction, createReleaseNote } from '@platform/sdk'
import { Check, Plus, BookOpen, CircleHelp, Settings } from 'lucide-static'      // SVG strings; the shell renders contribution icons

// Ids are local; `mfe build` prefixes them with the app id (settings → orders.settings). Permissions are Authentik group names, typed by `mfe types`.

// Settings: your own page, listed on the shell's Settings screen. It's a navigation action placed in 'settings'.
export const settings = createAction({ id: 'settings', title: 'Order defaults', icon: Settings, to: '/orders/settings', permissions: { any: ['orders-admins', 'orders-supervisors'] }, placement: ['palette', 'settings'] })   // string[] = all; { any } = at least one

// Release notes: shown in the shell's "What's new" once this version is live.
export const v184 = createReleaseNote({ id: '18-4', version: '18.4', date: '2026-09-01', title: 'Bulk approval', body: 'Approve several orders at once from the list.', to: '/orders?whatsnew=18.4' })

// Static actions: what the shell knows before the app loads.
// A navigation action works even when the app isn't loaded.
export const newOrder = createAction({ id: 'new', title: 'Create order', icon: Plus, to: '/orders/new', shortcut: 'Mod+N' })

// Help is an action placed in the Help menu. This one is static: it sits in the shell's Help menu whenever Orders is mounted.
export const guide = createAction({ id: 'guide', title: 'Orders user guide', icon: BookOpen, to: 'https://docs.company.com/orders', placement: ['palette', 'help'] })
// This one is registered live by each page (§1.5) and opens the app's own help drawer on the right topic.
export const pageHelp = createAction({ id: 'page-help', title: 'Help for this page', icon: CircleHelp, placement: ['help'] })   // not in the palette; the Help menu is enough

// An action with behavior: title, icon, permission, shortcut, and placement here; enabled/run come from the component (§1.5).
export const approve = createAction({
  id: 'approve',                 // the build prefixes the app id: 'orders.approve'
  title: 'Approve order',
  icon: Check,
  permissions: ['orders-approvers'],
  shortcut: 'Mod+Enter',
  placement: ['palette', 'page'],   // default is ['palette']; add 'page' for a header button while a page has registered it
  description: 'Approves the order currently on screen',   // shown in the palette
})
```

Your MFE owns every route under `/orders`, including internal redirects and its not-found page. The shell only chooses the MFE by prefix. `paths` advertises routes for typed cross-app links; it is not a runtime allowlist. The build extracts static paths, and you explicitly declare public paths or schemas it cannot infer:

```ts
// src/mfe.ts
basePath: '/orders',
paths: { '/$orderId': { params: z.object({ orderId: z.string() }), search: z.object({ tab: z.enum(['summary', 'invoices']).optional() }) } },
```

For a wrapper or a runtime-selected widget that the build cannot inspect, explicitly list every possible dependency alongside the normal definition fields:

```ts
// src/mfe.ts
export default createApp({
  title: 'Orders', basePath: '/orders', routeTree,
  dependencies: {
    widgets: [{ id: 'customer-card', contract: 2 }],
    links: ['/customers/$customerId'],
  },
})
```

The build merges this list with detected dependencies and applies the same compatibility checks. Ordinary literal usage needs no extra declaration.

### 1.5 A page component using the platform

```tsx
// src/pages/OrderDetails.tsx
import { usePlatform, usePage, useAction, useServerEvent } from '@platform/sdk/react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { approve as approveAction, pageHelp } from '../contributions'
import { useHelpDrawer } from '../help'                    // your own drawer, see §9

export function OrderDetails({ orderId }: { orderId: string }) {
  const platform = usePlatform()
  const { data: order, refetch } = useQuery({
    queryKey: ['orders', orderId],
    queryFn: ({ signal }) => platform.http.get<Order>(`/api/orders/${encodeURIComponent(orderId)}`, { signal }),
  })
  const approveOrder = useMutation({
    mutationFn: ({ signal }: { signal: AbortSignal }) =>
      platform.http.post(`/api/orders/${encodeURIComponent(orderId)}/approve`, { signal }),
    onSuccess: () => refetch(),
  })

  // Document title and the header's page title. Breadcrumbs, if you want them, are yours to render in your area.
  usePage({ title: order ? `Order ${order.number}` : 'Order' })

  // The live half of "Approve order": while this component is mounted, the action is in the palette,
  // ⌘⏎ works, and it shows in the page header. Unmount, and it's gone.
  const approve = useAction(approveAction, {
    target: { key: orderId, label: `Order ${orderId}` },
    enabled: order?.status === 'pending',
    disabledReason: 'Only pending orders can be approved',
    run: ({ signal }) => approveOrder.mutateAsync({ signal }), // the action signal is passed explicitly
  })

  // "Help for this page" in the shell's Help menu opens your help drawer on this topic while this page is mounted.
  const helpDrawer = useHelpDrawer()
  useAction(pageHelp, { run: () => helpDrawer.open({ topic: 'approval' }) })

  // Refetch when someone else changes this order.
  useServerEvent({ event: 'orders.updated', params: { orderId }, onMessage: () => refetch() })

  if (!order) return <Skeleton />
  return (
    <>
      <h1 className="text-xl font-semibold">{order.number}</h1>
      <Button data-testid="orders.approve-button" onPress={approve.run} isDisabled={!approve.enabled} isPending={approve.pending}>
        Approve
      </Button>
    </>
  )
}
```

Permission checks are already inside `useAction` (the action's `permissions`); `approve.enabled` is false when the user lacks `orders-approvers`. While this registration is confirming or running, `approve.pending` is true, its shell controls are pending, and a second click does not invoke it again. Other registrations retain their own state. If it fails, the shell toasts the error unless you pass `onError`. The returned `approve.run()` is bound to this registration; it never resolves another instance by the action id.

When two mounted order widgets register the same action, each button approves its own order. Focus selects the target for shared controls:

| Interaction | Behavior |
|---|---|
| Click Approve in order 123 | Runs order 123's registration |
| Focus a control in order 456, then press the shortcut | Runs order 456's registration |
| Open the palette from order 456 | Shows “Approve order — Order 456” and pins that registration |
| Multiple candidates with no clear MFE focus | User selects a target; mount order never decides |
| Order 456 unmounts, changes target key, or becomes disabled while the palette is open | Its entry cannot execute; it never switches to order 123 |

`target.key` identifies the entity; `target.label` makes selection understandable. A changed key creates a new registration automatically in both adapters. Multiple registrations within one MFE instance require selection because the platform does not infer component-level focus scopes. A disabled or pending focused target never causes fallback to another widget.

```ts
// A caller holding a registration can target it explicitly.
const result = await platform.actions.run({
  id: approveAction.id,
  registrationId: approve.registrationId,
})
// Ambiguous calls with only id return { status: 'target-required' }.
// Stale registration ids return { status: 'unavailable' }.
```

### 1.6 Linking to another app

```tsx
import { PlatformLink } from '@platform/sdk/react'

<PlatformLink to="/customers/$customerId" params={{ customerId: order.customerId }} search={{ tab: 'orders' }}>
  {order.customerName}
</PlatformLink>
```

`to` must be a path the Customers app declared; `params` and `search` are type-checked against its manifest via `Register`. If Customers renames the path later, they add a redirect and this link keeps working. Programmatic form:

```ts
await platform.navigation.navigate({ to: '/customers/$customerId', params: { customerId } })
```

### 1.7 Running it

```bash
mfe dev            # the production shell in dev mode, with your app served locally
mfe validate       # conformance checks
mfe build          # manifest + contributions + scoped CSS + entry
mfe publish        # CI only
```

---

### 1.8 HTTP: choose the level of convenience

Both interfaces are on the same instance-scoped `platform.http`. No HTTP factory, hook, or TanStack-specific helper is needed.

```ts
// Native Fetch behavior: inspect the status and choose how to read the body.
const response = await platform.http.fetch('/api/orders/123', { signal })
if (!response.ok) throw new Error(`Request failed: ${response.status}`)
const order = await response.json()

// Convenient JSON response; non-2xx statuses reject with HttpError.
const sameOrder = await platform.http.get<Order>('/api/orders/123', { signal })
await platform.http.post('/api/orders/123/approve', {
  json: { comment: 'Approved' }, signal,
})

// Native bodies are also allowed; do not combine body and json.
await platform.http.post('/api/orders/123/attachments', { body: formData, signal })

// Use fetch for a non-JSON response.
const exportResponse = await platform.http.fetch('/api/orders/export', { signal })
if (!exportResponse.ok) throw new Error(`Export failed: ${exportResponse.status}`)
const file = await exportResponse.blob()
```

The same convenience methods exist for `put`, `patch`, and `delete`. They return parsed JSON or `null` for an empty successful body; `<Order>` provides compile-time typing, not runtime validation. `HttpError.response` is available if the app needs the backend's error body. Neither interface retries, caches, displays error toasts, or creates its own timeout. Apps can pass a timeout signal and choose retries in their query library. Connectivity remains `platform.connectivity.connection`.

### 1.9 Apps describe confirmations; the shell runs them

```ts
// contributions.ts
export const deleteOrder = createAction({
  id: 'delete', title: 'Delete order', effect: 'destructive',
  permissions: ['orders-admins'], placement: ['palette', 'page'],
})
```

```tsx
// Inside the order page; deleteOrder is the static action above.
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
<Button onPress={remove.run} isDisabled={!remove.enabled} isPending={remove.pending}>Delete</Button>
```

```ts
// Angular: the existing options function keeps the message up to date.
remove = injectAction(deleteOrder, () => ({
  target: { key: this.order().id, label: `Order ${this.order().id}` },
  enabled: this.order().canDelete,
  confirmation: {
    message: `Delete order ${this.order().id} and its ${this.order().invoiceCount} invoices?`,
    confirmLabel: 'Delete order',
  },
  run: ({ signal }) => this.platform.http.delete(`/api/orders/${encodeURIComponent(this.order().id)}`, { signal }),
}))
```

The app supplies plain text; the shell owns the dialog, buttons, focus, and confirmation result. Buttons, shortcuts, and palette entries all use the same pipeline. Destructive actions still require confirmation when the app supplies no message; the shell provides a default. Supplying confirmation content on another action requests a dialog too. Changed content requires fresh confirmation, and a removed/disabled/changed target never silently switches to another entity.

---

## 2. A widget, and using it from both frameworks

### 2.1 Defining a React widget

```ts
// customer-card/src/mfe.ts
import { createWidget } from '@platform/sdk/react'
import { z } from 'zod'
import { CustomerCard } from './CustomerCard'

export default createWidget({
  title: 'Customer card',
  contract: { version: 2 },                       // only contract 2; updates preserve this contract
  props: z.object({ customerId: z.string(), compact: z.boolean().optional() }),
  events: { selected: z.object({ customerId: z.string() }) },
  component: CustomerCard,
})
```

```tsx
// customer-card/src/CustomerCard.tsx
import { useWidget } from '@platform/sdk/react'

export function CustomerCard({ customerId, compact }: { customerId: string; compact?: boolean }) {
  const { emit } = useWidget()
  return <button onClick={() => emit({ event: 'selected', payload: { customerId } })}>…</button>
}
```

Each widget id supports one contract. Keep implementation updates compatible: an optional prop with a behavior-preserving default can be compatible; renaming a required prop or removing an event is not. Publish breaking redesigns under a new widget id, migrate consumers, then retire the old id after its dependents are gone. The registry checks exact contract-major matches on widget and consumer promotions.

### 2.2 Using it from a React app

```tsx
import { MfeWidget } from '@platform/sdk/react'

<MfeWidget
  id="customer-card"
  contract={2}
  props={{ customerId: order.customerId, compact: true }}
  on={{ selected: e => navigate({ to: '/customers/$customerId', params: { customerId: e.customerId } }) }}
  fallback="skeleton"
/>
```

### 2.3 Using it from an Angular app

```html
<mfe-widget
  id="customer-card"
  [contract]="2"
  [props]="{ customerId: order().customerId, compact: true }"
  (selected)="openCustomer($event.customerId)"
  fallback="skeleton" />
```

### 2.4 Framework-neutral (vanilla)

```ts
const handle = await platform.widgets.mount({
  id: 'customer-card', contract: 2, element, props: { customerId },
  on: { selected: e => console.log(e) }, signal,
})
handle.update({ customerId: 'other', compact: false }) // synchronous; returns void
handle.unmount()
```

`WidgetInstance.update(props)` returns `void`: pass the whole props object into the widget's normal rendering flow. React and Angular adapters do this for you; rendering may finish later. Data loading belongs inside the widget, with cancellation or stale-result handling when props change. There is no platform update queue. A thrown update error shows the widget fallback and disposes the instance; disposed instances cannot emit events or accept updates.

### 2.5 Widget state that belongs in the URL

A widget has no URL. If a tab or page number should be shareable and survive Back, it is a prop in and an event out; the consumer app keeps it in its own search params with its own router:

```ts
// the widget: a controlled component
export default createWidget({
  title: 'Orders table',
  contract: { version: 1 },
  props: z.object({ customerId: z.string(), tab: z.enum(['open', 'invoices']).default('open') }),
  events: { tabChanged: z.object({ tab: z.enum(['open', 'invoices']) }) },
  component: OrdersTable,
})

function OrdersTable({ tab }: Props) {
  const { emit } = useWidget()
  return <Tabs value={tab} onValueChange={tab => emit({ event: 'tabChanged', payload: { tab } })}>…</Tabs>
}
```

```tsx
// the consumer (Customers app, TanStack Router): the URL is the app's, so the app writes it
const { tab } = customerRoute.useSearch()                         // /customers/123?tab=invoices
const navigate = useNavigate()
<MfeWidget id="orders-table" contract={1} props={{ customerId, tab }}
           on={{ tabChanged: ({ tab }) => navigate({ search: prev => ({ ...prev, tab }) }) }} />
```

Two instances on one page are two props (`openTab`, `closedTab`) in the app's search params. Inside a dialog the same widget just gets `tab` from component state. Deep links are ordinary links to the app's path with its search params.

---

## 3. An Angular app (zoneless)

```ts
// src/mfe.ts
import { createApp } from '@platform/sdk/angular'
import { Package } from 'lucide-static'
import { ORDER_ROUTES } from './routes'

export default createApp({
  title: 'Orders',
  icon: Package,
  permissions: ['orders-users'],
  basePath: '/orders',
  angularRoutes: ORDER_ROUTES,       // the adapter adds zoneless change detection, the router, base href, and the platform location strategy
})
```

```ts
// order-details.component.ts
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core'
import { injectPlatform, injectPage, injectServerEvent, injectAction } from '@platform/sdk/angular'
import { approve as approveAction, pageHelp } from '../contributions'
import { HelpDrawerService } from '../help/help-drawer.service'   // your own drawer, see §9
import { OrdersApi } from '../orders-api'                          // the app's own data service

@Component({
  selector: 'orders-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-xl font-semibold">{{ order()?.number }}</h1>
    <pf-button data-testid="orders.approve-button" (click)="approve.run()" [disabled]="!approve.enabled()" [loading]="approve.pending()">Approve</pf-button>
  `,
})
export class OrderDetailsComponent {
  orderId = input.required<string>()
  platform = injectPlatform()
  api = inject(OrdersApi)
  order = signal<Order | null>(null)
  // Live half of the action; follows the order signal. `approve.enabled` is a Signal<boolean>.
  approve = injectAction(approveAction, () => ({
    target: { key: this.orderId(), label: `Order ${this.orderId()}` },
    enabled: this.order()?.status === 'pending',
    disabledReason: 'Only pending orders can be approved',
    run: () => this.api.approve(this.order()!.id).then(() => this.load()),
  }))

  helpDrawer = inject(HelpDrawerService)
  help = injectAction(pageHelp, () => ({ run: () => this.helpDrawer.open({ topic: 'approval' }) }))

  constructor() {
    injectPage(() => ({ title: this.order() ? `Order ${this.order()!.number}` : 'Order' }))
    injectServerEvent({ event: 'orders.updated', params: () => ({ orderId: this.orderId() }), onMessage: () => this.load() })
    this.load()
  }

  async load() {
    this.order.set(await this.platform.http.get<Order>(`/api/orders/${encodeURIComponent(this.orderId())}`))
  }
}
```

`CanDeactivate` guards keep working and participate in cross-app blocking automatically.

---

## 4. Navigation

### 4.1 Blocking navigation while a form is dirty

```tsx
// React — TanStack Router's own hook; the adapter bridges it to the platform
useBlocker({ shouldBlockFn: () => form.isDirty, withResolver: true })
```

```ts
// Framework-neutral
const handle = platform.navigation.block({
  shouldBlock: () => form.isDirty,
  signal: ctx.signal,
})
// handle.status is an Observer<'idle' | 'blocked' | 'proceeding'>
```

### 4.2 A backend link that never embeds a frontend URL

```json
{ "type": "orders.approved", "data": { "orderId": "123" }, "link": "/orders/123" }
```

A plain product-relative path. If Orders ever renames the route, its declared redirect keeps old links working.

### 4.1 Leaving an app and ending a session

After unsaved-change blockers approve navigation, the shell cancels the outgoing app's lifetime signal and detaches its UI. It starts the next app without awaiting outgoing cleanup. Pass the lifetime signal to app-owned work and keep synchronous cleanup short. If a cancelled mount finishes late, the shell disposes the returned instance once and never shows it. A mount that rejects must release any app-owned resources it created before failing.

Logout uses the existing unsaved-change confirmation; session expiry stops protected work immediately. Both clear shared user state and dispose current apps, widgets, requests, subscriptions, and dialogs without waiting to show sign-in. Apps release their memory caches through normal disposal, as the root `QueryClient` example does. Apps decide when to delete saved drafts using their scoped storage. A later login mounts fresh instances with fresh platform clients, including for the same user. Cancellation does not undo an operation already submitted to the server.

---

## 5. Session and local storage

Storage is plain key/value data. `persist: false` (the default) uses sessionStorage; `persist: true` uses localStorage on this browser. There is no IndexedDB, structured collection API, or device synchronization.

```ts
// contributions.ts
export const columnLayout = createStorage({
  id: 'column-layout', schema: ColumnLayoutSchema, version: 1,
  persist: true,                              // localStorage
})
export const orderDraft = createStorage({
  id: 'draft',
  schema: z.object({
    lines: z.array(z.object({ sku: z.string(), qty: z.number() })),
    note: z.string().optional(),
  }),
  version: 2,
  migrations: { 1: (v1: any) => ({ lines: v1.items, note: v1.comment }) },
  persist: false,                             // sessionStorage
})
```

```ts
const prefs = platform.storage.open(columnLayout)
await prefs.set('orders-table', { hidden: ['sku'], width: { number: 120 } })
const layout = await prefs.get('orders-table')
```

An app can save a draft explicitly using the same operations:

```ts
const drafts = platform.storage.open(orderDraft)

// Called by the app's Save draft button.
async function saveDraft() {
  await drafts.set(`order:${orderId}`, form.getValues())
}

// Called when the user chooses to restore a saved draft.
async function restoreDraft() {
  const saved = await drafts.get(`order:${orderId}`)
  if (saved) form.reset(saved)
}

// Called when the user chooses to discard it.
async function discardDraft() {
  await drafts.delete(`order:${orderId}`)
}
```

The platform has no autosave, recovery, or discard API and does not register storage blockers. Apps decide when to save and whether to prompt about unsaved changes through their router's blocker API (§4.1).

---

## 6. Server events and page events

### 6.1 Server → page (backend-initiated)

```tsx
useServerEvent({
  event: 'orders.updated',                 // typed from the hub catalog
  params: { orderId },
  onMessage: payload => queryClient.invalidateQueries({ queryKey: ['orders', orderId] }),
  onReconnect: () => queryClient.invalidateQueries({ queryKey: ['orders', orderId] }),   // after a reconnect
})
```

What the .NET side does (once, per event type) is publish the contract to the hub catalog and then:

```csharp
await _hub.PublishAsync("orders.updated", new { orderId = order.Id }, new { status = order.Status, changedBy = user.Id });
```

### 6.2 Normal composition: event to parent, props to siblings

The filter widget declares a `value` prop and a `changed` contract event. Each chart declares a `filter` prop. The consuming app owns the shared state:

```tsx
import { useState } from 'react'
import { MfeWidget } from '@platform/sdk/react'

type OrderFilter = { status: 'all' | 'pending' | 'approved' }

function OrdersDashboard() {
  const [filter, setFilter] = useState<OrderFilter>({ status: 'all' })
  return <>
    <MfeWidget id="orders-filter" contract={1}
      props={{ value: filter }} on={{ changed: setFilter }} />
    <MfeWidget id="orders-status-chart" contract={1} props={{ filter }} />
    <MfeWidget id="orders-value-chart" contract={1} props={{ filter }} />
  </>
}
```

The filter emits through its own contract:

```ts
const { emit } = useWidget()
emit({ event: 'changed', payload: { status: 'pending' } })
```

An Angular consumer uses the same contracts with a `filter` signal:

```html
<mfe-widget id="orders-filter" [contract]="1" [props]="{ value: filter() }"
  (changed)="filter.set($event)" />
<mfe-widget id="orders-status-chart" [contract]="1" [props]="{ filter: filter() }" />
<mfe-widget id="orders-value-chart" [contract]="1" [props]="{ filter: filter() }" />
```

Two dashboard instances have independent parent state. Widgets do not broadcast filters or need to know which siblings exist.

### 6.3 Page events: optional loose notifications

Use page events only when there is no suitable direct composition relationship and missing a notification is acceptable:

```ts
// A mounted preview widget announces a completed local operation.
platform.pageEvents.emit({ event: 'orders.preview-generated', payload: { orderId } })

// An optional mounted activity indicator listens; it is not authoritative state.
usePageEvent<{ orderId: string }>({
  event: 'orders.preview-generated',
  onMessage: ({ orderId }) => showPreviewActivity(orderId),
})
```

Required filters/selections flow through props and contract events. Durable changes belong on the server; apps refetch on mount and server-event notifications.

---

## 7. Overlays and toasts

The platform is not involved. You render dialogs, sheets, popovers, and toasts with Tecton exactly as in a standalone app; the adapter portals them into your instance's overlay root so your styles apply, and React Aria handles focus, Escape, and the backdrop. Stacking across MFEs follows mount order and is otherwise left alone.

```tsx
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@tecton/react/components/dialog'
import { Button } from '@tecton/react/components/button'

function OrderDetails({ order }) {
  const [rejecting, setRejecting] = useState(false)
  return (
    <>
      <Button onPress={() => setRejecting(true)}>Reject</Button>
      <Dialog isOpen={rejecting} onOpenChange={setRejecting}>
        <DialogHeader><DialogTitle>Reject order</DialogTitle></DialogHeader>
        <RejectForm order={order} onSubmit={async reason => { await api.reject(order.id, reason); setRejecting(false) }} onCancel={() => setRejecting(false)} />
      </Dialog>
    </>
  )
}
```

Another team's widget in a dialog is just content: `<Dialog …><MfeWidget id="customer-card" contract={2} props={{ customerId }} /></Dialog>`. Custom markup is `Dialog` with `showCloseButton={false}`, `DialogOverlay` around your own element, or a portal into `useMountContext().overlayRoot`; sanitize any HTML that did not come from your own code.

Toasts: render Tecton's `Toaster` once at your app root and call sonner's `toast()` as usual. The shell has its own toast region for its own messages.

```tsx
import { Toaster } from '@tecton/react/components/sonner'
import { toast } from 'sonner'

function Root() {
  return <QueryClientProvider client={client}><Outlet /><Toaster /></QueryClientProvider>
}
toast.success('Order approved')
```

Confirmation of a destructive action is the one dialog the shell renders, because the action pipeline owns it (§1.9). If plain text does not fit, resolve it yourself:

```tsx
confirmation: { custom: () => confirmWithInvoiceList(order) },   // your Promise<boolean>, e.g. a Tecton AlertDialog you render
```

---

## 8. Reading and observing shell-owned state

Snapshot reads remain available. Observers add updates without changing those calls:

```ts
const canApprove = platform.permissions.can('orders-approvers')
const maxRows = platform.config.get('orders.maxExportRows')

const approval = platform.permissions.observe('orders-approvers') // Observer<boolean>
const rowLimit = platform.config.observe('orders.maxExportRows')  // Observer<number>
// approval.get() === canApprove and rowLimit.get() === maxRows at this snapshot.
```

### 8.1 Framework-neutral subscription

```ts
// Inside mount(ctx). The host has already initialized required config.
const rowLimit = ctx.platform.config.observe('orders.maxExportRows')
const renderLimit = (value: number) => { label.textContent = `Export limit: ${value}` }

const unsubscribe = rowLimit.subscribe(renderLimit, { signal: ctx.signal })
renderLimit(rowLimit.get()) // subscribe does not emit an initial value

// Later, if this UI is removed before the whole MFE:
unsubscribe()              // idempotent; MFE unmount also cleans up
```

`get()` reads synchronously and does not fetch. A changed value is committed before listeners run. Unchanged values and changes to other keys produce no notification. Object snapshots are immutable and keep their reference until changed. Repeated calls to `observe` for the same key return the same observer on that client; each subscription has independent cleanup.

### 8.2 React

```tsx
import { useConfig, usePermission, usePlatform, useObserver } from '@platform/sdk/react'

function ExportStatus() {
  const platform = usePlatform()
  const maxRows = useConfig('orders.maxExportRows')
  const canApprove = usePermission('orders-approvers')
  const connection = useObserver(platform.connectivity.connection)

  return <p>Export limit: {maxRows}; approval access: {canApprove ? 'yes' : 'no'}; connection: {connection}</p>
}
```

`useConfig(key)` wraps `useObserver(platform.config.observe(key))`; `usePermission(id)` wraps the matching permission observer. Hooks initialize from the current snapshot and update reactively. Component unmount, key changes, and MFE unmount clean up subscriptions. A `useObserver` selector avoids rendering when its selected result remains `Object.is`-equal.

### 8.3 Angular

```ts
import { Component, ChangeDetectionStrategy } from '@angular/core'
import { injectConfig, injectPermission, injectPlatform, injectObserver } from '@platform/sdk/angular'

@Component({
  selector: 'orders-export-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>Export limit: {{ maxRows() }}; approval access: {{ canApprove() }}; connection: {{ connection() }}</p>`,
})
export class ExportStatusComponent {
  platform = injectPlatform()
  maxRows = injectConfig('orders.maxExportRows')
  canApprove = injectPermission('orders-approvers')
  connection = injectObserver(this.platform.connectivity.connection)
}
```

The keyed injectables wrap the same observers and return signals initialized with the current snapshot. Subscriptions end with their injection destruction scope or MFE unmount. Observing a value does not create a separate request or connection.

**Refresh behavior.** Theme and connection state change live. Config observers update when the host accepts a validated refresh; refresh timing belongs to the host. Permission checks reflect the current session's groups: backend group edits take effect on a new sign-in in this version, and session expiry makes checks false. An observer does not make session-fixed data refresh continuously. Release versions remain pinned until reload.

---

## 9. Help and tours

Help is an action whose `placement` includes `'help'` (see §1.4). The shell's Help menu has its own entries (shortcut sheet, product docs, support) and, below them, the mounted app's static help actions plus any registered live by the current page. What a help action does is up to you: a static `to` opens a URL; a live `run` opens whatever you like. The platform has no help content, article format, or panel.

**A rich help drawer** is app code: a Tecton `Sheet` (so it stacks and traps focus like any other overlay) with articles written as MDX in the repo, versioned and reviewed with the feature they describe, code-split so they cost nothing until opened.

```
src/help/
  index.tsx         HelpProvider + useHelpDrawer(); topics typed from the files below
  approval.mdx      "Approving orders" — ordinary MDX; it can import your own components
  filters.mdx
```

```tsx
// src/help/index.ts
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react'
import { Sheet, SheetHeader, SheetTitle } from '@tecton/react/components/sheet'

const topics = { approval: lazy(() => import('./approval.mdx')), filters: lazy(() => import('./filters.mdx')) }
export type Topic = keyof typeof topics

// App-owned state; the Sheet is a Tecton component rendered once at the app root.
const HelpContext = createContext<{ open(o: { topic: Topic }): void }>(null!)
export const useHelpDrawer = () => useContext(HelpContext)

export function HelpProvider({ children }: { children: ReactNode }) {
  const [topic, setTopic] = useState<Topic | null>(null)
  const Article = topic && topics[topic]
  return (
    <HelpContext.Provider value={{ open: ({ topic }) => setTopic(topic) }}>
      {children}
      <Sheet isOpen={topic !== null} onOpenChange={o => !o && setTopic(null)} side="right">
        <SheetHeader><SheetTitle>Help</SheetTitle></SheetHeader>
        {Article && <Suspense fallback={<Skeleton />}><Article /></Suspense>}
      </Sheet>
    </HelpContext.Provider>
  )
}
```

A "Try it" button in an article is your component calling the action handle's `run()`, so it goes through the same pipeline. Track article views with `platform.analytics.track` if you want to know what people read.

Onboarding tours are a UI component, not a platform feature (Tecton does not have one yet; Phase 4). They target elements by `data-testid` and store completion in a localStorage-backed store on this browser:

```tsx
import { Tour } from '@tecton/react'

<Tour
  id="orders.getting-started"                         // completion is stored per user on this browser (persist: true)
  steps={[
    { target: '[data-testid="orders.navigation"]', title: 'Orders', content: 'Find and approve orders here.' },
    { target: '[data-testid="orders.approve-button"]', title: 'Approve', content: 'Pending orders can be approved with ⌘⏎.' },
  ]}
/>
```

Prefix test ids with your app id so two apps on one page never collide.

---

## 10. Testing

```ts
import { createTestHost } from '@platform/sdk/testing'
import app from '../src/mfe'

test('approve action is disabled for non-pending orders', async () => {
  const host = createTestHost({ permissions: ['orders-users', 'orders-approvers'] })   // groups
  host.http.mock('/api/orders/123', { id: '123', number: 'SO-1', status: 'shipped' })
  const instance = await host.mount(app, { url: '/orders/123' })
  await host.settle()
  expect(host.actions.state({ id: 'orders.approve' })).toEqual({ status: 'disabled', reason: 'Only pending orders can be approved' })

  host.serverEvents.emit({ event: 'orders.updated', params: { orderId: '123' }, payload: { status: 'pending' } })
  await host.settle()
  expect(host.http.calls()).toContainEqual(expect.objectContaining({ url: '/api/orders/123' }))

  await instance.unmount() // test-only wait for cleanup; production navigation never waits
  expect(host.leaks()).toEqual([])
})
```

```ts
// failure injection
host.inject({ kind: 'server-events-disconnect' })
host.inject({ kind: 'storage-quota-exceeded' })
```

---

## 11. The pipeline side

```bash
# CI, on every merge
mfe validate --conformance
mfe build
mfe publish                                                 # uploads artifacts + manifest, records version 18.4.3

# Deployment pipeline, when it decides to ship
curl -X PUT https://registry.company/mfes/orders/live -d '{ "version": "18.4.3" }'

# Rollback is the same call
curl -X PUT https://registry.company/mfes/orders/live -d '{ "version": "18.4.2" }'
```

Users on an open session keep their shell, capabilities, and MFEs from the release they loaded; a small "update available" prompt appears within a minute. Reload adopts the new release together and respects unsaved-change blockers. If required old files are unavailable, the shell shows reload recovery instead of mixing releases.

Each shell release provides one major of each capability. Prefer compatible additions. A breaking capability change requires a coordinated shell and affected-app release that passes compatibility validation before publication; an individual app promotion is not enough to change the shell's capability major. There is no automatic 180-day capability overlap or adapter for older majors in the same shell.


---

## 12. Infrastructure providers (shell team only)

The shell configures providers once. Apps continue using `platform.identity`, `platform.permissions`, `platform.http`, `platform.config`, and `platform.serverEvents` regardless of the chosen infrastructure.

```ts
// apps/shell/src/main.tsx (abridged)
import { createBrowserHistory, createHostRuntime } from '@platform/sdk/host'
import { authentikIdentity } from './providers'   // an IdentitySource; the dev shell uses selectable profiles instead

const env = await fetch('/platform-env.json').then(r => r.json())            // written by the container entrypoint
const release = await fetch(`${env.PLATFORM_REGISTRY_URL}/release`).then(r => r.json())

const runtime = createHostRuntime({
  release,
  document,
  history: createBrowserHistory(),
  identity: authentikIdentity(env),
  apiOrigins: env.PLATFORM_API_ORIGINS.split(','),
  cdnUrl: env.PLATFORM_CDN_URL,
  confirm: request => shellDialog.ask(request),      // the shell renders text confirmations
  promptLeave: tx => shellDialog.askLeave(tx),       // and the "unsaved changes" prompt
})
runtime.attach({ content, overlays })
await runtime.start()
```

Each entry is a provider factory receiving the host lifetime signal. Factories initialize the required snapshots; the host exposes validated, instance-scoped clients and manages cleanup. Authentik and SignalR remain the default implementations. Dev mode and the test host substitute providers behind the same contracts. An MFE cannot register a provider, access its credentials, or replace a shared connection. Privileged catalog access stays in backend/tooling integrations.
