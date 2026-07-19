/**
 * src/phase8-test.js
 *
 * Unit tests for Phase 8: server inference client & routing.
 * All network calls are mocked via global fetch override.
 *
 * Run with: node src/phase8-test.js
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

let passed = 0;
let failed = 0;

function ok(condition, msg) {
  if (condition) {
    console.log("  PASS: " + msg);
    passed++;
  } else {
    console.error("  FAIL: " + msg);
    failed++;
  }
}

function section(name) {
  console.log("\n=== " + name + " ===");
}

// -----------------------------------------------------------------------------
// Mock setup: preprocess + inference (for inferDispatch fallback tests)
// -----------------------------------------------------------------------------

const MOCK_PROBS = new Float32Array(19294).fill(0.01);
MOCK_PROBS[100] = 0.99; // one high-prob tag

// Mock preprocess module
const preprocessPath = path.resolve(__dirname, "preprocess.js");
require.cache[preprocessPath] = {
  id: preprocessPath,
  filename: preprocessPath,
  loaded: true,
  exports: {
    preprocess: async (_filePath) => ({
      pixel_values: new Float32Array(3 * 448 * 448),
      padding_mask: new Uint8Array(448 * 448),
    }),
  },
};

// Mock inference module
const inferencePath = path.resolve(__dirname, "inference.js");
require.cache[inferencePath] = {
  id: inferencePath,
  filename: inferencePath,
  loaded: true,
  exports: {
    infer: async (_preprocessed) => MOCK_PROBS,
    getSession: async () => ({}),
    MODEL_PATH: "mock_model.onnx",
  },
};

// Mock onnxruntime-node to prevent real loading
const ortPath = require.resolve("onnxruntime-node");
require.cache[ortPath] = {
  id: ortPath,
  filename: ortPath,
  loaded: true,
  exports: {
    InferenceSession: { create: async () => ({ run: async () => ({}) }) },
    Tensor: class MockTensor {
      constructor(type, data, dims) {
        this.type = type;
        this.data = data;
        this.dims = dims;
      }
    },
  },
};

// Mock eagle-bridge to prevent Eagle dependency
const eagleBridgePath = path.resolve(__dirname, "eagle-bridge.js");
require.cache[eagleBridgePath] = {
  id: eagleBridgePath,
  filename: eagleBridgePath,
  loaded: true,
  exports: {
    getSelectedItems: async () => [],
    saveItem: async () => {},
  },
};

// -----------------------------------------------------------------------------
// Fetch mock infrastructure
// -----------------------------------------------------------------------------

let fetchMock = null;
const originalFetch = globalThis.fetch;

function setFetchMock(fn) {
  fetchMock = fn;
  globalThis.fetch = fn;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
  fetchMock = null;
}

// -----------------------------------------------------------------------------
// Create a temp image file for inferRemote tests
// -----------------------------------------------------------------------------

function createTempImage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eagle-oppai-phase8-"));
  const filePath = path.join(dir, "test.png");
  fs.writeFileSync(filePath, Buffer.from("FAKE_IMAGE_DATA_FOR_TESTING"));
  return { dir, filePath };
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_e) { /* ignore */ }
}

// -----------------------------------------------------------------------------
// Tests: inferRemote + checkHealth
// -----------------------------------------------------------------------------

async function testInferRemoteSuccess() {
  section("inferRemote — success");

  const { inferRemote } = require("./inference-client");
  const { dir, filePath } = createTempImage();

  const mockProbs = new Array(19294).fill(0).map((_, i) => i === 42 ? 0.95 : 0.01);

  setFetchMock(async (url, opts) => {
    ok(url.endsWith("/infer"), "fetch URL ends with /infer");
    ok(opts.method === "POST", "method is POST");
    ok(opts.headers["Content-Type"].includes("multipart/form-data"), "content-type is multipart");
    return {
      ok: true,
      status: 200,
      json: async () => ({ probabilities: mockProbs, num_classes: 19294, elapsed_ms: 50 }),
      text: async () => "",
    };
  });

  try {
    const result = await inferRemote(filePath, { serverUrl: "http://localhost:8765", timeoutMs: 5000 });
    ok(result instanceof Float32Array, "returns Float32Array");
    ok(result.length === 19294, "length is 19294");
    ok(Math.abs(result[42] - 0.95) < 0.001, "probabilities[42] ≈ 0.95");
  } catch (err) {
    ok(false, "unexpected error: " + err.message);
  }

  restoreFetch();
  cleanupDir(dir);
}

