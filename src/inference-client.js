/**
 * src/inference-client.js
 *
 * サーバ側推論クライアント（Phase 7 の FastAPI サーバと通信）。
 * ローカル推論（inference.js）と同じシグネチャを提供する。
 *
 * 通信仕様:
 *   POST {serverUrl}/infer (multipart/form-data, field "file") -> JSON
 *   レスポンス: { probabilities: number[19294], num_classes, elapsed_ms, model_info }
 *
 * 入力画像はファイルパスではなく Buffer で渡す。
 * 既存の preprocess.js の出力（pixel_values + padding_mask）は使わない。
 * サーバ側で前処理を行うため、クライアントは「生画像を送る」だけでよい。
 *
 * SPEC reference: .spec/SPEC.md §7.2
 */
"use strict";

// fs/path は renderer で使えないため、関数内で遅延 require
let _fs = null;
let _path = null;
function getFs() { if (!_fs) _fs = require("fs"); return _fs; }
function getPath() { if (!_path) _path = require("path"); return _path; }

/**
 * 画像ファイルを推論サーバに送信し、確率配列を取得する。
 *
 * @param {string} filePath 画像ファイルの絶対パス
 * @param {object} options
 * @param {string} options.serverUrl サーバ URL（例: "http://192.168.1.10:8765"）
 * @param {number} [options.timeoutMs=10000] タイムアウト
 * @returns {Promise<Float32Array>} probabilities (19294)
 */
async function inferRemote(filePath, { serverUrl, timeoutMs = 10000 }) {
  if (!serverUrl) throw new Error("serverUrl is required");
  const fs = getFs();
  const path = getPath();
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  // 2. multipart/form-data 構築
  const boundary = "----OppaiTagger" + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`),
    Buffer.from(`Content-Type: application/octet-stream\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  // 3. fetch（Eagle renderer は fetch グローバル API を持つ）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl}/infer`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length.toString(),
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data.probabilities)) {
      throw new Error("Server response missing 'probabilities' array");
    }
    return Float32Array.from(data.probabilities);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * サーバのヘルスチェック。
 * @param {string} serverUrl
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{ ok: boolean, info?: object, error?: string }>}
 */
async function checkHealth(serverUrl, timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${serverUrl}/health`, { signal: controller.signal });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const info = await res.json();
      return { ok: true, info };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { inferRemote, checkHealth };
