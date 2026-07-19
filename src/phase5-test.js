/**
 * src/phase5-test.js
 *
 * Unit tests for Phase 5: model downloader.
 * No network access — all HTTPS calls are mocked.
 *
 * Run with: node src/phase5-test.js
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { EventEmitter } = require("events");

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "eagle-oppai-tagger-phase5-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_e) {}
}

// -----------------------------------------------------------------------------
// Fake HTTPS module
// -----------------------------------------------------------------------------

const fakeHttps = {
  _calls: [],
  _handlers: [],
  reset() {
    this._calls = [];
    this._handlers = [];
  },
  setHandler(fn) {
    this._handlers.push(fn);
  },
  get(options, callback) {
    this._calls.push(options);
    const handler = this._handlers.shift();
    if (!handler) {
      const req = new EventEmitter();
      const res = new EventEmitter();
      res.statusCode = 404;
      res.headers = {};
      res.resume = () => {};
      setTimeout(() => callback(res), 0);
      return req;
    }
    return handler(options, callback);
  },
};

require.cache[require.resolve("https")] = {
  id: require.resolve("https"),
  filename: require.resolve("https"),
  loaded: true,
  exports: fakeHttps,
};

// downloader.js は初回 require 時に fakeHttps を拾うよう、キャッシュをクリアしておく。
delete require.cache[path.join(__dirname, "downloader.js")];
const downloader = require("./downloader");

function mockHandler(statusCode, content, headers) {
  return (_options, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.headers = headers || { "content-length": String(content.length) };
    res.resume = () => {};
    res.destroy = () => { res.removeAllListeners(); };
    res.pipe = (dest) => {
      res.on("data", (chunk) => dest.write(chunk));
      res.on("end", () => dest.end());
      res.on("error", (err) => dest.destroy(err));
      return dest;
    };
    callback(res);
    process.nextTick(() => {
      const chunkSize = 4;
      for (let i = 0; i < content.length; i += chunkSize) {
        res.emit("data", content.slice(i, i + chunkSize));
      }
      res.emit("end");
    });
    const req = new EventEmitter();
    return req;
  };
}

function mockFailHandler(statusCode) {
  return (_options, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.headers = {};
    res.resume = () => {};
    callback(res);
    process.nextTick(() => res.emit("end"));
    const req = new EventEmitter();
    return req;
  };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

function testSha256File() {
  section("sha256File");

  const dir = tmpDir();
  const filePath = path.join(dir, "hello.txt");
  fs.writeFileSync(filePath, "hello");

  const expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  const digest = downloader.sha256File(filePath);
  ok(typeof digest.then === "function", "sha256File returns a Promise");

  return digest
    .then((hex) => {
      ok(typeof hex === "string", "digest is a string");
      ok(hex.length === 64, "digest is 64 hex chars");
      ok(hex === expected, "SHA256 of 'hello' matches known value");
      cleanup(dir);
    })
    .catch((err) => {
      ok(false, "sha256File threw: " + err.message);
      cleanup(dir);
    });
}

function testUrlAndPathConstruction() {
  section("downloadFile URL/path construction");

  fakeHttps.reset();
  fakeHttps.setHandler(mockHandler(200, Buffer.from("ok")));

  const dir = tmpDir();
  const targetPath = path.join(dir, "selected_tags.csv");

  return downloader
    .downloadFile("selected_tags.csv", targetPath)
    .then(() => {
      ok(fakeHttps._calls.length === 1, "exactly one HTTPS request made");
      const opts = fakeHttps._calls[0];
      ok(opts.hostname === "huggingface.co", "hostname is huggingface.co");
      ok(
        opts.path === "/Grio43/OppaiOracle/resolve/main/V1.1_onnx/selected_tags.csv",
        "path includes repo and filename"
      );
      ok(opts.method === "GET", "method is GET");
      ok(opts.rejectUnauthorized === true, "rejectUnauthorized is true");
      ok(
        !opts.headers || !opts.headers.Range,
        "no Range header when tmp file does not exist"
      );
      cleanup(dir);
    })
    .catch((err) => {
      ok(false, "downloadFile threw: " + err.message);
      cleanup(dir);
    });
}

function testPartialFileRangeHeader() {
  section("partial file Range header");

  fakeHttps.reset();
  const content = Buffer.from("lo!!");
  fakeHttps.setHandler(
    mockHandler(206, content, {
      "content-length": String(content.length),
      "content-range": `bytes 3-9/10`,
    })
  );

  const dir = tmpDir();
  const targetPath = path.join(dir, "pr_thresholds.json");
  const tmpPath = targetPath + ".tmp";
  fs.writeFileSync(tmpPath, "hel"); // 3 bytes already downloaded

  return downloader
    .downloadFile("pr_thresholds.json", targetPath)
    .then(() => {
      ok(fakeHttps._calls.length === 1, "exactly one HTTPS request made");
      const opts = fakeHttps._calls[0];
      ok(opts.headers && opts.headers.Range === "bytes=3-", "Range header starts at 3");
      ok(fs.existsSync(targetPath), "target file was created");
      ok(
        fs.readFileSync(targetPath, "utf-8") === "hello!!",
        "resumed content matches expected"
      );
      cleanup(dir);
    })
    .catch((err) => {
      ok(false, "downloadFile threw: " + err.message);
      cleanup(dir);
    });
}

function testProgressCallback() {
  section("progress callback");

  fakeHttps.reset();
  const content = Buffer.from("0123456789");
  fakeHttps.setHandler(
    mockHandler(200, content, { "content-length": String(content.length) })
  );

  const dir = tmpDir();
  const targetPath = path.join(dir, "model.onnx");
  const events = [];

  return downloader
    .downloadFile("model.onnx", targetPath, (info) => events.push(info))
    .then(() => {
      ok(events.length > 0, "progress callback fired at least once");
      const last = events[events.length - 1];
      ok(last.downloaded === content.length, "last event downloaded equals content length");
      ok(last.total === content.length, "last event total equals content length");
      ok(last.percent === 100, "last event percent is 100");
      cleanup(dir);
    })
    .catch((err) => {
      ok(false, "downloadFile threw: " + err.message);
      cleanup(dir);
    });
}

function testRetryLogic() {
  section("retry logic");

  let attempts = 0;
  const result = downloader.withRetry(async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error("temporary failure " + attempts);
    }
    return "success";
  });

  return result
    .then((value) => {
      ok(value === "success", "withRetry returns success after retries");
      ok(attempts === 3, "exactly 3 attempts made");
    })
    .catch((err) => {
      ok(false, "withRetry threw: " + err.message);
    });
}

function testRetryInDownloadFile() {
  section("retry in downloadFile");

  fakeHttps.reset();
  fakeHttps.setHandler(mockFailHandler(500));
  fakeHttps.setHandler(mockFailHandler(500));
  fakeHttps.setHandler(mockHandler(200, Buffer.from("ok")));

  const dir = tmpDir();
  const targetPath = path.join(dir, "selected_tags.csv");

  return downloader
    .downloadFile("selected_tags.csv", targetPath)
    .then(() => {
      ok(fakeHttps._calls.length === 3, "3 HTTPS requests made (2 failures + 1 success)");
      ok(fs.existsSync(targetPath), "target file exists after retry success");
      cleanup(dir);
    })
    .catch((err) => {
      ok(false, "downloadFile threw: " + err.message);
      cleanup(dir);
    });
}

function testVerifySha256Placeholder() {
  section("verifySha256 placeholder skip");

  const dir = tmpDir();
  const filePath = path.join(dir, "placeholder.txt");
  fs.writeFileSync(filePath, "hello");

  return downloader
    .verifySha256(filePath, "TO_BE_FILLED_AFTER_FIRST_DOWNLOAD")
    .then((okValue) => {
      ok(okValue === true, "verifySha256 returns true for placeholder");
      cleanup(dir);
    })
    .catch((err) => {
      ok(false, "verifySha256 threw: " + err.message);
      cleanup(dir);
    });
}

function testConstants() {
  section("module constants");

  ok(downloader.BASE_URL === "https://huggingface.co/Grio43/OppaiOracle/resolve/main/V1.1_onnx", "BASE_URL is correct");
  ok(downloader.TARGET_DIR === path.join(__dirname, "..", "models", "V1.1"), "TARGET_DIR is correct");
  ok(typeof downloader.SHA256 === "object", "SHA256 map exported");
  ok(downloader.SHA256["model.onnx"].startsWith("TO_BE_FILLED"), "model.onnx hash is placeholder");
  ok(downloader.SHA256["selected_tags.csv"].startsWith("TO_BE_FILLED"), "selected_tags.csv hash is placeholder");
  ok(downloader.SHA256["pr_thresholds.json"].startsWith("TO_BE_FILLED"), "pr_thresholds.json hash is placeholder");
}

// -----------------------------------------------------------------------------
// Runner
// -----------------------------------------------------------------------------

(async function main() {
  console.log("Phase 5 Verification — Model downloader unit tests");
  console.log("===================================================");

  try {
    testConstants();
    await testSha256File();
    await testUrlAndPathConstruction();
    await testPartialFileRangeHeader();
    await testProgressCallback();
    await testRetryLogic();
    await testRetryInDownloadFile();
    await testVerifySha256Placeholder();
  } catch (err) {
    console.error("\nFATAL ERROR: " + err.message);
    console.error(err.stack);
    failed++;
  }

  console.log("\n===================================================");
  console.log("Results: " + passed + " passed, " + failed + " failed");
  process.exit(failed > 0 ? 1 : 0);
})();
