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
 * - 連続エラー閾値で自動停止（Phase 10.6: 異なるアイテムの連続失敗でのみカウント）
 * - 壊れたアイテムのスキップ（Phase 10.6: 再試行上限・同一アイテムでは停止しない）
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
  section("auto-tagger — consecutive errors on DISTINCT items trigger auto-stop (Phase 10.6)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  // 常に失敗する未タグ付けアイテムが3個（BAD1 が最新＝キュー先頭）
  const { eagle } = makeFailingItemsEagleMock(3);

  const settings = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 3 },
  };

  clearAllSrcCache();
  global.window = global;
  global.eagle = eagle;
  const preprocess = require("./preprocess");
  preprocess.preprocess = async () => { throw new Error("mock failure"); };

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  const warnings = [];
  autoTagger.start({
    settings,
    onProgress: () => {},
    onWarning: (w) => warnings.push(w),
  });

  // t1: BAD1 が失敗 → distinct な失敗として 1
  await autoTagger._tickForTest();
  ok(autoTagger.getState().consecutiveErrors === 1, "first failure counts as 1");
  ok(autoTagger.getState().running === true, "still running after first error");

  // t2: 同じ BAD1 の再試行 → consecutiveErrors は増えない（SPEC §15.11）
  await autoTagger._tickForTest();
  ok(autoTagger.getState().consecutiveErrors === 1, "same-item retry does NOT increment consecutiveErrors");
  ok(autoTagger.getState().running === true, "still running (broken item is retried, not fatal)");

  // t3: 再試行上限 (2) に達した BAD1 はスキップされ、次の BAD2 が失敗 → 2
  await autoTagger._tickForTest();
  ok(autoTagger.getState().consecutiveErrors === 2, "distinct item failure increments to 2");

  // t4: BAD2 の再試行 → 増えない
  await autoTagger._tickForTest();
  ok(autoTagger.getState().consecutiveErrors === 2, "second item retry does not increment");

  // t5: BAD3 が失敗 → 閾値 3 に到達して停止
  await autoTagger._tickForTest();
  const st = autoTagger.getState();
  ok(st.consecutiveErrors === 3, "third distinct item failure reaches threshold");
  ok(st.running === false, "auto-stopped after reaching threshold on distinct items");
  ok(warnings.length === 1, "warning emitted exactly once on auto-stop");
  ok(warnings[0] && warnings[0].reason === "max_consecutive_errors", "warning reason is max_consecutive_errors");

  autoTagger.stop();
}

// Phase 10.2: エラー履歴・警告ペイロード・二重警告なし（SPEC §15.10）
// Phase 10.6: 常に失敗する未タグ付けアイテムを n 個返す Eagle モックに一般化。
// BAD1 が最新（importedAt 降順のキュー先頭）。getItemById は id 応じのフル item を返す。
function makeFailingItemsEagleMock(n) {
  const ts = Date.now();
  const ids = Array.from({ length: n }, (_, i) => "BAD" + (i + 1));
  return {
    ts,
    eagle: {
      item: {
        getSelected: async () => [],
        get: async (opts) => {
          // getItemById (fields なし) → id 応じの常に失敗するフル item
          if (opts && Array.isArray(opts.ids) && !opts.fields) {
            return opts.ids
              .filter((id) => ids.includes(id))
              .map((id) => ({
                id,
                name: id.toLowerCase() + ".png",
                filePath: "/tmp/" + id + ".png",
                tags: [],
                importedAt: ts - ids.indexOf(id),
                async save() {},
              }));
          }
          // getUntagged → lightweight fields
          if (opts && opts.isUntagged) {
            return ids.map((id, i) => ({ id, importedAt: ts - i }));
          }
          return [];
        },
        getIdsWithModifiedAt: async () => [],
        count: async () => n,
      },
    },
  };
}

