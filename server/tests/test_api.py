"""
Tests for OppaiOracle Inference Server API.

Uses FastAPI TestClient with mocked model_loader so tests run without
an actual ONNX model file or GPU.
"""

import io

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from unittest.mock import patch, MagicMock


@pytest.fixture
def client():
    from main import app
    return TestClient(app)


@pytest.fixture
def mocked_model():
    """Mock model_loader so tests run without actual model files."""
    with (
        patch("main.get_session") as mock_session,
        patch("main.get_model_info") as mock_info,
        patch("main.preprocess_image") as mock_preproc,
        patch("main.record_inference"),
    ):
        mock_session.return_value = MagicMock()
        mock_session.return_value.run.return_value = [
            np.zeros((1, 19294), dtype=np.float32)
        ]
        mock_info.return_value = {
            "model_dir": "/mock/V1.1",
            "image_size": 448,
            "num_tags": 19294,
            "providers": ["CPUExecutionProvider"],
            "model_loaded": True,
            "inference_count": 0,
            "avg_inference_ms": 0,
        }
        mock_preproc.return_value = (
            np.zeros((3, 448, 448), dtype=np.float32),
            np.zeros((448, 448), dtype=bool),
        )
        yield mock_session, mock_info, mock_preproc


def _make_test_image(width=100, height=100, color=(255, 0, 0)):
    """Create a minimal PNG image buffer for testing."""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


class TestHealthEndpoint:
    def test_health_ok(self, client, mocked_model):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert data["image_size"] == 448
        assert data["num_tags"] == 19294
        assert data["model_loaded"] is True

    def test_health_model_not_loaded(self, client):
        """When model is not loaded, /health returns 503."""
        with patch("main.get_model_info", side_effect=RuntimeError("Model not loaded")):
            r = client.get("/health")
            assert r.status_code == 503
            data = r.json()
            assert data["status"] == "error"


class TestInfoEndpoint:
    def test_info(self, client, mocked_model):
        r = client.get("/info")
        assert r.status_code == 200
        data = r.json()
        assert "providers" in data
        assert "CPUExecutionProvider" in data["providers"]
        assert data["num_tags"] == 19294


class TestInferEndpoint:
    def test_infer_requires_file(self, client, mocked_model):
        """POST /infer without file returns 422."""
        r = client.post("/infer")
        assert r.status_code == 422

    def test_infer_with_image(self, client, mocked_model):
        """POST /infer with valid image returns probability array."""
        buf = _make_test_image()
        r = client.post(
            "/infer",
            files={"file": ("test.png", buf.getvalue(), "image/png")},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["num_classes"] == 19294
        assert len(data["probabilities"]) == 19294
        assert "elapsed_ms" in data
        assert "model_info" in data

    def test_infer_invalid_image(self, client, mocked_model):
        """POST /infer with non-image data returns 400."""
        r = client.post(
            "/infer",
            files={"file": ("test.txt", b"not an image", "text/plain")},
        )
        assert r.status_code == 400
        assert "Invalid image" in r.json()["detail"]

    def test_infer_different_sizes(self, client, mocked_model):
        """Various image dimensions should all work."""
        for w, h in [(100, 100), (1920, 1080), (50, 500), (1, 1)]:
            buf = _make_test_image(width=w, height=h)
            r = client.post(
                "/infer",
                files={"file": (f"test_{w}x{h}.png", buf.getvalue(), "image/png")},
            )
            assert r.status_code == 200, f"Failed for {w}x{h}"
