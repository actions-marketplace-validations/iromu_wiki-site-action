# wiki-site-action

A reusable GitHub Action that builds a `.wiki/` Markdown knowledge base into a
browsable static site. It writes the site to an output directory; the consuming
workflow uploads that directory with `actions/upload-pages-artifact` and deploys
it with `actions/deploy-pages` (the official GitHub Pages custom-workflow
approach).

The generated site includes:

- a category sidebar (grouped by top-level wiki directory)
- light/dark mode that follows the system theme, with a manual toggle
- per-page table of contents
- `[[wiki-link]]` resolution (broken links are flagged, not dropped)
- syntax highlighting (separate light + dark highlight.js themes from `dist/highlight-themes/`, plus optional custom CSS overrides)
- a page palette that adopts the colors of the selected highlight themes, so the whole site — not just code blocks — matches the theme
- a GitHub icon linking to the repo, and an optional sidebar logo
- lightweight client-side full-text search
- a 404 page

## Generating the wiki

The `.wiki/` directory this action builds is typically produced by the
[git-wiki skill](https://github.com/yysun/awesome-agent-world/blob/main/skills/git-wiki/SKILL.md),
which documents a codebase as a Markdown knowledge base. Install it with:

```sh
npx skills add yysun/awesome-agent-world --skill git-wiki
```

Then inside an AI agent session, prompt `create the wiki`.

The skill generates the wiki pages (with the frontmatter conventions below)
that this action renders into a site.

## Usage

Pair the action with the standard "Deploy static site to Pages" pattern. The
repo's Pages publishing source must be set to **GitHub Actions** (Settings →
Pages → Source).

```yaml
name: Deploy static site to Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: iromu/wiki-site-action@v2.0.2
        with:
          wiki-dir: .wiki
          out-dir: dist-site
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist-site

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v1
```

### Inputs

| Name          | Default                                              | Description                                                  |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `wiki-dir`    | `.wiki`                                              | Source wiki directory, relative to the repo root.             |
| `out-dir`     | `dist-site`                                          | Where the built site is written, relative to the repo root. Kept separate from the action's own `dist/`. |
| `site-title`  | _(index page `title`)_                               | Brand / page-title / 404 title. Falls back to the index `title`. |
| `github-repo` | _(current repo)_                                     | `owner/repo` used for "view source" links.                    |
| `github-branch`| _(current branch)_                                   | Branch used for "view source" links.                          |
| `categories`  | `overview,entities,concepts,flows,features,risks,reference` | Comma-separated sidebar order; unlisted dirs are appended. |
| `highlight-theme` | `github`                                    | highlight.js theme for code blocks in light mode (see `dist/highlight-themes/`); its base colors also drive the light-mode page palette. Unknown values fall back to `github`. |
| `highlight-theme-dark` | `github-dark`                          | highlight.js theme for code blocks in dark mode; its base colors also drive the dark-mode page palette. Unknown values fall back to `github-dark`. |
| `custom-highlight-css` | _(empty)_                              | Path to a CSS file appended after the theme to override or extend it. |
| `logo` | _(empty)_ | Path to a logo image shown in the sidebar next to the site title. |

### Frontmatter conventions

Each page is a Markdown file with optional YAML frontmatter:

```yaml
---
title: "Page Title"        # sidebar/TOC/404; defaults to the file name
updated_at: "2026-01-01"    # shown in the page meta
source_paths:               # "view source" chips; string or list of strings
  - "src/Foo.java"
---
```

A page's category is its top-level directory under the wiki root; the root
`index.md` is the home page and (unless `site-title` is set) supplies the site
title.

## How it works

`src/index.js` reads the inputs and calls `buildSite()` (in `src/build-site.js`)
to render the site into `out-dir`. That's it — deployment is the consuming
workflow's job.

## Development

```sh
npm install
npm test      # build smoke test against a fixture wiki
npm run build # copy runtime assets into dist/ + bundle src/index.js -> dist/index.cjs (committed)
npm run preview # build via the committed dist/index.cjs and serve it locally
```

`dist/index.cjs` is the bundled entry the action runs (see `action.yml`); it is
committed so the action has no install step. `npm run build` first runs
`scripts/copy-assets.js` to copy the highlight.js `*.min.css` themes into
`dist/highlight-themes/` and `src/style.css` into `dist/style.css`, then bundles
`src/index.js`. After changing anything under `src/`, re-run `npm run build`
and commit the new bundle and assets (the CI workflow fails if the committed
`dist/` drifts from the source).