async function testErrorHistoryAndWarningPayload() {
  section("auto-tagger — error history + warning payload (Phase 10.2 / 10.6)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const settings = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 3 },
  };

  clearAllSrcCache();
  global.window = global;
  const { eagle } = makeFailingItemsEagleMock(3);
  global.eagle = eagle;
  const preprocess = require("./preprocess");
  preprocess.preprocess = async () => {
    throw new Error("ENOENT mock: file is gone");
  };

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  const warnings = [];
  autoTagger.start({
    settings,
    onProgress: () => {},
    onWarning: (w) => warnings.push(w),
  });

  // 5 tick で BAD1×2（再試行上限）→ BAD2×2 → BAD3×1（閾値到達）となる
  for (let i = 0; i < 5; i++) await autoTagger._tickForTest();

  const state = autoTagger.getState();
  ok(state.running === false, "auto-stopped at threshold");
  const hist = state.errorHistory;
  ok(hist.length === 5, "errorHistory has 5 entries (2+2+1, retry cap respected)");
  ok(hist[0].fileName === "bad1.png", "history entry records fileName of first failure");
  ok(hist[2].fileName === "bad2.png", "history moves on to next item after retry cap");
  ok(hist[4].fileName === "bad3.png", "history records the final distinct failure");
  ok(typeof hist[0].at === "number", "history entry records timestamp");
  ok(hist[0].message === "ENOENT mock: file is gone", "history entry records message");

  // 警告は正確に1回（tick の onWarning のみ。stop() 由来の再発火なし）
  ok(warnings.length === 1, "warning emitted exactly once (no double warning)");
  const w = warnings[0];
  ok(w.reason === "max_consecutive_errors", "warning reason is max_consecutive_errors");
  ok(w.lastError === "ENOENT mock: file is gone", "warning payload includes lastError");
  ok(w.consecutiveErrors === 3, "warning payload includes consecutiveErrors (distinct items)");
  ok(Array.isArray(w.errorHistory) && w.errorHistory.length === 5, "warning payload includes errorHistory");
  ok(w.errorHistory !== state.errorHistory, "warning errorHistory is a copy, not the internal array");

  autoTagger.stop();
}

async function testErrorHistoryCappedAndStartResets() {
  section("auto-tagger — error history capped at 10 + reset on start (Phase 10.2 / 10.6)");
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
  const { eagle } = makeFailingItemsEagleMock(20);
  global.eagle = eagle;
  const preprocess = require("./preprocess");
  let n = 0;
  preprocess.preprocess = async () => {
    n++;
    throw new Error("fail-" + n);
  };

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();
  autoTagger.start({ settings, onProgress: () => {}, onWarning: () => {} });

  // 12 tick = BAD1〜BAD6 が各2回（再試行上限）失敗
  for (let i = 0; i < 12; i++) await autoTagger._tickForTest();

  const hist = autoTagger.getState().errorHistory;
  ok(hist.length === 10, "errorHistory capped at 10 entries");
  ok(hist[0].message === "fail-3", "oldest entries evicted (fail-1/2 dropped)");
  ok(hist[9].message === "fail-12", "newest entry retained");
  ok(autoTagger.getState().lastError === "fail-12", "lastError is the most recent");
  ok(autoTagger.getState().consecutiveErrors === 6, "consecutiveErrors counts distinct items only (6)");
  ok(autoTagger.getState().running === true, "still running (threshold 50 not reached)");

  // 再起動で履歴・エラー状態がリセットされる
  autoTagger.stop();
  autoTagger.start({ settings, onProgress: () => {}, onWarning: () => {} });
  const fresh = autoTagger.getState();
  ok(fresh.errorHistory.length === 0, "errorHistory reset on start()");
  ok(fresh.lastError === null, "lastError reset on start()");
  ok(fresh.consecutiveErrors === 0, "consecutiveErrors reset on start()");

  // スキップ記録もリセット: 再起動後の tick で BAD1 が再挑戦される（Phase 10.6）
  await autoTagger._tickForTest();
  const afterRestart = autoTagger.getState();
  ok(afterRestart.errorHistory.length === 1, "capped item is retried after restart (skip memory cleared)");
  ok(afterRestart.errorHistory[0].fileName === "bad1.png", "retried item is the queue head BAD1");

  autoTagger.stop();
}

