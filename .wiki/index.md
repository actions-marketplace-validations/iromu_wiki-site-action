---
title: "wiki-site-action Wiki"
type: "index"
status: "active"
language: "default"
last_commit: "6c1756571381feeda733e3d0f77181d94a593d87"
updated_at: "2026-11-07"
---

# wiki-site-action

A reusable **GitHub Action** that turns a `.wiki/` folder of Markdown pages into a
browsable static site — category sidebar, per-page table of contents, `[[wiki-link]]`
resolution, client-side full-text search, light/dark theming, and syntax
highlighting whose colors also drive the page palette.

## What is this?

It is a build-only static-site generator packaged as a GitHub Action. Given a
directory of Markdown files (the "wiki"), it renders each page to HTML and writes
the whole site into an output directory. **It does not deploy anything** — the
consuming workflow uploads the output directory and publishes it (see
[[how-it-works]] for the intended GitHub Pages pattern).

## Get started

The main command is the action itself, run from a workflow. Locally, the entry
point is `src/index.js` and the smoke test is:

```sh
npm install
npm test        # builds a fixture wiki and checks the generated site
npm run build   # copy runtime assets into dist/ + bundle src/index.js -> dist/index.cjs (committed)
npm run preview # build via the committed dist/index.cjs and serve it locally
```

Required context: it reads `GITHUB_REPOSITORY` / `GITHUB_REF_NAME` (or the
`github-repo` / `github-branch` inputs) to build "view source" links. Expected
success output: `Built N pages (site title: "...")`.

First files to read, in order:

1. `action.yml` — the contract: inputs and the entry point.
2. `src/index.js` — the thin entry that wires inputs to the builder.
3. `src/build-site.js` — the entire generator (the bulk of the code).
4. `test/smoke.js` — the behavioral expectations.

A safe first change: add a new category name to the default `categories` list in
both `action.yml` and `src/build-site.js`. A tempting dangerous change: editing
`dist/index.cjs` by hand (it is a generated bundle — see [[bundle-and-docs-drift]]).

## Why does it exist?

So a repo's `.wiki/` knowledge base can be published as a clean, navigable static
site on GitHub Pages without a heavy build tool. The action is deliberately
narrow: one job — Markdown in, static site out.

## What happens when I run it?

`src/index.js` reads the inputs, resolves the wiki and output directories, and calls
`buildSite()`. The builder discovers every `.md` file, parses frontmatter,
converts the body to HTML, resolves `[[wiki-links]]`, then writes each page plus
the shared assets (CSS, JS, search index, 404 page) into the output directory.
See [[build-pipeline]] for the exact steps.

## Where is data saved?

The action **writes** the site to `out-dir` (default `dist-site/`), overwriting it. It
**reads** from `wiki-dir` (default `.wiki/`). Nothing is persisted across runs —
the output is fully regenerated every time. The generated `dist/index.cjs`
bundle is committed to the repo and is the thing the action actually executes.

## Important moving parts

- `action.yml` — inputs, defaults, and the `node24` entry point.
- `src/index.js` — input handling and the single `buildSite()` call.
- `src/build-site.js` — the generator: page discovery, `[[wiki-link]]`
  resolution, sidebar/TOC/search/404, and inlined CSS/JS. See
  [[static-site-generator]] and [[site-chrome]].
- `test/smoke.js` — the only test; it is the safety net for the build.
- `scripts/` and the committed `dist/` — the build tooling and the runtime
  artifact (bundle + highlight themes + stylesheet); CI keeps them in sync. See
  [[build-and-dev]].
- Inputs and frontmatter conventions: see [[action-inputs]].

## What should I avoid breaking?

- The committed `dist/` (bundle + assets) must be regenerated with `npm run build`
  after any change to `src/` — the action runs the bundle, not the source. CI now
  fails if the committed `dist/` drifts from `src/`. See [[bundle-and-docs-drift]]
  and [[build-and-dev]].
- The smoke test's expectations (page count, link resolution, asset roots) encode
  real behavior; keep them green.
- Nested pages must use the right `../` asset prefix or their CSS/JS breaks.

## Where do I look first?

Start in `src/build-site.js`. The `buildSite()` function at the bottom is the
spine; everything above it (renderers, builders, inlined CSS/JS) is called from
there. For the local dev loop (build, preview, CI) see [[build-and-dev]].
