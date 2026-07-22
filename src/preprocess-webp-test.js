/**
 * src/preprocess-webp-test.js
 *
 * WebP（および Jimp 未対応形式）デコードフォールバックの単体テスト。
 *
 * 背景: Jimp 0.22.12 は WebP 未対応で `Jimp.read()` が
 *   "Unsupported MIME type: image/webp" を投げていた（実機報告）。
 * 修正: readImage() が Jimp 失敗時に Eagle renderer の Chromium DOM
 *   （createImageBitmap + canvas）へフォールバックし、RGBA を Jimp bitmap に
 *   変換して下流パイプラインはそのまま使う。
 *
 * Node 環境には DOM が無いため、createImageBitmap / document / Blob を
 * スタブ化して「DOM デコード → rgbaToJimp → preprocess」の配管を検証する。
 * 実際の WebP デコードは実機（renderer）で検証する。
 *
 * Run with: node src/preprocess-webp-test.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Jimp = require("jimp");

const {
  preprocess,
  readImage,
  isDomDecodeAvailable,
  rgbaToJimp,
} = require("./preprocess");

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { console.log("  PASS: " + msg); passed++; }
  else { console.error("  FAIL: " + msg); failed++; }
}
function section(name) { console.log("\n=== " + name + " ==="); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oppai-webp-"));

/** 指定 RGBA を返す DOM デコードのスタブを global に設置する。 */
function installDomStub(width, height, rgbaUint8Clamped) {
  global.Blob = class Blob {
    constructor(_parts, _opts) { /* 内容は使わない */ }
  };
  global.createImageBitmap = async function createImageBitmap(_blob) {
    return { width, height, close() {} };
  };
  global.document = {
    createElement(_tag) {
      return {
        width: 0,
        height: 0,
        getContext(_kind) {
          return {
            drawImage() {},
            getImageData(_x, _y, _w, _h) {
              return { data: rgbaUint8Clamped };
            },
          };
        },
      };
    },
  };
}

/** DOM スタブを解除し、Node 環境（DOM なし）に戻す。 */
function removeDomStub() {
  delete global.Blob;
  delete global.createImageBitmap;
  delete global.document;
}

/** Float32Array / Uint8Array が要素単位で等しいか。 */
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testIsDomDecodeAvailableFalseInNode() {
  section("isDomDecodeAvailable は Node（DOM なし）で false");
  removeDomStub();
  ok(isDomDecodeAvailable() === false, "Node 環境では false");
}

function testIsDomDecodeAvailableRequiresBlob() {
  section("isDomDecodeAvailable は Blob も必須");
  removeDomStub();
  global.createImageBitmap = async function createImageBitmap(_blob) {
    return { width: 1, height: 1, close() {} };
  };
  global.document = {
    createElement() {
      return {
        getContext() {
          return {
            drawImage() {},
            getImageData() { return { data: new Uint8ClampedArray(4) }; },
          };
        },
      };
    },
  };
  try {
    ok(isDomDecodeAvailable() === false, "Blob が無ければ false");
  } finally {
    removeDomStub();
  }
}

async function testRgbaToJimp() {
  section("rgbaToJimp が RGBA バイト列から Jimp を生成");
  const w = 2, h = 2;
  const data = Buffer.from([
    255, 0, 0, 255,   0, 255, 0, 255,
    0, 0, 255, 255,   255, 255, 0, 255,
  ]);
  const img = await rgbaToJimp(w, h, data);
  ok(img.bitmap.width === w && img.bitmap.height === h, `サイズが ${w}x${h}`);
  ok(arraysEqual([...img.bitmap.data], [...data]), "ピクセル値が保持される");
}

