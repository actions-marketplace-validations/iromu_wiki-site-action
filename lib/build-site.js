/**
 * Static site generator for a `.wiki/` knowledge base.
 *
 * Reads every Markdown page under the wiki directory, parses its YAML
 * frontmatter, converts the body to HTML, resolves `[[wiki-links]]` to
 * internal links, and writes a browsable static site (category sidebar,
 * per-page table of contents, code highlighting, lightweight client-side
 * search) into the output directory.
 *
 * Everything is driven by the options argument so the same generator can
 * point at any wiki from any repo.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { marked } from 'marked';
import matter from 'gray-matter';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

const DEFAULT_CATEGORIES = ['overview', 'entities', 'concepts', 'flows', 'features', 'risks', 'reference'];

// Default code-highlight theme. The theme CSS files are committed under
// dist/highlight-themes/ and read at build time (so the bundle stays small).
// The action runs with the repo root as its working directory (like the
// wiki-dir/out-dir inputs), so the themes are resolved from there.
const DEFAULT_THEME = 'github';
function resolveThemesDir() {
  return join(process.cwd(), 'dist', 'highlight-themes');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// GitHub-style anchor id for a heading.
function slugify(s) {
  return String(s)
    .toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Recursively collect all *.md files under dir, returning paths relative to dir.
function findMarkdown(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) findMarkdown(full, base, out);
    else if (name.endsWith('.md')) out.push(relative(base, full));
  }
  return out;
}

// Number of path segments above a given output page (drives the `../` prefix
// used to reach the site root for asset + wiki links).
function rootPrefix(outRelPath) {
  const depth = outRelPath.split('/').length - 1;
  return '../'.repeat(depth);
}

// --- per-page state (reset before each render) ---
let slugMap = {};
let brokenLinks = new Set();
let currentPageDir = '.';
let toc = [];
let usedHeadingIds = new Set();

function headingId(text) {
  const base = slugify(text) || 'section';
  let id = base;
  let n = 1;
  while (usedHeadingIds.has(id)) id = `${base}-${n++}`;
  usedHeadingIds.add(id);
  return id;
}

// Configure `marked` once at module load. The renderer/extension below read
// the per-page state (slugMap, currentPageDir, toc, ...) which buildSite()
// resets before each page is parsed.
marked.use(markedHighlight({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch { /* fall through to plain */ }
    }
    return escapeHtml(code);
  },
}));

