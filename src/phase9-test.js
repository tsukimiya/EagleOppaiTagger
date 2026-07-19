/**
 * src/phase9-test.js
 *
 * Phase 9a E2E integration test.
 * モック HTTP サーバを立てて inferRemote / checkHealth の実通信を検証。
 * さらに inferDispatch のサーバ経由パスを実サーバで統合テスト。
 *
 * Run with: node src/phase9-test.js
 */
"use strict";

const assert = require("assert");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { console.log("  PASS: " + msg); passed++; }
  else { console.error("  FAIL: " + msg); failed++; }
}

// -----------------------------------------------------------------------------
// Mock server
// -----------------------------------------------------------------------------

function createMockServer() {
  return http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        image_size: 448,
        num_tags: 19294,
        providers: ["CPUExecutionProvider"],
        model_loaded: true,
      }));
    } else if (req.method === "GET" && req.url === "/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        image_size: 448,
        num_tags: 19294,
        providers: ["CPUExecutionProvider"],
      }));
    } else if (req.method === "POST" && req.url === "/infer") {
      let body = [];
      req.on("data", chunk => body.push(chunk));
      req.on("end", () => {
        const buf = Buffer.concat(body);
        const content = buf.toString("binary");
        if (content.includes("bad_image")) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Invalid image" }));
          return;
        }
        const probs = new Array(19294).fill(0).map((_, i) => Math.random() * 0.1);
        probs[2] = 0.95;
        probs[3] = 0.88;
        probs[10] = 0.72;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          probabilities: probs,
          num_classes: 19294,
          elapsed_ms: 12.5,
          model_info: { image_size: 448 },
        }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

// -----------------------------------------------------------------------------
// Mock modules for inferDispatch integration
// -----------------------------------------------------------------------------

const MOCK_LOCAL_PROBS = new Float32Array(19294).fill(0.01);
MOCK_LOCAL_PROBS[100] = 0.99;

// Mock preprocess
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

// Mock inference
const inferencePath = path.resolve(__dirname, "inference.js");
require.cache[inferencePath] = {
  id: inferencePath,
  filename: inferencePath,
  loaded: true,
  exports: {
    infer: async (_preprocessed) => MOCK_LOCAL_PROBS,
    getSession: async () => ({}),
    MODEL_PATH: "mock_model.onnx",
  },
};

// Mock onnxruntime-node
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

// Mock eagle-bridge
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
// Helper: create temp image using Jimp
// -----------------------------------------------------------------------------

async function createTestImage(dir, name, width, height, color) {
  const Jimp = require("jimp");
  const filePath = path.join(dir, name);
  await new Promise((resolve, reject) => {
    new Jimp(width, height, color, (err, img) => {
      if (err) return reject(err);
      img.write(filePath, () => resolve());
    });
  });
  return filePath;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

async function testE2E() {
  console.log("\n=== Phase 9a: E2E integration test ===\n");

  // --- Start mock server ---
  const server = createMockServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const serverUrl = `http://127.0.0.1:${port}`;
  console.log(`  Mock server on ${serverUrl}`);

  // --- Create temp images ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase9-"));
  const testImage = await createTestImage(tmpDir, "test.png", 100, 100, 0xFF0000FF);
  const badImage = await createTestImage(tmpDir, "bad_image.png", 50, 50, 0x00FF00FF);

  const { inferRemote, checkHealth } = require("./inference-client");

  // --- Test 1: checkHealth ---
  console.log("\n--- checkHealth: ok ---");
  const health = await checkHealth(serverUrl);
  ok(health.ok === true, "checkHealth returns ok=true");
  ok(health.info.image_size === 448, "checkHealth returns image_size=448");
  ok(health.info.num_tags === 19294, "checkHealth returns num_tags=19294");
  ok(health.info.model_loaded === true, "checkHealth returns model_loaded=true");

  // --- Test 2: inferRemote success ---
  console.log("\n--- inferRemote: success ---");
  const probs = await inferRemote(testImage, { serverUrl, timeoutMs: 5000 });
  ok(probs instanceof Float32Array, "inferRemote returns Float32Array");
  ok(probs.length === 19294, "inferRemote returns 19294 probabilities");
  ok(probs[2] > 0.9, "inferRemote: tag index 2 has high probability (>0.9)");
  ok(probs[3] > 0.8, "inferRemote: tag index 3 has high probability (>0.8)");

  // --- Test 3: inferRemote 400 error ---
  console.log("\n--- inferRemote: 400 error ---");
  let threw = false;
  try {
    await inferRemote(badImage, { serverUrl, timeoutMs: 5000 });
  } catch (e) {
    threw = true;
    ok(e.message.includes("400"), "inferRemote throws on 400 with status in message");
  }
  ok(threw, "inferRemote throws on server 400 error");

  // --- Test 4: checkHealth unreachable ---
  console.log("\n--- checkHealth: unreachable ---");
  const unreachable = await checkHealth("http://127.0.0.1:1", 1000);
  ok(unreachable.ok === false, "checkHealth returns ok=false for unreachable server");
  ok(typeof unreachable.error === "string", "checkHealth returns error string");

  // --- Test 5: inferRemote timeout ---
  console.log("\n--- inferRemote: timeout ---");
  const slowServer = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ probabilities: new Array(19294).fill(0), num_classes: 19294 }));
    }, 5000);
  });
  await new Promise(resolve => slowServer.listen(0, "127.0.0.1", resolve));
  const slowUrl = `http://127.0.0.1:${slowServer.address().port}`;
  let timeoutThrew = false;
  try {
    await inferRemote(testImage, { serverUrl: slowUrl, timeoutMs: 500 });
  } catch (e) {
    timeoutThrew = true;
  }
  ok(timeoutThrew, "inferRemote throws on timeout");
  slowServer.close();

  // --- Test 6: inferDispatch server mode (integration) ---
  console.log("\n--- inferDispatch: server mode (real mock server) ---");
  const mainPath = path.resolve(__dirname, "main.js");
  delete require.cache[mainPath];
  const { inferDispatch } = require("./main");

  const serverResult = await inferDispatch(
    { filePath: testImage },
    { useServer: true, serverUrl, serverTimeoutMs: 5000, fallbackOnError: true }
  );
  ok(serverResult.source === "server", "inferDispatch routes to server → source='server'");
  ok(serverResult.probs instanceof Float32Array, "inferDispatch returns Float32Array from server");
  ok(serverResult.probs.length === 19294, "inferDispatch returns 19294 probs from server");
  ok(serverResult.probs[2] > 0.9, "inferDispatch: server probs[2] > 0.9");

  // --- Test 7: inferDispatch fallback mode (server error → local) ---
  console.log("\n--- inferDispatch: fallback on server error ---");
  const fallbackResult = await inferDispatch(
    { filePath: badImage },
    { useServer: true, serverUrl, serverTimeoutMs: 5000, fallbackOnError: true }
  );
  ok(fallbackResult.source === "fallback", "inferDispatch falls back → source='fallback'");
  ok(fallbackResult.probs instanceof Float32Array, "fallback returns Float32Array from local mock");
  ok(fallbackResult.probs[100] > 0.9, "fallback uses local mock probs (index 100 high)");

  // --- Test 8: inferDispatch local mode (no server) ---
  console.log("\n--- inferDispatch: local only ---");
  const localResult = await inferDispatch(
    { filePath: testImage },
    { useServer: false, serverUrl: "", serverTimeoutMs: 5000, fallbackOnError: true }
  );
  ok(localResult.source === "local", "inferDispatch local-only → source='local'");
  ok(localResult.probs instanceof Float32Array, "local returns Float32Array");

  // --- Cleanup ---
  server.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  console.log(`\n  Phase 9a: ${passed} passed, ${failed} failed`);
}

testE2E().then(() => {
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
