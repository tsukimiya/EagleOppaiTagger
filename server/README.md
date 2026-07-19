# OppaiOracle Inference Server

OppaiOracle ONNX モデル（V1.1, 448x448）で画像タグ推論を行う REST API サーバ。
Python + FastAPI + onnxruntime-gpu で構築。Eagle プラグインからの HTTP リクエストに応答し、
GPU 推論による高速なタグ確率配列を返す。

## 要件

- Python 3.10+
- GPU（任意）: CUDA 11.x / 12.x 対応 GPU、または DirectML 対応 Windows
  - GPU なしの環境では CPUExecutionProvider に自動フォールバック
- Linux 推奨（Ubuntu 22.04+）。Windows / macOS でも動作するが GPU プロバイダは環境依存

## セットアップ

```bash
cd server
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

CPU 環境で `onnxruntime-gpu` のインストールが失敗する場合は、
`requirements.txt` の `onnxruntime-gpu` を `onnxruntime` に置き換える。

## モデル配置

モデルファイルは `server/models/V1.1/` に配置する:

```
server/models/V1.1/
  model.onnx            # ONNX モデル（約 993 MB）
  selected_tags.csv     # タグ名・カテゴリ一覧
  preprocessing.json    # 前処理パラメータ
  pr_thresholds.json    # P=R 閾値（任意）
```

HuggingFace からダウンロード:
https://huggingface.co/Grio43/OppaiOracle/tree/main/V1.1_onnx

環境変数 `OPPAI_MODEL_DIR` で別パスを指定することも可能:

```bash
export OPPAI_MODEL_DIR=/path/to/V1.1_onnx
```

## 起動

```bash
uvicorn main:app --host 0.0.0.0 --port 8765

# または
python main.py
```

## GPU 認識確認

```bash
curl http://localhost:8765/info
```

レスポンスの `providers` フィールドを確認:
- `"CUDAExecutionProvider"` — NVIDIA GPU で CUDA 推論中
- `"DmlExecutionProvider"` — DirectML 推論中（Windows AMD/Intel GPU）
- `"CPUExecutionProvider"` — CPU フォールバック

## テスト

```bash
pytest tests/ -v
```

テストはモデルなしで動作する（model_loader をモック）。

## API リファレンス

### GET /health

ヘルスチェック。モデルのロード状態と GPU 利用可否を返す。

**レスポンス (200)**:
```json
{
  "status": "ok",
  "model_dir": "/path/to/V1.1",
  "image_size": 448,
  "num_tags": 19294,
  "providers": ["CUDAExecutionProvider"],
  "model_loaded": true,
  "inference_count": 42,
  "avg_inference_ms": 85.3
}
```

**エラー (503)**:
```json
{
  "status": "error",
  "message": "Model not loaded"
}
```

### GET /info

モデル情報と推論統計を返す。

**レスポンス (200)**: /health と同じ形式。

### POST /infer

画像ファイルを受け取り、19294 次元の確率配列を返す。

**リクエスト**: `multipart/form-data`
- `file` (必須): 画像ファイル（PNG, JPEG 等）

**レスポンス (200)**:
```json
{
  "probabilities": [0.012, 0.003, ...],
  "num_classes": 19294,
  "elapsed_ms": 82.5,
  "model_info": {
    "model_dir": "/path/to/V1.1",
    "image_size": 448,
    "num_tags": 19294,
    "providers": ["CUDAExecutionProvider"],
    "model_loaded": true,
    "inference_count": 43,
    "avg_inference_ms": 85.1
  }
}
```

**エラー**:
- `400`: 不正な画像ファイル
- `422`: `file` パラメータなし
- `503`: モデル未ロード

## トラブルシューティング

### CUDA が認識されない

1. `nvidia-smi` で GPU が認識されていることを確認
2. CUDA toolkit と cuDNN のバージョン互換性を確認（CUDA 11.8 or 12.x）
3. `pip install onnxruntime-gpu --force-reinstall` で再インストール
4. 起動ログで `providers: ["CUDAExecutionProvider"]` を確認

### onnxruntime-gpu がインストールできない

- CUDA toolkit が未インストールの可能性がある
- CPU のみで使う場合: `pip install onnxruntime`（`-gpu` なし）に切り替える

### モデルがロードされない

- `models/V1.1/` に `model.onnx`, `selected_tags.csv`, `preprocessing.json` の3ファイルが揃っていることを確認
- `OPPAI_MODEL_DIR` 環境変数が正しいパスを指していることを確認
- `curl http://localhost:8765/health` でエラーメッセージを確認

### メモリ不足

- V1.1 ONNX モデルは約 993 MB。ロード時に GPU VRAM を約 1.5 GB 消費する
- VRAM が不足する場合は V1（320x320, 約 992 MB）を検討（ただし V1 対応はスコープ外）
