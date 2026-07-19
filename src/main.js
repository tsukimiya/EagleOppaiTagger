/**
 * src/main.js
 *
 * Main tagging loop: selected items → preprocess → infer → probsToTags
 * → merge with existing tags → save back to Eagle.
 *
 * Features:
 *   - per-item progress callbacks (processing / done / error / cancelled)
 *   - cooperative cancellation at the next image boundary
 *   - merge strategies: append / overwrite / diff
 *
 * SPEC reference: .spec/SPEC.md §6, §7.4
 */
"use strict";

const { preprocess } = require("./preprocess");
const { infer } = require("./inference");
const { inferRemote } = require("./inference-client");
const { probsToTags } = require("./tags");
const { loadSettings } = require("./settings");
const { getSelectedItems, saveItem } = require("./eagle-bridge");

let cancelRequested = false;

function requestCancel() {
  cancelRequested = true;
}

function mergeTags(existing, predicted, strategy) {
  switch (strategy) {
    case "overwrite":
      return [...predicted];
    case "diff":
      return existing.filter((t) => !predicted.includes(t)).concat(predicted);
    case "append":
    default:
      return [...new Set([...existing, ...predicted])];
  }
}

/**
 * 推論ルーティング（Phase 8）。
 * サーバ優先 → フォールバック → ローカル。
 *
 * @param {{ filePath: string }} item
 * @param {object} settings
 * @returns {Promise<{ probs: Float32Array, source: string }>}
 */
async function inferDispatch(item, settings) {
  if (settings.useServer && settings.serverUrl) {
    try {
      const probs = await inferRemote(item.filePath, {
        serverUrl: settings.serverUrl,
        timeoutMs: settings.serverTimeoutMs,
      });
      return { probs, source: "server" };
    } catch (err) {
      if (!settings.fallbackOnError) throw err;
      const pre = await preprocess(item.filePath);
      const probs = await infer(pre);
      return { probs, source: "fallback" };
    }
  }
  const pre = await preprocess(item.filePath);
  const probs = await infer(pre);
  return { probs, source: "local" };
}

async function run(onProgress) {
  cancelRequested = false;

  const settings = loadSettings();
  const blacklist = new Set(settings.blacklist || []);
  const items = await getSelectedItems();
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    if (cancelRequested) {
      if (typeof onProgress === "function") {
        onProgress({ current: i, total, status: "cancelled" });
      }
      break;
    }

    const item = items[i];
    try {
      if (typeof onProgress === "function") {
        onProgress({
          current: i + 1,
          total,
          fileName: item.name,
          status: "processing",
        });
      }

      const { probs, source } = await inferDispatch(item, settings);
      const predicted = probsToTags(probs, {
        threshold: settings.threshold,
        maxTags: settings.maxTags,
        blacklist,
      });

      item.tags = mergeTags(item.tags || [], predicted, settings.mergeStrategy);
      await saveItem(item);

      if (typeof onProgress === "function") {
        onProgress({
          current: i + 1,
          total,
          fileName: item.name,
          status: "done",
          tags: predicted,
          source,
        });
      }
    } catch (err) {
      if (typeof onProgress === "function") {
        onProgress({
          current: i + 1,
          total,
          fileName: item.name,
          status: "error",
          error: err.message,
        });
      }
    }
  }
}

// Expose the public API both as a CommonJS module and on the renderer window
// so the plugin UI can invoke `window.EagleOppaiTagger.run(...)`.
if (typeof window !== "undefined") {
  window.EagleOppaiTagger = { run, requestCancel, mergeTags };
}

module.exports = { run, requestCancel, mergeTags, inferDispatch };
