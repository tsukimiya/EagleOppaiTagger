/**
 * src/settings.js
 *
 * Plugin settings persisted via `localStorage` (or an in-memory fallback
 * when `localStorage` is unavailable, e.g. in headless Node tests).
 *
 * SPEC reference: .spec/SPEC.md §7.5
 */
"use strict";

const SETTINGS_KEY = "eagle-oppai-tagger:settings";

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
};

// In a plain Node test environment `localStorage` does not exist; provide a
// tiny in-memory fallback so the module can still be loaded and tested.
const storage =
  typeof localStorage !== "undefined"
    ? localStorage
    : (() => {
        let _data = null;
        return {
          getItem: () => _data,
          setItem: (_key, value) => {
            _data = String(value);
          },
        };
      })();

function loadSettings() {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (_e) {
    return DEFAULTS;
  }
}

function saveSettings(s) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function resetSettings() {
  saveSettings(DEFAULTS);
  return DEFAULTS;
}

module.exports = { loadSettings, saveSettings, resetSettings, DEFAULTS };
