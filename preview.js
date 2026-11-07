#!/usr/bin/env node
/**
 * Local preview for wiki-site-action.
 *
 * Builds the repo's wiki with the REAL buildSite() from lib/build-site.js (the
 * same code the action runs) and serves the result over HTTP so you can browse
 * it in a browser and manually validate styles/themes. This is a dev
 * convenience, not a test.
 *
 * Usage:
 *   node preview.js [options]
 *   npm run preview
 *
 * Options:
 *   --wiki <dir>    source wiki dir       (default: .wiki)
 *   --out <dir>     output dir            (default: .preview)
 *   --port <n>      port to bind          (default: 4173)
 *   --host <h>      host to bind          (default: 127.0.0.1)
 *   --title <t>     site title override   (default: from the index page)
 *   --repo <o/r>    owner/repo for source links (default: read from git)
 *   --branch <b>    branch for source links (default: read from git)
 *   --watch         rebuild on wiki changes
 *   --open          open the browser after the first build
 */
import http from 'node:http';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { join, normalize, resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { buildSite } from './lib/build-site.js';

// --- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    wiki: '.wiki', out: '.preview', port: 4173, host: '127.0.0.1',
    title: '', repo: '', branch: '', watch: false, open: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--wiki': opts.wiki = next(); break;
      case '--out': opts.out = next(); break;
      case '--port': opts.port = Number(next()); break;
      case '--host': opts.host = next(); break;
      case '--title': opts.title = next(); break;
      case '--repo': opts.repo = next(); break;
      case '--branch': opts.branch = next(); break;
      case '--watch': opts.watch = true; break;
      case '--open': opts.open = true; break;
      default:
        if (a.startsWith('--')) { console.error(`Unknown option: ${a}`); process.exit(1); }
    }
  }
  return opts;
}

// --- git fallbacks for source-link URLs ------------------------------------
function git(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}

function resolveRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = git('git remote get-url origin');
  // strip host + .git suffix -> "owner/repo"
  const m = url.replace(/^git\+ssh:\/\//, '').replace(/^https?:\/\//, '')
    .replace(/\.git$/, '').match(/[^/:]+\/[^/]+$/);
  return m ? m[0] : 'local/preview';
}

function resolveBranch() {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  return git('git rev-parse --abbrev-ref HEAD') || 'main';
}

// --- build -----------------------------------------------------------------
function doBuild({ wikiDir, outDir, repo, branch, title }) {
  return buildSite({ wikiDir, outDir, githubRepo: repo, githubBranch: branch, siteTitle: title });
}

function buildAndReport(cfg) {
  const t0 = Date.now();
  const result = doBuild(cfg);
  console.log(`\n✔ built ${result.pages} page(s) in ${Date.now() - t0}ms (site title: "${result.siteTitle}")`);
  if (result.brokenLinks.length) {
    console.warn(`  ⚠ ${result.brokenLinks.length} unresolvable wiki-link(s): ${result.brokenLinks.join(', ')}`);
  }
  return result;
}

// --- static file server ----------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function serveFile(filePath, res, status) {
  const data = fs.readFileSync(filePath);
  res.writeHead(status, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
  res.end(data);
}

function createServer(outDir) {
  const root = resolve(outDir);
  return http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); return res.end('Bad request'); }

    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let filePath = normalize(join(root, urlPath));

    // guard against path traversal
    if (filePath !== root && !filePath.startsWith(root + '/')) {
      res.writeHead(403); return res.end('Forbidden');
    }

    let target = filePath;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = join(target, 'index.html');

    if (!fs.existsSync(target)) {
      const notFound = join(root, '404.html');
      if (fs.existsSync(notFound)) return serveFile(notFound, res, 404);
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
    }
    serveFile(target, res, 200);
  });
}

// --- browser open ----------------------------------------------------------
function openBrowser(url) {
  const [cmd, ...args] = process.platform === 'darwin'
    ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch { /* no browser launcher available */ }
}

// --- main ------------------------------------------------------------------
const opts = parseArgs(process.argv.slice(2));
const absWiki = resolve(process.cwd(), opts.wiki);
const absOut = resolve(process.cwd(), opts.out);
const repo = opts.repo || resolveRepo();
const branch = opts.branch || resolveBranch();

if (!fs.existsSync(absWiki)) {
  console.error(`Wiki directory not found: ${absWiki}`);
  process.exit(1);
}

const cfg = { wikiDir: absWiki, outDir: absOut, repo, branch, title: opts.title };
buildAndReport(cfg);

const server = createServer(absOut);
server.listen(opts.port, opts.host, () => {
  const url = `http://${opts.host}:${opts.port}/`;
  console.log(`\nServing ${absOut} at ${url}`);
  console.log(`  source links: ${repo}@${branch}`);
  console.log(opts.watch ? '  watching for changes (Ctrl+C to stop)\n' : '  Ctrl+C to stop\n');
  if (opts.open) openBrowser(url);
});

// --- watch mode ------------------------------------------------------------
if (opts.watch) {
  let timer = null;
  try {
    fs.watch(absWiki, { recursive: true }, (_event, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { buildAndReport(cfg); console.log('  rebuilt — refresh the page'); }
        catch (err) { console.error(`  rebuild failed: ${err.message}`); }
      }, 150);
    });
  } catch (err) {
    console.error(`  watch unavailable (${err.message}); serving the initial build only`);
  }
}
