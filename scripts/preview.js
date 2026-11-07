#!/usr/bin/env node
/**
 * Local preview for wiki-site-action.
 *
 * Runs the REAL committed artifact (dist/index.cjs) exactly the way GitHub
 * Actions does — by setting the INPUT_* environment variables — then serves
 * the built site over HTTP so you can browse it and manually validate the
 * styles/themes. It uses only the dist/ artifacts, never the source, so what
 * you preview is exactly what the action would build.
 *
 * Usage:
 *   npm run preview
 *   node scripts/preview.js [options]
 *
 * Options:
 *   --wiki <dir>        source wiki dir         (default: .wiki)
 *   --out <dir>         output dir              (default: .preview)
 *   --port <n>          port to bind            (default: 4173)
 *   --host <h>          host to bind            (default: 127.0.0.1)
 *   --title <t>         site title override     (default: from the index page)
 *   --repo <o/r>        owner/repo for source links (default: read from git)
 *   --branch <b>        branch for source links (default: read from git)
 *   --theme <n>         highlight.js theme      (default: github)
 *   --theme-dark <n>    dark-mode highlight theme (default: github-dark)
 *   --override <p>      CSS file appended after the theme (overrides it)
 *   --logo <p>          path to a logo image shown in the sidebar
 *   --watch             rebuild on wiki changes
 *   --open              open the browser after the first build
 */
import http from 'node:http';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { join, normalize, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives in scripts/, so the repo root is one level up. The bundle is
// the committed artifact the action runs.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'dist', 'index.cjs');

// --- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    wiki: '.wiki', out: '.preview', port: 4173, host: '127.0.0.1',
    title: '', repo: '', branch: '', theme: '', themeDark: '', override: '', logo: '', watch: false, open: false,
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
      case '--theme': case '--highlight-theme': opts.theme = next(); break;
      case '--theme-dark': case '--highlight-theme-dark': opts.themeDark = next(); break;
      case '--override': case '--custom-css': opts.override = next(); break;
      case '--logo': opts.logo = next(); break;
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
  try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
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

// --- build: run the committed dist/ artifact, exactly like the action -------
// The action reads inputs as INPUT_<NAME> (upper-cased, spaces -> _). We set
// those env vars and spawn the bundle with the repo root as cwd, so the bundle
// resolves the same way it does in a real workflow.
function buildInputs({ wiki, out, title, repo, branch, theme, themeDark, override, logo }) {
  return {
    'INPUT_WIKI-DIR': resolve(ROOT, wiki),
    'INPUT_OUT-DIR': resolve(ROOT, out),
    'INPUT_SITE-TITLE': title,
    'INPUT_GITHUB-REPO': repo,
    'INPUT_GITHUB-BRANCH': branch,
    'INPUT_HIGHLIGHT-THEME': theme,
    'INPUT_HIGHLIGHT-THEME-DARK': themeDark,
    'INPUT_CUSTOM-HIGHLIGHT-CSS': override,
    'INPUT_LOGO': logo,
  };
}

function runBuild(inputs) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [BUNDLE], {
      cwd: ROOT,
      env: { ...process.env, ...inputs },
      stdio: 'inherit',
    });
    child.on('error', rej);
    child.on('exit', code => (code === 0 ? res() : rej(new Error(`build exited with code ${code}`))));
  });
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
    const filePath = normalize(join(root, urlPath));

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
async function main() {
  if (!fs.existsSync(BUNDLE)) {
    console.error(`Bundle not found: ${BUNDLE}\nRun \`npm run build\` first.`);
    process.exit(1);
  }

  const opts = parseArgs(process.argv.slice(2));
  const wikiDir = resolve(ROOT, opts.wiki);
  if (!fs.existsSync(wikiDir)) {
    console.error(`Wiki directory not found: ${wikiDir}`);
    process.exit(1);
  }
  const absOut = resolve(ROOT, opts.out);
  const repo = opts.repo || resolveRepo();
  const branch = opts.branch || resolveBranch();

  const inputs = buildInputs({
    wiki: opts.wiki,
    out: opts.out,
    title: opts.title,
    repo,
    branch,
    theme: opts.theme,
    themeDark: opts.themeDark,
    override: opts.override ? resolve(ROOT, opts.override) : '',
    logo: opts.logo ? resolve(ROOT, opts.logo) : '',
  });

  console.log(`\nBuilding with the committed artifact: ${BUNDLE}`);
  await runBuild(inputs);

  const server = createServer(absOut);
  server.listen(opts.port, opts.host, () => {
    const url = `http://${opts.host}:${opts.port}/`;
    console.log(`\nServing ${absOut} at ${url}`);
    console.log(`  source links: ${repo}@${branch}`);
    console.log(opts.watch ? '  watching for changes (Ctrl+C to stop)\n' : '  Ctrl+C to stop\n');
    if (opts.open) openBrowser(url);
  });

  // --- watch mode: rebuild (via the bundle) on wiki changes ---
  if (opts.watch) {
    let timer = null;
    try {
      fs.watch(wikiDir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith('.md')) return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try { await runBuild(inputs); console.log('  rebuilt — refresh the page'); }
          catch (err) { console.error(`  rebuild failed: ${err.message}`); }
        }, 150);
      });
    } catch (err) {
      console.error(`  watch unavailable (${err.message}); serving the initial build only`);
    }
  }
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
