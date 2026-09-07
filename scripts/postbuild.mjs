import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

// Vite emits src/popup/index.html -> dist/src/popup/index.html. Flatten it.
for (const [from, to] of [
  ['src/popup/index.html', 'popup.html'],
  ['src/offscreen/offscreen.html', 'offscreen.html'],
  ['src/viewer/viewer.html', 'viewer.html'],
]) {
  const src = resolve(dist, from);
  if (existsSync(src)) {
    let html = readFileSync(src, 'utf8');
    // Rewrite root-relative asset URLs to extension-relative ones.
    html = html.replace(/(src|href)="\/(?!\/)/g, '$1="');
    writeFileSync(resolve(dist, to), html);
    rmSync(src);
  }
}
if (existsSync(resolve(dist, 'src'))) rmSync(resolve(dist, 'src'), { recursive: true, force: true });

cpSync(resolve(root, 'public'), dist, { recursive: true });

// PDF.js worker + font/CMap data must be bundled: MV3 forbids remote code.
const pdfjs = resolve(root, 'node_modules/pdfjs-dist');
mkdirSync(resolve(dist, 'pdf'), { recursive: true });
cpSync(resolve(pdfjs, 'build/pdf.worker.min.mjs'), resolve(dist, 'pdf/pdf.worker.min.mjs'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(resolve(pdfjs, dir), resolve(dist, 'pdf', dir), { recursive: true });
}
console.log('✓ Narrate built to dist/ — load it via chrome://extensions → Load unpacked');
