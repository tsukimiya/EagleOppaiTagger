"""
OppaiOracle Inference Server — FastAPI application.

Provides 3 endpoints:
  GET  /health  — health check with model status
  GET  /info    — model metadata (variant, providers, tag count, avg inference time)
  POST /infer   — multipart/form-data image -> JSON probability array

Usage:
    uvicorn main:app --host 0.0.0.0 --port 8765
    # or
    python main.py
"""

import os
import time
import io

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image
import numpy as np

from model_loader import get_session, get_model_info, record_inference
from preprocess import preprocess_image

app = FastAPI(title="OppaiOracle Inference Server", version="0.1.0")

MODEL_DIR_DEFAULT = "./models/V1.1"  # OPPAI_MODEL_DIR env var overrides this


@app.on_event("startup")
async def load_model():
    """Load model at startup for warm inference."""
    model_dir = os.environ.get("OPPAI_MODEL_DIR", MODEL_DIR_DEFAULT)
    get_session(model_dir)


@app.get("/health")
async def health():
    """Health check — returns model status and provider info."""
    try:
        info = get_model_info()
        return {"status": "ok", **info}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "message": str(e)},
        )


@app.get("/info")
async def info():
    """Model metadata."""
    return get_model_info()


@app.post("/infer")
async def infer(file: UploadFile = File(...)):
    """Receive an image and return per-tag probability array."""
    # 1. Read uploaded file
    content = await file.read()
    try:
        img = Image.open(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    # 2. Preprocess (letterbox + normalize -> BCHW float32 + padding_mask)
    pixel_values, padding_mask = preprocess_image(img)

    # 3. Run inference
    session = get_session()
    feeds = {
        "pixel_values": pixel_values[np.newaxis, ...].astype(np.float32),
        "padding_mask": padding_mask[np.newaxis, ...].astype(bool),
    }
    t0 = time.perf_counter()
    outputs = session.run(["probabilities"], feeds)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    record_inference(elapsed_ms)

    probs = outputs[0][0]  # shape: (19294,)

    # 4. Return JSON (~150 KB for 19294 float64 values)
    return {
        "probabilities": probs.tolist(),
        "num_classes": len(probs),
        "elapsed_ms": round(elapsed_ms, 2),
        "model_info": get_model_info(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
