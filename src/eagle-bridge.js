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
 * Phase 10.1 注意: `fields` に `filePath` を含めないこと。
 * `eagle.item.get({ fields: [..., "filePath", ...] })` で `filePath` が
 * `${name}.undefined` になり ENOENT となる（詳細は .spec/KNOWLEDGE.md Phase 10.1）。
 * `filePath` が必要な場合は `getItemById(id)` で fields なし取得すること。
 *
 * @param {string[]} [fields=["id","tags","importedAt"]] - filePath は含めないこと
 * @returns {Promise<object[]>}
 */
async function getUntagged(fields) {
  const selectFields = fields || ["id", "tags", "importedAt"];
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

/**
 * 指定 ID のアイテムを `fields` プロジェクションなしで取得する（フル item）。
 *
 * Phase 10.1 修正: `eagle.item.get({ fields: [...] })` で `filePath` を指定しても
 * 正常に取得できない（Eagle 内部が `${name}.${ext}` を組み立てる際 `ext` が
 * プロジェクション対象外で undefined になり、`.undefined` で ENOENT）。
 * 手動モードの `getSelected()`（fields なし）と同等のフル item を取得するには、
 * `fields` を省略して呼ぶ必要がある。
 *
 * @param {string} id
 * @returns {Promise<object|null>} フル item。存在しない場合は null。
 */
async function getItemById(id) {
  const items = await getEagle().item.get({ ids: [id] });
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

module.exports = {
  getSelectedItems,
  saveItem,
  getItems,
  getIdsWithModifiedAt,
  getUntagged,
  countUntagged,
  getItemById,
};
