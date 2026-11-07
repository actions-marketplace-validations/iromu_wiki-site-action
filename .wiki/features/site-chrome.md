---
title: "Site chrome (sidebar, TOC, search, 404)"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "lib/build-site.js"
updated_at: "2026-11-07"
---

# Site chrome

Beyond converting Markdown, the generator produces the surrounding "chrome" that
makes the wiki navigable. These are the presentational builders in
`lib/build-site.js`.

## Sidebar

`buildSidebar` groups every non-home page by its top-level directory
(category). Categories are ordered: the configured `categories` list first, then
any extra directories appended, then each group's items sorted by title. The
sidebar also carries the brand link, the search box, and a "Home" link. The
active page gets an `.active` class.

## Table of contents

`buildTocHtml` renders the per-page "On this page" box from the `toc` collected
during parsing (headings at depth 2–3). Empty TOCs are omitted entirely.

## Client-side search

- At build time, each page contributes a `{ slug, title, path, category, text }`
  record to `searchIndex`; `text` is the body with code fences and Markdown
  punctuation stripped and lowercased.
- This is written to `search-index.js` as `window.SEARCH_INDEX = [...]`.
- `site.js` loads that file **lazily on first keystroke**, then does a simple
  substring match over title and text, capped at 20 results. If the index fails
  to load it shows "Search unavailable".

## Mobile nav and other JS

`site.js` also wires the hamburger menu toggle (opens the fixed sidebar on
narrow screens, with a scrim) and closes the nav when a link is clicked.

## Assets

Two stylesheets are written out: `style.css` (layout, prose, sidebar, responsive
breakpoint at 900px) and `highlight.css`. The highlight CSS is one of the
committed theme files under `dist/highlight-themes/` (default `github`, plus
`github-dark`, `atom-one-dark`, `monokai`, `xcode`, `vs`, `default`, `obsidian`,
`a11y-light/dark`, and more), chosen by the `highlight-theme` input and read at
build time (resolved from the working directory). An optional `custom-highlight-css`
file is appended after the base theme so it can override it. A minimal `404.html`
is also written.

## Source chips

Each page's `source_paths` frontmatter is rendered as clickable chips linking to
`https://github.com/<repo>/blob/<branch>/<path>` — the "view source" affordance
that ties wiki pages back to the code they document.

See [[build-pipeline]] for when these are produced.
