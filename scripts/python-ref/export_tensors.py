"""
Export preprocessing outputs for the 3 sample images as JSON.

Output:
    scripts/python-ref/expected_<name>.json  (one per sample)

Each file contains:
    - name:             sample name ("square" / "tall" / "wide")
    - input_size:       [w, h] of the source image
    - image_size:       int (448 for V1.1)
    - pad_color:        [r, g, b] (114, 114, 114)
    - mean:             [m0, m1, m2] (0.5, 0.5, 0.5)
    - std:              [s0, s1, s2] (0.5, 0.5, 0.5)
    - x0, y0, nw, nh:   letterbox geometry (for debugging)
    - pixel_values_shape: [3, 448, 448]
    - pixel_values:     flat list of float (length 3*448*448 = 602112)
                        BCHW layout: index = c * 448*448 + h * 448 + w
    - padding_mask_shape: [448, 448]
    - padding_mask:     flat list of int 0/1 (length 448*448 = 200704)
                        1 = pad area (True), 0 = image area (False)

Why this is a self-contained re-implementation
-----------------------------------------------
The reference `app.py` is the verbatim HuggingFace source. Its `letterbox()` /
`preprocess()` functions are nested inside `_run_app()` (see `app.py` lines
927-947) and depend on the `state` dict that `load_model()` populates from
`V1.1_onnx/preprocessing.json`. Calling them requires:

    1. Booting a venv with onnxruntime + gradio (~500 MB).
    2. Going through the Gradio bootstrap / model-load flow.
    3. Reaching the point where `state["image_size"]` is set.

For Phase 1 we only need the *math* of `letterbox()` / `preprocess()`. The
functions below are a line-for-line transcription of `app.py:927-947` with
the constants that `V1.1_onnx/preprocessing.json` provides (image_size=448,
pad_color_rgb=[114,114,114], normalize_mean=[0.5,0.5,0.5],
normalize_std=[0.5,0.5,0.5]). If `app.py` ever changes, this file MUST be
updated in lockstep.

Usage:
    python export_tensors.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Tuple

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Constants (from V1.1_onnx/preprocessing.json — DO NOT edit without
# changing app.py's `load_model()` in lockstep).
# ---------------------------------------------------------------------------
IMAGE_SIZE: int = 448
PAD_COLOR: Tuple[int, int, int] = (114, 114, 114)
NORMALIZE_MEAN = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(3, 1, 1)
NORMALIZE_STD = np.array([0.5, 0.5, 0.5], dtype=np.float32).reshape(3, 1, 1)

# ---------------------------------------------------------------------------
# letterbox() — line-for-line copy of app.py:927-940
# ---------------------------------------------------------------------------
def letterbox(img: Image.Image) -> Tuple[Image.Image, np.ndarray]:
    """Letterbox-pad `img` to IMAGE_SIZE×IMAGE_SIZE with PAD_COLOR.

    Returns:
        canvas: PIL Image, RGB, exactly IMAGE_SIZE×IMAGE_SIZE.
        mask:   np.bool [IMAGE_SIZE, IMAGE_SIZE]; True = padded area,
                False = original image area.
    """
    img = img.convert("RGB")
    w, h = img.size
    size = IMAGE_SIZE
    scale = min(size / w, size / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = img.resize((nw, nh), Image.BICUBIC)
    canvas = Image.new("RGB", (size, size), PAD_COLOR)
    x0 = (size - nw) // 2
    y0 = (size - nh) // 2
    canvas.paste(resized, (x0, y0))
    mask = np.ones((size, size), dtype=bool)  # True = padded
    mask[y0:y0 + nh, x0:x0 + nw] = False
    return canvas, mask


# ---------------------------------------------------------------------------
# preprocess() — line-for-line copy of app.py:942-947
# ---------------------------------------------------------------------------
def preprocess(img: Image.Image) -> Tuple[np.ndarray, np.ndarray]:
    """Apply letterbox + normalize to the image.

    Returns:
        pixel_values: np.float32 [3, IMAGE_SIZE, IMAGE_SIZE], BCHW,
                       normalized by (x/255 - mean) / std.
        padding_mask: np.bool   [IMAGE_SIZE, IMAGE_SIZE]; True = padded area.
    """
    canvas, mask = letterbox(img)
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    arr = arr.transpose(2, 0, 1)  # HWC → CHW
    arr = (arr - NORMALIZE_MEAN) / NORMALIZE_STD
    return arr.astype(np.float32), mask


# ---------------------------------------------------------------------------
# Sample registry (path is relative to THIS file).
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
SAMPLES = [
    ("square", HERE / "samples" / "square.png", (300, 300)),
    ("tall",   HERE / "samples" / "tall.png",   (100, 300)),
    ("wide",   HERE / "samples" / "wide.png",   (300, 100)),
]


def export_sample(name: str, image_path: Path, expected_size: Tuple[int, int]) -> Path:
    if not image_path.is_file():
        raise FileNotFoundError(f"sample image missing: {image_path}")

    with Image.open(image_path) as img_raw:
        actual = img_raw.size
    if actual != expected_size:
        print(
            f"[export] WARNING: {image_path.name} is {actual}, expected "
            f"{expected_size}. Re-generate with `node scripts/create-samples.js`.",
            file=sys.stderr,
        )

    with Image.open(image_path) as img:
        pixel_values, padding_mask = preprocess(img)
        w, h = img.size

    # Recompute letterbox geometry for the sidecar.
    scale = min(IMAGE_SIZE / w, IMAGE_SIZE / h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    x0 = (IMAGE_SIZE - nw) // 2
    y0 = (IMAGE_SIZE - nh) // 2

    # Sanity: tensor shapes must match what the ONNX model expects.
    assert pixel_values.shape == (3, IMAGE_SIZE, IMAGE_SIZE), pixel_values.shape
    assert pixel_values.dtype == np.float32, pixel_values.dtype
    assert padding_mask.shape == (IMAGE_SIZE, IMAGE_SIZE), padding_mask.shape
    assert padding_mask.dtype == bool, padding_mask.dtype

    payload = {
        "name": name,
        "input_size": [w, h],
        "image_size": IMAGE_SIZE,
        "pad_color": list(PAD_COLOR),
        "mean": NORMALIZE_MEAN.reshape(-1).tolist(),
        "std":  NORMALIZE_STD.reshape(-1).tolist(),
        "x0": x0,
        "y0": y0,
        "nw": nw,
        "nh": nh,
        "pixel_values_shape": [3, IMAGE_SIZE, IMAGE_SIZE],
        "pixel_values": pixel_values.reshape(-1).tolist(),
        "padding_mask_shape": [IMAGE_SIZE, IMAGE_SIZE],
        # int 0/1 (JSON has no native bool array); values: 1 = padded, 0 = image.
        "padding_mask": padding_mask.reshape(-1).astype(np.int8).tolist(),
    }

    out_path = HERE / f"expected_{name}.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f)
    print(
        f"[export] {name:>5s}  in={w}x{h}  letterbox=({nw}x{nh} @ ({x0},{y0})) "
        f"-> {out_path.name}  ({out_path.stat().st_size / 1024:.1f} KB)"
    )
    return out_path


def main() -> int:
    for name, path, expected in SAMPLES:
        try:
            export_sample(name, path, expected)
        except FileNotFoundError as e:
            print(f"[export] {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
