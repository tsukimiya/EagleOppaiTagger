/**
 * src/inference.js
 *
 * ONNX inference wrapper for OppaiOracle V1.1 model.
 *
 * Public API:
 *   infer(preprocessed) -> Promise<Float32Array>
 *
 *   - preprocessed: { pixel_values: Float32Array, padding_mask: Uint8Array }
 *   - Returns: Float32Array of length 19294 (sigmoid probabilities)
 *
 * ONNX inputs:
 *   pixel_values: float32 [1, 3, 448, 448] (BCHW)
 *   padding_mask: bool    [1, 448, 448]
 *
 * ONNX output:
 *   probabilities: float32 [1, 19294] (sigmoid already applied)
 *
 * The session is lazily created on first call and cached for reuse.
 * All paths use __dirname (cwd at runtime is C:\WINDOWS\system32).
 *
 * SPEC reference: .spec/SPEC.md §7.2
 */
"use strict";

const path = require("path");
const ort = require("onnxruntime-node");

const MODEL_PATH = path.join(__dirname, "..", "models", "V1.1", "model.onnx");

let _session = null;

/**
 * Lazily create and cache an ONNX InferenceSession.
 * @returns {Promise<ort.InferenceSession>}
 */
async function getSession() {
  if (_session) return _session;
  try {
    _session = await ort.InferenceSession.create(MODEL_PATH);
  } catch (err) {
    _session = null;
    throw new Error(
      `Failed to load ONNX model at ${MODEL_PATH}: ${err.message}`
    );
  }
  return _session;
}

/**
 * Run inference on preprocessed image data.
 *
 * @param {{ pixel_values: Float32Array, padding_mask: Uint8Array }} preprocessed
 * @returns {Promise<Float32Array>} probabilities array of length 19294
 */
async function infer(preprocessed) {
  const session = await getSession();

  const feeds = {
    pixel_values: new ort.Tensor("float32", preprocessed.pixel_values, [1, 3, 448, 448]),
    padding_mask: new ort.Tensor("bool", preprocessed.padding_mask, [1, 448, 448]),
  };

  try {
    const results = await session.run(feeds);
    return results.probabilities.data;
  } catch (err) {
    throw new Error(`ONNX inference failed: ${err.message}`);
  }
}

module.exports = {
  infer,
  getSession,
  MODEL_PATH,
};
