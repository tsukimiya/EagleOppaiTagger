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
  var DEFAULTS = { threshold: 0.5, maxTags: 30, mergeStrategy: "append", blacklist: [], useServer: false, serverUrl: "", serverTimeoutMs: 10000, fallbackOnError: true };
  var SETTINGS_KEY = "eagle-oppai-tagger:settings";

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
  }

  function readSettingsFromUI() {
    var t = parseFloat(thresholdInput.value); if (isNaN(t)) t = DEFAULTS.threshold;
    var m = parseInt(maxTagsInput.value, 10); if (isNaN(m) || m < 1) m = DEFAULTS.maxTags;
    var strategy = DEFAULTS.mergeStrategy;
    for (var i = 0; i < mergeRadios.length; i++) if (mergeRadios[i].checked) { strategy = mergeRadios[i].value; break; }
    var bl = blacklistInput.value.trim(); bl = bl ? bl.split(",").map(function(s){return s.trim()}).filter(Boolean) : [];
    return { threshold: Math.max(0,Math.min(1,t)), maxTags: Math.max(1,Math.min(100,m)), mergeStrategy: strategy, blacklist: bl,
             useServer: useServerCheckbox ? useServerCheckbox.checked : false,
             serverUrl: serverUrlInput ? serverUrlInput.value.trim() : "",
             serverTimeoutMs: DEFAULTS.serverTimeoutMs,
             fallbackOnError: fallbackOnErrorCheckbox ? fallbackOnErrorCheckbox.checked : true };
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

  // --- NSFW 警告 ----------------------------------------------------------
  var NSFW_KEY = "eagle-oppai-tagger:nsfw-dismissed";
  if (nsfwOk) nsfwOk.addEventListener("click", function () {
    if (nsfwDismiss && nsfwDismiss.checked) { try { localStorage.setItem(NSFW_KEY, "1"); } catch (_) {} }
    if (nsfwOverlay) nsfwOverlay.classList.remove("show");
  });

  // --- 初期化 -------------------------------------------------------------
  populateUI();
  console.log("[ui] initialized — run/cancel listeners registered");

  // NSFW 初回警告
  try { if (localStorage.getItem(NSFW_KEY) !== "1" && nsfwOverlay) nsfwOverlay.classList.add("show"); } catch (_) {}

})();
