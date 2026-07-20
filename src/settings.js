/**
 * src/settings.js
 *
 * Plugin settings persisted via `localStorage` (or an in-memory fallback
 * when `localStorage` is unavailable, e.g. in headless Node tests).
 *
 * SPEC reference: .spec/SPEC.md §7.5, §15.5
 */
"use strict";

const SETTINGS_KEY = "eagle-oppai-tagger:settings";
const LAST_SCAN_KEY = "eagle-oppai-tagger:last-scan-at";

const DEFAULTS = {
  threshold: 0.5,
  maxTags: 30,
  mergeStrategy: "append",
  blacklist: [],
  // Phase 8: server inference settings
  useServer: false,
  serverUrl: "",
  serverTimeoutMs: 10000,
  fallbackOnError: true,
  // Phase 10: auto-mode settings (SPEC §15.5)
  autoMode: {
    enabled: false,
    pollIntervalSec: 45,
    maxConsecutiveErrors: 5,
  },
};

// In a plain Node test environment `localStorage` does not exist; provide a
// tiny in-memory fallback so the module can still be loaded and tested.
// Tests typically inject their own localStorage mock; this fallback only
// kicks in when no mock is provided.
const storage =
  typeof localStorage !== "undefined"
    ? localStorage
    : (() => {
        const _store = Object.create(null);
        return {
          getItem(key) {
            return Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null;
          },
          setItem(key, value) {
            _store[key] = String(value);
          },
          removeItem(key) {
            delete _store[key];
          },
        };
      })();

function loadSettings() {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return clone(DEFAULTS);
    const parsed = JSON.parse(raw);
    // Shallow merge for top-level keys, but deep-merge autoMode so a partial
    // user save (e.g. `{ enabled: true }`) doesn't drop the other autoMode
    // defaults (SPEC §15.5).
    const result = { ...DEFAULTS, ...parsed };
    if (parsed.autoMode && typeof parsed.autoMode === "object") {
      result.autoMode = { ...DEFAULTS.autoMode, ...parsed.autoMode };
    }
    return result;
  } catch (_e) {
    return clone(DEFAULTS);
  }
}

function saveSettings(s) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function resetSettings() {
  saveSettings(DEFAULTS);
  return clone(DEFAULTS);
}

// Phase 10: lastScanAt persistence for auto-mode polling (SPEC §15.4).
// Stored separately from the settings object so toggling autoMode off/on
// doesn't reset the scan cursor.
function loadLastScanAt() {
  try {
    const raw = storage.getItem(LAST_SCAN_KEY);
    const ts = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(ts) ? ts : null;
  } catch (_e) {
    return null;
  }
}

function saveLastScanAt(timestamp) {
  storage.setItem(LAST_SCAN_KEY, String(timestamp));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = {
  loadSettings,
  saveSettings,
  resetSettings,
  DEFAULTS,
  loadLastScanAt,
  saveLastScanAt,
};
