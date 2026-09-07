/**
 * Generates Narrate's PNG icons with no image dependencies:
 * a rounded accent-gradient tile, a white play glyph and two sound arcs,
 * supersampled 4x for smooth edges.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const SS = 4; // supersampling factor

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle centred on the origin. */
function sdRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Is (px,py) inside the play triangle? Coordinates are normalised to 0..1. */
function inTriangle(px, py) {
  const x0 = 0.34, x1 = 0.63, yTop = 0.29, yBot = 0.71;
  if (px < x0 || px > x1) return false;
  const t = (px - x0) / (x1 - x0);
  const half = (0.5 - yTop) * (1 - t);
  return Math.abs(py - 0.5) <= half;
}

/** Two arcs to the right of the glyph, suggesting sound. */
function inArc(px, py, r, thickness) {
  const dx = px - 0.30, dy = py - 0.5;
  if (dx <= 0.02) return false;
  const d = Math.hypot(dx, dy);
  if (Math.abs(d - r) > thickness / 2) return false;
  return Math.abs(dy) < d * 0.78; // clip to a wedge so it reads as an arc
}

function render(size) {
  const S = size * SS;
  const buf = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x * SS + sx + 0.5) / S;
          const fy = (y * SS + sy + 0.5) / S;

          // Tile mask
          const d = sdRoundRect(fx - 0.5, fy - 0.5, 0.5, 0.5, 0.235);
          if (d > 0) continue;

          // Diagonal accent gradient: #8b7bff -> #5a49f5
          const t = Math.min(1, Math.max(0, (fx + fy) / 2));
          let cr = Math.round(139 + (90 - 139) * t);
          let cg = Math.round(123 + (73 - 123) * t);
          let cb = Math.round(255 + (245 - 255) * t);

          const glyph =
            inTriangle(fx, fy) ||
            inArc(fx, fy, 0.30, 0.055) ||
            inArc(fx, fy, 0.41, 0.055);
          if (glyph) { cr = 255; cg = 255; cb = 255; }

          r += cr; g += cg; b += cb; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cov = a / n / 255;
      buf[i] = cov ? Math.round(r / (a / 255)) : 0;
      buf[i + 1] = cov ? Math.round(g / (a / 255)) : 0;
      buf[i + 2] = cov ? Math.round(b / (a / 255)) : 0;
      buf[i + 3] = Math.round(cov * 255);
    }
  }
  return png(size, buf);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(OUT, `icon${size}.png`), render(size));
  console.log(`✓ icons/icon${size}.png`);
}
