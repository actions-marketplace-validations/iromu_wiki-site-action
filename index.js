import * as core from '@actions/core';
import { resolve } from 'node:path';
import { buildSite } from './lib/build-site.js';

const DEFAULT_CATEGORIES = 'overview,entities,concepts,flows,features,risks,reference';

async function run() {
  const wikiDir = core.getInput('wiki-dir') || '.wiki';
  const outDir = core.getInput('out-dir') || 'dist';
  const siteTitle = core.getInput('site-title');
  const githubRepo = core.getInput('github-repo') || process.env.GITHUB_REPOSITORY;
  const githubBranch = core.getInput('github-branch') || process.env.GITHUB_REF_NAME;
  const categories = (core.getInput('categories') || DEFAULT_CATEGORIES)
    .split(',').map(s => s.trim()).filter(Boolean);
  const highlightTheme = core.getInput('highlight-theme');
  const customCssPath = core.getInput('custom-highlight-css');

  if (!githubRepo) throw new Error('Could not determine github-repo (set the input or run in a GitHub workflow).');

  const absWiki = resolve(process.cwd(), wikiDir);
  const absOut = resolve(process.cwd(), outDir);
  const absCustomCss = customCssPath ? resolve(process.cwd(), customCssPath) : '';

  core.info(`Building wiki from ${absWiki} → ${absOut}`);
  const result = buildSite({
    wikiDir: absWiki,
    outDir: absOut,
    githubRepo,
    githubBranch,
    siteTitle,
    categories,
    highlightTheme,
    customHighlightCssPath: absCustomCss,
  });
  core.info(`Built ${result.pages} pages (site title: "${result.siteTitle}", theme: "${result.highlightTheme}").`);
  const requestedTheme = (highlightTheme || '').toLowerCase().trim();
  if (requestedTheme && requestedTheme !== result.highlightTheme) {
    core.warning(`Unknown highlight-theme "${highlightTheme}"; used "${result.highlightTheme}" instead.`);
  }
  if (result.customHighlightCssApplied) core.info(`Applied custom highlight CSS from "${customCssPath}".`);
  if (result.customHighlightCssError) core.warning(result.customHighlightCssError);
  if (result.brokenLinks.length) {
    core.warning(`${result.brokenLinks.length} unresolvable wiki-link(s): ${result.brokenLinks.join(', ')}`);
  }
}

run().catch(err => core.setFailed(err.message));
