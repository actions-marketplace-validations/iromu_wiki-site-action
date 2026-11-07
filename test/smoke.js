/**
 * Smoke test for the wiki-site-action: builds a small fixture wiki and checks
 * the generated static site (page count, wiki-link resolution, assets, source
 * chips, nested-page asset roots).
 *
 * Run with: npm test
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../lib/build-site.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ok: ${msg}`); }
  else { console.error(`  FAIL: ${msg}`); failures++; }
}

const root = mkdtempSync(join(tmpdir(), 'wiki-action-test-'));
try {
  console.log('build:');
  const wiki = join(root, 'wiki');
  mkdirSync(join(wiki, 'concepts'), { recursive: true });
  mkdirSync(join(wiki, 'features'), { recursive: true });
  writeFileSync(join(wiki, 'index.md'),
    '---\ntitle: "Test Wiki"\ntype: "index"\nupdated_at: "2026-01-01"\n---\n\n' +
    '# Test\n\nSee [[foo]] and a broken [[nope]].\n\n```js\nconsole.log(\'hi\');\n```\n');
  writeFileSync(join(wiki, 'concepts', 'foo.md'),
    '---\ntitle: "Foo"\nsource_paths: ["src/foo.java"]\n---\n\n# Foo\n\nBack to [[index]].\n');
  writeFileSync(join(wiki, 'features', 'bar.md'), '---\ntitle: "Bar"\n---\n\n# Bar\n');

  const out = join(root, 'dist');
  const result = buildSite({ wikiDir: wiki, outDir: out, githubRepo: 'iromu/test', githubBranch: 'main' });

  assert(result.pages === 3, `3 pages built (got ${result.pages})`);
  assert(result.siteTitle === 'Test Wiki', `site title derived from index (got "${result.siteTitle}")`);
  assert(result.brokenLinks.length === 1 && result.brokenLinks[0] === 'nope',
    `broken link detected (got ${JSON.stringify(result.brokenLinks)})`);
  for (const f of ['index.html', 'style.css', 'site.js', 'search-index.js', '404.html', 'highlight.css',
    'concepts/foo.html', 'features/bar.html']) {
    assert(existsSync(join(out, f)), `output exists: ${f}`);
  }
  const indexHtml = readFileSync(join(out, 'index.html'), 'utf8');
  assert(indexHtml.includes('href="concepts/foo.html"'), 'wiki-link [[foo]] resolved to concepts/foo.html');
  assert(indexHtml.includes('wikilink-missing'), 'broken [[nope]] marked as missing');
  assert(indexHtml.includes('Test Wiki'), 'site title present in index');
  const fooHtml = readFileSync(join(out, 'concepts/foo.html'), 'utf8');
  assert(fooHtml.includes('../style.css'), 'nested page uses ../ asset root');
  assert(fooHtml.includes('href="https://github.com/iromu/test/blob/main/src/foo.java"'), 'source chip link correct');

  console.log('theme:');
  const defaultCss = readFileSync(join(out, 'highlight.css'), 'utf8');
  const outMono = join(root, 'dist-monokai');
  const monoResult = buildSite({ wikiDir: wiki, outDir: outMono, githubRepo: 'iromu/test', githubBranch: 'main', highlightTheme: 'monokai' });
  const monoCss = readFileSync(join(outMono, 'highlight.css'), 'utf8');
  assert(monoResult.highlightTheme === 'monokai', `monokai theme selected (got "${monoResult.highlightTheme}")`);
  assert(monoCss !== defaultCss, 'monokai highlight.css differs from default github');
  const outUnknown = join(root, 'dist-unknown');
  const unknownResult = buildSite({ wikiDir: wiki, outDir: outUnknown, githubRepo: 'iromu/test', githubBranch: 'main', highlightTheme: 'nope-theme' });
  assert(unknownResult.highlightTheme === 'github', `unknown theme falls back to github (got "${unknownResult.highlightTheme}")`);
  assert(readFileSync(join(outUnknown, 'highlight.css'), 'utf8') === defaultCss, 'unknown theme writes the github css');

  console.log('custom css override:');
  const customCssFile = join(root, 'custom.css');
  writeFileSync(customCssFile, '.hljs-keyword { color: #ff00ff; }\n');
  const outCustom = join(root, 'dist-custom');
  const customResult = buildSite({ wikiDir: wiki, outDir: outCustom, githubRepo: 'iromu/test', githubBranch: 'main', customHighlightCssPath: customCssFile });
  const customCss = readFileSync(join(outCustom, 'highlight.css'), 'utf8');
  assert(customResult.customHighlightCssApplied === true, 'custom css applied');
  assert(customCss.includes(defaultCss), 'base theme css present before the override');
  assert(customCss.includes('.hljs-keyword { color: #ff00ff; }'), 'custom override appended after base theme');
  const outMissing = join(root, 'dist-missing');
  const missingResult = buildSite({ wikiDir: wiki, outDir: outMissing, githubRepo: 'iromu/test', githubBranch: 'main', customHighlightCssPath: join(root, 'nope.css') });
  assert(missingResult.customHighlightCssApplied === false, 'missing custom css not applied');
  assert(typeof missingResult.customHighlightCssError === 'string' && missingResult.customHighlightCssError.length > 0, 'missing custom css reports an error');
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
