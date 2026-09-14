# MFE Platform

An enterprise microfrontend platform: apps own a URL prefix, widgets are mounted by apps, both ship a manifest, a registry records which versions are live, and the shell loads them as plain ES modules through an import map. The specification is `docs/spec.md`; worked examples are `docs/usage-examples.md`.

## Layout

| Path | What it is |
|---|---|
| `packages/sdk` | `@platform/sdk`: core types and factories, `host` (the headless runtime), `react` and `react/tanstack` adapters, `testing` (the test host), `styles.css` |
| `packages/cli` | `@platform/cli`: the `mfe` command (`build`, `publish`, `promote`, `init`, `types`) |
| `services/registry` | The registry: manifests, live versions, `GET /release`, and a development artifact store |
| `apps/shell` | The shell: header bar, app switcher, navigation, confirmations, error pages, MFE loading |
| `apps/orders` | The pilot app |
| `e2e` | A browser smoke test against a running registry and shell |

## Run it

```bash
pnpm install
pnpm --filter @platform/registry start                 # http://localhost:4100, data in services/registry/data
pnpm --filter orders build                             # mfe build → apps/orders/dist
(cd apps/orders && pnpm exec mfe init --team commerce-orders && pnpm exec mfe publish --promote)
pnpm --filter @platform/shell build && pnpm --filter @platform/shell preview   # http://localhost:4000
node e2e/smoke.mjs                                     # optional: the browser smoke test
```

`pnpm --filter @platform/shell dev` runs the shell with Vite's dev server; MFEs still come from the registry release. The shell reads `/platform-env.json` (served from `PLATFORM_*` environment variables in dev and preview, written by the container entrypoint in the image built from `apps/shell/Dockerfile`).

Tests: `pnpm test` (Vitest in every package). Typecheck: `pnpm typecheck`.

## How the pieces fit

- `mfe build` bundles an app with `react`, `react-dom`, `react-aria-components`, `react-aria` and `@platform/sdk` left external, scopes its CSS under `@scope ([data-mfe-scope="orders@1"])`, and writes `manifest.json` from the definition and its contributions.
- `mfe publish` uploads `dist/` to the registry's artifact store and records the version; `mfe promote` (or `publish --promote`) makes it live. `GET /release` returns every live manifest.
- The shell builds its shared libraries once (`vite.shared.config.ts`), injects an import map, fetches the release, and mounts the app that owns the URL prefix. Apps and the shell use the same React copy.