async function testFallbackEquivalentToPngPath() {
  section("DOM フォールバック経路の出力が PNG 通常経路と完全一致");

  // 元画像（3x2, 任意の色）を Jimp で作り、RGBA を確定させる。
  const w = 3, h = 2;
  const src = new Jimp(w, h);
  const colors = [
    0xff0000ff, 0x00ff00ff, 0x0000ffff,
    0x123456ff, 0xfedcbaff, 0x808080ff,
  ];
  let ci = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      src.setPixelColor(colors[ci++], x, y);
    }
  }
  // 先頭にダミー領域を置いた subarray を使い、byteOffset 非ゼロでも
  // preprocess.js が余分な領域を取り込まないことを回帰テストする。
  const rgba = new Uint8ClampedArray(src.bitmap.data.length + 8);
  rgba.set(src.bitmap.data, 4);
  const rgbaWithOffset = rgba.subarray(4, 4 + src.bitmap.data.length);

  // 通常経路: 実 PNG ファイル → preprocess
  const pngPath = path.join(tmpDir, "ref.png");
  await src.writeAsync(pngPath);
  const viaPng = await preprocess(pngPath);

  // フォールバック経路: 実体はダミーの webp 風ファイルを DOM スタブで同じ RGBA にデコード
  installDomStub(w, h, rgbaWithOffset);
  try {
    ok(isDomDecodeAvailable() === true, "DOM スタブ設置中は true");

    // WebP マジックバイト（RIFF....WEBP）で「Jimp が拒否するファイル」を再現
    const webpPath = path.join(tmpDir, "fake.png.webp");
    fs.writeFileSync(webpPath, Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "binary"));

    // 前提確認: このファイルは Jimp では読めない（= 報告されたバグの再現）
    let jimpFailed = false;
    try { await Jimp.read(webpPath); } catch (_e) { jimpFailed = true; }
    ok(jimpFailed, "webp 風ファイルは Jimp.read が失敗する（バグ再現）");

    const decoded = await readImage(webpPath);
    ok(
      arraysEqual([...decoded.bitmap.data], [...src.bitmap.data]),
      "DOM デコード後の RGBA が元画像と完全一致"
    );

    const viaWebp = await preprocess(webpPath);

    ok(
      arraysEqual(viaWebp.pixel_values, viaPng.pixel_values),
      "pixel_values が PNG 経路と完全一致"
    );
    ok(
      arraysEqual(viaWebp.padding_mask, viaPng.padding_mask),
      "padding_mask が PNG 経路と完全一致"
    );
    ok(viaWebp.pixel_values.length === 3 * 448 * 448, "pixel_values 長さ 602112");
    ok(viaWebp.padding_mask.length === 448 * 448, "padding_mask 長さ 200704");
  } finally {
    removeDomStub();
  }
}

async function testJimpErrorPropagatesWithoutDom() {
  section("DOM 非利用時は Jimp の元エラーが伝播する");
  removeDomStub();
  const badPath = path.join(tmpDir, "not-an-image.webp");
  fs.writeFileSync(badPath, Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "binary"));
  let threw = false;
  try {
    await readImage(badPath);
  } catch (err) {
    threw = true;
    ok(/mime|image|could not/i.test(err.message), "エラーメッセージが伝播する: " + err.message);
  }
  ok(threw, "DOM なしで未対応形式を読むと例外");
}

async function testDomFailureReportsBoth() {
  section("DOM デコード失敗時は Jimp/DOM 双方のエラーを含む");
  const badPath = path.join(tmpDir, "dom-fails.webp");
  fs.writeFileSync(badPath, Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "binary"));
  // DOM は利用可能だが createImageBitmap が失敗する状況
  // 可用性判定後に canvas context 取得で失敗させるので、Blob 実装は最小で十分。
  global.Blob = class Blob { constructor() {} };
  global.createImageBitmap = async function () { throw new Error("decode failed"); };
  global.document = { createElement() { return {}; } };
  try {
    let threw = false;
    try {
      await readImage(badPath);
    } catch (err) {
      threw = true;
      ok(/DOM:/.test(err.message), "DOM 側エラーを含む: " + err.message);
      ok(/Jimp:/.test(err.message), "Jimp 側エラーを含む");
    }
    ok(threw, "双方失敗時は例外");
  } finally {
    removeDomStub();
  }
}

async function testDomContextFailureReportsBoth() {
  section("canvas 2D context 取得失敗時は DOM エラーとして報告");
  const badPath = path.join(tmpDir, "ctx-null.webp");
  fs.writeFileSync(badPath, Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "binary"));
  global.Blob = class Blob { constructor() {} };
  global.createImageBitmap = async function () { return { width: 1, height: 1, close() {} }; };
  global.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() { return null; },
      };
    },
  };
  try {
    let threw = false;
    try {
      await readImage(badPath);
    } catch (err) {
      threw = true;
      ok(/2D canvas context/.test(err.message), "context 取得失敗が含まれる: " + err.message);
      ok(/DOM:/.test(err.message), "DOM 側エラーとして報告される");
    }
    ok(threw, "context 取得失敗時は例外");
  } finally {
    removeDomStub();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log("Preprocess WebP Fallback Test");
  console.log("=============================================");
  try {
    testIsDomDecodeAvailableFalseInNode();
    testIsDomDecodeAvailableRequiresBlob();
    await testRgbaToJimp();
    await testFallbackEquivalentToPngPath();
    await testJimpErrorPropagatesWithoutDom();
    await testDomFailureReportsBoth();
    await testDomContextFailureReportsBoth();
  } catch (err) {
    console.error("\nFATAL ERROR: " + err.message);
    console.error(err.stack);
    failed++;
  } finally {
    removeDomStub();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
  }
  console.log("\n=============================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
})();