// Phase 10.6: 壊れたファイル1個で自動モードが停止しない（SPEC §15.11・2026-08-31 実事故の回帰防止）
async function testSameBrokenItemDoesNotStopAutoMode() {
  section("auto-tagger — single broken item does NOT stop auto mode (Phase 10.6)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const settings = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
  };

  clearAllSrcCache();
  global.window = global;
  const { eagle } = makeFailingItemsEagleMock(1);
  global.eagle = eagle;
  const preprocess = require("./preprocess");
  preprocess.preprocess = async () => {
    throw new Error("画像のデコードに失敗しました（Jimp: ENOENT / DOM: ENOENT）");
  };

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  const warnings = [];
  autoTagger.start({
    settings,
    onProgress: () => {},
    onWarning: (w) => warnings.push(w),
  });

  // 実事故と同じ条件: 同一ファイルが毎 tick 先頭に来ても停止しない
  // （旧挙動なら 5 tick で maxConsecutiveErrors 到達 → 自動停止）
  for (let i = 0; i < 7; i++) await autoTagger._tickForTest();

  const st = autoTagger.getState();
  ok(st.running === true, "auto mode keeps running despite the broken item");
  ok(st.consecutiveErrors === 1, "consecutiveErrors counts the distinct broken item once");
  ok(st.errorHistory.length === 2, "broken item attempted exactly MAX_ITEM_ATTEMPTS (2) times");
  ok(warnings.length === 0, "no auto-stop warning");

  // 再起動（start）でスキップ記録はリセットされ、再挑戦される
  autoTagger.stop();
  autoTagger.start({ settings, onProgress: () => {}, onWarning: (w) => warnings.push(w) });
  await autoTagger._tickForTest();
  ok(autoTagger.getState().errorHistory.length === 1, "item is retried after restart");
  ok(autoTagger.getState().running === true, "still running after restart tick");

  autoTagger.stop();
}

// Phase 10.6: 壊れたアイテムをスキップして次の正常アイテムを処理する
async function testBrokenItemSkippedThenNextItemProcessed() {
  section("auto-tagger — broken item skipped, next good item processed (Phase 10.6)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const goodItem = {
    id: "GOOD1",
    name: "good1.png",
    filePath: "/tmp/good1.png",
    tags: [],
    importedAt: ts, // BAD1 より古い → キューでは後ろ
    _saved: false,
    async save() { this._saved = true; return true; },
  };
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        // getItemById (fields なし)
        if (opts && Array.isArray(opts.ids) && !opts.fields) {
          return opts.ids.map((id) =>
            id === "GOOD1"
              ? goodItem
              : {
                  id,
                  name: id.toLowerCase() + ".png",
                  filePath: "/tmp/" + id + ".png",
                  tags: [],
                  importedAt: ts + 100,
                  async save() {},
                }
          );
        }
        // getUntagged → lightweight fields
        if (opts && opts.isUntagged) {
          return [
            { id: "BAD1", importedAt: ts + 100 }, // 新しい壊れたファイル
            { id: "GOOD1", importedAt: ts },      // 古い正常ファイル
          ];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [],
      count: async () => 2,
    },
  };

  const settings = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
  };

  clearAllSrcCache();
  global.window = global;
  global.eagle = eagle;
  const preprocess = require("./preprocess");
  // BAD1 だけデコード失敗（実ファイル欠損の再現）、GOOD1 は正常処理
  preprocess.preprocess = async (filePath) => {
    if (String(filePath).toLowerCase().includes("bad1")) {
      throw new Error("画像のデコードに失敗しました（Jimp: ENOENT / DOM: ENOENT）");
    }
    return { pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) };
  };
  const inference = require("./inference");
  inference.infer = async () => new Float32Array(19294).fill(0.9);
  const tags = require("./tags");
  tags.probsToTags = () => ["tag"];

  const autoTagger = require("./auto-tagger");
  autoTagger._resetForTest();

  const events = [];
  const warnings = [];
  autoTagger.start({
    settings,
    onProgress: (ev) => events.push(ev),
    onWarning: (w) => warnings.push(w),
  });

  // t1: BAD1 失敗 / t2: BAD1 再試行で上限到達 / t3: GOOD1 を処理
  await autoTagger._tickForTest();
  await autoTagger._tickForTest();
  await autoTagger._tickForTest();

  const doneEv = events.find((e) => e.status === "done");
  ok(doneEv != null, "good item reached done event");
  ok(doneEv && doneEv.fileName === "good1.png", "done event is for good1.png");
  ok(goodItem._saved === true, "good item saved with tags");
  ok(Array.isArray(goodItem.tags) && goodItem.tags.includes("tag"), "predicted tag merged into good item");

  const st = autoTagger.getState();
  ok(st.processedUntaggedCount === 1, "processedUntaggedCount === 1");
  ok(st.consecutiveErrors === 0, "consecutiveErrors reset by the success");
  ok(st.running === true, "auto mode never stopped");
  ok(warnings.length === 0, "no auto-stop warning");

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
// Phase 10.5: 動画ファイルの自動タグ付け対象外フィルタ
// ---------------------------------------------------------------------------

