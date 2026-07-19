"""
Image preprocessing: letterbox padding + normalize.

This is a line-for-line port of scripts/python-ref/app.py lines 927-947
(and export_tensors.py lines 66-104), which are verified to produce tensors
matching the JS implementation (src/preprocess.js) with MAE < 5e-9.

The math:
  1. Resize to fit within image_size x image_size (aspect-preserving, BICUBIC)
  2. Center-paste onto image_size x image_size canvas filled with pad_color
  3. Build padding_mask: True = padded area, False = original image area
  4. Normalize: (pixel / 255 - mean) / std -> float32 CHW tensor
"""

import numpy as np
from PIL import Image

from model_loader import get_state


def letterbox(img: Image.Image):
    """Letterbox-pad img to image_size x image_size with pad_color.

    Returns:
        canvas: PIL Image, RGB, exactly image_size x image_size.
        mask:   np.bool [image_size, image_size]; True = padded area.
    """
    img = img.convert("RGB")
    w, h = img.size
    state = get_state()
    size = state["image_size"]
    scale = min(size / w, size / h)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = img.resize((nw, nh), Image.BICUBIC)
    canvas = Image.new("RGB", (size, size), state["pad_color"])
    x0 = (size - nw) // 2
    y0 = (size - nh) // 2
    canvas.paste(resized, (x0, y0))
    mask = np.ones((size, size), dtype=bool)  # True = padded
    mask[y0 : y0 + nh, x0 : x0 + nw] = False
    return canvas, mask


def preprocess_image(img: Image.Image):
    """Apply letterbox + normalize to produce model-ready tensors.

    Returns:
        pixel_values: np.float32 [3, image_size, image_size] CHW normalized.
        padding_mask: np.bool [image_size, image_size]; True = padded area.
    """
    canvas, mask = letterbox(img)
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    arr = arr.transpose(2, 0, 1)  # HWC -> CHW
    state = get_state()
    arr = (arr - state["mean"]) / state["std"]
    return arr.astype(np.float32), mask