async function testInferRemoteServerError() {
  section("inferRemote — server error (500)");

  const { inferRemote } = require("./inference-client");
  const { dir, filePath } = createTempImage();

  setFetchMock(async () => ({
    ok: false,
    status: 500,
    text: async () => "Internal Server Error",
  }));

  try {
    await inferRemote(filePath, { serverUrl: "http://localhost:8765", timeoutMs: 5000 });
    ok(false, "should have thrown on 500");
  } catch (err) {
    ok(err.message.includes("500"), "error message includes status code 500");
  }

  restoreFetch();
  cleanupDir(dir);
}

async function testInferRemoteTimeout() {
  section("inferRemote — timeout");

  const { inferRemote } = require("./inference-client");
  const { dir, filePath } = createTempImage();

  setFetchMock(async (_url, opts) => {
    // Simulate a long-running request that respects abort signal
    return new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  });

  try {
    await inferRemote(filePath, { serverUrl: "http://localhost:8765", timeoutMs: 100 });
    ok(false, "should have thrown on timeout");
  } catch (err) {
    ok(err.name === "AbortError" || err.message.includes("abort"), "error is an abort error");
  }

  restoreFetch();
  cleanupDir(dir);
}

async function testCheckHealthOk() {
  section("checkHealth — ok");

  const { checkHealth } = require("./inference-client");

  setFetchMock(async (url) => {
    ok(url.endsWith("/health"), "fetch URL ends with /health");
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", model_info: { model_name: "OppaiOracle V1.1" } }),
    };
  });

  const result = await checkHealth("http://localhost:8765");
  ok(result.ok === true, "result.ok is true");
  ok(result.info && result.info.status === "ok", "info.status is 'ok'");
  ok(result.info && result.info.model_info.model_name === "OppaiOracle V1.1", "model_info included");

  restoreFetch();
}

async function testCheckHealthConnectionRefused() {
  section("checkHealth — connection refused");

  const { checkHealth } = require("./inference-client");

  setFetchMock(async () => {
    throw new Error("ECONNREFUSED");
  });

  const result = await checkHealth("http://localhost:9999");
  ok(result.ok === false, "result.ok is false");
  ok(typeof result.error === "string", "result.error is a string");
  ok(result.error.includes("ECONNREFUSED"), "error mentions ECONNREFUSED");

  restoreFetch();
}

// -----------------------------------------------------------------------------
// Tests: inferDispatch routing
// -----------------------------------------------------------------------------

async function testDispatchServerOk() {
  section("inferDispatch — useServer=true, server OK → source='server'");

  // Clear main.js cache to ensure fresh load with our mocks
  const mainPath = path.resolve(__dirname, "main.js");
  delete require.cache[mainPath];
  const { inferDispatch } = require("./main");

  const mockProbs = new Array(19294).fill(0).map(() => 0.05);
  setFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ probabilities: mockProbs, num_classes: 19294, elapsed_ms: 30 }),
  }));

  const { dir, filePath } = createTempImage();
  const settings = {
    useServer: true,
    serverUrl: "http://localhost:8765",
    serverTimeoutMs: 5000,
    fallbackOnError: true,
  };

  const result = await inferDispatch({ filePath }, settings);
  ok(result.source === "server", "source is 'server'");
  ok(result.probs instanceof Float32Array, "probs is Float32Array");
  ok(result.probs.length === 19294, "probs length is 19294");

  restoreFetch();
  cleanupDir(dir);
}