marked.use({
  renderer: {
    heading(token) {
      const { depth, text } = token;
      const id = headingId(text);
      if (depth >= 2 && depth <= 3) toc.push({ depth, id, text: text.replace(/[`*_]/g, '').trim() });
      const inner = marked.parseInline(text);
      return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
    },
  },
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start(src) {
        const i = src.indexOf('[[');
        return i < 0 ? -1 : i;
      },
      tokenizer(src) {
        const m = src.match(/^\[\[([^\[\]]+)\]\]/);
        if (!m) return undefined;
        const [left, label] = m[1].split('|');
        const [slug, anchor] = left.split('#');
        return {
          type: 'wikilink',
          raw: m[0],
          slug: slug.trim(),
          anchor: (anchor ?? '').trim(),
          label: (label ?? slug).trim(),
        };
      },
      renderer(token) {
        const target = slugMap[token.slug];
        if (!target) {
          brokenLinks.add(token.slug);
          return `<a class="wikilink-missing" title="No wiki page for [[${escapeHtml(token.slug)}]]">${escapeHtml(token.label)}</a>`;
        }
        const href = relative(currentPageDir, target.outRelPath).replace(/\\/g, '/');
        const full = token.anchor ? `${href}#${token.anchor}` : href;
        return `<a class="wikilink" href="${full}">${escapeHtml(token.label)}</a>`;
      },
    },
  ],
});

// --- presentational builders ---

function buildSidebar(pages, activeOutRelPath, root, categories, catLabels, siteTitle) {
  const isHome = p => p.slug === 'index';
  const byCat = new Map();
  for (const p of pages) {
    if (isHome(p)) continue;
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }
  // Known categories in the given order, then any extra directories.
  const ordered = [];
  for (const key of categories) if (byCat.has(key)) ordered.push(key);
  for (const key of byCat.keys()) if (!categories.includes(key)) ordered.push(key);

  const sections = ordered.map(cat => {
    const items = byCat.get(cat).sort((a, b) => a.title.localeCompare(b.title));
    const links = items.map(p => {
      const cls = p.outRelPath === activeOutRelPath ? ' class="active"' : '';
      return `      <a href="${root}${p.outRelPath}"${cls}>${escapeHtml(p.title)}</a>\n`;
    }).join('');
    return `    <div class="nav-group">\n      <div class="nav-label">${escapeHtml(catLabels[cat] ?? cat)}</div>\n${links}    </div>\n`;
  }).join('');

  const homeCls = activeOutRelPath === 'index.html' ? ' class="active"' : '';
  return `<div class="brand"><a href="${root}index.html">${escapeHtml(siteTitle)}</a></div>
  <div class="search">
    <input id="search" type="search" placeholder="Search the wiki…" autocomplete="off" spellcheck="false" aria-label="Search">
    <ul id="search-results" class="search-results" role="listbox"></ul>
  </div>
  <nav class="toc-nav" aria-label="Wiki">
    <a href="${root}index.html"${homeCls}>Home</a>
${sections}  </nav>
  <div class="sidebar-footer">${escapeHtml(siteTitle)} · skills-first agent builder</div>`;
}

function buildTocHtml(toc) {
  if (!toc.length) return '';
  const items = toc.map(h =>
    `      <a class="toc-item toc-h${h.depth}" href="#${h.id}">${escapeHtml(h.text)}</a>\n`).join('');
  return `<aside class="page-toc"><div class="toc-title">On this page</div><ul class="toc-list">\n${items}    </ul></aside>\n`;
}

function buildPageHtml({ page, bodyHtml, sidebar, root, tocHtml, catLabels, siteTitle, githubRepo, githubBranch }) {
  const crumb = page.slug === 'index' ? 'Home' : (catLabels[page.category] ?? page.category);
  const docTitle = page.title === siteTitle ? page.title : `${page.title} · ${siteTitle}`;
  const sourceChips = (page.sourcePaths ?? []).map(sp =>
    `    <a class="src-chip" href="https://github.com/${githubRepo}/blob/${githubBranch}/${sp}" target="_blank" rel="noreferrer" title="${escapeHtml(sp)}">${escapeHtml(sp)}</a>`
  ).join('\n');
  const meta = [
    page.updatedAt ? `<span class="meta-updated">Updated ${escapeHtml(page.updatedAt)}</span>` : '',
    sourceChips ? `<span class="meta-sources">${sourceChips}</span>` : '',
  ].filter(Boolean).join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(docTitle)}</title>
  <meta name="description" content="${escapeHtml(page.title)} — ${escapeHtml(siteTitle)}">
  <link rel="stylesheet" href="${root}style.css">
  <link rel="stylesheet" href="${root}highlight.css">
  <script>window.SITE = { root: "${root}" };</script>
</head>
<body>
  <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">&#9776; Menu</button>
  <div class="scrim"></div>
  <div class="layout">
    <aside class="sidebar">
${sidebar}
    </aside>
    <main class="content">
      <article>
        <header class="page-header">
          <div class="crumb">${escapeHtml(crumb)}</div>
          ${meta ? `<div class="meta">\n      ${meta}\n    </div>` : ''}
        </header>
${tocHtml}
        <div class="prose">
${bodyHtml}
        </div>
        <footer class="page-footer">
          <a href="${root}index.html">&larr; Back to index</a>
        </footer>
      </article>
    </main>
  </div>
  <script src="${root}site.js"></script>
</body>
</html>
`;
}

const STYLE_CSS = `:root {
  --bg: #ffffff;
  --bg-soft: #f6f8fa;
  --fg: #1f2328;
  --fg-muted: #57606a;
  --border: #d0d7de;
  --border-soft: #e5e9ef;
  --accent: #0969da;
  --accent-soft: #ddf4ff;
  --code-bg: #f6f8fa;
  --sidebar-w: 288px;
  --maxw: 920px;
  --radius: 8px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font);
  color: var(--fg);
  background: var(--bg);
  line-height: 1.6;
  font-size: 16px;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.layout { display: flex; min-height: 100vh; }

.sidebar {
  width: var(--sidebar-w);
  flex: 0 0 var(--sidebar-w);
  border-right: 1px solid var(--border-soft);
  background: var(--bg-soft);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.brand a { font-weight: 700; font-size: 17px; color: var(--fg); }
.brand a:hover { text-decoration: none; }
.search { position: relative; }
.search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  font-family: inherit;
  background: var(--bg);
}
.search input:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.search-results {
  list-style: none;
  margin: 4px 0 0;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  max-height: 60vh;
  overflow-y: auto;
  display: none;
}
.search-results.open { display: block; }
.search-results li { margin: 0; }
.search-results a { display: block; padding: 6px 8px; border-radius: 6px; color: var(--fg); font-size: 14px; }
.search-results a:hover { background: var(--bg-soft); text-decoration: none; }
.search-results .sr-none { color: var(--fg-muted); font-size: 13px; }

.toc-nav { display: flex; flex-direction: column; gap: 2px; }
.toc-nav > a { padding: 6px 10px; border-radius: 6px; color: var(--fg); font-size: 14px; font-weight: 600; }
.nav-group { margin-top: 12px; }
.nav-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
  font-weight: 700;
  padding: 0 10px 4px;
}
.nav-group a { display: block; padding: 5px 10px; border-radius: 6px; color: var(--fg); font-size: 14px; }
.nav-group a:hover { background: rgba(0, 0, 0, 0.04); text-decoration: none; }
.nav-group a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.sidebar-footer { margin-top: auto; font-size: 12px; color: var(--fg-muted); padding: 8px 10px 0; }

.content { flex: 1 1 auto; min-width: 0; }
article { max-width: var(--maxw); margin: 0 auto; padding: 40px 48px 80px; }
.page-header { margin-bottom: 8px; }
.crumb {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.meta { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.meta-updated { font-size: 13px; color: var(--fg-muted); }
.meta-sources { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.src-chip {
  font-family: var(--mono);
  font-size: 12px;
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  color: var(--fg-muted);
  padding: 2px 8px;
  border-radius: 999px;
}
.src-chip:hover { color: var(--accent); border-color: var(--accent); }

.page-toc {
  margin: 16px 0 8px;
  padding: 14px 18px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  background: var(--bg-soft);
}
.toc-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); margin-bottom: 8px; }
.toc-list { list-style: none; margin: 0; padding: 0; }
.toc-item { display: block; padding: 3px 0; font-size: 14px; color: var(--fg); }
.toc-item:hover { color: var(--accent); text-decoration: none; }
.toc-h3 { padding-left: 16px; font-size: 13px; }

.prose { font-size: 16px; }
.prose h1 { font-size: 2em; line-height: 1.2; margin: 0.4em 0 0.6em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border-soft); }
.prose h2 { font-size: 1.5em; margin: 1.4em 0 0.6em; padding-bottom: 0.2em; border-bottom: 1px solid var(--border-soft); }
.prose h3 { font-size: 1.2em; margin: 1.2em 0 0.5em; }
.prose h4 { font-size: 1.05em; margin: 1.1em 0 0.5em; }
.prose p { margin: 0.8em 0; }
.prose a.wikilink { color: var(--accent); }
.prose a.wikilink-missing { color: #b91c1c; text-decoration: underline dotted; cursor: help; }
.prose ul, .prose ol { padding-left: 1.6em; margin: 0.8em 0; }
.prose li { margin: 0.25em 0; }
.prose blockquote {
  margin: 1em 0;
  padding: 0.4em 1em;
  border-left: 4px solid var(--accent);
  color: var(--fg-muted);
  background: var(--bg-soft);
  border-radius: 0 6px 6px 0;
}
.prose table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 15px; display: block; overflow-x: auto; }
.prose th, .prose td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.prose th { background: var(--bg-soft); font-weight: 600; }
.prose tr:nth-child(even) td { background: var(--bg-soft); }
.prose code {
  font-family: var(--mono);
  font-size: 0.875em;
  background: var(--code-bg);
  padding: 0.15em 0.4em;
  border-radius: 5px;
}
.prose pre {
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 14px 16px;
  overflow-x: auto;
  line-height: 1.5;
}
.prose pre code { background: transparent; padding: 0; font-size: 0.85em; }
.page-footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border-soft); font-size: 14px; }

