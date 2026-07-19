/**
 * src/phase2-test.js
 *
 * Verification script for Phase 2: inference.js + tags.js
 *
 * Tests:
 *   1. tags.js — mock CSV loading and probsToTags() logic
 *   2. inference.js — module structure and exported functions
 *   3. (optional) real inference if model.onnx is present
 *
 * Run: node src/phase2-test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

// --- Test 1: tags.js with mock CSV ---

async function testTags() {
  section("tags.js — mock CSV test");

  // Create a mock selected_tags.csv
  // Format: tag_id,name,category
  // Include: PAD(0), UNK(1), normal tags, and a tag with comma in name
  const mockCSV = [
    "tag_id,name,category",
    "0,<PAD>,0",
    "1,<UNK>,0",
    "2,1girl,4",
    "3,solo,4",
    "4,breasts, large,4",
    '5,"quoted, tag",3',
    "6,highres,1",
    "7,tag_seven,2",
    "8,tag_eight,2",
  ].join("\n");

  const tmpPath = path.join(__dirname, "..", ".tmp_test_tags.csv");
  fs.writeFileSync(tmpPath, mockCSV, "utf-8");

  // Point tags.js to our mock CSV
  process.env.OPPAI_TAGS_PATH = tmpPath;

  // Fresh require to pick up env var, reset cache
  const tags = require("./tags");
  tags._resetCache();

  // Test loadTags
  const loaded = tags.loadTags();
  assert(loaded[0] === "<PAD>", 'index 0 is <PAD>');
  assert(loaded[1] === "<UNK>", 'index 1 is <UNK>');
  assert(loaded[2] === "1girl", 'index 2 is "1girl"');
  assert(loaded[4] === "breasts, large", 'index 4 preserves comma in name');
  assert(loaded[5] === "quoted, tag", 'index 5 unquotes and preserves comma');
  assert(loaded[6] === "highres", 'index 6 is "highres"');

  // Create mock probabilities (8 tags = length 8)
  // PAD=0.0, UNK=0.0, 1girl=0.9, solo=0.7, "breasts, large"=0.3, quoted=0.1, highres=0.5, tag_seven=0.8, tag_eight=0.05
  const probs = new Float32Array([0.0, 0.0, 0.9, 0.7, 0.3, 0.1, 0.5, 0.8, 0.05]);

  // Test basic conversion
  let result = tags.probsToTags(probs, { threshold: 0.2, maxTags: 10 });
  assert(result.length === 5, `threshold=0.2 returns 5 tags (got ${result.length})`);
  assert(result[0] === "1girl", `highest prob tag is "1girl" (got "${result[0]}")`);
  assert(result[1] === "tag_seven", `second highest is "tag_seven" (got "${result[1]}")`);
  assert(result[2] === "solo", `third is "solo" (got "${result[2]}")`);
  assert(result[3] === "highres", `fourth is "highres" (got "${result[3]}")`);
  assert(result[4] === "breasts, large", `fifth is "breasts, large" (got "${result[4]}")`);

  // Test threshold filtering
  result = tags.probsToTags(probs, { threshold: 0.6, maxTags: 10 });
  assert(result.length === 3, `threshold=0.6 returns 3 tags (got ${result.length})`);
  assert(result.includes("1girl"), "includes 1girl (0.9)");
  assert(result.includes("tag_seven"), "includes tag_seven (0.8)");
  assert(result.includes("solo"), "includes solo (0.7)");

  // Test maxTags clamping
  result = tags.probsToTags(probs, { threshold: 0.01, maxTags: 2 });
  assert(result.length === 2, `maxTags=2 returns exactly 2 tags (got ${result.length})`);
  assert(result[0] === "1girl", "first is still highest prob");

  // Test blacklist
  const blacklist = new Set(["1girl", "solo"]);
  result = tags.probsToTags(probs, { threshold: 0.2, maxTags: 10, blacklist });
  assert(!result.includes("1girl"), "blacklisted 1girl excluded");
  assert(!result.includes("solo"), "blacklisted solo excluded");
  assert(result.length === 3, `with blacklist, 3 tags remain (got ${result.length})`);

  // Test PAD/UNK exclusion (even with high probs)
  const probsWithPadUnk = new Float32Array([0.99, 0.95, 0.5, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]);
  result = tags.probsToTags(probsWithPadUnk, { threshold: 0.01, maxTags: 100 });
  assert(!result.includes("<PAD>"), "PAD excluded from output");
  assert(!result.includes("<UNK>"), "UNK excluded from output");

  // Cleanup
  delete process.env.OPPAI_TAGS_PATH;
  try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }

  console.log("\n  tags.js: all mock CSV tests done");
}

// --- Test 2: inference.js module structure ---

async function testInferenceModule() {
  section("inference.js — module structure");

  const inference = require("./inference");

  assert(typeof inference.infer === "function", "exports infer function");
  assert(typeof inference.getSession === "function", "exports getSession function");
  assert(typeof inference.MODEL_PATH === "string", "exports MODEL_PATH string");
  assert(
    inference.MODEL_PATH.endsWith(path.join("models", "V1.1", "model.onnx")),
    "MODEL_PATH points to models/V1.1/model.onnx"
  );

  // Verify infer function signature (doesn't run without model)
  assert(inference.infer.length === 1, "infer takes 1 argument");
}

// --- Test 3: real inference (if model present) ---

async function testRealInference() {
  section("Real inference test (optional)");

  const inference = require("./inference");
  const modelExists = fs.existsSync(inference.MODEL_PATH);

  if (!modelExists) {
    console.log(`  SKIP: model not found at ${inference.MODEL_PATH}`);
    console.log("  (Download from https://huggingface.co/Grio43/OppaiOracle/tree/main/V1.1_onnx)");
    return;
  }

  console.log("  Model found — running inference test...");

  // Try to find a sample image to preprocess
  const { preprocess } = require("./preprocess");
  const sampleDir = path.join(__dirname, "..", "test-images");
  let sampleImage = null;

  if (fs.existsSync(sampleDir)) {
    const files = fs.readdirSync(sampleDir).filter((f) =>
      /\.(png|jpg|jpeg|bmp|webp)$/i.test(f)
    );
    if (files.length > 0) {
      sampleImage = path.join(sampleDir, files[0]);
    }
  }

  if (!sampleImage) {
    console.log("  SKIP: no sample image found in test-images/");
    return;
  }

  console.log(`  Using sample: ${sampleImage}`);

  // Preprocess
  const preprocessed = await preprocess(sampleImage);
  console.log(`  Preprocessed: pixel_values=${preprocessed.pixel_values.length}, padding_mask=${preprocessed.padding_mask.length}`);

  // Run inference
  const probs = await inference.infer(preprocessed);
  assert(probs instanceof Float32Array, "output is Float32Array");
  assert(probs.length === 19294, `output length is 19294 (got ${probs.length})`);

  // Verify sigmoid range [0, 1]
  let minP = 1, maxP = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] < minP) minP = probs[i];
    if (probs[i] > maxP) maxP = probs[i];
  }
  assert(minP >= 0 && maxP <= 1, `probabilities in [0,1] range (min=${minP.toFixed(6)}, max=${maxP.toFixed(6)})`);

  // Show top 10 tags if tags CSV exists
  const tagsPath = path.join(path.dirname(inference.MODEL_PATH), "selected_tags.csv");
  if (fs.existsSync(tagsPath)) {
    process.env.OPPAI_TAGS_PATH = tagsPath;
    const tagMod = require("./tags");
    tagMod._resetCache();
    const topTags = tagMod.probsToTags(probs, { threshold: 0.1, maxTags: 10 });
    console.log("\n  Top tags (threshold=0.1):");
    topTags.forEach((t, i) => {
      // Find the probability for this tag
      const loaded = tagMod.loadTags();
      const idx = loaded.indexOf(t);
      const p = idx >= 0 ? probs[idx] : "?";
      console.log(`    ${i + 1}. ${t} (${typeof p === "number" ? p.toFixed(4) : p})`);
    });
    delete process.env.OPPAI_TAGS_PATH;
  }
}

// --- Main ---

async function main() {
  console.log("Phase 2 Verification — inference.js + tags.js");
  console.log("==============================================");

  try {
    await testTags();
    await testInferenceModule();
    await testRealInference();
  } catch (err) {
    console.error(`\nFATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
  }

  console.log("\n==============================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
