/**
 * src/auto-tagger.js
 *
 * Phase 10: Window プラグイン内の自動タグ付けモード。
 *
 * 仕様（SPEC §15）:
 * - setInterval で定期的に Eagle ライブラリをスキャン
 * - 新規画像（modifiedAt > lastScanAt）を優先、次いで未タグ付け画像
 * - 1 tick = 1枚処理（Eagle 本体への負荷分散・SPEC §15.4）
 * - 連続エラーが maxConsecutiveErrors に達したら自動停止
 * - main.js の run() 実行中は pauseForManualRun() で一時停止（排他制御）
 * - lastScanAt は localStorage に永続化（ウィンドウ閉じても resume）
 *
 * SPEC reference: .spec/SPEC.md §15
 */
"use strict";

const path = require("path");
const srcdir = __dirname || "";
const {
  loadSettings,
  loadLastScanAt,
  saveLastScanAt,
} = require(path.join(srcdir, "settings"));
const {
  getItems,
  getIdsWithModifiedAt,
  getUntagged,
  saveItem,
  getItemById,
} = require(path.join(srcdir, "eagle-bridge"));

// 新規候補の取得を打ち切る上限（巨大ライブラリで getItems が膨張するのを防ぐ）
const NEW_ITEM_CAP = 50;

// 保持するエラー履歴の上限（リングバッファ。SPEC §15.10）
const ERROR_HISTORY_CAP = 10;

// シングルトン状態
let state = createFreshState();

function createFreshState() {
  return {
    timer: null,
    running: false,
    paused: false,
    inTick: false,
    consecutiveErrors: 0,
    processedNewCount: 0,
    processedUntaggedCount: 0,
    lastScanAt: null,
    lastError: null,
    errorHistory: [],
    onProgress: null,
    onWarning: null,
    settings: null,
  };
}

function isRunning() {
  return state.running && !state.paused;
}

function getState() {
  return {
    running: state.running,
    paused: state.paused,
    consecutiveErrors: state.consecutiveErrors,
    processedNewCount: state.processedNewCount,
    processedUntaggedCount: state.processedUntaggedCount,
    lastScanAt: state.lastScanAt,
    lastError: state.lastError,
    errorHistory: state.errorHistory.slice(),
  };
}

/**
 * 1枚の画像を推論して保存。
 * main.js の inferDispatch / mergeTags を遅延 require して使用する
 * （auto-tagger と main は相互参照するため、ロード時の循環 import を避ける）。
 */
async function processOneItem(item, settings) {
  const main = require(path.join(srcdir, "main"));
  const { inferDispatch, mergeTags } = main;
  if (typeof inferDispatch !== "function" || typeof mergeTags !== "function") {
    throw new Error("main.js does not export inferDispatch / mergeTags");
  }
  const { probs } = await inferDispatch(item, settings);
  const { probsToTags } = require(path.join(srcdir, "tags"));
  const blacklist = new Set(settings.blacklist || []);
  const predicted = probsToTags(probs, {
    threshold: settings.threshold,
    maxTags: settings.maxTags,
    blacklist,
  });
  item.tags = mergeTags(item.tags || [], predicted, settings.mergeStrategy);
  await saveItem(item);
  return { tags: predicted };
}

/**
 * ポーリングの1 tick。新規 → 未タグ付けの順に1枚だけ処理する。
 * inTick フラグで再入を防止する（setInterval は async を待たないため）。
 *
 * Phase 10.1: 2段階取得へ変更。
 * 候補は lightweight な fields（id/tags/importedAt）で集め、実際に処理する
 * 先頭1枚だけ `getItemById(id)` で fields なしフル取得する。
 * 理由: `eagle.item.get({ fields: [...] })` プロジェクションで `filePath` が
 * `${name}.${ext}` の ext 未選択により undefined になり ENOENT となるため。
 * 詳細は .spec/KNOWLEDGE.md の Phase 10.1 セクション参照。
 */