async function testDispatchServerFailFallback() {
  section("inferDispatch — useServer=true, server NG, fallback=true → source='fallback'");

  const mainPath = path.resolve(__dirname, "main.js");
  delete require.cache[mainPath];
  const { inferDispatch } = require("./main");

  setFetchMock(async () => ({
    ok: false,
    status: 500,
    text: async () => "Server Error",
  }));

  const { dir, filePath } = createTempImage();
  const settings = {
    useServer: true,
    serverUrl: "http://localhost:8765",
    serverTimeoutMs: 5000,
    fallbackOnError: true,
  };

  const result = await inferDispatch({ filePath }, settings);
  ok(result.source === "fallback", "source is 'fallback'");
  ok(result.probs instanceof Float32Array, "probs is Float32Array (from local mock)");

  restoreFetch();
  cleanupDir(dir);
}

async function testDispatchServerFailNoFallback() {
  section("inferDispatch — useServer=true, server NG, fallback=false → throws");

  const mainPath = path.resolve(__dirname, "main.js");
  delete require.cache[mainPath];
  const { inferDispatch } = require("./main");

  setFetchMock(async () => ({
    ok: false,
    status: 503,
    text: async () => "Service Unavailable",
  }));

  const { dir, filePath } = createTempImage();
  const settings = {
    useServer: true,
    serverUrl: "http://localhost:8765",
    serverTimeoutMs: 5000,
    fallbackOnError: false,
  };

  try {
    await inferDispatch({ filePath }, settings);
    ok(false, "should have thrown when server fails and fallback=false");
  } catch (err) {
    ok(err.message.includes("503"), "error message includes status 503");
  }

  restoreFetch();
  cleanupDir(dir);
}

async function testDispatchLocalOnly() {
  section("inferDispatch — useServer=false → source='local'");

  const mainPath = path.resolve(__dirname, "main.js");
  delete require.cache[mainPath];
  const { inferDispatch } = require("./main");

  let fetchCalled = false;
  setFetchMock(async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({}) };
  });

  const { dir, filePath } = createTempImage();
  const settings = {
    useServer: false,
    serverUrl: "",
    serverTimeoutMs: 10000,
    fallbackOnError: true,
  };

  const result = await inferDispatch({ filePath }, settings);
  ok(result.source === "local", "source is 'local'");
  ok(!fetchCalled, "fetch was NOT called (server not used)");
  ok(result.probs instanceof Float32Array, "probs is Float32Array (from local mock)");

  restoreFetch();
  cleanupDir(dir);
}

// -----------------------------------------------------------------------------
// Tests: settings DEFAULTS
// -----------------------------------------------------------------------------

function testSettingsDefaults() {
  section("settings — Phase 8 DEFAULTS");

  const { DEFAULTS } = require("./settings");
  ok("useServer" in DEFAULTS, "DEFAULTS has useServer");
  ok(DEFAULTS.useServer === false, "useServer defaults to false");
  ok("serverUrl" in DEFAULTS, "DEFAULTS has serverUrl");
  ok(DEFAULTS.serverUrl === "", "serverUrl defaults to empty string");
  ok("serverTimeoutMs" in DEFAULTS, "DEFAULTS has serverTimeoutMs");
  ok(DEFAULTS.serverTimeoutMs === 10000, "serverTimeoutMs defaults to 10000");
  ok("fallbackOnError" in DEFAULTS, "DEFAULTS has fallbackOnError");
  ok(DEFAULTS.fallbackOnError === true, "fallbackOnError defaults to true");

  // Verify existing defaults are preserved
  ok(DEFAULTS.threshold === 0.5, "threshold still 0.5");
  ok(DEFAULTS.maxTags === 30, "maxTags still 30");
  ok(DEFAULTS.mergeStrategy === "append", "mergeStrategy still 'append'");
  ok(Array.isArray(DEFAULTS.blacklist), "blacklist still an array");
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

(async function main() {
  console.log("Phase 8 Verification — Server inference client & routing");
  console.log("==========================================================");

  try {
    testSettingsDefaults();
    await testInferRemoteSuccess();
    await testInferRemoteServerError();
    await testInferRemoteTimeout();
    await testCheckHealthOk();
    await testCheckHealthConnectionRefused();
    await testDispatchServerOk();
    await testDispatchServerFailFallback();
    await testDispatchServerFailNoFallback();
    await testDispatchLocalOnly();
  } catch (err) {
    console.error("\nFATAL ERROR: " + err.message);
    console.error(err.stack);
    failed++;
  }

  console.log("\n==========================================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
})();