.nav-toggle {
  display: none;
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 50;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  font-size: 14px;
  cursor: pointer;
}
.scrim { display: none; }

@media (max-width: 900px) {
  .layout { flex-direction: column; }
  .sidebar {
    position: fixed;
    left: 0; top: 0; bottom: 0;
    width: 280px;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    z-index: 40;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.15);
  }
  .sidebar.open { transform: translateX(0); }
  .nav-toggle { display: block; }
  .content { width: 100%; }
  article { padding: 60px 22px 60px; }
  .scrim {
    display: none;
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: 30;
  }
  .scrim.show { display: block; }
}
`;

const SITE_JS = `(function () {
  'use strict';
  var root = (window.SITE && window.SITE.root) || '';

  // ---- mobile nav toggle ----
  var toggle = document.querySelector('.nav-toggle');
  var sidebar = document.querySelector('.sidebar');
  var scrim = document.querySelector('.scrim');
  function closeNav() {
    if (!sidebar || !scrim) return;
    sidebar.classList.remove('open');
    scrim.classList.remove('show');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      var open = sidebar.classList.toggle('open');
      if (scrim) scrim.classList.toggle('show', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (scrim) scrim.addEventListener('click', closeNav);
    sidebar.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'A') closeNav();
    });
  }

  // ---- search (loads the index lazily on first use) ----
  var input = document.getElementById('search');
  var results = document.getElementById('search-results');
  if (!input || !results) return;
  var index = null;
  var loading = false;
  function ensureIndex(cb) {
    if (index) { cb(); return; }
    if (loading) return;
    loading = true;
    var s = document.createElement('script');
    s.src = root + 'search-index.js';
    s.onload = function () { index = window.SEARCH_INDEX || []; loading = false; cb(); };
    s.onerror = function () {
      loading = false;
      results.innerHTML = '<li class="sr-none">Search unavailable</li>';
      results.classList.add('open');
    };
    document.head.appendChild(s);
  }
  function doSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) { results.classList.remove('open'); results.innerHTML = ''; return; }
    ensureIndex(function () {
      var hits = index
        .filter(function (p) {
          return p.title.toLowerCase().indexOf(q) !== -1 || p.text.indexOf(q) !== -1;
        })
        .slice(0, 20);
      results.innerHTML = hits.length
        ? hits.map(function (p) {
            return '<li><a href="' + root + p.path + '">' + p.title + '</a></li>';
          }).join('')
        : '<li class="sr-none">No results for "' + q + '"</li>';
      results.classList.add('open');
    });
  }
  input.addEventListener('input', function () { doSearch(input.value); });
  input.addEventListener('focus', function () { if (results.innerHTML) results.classList.add('open'); });
  input.addEventListener('blur', function () { setTimeout(function () { results.classList.remove('open'); }, 150); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; doSearch(''); input.blur(); }
  });
})();
`;

// highlight.js theme CSS lives in lib/highlight-themes.js (inlined there so the
// bundle has no runtime node_modules dependency); the chosen theme is written
// out as highlight.css in buildSite() below.

function notFoundHtml(siteTitle) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found · ${escapeHtml(siteTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; color: #1f2328; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { text-align: center; padding: 40px; }
    h1 { font-size: 4em; margin: 0; }
    a { color: #0969da; }
  </style>
</head>
<body>
  <div class="box">
    <h1>404</h1>
    <p>That page doesn't exist in the wiki.</p>
    <p><a href="index.html">Back to the index &rarr;</a></p>
  </div>
</body>
</html>
`;
}

