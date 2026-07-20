/**
 * src/ui.js
 *
 * OppaiOracle Tagger の UI イベントハンドラ。
 * 外部 require をトップレベルで行わず、イベントリスナーを最優先で登録する。
 */
"use strict";

(function () {
  // --- DOM 参照 (最優先) --------------------------------------------------
  var runBtn     = document.getElementById("run-btn");
  var cancelBtn  = document.getElementById("cancel-btn");
  var progressBar = document.getElementById("progress-bar");
  var progressText = document.getElementById("progress-text");
  var summarySection = document.getElementById("summary-section");
  var summaryEl = document.getElementById("summary");
  var thresholdInput = document.getElementById("threshold");
  var thresholdVal  = document.getElementById("threshold-val");
  var maxTagsInput  = document.getElementById("max-tags");
  var blacklistInput = document.getElementById("blacklist");
  var mergeRadios = document.querySelectorAll('input[name="merge"]');
  var modelStatus = document.getElementById("model-status");
  var dlBtn = document.getElementById("dl-btn");
  var nsfwOverlay  = document.getElementById("nsfw-warning");
  var nsfwDismiss  = document.getElementById("nsfw-dismiss");
  var nsfwOk       = document.getElementById("nsfw-ok");
  var useServerCheckbox = document.getElementById("use-server");
  var serverUrlInput = document.getElementById("server-url");
  var serverTestBtn = document.getElementById("server-test-btn");
  var fallbackOnErrorCheckbox = document.getElementById("fallback-on-error");
  var serverStatusEl = document.getElementById("server-status");

  // --- Phase 10: 自動モード DOM 参照 -------------------------------------
  var autoEnabledCheckbox = document.getElementById("auto-enabled");
  var autoIntervalInput = document.getElementById("auto-interval");
  var autoIntervalVal = document.getElementById("auto-interval-val");
  var autoMaxErrorsInput = document.getElementById("auto-max-errors");
  var autoStatusRow = document.getElementById("auto-status-row");
  var autoStatusEl = document.getElementById("auto-status");
  var autoNsfwOverlay = document.getElementById("auto-nsfw-warning");
  var autoNsfwDismiss = document.getElementById("auto-nsfw-dismiss");
  var autoNsfwCancel = document.getElementById("auto-nsfw-cancel");
  var autoNsfwOk = document.getElementById("auto-nsfw-ok");

  // --- イベントリスナー登録 (最優先・crash-safe) --------------------------
  runBtn.addEventListener("click", function () {
    console.log("[ui] run clicked");
    runBtn.disabled = true;
    cancelBtn.disabled = false;
    resetProgress();
    var path = require("path");
    var sd = path.join(__dirname || "", "src");
    var diag = [];
    try { require(path.join(sd, "preprocess")); diag.push("preprocess"); } catch(e) { diag.push("preprocess FAIL: "+e.message); }
    try { require(path.join(sd, "inference")); diag.push("inference"); } catch(e) { diag.push("inference FAIL: "+e.message); }
    try { require(path.join(sd, "tags")); diag.push("tags"); } catch(e) { diag.push("tags FAIL: "+e.message); }
    var main = null;
    try { main = require(path.join(sd, "main")); diag.push("main OK"); } catch(e) { diag.push("main FAIL: "+e.message); }
    progressText.textContent = diag.join(" | ");
    if (!main) { runBtn.disabled = false; cancelBtn.disabled = true; return; }
    try {
      window.EagleOppaiTagger = main.EagleOppaiTagger || { run: main.run, requestCancel: main.requestCancel };
      var settings = loadSettingsSafe();
      saveSettingsSafe(readSettingsFromUI());
      window.EagleOppaiTagger.run(onProgress);
    } catch (e) {
      progressText.textContent = "実行エラー: " + (e.message || e);
      runBtn.disabled = false;
      cancelBtn.disabled = true;
    }
  });

  cancelBtn.addEventListener("click", function () {
    console.log("[ui] cancel clicked");
    if (window.EagleOppaiTagger && window.EagleOppaiTagger.requestCancel) {
      window.EagleOppaiTagger.requestCancel();
    }
  });

  // --- 設定の簡易 load/save (settings.js 非依存) -------------------------
  var DEFAULTS = {
    threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [],
    useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true,
    // Phase 10: 自動モード設定（SPEC §15.5）
    autoMode: { enabled: false, pollIntervalSec: 45, maxConsecutiveErrors: 5 },
  };
  var SETTINGS_KEY = "eagle-oppai-tagger:settings";
  var AUTO_NSFW_KEY = "eagle-oppai-tagger:auto-nsfw-dismissed";

  function loadSettingsSafe() {
    try { var raw = localStorage.getItem(SETTINGS_KEY); return raw ? Object.assign({}, DEFAULTS, JSON.parse(raw)) : DEFAULTS; }
    catch (_) { return DEFAULTS; }
  }
  function saveSettingsSafe(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {}
  }

  var settings = loadSettingsSafe();

  function populateUI() {
    thresholdInput.value = settings.threshold;
    thresholdVal.textContent = settings.threshold.toFixed(2);
    maxTagsInput.value = settings.maxTags;
    blacklistInput.value = (settings.blacklist || []).join(", ");
    for (var i = 0; i < mergeRadios.length; i++) mergeRadios[i].checked = mergeRadios[i].value === settings.mergeStrategy;
    if (useServerCheckbox) useServerCheckbox.checked = !!settings.useServer;
    if (serverUrlInput) serverUrlInput.value = settings.serverUrl || "";
    if (fallbackOnErrorCheckbox) fallbackOnErrorCheckbox.checked = settings.fallbackOnError !== false;
    // Phase 10: 自動モード
    var am = settings.autoMode || {};
    if (autoEnabledCheckbox) autoEnabledCheckbox.checked = !!am.enabled;
    if (autoIntervalInput) autoIntervalInput.value = am.pollIntervalSec || 45;
    if (autoIntervalVal) autoIntervalVal.textContent = String(am.pollIntervalSec || 45);
    if (autoMaxErrorsInput) autoMaxErrorsInput.value = am.maxConsecutiveErrors || 5;
  }

  function readSettingsFromUI() {
    var t = parseFloat(thresholdInput.value); if (isNaN(t)) t = DEFAULTS.threshold;
    var m = parseInt(maxTagsInput.value, 10); if (isNaN(m) || m < 1) m = DEFAULTS.maxTags;
    var strategy = DEFAULTS.mergeStrategy;
    for (var i = 0; i < mergeRadios.length; i++) if (mergeRadios[i].checked) { strategy = mergeRadios[i].value; break; }
    var bl = blacklistInput.value.trim(); bl = bl ? bl.split(",").map(function(s){return s.trim()}).filter(Boolean) : [];
    // Phase 10: 自動モード設定を読み取り
    var pollInterval = DEFAULTS.autoMode.pollIntervalSec;
    if (autoIntervalInput) {
      var pi = parseInt(autoIntervalInput.value, 10);
      if (!isNaN(pi) && pi >= 5) pollInterval = pi;
    }
    var maxErr = DEFAULTS.autoMode.maxConsecutiveErrors;
    if (autoMaxErrorsInput) {
      var me = parseInt(autoMaxErrorsInput.value, 10);
      if (!isNaN(me) && me >= 1) maxErr = me;
    }
    var amEnabled = autoEnabledCheckbox ? !!autoEnabledCheckbox.checked : false;
    return {
      threshold: Math.max(0,Math.min(1,t)),
      maxTags: Math.max(1,Math.min(100,m)),
      mergeStrategy: strategy,
      blacklist: bl,
      useServer: useServerCheckbox ? useServerCheckbox.checked : false,
      serverUrl: serverUrlInput ? serverUrlInput.value.trim() : "",
      serverTimeoutMs: DEFAULTS.serverTimeoutMs,
      fallbackOnError: fallbackOnErrorCheckbox ? fallbackOnErrorCheckbox.checked : true,
      autoMode: { enabled: amEnabled, pollIntervalSec: pollInterval, maxConsecutiveErrors: maxErr },
    };
  }

  function onSettingsChanged() { settings = readSettingsFromUI(); saveSettingsSafe(settings); thresholdVal.textContent = settings.threshold.toFixed(2); }

  // --- 進捗 ---------------------------------------------------------------
  var startTime = null, processedCount = 0, errorCount = 0, lastFileName = "", lastTags = [];

  function resetProgress() {
    progressBar.style.width = "0%"; progressBar.className = "";
    progressText.textContent = "待機中";
    summarySection.style.display = "none"; summaryEl.textContent = "";
    startTime = null; processedCount = 0; errorCount = 0; lastFileName = ""; lastTags = [];
  }

  function formatTime(ms) { var sec = Math.floor(ms/1000); return Math.floor(sec/60) + ":" + (sec%60 < 10 ? "0" : "") + (sec%60); }

  function onProgress(ev) {
    var now = Date.now();
    if (ev.status === "processing") {
      if (!startTime) startTime = now;
      progressBar.style.width = ev.total > 0 ? (ev.current/ev.total*100) + "%" : "0%";
      progressBar.className = "";
      progressText.textContent = ev.current + "/" + ev.total + " 枚処理中: " + (ev.fileName || "");
    } else if (ev.status === "done") {
      processedCount++; lastFileName = ev.fileName || ""; lastTags = ev.tags || [];
      progressBar.style.width = ev.total > 0 ? (ev.current/ev.total*100) + "%" : "0%";
      var elapsed = now - startTime, avg = processedCount > 0 ? elapsed/processedCount : 0;
      progressText.textContent = ev.current + "/" + ev.total + " 枚完了: " + (ev.fileName||"") + " | 経過:" + formatTime(elapsed) + " | 残り:" + formatTime(Math.max(0,(ev.total-ev.current)*avg));
      if (ev.current >= ev.total) { showSummary(ev.total, elapsed); finishRun(); }
    } else if (ev.status === "error") {
      errorCount++; progressBar.className = "error";
      progressText.textContent = "エラー: " + (ev.fileName||"") + " - " + (ev.error||"");
    } else if (ev.status === "cancelled") {
      progressBar.className = "cancelled";
      var ec = startTime ? now - startTime : 0;
      progressText.textContent = "キャンセル済み (" + processedCount + "/" + ev.total + " 枚処理)";
      showSummary(processedCount, ec); finishRun();
    }
  }

  function showSummary(count, elapsedMs) {
    summarySection.style.display = "block";
    var avg = count > 0 ? (elapsedMs/count).toFixed(0) : "0";
    summaryEl.innerHTML = "<div>処理枚数:" + count + " / エラー:" + errorCount + "</div><div>平均処理時間:" + avg + " ms/枚</div>" +
      (lastFileName ? "<div>最後:" + lastFileName + "</div>" : "") + (lastTags.length ? "<div class=\"tags\">"+lastTags.join(", ")+"</div>" : "");
  }

  function finishRun() { runBtn.disabled = false; cancelBtn.disabled = true; }

  // --- 設定イベント配線 ---------------------------------------------------
  thresholdInput.addEventListener("input", onSettingsChanged);
  maxTagsInput.addEventListener("input", onSettingsChanged);
  blacklistInput.addEventListener("input", onSettingsChanged);
  for (var i = 0; i < mergeRadios.length; i++) mergeRadios[i].addEventListener("change", onSettingsChanged);
  if (useServerCheckbox) useServerCheckbox.addEventListener("change", onSettingsChanged);
  if (serverUrlInput) serverUrlInput.addEventListener("input", onSettingsChanged);
  if (fallbackOnErrorCheckbox) fallbackOnErrorCheckbox.addEventListener("change", onSettingsChanged);
  if (serverTestBtn) serverTestBtn.addEventListener("click", function () {
    serverStatusEl.textContent = "接続テスト未実装（renderer 制約）"; serverStatusEl.style.color = "#ca4";
  });

  // --- Phase 10: 自動モード ----------------------------------------------
  // 進捗 / 警告ハンドラは auto-tagger.js から遅延 require したインスタンスに渡す。
  // main.js と同様、<script> で直接読み込まず遅延 require で crash-safe に。
  var autoTagger = null;
  try {
    var autoPath = require("path").join(__dirname || "", "src", "auto-tagger");
    autoTagger = require(autoPath);
  } catch (e) {
    console.warn("[ui] auto-tagger.js not loaded:", e.message);
    autoTagger = null;
  }

  function autoOnProgress(ev) {
    if (!autoStatusEl) return;
    if (ev.status === "processing") {
      var kind = ev.isNew ? "新規" : "未タグ付け";
      autoStatusEl.textContent = "処理中 (" + kind + "): " + (ev.fileName || "") + " / 残り " + (ev.queueSize || 0);
      autoStatusEl.style.color = "#8cf";
    } else if (ev.status === "done") {
      var s = autoTagger ? autoTagger.getState() : null;
      var nc = s ? s.processedNewCount : 0;
      var uc = s ? s.processedUntaggedCount : 0;
      autoStatusEl.textContent = "新規 " + nc + " / 未タグ付け " + uc + " 処理済み: " + (ev.fileName || "");
      autoStatusEl.style.color = "#4a7";
    } else if (ev.status === "error") {
      autoStatusEl.textContent = "エラー: " + (ev.fileName || "") + " - " + (ev.error || "") + " (連続 " + (ev.consecutiveErrors || 0) + ")";
      autoStatusEl.style.color = "#a44";
    }
  }

  function autoOnWarning(w) {
    if (!autoStatusEl) return;
    autoStatusEl.textContent = "停止: " + (w.message || w.reason || "");
    autoStatusEl.style.color = "#ca4";
    if (autoEnabledCheckbox) autoEnabledCheckbox.checked = false;
    if (autoStatusRow) autoStatusRow.style.display = "block";
  }

  function autoStart() {
    if (!autoTagger) { console.warn("[ui] auto-tagger unavailable"); return; }
    var s = loadSettingsSafe();
    autoTagger.start({
      settings: s,
      onProgress: autoOnProgress,
      onWarning: autoOnWarning,
    });
    if (autoStatusRow) autoStatusRow.style.display = "block";
    if (autoStatusEl) {
      autoStatusEl.textContent = "自動モード動作中";
      autoStatusEl.style.color = "#4a7";
    }
  }

  function autoStop() {
    if (!autoTagger) return;
    autoTagger.stop();
    if (autoStatusEl) {
      autoStatusEl.textContent = "停止中";
      autoStatusEl.style.color = "#aaa";
    }
  }

  // ポーリング間隔スライダー: 値表示 + 設定保存
  if (autoIntervalInput) {
    autoIntervalInput.addEventListener("input", function () {
      if (autoIntervalVal) autoIntervalVal.textContent = autoIntervalInput.value;
      onSettingsChanged();
    });
  }
  if (autoMaxErrorsInput) {
    autoMaxErrorsInput.addEventListener("input", onSettingsChanged);
  }

  // 自動モード チェックボックス: ON 時は NSFW 警告 → start、OFF 時は stop
  if (autoEnabledCheckbox) autoEnabledCheckbox.addEventListener("change", function () {
    onSettingsChanged();
    if (autoEnabledCheckbox.checked) {
      // 初回 ON 時は NSFW 警告ダイアログ
      var dismissed = false;
      try { dismissed = localStorage.getItem(AUTO_NSFW_KEY) === "1"; } catch (_) {}
      if (!dismissed && autoNsfwOverlay) {
        autoNsfwOverlay.classList.add("show");
        // ダイアログのボタン処理で最終的に start するか cancel するか決定
      } else {
        autoStart();
      }
    } else {
      autoStop();
    }
  });

  // 自動モード NSFW 警告ダイアログ
  if (autoNsfwOk) autoNsfwOk.addEventListener("click", function () {
    if (autoNsfwDismiss && autoNsfwDismiss.checked) {
      try { localStorage.setItem(AUTO_NSFW_KEY, "1"); } catch (_) {}
    }
    if (autoNsfwOverlay) autoNsfwOverlay.classList.remove("show");
    autoStart();
  });
  if (autoNsfwCancel) autoNsfwCancel.addEventListener("click", function () {
    if (autoEnabledCheckbox) autoEnabledCheckbox.checked = false;
    onSettingsChanged();
    if (autoNsfwOverlay) autoNsfwOverlay.classList.remove("show");
  });

  // --- NSFW 警告（手動実行用） -------------------------------------------
  var NSFW_KEY = "eagle-oppai-tagger:nsfw-dismissed";
  if (nsfwOk) nsfwOk.addEventListener("click", function () {
    if (nsfwDismiss && nsfwDismiss.checked) { try { localStorage.setItem(NSFW_KEY, "1"); } catch (_) {} }
    if (nsfwOverlay) nsfwOverlay.classList.remove("show");
  });

  // --- 初期化 -------------------------------------------------------------
  populateUI();
  console.log("[ui] initialized — run/cancel/auto-mode listeners registered");

  // NSFW 初回警告（手動実行）
  try { if (localStorage.getItem(NSFW_KEY) !== "1" && nsfwOverlay) nsfwOverlay.classList.add("show"); } catch (_) {}

  // Phase 10: 設定で自動モード ON なら起動時に開始
  try {
    var initSettings = loadSettingsSafe();
    if (initSettings.autoMode && initSettings.autoMode.enabled && autoEnabledCheckbox) {
      // UI 復元後、チェックボックスは既に populateUI() で ON になっている
      autoStart();
    }
  } catch (_) {}

})();
