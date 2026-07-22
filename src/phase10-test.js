/**
 * src/phase10-test.js
 *
 * Phase 10 単体テスト: 自動タグ付けモード（SPEC §15）。
 *
 * 検証項目:
 * - settings に autoMode デフォルトが含まれる
 * - settings に loadLastScanAt / saveLastScanAt が追加されている
 * - settings の autoMode 部分保存が deep-merge される
 * - eagle-bridge に getItems / getIdsWithModifiedAt / getUntagged / countUntagged が追加
 * - auto-tagger.start / stop / isRunning / getState
 * - tick ロジック: 新規優先・未タグ付け画像の処理
 * - 連続エラー閾値で自動停止
 * - pauseForManualRun / resumeAfterManualRun（排他制御）
 * - main.run() 実行時に自動タグ付けが一時停止する
 *
 * Run with: node src/phase10-test.js
 */
"use strict";

const assert = require("assert");
const path = require("path");

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) { console.log("  PASS: " + msg); passed++; }
  else { console.error("  FAIL: " + msg); failed++; }
}

function section(name) {
  console.log("\n=== " + name + " ===");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLocalStorage() {
  const store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
  };
}

function srcModule(name) {
  return path.join(__dirname, name + ".js");
}

function clearAllSrcCache() {
  const files = [
    "settings", "eagle-bridge", "preprocess", "inference", "inference-client",
    "tags", "main", "auto-tagger",
  ];
  for (const f of files) delete require.cache[srcModule(f)];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testSettingsAutoModeDefaults() {
  section("settings — autoMode DEFAULTS");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const { DEFAULTS, loadSettings } = require("./settings");

  ok(typeof DEFAULTS.autoMode === "object", "DEFAULTS.autoMode is an object");
  ok(DEFAULTS.autoMode && DEFAULTS.autoMode.enabled === false, "autoMode.enabled defaults to false");
  ok(DEFAULTS.autoMode && DEFAULTS.autoMode.pollIntervalSec === 45, "autoMode.pollIntervalSec defaults to 45");
  ok(DEFAULTS.autoMode && DEFAULTS.autoMode.maxConsecutiveErrors === 5, "autoMode.maxConsecutiveErrors defaults to 5");

  const loaded = loadSettings();
  ok(loaded.autoMode && loaded.autoMode.enabled === false, "loaded settings has autoMode");
}

function testSettingsDeepMergeAutoMode() {
  section("settings — autoMode deep-merge");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const { saveSettings, loadSettings } = require("./settings");

  // 部分保存: enabled のみ（pollIntervalSec/maxConsecutiveErrors は DEFAULTS から補完されるべき）
  saveSettings({
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    autoMode: { enabled: true },
  });
  const loaded = loadSettings();
  ok(loaded.autoMode.enabled === true, "autoMode.enabled user save persists");
  ok(loaded.autoMode.pollIntervalSec === 45, "autoMode.pollIntervalSec backfilled from DEFAULTS");
  ok(loaded.autoMode.maxConsecutiveErrors === 5, "autoMode.maxConsecutiveErrors backfilled from DEFAULTS");
}

function testLastScanAtPersistence() {
  section("settings — lastScanAt persistence");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const { loadLastScanAt, saveLastScanAt } = require("./settings");

  ok(loadLastScanAt() === null, "loadLastScanAt returns null when empty");

  const ts = Date.now();
  saveLastScanAt(ts);
  ok(loadLastScanAt() === ts, "saveLastScanAt → loadLastScanAt roundtrip");

  saveLastScanAt("not-a-number");
  ok(loadLastScanAt() === null, "loadLastScanAt returns null for invalid value");
}

function testEagleBridgeAutoModeAPIs() {
  section("eagle-bridge — auto-mode wrappers");
  clearAllSrcCache();

  const ids = [{ id: "1", modifiedAt: 100 }, { id: "2", modifiedAt: 200 }];
  const items = [{ id: "1", name: "a.png", filePath: "/tmp/a.png", tags: [] }];
  let lastGetOptions = null;
  let lastCountOptions = null;

  global.eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => { lastGetOptions = opts; return items; },
      getIdsWithModifiedAt: async () => ids,
      count: async (opts) => { lastCountOptions = opts; return 42; },
    },
  };

  const {
    getItems,
    getIdsWithModifiedAt,
    getUntagged,
    countUntagged,
    getItemById,
  } = require("./eagle-bridge");

  // getItems
  const r1 = getItems({ isUntagged: true, fields: ["id"] });
  ok(r1 instanceof Promise, "getItems returns a Promise");
  return r1.then((result) => {
    ok(Array.isArray(result) && result.length === 1, "getItems returns the mocked items");
    ok(lastGetOptions && lastGetOptions.isUntagged === true, "getItems forwards options");

    // getIdsWithModifiedAt
    return getIdsWithModifiedAt();
  }).then((result) => {
    ok(Array.isArray(result) && result.length === 2, "getIdsWithModifiedAt returns the mocked ids");
    ok(result[0].id === "1" && result[0].modifiedAt === 100, "id/modifiedAt pair preserved");

    // getUntagged
    return getUntagged(["id", "name"]);
  }).then((result) => {
    ok(Array.isArray(result) && result.length === 1, "getUntagged returns mocked items");
    ok(lastGetOptions && lastGetOptions.isUntagged === true, "getUntagged sets isUntagged");
    ok(Array.isArray(lastGetOptions.fields) && lastGetOptions.fields.length === 2, "getUntagged forwards fields");

    // countUntagged
    return countUntagged();
  }).then((result) => {
    ok(result === 42, "countUntagged returns the mocked count");
    ok(lastCountOptions && lastCountOptions.isUntagged === true, "countUntagged sets isUntagged");

    // getItemById (Phase 10.1): fields なしで { ids: [id] } を投げ、結果の先頭を返す
    return getItemById("1");
  }).then((result) => {
    ok(result && result.id === "1", "getItemById returns the single full item");
    ok(lastGetOptions && Array.isArray(lastGetOptions.ids) && lastGetOptions.ids[0] === "1", "getItemById forwards ids: [id]");
    ok(lastGetOptions && lastGetOptions.fields === undefined, "getItemById does NOT set fields (full item)");
  });
}

