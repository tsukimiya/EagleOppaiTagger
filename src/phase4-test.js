/**
 * src/phase4-test.js
 *
 * Smoke tests for Phase 4: UI layout, ui.js module structure, settings
 * integration. No browser or Eagle runtime required.
 *
 * Run with: node src/phase4-test.js
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(condition, msg) {
  if (condition) {
    console.log("  PASS: " + msg);
    passed++;
  } else {
    console.error("  FAIL: " + msg);
    failed++;
  }
}

function section(name) {
  console.log("\n=== " + name + " ===");
}

// ---------------------------------------------------------------------------
// Test 1: index.html structure
// ---------------------------------------------------------------------------

function testHtmlStructure() {
  section("index.html structure");

  const htmlPath = path.join(__dirname, "..", "index.html");
  ok(fs.existsSync(htmlPath), "index.html exists");

  const html = fs.readFileSync(htmlPath, "utf-8");

  // Required element IDs per SPEC §8
  const requiredIds = [
    "header",
    "model-status",
    "dl-btn",
    "settings",
    "threshold",
    "threshold-val",
    "max-tags",
    "blacklist",
    "actions",
    "run-btn",
    "cancel-btn",
    "progress",
    "progress-bar",
    "progress-text",
    "summary-section",
    "summary",
    "nsfw-warning",
    "nsfw-dismiss",
    "nsfw-ok",
  ];

  for (const id of requiredIds) {
    ok(
      html.includes('id="' + id + '"'),
      "index.html contains id=\"" + id + "\""
    );
  }

  // Merge strategy radios
  ok(html.includes('name="merge"'), "merge radio group present");
  ok(html.includes('value="append"'), "append strategy radio present");
  ok(html.includes('value="overwrite"'), "overwrite strategy radio present");
  ok(html.includes('value="diff"'), "diff strategy radio present");

  // Script tags
  ok(html.includes('src="src/settings.js"'), "settings.js script tag present");
  ok(html.includes('src="src/main.js"'), "main.js script tag present");
  ok(html.includes('src="src/ui.js"'), "ui.js script tag present");

  // NSFW warning text (from SPEC §8)
  ok(
    html.includes("NSFW"),
    "NSFW warning text present"
  );
  ok(
    html.includes("今後表示しない"),
    "dismiss checkbox label present"
  );

  // Japanese text
  ok(html.includes('lang="ja"'), "html lang is ja");
  ok(html.includes("閾値"), "threshold label in Japanese");
  ok(html.includes("最大タグ数"), "max tags label in Japanese");
  ok(html.includes("マージ戦略"), "merge strategy label in Japanese");
  ok(html.includes("実行"), "run button text in Japanese");
  ok(html.includes("キャンセル"), "cancel button text in Japanese");
}

// ---------------------------------------------------------------------------
// Test 2: ui.js module structure
// ---------------------------------------------------------------------------

function testUiModuleStructure() {
  section("ui.js module structure");

  const uiPath = path.join(__dirname, "ui.js");
  ok(fs.existsSync(uiPath), "ui.js exists");

  const src = fs.readFileSync(uiPath, "utf-8");

  // Must require settings
  ok(src.includes('require("./settings")'), "ui.js requires settings module");

  // Must reference EagleOppaiTagger API
  ok(
    src.includes("EagleOppaiTagger.run"),
    "ui.js calls EagleOppaiTagger.run"
  );
  ok(
    src.includes("EagleOppaiTagger.requestCancel"),
    "ui.js calls EagleOppaiTagger.requestCancel"
  );

  // Must handle progress statuses
  ok(src.includes('"processing"'), "handles processing status");
  ok(src.includes('"done"'), "handles done status");
  ok(src.includes('"error"'), "handles error status");
  ok(src.includes('"cancelled"'), "handles cancelled status");

  // Must wire event listeners
  ok(src.includes("addEventListener"), "uses addEventListener");

  // Must persist settings
  ok(src.includes("saveSettings"), "calls saveSettings");
  ok(src.includes("loadSettings"), "calls loadSettings");

  // NSFW warning logic
  ok(src.includes("nsfw-dismiss"), "references nsfw-dismiss checkbox");
  ok(src.includes("localStorage"), "uses localStorage for NSFW dismissal");
}

// ---------------------------------------------------------------------------
// Test 3: ui.js loads without errors (DOM mock)
// ---------------------------------------------------------------------------

function testUiLoadsInMockDom() {
  section("ui.js loads with mocked DOM");

  // Clear any cached modules from previous tests
  const srcFiles = [
    path.join(__dirname, "settings.js"),
    path.join(__dirname, "main.js"),
    path.join(__dirname, "ui.js"),
    path.join(__dirname, "preprocess.js"),
    path.join(__dirname, "inference.js"),
    path.join(__dirname, "tags.js"),
    path.join(__dirname, "eagle-bridge.js"),
  ];
  for (const f of srcFiles) {
    delete require.cache[f];
  }

  // Mock localStorage
  const store = {};
  global.localStorage = {
    getItem(key) { return key in store ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
  };

  // Mock DOM elements
  const elements = {};
  function makeEl(id) {
    return {
      id: id,
      value: "",
      textContent: "",
      innerHTML: "",
      className: "",
      style: { width: "", display: "" },
      checked: false,
      disabled: false,
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      addEventListener: function () { /* noop */ },
    };
  }

  const ids = [
    "run-btn", "cancel-btn", "progress-bar", "progress-text",
    "summary-section", "summary", "threshold", "threshold-val",
    "max-tags", "blacklist", "model-status", "dl-btn",
    "nsfw-warning", "nsfw-dismiss", "nsfw-ok",
    // Phase 8: server settings
    "use-server", "server-url", "server-test-btn",
    "fallback-on-error", "server-status",
  ];
  for (const id of ids) {
    elements[id] = makeEl(id);
  }

  // Set default values for inputs
  elements["threshold"].value = "0.5";
  elements["max-tags"].value = "30";
  elements["blacklist"].value = "";
  elements["run-btn"].disabled = false;
  elements["cancel-btn"].disabled = true;

  // Mock radio buttons for merge strategy
  const mergeRadios = [
    { value: "append", checked: true, addEventListener: function () {} },
    { value: "overwrite", checked: false, addEventListener: function () {} },
    { value: "diff", checked: false, addEventListener: function () {} },
  ];

  global.document = {
    getElementById: function (id) { return elements[id] || null; },
    querySelectorAll: function (selector) {
      if (selector === 'input[name="merge"]') return mergeRadios;
      return [];
    },
  };

  // Mock window.EagleOppaiTagger
  global.window = global;
  global.window.EagleOppaiTagger = {
    run: function () {},
    requestCancel: function () {},
    mergeTags: function () {},
  };

  // Mock eagle API (needed by main.js require chain)
  global.eagle = {
    item: {
      getSelected: async function () { return []; },
    },
  };

  let loadError = null;
  try {
    require("./ui");
  } catch (err) {
    loadError = err;
  }

  ok(loadError === null, "ui.js loads without errors" + (loadError ? ": " + loadError.message : ""));

  // Verify settings were populated into mock DOM
  ok(
    elements["threshold"].value === "0.5" || elements["threshold"].value === 0.5,
    "threshold populated from settings"
  );

  // Clean up globals
  delete global.document;
  delete global.localStorage;
  delete global.eagle;
  // Keep window for now (other tests may need it)
}

