/**
 * src/eagle-bridge.js
 *
 * Eagle Plugin API の薄ラッパー。
 * eagle グローバルは renderer の初期化タイミングによって未定義の場合があるため、
 * 関数内で遅延参照する。
 *
 * SPEC reference: .spec/SPEC.md §7.5, §15.3
 */
"use strict";

function getEagle() {
  if (typeof eagle === "undefined") throw new Error("eagle global not available — is the plugin loaded in Eagle?");
  return eagle;
}

async function getSelectedItems() {
  return await getEagle().item.getSelected();
}

async function saveItem(item) {
  await item.save();
}

// --- Phase 10: auto-mode helpers (SPEC §15.3) -----------------------------

/**
 * 万能検索メソッド（`eagle.item.get` のラッパー）。
 * 差分検知で得た ID 配列からフルデータを取得する際に使用。
 *
 * @param {object} options - `eagle.item.get` と同じ検索条件
 * @returns {Promise<object[]>}
 */
async function getItems(options) {
  return await getEagle().item.get(options);
}

/**
 * 全ファイルの {id, modifiedAt} を高速に取得。
 * 新規画像の差分検知に使用（`modifiedAt > lastScanAt` でフィルタ）。
 * Eagle 4.0 Build12+ 必須。
 *
 * @returns {Promise<Array<{ id: string, modifiedAt: number }>>}
 */
async function getIdsWithModifiedAt() {
  return await getEagle().item.getIdsWithModifiedAt();
}

/**
 * 未タグ付け画像を取得。既存画像のアイドル処理用。
 * fields を絞るとパフォーマンス向上（SPEC §15.4 Step C）。
 *
 * @param {string[]} [fields=["id","name","filePath","tags"]]
 * @returns {Promise<object[]>}
 */
async function getUntagged(fields) {
  const selectFields = fields || ["id", "name", "filePath", "tags"];
  return await getItems({ isUntagged: true, fields: selectFields });
}

/**
 * 未タグ付け画像の件数を取得（軽量・実データを読まない）。
 * UI の残件数表示や「処理すべき画像があるか」の事前判定に使用。
 *
 * @returns {Promise<number>}
 */
async function countUntagged() {
  return await getEagle().item.count({ isUntagged: true });
}

module.exports = {
  getSelectedItems,
  saveItem,
  getItems,
  getIdsWithModifiedAt,
  getUntagged,
  countUntagged,
};
