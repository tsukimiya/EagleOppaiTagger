/**
 * src/eagle-bridge.js
 *
 * Eagle Plugin API の薄ラッパー。
 * eagle グローバルは renderer の初期化タイミングによって未定義の場合があるため、
 * 関数内で遅延参照する。
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

module.exports = { getSelectedItems, saveItem };
