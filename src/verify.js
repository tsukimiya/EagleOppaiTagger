/**
 * src/verify.js
 *
 * Cross-validates `src/preprocess.js` (JS) against the Python reference
 * implementation in `scripts/python-ref/app.py` (exported via
 * `export_tensors.py` into `expected_*.json`).
 *
 * Procedure:
 *   1. For each of the 3 sample images, run JS `preprocess()`.
 *   2. Load the matching `expected_<name>.json` produced by Python.
 *   3. Compute:
 *        - pixel_values MAE (mean absolute error) — must be < 1e-4
 *        - padding_mask agreement (matching pixels / total)
 *   4. Report PASS/FAIL per image and overall.
 *
 * Exit code:
 *   0  all samples PASS
 *   1  any sample FAIL
 *
 * Usage:
 *   node src/verify.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { preprocess } = require("./preprocess.js");

// --- Configuration ---

const SAMPLES = [
  { name: "square", expectedFile: "expected_square.json", sampleFile: "square.png" },
  { name: "tall",   expectedFile: "expected_tall.json",   sampleFile: "tall.png"   },
  { name: "wide",   expectedFile: "expected_wide.json",   sampleFile: "wide.png"   },
];

// Pass criterion: SPEC §7.1 / §12  — "平均誤差 < 1e-4 (Float32 の丸め以内)"
const PASS_THRESHOLD = 1e-4;

const ROOT = path.resolve(__dirname, "..");
const PYTHON_REF_DIR = path.join(ROOT, "scripts", "python-ref");
const SAMPLES_DIR = path.join(PYTHON_REF_DIR, "samples");

// --- Helpers ---

/**
 * Compute mean absolute error between two equal-length numeric arrays.
 * The Python side stores values as native JS number (float64), but the
 * underlying data is float32. We compare as float32 to be fair.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} mean abs error
 */
function meanAbsError(a, b) {
  if (a.length !== b.length) {
    throw new Error(`length mismatch: ${a.length} vs ${b.length}`);
  }
  // Cast both to float32 view to match the upstream precision contract.
  const fa = a instanceof Float32Array ? a : Float32Array.from(a);
  const fb = b instanceof Float32Array ? b : Float32Array.from(b);
  let sum = 0;
  for (let i = 0; i < fa.length; i++) {
    const d = fa[i] - fb[i];
    sum += d < 0 ? -d : d;
  }
  return sum / fa.length;
}

/**
 * Compute agreement between two equal-length 0/1 arrays.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {{ agreement: number, mismatches: number }}
 */
function maskAgreement(a, b) {
  if (a.length !== b.length) {
    throw new Error(`length mismatch: ${a.length} vs ${b.length}`);
  }
  let match = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) match++;
  }
  return { agreement: match / a.length, mismatches: a.length - match };
}

/**
 * Load a JSON file produced by `export_tensors.py`.
 *
 * @param {string} filePath
 * @returns {{ pixel_values: Float32Array, padding_mask: Uint8Array, name: string, input_size: number[], letterbox_size: number[] }}
 */
function loadExpected(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (!Array.isArray(raw.pixel_values) || !Array.isArray(raw.padding_mask)) {
    throw new Error(
      `expected_<...>.json missing 'pixel_values' or 'padding_mask' field: ${filePath}`
    );
  }
  return {
    name: raw.name,
    input_size: raw.input_size,
    image_size: raw.image_size,
    pad_color: raw.pad_color,
    mean: raw.mean,
    std: raw.std,
    pixel_values: Float32Array.from(raw.pixel_values),
    padding_mask: Uint8Array.from(raw.padding_mask),
  };
}

// --- Main ---

async function main() {
  console.log("src/verify.js — JS vs Python preprocessing cross-check");
  console.log("PASS threshold: mean abs error < " + PASS_THRESHOLD);
  console.log("");

  let allPass = true;
  const results = [];

  for (const sample of SAMPLES) {
    const expectedPath = path.join(PYTHON_REF_DIR, sample.expectedFile);
    const samplePath = path.join(SAMPLES_DIR, sample.sampleFile);

    if (!fs.existsSync(expectedPath)) {
      console.error(`[${sample.name}] MISSING expected file: ${expectedPath}`);
      console.error(`         Run \`python export_tensors.py\` in scripts/python-ref/ first.`);
      allPass = false;
      results.push({ name: sample.name, status: "FAIL", reason: "no expected" });
      continue;
    }
    if (!fs.existsSync(samplePath)) {
      console.error(`[${sample.name}] MISSING sample image: ${samplePath}`);
      console.error(`         Run \`node scripts/python-ref/create_samples.js\` first.`);
      allPass = false;
      results.push({ name: sample.name, status: "FAIL", reason: "no sample" });
      continue;
    }

    const expected = loadExpected(expectedPath);
    const got = await preprocess(samplePath);

    // Length checks (defensive)
    if (got.pixel_values.length !== expected.pixel_values.length) {
      console.error(
        `[${sample.name}] pixel_values length mismatch: got ${got.pixel_values.length}, expected ${expected.pixel_values.length}`
      );
      allPass = false;
      results.push({ name: sample.name, status: "FAIL", reason: "len mismatch" });
      continue;
    }
    if (got.padding_mask.length !== expected.padding_mask.length) {
      console.error(
        `[${sample.name}] padding_mask length mismatch: got ${got.padding_mask.length}, expected ${expected.padding_mask.length}`
      );
      allPass = false;
      results.push({ name: sample.name, status: "FAIL", reason: "mask len mismatch" });
      continue;
    }

    const mae = meanAbsError(got.pixel_values, expected.pixel_values);
    const maskInfo = maskAgreement(got.padding_mask, expected.padding_mask);

    const pixelPass = mae < PASS_THRESHOLD;
    const maskPass = maskInfo.mismatches === 0; // exact agreement required for mask
    const pass = pixelPass && maskPass;
    if (!pass) allPass = false;

    const status = pass ? "PASS" : "FAIL";
    console.log(
      `[${sample.name.padEnd(6)}] ${status}` +
      `  pixel_values MAE = ${mae.toExponential(3)}` +
      `  mask agreement = ${(maskInfo.agreement * 100).toFixed(4)}%` +
      `  (mismatches = ${maskInfo.mismatches})`
    );

    results.push({
      name: sample.name,
      status,
      mae,
      maskAgreement: maskInfo.agreement,
      maskMismatches: maskInfo.mismatches,
    });
  }

  console.log("");
  if (allPass) {
    console.log("ALL PASS — preprocessing matches the Python reference within 1e-4.");
    process.exit(0);
  } else {
    console.log("FAIL — see per-sample lines above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify.js crashed:", err);
  process.exit(1);
});
