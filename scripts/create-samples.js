/**
 * create-samples.js — Phase 1 verifier
 *
 * Generates 3 deterministic sample images for the Python/JS preprocessing
 * comparison, written to `scripts/python-ref/samples/`:
 *
 *   square.png  300x300  RGB(255, 0, 0)   — letterbox fills entire canvas
 *   tall.png    100x300  RGB(0, 0, 255)   — letterbox pads left/right
 *   wide.png    300x100  RGB(0, 255, 0)   — letterbox pads top/bottom
 *
 * The colors are chosen to be:
 *   - pure (so BICUBIC interpolation returns the source color verbatim)
 *   - visually distinct from the SPEC §7.1 pad color [114, 114, 114]
 *   - RGB without an alpha channel affecting the result (alpha=255)
 *
 * Jimp v0.22.x color constants: 0xRRGGBBAA, all channels 0-255.
 *
 * Usage:
 *   node scripts/create-samples.js
 */

'use strict';

const path = require('path');
const Jimp = require('jimp');

const SAMPLES_DIR = path.join(__dirname, 'python-ref', 'samples');

const SAMPLES = [
  { name: 'square.png', w: 300, h: 300, color: 0xFF0000FF }, // red,   alpha=255
  { name: 'tall.png',   w: 100, h: 300, color: 0x0000FFFF }, // blue,  alpha=255
  { name: 'wide.png',   w: 300, h: 100, color: 0x00FF00FF }, // green, alpha=255
];

function makeImage(w, h, color) {
  return new Promise((resolve, reject) => {
    new Jimp(w, h, color, (err, img) => {
      if (err) return reject(err);
      resolve(img);
    });
  });
}

async function main() {
  const fs = require('fs');
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });

  for (const s of SAMPLES) {
    const img = await makeImage(s.w, s.h, s.color);
    const out = path.join(SAMPLES_DIR, s.name);
    await img.writeAsync(out);
    // Verify round-trip: width/height/color.
    const read = await Jimp.read(out);
    if (read.bitmap.width !== s.w || read.bitmap.height !== s.h) {
      throw new Error(
        `${s.name}: expected ${s.w}x${s.h}, got ${read.bitmap.width}x${read.bitmap.height}`
      );
    }
    const c = Jimp.intToRGBA(read.getPixelColor(0, 0));
    const expected = Jimp.intToRGBA(s.color);
    if (c.r !== expected.r || c.g !== expected.g || c.b !== expected.b) {
      throw new Error(
        `${s.name}: expected RGB(${expected.r},${expected.g},${expected.b}), ` +
        `got RGB(${c.r},${c.g},${c.b})`
      );
    }
    console.log(`[create] ${s.name}  ${s.w}x${s.h}  RGB(${c.r},${c.g},${c.b})  -> ${out}`);
  }
}

main().catch((e) => {
  console.error('[create] FAILED:', e.message);
  process.exit(1);
});
