# Eagle Plugin API: Configuration/Persistence API Research

**Status**: COMPLETE
**Date**: 2026-07-19
**Author**: THE LIBRARIAN (AI Agent)
**Verdict**: ❌ DOES NOT EXIST — Eagle Plugin API has NO dedicated configuration/persistence API.

---

## 1. Executive Summary

After exhaustive review of the **entire Eagle Plugin API documentation** (every API page, manifest spec, changelog, and tutorial), the conclusion is:

**Eagle provides NO built-in API for plugin-level settings persistence.** There is no agle.plugin.config, agle.plugin.settings, agle.storage, agle.preferences, or equivalent namespace. The manifest.json schema includes no config or preferences field. The changelog (spanning from the first API version to March 2026) records no addition of any configuration/storage API.

---

## 2. Evidence

### 2.1. Complete API Namespace Inventory

The following is the exhaustive list of all agle.* API namespaces documented at [https://developer.eagle.cool/plugin-api/](https://developer.eagle.cool/plugin-api/):

| Namespace | Purpose | Has Settings? |
|-----------|---------|:---:|
| agle.app | App version, locale, arch, paths, theme | ❌ |
| agle.item | Item CRUD (files in library) | ❌ |
| agle.folder | Folder CRUD | ❌ |
| agle.smartFolder | Smart folder CRUD | ❌ |
| agle.tag | Tag operations | ❌ |
| agle.tagGroup | Tag group operations | ❌ |
| agle.library | Library info (name, path) | ❌ |
| agle.window | Window controls (size, bounds, referer) | ❌ |
| agle.os | OS info | ❌ |
| agle.screen | Screen info | ❌ |
| agle.notification | System notifications | ❌ |
| agle.contextMenu | Context menu | ❌ |
| agle.dialog | System dialogs | ❌ |
| agle.clipboard | Clipboard operations | ❌ |
| agle.drag | Drag & drop | ❌ |
| agle.shell | Default app shell | ❌ |
| agle.log | Logging | ❌ |
| agle.extraModule.ffmpeg | FFmpeg integration | ❌ |
| agle.extraModule.aiSearch | AI semantic search | ❌ |
| agle.extraModule.aiSDK | AI model config | ❌ |

**Source**: [Eagle Plugin API sitemap](https://developer.eagle.cool/plugin-api/sitemap-pages.xml) — all 39 pages reviewed.

### 2.2. manifest.json Schema Has No Config Field

The manifest.json supports these fields only:
id, ersion, platform, rch, 
ame, logo, keywords, devTools, main (window config), preview (format extension), and serviceMode.

**No config, preferences, settings, or storage field exists.**

**Source**: [manifest.json Configuration Docs](https://developer.eagle.cool/plugin-api/tutorial/manifest.md)

### 2.3. Changelog Has No Config/Storage API Addition

The changelog (from first API version to March 24, 2026) documents additions such as:
- Comment CRUD API (March 2026)
- Smart Folder API (March 2026)
- followCursor manifest option (March 2026)
- AI Search API (Jan 2026)
- Tag Group incremental operations (Jan 2026)
- app.userDataPath (Aug 2025)
- Item API performance (Aug 2025)
- Window geometry control (July 2025)

**No configuration/storage API was ever added.**

**Source**: [Changelog](https://developer.eagle.cool/plugin-api/changelog.md)

### 2.4. GitHub Code Search Confirms No Such API

Searching GitHub for agle.plugin.config and agle.storage yields **zero results** in JavaScript/TypeScript code.

---

## 3. What IS Available for Persistence

Since Eagle Plugin API has no built-in settings API, plugin developers use one of two approaches:

### 3.1. Option A: localStorage (Most Common)

Eagle plugins run in Chromium 107 and have full access to the Web API, including localStorage. This is the **dominant pattern** in the Eagle plugin ecosystem.

**Real-world examples:**

| Plugin | Storage Method | Source |
|--------|---------------|--------|
| lc4t/copy2eagle (剪贴板图片留存) | localStorage | [README](https://github.com/lc4t/copy2eagle) — "Config stored in localStorage (sandboxed per plugin)" |
| yaq94/Eagle-Memory-Enhancement | localStorage | [GitHub](https://github.com/yaq94/Eagle-Memory-Enhancement) — "核心数据存储在 localStorage" |
| leonwong282/eagle-movie-picture-stitching | localStorage (implied) | [GitHub](https://github.com/leonwong282/eagle-movie-picture-stitching) — "Parameter Persistence: Automatically remembers your last settings" |

**Advantages**: Simple API, synchronous, sandboxed per plugin origin.
**Disadvantages**: Can be cleared by user, limited to ~5-10MB, not accessible outside the plugin window.

### 3.2. Option B: Node.js fs Module (File-Based)

Since Eagle plugins support Node.js native APIs (equire('fs')), plugins can read/write a JSON settings file to disk. The recommended directory is the **plugin's own folder** or the **user data directory** accessible via agle.app.getPath('userData').

**Real-world example:**

| Plugin | Storage Method | Source |
|--------|---------------|--------|
| Rootwork-Labs/eagle-stock-asset-cleanup | settings.json file | [README](https://github.com/Rootwork-Labs/eagle-stock-asset-cleanup) — "Settings are saved to settings.json beside the plugin manifest" |

**Key API available**:

`javascript
// Get user data directory path
const userDataPath = eagle.app.userDataPath;
// Or: await eagle.app.getPath('userData');

// Read/write settings using Node.js fs
const fs = require('fs');
const path = require('path');

const settingsPath = path.join(userDataPath, 'plugins', 'eagle-oppai-tagger', 'settings.json');

// Save settings
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

// Load settings
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
`

**Source**: [app API docs](https://developer.eagle.cool/plugin-api/api/app.md#getpathname), [Node.js Native API docs](https://developer.eagle.cool/plugin-api/tutorial/node-js-native-api.md)

---

## 4. Recommendation

### For EagleOppaiTagger: Use localStorage + JSON serialization

**Rationale:**

1. **localStorage is the de facto standard** in the Eagle plugin ecosystem — multiple production plugins use it successfully.
2. **Simplicity**: No need to manage file paths, handle write collisions, or concern about cross-platform path differences.
3. **Sandboxed**: Each plugin has its own localStorage origin, so there's no risk of key collision with other plugins.
4. **Sufficient capacity**: Settings (threshold, max tags, merge strategy, blacklist) are small strings/numbers — well within localStorage's 5-10MB limit.

**Implementation pattern:**

`javascript
const SETTINGS_KEY = 'eagle-oppai-tagger-settings';

const DEFAULT_SETTINGS = {
    threshold: 0.5,
    maxTags: 10,
    mergeStrategy: 'overwrite',
    blacklist: [],
    modelPath: '',
};

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
`

### When to consider file-based storage instead

- If settings grow large (e.g., cached model data > 5MB)
- If other tools/scripts need to read the settings outside the plugin
- If settings need to survive a browser storage clear

In that case, use agle.app.userDataPath + s.writeFileSync with a JSON file.

---

## 5. Conclusion

| Question | Answer |
|----------|--------|
| Does Eagle Plugin API have a config/persistence API? | **NO** |
| Is localStorage a viable fallback? | **YES** — it's the ecosystem standard |
| Is Node.js fs a viable alternative? | **YES** — agle.app.getPath('userData') provides the standard path |
| Should we switch if Eagle adds this API later? | **YES** — monitor changelog for future updates |

**ADR-7 resolution**: localStorage remains the correct choice for EagleOppaiTagger settings persistence. No Eagle-native config API exists to switch to.

---

## 6. References

- Eagle Plugin API docs root: https://developer.eagle.cool/plugin-api/
- app API (userDataPath, getPath): https://developer.eagle.cool/plugin-api/api/app.md
- Node.js Native API: https://developer.eagle.cool/plugin-api/tutorial/node-js-native-api.md
- manifest.json: https://developer.eagle.cool/plugin-api/tutorial/manifest.md
- Changelog: https://developer.eagle.cool/plugin-api/changelog.md
- Full docs corpus: https://developer.eagle.cool/plugin-api/llms-full.txt
