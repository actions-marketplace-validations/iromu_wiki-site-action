/**
 * Smoke test for the wiki-site-action: builds a small fixture wiki, checks the
 * generated output, then publishes it to a throwaway bare origin over git and
 * verifies the gh-pages branch received the site.
 *
 * Run with: npm test
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSite } from '../lib/build-site.js';
import { publish } from '../lib/publish.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ok: ${msg}`); }
  else { console.error(`  FAIL: ${msg}`); failures++; }
}
const sh = (args, cwd) =>
  execFileSync(args[0], args.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const root = mkdtempSync(join(tmpdir(), 'wiki-action-test-'));
try {
  // --- build ---
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

  // --- publish ---
  console.log('publish:');
  const originGit = join(root, 'origin.git');
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  sh(['git', 'init', '--bare', originGit], root);
  sh(['git', 'init'], work);
  sh(['git', 'config', 'user.name', 'test'], work);
  sh(['git', 'config', 'user.email', 'test@test'], work);
  writeFileSync(join(work, 'README.md'), 'hello\n');
  sh(['git', 'add', '-A'], work);
  sh(['git', 'commit', '-m', 'init'], work);
  sh(['git', 'remote', 'add', 'origin', originGit], work);
  sh(['git', 'push', 'origin', 'HEAD'], work);

  const prevCwd = process.cwd();
  process.chdir(work);
  try {
    await publish({ publishDir: out, publishBranch: 'gh-pages' });
  } finally {
    process.chdir(prevCwd);
  }

  const branches = sh(['git', 'branch', '-a'], originGit);
  assert(branches.includes('gh-pages'), `gh-pages branch created on origin (got: ${branches.trim()})`);
  const deployed = sh(['git', 'show', 'gh-pages:index.html'], originGit);
  assert(deployed.includes('Test Wiki'), 'gh-pages index.html is the built site');
  assert(deployed.includes('concepts/foo.html'), 'gh-pages includes nested page');
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
