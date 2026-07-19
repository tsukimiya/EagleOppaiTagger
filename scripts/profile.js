/**
 * scripts/profile.js
 *
 * Phase 6 プロファイリングスクリプト。
 * 指定ディレクトリ内の画像をバッチ処理し、wall-clock とメモリを計測する。
 *
 * 使用方法:
 *   node scripts/profile.js <画像ディレクトリ> [オプション]
 *
 * 例:
 *   node scripts/profile.js test-images/
 *   node scripts/profile.js test-images/ --model models/V1.1/
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODELS_DIR = path.join(ROOT, "models", "V1.1");

// ── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const imageDir = args[0] ? path.resolve(args[0]) : null;

if (!imageDir || args.includes("--help") || args.includes("-h")) {
  console.log("Phase 6 プロファイリング");
  console.log("  使用方法: node scripts/profile.js <画像ディレクトリ> [--model <dir>] [--warmup] [--server-url <url>]");
  console.log("  例:       node scripts/profile.js test-images/");
  console.log("            node scripts/profile.js test-images/ --model models/V1.1/");
  console.log("            node scripts/profile.js test-images/ --server-url http://localhost:8765");
  console.log("  --warmup  初回コールドスタートを含めずに 2 回目以降を計測");
  console.log("  --server-url <url>  推論サーバ URL（指定時はサーバ経由で推論）");
  process.exit(1);
}

const modelDir = (() => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model" && args[i + 1]) return path.resolve(args[i + 1]);
  }
  return MODELS_DIR;
})();

const warmup = args.includes("--warmup");

const serverUrl = (() => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server-url" && args[i + 1]) return args[i + 1];
  }
  return null;
})();

// ── 依存チェック ────────────────────────────────────────────────────────────

const modelOnnx = path.join(modelDir, "model.onnx");
const tagsCsv = path.join(modelDir, "selected_tags.csv");

if (!serverUrl) {
  // ローカル推論時のみモデルファイルが必要
  if (!fs.existsSync(modelOnnx)) {
    console.error(`モデルが見つかりません: ${modelOnnx}`);
    console.error(`  ダウンロード: https://huggingface.co/Grio43/OppaiOracle/tree/main/V1.1_onnx`);
    console.error(`  --model で別ディレクトリを指定できます`);
    process.exit(1);
  }
  if (!fs.existsSync(tagsCsv)) {
    console.error(`selected_tags.csv が見つかりません: ${tagsCsv}`);
    process.exit(1);
  }
}

// ダウンローダーで DL していない場合は models/ のパスを設定
process.env.OPPAI_TAGS_PATH = tagsCsv;

// inference.js の MODEL_PATH を上書き（直接代入）
const inference = require(path.join(ROOT, "src", "inference"));
const downloader = require(path.join(ROOT, "src", "downloader"));
const MODEL_PATH_KEY = Symbol.for ? Symbol.for("MODEL_PATH") : null;

// inference.js は MODEL_PATH を定数で持っているので、書き換えには require.cache 再読み込みが必要。
// 簡易的には MODEL_PATH を直接書き換える。
const origModelPath = inference.MODEL_PATH;
Object.defineProperty(inference, "MODEL_PATH", { value: modelOnnx, writable: true, configurable: true });

// inference.js の getSession が最初の推論時に session を作る。
// 初回はコールドスタート（モデルロード含む）、2 回目以降はキャッシュ。

const { preprocess } = require(path.join(ROOT, "src", "preprocess"));
const { probsToTags } = require(path.join(ROOT, "src", "tags"));

// ── 画像収集 ────────────────────────────────────────────────────────────────

function findImages(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...findImages(p));
      } else if (/\.(png|jpe?g|bmp|webp)$/i.test(e.name)) {
        results.push(p);
      }
    }
  } catch (_) { /* permission error, skip */ }
  return results;
}

const images = findImages(imageDir);
if (images.length === 0) {
  console.error(`${imageDir} に画像が見つかりません`);
  process.exit(1);
}

console.log(`画像数: ${images.length}`);
if (serverUrl) {
  console.log(`モード: サーバ推論 (${serverUrl})`);
} else {
  console.log(`モード: ローカル推論`);
  console.log(`モデル: ${modelDir}`);
}
console.log(`warmup: ${warmup}`);
console.log("");

// ── 計測ユーティリティ ──────────────────────────────────────────────────────

function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(ms) {
  if (ms < 1000) return ms.toFixed(1) + " ms";
  if (ms < 60000) return (ms / 1000).toFixed(2) + " s";
  return (ms / 60000).toFixed(2) + " min";
}

function memUsage() {
  const m = process.memoryUsage();
  return {
    rss: m.rss,
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    external: m.external,
  };
}

// ── プロファイリング実行 ────────────────────────────────────────────────────

async function profileOne(filePath, label, srvUrl) {
  const memBefore = memUsage();
  const t0 = Date.now();

  let probs;
  let source = "local";
  if (srvUrl) {
    const { inferRemote } = require(path.join(ROOT, "src", "inference-client"));
    probs = await inferRemote(filePath, { serverUrl: srvUrl, timeoutMs: 30000 });
    source = "server";
    const t2 = Date.now();
    const memAfter = memUsage();
    return {
      file: label || path.basename(filePath),
      preprocessMs: 0,
      inferenceMs: t2 - t0,
      totalMs: t2 - t0,
      rssBefore: memBefore.rss,
      rssAfter: memAfter.rss,
      heapBefore: memBefore.heapUsed,
      heapAfter: memAfter.heapUsed,
      numProbabilities: probs.length,
      source,
    };
  }

  const pre = await preprocess(filePath);
  const t1 = Date.now();
  probs = await inference.infer(pre);
  const t2 = Date.now();

  const settings = { threshold: 0.5, maxTags: 30, blacklist: new Set() };
  const memAfter = memUsage();

  return {
    file: label || path.basename(filePath),
    preprocessMs: t1 - t0,
    inferenceMs: t2 - t1,
    totalMs: t2 - t0,
    rssBefore: memBefore.rss,
    rssAfter: memAfter.rss,
    heapBefore: memBefore.heapUsed,
    heapAfter: memAfter.heapUsed,
    numProbabilities: probs.length,
    source,
  };
}

