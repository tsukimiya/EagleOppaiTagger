// Spike B1: onnxruntime-node load diagnostic
// Purpose: determine whether require('onnxruntime-node') and basic ort APIs
//          succeed inside Eagle's plugin runtime (Chromium 107 / Node 16).
//
// Each step is wrapped in try/catch and appended to the result object.
// The full result is rendered to #output and can be copied to clipboard.

async function runDiagnostic() {
  const result = {
    startedAt: new Date().toISOString(),
    steps: {},
  };

  // ---- Step 1: environment info ----
  try {
    result.steps.env = {
      ok: true,
      versions: { ...process.versions },
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      hasRequire: typeof require === 'function',
      hasWindowRequire: typeof window.require === 'function',
      typeofProcess: typeof process,
    };
  } catch (e) {
    result.steps.env = { ok: false, error: String(e && e.message || e), stack: e && e.stack };
  }

  // ---- Step 2: resolve require ----
  // Eagle exposes require in plugin context; try both forms.
  let req;
  try {
    req = (typeof require === 'function') ? require : (typeof window.require === 'function' ? window.require : null);
    result.steps.requireLookup = {
      ok: !!req,
      source: req === require ? 'global' : (req === window.require ? 'window' : 'none'),
    };
    if (!req) {
      result.steps.requireLookup.error = 'require is not available in this context (renderer without nodeIntegration?)';
      return finalize(result);
    }
  } catch (e) {
    result.steps.requireLookup = { ok: false, error: String(e && e.message || e), stack: e && e.stack };
    return finalize(result);
  }

  // ---- Step 3: resolve onnxruntime-node module path ----
  try {
    const path = req('path');
    const fs = req('fs');
    const candidates = [
      req.resolve && req.resolve('onnxruntime-node'),
      path.join(__dirname, 'node_modules', 'onnxruntime-node'),
      path.join(process.cwd(), 'node_modules', 'onnxruntime-node'),
    ].filter(Boolean);
    const found = candidates.find((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    result.steps.moduleResolve = {
      ok: !!found,
      candidates,
      resolved: found || null,
    };
  } catch (e) {
    result.steps.moduleResolve = { ok: false, error: String(e && e.message || e), stack: e && e.stack };
  }

  // ---- Step 4: require('onnxruntime-node') ----
  let ort;
  try {
    ort = req('onnxruntime-node');
    result.steps.requireOnnx = {
      ok: true,
      keys: Object.keys(ort || {}),
      hasTensor: typeof ort.Tensor === 'function',
      hasInferenceSession: typeof ort.InferenceSession === 'function',
      version: ort && ort.version,
    };
  } catch (e) {
    result.steps.requireOnnx = {
      ok: false,
      error: String(e && e.message || e),
      code: e && e.code,
      stack: e && e.stack,
    };
    return finalize(result);
  }

  // ---- Step 5: construct a Tensor ----
  try {
    const data = new Float32Array([1, 2, 3, 4]);
    const tensor = new ort.Tensor('float32', data, [2, 2]);
    result.steps.tensorConstruct = {
      ok: true,
      type: tensor.type,
      dims: tensor.dims,
      size: tensor.size,
    };
  } catch (e) {
    result.steps.tensorConstruct = {
      ok: false,
      error: String(e && e.message || e),
      stack: e && e.stack,
    };
  }

  // ---- Step 6: InferenceSession.create on a non-existent model ----
  // Expectation: it throws a file-not-found / backend error, NOT a native-load error.
  // The error message reveals which backend layer was reached.
  try {
    await ort.InferenceSession.create('__definitely_not_a_model__.onnx');
    result.steps.sessionCreate = {
      ok: false,
      note: 'expected an error but none was thrown',
    };
  } catch (e) {
    result.steps.sessionCreate = {
      ok: true,
      errorCaught: String(e && e.message || e),
      code: e && e.code,
      // The error message tells us how far we got:
      //  - "Can't open file" => backend reached, native binary loaded fine
      //  - "Module did not self-register" / NODE_MODULE_VERSION => ABI mismatch (BLOCKER)
      //  - "The specified module could not be found" => .node binary missing for this platform
      stack: e && e.stack,
    };
  }

  // ---- Step 7 (optional): enumerate available providers ----
  try {
    // Different versions expose this differently; best-effort.
    const providers = ort.env && ort.env.backend && ort.env.backend.providers
      ? ort.env.backend.providers
      : (ort.getAvailableProviders ? await ort.getAvailableProviders() : null);
    result.steps.providers = { ok: !!providers, providers };
  } catch (e) {
    result.steps.providers = { ok: false, error: String(e && e.message || e) };
  }

  return finalize(result);
}

function finalize(result) {
  result.finishedAt = new Date().toISOString();

  // Overall verdict — loaded if requireOnnx succeeded AND tensor or session step succeeded.
  const r = result.steps;
  const loaded = r.requireOnnx && r.requireOnnx.ok;
  const functional = loaded && ((r.tensorConstruct && r.tensorConstruct.ok) || (r.sessionCreate && r.sessionCreate.ok));
  result.verdict = functional
    ? 'PASS_LOAD_AND_CALL'
    : (loaded ? 'PARTIAL_LOAD_ONLY' : 'FAIL_CANNOT_LOAD');
  return result;
}

// Expose for index.html
window.runDiagnostic = runDiagnostic;