function testIsNonImageExt() {
  section("auto-tagger — isNonImageExt helper (Phase 10.5)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();
  global.window = global;

  const { isNonImageExt } = require("./auto-tagger");

  // 動画拡張子
  ok(isNonImageExt("mp4") === true, "mp4 is non-image");
  ok(isNonImageExt("webm") === true, "webm is non-image");
  ok(isNonImageExt("mov") === true, "mov is non-image");
  ok(isNonImageExt("mkv") === true, "mkv is non-image");
  ok(isNonImageExt("avi") === true, "avi is non-image");

  // 大文字小文字
  ok(isNonImageExt("MP4") === true, "MP4 (uppercase) is non-image");
  ok(isNonImageExt("WebM") === true, "WebM (mixed case) is non-image");

  // 非ラスタ形式（Phase 10.7: SVG は Jimp の MIME スニッフも DOM デコードも失敗する）
  ok(isNonImageExt("svg") === true, "svg is non-image");
  ok(isNonImageExt("SVG") === true, "SVG (uppercase) is non-image");

  // 画像拡張子（処理対象）
  ok(isNonImageExt("png") === false, "png is image");
  ok(isNonImageExt("jpg") === false, "jpg is image");
  ok(isNonImageExt("webp") === false, "webp is image");
  ok(isNonImageExt("gif") === false, "gif is image");

  // 異常系（安全なデフォルト = false）
  ok(isNonImageExt(undefined) === false, "undefined is not non-image");
  ok(isNonImageExt(null) === false, "null is not non-image");
  ok(isNonImageExt("") === false, "empty string is not non-image");
}

async function testTickSkipsVideoInUntagged() {
  section("auto-tagger — tick skips video in untagged queue (Phase 10.5)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        // getItemById (Phase 10.1): fields なし → フル item
        if (opts && Array.isArray(opts.ids) && !opts.fields) {
          const id = opts.ids[0];
          const ext = id.startsWith("VIDEO") ? "mp4" : "png";
          return [makeMockItem({
            id, name: id + "." + ext, filePath: "/tmp/" + id + "." + ext,
            tags: [], importedAt: ts, ext,
          })];
        }
        // getUntagged → lightweight fields with ext
        if (opts && opts.isUntagged) {
          return [
            { id: "VIDEO1", importedAt: ts + 100, ext: "mp4" },  // 動画（最新だが対象外）
            { id: "IMG1", importedAt: ts + 50, ext: "png" },     // 画像（処理されるべき）
            { id: "VIDEO2", importedAt: ts, ext: "webm" },       // 動画
            { id: "IMG2", importedAt: ts - 50, ext: "jpg" },     // 画像
          ];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [], // 新規なし
      count: async () => 4,
    },
  };

  const { events, state } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    lastScanAt: ts, // 新規検知なし
    mainOverrides: {
      preprocess: async () => ({ pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) }),
      infer: async () => new Float32Array(19294).fill(0.9),
      probsToTags: () => ["tag"],
    },
  });

  // VIDEO1 は importedAt 最大だが動画のためスキップ → IMG1 が処理されるべき
  const processingEv = events.find((e) => e.ev.status === "processing");
  ok(processingEv != null, "processing event fired (image found despite video at top)");
  ok(processingEv && processingEv.ev.fileName === "IMG1.png", "processed IMG1.png (not VIDEO1.mp4)");
  ok(state.processedUntaggedCount === 1, "processedUntaggedCount === 1 (only image)");
  ok(state.consecutiveErrors === 0, "no errors (video silently filtered, not counted as error)");
}

