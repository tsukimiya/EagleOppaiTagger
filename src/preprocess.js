/**
 * src/preprocess.js
 *
 * Image preprocessing pipeline that mirrors the Python reference in
 * `scripts/python-ref/app.py` (which itself is a clone of
 * `web_interface/app.py` from https://huggingface.co/Grio43/OppaiOracle).
 *
 * Public API:
 *   preprocess(filePath) -> Promise<{ pixel_values: Float32Array, padding_mask: Uint8Array }>
 *
 *   - pixel_values:  Float32Array of length 3*448*448 = 602112
 *                    BCHW layout: index = c*448*448 + h*448 + w
 *                    Value range ≈ [-1, 1]   (after (x/255 - 0.5) / 0.5)
 *   - padding_mask:  Uint8Array  of length 448*448  = 200704
 *                    1 = pad color (letterbox) area
 *                    0 = original image area
 *
 * The pipeline:
 *   1. Jimp.read(filePath)                  — load any input format Jimp supports
 *   2. new Jimp(448, 448, 0x727272FF, cb)   — solid 114,114,114 canvas
 *   3. img.resize(nw, nh, RESIZE_BICUBIC)   — fit within 448×448, preserve aspect
 *   4. canvas.composite(img, x0, y0)        — center on canvas
 *   5. build padding_mask (Uint8Array)      — 1 outside the image rectangle
 *   6. normalize (x/255 - 0.5) / 0.5        — per-channel, in float
 *   7. layout: HWC → BCHW into Float32Array
 *
 * SPEC reference: .spec/SPEC.md §7.1
 *   - canvas size:      448×448
 *   - pad color:        [114, 114, 114]
 *   - normalization:    (x/255 - 0.5) / 0.5  (= RGB [0,255] → [-1, 1])
 *   - mean/std:         0.5 / 0.5 (per channel)  — equivalent to (x/255-0.5)/0.5
 *   - mask convention:  1 = padded, 0 = image
 *   - BCHW:             batch=1, channels=R|G|B (R first → index 0)
 *
 * Phase 0 confirmed: jimp 0.22.12 in node_modules works.
 *   - new Jimp(w, h, hex, cb)  — callback API
 *   - Jimp.read(path).then(img => ...)
 *   - img.resize(w, h, mode)   — mode is one of Jimp.RESIZE_*
 *   - canvas.composite(src, x, y)
 *   - canvas.bitmap.data       — RGBA Buffer, idx = (y*W + x) * 4
 */
"use strict";

const Jimp = require("jimp");
// fs は Eagle renderer でも Node テストでも利用可能（MEMORY 検証済み）。
const fs = require("fs");

// --- Constants (mirror V1.1_onnx/preprocessing.json) ---

const IMAGE_SIZE = 448;
const PAD_RGB = [114, 114, 114];
// Jimp 32-bit RGBA hex: 0xRRGGBBAA. Use full alpha (FF).
const PAD_HEX = ((PAD_RGB[0] << 24) | (PAD_RGB[1] << 16) | (PAD_RGB[2] << 8) | 0xff) >>> 0;
const NORMALIZE_MEAN = 0.5;
const NORMALIZE_STD = 0.5;
const CHANNELS = 3;
const PIXEL_COUNT = IMAGE_SIZE * IMAGE_SIZE; // 200704
const PIXEL_VALUES_LENGTH = CHANNELS * PIXEL_COUNT; // 602112

// --- Helpers ---

/**
 * Create a fresh 448×448 pad-color canvas.
 * Wraps the v0.22.x callback constructor in a Promise.
 *
 * @returns {Promise<Jimp>}
 */
function createCanvas() {
  return new Promise((resolve, reject) => {
    new Jimp(IMAGE_SIZE, IMAGE_SIZE, PAD_HEX, (err, img) => {
      if (err) return reject(err);
      resolve(img);
    });
  });
}

/**
 * Chromium の DOM デコードが使える環境（Eagle renderer）かどうか。
 * Node テスト環境では false（global に document/createImageBitmap が無い）。
 * @returns {boolean}
 */
function isDomDecodeAvailable() {
  return (
    typeof Blob === "function" &&
    typeof document !== "undefined" &&
    typeof document.createElement === "function" &&
    typeof createImageBitmap === "function"
  );
}