async function tick() {
  if (state.inTick || state.paused || !state.running) return;
  state.inTick = true;

  try {
    const settings = state.settings || loadSettings();
    if (state.lastScanAt == null) state.lastScanAt = Date.now();

    // Step B: 新規候補 ID 抽出（modifiedAt > lastScanAt）
    // Copilot 指摘対応: modifiedAt 降順で最新から取得し、タグ編集等の
    // ノイズを除外するため、取得後に tags.length === 0 でフィルタする。
    //
    // Phase 10.1: fields から filePath/name を外し、ID と tags のみ取得。
    // filePath は Step E で getItemById(id) により fields なしで取得する。
    let newItemIds = [];
    try {
      const all = await getIdsWithModifiedAt();
      const newIds = all
        .filter(
          (it) =>
            it &&
            typeof it.modifiedAt === "number" &&
            it.modifiedAt > state.lastScanAt
        )
        .sort((a, b) => b.modifiedAt - a.modifiedAt) // 新しい順
        .slice(0, NEW_ITEM_CAP)
        .map((it) => it.id);
      if (newIds.length > 0) {
        const fetched = await getItems({
          ids: newIds,
          fields: ["id", "tags"],
        });
        // 手動タグ編集された画像を弾くため、未タグ付けのみ残す
        const tagFiltered = new Set(
          fetched
            .filter((it) => !it.tags || it.tags.length === 0)
            .map((it) => it.id)
        );
        // 元の modifiedAt 降順を維持して ID リストを作る
        newItemIds = newIds.filter((id) => tagFiltered.has(id));
      }
    } catch (err) {
      // getIdsWithModifiedAt は Build12+ 必須。失敗時は新規検知をスキップして
      // 既存の未タグ付け処理だけで続行する（劣化挙動・致命的ではない）。
      console.warn("[auto-tagger] new-item detection failed:", err.message);
    }

    // Step C: 既存の未タグ付け候補 ID
    // Copilot 指摘対応: importedAt 降順でソートし、新規に近い順に処理する。
    // 1 tick = 1枚のため、lastScanAt が前進しても残りの新規画像が
    // 古い未タグ付け画像の後ろに埋もれないようにする。
    //
    // Phase 10.1: fields は id と importedAt（ソート用）のみ。filePath は使わない。
    let untaggedIds = [];
    try {
      const untaggedItems = await getUntagged(["id", "importedAt"]);
      untaggedIds = untaggedItems
        .filter((it) => it && it.id)
        .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0))
        .map((it) => it.id);
    } catch (err) {
      console.warn("[auto-tagger] getUntagged failed:", err.message);
    }

    // Step D: 結合（新規優先・id で重複除外）。workQueue は ID のみ保持。
    const seen = new Set();
    const workQueue = [];
    for (const id of newItemIds) {
      if (id && !seen.has(id)) {
        seen.add(id);
        workQueue.push({ id, isNew: true });
      }
    }
    for (const id of untaggedIds) {
      if (id && !seen.has(id)) {
        seen.add(id);
        workQueue.push({ id, isNew: false });
      }
    }

    if (workQueue.length === 0) {
      // 仕事がない場合は lastScanAt を更新せず、次の差分に備える
      return;
    }

    // Step E: 先頭1枚を fields なしフル取得（filePath の正しい絶対パスを得るため）
    const { id, isNew } = workQueue[0];
    let item = null;
    try {
      item = await getItemById(id);
    } catch (err) {
      // アイテムが既に削除されている等のレース。スキップして次 tick へ。
      console.warn(`[auto-tagger] getItemById failed for ${id}:`, err.message);
    }
    if (!item) {
      // lastScanAt を更新して次へ（悪化ループを防ぐ）
      state.lastScanAt = Date.now();
      saveLastScanAt(state.lastScanAt);
      return;
    }

    if (typeof state.onProgress === "function") {
      state.onProgress({
        status: "processing",
        fileName: item.name,
        isNew,
        queueSize: workQueue.length,
      });
    }

    try {
      const result = await processOneItem(item, settings);
      state.consecutiveErrors = 0;
      state.lastError = null;
      if (isNew) state.processedNewCount++;
      else state.processedUntaggedCount++;
      if (typeof state.onProgress === "function") {
        state.onProgress({
          status: "done",
          fileName: item.name,
          tags: result.tags,
          isNew,
        });
      }
    } catch (err) {
      state.consecutiveErrors++;
      state.lastError = err.message;
      // エラー履歴をリングバッファに記録（停止時の原因診断用・SPEC §15.10）
      state.errorHistory.push({
        at: Date.now(),
        fileName: item.name,
        message: err.message,
      });
      if (state.errorHistory.length > ERROR_HISTORY_CAP) {
        state.errorHistory.shift();
      }
      console.warn(
        `[auto-tagger] inference failed for ${item.name}:`,
        err.message
      );
      if (typeof state.onProgress === "function") {
        state.onProgress({
          status: "error",
          fileName: item.name,
          error: err.message,
          consecutiveErrors: state.consecutiveErrors,
        });
      }
      const max =
        (settings.autoMode && settings.autoMode.maxConsecutiveErrors) || 5;
      if (state.consecutiveErrors >= max) {
        const reason = `連続エラーが閾値 (${max}) に到達したため自動停止しました`;
        if (typeof state.onWarning === "function") {
          state.onWarning({
            reason: "max_consecutive_errors",
            consecutiveErrors: state.consecutiveErrors,
            lastError: state.lastError,
            errorHistory: state.errorHistory.slice(),
            message: reason,
          });
        }
        // 警告は上で発火済みのため、reason なしで stop する
        // （reason を渡すと stop() が onWarning を再発火し二重通知になる・SPEC §15.10）
        stop();
        return;
      }
    }

    // Step F: lastScanAt を更新して永続化
    state.lastScanAt = Date.now();
    saveLastScanAt(state.lastScanAt);
  } finally {
    state.inTick = false;
  }
}

