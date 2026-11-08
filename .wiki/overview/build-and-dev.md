---
title: "Build, preview, and CI tooling"
type: "overview"
status: "active"
language: "default"
source_paths:
  - "package.json"
  - "scripts/copy-assets.js"
  - "scripts/preview.js"
  - ".github/workflows/ci.yml"
updated_at: "2026-11-07"
---

# Build, preview, and CI tooling

Because this is a GitHub Action, its runtime artifact is a **committed** bundle
plus the assets the generator reads at build time. The `npm` scripts and the CI
workflow exist to keep that artifact in sync with the source.

## `npm run build` — regenerate `dist/`

`npm run build` does two things, in order:

1. `scripts/copy-assets.js` copies the runtime assets the generator needs:
   - every highlight.js theme (`node_modules/highlight.js/styles/*.min.css`) →
     `dist/highlight-themes/` (so any theme name is selectable), and
   - `src/style.css` → `dist/style.css`.
2. `esbuild src/index.js --bundle --platform=node --format=cjs --target=node24`
   → `dist/index.cjs` (the entry the action runs).

`dist/` is **committed**, so the action has no install step at run time. After
changing anything under `src/`, re-run `npm run build` and commit the new
`dist/` — see [[bundle-and-docs-drift]].

## `npm run preview` — build and serve locally

`scripts/preview.js` is the local dogfood loop. It does **not** import the
source: it spawns the committed `dist/index.cjs` with the same `INPUT_*`
environment variables the action would get, waits for the build to finish, then
serves the generated `out-dir` over a local HTTP server (with a MIME map so
`.js` is served as `application/javascript`). In `--watch` mode it rebuilds on
`.md` changes. This is how you see exactly what the action will produce.

## CI — keep `dist/` in sync with `src/`

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests:

1. `npm ci`
2. `npm run build`
3. `git diff --exit-code -- dist/` — **fails if the committed `dist/` does not
   match what `npm run build` produces from the current `src/`**. This is the
   guard against shipping a stale bundle.
4. `npm test`

The deploy workflow (`.github/workflows/wiki-pages.yml`) is separate: it runs
this repo's own action (`uses: ./`) to build the site and publishes it to
GitHub Pages — see [[how-it-works]].

## Repository layout

- `src/` — the source: `index.js` (entry), `build-site.js` (generator),
  `style.css` (site stylesheet).
- `scripts/` — dev/build tooling: `copy-assets.js`, `preview.js`.
- `test/` — the smoke test (`smoke.js`).
- `dist/` — the committed runtime artifact (bundle + highlight themes +
  stylesheet).
- `.github/workflows/` — CI and the Pages deploy.

See [[how-it-works]] for the runtime path and [[build-pipeline]] for the
generator's internal steps.