/**
 * auto-tagger の tick を、実際のタイマーを使わずに1回だけ発火させるヘルパー。
 * start() 後に _tickForTest() を呼んで、最後に stop()。
 */
async function runOneTick({ settings, eagle, mainOverrides, lastScanAt }) {
  clearAllSrcCache();
  global.localStorage = global.localStorage || makeLocalStorage();
  global.window = global;
  global.eagle = eagle;

  // lastScanAt をテスト側で制御可能にする（未指定時はデフォルト挙動）
  if (lastScanAt != null) {
    global.localStorage.setItem("eagle-oppai-tagger:last-scan-at", String(lastScanAt));
  }

  // main.js が require する重いモジュールをモック
  const preprocess = require("./preprocess");
  const inference = require("./inference");
  const tags = require("./tags");
  if (mainOverrides && mainOverrides.preprocess) preprocess.preprocess = mainOverrides.preprocess;
  if (mainOverrides && mainOverrides.infer) inference.infer = mainOverrides.infer;
  if (mainOverrides && mainOverrides.probsToTags) tags.probsToTags = mainOverrides.probsToTags;

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  const events = [];
  const started = autoTagger.start({
    settings: settings,
    onProgress: (ev) => events.push({ kind: "progress", ev }),
    onWarning: (w) => events.push({ kind: "warning", w }),
  });
  if (!started) throw new Error("autoTagger.start() returned false");

  // tick を手動発火
  await autoTagger._tickForTest();

  const finalState = autoTagger.getState();
  autoTagger.stop();
  return { events, state: finalState };
}

// テスト用のモック item（save() メソッド付き）
function makeMockItem(overrides) {
  const base = {
    id: "X",
    name: "x.png",
    filePath: "/tmp/x.png",
    tags: [],
    importedAt: Date.now(),
    _saved: false,
    async save() { this._saved = true; return true; },
  };
  return Object.assign(base, overrides || {});
}

