---
title: "How it works (and how it is deployed)"
type: "overview"
status: "active"
language: "default"
source_paths:
  - "action.yml"
  - "index.js"
updated_at: "2026-11-07"
---

# How it works

The action has a single runtime entry: `dist/index.cjs` (declared in
`action.yml` under `runs.main`). That file is an **esbuild bundle** of
`index.js` and its imports — it is committed so the action needs no install step
at run time.

## Runtime path

1. GitHub Actions checks out the repo and invokes the action.
2. `index.js` reads the inputs (`wiki-dir`, `out-dir`, `site-title`,
   `github-repo`, `github-branch`, `categories`) via `@actions/core`.
3. It fills in defaults from the environment when the caller omits them:
   `github-repo` ← `GITHUB_REPOSITORY`, `github-branch` ← `GITHUB_REF_NAME`.
   If `github-repo` still cannot be determined, it throws.
4. It calls `buildSite()` from `lib/build-site.js`, which renders the whole site
   into `out-dir`. See [[build-pipeline]] for the internal steps.
5. It logs the page count and warns about any unresolvable `[[wiki-links]]`.
   On error, `core.setFailed(err.message)` marks the step red.

## Build-only, not a publisher

As of `v2`, the action **stops after building**. It writes the site to `out-dir`
and does nothing else. Publishing is the consuming workflow's job, using the
official GitHub Pages custom-workflow pattern:

```yaml
- uses: iromu/wiki-site-action@v2
  with: { wiki-dir: .wiki, out-dir: dist }
- uses: actions/upload-pages-artifact@v3
  with: { path: dist }
# then a deploy job runs actions/deploy-pages@v1
```

The repo's Pages source must be set to **GitHub Actions** for this to publish.
The earlier `gh-pages` publish step that older versions embedded (and that the
`package.json` description still mentions) was removed in `v2` — see
[[bundle-and-docs-drift]].

## Inputs

The full list of inputs, their defaults, and the frontmatter each page can carry
is documented in [[action-inputs]].
