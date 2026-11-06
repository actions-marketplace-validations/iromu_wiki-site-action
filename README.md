# wiki-site-action

A reusable GitHub Action that builds a `.wiki/` Markdown knowledge base into a
browsable static site and publishes it to a branch for GitHub Pages.

The generated site includes:

- a category sidebar (grouped by top-level wiki directory)
- per-page table of contents
- `[[wiki-link]]` resolution (broken links are flagged, not dropped)
- syntax highlighting (highlight.js "GitHub" theme)
- lightweight client-side full-text search
- a 404 page

## Usage

The action must run in a workflow that checks out the repo and grants
`contents: write` (needed to push the publish branch):

```yaml
on:
  push:
    branches: [main]
    paths:
      - '.wiki/**'
      - '.github/workflows/wiki-pages.yml'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: iromu/wiki-site-action@v1
        with:
          wiki-dir: .wiki
          publish-branch: gh-pages
```

### Inputs

| Name             | Default                                              | Description                                                        |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `wiki-dir`       | `.wiki`                                              | Source wiki directory, relative to the repo root.                   |
| `out-dir`        | `dist`                                               | Where the built site is written, relative to the repo root.         |
| `site-title`     | _(index page `title`)_                               | Brand / page-title / 404 title. Falls back to the index `title`.    |
| `github-repo`    | _(current repo)_                                     | `owner/repo` used for "view source" links.                          |
| `github-branch`  | _(current branch)_                                   | Branch used for "view source" links.                                |
| `categories`     | `overview,entities,concepts,flows,features,risks,reference` | Comma-separated sidebar order; unlisted dirs are appended.   |
| `publish-branch` | `gh-pages`                                           | Branch to publish the site to.                                      |
| `subfolder`      | _(empty)_                                            | Optional subpath within the branch (e.g. `docs` for project pages). |

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

`index.js` reads the inputs, calls `buildSite()` (in `lib/build-site.js`) to
render the site, then calls `publish()` (in `lib/publish.js`) to deploy it.
Publishing stages the deploy in a throwaway clone — it checks out (or creates)
the publish branch, replaces its contents with the built site, commits, and
pushes — without ever disturbing the workflow's checkout.

## Development

```sh
npm install
npm test     # build + publish smoke test against a throwaway git origin
npm run build   # bundle index.js -> dist/index.cjs (committed)
```

`dist/index.cjs` is the bundled entry the action runs (see `action.yml`); it is
committed so the action has no install step. After changing `index.js` or
`lib/*`, re-run `npm run build` and commit the new bundle.