async function testTickProcessesNewItem() {
  section("auto-tagger — tick processes new item");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        if (opts && Array.isArray(opts.ids)) {
          // getItems({ids: [...]}) の呼び出し — 新規候補のフルデータ
          return opts.ids.map((id) => makeMockItem({
            id, name: id + ".png", filePath: "/tmp/" + id + ".png",
            tags: [], importedAt: ts + 1,
          }));
        }
        // isUntagged などの検索
        return [];
      },
      getIdsWithModifiedAt: async () => [
        { id: "NEW1", modifiedAt: ts + 1 },  // 新規
      ],
      count: async () => 0,
    },
  };

  const { events, state } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    lastScanAt: 0,  // 全ての modifiedAt を「新規」と判定
    mainOverrides: {
      preprocess: async () => ({ pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) }),
      infer: async () => new Float32Array(19294).fill(0.9),
      probsToTags: () => ["predicted-tag"],
    },
  });

  const processingEv = events.find((e) => e.ev.status === "processing");
  const doneEv = events.find((e) => e.ev.status === "done");
  ok(processingEv != null, "processing event fired for new item");
  ok(doneEv != null, "done event fired for new item");
  ok(processingEv && processingEv.ev.isNew === true, "new item flagged as isNew=true");
  ok(state.processedNewCount === 1, "processedNewCount incremented");
  ok(state.processedUntaggedCount === 0, "processedUntaggedCount unchanged");
  ok(state.consecutiveErrors === 0, "no errors recorded");
}

async function testTickProcessesUntaggedWhenNoNew() {
  section("auto-tagger — tick processes untagged when no new items");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        // getItemById (Phase 10.1): fields なし → フル item
        if (opts && Array.isArray(opts.ids) && !opts.fields) {
          if (opts.ids.includes("EXISTING1")) {
            return [makeMockItem({
              id: "EXISTING1", name: "old.png", filePath: "/tmp/old.png",
              tags: [], importedAt: ts - 100000, // 古い
            })];
          }
          return [];
        }
        // getUntagged → lightweight fields
        if (opts && opts.isUntagged) {
          return [{ id: "EXISTING1", importedAt: ts - 100000 }];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [
        { id: "EXISTING1", modifiedAt: ts - 100000 }, // 古い → 新規ではない
      ],
      count: async () => 1,
    },
  };

  const { events, state } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    lastScanAt: ts,  // ts より古い modifiedAt は「新規」扱いされない
    mainOverrides: {
      preprocess: async () => ({ pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) }),
      infer: async () => new Float32Array(19294).fill(0.9),
      probsToTags: () => ["tag"],
    },
  });

  const processingEv = events.find((e) => e.ev.status === "processing");
  ok(processingEv != null, "processing event fired for untagged item");
  ok(processingEv && processingEv.ev.isNew === false, "untagged item flagged as isNew=false");
  ok(state.processedUntaggedCount === 1, "processedUntaggedCount incremented");
  ok(state.processedNewCount === 0, "processedNewCount stays 0");
}

async function testTickNewItemsPrioritized() {
  section("auto-tagger — new items prioritized over untagged");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        if (opts && Array.isArray(opts.ids)) {
          return opts.ids.map((id) => makeMockItem({
            id, name: id + ".png", filePath: "/tmp/" + id + ".png",
            tags: [], importedAt: ts + 1,
          }));
        }
        if (opts && opts.isUntagged) {
          return [makeMockItem({
            id: "OLD1", name: "old.png", filePath: "/tmp/old.png",
            tags: [], importedAt: ts - 1000,
          })];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [
        { id: "NEW1", modifiedAt: ts + 1 },  // 新規あり
      ],
      count: async () => 1,
    },
  };

  const { events } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    lastScanAt: 0,  // 全て「新規」判定だが、test の modifiedAt で差をつけるため
    mainOverrides: {
      preprocess: async () => ({ pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) }),
      infer: async () => new Float32Array(19294).fill(0.9),
      probsToTags: () => ["tag"],
    },
  });

  // 新規 NEW1 が優先されて処理される（old.png は1 tick では処理されない）
  const doneEvents = events.filter((e) => e.ev.status === "done");
  ok(doneEvents.length === 1, "exactly one item processed per tick");
  ok(doneEvents[0] && doneEvents[0].ev.fileName === "NEW1.png", "new item processed first, not the old untagged");
}

async function testTickNoWorkWhenLibraryEmpty() {
  section("auto-tagger — tick does nothing when no candidates");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const eagle = {
    item: {
      getSelected: async () => [],
      get: async () => [],
      getIdsWithModifiedAt: async () => [],
      count: async () => 0,
    },
  };

  const { events, state } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    mainOverrides: {},
  });

  const processingEv = events.find((e) => e.ev.status === "processing");
  ok(processingEv == null, "no processing event when queue empty");
  ok(state.processedNewCount === 0 && state.processedUntaggedCount === 0, "no counts incremented");
}