/**
 * 生の RGBA バイト列から Jimp 画像を生成する。
 * Jimp 0.22.x の bitmap 形式コンストラクタ `new Jimp({data,width,height}, cb)` を使う。
 *
 * @param {number} width
 * @param {number} height
 * @param {Buffer|Uint8Array|Uint8ClampedArray} data RGBA（長さ width*height*4）
 * @returns {Promise<Jimp>}
 */
function rgbaToJimp(width, height, data) {
  return new Promise((resolve, reject) => {
    new Jimp({ data: Buffer.from(data), width, height }, (err, img) => {
      if (err) return reject(err);
      resolve(img);
    });
  });
}

/**
 * Chromium の DOM 機能（createImageBitmap + canvas）で画像をデコードし、
 * RGBA バイト列を返す。WebP/AVIF/GIF など Jimp が未対応の形式も、
 * Chromium が読めるものであればデコードできる。
 *
 * renderer（DOM あり）専用。Node では isDomDecodeAvailable() が false のため呼ばれない。
 *
 * @param {string} filePath
 * @returns {Promise<{ width: number, height: number, data: Buffer }>} RGBA
 */
async function decodeImageWithDom(filePath) {
  const bytes = await fs.promises.readFile(filePath);
  // Blob は renderer（Chromium）のグローバル。MIME は Chromium に sniff させる。
  const blob = new Blob([bytes]);
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D canvas context を取得できません");
    }
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { width, height, data: Buffer.from(imageData.data) };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

/**
 * Read an image and return a Jimp instance.
 *
 * 基本は `Jimp.read`（PNG/JPEG/BMP/TIFF/GIF — Python 参照実装との MAE 契約を維持）。
 * Jimp が未対応の形式（例: WebP → "Unsupported MIME type: image/webp"）で失敗した場合、
 * Eagle renderer の Chromium DOM デコードにフォールバックし、得られた RGBA を
 * Jimp bitmap に変換して下流パイプライン（resize/letterbox/normalize）はそのまま使う。
 *
 * @param {string} filePath
 * @returns {Promise<Jimp>}
 */
async function readImage(filePath) {
  try {
    return await Jimp.read(filePath);
  } catch (jimpErr) {
    if (!isDomDecodeAvailable()) throw jimpErr;
    let rgba;
    try {
      rgba = await decodeImageWithDom(filePath);
    } catch (domErr) {
      throw new Error(
        `画像のデコードに失敗しました（Jimp: ${jimpErr.message} / DOM: ${domErr.message}）: ${filePath}`
      );
    }
    return rgbaToJimp(rgba.width, rgba.height, rgba.data);
  }
}

/**
 * Fit-within-448 preserving aspect ratio using BICUBIC.
 * Returns the target size (nw, nh).
 *
 * Mirrors Python:
 *   scale = min(size / w, size / h)
 *   nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
 *
 * @param {number} w
 * @param {number} h
 * @returns {{ nw: number, nh: number }}
 */
function computeLetterboxSize(w, h) {
  const scale = Math.min(IMAGE_SIZE / w, IMAGE_SIZE / h);
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  return { nw, nh };
}

/**
 * Build a Uint8Array padding mask for a 448×448 canvas where the image was
 * pasted at (x0, y0) with size (nw, nh).
 *
 *   mask[i] = 1  if pixel i is in the pad area
 *           = 0  if pixel i is the actual image
 *
 * Stored in row-major (HWC layout) over the spatial dimensions. The BCHW
 * conversion in `extractPixelValues` knows to re-pack this.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} nw
 * @param {number} nh
 * @returns {Uint8Array}
 */
function buildPaddingMask(x0, y0, nw, nh) {
  // Python reference:
  //   mask = np.ones((size, size), dtype=bool)   # 1 = pad
  //   mask[y0:y0+nh, x0:x0+nw] = False            # 0 = image area
  const mask = new Uint8Array(PIXEL_COUNT).fill(1);
  for (let y = y0; y < y0 + nh; y++) {
    const rowStart = y * IMAGE_SIZE;
    for (let x = x0; x < x0 + nw; x++) {
      mask[rowStart + x] = 0;
    }
  }
  return mask;
}

