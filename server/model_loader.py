"""
ONNX Runtime session management with automatic provider detection.

Provider priority: CUDA -> DirectML -> CPU.
Session is cached after first load; subsequent get_session() calls return the
same instance unless a different model_dir is requested.
"""

import os
import json
import csv
import threading
from pathlib import Path

import onnxruntime as ort
import numpy as np

_lock = threading.Lock()
_state = {
    "session": None,
    "model_dir": None,
    "tag_names": [],
    "categories": [],
    "skip_mask": None,
    "image_size": 0,
    "pad_color": (0, 0, 0),
    "mean": None,
    "std": None,
    "providers": [],
    "inference_count": 0,
    "total_inference_ms": 0.0,
}


def _detect_providers():
    """Return best available execution provider list: CUDA > DirectML > CPU."""
    available = ort.get_available_providers()
    for preferred in [
        "CUDAExecutionProvider",
        "DmlExecutionProvider",
        "CPUExecutionProvider",
    ]:
        if preferred in available:
            return [preferred]
    return ["CPUExecutionProvider"]


def load_model(model_dir: str):
    """Load ONNX model and preprocessing config into _state."""
    model_dir = Path(model_dir).resolve()
    required = ["model.onnx", "selected_tags.csv", "preprocessing.json"]
    missing = [f for f in required if not (model_dir / f).exists()]
    if missing:
        raise FileNotFoundError(
            f"model_dir {model_dir} missing: {', '.join(missing)}"
        )

    # Parse tag names and categories from CSV
    tag_names = []
    categories = []
    with (model_dir / "selected_tags.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tag_names.append(row["name"])
            categories.append(int(row["category"]))
    n_tags = len(tag_names)
    skip_mask = np.zeros(n_tags, dtype=bool)
    for i, name in enumerate(tag_names):
        if name in ("<PAD>", "<UNK>"):
            skip_mask[i] = True

    # Parse preprocessing parameters
    with (model_dir / "preprocessing.json").open(encoding="utf-8") as f:
        preproc = json.load(f)
    image_size = int(preproc["image_size"])
    pad_color = tuple(int(c) for c in preproc["pad_color_rgb"])
    mean = np.array(preproc["normalize_mean"], dtype=np.float32).reshape(3, 1, 1)
    std = np.array(preproc["normalize_std"], dtype=np.float32).reshape(3, 1, 1)

    # Build ORT session
    providers = _detect_providers()
    sess_opts = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = ort.InferenceSession(
        str(model_dir / "model.onnx"),
        sess_options=sess_opts,
        providers=providers,
    )

    with _lock:
        _state.update(
            session=session,
            model_dir=str(model_dir),
            tag_names=tag_names,
            categories=categories,
            skip_mask=skip_mask,
            image_size=image_size,
            pad_color=pad_color,
            mean=mean,
            std=std,
            providers=providers,
            inference_count=0,
            total_inference_ms=0.0,
        )


def get_session(model_dir: str = None):
    """Return cached ORT session. Loads on first call or when model_dir changes."""
    with _lock:
        needs_load = (
            _state["session"] is None
            or (model_dir and _state["model_dir"] != str(Path(model_dir).resolve()))
        )
    if needs_load:
        if model_dir is None:
            model_dir = os.environ.get("OPPAI_MODEL_DIR", "./models/V1.1")
        load_model(model_dir)
    return _state["session"]


def get_model_info():
    """Return model metadata dict."""
    with _lock:
        if _state["session"] is None:
            raise RuntimeError("Model not loaded")
        avg = (
            _state["total_inference_ms"] / _state["inference_count"]
            if _state["inference_count"] > 0
            else 0
        )
        return {
            "model_dir": _state["model_dir"],
            "image_size": _state["image_size"],
            "num_tags": len(_state["tag_names"]),
            "providers": _state["providers"],
            "model_loaded": True,
            "inference_count": _state["inference_count"],
            "avg_inference_ms": round(avg, 2),
        }


def record_inference(elapsed_ms: float):
    """Record inference timing for statistics."""
    with _lock:
        _state["inference_count"] += 1
        _state["total_inference_ms"] += elapsed_ms


def get_state():
    """Return internal state dict (used by preprocess module)."""
    return _state