async function testTickSkipsWhenItemDisappears() {
  section("auto-tagger — tick skips when item disappears (Phase 10.1 race)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        // Step B: 新規候補の lightweight 取得（id + tags）
        if (opts && Array.isArray(opts.ids) && opts.fields) {
          return opts.ids.map((id) => ({ id, tags: [] }));
        }
        // Step E: getItemById — アイテムが既に削除されている race
        if (opts && Array.isArray(opts.ids) && !opts.fields) {
          return [];
        }
        // Step C: getUntagged → lightweight
        if (opts && opts.isUntagged) {
          return [{ id: "GONE1", importedAt: ts - 1 }];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [
        { id: "GONE1", modifiedAt: ts + 1 }, // 新規候補として検知
      ],
      count: async () => 1,
    },
  };

  const { events, state } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    lastScanAt: 0,
    mainOverrides: {},
  });

  const processingEv = events.find((e) => e.ev.status === "processing");
  ok(processingEv == null, "no processing event when item disappeared before getItemById");
  ok(state.processedNewCount === 0, "processedNewCount unchanged (graceful skip)");
  ok(state.processedUntaggedCount === 0, "processedUntaggedCount unchanged");
  ok(state.consecutiveErrors === 0, "no error counted (race is not a real error)");
}

async function testConsecutiveErrorsAutoStop() {
  section("auto-tagger — consecutive errors trigger auto-stop");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        // getItemById (Phase 10.1): fields なし → フル item
        if (opts && Array.isArray(opts.ids) && !opts.fields) {
          if (opts.ids.includes("BAD1")) {
            return [{
              id: "BAD1", name: "broken.png", filePath: "/tmp/broken.png",
              tags: [], importedAt: ts - 1,
              async save() {},
            }];
          }
          return [];
        }
        // getUntagged → lightweight fields
        if (opts && opts.isUntagged) {
          return [{ id: "BAD1", importedAt: ts - 1 }];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [],
      count: async () => 1,
    },
  };

  // 推論を常に失敗させる
  const settings = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 3 },
  };

  // 3回 tick を回して、3回目で停止することを確認
  clearAllSrcCache();
  global.window = global;
  global.eagle = eagle;
  const preprocess = require("./preprocess");
  const inference = require("./inference");
  const tags = require("./tags");
  preprocess.preprocess = async () => { throw new Error("mock failure"); };
  inference.infer = async () => { throw new Error("mock failure"); };
  tags.probsToTags = () => ["tag"];

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  const warnings = [];
  autoTagger.start({
    settings,
    onProgress: () => {},
    onWarning: (w) => warnings.push(w),
  });

  // 1回目: エラー
  await autoTagger._tickForTest();
  ok(autoTagger.getState().consecutiveErrors === 1, "first tick increments error to 1");
  ok(autoTagger.getState().running === true, "still running after first error");

  // 2回目: エラー（残りは同じ BAD1 を何度も処理しようとする）
  await autoTagger._tickForTest();
  ok(autoTagger.getState().consecutiveErrors === 2, "second tick increments error to 2");
  ok(autoTagger.getState().running === true, "still running after second error");

  // 3回目: 閾値到達で停止
  await autoTagger._tickForTest();
  ok(autoTagger.getState().consecutiveErrors === 3, "third tick increments error to 3");
  ok(autoTagger.getState().running === false, "auto-stopped after reaching threshold");
  ok(warnings.length >= 1, "warning emitted on auto-stop");
  ok(warnings[0] && warnings[0].reason === "max_consecutive_errors", "warning reason is max_consecutive_errors");

  autoTagger.stop();
}

// Phase 10.2: エラー履歴・警告ペイロード・二重警告なし（SPEC §15.10）
function makeFailingEagleMock() {
  const ts = Date.now();
  return {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        // getItemById (fields なし) → 常に失敗する BAD1 を返す
        if (opts && Array.isArray(opts.ids) && !opts.fields) {
          if (opts.ids.includes("BAD1")) {
            return [{
              id: "BAD1", name: "broken.png", filePath: "/tmp/broken.png",
              tags: [], importedAt: ts - 1,
              async save() {},
            }];
          }
          return [];
        }
        // getUntagged → lightweight fields
        if (opts && opts.isUntagged) {
          return [{ id: "BAD1", importedAt: ts - 1 }];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [],
      count: async () => 1,
    },
  };
}

