---
title: "Static site generator (Markdown → HTML)"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/build-site.js"
updated_at: "2026-11-07"
---

# Static site generator (Markdown → HTML)

The core capability: converting a Markdown wiki into HTML. It is configured once
at module load in `src/build-site.js` via `marked.use(...)` and driven by
per-page state that `buildSite()` resets before each render.

## Markdown engine

`marked` does the conversion, with two additions:

- **Syntax highlighting** — `marked-highlight` calls `highlight.js` when a code
  fence names a known language; otherwise the code is HTML-escaped. The result
  is styled by the selected highlight theme (default `github`; see
  [[site-chrome]] and the `highlight-theme` input).
- **`[[wikilink]]` extension** — an inline tokenizer/renderer that turns
  `[[slug]]`, `[[slug|label]]`, and `[[slug#anchor]]` into internal links.

## `[[wikilink]]` resolution

This is the feature's signature behavior:

- The tokenizer splits the inner text into `slug`, optional `#anchor`, and an
  optional `|label` (the visible text).
- The renderer looks the slug up in `slugMap` (built in step 2 of
  [[build-pipeline]]).
  - If found: emits `<a class="wikilink" href="...">` using a path relative to
    the current page's directory, with the anchor appended if present.
  - If not found: the slug is added to `brokenLinks` and a
    `<a class="wikilink-missing">` is emitted — **broken links are flagged, not
    dropped**. The caller (`src/index.js`) surfaces the count as a warning.

## Heading anchors and TOC

A custom `heading` renderer assigns each heading a GitHub-style slug id
(`slugify`, with numeric suffixes to stay unique within a page). Headings at
depth 2–3 are collected into the page's `toc`, which becomes the "On this
page" box.

## Per-page state

`slugMap`, `brokenLinks`, `currentPageDir`, `toc`, and the used-heading-id set
are module-level variables reset per page, because the `marked` renderer/
extension are configured once and read this shared state at parse time. This is
a subtle invariant: the renderers are not self-contained, they depend on the
reset happening before each `marked.parse`.

See [[build-pipeline]] for where this fits in the overall build.
