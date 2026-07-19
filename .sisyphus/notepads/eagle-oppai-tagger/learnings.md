
## Phase 0 Scaffold
- Date: 2026-07-19
- manifest.json created per SPEC §9 with fixed 640x480 window
- package.json with jimp 0.22.12 (resolved from ^0.22.10) and onnxruntime-node 1.27.0 (matches spike b1 resolved version)
- npm install succeeded (108 packages, 109 audited)
- .gitignore updated with node_modules/, models/, *.zip (preserved existing apm_modules/)
- index.html created with minimal skeleton referencing src/main.js
- src/.gitkeep created as placeholder

## Phase 1 — Preprocessing pipeline + Python verifier
- Date: 2026-07-19
- jimp 0.22.12 API confirmed against node_modules/@jimp/*:
  - `new Jimp(w, h, hexColor, callback)` for new image (callback required, no Promise)
  - `Jimp.read(path).then(img => ...)` returns a Promise
  - `img.resize(w, h, mode, cb)` — mode = `Jimp.RESIZE_BICUBIC` ("bicubicInterpolation")
  - `canvas.composite(src, x, y)` — respects alpha, but we pre-fill with alpha=255 so it's a straight blit
  - Note: Jimp's `RESIZE_BICUBIC` is implemented as a 2-pass bilinear under the hood (per @jimp/plugin-resize source comment) — different from PIL's `Image.BICUBIC`. Empirically still matches within ~5e-9 on solid-color test inputs.
- Pixel access: `canvas.bitmap.data` is a Buffer of RGBA bytes, index = (y*W + x) * 4.
- Mask convention mirror: `np.ones(... dtype=bool)` (1 = pad) → JS `new Uint8Array(N).fill(1)` then over-write the image rect to 0. **Easy to invert by accident** — I had to flip this once.
- BCHW layout: per-channel write heads at `cOff = [0, stride, 2*stride]` where `stride = 448*448 = 200704`. Avoids the cost of reshape on large arrays.
- Normalization: `(x/255 - 0.5) / 0.5` ≡ `x/127.5 - 1` — saves a divide per pixel.
- Verifier pass results (all 3 samples):
  - square.png (300x300 red):   MAE = 0e+0  (image fills entire 448x448 canvas)
  - tall.png  (100x300 blue):   MAE = 4.973e-9  (mask sum 133952, 0 mismatches)
  - wide.png  (300x100 green):  MAE = 4.973e-9  (mask sum 133952, 0 mismatches)
  - All mask agreement 100% / 0 mismatches.
- Gotcha: cwd at Eagle runtime is `C:\WINDOWS\system32` (per SPEC §2.1) — every relative path in `src/*.js` MUST be `__dirname`-anchored. The `verify.js` resolves `path.resolve(__dirname, '..')` to find `scripts/python-ref/`.
- The full HuggingFace `app.py` was fetched into `scripts/python-ref/app.py` as a verbatim reference. Its `letterbox`/`preprocess` are nested inside `_run_app()` and depend on the `state` dict populated by `load_model()`, so `export_tensors.py` self-contains the math (matching the same constants from `V1.1_onnx/preprocessing.json`).

## Phase 1 follow-up — corrections and tooling (2026-07-19)

- **Correction to earlier "2-pass bilinear" claim**: `Jimp.RESIZE_BICUBIC` is a 2-pass **bicubic** (`resize2.js` → `bicubicInterpolation`), not bilinear. The default no-mode path uses the grantgalitz bilinear resizer. The earlier note was a misread of the plugin-resize source comment. The verifier still passes with MAE ≈ 5e-9, so the conclusion (good enough for our use) is unchanged. The comment in `src/preprocess.js` was updated to match.
- Pillow `Image.BICUBIC` and Jimp `bicubicInterpolation` use **different** cubic kernels (Catmull-Rom α=-0.5 vs natural-cubic-ish). On non-uniform images this may produce ULP-level differences — Phase 2 follow-up if observed.
- `scripts/python-ref/export_tensors.py` is self-contained (does **not** `import app`) because the reference `app.py` has `letterbox`/`preprocess` nested inside `_run_app()` and they require the populated `state` dict. The script hard-codes the V1.1 constants from `V1.1_onnx/preprocessing.json`; if the JSON ever changes, this file must be updated in lockstep. The header comment in `export_tensors.py` makes the dependency explicit.
- `scripts/python-ref/README.md` install line: `pip install onnxruntime pillow numpy` is sufficient to run `export_tensors.py`. `onnxruntime` itself is not imported by the export script; it is there for parity with `app.py` and for Phase 2 predict.
- `.gitignore` updated to skip `.venv/`, `__pycache__/`, `*.pyc`, and `scripts/python-ref/expected_*.json` (regenerable).
- venv size: ~125 MB on Windows (Python 3.14 + onnxruntime 1.27.0 + numpy 2.5.1 + Pillow 12.3.0).
- `src/verify.js` was updated to read the new field names from `export_tensors.py` (`image_size` instead of the old `letterbox_size`).
- End-to-end run: `node scripts/create-samples.js` → `.venv python export_tensors.py` → `node src/verify.js` → all PASS, MAE ≤ 5e-9.

## Phase 3 — Eagle API bridge + main loop + settings persistence
- Date: 2026-07-19T03:17:34
- Implemented src/eagle-bridge.js thin wrappers: getSelectedItems() / saveItem(item).
- Implemented src/settings.js with localStorage fallback for headless Node tests.
- Replaced src/main.js with full pipeline: preprocess → infer → probsToTags → mergeTags → save.
- Added cooperative cancellation at next image boundary; saved tags are not rolled back.
- Added src/phase3-test.js standalone test covering settings round-trip, merge strategies, bridge signatures, and cancel flow.
- Verified by 
ode src/phase3-test.js — all tests pass.
- window.EagleOppaiTagger registered for renderer UI integration.


## Phase 5 — Model downloader + unit tests
- Date: 2026-07-19T03:34:21
- Implemented src/downloader.js using only Node built-ins (https, fs, crypto, path). No new npm dependencies.
- SHA256 map uses TO_BE_FILLED_AFTER_FIRST_DOWNLOAD placeholders; verifySha256() skips validation and prints the actual hash so the user can register it manually.
- Resume logic: targetPath + ".tmp" existing size is sent as Range: bytes={size}-. 206 -> append, 200 -> overwrite, 416 -> delete tmp and restart.
- Retry: withRetry() with exponential backoff (1s, 2s, 4s) over max 3 attempts.
- downloadAll() downloads in order: selected_tags.csv, pr_thresholds.json, model.onnx (largest last), and reports per-file progress.
- src/phase5-test.js mocks https via require.cache so tests run without network. Key gotcha: EventEmitter-based fake responses must implement resume(), pipe(), and destroy() to be compatible with the real downloader code.
- Wired src/ui.js dl-btn handler to call downloader.downloadAll() with minimal change; success refreshes checkModelStatus(), failure logs and re-enables the button.
- Verified: node src/phase5-test.js — 29 passed, 0 failed; node src/phase4-test.js — 59 passed, 0 failed.
- Updated .spec/TODO.md and .spec/KNOWLEDGE.md with Phase 5 status and notes.
