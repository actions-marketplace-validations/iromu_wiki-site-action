/**
 * Regression test for the cross-repository asset-resolution bug.
 *
 * When the action is run via `uses: owner/repo@tag` from a *different*
 * repository, its working directory is the consumer's workspace, which has no
 * dist/. The action's own runtime assets — the highlight themes and the site
 * stylesheet — must be resolved from the action's own dist/ (next to the
 * bundle), not from process.cwd().
 *
 * This test runs the committed dist/index.cjs bundle (the CJS path that
 * resolves assets from __dirname) from a temp cwd that has a .wiki/ but no
 * dist/, and asserts the build succeeds and BOTH asset types made it into the
 * output. If asset resolution ever reverts to cwd-based, this fails.
 *
 * Run with: npm test
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'dist', 'index.cjs');

if (!existsSync(BUNDLE)) {
  console.error(`FAIL: committed bundle not found at ${BUNDLE} — run \`npm run build\` first.`);
  process.exit(1);
}

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ok: ${msg}`); }
  else { console.error(`  FAIL: ${msg}`); failures++; }
}

function runBundle(cwd, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BUNDLE], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
}

const work = mkdtempSync(join(tmpdir(), 'wiki-cross-cwd-'));
try {
  // A consumer repo: it has a .wiki/ to build, but NO dist/ of its own.
  const consumer = join(work, 'consumer');
  mkdirSync(join(consumer, '.wiki'), { recursive: true });
  writeFileSync(join(consumer, '.wiki', 'index.md'),
    '---\ntitle: "Consumer Wiki"\n---\n\n# Consumer\n\n```js\nconsole.log(1)\n```\n');

  console.log('cross-cwd (consumer repo has no dist/):');
  const { code, out } = await runBundle(consumer, {
    'INPUT_WIKI-DIR': '.wiki',
    'INPUT_OUT-DIR': 'dist',
    'INPUT_GITHUB-REPO': 'iromu/test',
    'INPUT_GITHUB-BRANCH': 'main',
  });

  assert(!out.includes('Highlight theme not found'),
    'highlight themes resolved from the action dist/, not cwd (no "Highlight theme not found")');
  assert(!out.includes('Site stylesheet not found'),
    'site stylesheet resolved from the action dist/, not cwd (no "Site stylesheet not found")');
  assert(code === 0, `bundle exited 0 from a cwd with no dist/ (got ${code})`);
  assert(existsSync(join(consumer, 'dist', 'index.html')), 'consumer dist/index.html produced');

  // Both highlight themes (light + dark) must be in the output, sourced from
  // the action's own committed themes.
  const light = existsSync(join(consumer, 'dist', 'highlight.css'))
    ? readFileSync(join(consumer, 'dist', 'highlight.css'), 'utf8') : '';
  const dark = existsSync(join(consumer, 'dist', 'highlight-dark.css'))
    ? readFileSync(join(consumer, 'dist', 'highlight-dark.css'), 'utf8') : '';
  assert(light.includes('.hljs'), 'light highlight.css present and non-trivial');
  assert(dark.includes('.hljs'), 'dark highlight.css present and non-trivial');

  // The site stylesheet must be the action's own dist/style.css (base palette
  // plus the derived page palette), proving it was read from the action, not
  // from a cwd-relative path.
  const css = existsSync(join(consumer, 'dist', 'style.css'))
    ? readFileSync(join(consumer, 'dist', 'style.css'), 'utf8') : '';
  assert(css.includes('--sidebar-w: 288px'), 'site stylesheet is the action dist/style.css (base palette present)');
  assert(css.includes('Page palette derived from'), 'page palette derived from the theme and appended');
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll cross-cwd checks passed.');