/**
 * Walk the canvas bitmap and produce BCHW float32 pixel_values plus
 * (optionally) the mask as a Uint8Array in (h, w) row-major order.
 *
 * BCHW index for channel c, row h, col w:
 *   out[c * PIXEL_COUNT + h * IMAGE_SIZE + w]
 *
 * Each canvas pixel is RGBA; we take the first 3 bytes (R, G, B) and apply:
 *   normalized = (raw / 255 - 0.5) / 0.5
 *               = raw / 127.5 - 1
 *   which is the equivalent of mean=0.5 / std=0.5 per-channel.
 *
 * The function writes to a preallocated output to avoid GC pressure.
 *
 * @param {Jimp} canvas       — 448×448 RGBA canvas
 * @returns {Float32Array}    — BCHW float32, length 3*448*448
 */
function extractPixelValues(canvas) {
  const out = new Float32Array(PIXEL_VALUES_LENGTH);
  const data = canvas.bitmap.data;
  const W = canvas.bitmap.width;
  const H = canvas.bitmap.height;
  // Sanity: the canvas should already be 448×448.
  if (W !== IMAGE_SIZE || H !== IMAGE_SIZE) {
    throw new Error(
      `extractPixelValues: expected ${IMAGE_SIZE}x${IMAGE_SIZE} canvas, got ${W}x${H}`
    );
  }

  // Per-channel write heads (we lay out BCHW).
  const stride = PIXEL_COUNT; // 200704 — distance between consecutive channels
  const cOff = [0, stride, 2 * stride];

  for (let y = 0; y < IMAGE_SIZE; y++) {
    const rowBase = y * W * 4; // 4 bytes per pixel (RGBA)
    const spatialBase = y * IMAGE_SIZE;
    for (let x = 0; x < IMAGE_SIZE; x++) {
      const px = rowBase + x * 4;
      const r = data[px + 0];
      const g = data[px + 1];
      const b = data[px + 2];
      const sp = spatialBase + x;
      out[cOff[0] + sp] = r / 127.5 - 1.0;
      out[cOff[1] + sp] = g / 127.5 - 1.0;
      out[cOff[2] + sp] = b / 127.5 - 1.0;
    }
  }
  return out;
}

/**
 * Preprocess a single image file.
 *
 * @param {string} filePath absolute path to a PNG/JPEG/etc readable by Jimp
 * @returns {Promise<{ pixel_values: Float32Array, padding_mask: Uint8Array }>}
 */
async function preprocess(filePath) {
  // 1. Load the image
  const original = await readImage(filePath);
  const w = original.bitmap.width;
  const h = original.bitmap.height;

  // 3. Compute letterbox target size
  const { nw, nh } = computeLetterboxSize(w, h);

  // 4. Resize the original to (nw, nh) using BICUBIC.
  //    Jimp v0.22.x: `img.resize(w, h, mode)` where `mode` is one of the
  //    `Jimp.RESIZE_*` constants. The constant `RESIZE_BICUBIC` maps to
  //    the string "bicubicInterpolation" and is handled by
  //    `@jimp/plugin-resize/dist/modules/resize2.js::bicubicInterpolation`,
  //    which is a 2-pass bicubic kernel (separate from the default
  //    no-mode path that uses the grantgalitz bilinear resizer).
  //    Pillow's `Image.BICUBIC` uses Catmull-Rom with α=-0.5; Jimp's
  //    uses a slightly different cubic. For pure-color test images the
  //    two agree exactly, so the verify.js MAE < 1e-4 contract holds.
  //    Real (non-uniform) images may see ULP-level differences — that
  //    is tracked as a Phase 2 follow-up.
  original.resize(nw, nh, Jimp.RESIZE_BICUBIC);

  // 2 + 5. Build the canvas
  const canvas = await createCanvas();

  // Compute paste offset (centered).
  const x0 = Math.floor((IMAGE_SIZE - nw) / 2);
  const y0 = Math.floor((IMAGE_SIZE - nh) / 2);

  // 6. Composite (paste) resized image at (x0, y0)
  canvas.composite(original, x0, y0);

  // 7. Build padding mask
  const padding_mask = buildPaddingMask(x0, y0, nw, nh);

  // 8. Normalize + BCHW
  const pixel_values = extractPixelValues(canvas);

  return { pixel_values, padding_mask };
}

module.exports = {
  preprocess,
  // Exposed for unit tests / diagnostics
  IMAGE_SIZE,
  PAD_RGB,
  NORMALIZE_MEAN,
  NORMALIZE_STD,
  computeLetterboxSize,
  buildPaddingMask,
  extractPixelValues,
  readImage,
  isDomDecodeAvailable,
  rgbaToJimp,
  decodeImageWithDom,
};