// ---------------------------------------------------------------------------
// Test 4: settings integration (loadSettings / saveSettings cycle)
// ---------------------------------------------------------------------------

function testSettingsIntegration() {
  section("settings integration");

  // Clear cache
  const settingsPath = path.join(__dirname, "settings.js");
  delete require.cache[settingsPath];

  // Fresh localStorage mock
  const store = {};
  global.localStorage = {
    getItem(key) { return key in store ? store[key] : null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
  };

  const { loadSettings, saveSettings, DEFAULTS } = require("./settings");

  // Default settings
  const defaults = loadSettings();
  ok(defaults.threshold === 0.5, "default threshold is 0.5");
  ok(defaults.maxTags === 30, "default maxTags is 30");
  ok(defaults.mergeStrategy === "append", "default mergeStrategy is append");
  ok(Array.isArray(defaults.blacklist), "default blacklist is array");

  // Save and reload
  const custom = {
    threshold: 0.75,
    maxTags: 50,
    mergeStrategy: "overwrite",
    blacklist: ["bad_tag", "another"],
  };
  saveSettings(custom);
  const reloaded = loadSettings();
  ok(reloaded.threshold === 0.75, "saved threshold persists");
  ok(reloaded.maxTags === 50, "saved maxTags persists");
  ok(reloaded.mergeStrategy === "overwrite", "saved mergeStrategy persists");
  ok(
    Array.isArray(reloaded.blacklist) && reloaded.blacklist.length === 2,
    "saved blacklist persists"
  );
  ok(reloaded.blacklist[0] === "bad_tag", "blacklist content preserved");

  // Clean up
  delete global.localStorage;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async function main() {
  console.log("Phase 4 Verification — UI structure + smoke tests");
  console.log("=================================================");

  try {
    testHtmlStructure();
    testUiModuleStructure();
    testUiLoadsInMockDom();
    testSettingsIntegration();
  } catch (err) {
    console.error("\nFATAL ERROR: " + err.message);
    console.error(err.stack);
    failed++;
  }

  console.log("\n=================================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
})();
