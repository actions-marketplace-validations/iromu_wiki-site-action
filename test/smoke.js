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
    'highlight-dark.css', 'concepts/foo.html', 'features/bar.html']) {
    assert(existsSync(join(out, f)), `output exists: ${f}`);
  }
  const indexHtml = readFileSync(join(out, 'index.html'), 'utf8');
  assert(indexHtml.includes('href="concepts/foo.html"'), 'wiki-link [[foo]] resolved to concepts/foo.html');
  assert(indexHtml.includes('wikilink-missing'), 'broken [[nope]] marked as missing');
  assert(indexHtml.includes('Test Wiki'), 'site title present in index');
  assert(indexHtml.includes('id="theme-toggle"'), 'theme toggle button present');
  assert(indexHtml.includes('class="github-link"') && indexHtml.includes('https://github.com/iromu/test/tree/main'),
    'github icon links to the configured repo/branch');
  assert(indexHtml.includes('data-hl="light"') && indexHtml.includes('data-hl="dark"'),
    'both light and dark highlight themes are linked');
  const fooHtml = readFileSync(join(out, 'concepts/foo.html'), 'utf8');
  assert(fooHtml.includes('../style.css'), 'nested page uses ../ asset root');
  assert(fooHtml.includes('href="https://github.com/iromu/test/blob/main/src/foo.java"'), 'source chip link correct');

  console.log('inputs:');
  // wiki-dir + out-dir: pages from the source dir land in the requested output dir
  assert(existsSync(join(out, 'index.html')) && existsSync(join(out, 'concepts/foo.html')),
    'wiki-dir/out-dir: pages from the source dir are written to the output dir');

  // site-title: overrides the title derived from the index page
  const outTitle = join(root, 'dist-title');
  const titleResult = buildSite({ wikiDir: wiki, outDir: outTitle, githubRepo: 'iromu/test', githubBranch: 'main', siteTitle: 'Custom Title' });
  assert(titleResult.siteTitle === 'Custom Title', `site-title overrides the index title (got "${titleResult.siteTitle}")`);
  assert(readFileSync(join(outTitle, 'index.html'), 'utf8').includes('Custom Title'), 'site-title appears in the built page');

  // github-repo + github-branch: drive the "view source" chip URLs
  const outSrc = join(root, 'dist-src');
  buildSite({ wikiDir: wiki, outDir: outSrc, githubRepo: 'acme/widgets', githubBranch: 'develop' });
  const srcHtml = readFileSync(join(outSrc, 'concepts/foo.html'), 'utf8');
  assert(srcHtml.includes('https://github.com/acme/widgets/blob/develop/src/foo.java'),
    'github-repo/github-branch build the source chip URL');

  // categories: controls the sidebar order
  const outCat = join(root, 'dist-cat');
  buildSite({ wikiDir: wiki, outDir: outCat, githubRepo: 'iromu/test', githubBranch: 'main', categories: ['features', 'concepts'] });
  const catHtml = readFileSync(join(outCat, 'index.html'), 'utf8');
  const featuresIdx = catHtml.indexOf('>Features<');
  const conceptsIdx = catHtml.indexOf('>Concepts<');
  assert(featuresIdx !== -1 && conceptsIdx !== -1 && featuresIdx < conceptsIdx,
    'categories orders the sidebar (features before concepts)');

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

  // highlight-theme-dark: default is github-dark; a custom dark theme is honored
  const defaultDarkCss = readFileSync(join(out, 'highlight-dark.css'), 'utf8');
  assert(defaultDarkCss !== defaultCss, 'default dark theme (github-dark) differs from the light github css');
  const outDark = join(root, 'dist-dark');
  const darkResult = buildSite({ wikiDir: wiki, outDir: outDark, githubRepo: 'iromu/test', githubBranch: 'main', highlightThemeDark: 'atom-one-dark' });
  assert(darkResult.highlightThemeDark === 'atom-one-dark', `dark theme selected (got "${darkResult.highlightThemeDark}")`);
  assert(readFileSync(join(outDark, 'highlight-dark.css'), 'utf8') !== defaultDarkCss, 'custom dark theme differs from the default dark css');
  assert(darkResult.highlightTheme === 'github', 'light theme unaffected by the dark theme input');

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

  console.log('logo:');
  const logoFile = join(root, 'logo.png');
  writeFileSync(logoFile, 'fakepng');
  const outLogo = join(root, 'dist-logo');
  const logoResult = buildSite({ wikiDir: wiki, outDir: outLogo, githubRepo: 'iromu/test', githubBranch: 'main', logoPath: logoFile });
  assert(logoResult.logo === 'logo.png', `logo copied into output (got "${logoResult.logo}")`);
  assert(existsSync(join(outLogo, 'logo.png')), 'logo file present in output');
  assert(readFileSync(join(outLogo, 'index.html'), 'utf8').includes('class="brand-logo"'), 'logo rendered in the sidebar');
  const outNoLogo = join(root, 'dist-nologo');
  const noLogoResult = buildSite({ wikiDir: wiki, outDir: outNoLogo, githubRepo: 'iromu/test', githubBranch: 'main', logoPath: join(root, 'missing.png') });
  assert(noLogoResult.logo === '' && typeof noLogoResult.logoError === 'string', 'missing logo reports an error and is not rendered');
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
