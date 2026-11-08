// Assemble the runtime assets under dist/ at build time, so the committed
// dist/ is self-contained for the action (which runs dist/index.cjs and reads
// its assets from dist/):
//
//   - highlight.js themes:  node_modules/highlight.js/styles/*.min.css
//        -> dist/highlight-themes/
//   - site stylesheet:      src/style.css
//        -> dist/style.css
//
// Runs as part of `npm run build`.
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.cwd();

// 1. highlight.js minified themes -> dist/highlight-themes/
const themesSrc = join(cwd, 'node_modules', 'highlight.js', 'styles');
const themesOut = join(cwd, 'dist', 'highlight-themes');
if (!existsSync(themesSrc)) {
  console.error(`copy-assets: themes source not found: ${themesSrc} (run npm install first)`);
  process.exit(1);
}
rmSync(themesOut, { recursive: true, force: true });
mkdirSync(themesOut, { recursive: true });
const themeFiles = readdirSync(themesSrc).filter(f => f.endsWith('.min.css'));
for (const f of themeFiles) cpSync(join(themesSrc, f), join(themesOut, f));
console.log(`copy-assets: ${themeFiles.length} theme files -> dist/highlight-themes/`);

// 2. site stylesheet -> dist/style.css
const styleSrc = join(cwd, 'src', 'style.css');
const styleOut = join(cwd, 'dist', 'style.css');
if (!existsSync(styleSrc)) {
  console.error(`copy-assets: site stylesheet not found: ${styleSrc}`);
  process.exit(1);
}
mkdirSync(join(cwd, 'dist'), { recursive: true });
cpSync(styleSrc, styleOut);
console.log('copy-assets: src/style.css -> dist/style.css');
