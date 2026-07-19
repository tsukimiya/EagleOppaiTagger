/**
 * src/phase3-test.js
 *
 * Standalone Phase 3 tests for settings, Eagle bridge signatures,
 * merge strategies, and the main loop cancellation flow.
 *
 * No Eagle runtime is required; all external dependencies are mocked.
 *
 * Run with: node src/phase3-test.js
 */
"use strict";

const assert = require("assert");
const path = require("path");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLocalStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
  };
}

function srcFiles() {
  const root = path.resolve(__dirname);
  return [
    path.join(root, "eagle-bridge.js"),
    path.join(root, "settings.js"),
    path.join(root, "preprocess.js"),
    path.join(root, "inference.js"),
    path.join(root, "tags.js"),
    path.join(root, "main.js"),
  ];
}

function clearSrcCache() {
  for (const file of srcFiles()) {
    delete require.cache[file];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testSettings() {
  clearSrcCache();
  global.localStorage = makeLocalStorage();

  const { loadSettings, saveSettings, resetSettings, DEFAULTS } = require("./settings");

  const custom = {
    threshold: 0.7,
    maxTags: 10,
    mergeStrategy: "overwrite",
    blacklist: ["foo", "bar"],
  };

  saveSettings(custom);
  const loaded = loadSettings();
  assert.deepStrictEqual(loaded, custom, "loadSettings should return saved values");

  const reset = resetSettings();
  assert.deepStrictEqual(reset, DEFAULTS, "resetSettings should return defaults");
  assert.deepStrictEqual(loadSettings(), DEFAULTS, "settings should be reset in storage");

  console.log("✔ settings tests passed");
}

async function testMergeTags() {
  clearSrcCache();
  global.window = global; // Allow window.EagleOppaiTagger registration in Node

  const { mergeTags } = require("./main");

  const existing = ["a", "b"];
  const predicted = ["b", "c"];

  assert.deepStrictEqual(
    mergeTags(existing, predicted, "append"),
    ["a", "b", "c"],
    "append should dedupe union"
  );
  assert.deepStrictEqual(
    mergeTags(existing, predicted, "overwrite"),
    ["b", "c"],
    "overwrite should replace existing tags"
  );
  assert.deepStrictEqual(
    mergeTags(existing, predicted, "diff"),
    ["a", "b", "c"],
    "diff should remove predicted from existing then append predicted"
  );
  assert.deepStrictEqual(
    mergeTags(existing, predicted, "unknown"),
    ["a", "b", "c"],
    "unknown strategy should default to append"
  );

  console.log("✔ mergeTags tests passed");
}

async function testEagleBridgeSignatures() {
  clearSrcCache();

  const items = [
    { id: "1", name: "img1.png", filePath: "/tmp/1.png", tags: ["a"] },
    { id: "2", name: "img2.png", filePath: "/tmp/2.png", tags: [] },
  ];

  global.eagle = {
    item: {
      getSelected: async () => items,
    },
  };

  const { getSelectedItems, saveItem } = require("./eagle-bridge");

  assert.strictEqual(typeof getSelectedItems, "function", "getSelectedItems should be a function");
  assert.strictEqual(typeof saveItem, "function", "saveItem should be a function");

  const selected = await getSelectedItems();
  assert.deepStrictEqual(selected, items, "getSelectedItems should return mocked Eagle items");

  const saved = [];
  const item = {
    id: "3",
    name: "img3.png",
    async save() {
      saved.push(this);
    },
  };
  await saveItem(item);
  assert.strictEqual(saved.length, 1, "saveItem should invoke item.save()");
  assert.strictEqual(saved[0].id, "3", "saved item id should match");

  console.log("✔ eagle-bridge tests passed");
}

async function testRunCancelFlow() {
  clearSrcCache();
  global.localStorage = makeLocalStorage();
  global.window = global;

  // Preload modules so we can swap out the heavy real implementations.
  const preprocess = require("./preprocess");
  const inference = require("./inference");
  const tags = require("./tags");

  preprocess.preprocess = async () => ({
    pixel_values: new Float32Array(602112),
    padding_mask: new Uint8Array(200704),
  });
  inference.infer = async () => new Float32Array(19294).fill(0.9);
  tags.probsToTags = () => ["predicted-tag"];

  const items = [
    {
      id: "1",
      name: "first.jpg",
      filePath: "/tmp/first.jpg",
      tags: ["old"],
      saved: false,
      async save() {
        this.saved = true;
      },
    },
    {
      id: "2",
      name: "second.jpg",
      filePath: "/tmp/second.jpg",
      tags: [],
      saved: false,
      async save() {
        this.saved = true;
      },
    },
  ];

  global.eagle = {
    item: {
      getSelected: async () => items,
    },
  };

  const { run, requestCancel, mergeTags } = require("./main");

  assert.strictEqual(typeof run, "function", "run should be exported");
  assert.strictEqual(typeof requestCancel, "function", "requestCancel should be exported");
  assert.strictEqual(typeof mergeTags, "function", "mergeTags should be exported");
  assert.ok(global.window.EagleOppaiTagger, "window.EagleOppaiTagger should be registered");

  const events = [];
  function onProgress(ev) {
    events.push(ev);
    // Request cancellation as soon as the first item starts processing.
    if (ev.status === "processing" && ev.current === 1) {
      requestCancel();
    }
  }

  await run(onProgress);

  assert.strictEqual(items[0].saved, true, "first item should be saved before cancellation");
  assert.strictEqual(items[1].saved, false, "second item should not be processed after cancel");

  const processingEvents = events.filter((e) => e.status === "processing");
  const doneEvents = events.filter((e) => e.status === "done");
  const cancelledEvents = events.filter((e) => e.status === "cancelled");

  assert.strictEqual(processingEvents.length, 1, "exactly one processing event should fire");
  assert.strictEqual(doneEvents.length, 1, "first item should complete (done)");
  assert.strictEqual(cancelledEvents.length, 1, "a cancelled status event should fire");
  assert.deepStrictEqual(items[0].tags, ["old", "predicted-tag"], "first item tags should be merged");

  console.log("✔ run() cancel flow tests passed");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async function main() {
  try {
    await testSettings();
    await testMergeTags();
    await testEagleBridgeSignatures();
    await testRunCancelFlow();
    console.log("\nAll Phase 3 tests passed.");
    process.exitCode = 0;
  } catch (err) {
    console.error("\nPhase 3 test failed:", err);
    process.exitCode = 1;
  }
})();
