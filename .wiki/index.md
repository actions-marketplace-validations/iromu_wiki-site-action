---
title: "wiki-site-action Wiki"
type: "index"
status: "active"
language: "default"
last_commit: "9ef57456f767bc2d87753223e6e748b0233b846f"
updated_at: "2026-11-07"
---

# wiki-site-action

A reusable **GitHub Action** that turns a `.wiki/` folder of Markdown pages into a
browsable static site — category sidebar, per-page table of contents, `[[wiki-link]]`
resolution, code highlighting, and client-side full-text search.

## What is this?

It is a build-only static-site generator packaged as a GitHub Action. Given a
directory of Markdown files (the "wiki"), it renders each page to HTML and writes
the whole site into an output directory. **It does not deploy anything** — the
consuming workflow uploads the output directory and publishes it (see
[[how-it-works]] for the intended GitHub Pages pattern).

## Get started

The main command is the action itself, run from a workflow. Locally, the entry
point is `index.js` and the smoke test is:

```sh
npm install
npm test        # builds a fixture wiki and checks the generated site
npm run build   # bundle index.js -> dist/index.cjs (this file is committed)
```

Required context: it reads `GITHUB_REPOSITORY` / `GITHUB_REF_NAME` (or the
`github-repo` / `github-branch` inputs) to build "view source" links. Expected
success output: `Built N pages (site title: "...")`.

First files to read, in order:

1. `action.yml` — the contract: inputs and the entry point.
2. `index.js` — the thin entry that wires inputs to the builder.
3. `lib/build-site.js` — the entire generator (the bulk of the code).
4. `test/smoke.js` — the behavioral expectations.

A safe first change: add a new category name to the default `categories` list in
both `action.yml` and `lib/build-site.js`. A tempting dangerous change: editing
`dist/index.cjs` by hand (it is a generated bundle — see [[bundle-and-docs-drift]]).

## Why does it exist?

So a repo's `.wiki/` knowledge base can be published as a clean, navigable static
site on GitHub Pages without a heavy build tool. The action is deliberately
narrow: one job — Markdown in, static site out.

## What happens when I run it?

`index.js` reads the inputs, resolves the wiki and output directories, and calls
`buildSite()`. The builder discovers every `.md` file, parses frontmatter,
converts the body to HTML, resolves `[[wiki-links]]`, then writes each page plus
the shared assets (CSS, JS, search index, 404 page) into the output directory.
See [[build-pipeline]] for the exact steps.

## Where is data saved?

The action **writes** the site to `out-dir` (default `dist/`), overwriting it. It
**reads** from `wiki-dir` (default `.wiki/`). Nothing is persisted across runs —
the output is fully regenerated every time. The generated `dist/index.cjs`
bundle is committed to the repo and is the thing the action actually executes.

## Important moving parts

- `action.yml` — inputs, defaults, and the `node24` entry point.
- `index.js` — input handling and the single `buildSite()` call.
- `lib/build-site.js` — the generator: page discovery, `[[wiki-link]]`
  resolution, sidebar/TOC/search/404, and inlined CSS/JS. See
  [[static-site-generator]] and [[site-chrome]].
- `test/smoke.js` — the only test; it is the safety net for the build.
- Inputs and frontmatter conventions: see [[action-inputs]].

## What should I avoid breaking?

- The `dist/index.cjs` bundle must be rebuilt with `npm run build` after any
  change to `index.js` or `lib/*`, and committed — the action runs the bundle,
  not the source. See [[bundle-and-docs-drift]].
- The smoke test's expectations (page count, link resolution, asset roots) encode
  real behavior; keep them green.
- Nested pages must use the right `../` asset prefix or their CSS/JS breaks.

## Where do I look first?

Start in `lib/build-site.js`. The `buildSite()` function at the bottom is the
spine; everything above it (renderers, builders, inlined CSS/JS) is called from
there.