/**
 * Build the static site.
 *
 * @param {object} o
 * @param {string} o.wikiDir      absolute path to the source wiki directory
 * @param {string} o.outDir       absolute path to write the site into
 * @param {string} o.githubRepo   owner/repo used for source-link URLs
 * @param {string} o.githubBranch branch used for source-link URLs
 * @param {string} [o.siteTitle]  site title; falls back to the index page's
 *                                `title` frontmatter, then to "Wiki"
 * @param {string[]} [o.categories] ordered top-level directory names for the
 *                                  sidebar; unknown directories are appended
 * @param {string} [o.highlightTheme] highlight.js theme name for code
 *                                    highlighting (see lib/highlight-themes.js);
 *                                    defaults to "github"; unknown names fall
 *                                    back to the default theme
 * @param {string} [o.customHighlightCssPath] path to a CSS file appended after
 *                                    the selected theme so it can override or
 *                                    extend the theme's rules; empty for none
 * @returns {{ pages: number, outDir: string, siteTitle: string, brokenLinks: string[], highlightTheme: string, customHighlightCssApplied: boolean, customHighlightCssError: (string|null) }}
 */
export function buildSite({ wikiDir, outDir, githubRepo, githubBranch, siteTitle = '', categories = DEFAULT_CATEGORIES, highlightTheme = DEFAULT_THEME, customHighlightCssPath = '' }) {
  if (!existsSync(wikiDir)) {
    throw new Error(`Wiki directory not found: ${wikiDir}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. Discover + parse pages.
  const pages = findMarkdown(wikiDir).map(relPath => {
    const raw = readFileSync(join(wikiDir, relPath), 'utf8');
    const { data, content } = matter(raw);
    const slug = basename(relPath, '.md');
    const parts = relPath.split('/');
    const category = parts.length === 1 ? '' : parts[0];
    const sourcePaths = Array.isArray(data.source_paths)
      ? data.source_paths
      : (data.source_paths ? [data.source_paths] : []);
    return {
      relPath,
      slug,
      category,
      outRelPath: relPath.replace(/\.md$/, '.html'),
      title: data.title || slug,
      type: data.type || '',
      updatedAt: data.updated_at || '',
      sourcePaths,
      content,
    };
  });

  // Derive the site title from the index page when not explicitly provided.
  const resolvedTitle = siteTitle
    || pages.find(p => p.slug === 'index')?.title
    || 'Wiki';
  const catLabels = Object.fromEntries(categories.map(k => [k, k.charAt(0).toUpperCase() + k.slice(1)]));

  // 2. Slug map for wiki-link resolution.
  slugMap = Object.fromEntries(pages.map(p => [p.slug, p]));
  brokenLinks = new Set();

  // 3. Render each page.
  const searchIndex = [];
  for (const p of pages) {
    currentPageDir = dirname(p.outRelPath);
    toc = [];
    usedHeadingIds = new Set();

    const bodyHtml = marked.parse(p.content);
    const root = rootPrefix(p.outRelPath);
    const sidebar = buildSidebar(pages, p.outRelPath, root, categories, catLabels, resolvedTitle);
    const tocHtml = buildTocHtml(toc);
    const html = buildPageHtml({ page: p, bodyHtml, sidebar, root, tocHtml, catLabels, siteTitle: resolvedTitle, githubRepo, githubBranch });

    const outPath = join(outDir, p.outRelPath);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);

    const searchText = p.content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*`>|_~\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    searchIndex.push({ slug: p.slug, title: p.title, path: p.outRelPath, category: p.category, text: searchText });
  }

  // 4. Static assets.
  const themesDir = resolveThemesDir();
  const requestedTheme = (highlightTheme || '').toLowerCase().trim();
  const themeUsed = requestedTheme && existsSync(join(themesDir, `${requestedTheme}.css`))
    ? requestedTheme
    : DEFAULT_THEME;
  const baseThemeFile = join(themesDir, `${themeUsed}.css`);
  if (!existsSync(baseThemeFile)) {
    throw new Error(`Highlight theme not found: ${baseThemeFile} (themes live in dist/highlight-themes/)`);
  }
  let highlightCss = readFileSync(baseThemeFile, 'utf8');

  // Optional custom CSS appended after the base theme so it can override it.
  let customCss = '';
  let customCssError = null;
  if (customHighlightCssPath) {
    if (existsSync(customHighlightCssPath)) {
      customCss = readFileSync(customHighlightCssPath, 'utf8');
    } else {
      customCssError = `Custom highlight CSS not found: ${customHighlightCssPath}`;
    }
  }
  if (customCss) highlightCss += `\n/* custom overrides (appended after the base theme) */\n${customCss}`;

  writeFileSync(join(outDir, 'style.css'), STYLE_CSS);
  writeFileSync(join(outDir, 'site.js'), SITE_JS);
  writeFileSync(join(outDir, 'search-index.js'), `window.SEARCH_INDEX = ${JSON.stringify(searchIndex)};\n`);
  writeFileSync(join(outDir, 'highlight.css'), highlightCss);
  writeFileSync(join(outDir, '404.html'), notFoundHtml(resolvedTitle));

  // 5. Summary.
  return {
    pages: pages.length,
    outDir,
    siteTitle: resolvedTitle,
    brokenLinks: [...brokenLinks],
    highlightTheme: themeUsed,
    customHighlightCssApplied: Boolean(customCss),
    customHighlightCssError: customCssError,
  };
}
