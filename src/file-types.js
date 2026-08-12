/**
 * src/file-types.js
 *
 * 画像推論の対象外（動画等）となる拡張子のブロックリストと判定ヘルパ。
 *
 * Phase 10.5（2026-08-03）で auto-tagger.js 内に定義した NON_IMAGE_EXTS /
 * isNonImageExt を、手動タグ付け（main.js run）でも共有するため
 * 2026-08-12 にこのモジュールへ切り出した。
 *
 * 設計: 状態を持たない純粋関数モジュール。require 時の副作用なし。
 */
"use strict";

/**
 * 画像推論対象外の拡張子（動画形式）。ONNX 画像推論でデコード不可のため。
 * 新しい動画形式はここに追加するだけで両モード（自動・手動）から除外される。
 */
const NON_IMAGE_EXTS = new Set([
  "mp4", "webm", "mov", "avi", "mkv", "flv", "wmv", "m4v",
  "mpg", "mpeg", "3gp", "ts", "mts", "m2ts", "vob",
]);

/**
 * 拡張子が画像推論の対象外（動画等）か判定する。
 * @param {string} ext - Eagle item の ext フィールド（ドットなし）
 * @returns {boolean}
 */
function isNonImageExt(ext) {
  return typeof ext === "string" && NON_IMAGE_EXTS.has(ext.toLowerCase());
}

module.exports = { NON_IMAGE_EXTS, isNonImageExt };
