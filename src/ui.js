/**
 * src/ui.js
 *
 * UI event handlers for the OppaiOracle Tagger plugin.
 * Connects DOM elements to window.EagleOppaiTagger (run / requestCancel).
 * Settings are persisted via src/settings.js (localStorage).
 *
 * SPEC reference: .spec/SPEC.md §8
 */
"use strict";

(function () {
  // --- Module dependencies (available via Electron nodeIntegration) --------
  var settingsModule = require("./settings");
  var loadSettings = settingsModule.loadSettings;
  var saveSettings = settingsModule.saveSettings;
  var DEFAULTS = settingsModule.DEFAULTS;

  // --- DOM references ------------------------------------------------------
  var runBtn = document.getElementById("run-btn");
  var cancelBtn = document.getElementById("cancel-btn");
  var progressBar = document.getElementById("progress-bar");
  var progressText = document.getElementById("progress-text");
  var summarySection = document.getElementById("summary-section");
  var summaryEl = document.getElementById("summary");

  var thresholdInput = document.getElementById("threshold");
  var thresholdVal = document.getElementById("threshold-val");
  var maxTagsInput = document.getElementById("max-tags");
  var blacklistInput = document.getElementById("blacklist");
  var mergeRadios = document.querySelectorAll('input[name="merge"]');

  var modelStatus = document.getElementById("model-status");
  var dlBtn = document.getElementById("dl-btn");

  var nsfwOverlay = document.getElementById("nsfw-warning");
  var nsfwDismiss = document.getElementById("nsfw-dismiss");
  var nsfwOk = document.getElementById("nsfw-ok");

  // --- Constants -----------------------------------------------------------
  var NSFW_KEY = "eagle-oppai-tagger:nsfw-dismissed";

  // --- State ---------------------------------------------------------------
  var settings = loadSettings();
  var startTime = null;
  var processedCount = 0;
  var errorCount = 0;
  var lastFileName = "";
  var lastTags = [];

  // --- Settings UI ---------------------------------------------------------

  function populateUI() {
    thresholdInput.value = settings.threshold;
    thresholdVal.textContent = settings.threshold.toFixed(2);
    maxTagsInput.value = settings.maxTags;
    blacklistInput.value = (settings.blacklist || []).join(", ");

    for (var i = 0; i < mergeRadios.length; i++) {
      mergeRadios[i].checked = mergeRadios[i].value === settings.mergeStrategy;
    }
  }

  function readSettingsFromUI() {
    var threshold = parseFloat(thresholdInput.value);
    if (isNaN(threshold)) threshold = DEFAULTS.threshold;
    threshold = Math.max(0, Math.min(1, threshold));

    var maxTags = parseInt(maxTagsInput.value, 10);
    if (isNaN(maxTags) || maxTags < 1) maxTags = DEFAULTS.maxTags;
    maxTags = Math.max(1, Math.min(100, maxTags));

    var mergeStrategy = DEFAULTS.mergeStrategy;
    for (var i = 0; i < mergeRadios.length; i++) {
      if (mergeRadios[i].checked) {
        mergeStrategy = mergeRadios[i].value;
        break;
      }
    }

    var blacklistStr = blacklistInput.value.trim();
    var blacklist = blacklistStr
      ? blacklistStr.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
      : [];

    return {
      threshold: threshold,
      maxTags: maxTags,
      mergeStrategy: mergeStrategy,
      blacklist: blacklist,
    };
  }

  function onSettingsChanged() {
    settings = readSettingsFromUI();
    saveSettings(settings);
    thresholdVal.textContent = settings.threshold.toFixed(2);
  }

  // --- Progress helpers ----------------------------------------------------

  function formatTime(ms) {
    var sec = Math.floor(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function resetProgress() {
    progressBar.style.width = "0%";
    progressBar.className = "";
    progressText.textContent = "待機中";
    summarySection.style.display = "none";
    summaryEl.textContent = "";
    startTime = null;
    processedCount = 0;
    errorCount = 0;
    lastFileName = "";
    lastTags = [];
  }

  // --- Progress callback ---------------------------------------------------

  function onProgress(ev) {
    var now = Date.now();

    if (ev.status === "processing") {
      if (!startTime) startTime = now;
      var pct = ev.total > 0 ? (ev.current / ev.total) * 100 : 0;
      progressBar.style.width = pct + "%";
      progressBar.className = "";
      progressText.textContent =
        ev.current + "/" + ev.total + " 枚処理中: " + (ev.fileName || "");
      return;
    }

    if (ev.status === "done") {
      processedCount++;
      lastFileName = ev.fileName || "";
      lastTags = ev.tags || [];
      var pctDone = ev.total > 0 ? (ev.current / ev.total) * 100 : 0;
      progressBar.style.width = pctDone + "%";

      var elapsed = now - startTime;
      var avgTime = processedCount > 0 ? elapsed / processedCount : 0;
      var remaining = Math.max(0, (ev.total - ev.current) * avgTime);
      progressText.textContent =
        ev.current + "/" + ev.total + " 枚完了: " + (ev.fileName || "") +
        " | 経過: " + formatTime(elapsed) +
        " | 残り: " + formatTime(remaining);

      if (ev.current >= ev.total) {
        showSummary(ev.total, elapsed);
        finishRun();
      }
      return;
    }

    if (ev.status === "error") {
      errorCount++;
      progressBar.className = "error";
      progressText.textContent =
        "エラー: " + (ev.fileName || "") + " - " + (ev.error || "");
      return;
    }

    if (ev.status === "cancelled") {
      progressBar.className = "cancelled";
      var elapsedCancel = startTime ? now - startTime : 0;
      progressText.textContent =
        "キャンセル済み (" + processedCount + "/" + ev.total + " 枚処理)";
      showSummary(processedCount, elapsedCancel);
      finishRun();
      return;
    }
  }

  // --- Summary -------------------------------------------------------------

  function showSummary(count, elapsedMs) {
    summarySection.style.display = "block";
    var avg = count > 0 ? (elapsedMs / count).toFixed(0) : "0";
    var html =
      "<div>処理枚数: " + count + " / エラー: " + errorCount + "</div>" +
      "<div>平均処理時間: " + avg + " ms/枚</div>";
    if (lastFileName) {
      html += "<div>最後: " + lastFileName + "</div>";
      if (lastTags.length > 0) {
        html += "<div class=\"tags\">" + lastTags.join(", ") + "</div>";
      }
    }
    summaryEl.innerHTML = html;
  }

  // --- Run / Cancel --------------------------------------------------------

  function finishRun() {
    runBtn.disabled = false;
    cancelBtn.disabled = true;
  }

  runBtn.addEventListener("click", function () {
    onSettingsChanged();
    resetProgress();
    runBtn.disabled = true;
    cancelBtn.disabled = false;
    startTime = Date.now();

    window.EagleOppaiTagger.run(onProgress);
  });

  cancelBtn.addEventListener("click", function () {
    window.EagleOppaiTagger.requestCancel();
  });

  // --- Settings event wiring -----------------------------------------------

  thresholdInput.addEventListener("input", onSettingsChanged);
  maxTagsInput.addEventListener("input", onSettingsChanged);
  blacklistInput.addEventListener("input", onSettingsChanged);
  for (var i = 0; i < mergeRadios.length; i++) {
    mergeRadios[i].addEventListener("change", onSettingsChanged);
  }

  // --- Model status (placeholder — downloader.js will fill in Phase 5) -----

  function checkModelStatus() {
    var fs = require("fs");
    var path = require("path");
    var modelPath = path.join(__dirname, "..", "models", "V1.1", "model.onnx");
    if (fs.existsSync(modelPath)) {
      modelStatus.textContent = "DL済み";
      modelStatus.className = "status-ok";
      dlBtn.style.display = "none";
    } else {
      modelStatus.textContent = "未ダウンロード";
      modelStatus.className = "status-warn";
      dlBtn.style.display = "";
    }
  }

  dlBtn.addEventListener("click", function () {
    modelStatus.textContent = "DL中...";
    modelStatus.className = "status-warn";
    dlBtn.disabled = true;
    var downloader = require("./downloader");
    downloader
      .downloadAll(function (ev) {
        var p = ev.downloading ? ev.downloading.percent : 100;
        modelStatus.textContent = "DL中... " + p + "%";
      })
      .then(function () {
        checkModelStatus();
      })
      .catch(function (err) {
        console.error("Download failed:", err);
        modelStatus.textContent = "DL失敗: " + err.message;
        modelStatus.className = "status-warn";
        dlBtn.disabled = false;
      });
  });

  // --- NSFW warning --------------------------------------------------------

  function checkFirstRun() {
    try {
      if (localStorage.getItem(NSFW_KEY) === "1") return;
    } catch (_e) { /* ignore */ }
    nsfwOverlay.classList.add("show");
  }

  nsfwOk.addEventListener("click", function () {
    if (nsfwDismiss.checked) {
      try { localStorage.setItem(NSFW_KEY, "1"); } catch (_e) { /* ignore */ }
    }
    nsfwOverlay.classList.remove("show");
  });

  // --- Init ----------------------------------------------------------------

  populateUI();
  checkModelStatus();
  checkFirstRun();
})();