/**
 * 自動タグ付けを開始。
 *
 * @param {object} [options]
 * @param {object} [options.settings] - 設定（省略時は loadSettings()）
 * @param {function} [options.onProgress] - 進捗コールバック
 * @param {function} [options.onWarning] - 警告コールバック（停止理由など）
 * @returns {boolean} 開始に成功した場合 true（既に実行中なら false）
 */
function start(options) {
  const opts = options || {};
  if (state.running) return false;
  const settings = opts.settings || loadSettings();
  const intervalSec =
    (settings.autoMode && settings.autoMode.pollIntervalSec) || 45;
  state.settings = settings;
  state.onProgress = opts.onProgress || null;
  state.onWarning = opts.onWarning || null;
  state.running = true;
  state.paused = false;
  state.inTick = false;
  state.consecutiveErrors = 0;
  state.processedNewCount = 0;
  state.processedUntaggedCount = 0;
  state.lastScanAt = loadLastScanAt() ?? Date.now();
  state.lastError = null;
  state.errorHistory = [];
  state.timer = setInterval(() => {
    // setInterval は async 関数の完了を待たないので、
    // tick 内部の inTick ガードで再入を防ぐ
    tick().catch((err) => {
      console.error("[auto-tagger] tick crashed:", err);
    });
  }, clampIntervalSec(intervalSec) * 1000);
  return true;
}

/**
 * SPEC §15.1 で定める 30〜300 秒のレンジに収める。
 * 不正な保存設定や手動編集で範囲外の値が入っても安全に動作させるため。
 */
function clampIntervalSec(sec) {
  const n = typeof sec === "number" && Number.isFinite(sec) ? sec : 45;
  return Math.max(30, Math.min(300, Math.floor(n)));
}

/**
 * 自動タグ付けを停止。
 *
 * @param {string} [reason] - 停止理由（onWarning で通知）
 * @returns {boolean} 停止した場合 true（元々停止中なら false）
 */
function stop(reason) {
  if (!state.running) return false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.running = false;
  state.paused = false;
  state.inTick = false;
  if (reason && typeof state.onWarning === "function") {
    state.onWarning({ reason: "stopped", message: reason });
  }
  return true;
}

/**
 * 手動 run() 実行用の一時停止（排他制御）。
 * 実行中（state.running === true）の場合のみ paused を true にする。
 * タイマー自体は止めない（tick 内で paused チェックして skip する）。
 */
function pauseForManualRun() {
  if (!state.running) return false;
  state.paused = true;
  return true;
}

/**
 * 手動 run() 終了後の再開。
 * 再開直後の lastScanAt を「今」に更新し、手動 run 中のタグ変更を
 * 自動ループが新しい変更として拾わないようにする。
 */
function resumeAfterManualRun() {
  if (!state.running) return false;
  state.paused = false;
  state.lastScanAt = Date.now();
  saveLastScanAt(state.lastScanAt);
  return true;
}

module.exports = {
  start,
  stop,
  isRunning,
  getState,
  pauseForManualRun,
  resumeAfterManualRun,
  // テスト用: 状態を完全リセット
  _resetForTest() {
    if (state.timer) clearInterval(state.timer);
    state = createFreshState();
  },
  // テスト用: 内部 tick を外部からトリガできるようにする
  _tickForTest: tick,
};
