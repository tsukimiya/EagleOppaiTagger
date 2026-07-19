/**
 * src/eagle-bridge.js
 *
 * Thin wrappers around the Eagle Plugin API used by the main loop.
 * In the Eagle renderer process `eagle` exists as a global object.
 * Tests can inject a mock by setting `global.eagle.item = { getSelected: ... }`.
 *
 * SPEC reference: .spec/SPEC.md §7.4
 */
"use strict";

async function getSelectedItems() {
  return await eagle.item.getSelected();
}

async function saveItem(item) {
  await item.save();
}

module.exports = { getSelectedItems, saveItem };
