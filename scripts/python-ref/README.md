# Python Reference — OppaiOracle 前処理

> Phase 1 で JS 側 `src/preprocess.js` の挙動を検証するための **基準実装** 置き場。
> 公式 HuggingFace リポジトリの `web_interface/app.py` を clone したものをベースに、
> Phase 1 で必要な `letterbox()` / `preprocess()` のみを切り出して `app.py` に保存している。

## なぜ Python が必要なのか

`onnxruntime-node` を含む JS 側実装は浮動小数点誤差を内在する。
公式実装（Python + Pillow + NumPy）の出力を **正本** として、
JS 側の `pixel_values` / `padding_mask` が平均誤差 < 1e-4 に収まることを確認する。
これは SPEC §12 で要求されている検証項目（"前処理結果が Python 参照実装と一致"）を満たす手順。

## セットアップ

Windows / PowerShell を想定。
Python は 3.9 以上。`py` ランチャーが使える前提。

```powershell
# scripts/python-ref に移動
cd scripts\python-ref

# 仮想環境を作成（このフォルダに .venv/ ができる）
py -m venv .venv

# 有効化
.\.venv\Scripts\Activate.ps1

# 依存をインストール
#   onnxruntime は export_tensors.py では import しないが、app.py と同じ
#   環境を作るためにここで入れておく（Phase 2 で predict する時に再インストール不要）。
pip install --upgrade pip
pip install onnxruntime pillow numpy
```

> `onnxruntime` の wheel はネイティブ DLL を含むため、Windows では
> **Microsoft Visual C++ 2015-2022 Redistributable (x64)** が
> 入っていないと import 時に `DLL load failed` が出ます。
> https://aka.ms/vs/17/release/vc_redist.x64.exe から入手して先にインストール。
>
> ただし `export_tensors.py` は `onnxruntime` を import しないため、
> **この Phase の export 実行だけなら VC++ ランタイムは不要** です。

## 使い方

### 1. サンプル画像を生成

JS 側で同じ画像を再生成するので Python 側での作成は不要。
ただし、動作確認用に Python 側にも同等の画像が欲しい場合は `samples/` に PNG を配置する。
リポジトリの JS 側生成スクリプトが `scripts/python-ref/samples/` に直接書き出すので、
通常は再生成不要。

### 2. 期待値（expected_*.json）を生成

Python 側で `app.py::preprocess()` を 3 サンプルに適用し、結果を JSON に出力する:

```powershell
python export_tensors.py
```

実行すると `scripts/python-ref/expected_<name>.json` が 3 ファイル生成される。
JSON の構造:

```json
{
  "name": "square",
  "input_size": [300, 300],
  "letterbox_size": [448, 448],
  "pixel_values": [/* flat float32, length 3*448*448 = 602112 */],
  "padding_mask": [/* flat bool 0/1, length 448*448 = 200704 */]
}
```

### 3. JS 側で検証

```powershell
# プロジェクトルートに戻る
cd ..\..

# 期待値との誤差を計算
node src\verify.js
```

成功すると `PASS / mean error < 1e-4` が出力され、各画像の
`pixel_values` MAE と `padding_mask` 一致率が表示される。

## ファイル構成

| ファイル | 役割 |
|----------|------|
| `app.py` | 公式 `web_interface/app.py` 由来の `letterbox()` / `preprocess()` 実装 |
| `export_tensors.py` | サンプル画像を入力に `preprocess()` を実行し JSON に保存 |
| `samples/*.png` | 3 種類のテスト画像（JS 側で生成する・Python 側では読み取るだけ） |
| `expected_*.json` | `export_tensors.py` 実行で生成される検証用基準データ |
| `README.md` | このファイル |