async function testTickAllVideosSkipsSilently() {
  section("auto-tagger — tick idle when all untagged are videos (Phase 10.5)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        if (opts && opts.isUntagged) {
          return [
            { id: "V1", importedAt: ts + 100, ext: "mp4" },
            { id: "V2", importedAt: ts + 50, ext: "mov" },
          ];
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [], // 新規なし
      count: async () => 2,
    },
  };

  const { events, state } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    lastScanAt: ts,
    mainOverrides: {
      preprocess: async () => ({ pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) }),
      infer: async () => new Float32Array(19294).fill(0.9),
      probsToTags: () => ["tag"],
    },
  });

  // 全アイテムが動画 → workQueue 空 → 処理もエラーも発生しない
  const processingEv = events.find((e) => e.ev.status === "processing");
  ok(processingEv == null, "no processing event (all items were videos)");
  ok(state.processedUntaggedCount === 0, "processedUntaggedCount === 0");
  ok(state.consecutiveErrors === 0, "no errors (videos silently filtered)");
}

async function testTickSkipsVideoInNewItems() {
  section("auto-tagger — tick skips video in new-item detection (Phase 10.5)");
  clearAllSrcCache();
  global.localStorage = makeLocalStorage();

  const ts = Date.now();
  const eagle = {
    item: {
      getSelected: async () => [],
      get: async (opts) => {
        // getItemById (fields なし)
        if (opts && Array.isArray(opts.ids) && !opts.fields) {
          const id = opts.ids[0];
          return [makeMockItem({
            id, name: id + ".png", filePath: "/tmp/" + id + ".png",
            tags: [], importedAt: ts, ext: "png",
          })];
        }
        // getItems({ ids: [...], fields: [...] }) — Step B の新規候補 lightweight 取得
        if (opts && Array.isArray(opts.ids) && opts.fields) {
          return opts.ids.map((id) => ({
            id, tags: [], ext: id.startsWith("VNEW") ? "mp4" : "png",
          }));
        }
        return [];
      },
      getIdsWithModifiedAt: async () => [
        { id: "VNEW1", modifiedAt: ts + 200 },  // 動画（新規だが対象外）
        { id: "NEW1", modifiedAt: ts + 100 },   // 画像（新規・処理されるべき）
      ],
      count: async () => 2,
    },
  };

  const { events, state } = await runOneTick({
    settings: {
      threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
      useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
      autoMode: { enabled: true, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
    },
    eagle,
    lastScanAt: ts, // VNEW1 と NEW1 は共に新規
    mainOverrides: {
      preprocess: async () => ({ pixel_values: new Float32Array(602112), padding_mask: new Uint8Array(200704) }),
      infer: async () => new Float32Array(19294).fill(0.9),
      probsToTags: () => ["tag"],
    },
  });

  // VNEW1（modifiedAt 最大）は動画のためスキップ → NEW1 が処理されるべき
  const processingEv = events.find((e) => e.ev.status === "processing");
  ok(processingEv != null, "processing event fired (image found despite video at top of new items)");
  ok(processingEv && processingEv.ev.fileName === "NEW1.png", "processed NEW1.png (not VNEW1.mp4)");
  ok(state.processedNewCount === 1, "processedNewCount === 1 (only image)");
  ok(state.consecutiveErrors === 0, "no errors (video in new items silently filtered)");
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
    // Phase 10.6: 壊れたアイテムのスキップ
    await testSameBrokenItemDoesNotStopAutoMode();
    await testBrokenItemSkippedThenNextItemProcessed();
    await testPauseAndResumeForManualRun();
    await testManualRunPausesAutoTagger();
    testIndexHtmlHasAutoModeSection();
    // Phase 10.5: 動画ファイルの対象外フィルタ
    testIsNonImageExt();
    await testTickSkipsVideoInUntagged();
    await testTickAllVideosSkipsSilently();
    await testTickSkipsVideoInNewItems();
  } catch (err) {
    console.error("\nFATAL ERROR: " + err.message);
    console.error(err.stack);
    failed++;
  }

  console.log("\n=====================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
})();
