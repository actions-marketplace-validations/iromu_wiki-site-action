---
title: "Action inputs and frontmatter"
type: "entity"
status: "active"
language: "default"
source_paths:
  - "action.yml"
  - "index.js"
  - "lib/build-site.js"
updated_at: "2026-11-07"
---

# Action inputs and frontmatter

The two shapes of configuration the action consumes: the workflow inputs
(declared in `action.yml`, read in `index.js`) and the per-page YAML frontmatter
(parsed in `lib/build-site.js`).

## Workflow inputs

| Input            | Default                                              | Notes |
| ---------------- | ---------------------------------------------------- | ----- |
| `wiki-dir`       | `.wiki`                                              | Source wiki, relative to repo root. |
| `out-dir`        | `dist`                                               | Where the site is written (overwritten). |
| `site-title`     | *(index page `title`)*                               | Brand / page titles / 404 title. |
| `github-repo`    | `GITHUB_REPOSITORY`                                  | `owner/repo` for source links; required. |
| `github-branch`  | `GITHUB_REF_NAME`                                    | Branch for source links. |
| `categories`     | `overview,entities,concepts,flows,features,risks,reference` | Ordered sidebar dirs; unlisted dirs are appended. |

`index.js` splits `categories` on commas, trims, and drops empties. Note the
default `categories` string is duplicated in `action.yml` and in
`lib/build-site.js` (`DEFAULT_CATEGORIES`) — keep them in sync.

## Per-page frontmatter

| Field          | Use |
| -------------- | --- |
| `title`        | Sidebar/TOC/404 title; defaults to the filename. |
| `type`         | Carried through but not used in rendering. |
| `updated_at`   | Shown in the page meta line. |
| `source_paths` | "View source" chips; a string or a list of strings. |

A page's **category** is not a frontmatter field — it is derived from the
page's top-level directory under the wiki root. The root `index.md` is the home
page and (unless `site-title` is set) supplies the site title.

## Defaults that matter

- Site title falls back: `site-title` → `index` page `title` → `"Wiki"`.
- Category labels are auto-capitalized (`concepts` → `Concepts`).
- `github-repo` is the only hard requirement; if it cannot be determined the
  action throws. See [[how-it-works]].