async function main() {
  const results = [];
  const overallStart = Date.now();

  // ウォームアップ（モデルロード含む初回は除く）
  if (warmup && images.length > 0) {
    process.stdout.write("ウォームアップ中... ");
    await profileOne(images[0], "warmup", serverUrl);
    // inference session がキャッシュされたので、次の run は純粋な推論計測
    console.log("完了\n");
  }

  console.log(`計測中 (${images.length} 枚)...`);

  for (let i = 0; i < images.length; i++) {
    process.stdout.write(`  [${String(i + 1).padStart(3, " ")}/${images.length}] ${path.basename(images[i])} ... `);
    try {
      const r = await profileOne(images[i], null, serverUrl);
      results.push(r);
      if (serverUrl) {
        console.log(`${formatTime(r.totalMs)}  (server)`);
      } else {
        console.log(`${formatTime(r.totalMs)}  (pre:${formatTime(r.preprocessMs)} inf:${formatTime(r.inferenceMs)})`);
      }
    } catch (err) {
      console.error(`エラー: ${err.message}`);
      results.push({ file: path.basename(images[i]), error: err.message });
    }
  }

  const overallEnd = Date.now();
  const overallMs = overallEnd - overallStart;

  // ── 集計 ─────────────────────────────────────────────────────────────────
  const succeeded = results.filter((r) => !r.error);
  if (succeeded.length === 0) {
    console.log("\n成功した処理がありません。");
    process.exit(1);
  }

  const times = succeeded.map((r) => r.totalMs).sort((a, b) => a - b);
  const n = times.length;
  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const median = n % 2 === 0 ? (times[n / 2 - 1] + times[n / 2]) / 2 : times[Math.floor(n / 2)];
  const min = times[0];
  const max = times[n - 1];
  const p95 = times[Math.floor(n * 0.95)];

  const preTimes = succeeded.map((r) => r.preprocessMs);
  const infTimes = succeeded.map((r) => r.inferenceMs);

  const rssPeak = Math.max(...succeeded.map((r) => r.rssAfter));
  const heapPeak = Math.max(...succeeded.map((r) => r.heapAfter));

  // ── 出力 ────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  console.log("プロファイリング結果");
  console.log(`${"=".repeat(60)}`);
  console.log(`  処理枚数:     ${n} / ${images.length}（エラー: ${results.length - n}）`);
  console.log(`  総時間:       ${formatTime(overallMs)}`);
  console.log(`  1枚あたり:`);
  console.log(`    平均:       ${formatTime(avg)}`);
  console.log(`    中央値:     ${formatTime(median)}`);
  console.log(`    最小:       ${formatTime(min)}`);
  console.log(`    最大:       ${formatTime(max)}`);
  console.log(`    p95:        ${formatTime(p95)}`);
  console.log(`  内訳:`);
  if (serverUrl) {
    console.log(`    サーバ推論平均: ${formatTime(infTimes.reduce((a, b) => a + b, 0) / infTimes.length)}`);
  } else {
    console.log(`    前処理平均: ${formatTime(preTimes.reduce((a, b) => a + b, 0) / preTimes.length)}`);
    console.log(`    推論平均:   ${formatTime(infTimes.reduce((a, b) => a + b, 0) / infTimes.length)}`);
  }
  console.log(`  メモリ:`);
  console.log(`    ピーク RSS: ${formatBytes(rssPeak)}`);
  console.log(`    ピーク Heap:${formatBytes(heapPeak)}`);

  // 目標値チェック
  console.log(`\n目標値判定:`);
  const speedOk = avg < 5000;
  const memOk = rssPeak < 2.5 * 1024 * 1024 * 1024;
  console.log(`  速度 ${speedOk ? "✅" : "❌"} 平均 ${formatTime(avg)} ${speedOk ? "<" : ">"} 5秒`);
  console.log(`  メモリ ${memOk ? "✅" : "❌"} ピーク ${formatBytes(rssPeak)} ${memOk ? "<" : ">"} 2.5 GB`);

  // レポート保存
  const report = {
    timestamp: new Date().toISOString(),
    imageDir: imageDir,
    serverUrl: serverUrl || null,
    mode: serverUrl ? "server" : "local",
    totalImages: images.length,
    succeeded: n,
    errors: results.length - n,
    overallMs,
    speed: { avg, median, min, max, p95 },
    preprocessAvgMs: preTimes.reduce((a, b) => a + b, 0) / preTimes.length,
    inferenceAvgMs: infTimes.reduce((a, b) => a + b, 0) / infTimes.length,
    memory: { rssPeak, heapPeak },
    goals: { speed5s: speedOk, memory2_5gb: memOk },
    perFile: results,
  };

  const reportPath = path.join(__dirname, "profile-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`\nレポート保存: ${reportPath}`);
}

main().catch((err) => {
  console.error("プロファイリング中に致命的エラー:", err);
  process.exit(1);
});
