/**
 * src/downloader.js
 *
 * OppaiOracle V1.1 ONNX モデルのダウンロードモジュール。
 * HuggingFace から 3 ファイルを DL し、SHA256 検証・レジューム・リトライ・
 * 進捗コールバックに対応する。
 *
 * SPEC reference: .spec/SPEC.md §7.6
 */
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE_URL = "https://huggingface.co/Grio43/OppaiOracle/resolve/main/V1.1_onnx";
const TARGET_DIR = path.join(__dirname, "..", "models", "V1.1");

// 初回 DL 時に実際のハッシュを確認して埋める。
// プレースホルダー時は検証をスキップし、コンソールに実ハッシュを出力する。
const SHA256 = {
  "model.onnx": "TO_BE_FILLED_AFTER_FIRST_DOWNLOAD",
  "selected_tags.csv": "TO_BE_FILLED_AFTER_FIRST_DOWNLOAD",
  "pr_thresholds.json": "TO_BE_FILLED_AFTER_FIRST_DOWNLOAD",
};

const FILES = ["selected_tags.csv", "pr_thresholds.json", "model.onnx"];

/**
 * ファイルの SHA256 ハッシュを計算する。
 * @param {string} filePath
 * @returns {Promise<string>} hex digest
 */
async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function isPlaceholder(expected) {
  return typeof expected === "string" && expected.startsWith("TO_BE_FILLED");
}

/**
 * ダウンロード後の SHA256 を検証する。
 * プレースホルダーの場合は検証をスキップし、ユーザーに実ハッシュを表示する。
 * @param {string} filePath
 * @param {string} expected
 * @returns {Promise<boolean>}
 */
async function verifySha256(filePath, expected) {
  const actual = await sha256File(filePath);
  const baseName = path.basename(filePath);
  if (isPlaceholder(expected)) {
    console.log(`SHA256 not yet registered for ${baseName} — first download, trust but verify manually`);
    console.log(`  Actual SHA256: ${actual}`);
    return true;
  }
  if (actual !== expected) {
    throw new Error(`SHA256 mismatch for ${baseName}: expected ${expected}, got ${actual}`);
  }
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数関数的バックオフ付きで関数をリトライする。
 * @param {Function} fn
 * @param {number} maxRetries
 * @returns {Promise<*>}
 */
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000;
      await sleep(delay);
    }
  }
}

/**
 * Content-Range ヘッダーをパースする。
 * @param {string|undefined} header
 * @returns {{start:number,end:number,total:number}|null}
 */
function parseContentRange(header) {
  if (!header) return null;
  const m = header.match(/bytes\s+(\d+)-(\d+)\/(\d+)/);
  if (!m) return null;
  return {
    start: parseInt(m[1], 10),
    end: parseInt(m[2], 10),
    total: parseInt(m[3], 10),
  };
}

/**
 * https.get 用のオプションを構築する。
 * @param {string} fileName
 * @param {number} startByte
 * @returns {object}
 */
function buildOptions(fileName, startByte) {
  const options = {
    hostname: "huggingface.co",
    path: `/Grio43/OppaiOracle/resolve/main/V1.1_onnx/${fileName}`,
    method: "GET",
    rejectUnauthorized: true,
  };
  if (startByte > 0) {
    options.headers = { Range: `bytes=${startByte}-` };
  }
  return options;
}

/**
 * 単一ファイルを DL する。
 * レジューム、リトライ、SHA256 検証、進捗コールバックに対応。
 *
 * @param {string} fileName
 * @param {string} targetPath
 * @param {Function} [onProgress]
 */
async function downloadFile(fileName, targetPath, onProgress) {
  const tmpPath = targetPath + ".tmp";
  const startByte = fs.existsSync(tmpPath) ? fs.statSync(tmpPath).size : 0;

  return await withRetry(async () => {
    const options = buildOptions(fileName, startByte);

    return new Promise((resolve, reject) => {
      const req = https.get(options, (res) => {
        const status = res.statusCode;

        // 416 の場合は tmp が実ファイルより大きい可能性がある。削除してリトライ。
        if (status === 416) {
          res.resume();
          if (fs.existsSync(tmpPath)) {
            fs.unlinkSync(tmpPath);
          }
          reject(new Error(`HTTP 416 for ${fileName}, will restart from byte 0`));
          return;
        }

        if (status !== 200 && status !== 206) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${fileName}`));
          return;
        }

        let total = 0;
        if (status === 206) {
          const cr = parseContentRange(res.headers["content-range"]);
          total = cr
            ? cr.total
            : startByte + parseInt(res.headers["content-length"] || "0", 10);
        } else {
          total = parseInt(res.headers["content-length"] || "0", 10);
        }
        if (startByte > 0 && total < startByte) {
          total = startByte;
        }

        const writeFlags = status === 206 ? "a" : "w";
        const fileStream = fs.createWriteStream(tmpPath, { flags: writeFlags });

        let downloaded = startByte;
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (onProgress) {
            const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
            onProgress({ downloaded, total, percent });
          }
        });

        res.on("error", (err) => {
          fileStream.destroy();
          reject(err);
        });

        fileStream.on("error", (err) => {
          res.destroy();
          reject(err);
        });

        fileStream.on("finish", async () => {
          try {
            await verifySha256(tmpPath, SHA256[fileName]);
            fs.renameSync(tmpPath, targetPath);
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        res.pipe(fileStream);
      });

      req.on("error", (err) => {
        reject(err);
      });
    });
  });
}

/**
 * モデル一式を DL する。
 * @param {Function} [onProgress]
 */
async function downloadAll(onProgress) {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  let done = 0;
  const total = FILES.length;

  for (const fileName of FILES) {
    const targetPath = path.join(TARGET_DIR, fileName);
    if (fs.existsSync(targetPath)) {
      done++;
      continue;
    }

    const fileProgress = (info) => {
      if (onProgress) {
        onProgress({
          file: fileName,
          done: done,
          total: total,
          downloading: { name: fileName, percent: info.percent },
        });
      }
    };

    await downloadFile(fileName, targetPath, fileProgress);
    done++;
  }

  if (onProgress) {
    onProgress({ done: done, total: total, downloading: null });
  }
}

module.exports = {
  downloadAll,
  downloadFile,
  sha256File,
  verifySha256,
  withRetry,
  SHA256,
  TARGET_DIR,
  BASE_URL,
};