async function testErrorHistoryAndWarningPayload() {
  section("auto-tagger — error history + warning payload (Phase 10.2)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const settings = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 3 },
  };

  clearAllSrcCache();
  global.window = global;
  global.eagle = makeFailingEagleMock();
  const preprocess = require("./preprocess");
  preprocess.preprocess = async () => {
    throw new Error("ENOENT mock: broken.png.undefined");
  };

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  const warnings = [];
  autoTagger.start({
    settings,
    onProgress: () => {},
    onWarning: (w) => warnings.push(w),
  });

  // 1回目: 履歴に1件記録される
  await autoTagger._tickForTest();
  let hist = autoTagger.getState().errorHistory;
  ok(hist.length === 1, "errorHistory has 1 entry after first failure");
  ok(hist[0].fileName === "broken.png", "history entry records fileName");
  ok(hist[0].message === "ENOENT mock: broken.png.undefined", "history entry records message");
  ok(typeof hist[0].at === "number", "history entry records timestamp");

  // 2回目: 履歴が蓄積する
  await autoTagger._tickForTest();
  ok(autoTagger.getState().errorHistory.length === 2, "errorHistory grows to 2");

  // 3回目: 閾値到達で停止
  await autoTagger._tickForTest();
  const state = autoTagger.getState();
  ok(state.running === false, "auto-stopped at threshold");
  ok(state.errorHistory.length === 3, "errorHistory has 3 entries at stop");

  // 警告は正確に1回（tick の onWarning のみ。stop() 由来の再発火なし）
  ok(warnings.length === 1, "warning emitted exactly once (no double warning)");
  const w = warnings[0];
  ok(w.reason === "max_consecutive_errors", "warning reason is max_consecutive_errors");
  ok(w.lastError === "ENOENT mock: broken.png.undefined", "warning payload includes lastError");
  ok(w.consecutiveErrors === 3, "warning payload includes consecutiveErrors");
  ok(Array.isArray(w.errorHistory) && w.errorHistory.length === 3, "warning payload includes errorHistory");
  ok(w.errorHistory !== state.errorHistory, "warning errorHistory is a copy, not the internal array");

  autoTagger.stop();
}

async function testErrorHistoryCappedAndStartResets() {
  section("auto-tagger — error history capped at 10 + reset on start (Phase 10.2)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const settings = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    // 閾値を大きくして停止させず、履歴のキャップだけを検証する
    autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 50 },
  };

  clearAllSrcCache();
  global.window = global;
  global.eagle = makeFailingEagleMock();
  const preprocess = require("./preprocess");
  let n = 0;
  preprocess.preprocess = async () => {
    n++;
    throw new Error("fail-" + n);
  };

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();
  autoTagger.start({ settings, onProgress: () => {}, onWarning: () => {} });

  for (let i = 0; i < 12; i++) await autoTagger._tickForTest();

  const hist = autoTagger.getState().errorHistory;
  ok(hist.length === 10, "errorHistory capped at 10 entries");
  ok(hist[0].message === "fail-3", "oldest entries evicted (fail-1/2 dropped)");
  ok(hist[9].message === "fail-12", "newest entry retained");
  ok(autoTagger.getState().lastError === "fail-12", "lastError is the most recent");
  ok(autoTagger.getState().running === true, "still running (threshold 50 not reached)");

  // 再起動で履歴・エラー状態がリセットされる
  autoTagger.stop();
  autoTagger.start({ settings, onProgress: () => {}, onWarning: () => {} });
  const fresh = autoTagger.getState();
  ok(fresh.errorHistory.length === 0, "errorHistory reset on start()");
  ok(fresh.lastError === null, "lastError reset on start()");
  ok(fresh.consecutiveErrors === 0, "consecutiveErrors reset on start()");
  autoTagger.stop();
}

