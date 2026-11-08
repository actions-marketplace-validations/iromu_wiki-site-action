---
title: "Build pipeline"
type: "flow"
status: "active"
language: "default"
source_paths:
  - "src/build-site.js"
updated_at: "2026-11-07"
---

# Build pipeline

`buildSite()` in `src/build-site.js` is the spine of the action. It runs five
steps, in order, and returns a summary object: `{ pages, outDir, siteTitle,
brokenLinks, highlightTheme, highlightThemeDark, customHighlightCssApplied,
logo, ... }` (plus `*Error` strings when an optional asset is missing).

## 1. Discover and parse pages

- `findMarkdown(wikiDir)` walks the tree recursively and returns every `.md`
  file as a path relative to the wiki root.
- Each file is read and split with `gray-matter` into `data` (frontmatter) and
  `content` (body).
- Per page it computes:
  - `slug` = the filename without `.md` (used for `[[wiki-link]]` targets).
  - `category` = the top-level directory (empty for the root `index.md`).
  - `outRelPath` = the `.md` path with the extension swapped to `.html`.
  - `title` = frontmatter `title`, falling back to the slug.
  - `sourcePaths` = `source_paths`, normalized to a list (a bare string becomes
    a one-element list).

## 2. Resolve titles and categories

- `resolvedTitle` = explicit `siteTitle`, else the `index` page's `title`, else
  the literal `"Wiki"`.
- `catLabels` capitalizes each category name for the sidebar labels.
- `slugMap` maps every slug to its page — this is what lets `[[wikilinks]]`
  resolve. `brokenLinks` is reset to an empty set here.

## 3. Render each page

For every page, per-page state is reset (`currentPageDir`, `toc`, heading-id
set), then:

- The body is HTML-converted by `marked` (with highlighting and the
  `[[wikilink]]` extension — see [[static-site-generator]]).
- The `root` prefix is computed from the page's depth so assets and links reach
  the site root (nested pages get `../`, `../../`, etc.).
- `buildSidebar`, `buildTocHtml`, and `buildPageHtml` assemble the full HTML
  document (see [[site-chrome]]).
- The HTML is written to `outDir/<outRelPath>`, creating parent directories.
- A stripped-down text version of the body is appended to the search index.

## 4. Write static assets

Into the output root: `style.css` (the base site stylesheet with the derived
page palette appended — see [[site-chrome]]), `site.js`, `search-index.js` (the
JSON of `{ slug, title, path, category, text }` entries), `highlight.css` (the
**light** code theme), `highlight-dark.css` (the **dark** code theme),
`404.html`, and — when a `logo` is provided — the copied logo image. The theme
CSS and the base stylesheet are read into memory **before** the output directory
is cleared, so the build works even when `out-dir` points at the action's own
`dist/`.

## 5. Return a summary

Returns the page count, output dir, resolved site title, and the array of
broken-link slugs (which `src/index.js` turns into a warning).

The whole output directory is wiped and recreated at the start
(`rmSync` + `mkdirSync`), so a build is always idempotent.
