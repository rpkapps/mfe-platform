# MFE Platform

An enterprise microfrontend platform: apps own a URL prefix, widgets are mounted by apps, both ship a manifest, a registry records which versions are live, and the shell loads them as plain ES modules through an import map. The specification is `docs/spec.md`; worked examples are `docs/usage-examples.md`.

## Layout

| Path | What it is |
|---|---|
| `packages/sdk` | `@platform/sdk`: core types and factories, `host` (the headless runtime), `react` and `react/tanstack` adapters, `testing` (the test host), `styles.css` |
| `packages/cli` | `@platform/cli`: the `mfe` command (`build`, `dev`, `publish`, `promote`, `init`, `types`) |
| `packages/devtools` | `@platform/devtools`: the DevTools panel the shell loads behind a localStorage flag |
| `services/registry` | The registry: manifests, live versions, `GET /release`, and a development artifact store |
| `apps/shell` | The shell: header bar, app switcher, navigation, confirmations, error pages, MFE loading |
| `apps/orders` | The pilot app (React 19, TanStack Router folder routes) |
| `apps/customers` | A second app on React 18, to prove two React majors in one page |
| `apps/customer-card` | A widget (contract 2) mounted by both apps |
| `e2e` | A browser smoke test against a running registry and shell |

## Run it

```bash
pnpm install
pnpm start          # registry, build + publish the apps, build + serve the shell → http://localhost:4000/orders
```

`pnpm dev` does the same with the shell on Vite's dev server (hot reload for shell work; only the shell's React major is available there, so React 18 MFEs need `pnpm start`). `pnpm start --skip-apps` keeps whatever the registry already has. `pnpm e2e` runs the browser smoke test against a running `pnpm start`. `pnpm test` and `pnpm typecheck` cover every package.

The `mfe` CLI is compiled to JavaScript on `pnpm install` (`node packages/cli/build.mjs` rebuilds it). Rebuilding one app while everything runs: `cd apps/orders && pnpm exec mfe build && pnpm exec mfe publish --promote --replace` (`--replace` is accepted only by a registry running without a token, i.e. locally), then reload the browser.

The shell reads `/platform-env.json`, served from `PLATFORM_*` environment variables in dev and preview and written by the container entrypoint in the image built from `apps/shell/Dockerfile`.

## What the pilot exercises

- **Two React majors.** The shell builds one shared-library set per major (`vite.shared.config.ts`, `vite.shared18.config.ts`). The boot script in `index.html` builds the import map before any module loads: the shell's major globally, and a scope per MFE on another major keyed by its URL prefix. Orders (React 19) and Customers (React 18) run side by side; the DevTools Shared tab shows both sets and the scopes.
- **Widgets.** `customer-card` is mounted by Orders and by Customers (a React 19 widget inside a React 18 app), with typed props, an event back to the app, its own overlay root for popovers, and a cross-app link.
- **Style isolation.** Every MFE defines `.mfe-badge` and a `brand` colour with different values; the smoke test asserts the computed styles differ per MFE and that the widget looks the same in both hosts.
- **Command palette and shortcuts.** Mod+K opens the palette (apps, actions, help); manifest shortcuts such as Mod+Enter run the live action on screen through Tecton's shortcut registry, so typing rules hold. The header is Tecton's AppFinder and ShellActions.
- **Folder routes.** Apps use TanStack Router file routes under `src/routes/`; `mfe build` and `mfe dev` regenerate `src/routeTree.gen.ts`.

## DevTools and running an app from your machine

Set `localStorage.platform.devtools = "true"` in the browser and reload: a toggle appears bottom-right and opens the panel (MFEs, Shared, Instances, Actions, Navigation, Release, Telemetry). The panel is a separate chunk that only that browser loads; it works in every environment.

To run an app from your machine inside any shell, deployed or local:

```bash
cd apps/orders && pnpm exec mfe dev        # builds, serves dist/ on :4200 with CORS, rebuilds on change
```

Paste the printed manifest URL into the MFEs tab for `orders`, press "Apply and reload". The shell now loads Orders from your dev server; every rebuild is a browser reload away. "Clear all overrides" returns to the release.

## How the pieces fit

- `mfe build` bundles an app with `react`, `react-dom`, `react-aria-components`, `react-aria` and `@platform/sdk` left external, scopes its CSS under `@scope ([data-mfe-scope="orders@1"])`, and writes `manifest.json` from the definition and its contributions.
- `mfe publish` uploads `dist/` to the registry's artifact store and records the version; `mfe promote` (or `publish --promote`) makes it live. `GET /release` returns every live manifest.
- The shell builds its shared libraries once (`vite.shared.config.ts`), injects an import map, fetches the release, and mounts the app that owns the URL prefix. Apps and the shell use the same React copy.