async function testPauseAndResumeForManualRun() {
  section("auto-tagger — pause/resume for manual run");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();
  global.window = global;

  const eagle = {
    item: {
      getSelected: async () => [],
      get: async () => [],
      getIdsWithModifiedAt: async () => [],
      count: async () => 0,
    },
  };
  global.eagle = eagle;

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  autoTagger.start({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
  });

  ok(autoTagger.isRunning() === true, "running after start");
  ok(autoTagger.getState().paused === false, "not paused initially");

  const paused = autoTagger.pauseForManualRun();
  ok(paused === true, "pauseForManualRun returns true when running");
  ok(autoTagger.isRunning() === false, "isRunning false while paused");
  ok(autoTagger.getState().paused === true, "paused flag set");

  // paused 中に tick を呼んでも何も起きない
  await autoTagger._tickForTest();
  ok(autoTagger.getState().processedNewCount === 0, "tick skipped while paused");

  const resumed = autoTagger.resumeAfterManualRun();
  ok(resumed === true, "resumeAfterManualRun returns true");
  ok(autoTagger.getState().paused === false, "paused flag cleared after resume");
  ok(autoTagger.isRunning() === true, "isRunning true after resume");

  // start していない状態で pause/resume は false を返す
  autoTagger.stop();
  ok(autoTagger.pauseForManualRun() === false, "pause returns false when not running");
  ok(autoTagger.resumeAfterManualRun() === false, "resume returns false when not running");
}

async function testManualRunPausesAutoTagger() {
  section("main.run() — pauses and resumes auto-tagger");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();
  global.window = global;

  const ts = Date.now();
  const items = [
    {
      id: "M1", name: "manual.png", filePath: "/tmp/manual.png",
      tags: [], importedAt: ts - 1, saved: false,
      async save() { this.saved = true; },
    },
  ];
  global.eagle = {
    item: {
      getSelected: async () => items,
      get: async () => [],
      getIdsWithModifiedAt: async () => [],
      count: async () => 0,
    },
  };

  // heavy modules を mock
  const preprocess = require("./preprocess");
  const inference = require("./inference");
  const tags = require("./tags");
  preprocess.preprocess = async () => ({ pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) });
  inference.infer = async () => new Float32Array(19294).fill(0.9);
  tags.probsToTags = () => ["tag"];

  const autoTagger = require("./auto-tagger");
  const main = require("./main");
  autoTagger._resetForTest();

  autoTagger.start({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
  });
  ok(autoTagger.isRunning() === true, "auto-tagger running before main.run()");

  await main.run(() => {});

  ok(items[0].saved === true, "manual run processed the selected item");
  ok(autoTagger.getState().paused === false, "auto-tagger resumed after main.run() finishes");
  ok(autoTagger.isRunning() === true, "auto-tagger running again after main.run()");

  autoTagger.stop();
}

function testIndexHtmlHasAutoModeSection() {
  section("index.html — auto-mode UI elements");
  const fs = require("fs");
  const htmlPath = path.join(__dirname, "..", "index.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const requiredIds = [
    "auto-enabled", "auto-interval", "auto-interval-val",
    "auto-max-errors", "auto-status-row", "auto-status",
    "auto-error-copy-btn", // Phase 10.2: 詳細コピーボタン（SPEC §15.10）
    "auto-nsfw-warning", "auto-nsfw-dismiss", "auto-nsfw-cancel", "auto-nsfw-ok",
  ];
  for (const id of requiredIds) {
    ok(html.includes('id="' + id + '"'), 'index.html contains id="' + id + '"');
  }

  ok(html.includes("自動モード"), "auto-mode label in Japanese");
  ok(html.includes("ポーリング間隔"), "polling interval label in Japanese");
  ok(html.includes("連続エラー上限"), "max errors label in Japanese");
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async function main() {
  console.log("Phase 10 Verification — auto-tagger");
  console.log("=====================================");

  try {
    testSettingsAutoModeDefaults();
    testSettingsDeepMergeAutoMode();
    testLastScanAtPersistence();
    await testEagleBridgeAutoModeAPIs();
    await testTickProcessesNewItem();
    await testTickProcessesUntaggedWhenNoNew();
    await testTickNewItemsPrioritized();
    await testTickNoWorkWhenLibraryEmpty();
    await testTickSkipsWhenItemDisappears();
    await testConsecutiveErrorsAutoStop();
    await testErrorHistoryAndWarningPayload();
    await testErrorHistoryCappedAndStartResets();
    await testPauseAndResumeForManualRun();
    await testManualRunPausesAutoTagger();
    testIndexHtmlHasAutoModeSection();
  } catch (err) {
    console.error("\nFATAL ERROR: " + err.message);
    console.error(err.stack);
    failed++;
  }

  console.log("\n=====================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
})();
