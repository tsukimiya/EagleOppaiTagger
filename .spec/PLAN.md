# PLAN — Eagle OppaiOracle Tagger Plugin (v3)

> SDD の PLAN.md は人間の口頭メモ・自由記述を想定。構造化仕様は `SPEC.md` 参照。

## 一言で

Eagle 上で画像を選択してボタンを押したら、OppaiOracle（Danbooru 系アニメ画像タガー）が自動タグ付けして、Eagle の `tags` に書き戻すプラグインが欲しい。
**v3 で GPU 推論サーバ（Python FastAPI）経由を第一優先に追加。ローカル推論はフォールバックとして維持。**

## 背景・気持ち

- Danbo 系画像を Eagle で整理しているが、手タグ付けが限界
- OppaiOracle は精度が良く ONNX でも提供されているので、ローカル推論で完結したい
- NSFW 含むドメインなので、クラウド API に勝手に送る構成にはしたくない（プライバシ・利用規約の観点）
- **v3**: onnxruntime-node は CPU プロバイダのみ → GPU 活用には Python 側の onnxruntime-gpu が必要。自宅サーバで GPU 推論 → プラグインから HTTP で叩く構成に変更。自宅 LAN 内で完結するので NSFW 懸念も維持

## 前提（確定）

- 実行環境（プラグイン側）: Eagle 4.x（Chromium 108 / Node 16.17.1 / Electron 22.3.7 / Windows x64 で確認）
- 実行環境（サーバ側）: Linux（Ubuntu 22.04+）、CUDA 11.x/12.x GPU、Python 3.10+
- モデル: HuggingFace `Grio43/OppaiOracle` V1.1 ONNX（448x448 / 19,294 クラス / General-only）
- 推論エンジン（サーバ）: `onnxruntime-gpu`（CUDA → DirectML → CPU 自動フォールバック）
- 推論エンジン（ローカル・フォールバック）: `onnxruntime-node`（B1 スパイク PASS 済み・renderer からグローバル `require` で直接呼べる）
- プロトコル: REST（multipart/form-data + JSON）
- 配置: 自宅サーバ（VPN 含む・パブリッククラウドは使用しない）

## 実現しないこと（MVP 外）

- モデル再学習・ファインチューニング
- 動画・フォルダ自動監視（Event API に `onItemAdd` が無いため不可。将来は別途検討）
- `explicit` / `questionable` / `safe` 等の分類タグ（このモデルは General-only なので出せない）
- V1 バリアント（320x320）対応（必要になるまでやらない）
- 多言語 UI（日本語優先・英語はテキスト辞書式で後から乗る程度）

## 関連ドキュメント

- 旧 plan（v1）: `.sisyphus/plans/eagle-oppai-tagger.md`
- v1 への敵対的検証レポート: セッション履歴（2026-07-18）
- B1 スパイク結果: `.sisyphus/spikes/b1-onnxruntime-load/RESULTS.md` 相当・`KNOWLEDGE.md` に転記
- 公式モデル: https://huggingface.co/Grio43/OppaiOracle
- 公式リファレンス実装: `web_interface/app.py`（Gradio / `letterbox()` / `preprocess()` / `predict()`）
- Eagle Plugin API: https://developer.eagle.cool/plugin-api

## ユーザー 合意事項（要承認）

v2 plan を起票する上で、私が合理的デフォルトで決めた選択。異論があれば SPEC 確定前に指摘してください。

| # | 選択 | 理由 |
|---|------|------|
| 1 | V1.1 固定（V1 は今後必要になるまで対応しない） | B3 の指摘。V1.1 の方が精度が高い・2 バリアント両対応は前処理パイプラインが複雑化 |
| 2 | Background Service / 自動タグ付けは「将来保留」 | B2 の指摘。Event API に `onItemAdd` が無いため、ポーリング設計はコストに合わない |
| 3 | 設定永続化は `localStorage`（要調査で Eagle 专用 API に切替） | W6。localStorage は Chromium 系で確実に動く |
| 4 | 画像前処理は `jimp`（pure JS） | W5。Sharp は onnxruntime-node と同じ ABI 問題を抱えるため回避 |
| 5 | モデル配布は初回 DL 方式（SHA256 検証付き） | W7。同梱は 1GB 近いサイズで配布 zip が膨らむ |
| 6 | グローバル閾値を MVP とし、per-tag は拡張機能 | 14章の選択肢④。MVP では単純化 |
| 7 | 日本語 UI をデフォルト・英語は JSON 辞書で後から乗せる | N5。最初から i18n 仕込みを入れる |

## 次のステップ

1. 本 PLAN + `SPEC.md` をレビュー
2. 合意点（上記7項目）の承認／修正
3. `SPEC.md` 確定 → `TODO.md` のタスク分解へ

## v3: サーバ化対応（Phase 7-9）

### 動機

- onnxruntime-node は CPU プロバイダのみ → GPU 活用で推論高速化
- Mac/Linux でも GPU 推論を利用可能に（サーバが GPU を提供）
- 自宅サーバ配置で NSFW コンテンツのプライバシを維持

### 設計方針（合意済み）

| 項目 | 内容 |
|------|------|
| 配置 | 自宅サーバ（VPN 含む） |
| サーバ実装 | Python + FastAPI + onnxruntime-gpu |
| プロトコル | REST (multipart/form-data + JSON) |
| ローカル推論 | 両対応（サーバ優先・フォールバック） |
| リポジトリ | 同リポジトリに `server/` サブディレクトリ（モノレポ） |

### Phase 7: 推論サーバ実装

`server/` に FastAPI アプリを構築:
- `main.py` — エンドポイント（`/infer`, `/health`, `/info`）
- `model_loader.py` — onnxruntime-gpu session 管理・プロバイダー自動検出
- `preprocess.py` — PIL/numpy ベース前処理（公式 `app.py` の letterbox/preprocess を流用）
- `requirements.txt` / `README.md` / `tests/test_api.py`

### Phase 8: プラグイン側クライアント化

- `src/inference-client.js` — HTTP クライアント（タイムアウト・リトライ）
- `src/settings.js` に `serverUrl`, `useServer`, `serverTimeoutMs`, `fallbackOnServerError` 追加
- `src/main.js` の推論ルート切替（サーバ → フォールバック）
- `src/ui.js` にサーバ設定 UI 追加
- `src/phase8-test.js` — テスト

### Phase 9: 統合テスト・プロファイリング

- 実サーバ + プラグインでの E2E 動作確認
- ローカルフォールバック動作確認（サーバ停止 → 自動切替）
- サーバ vs ローカルのベンチマーク（100枚バッチ）

---

## v4: 自動タグ付け（Phase 10）

### 動機

- ユーザーが手動で「実行」を押すのが負担。新規追加画像は放置されがち
- 既存の未タグ付け画像も、アイドル時に順次処理したい
- Background Service 型で常駐自動化できれば理想だが、まずは小さく Window 内自動化から

### 調査結果（2026-07-20）

Eagle 公式 doc を確認:

- **Background Service Plugin 型が公式サポート**（manifest の `main.serviceMode: true`）。v3 PLAN の「不可」は誤りだった
- Event API に `onItemAdd` は無いが、`eagle.item.getIdsWithModifiedAt()` で差分検出可能
- `eagle.item.get({isUntagged: true})` で未タグ付け抽出可能
- → ポーリング方式で自動タグ付けは実現可能

### 設計方針（ユーザー合意済み・2026-07-20）

| 項目 | 内容 |
|------|------|
| v4 の範囲 | 現行 Window プラグイン内に「自動モード」を追加。Service 化は Phase 11 で検討 |
| デフォルト | OFF（ユーザーが明示的に ON するまで動かない）|
| ポーリング間隔 | 45秒デフォルト（30〜60秒設定可）|
| 対象 | 未タグ付け画像のみ（`isUntagged: true`）|
| 優先度 | 新規画像優先 → 次いで既存未タグ付け |
| 処理済み判定 | タグ付与＝処理済み（`isUntagged` で自然に除外）|
| エラー処理 | スキップ＋連続5回で自動停止 |
| ログ | 現在の状態表示のみ（ファイル保存なし）|

### 実現しないこと（Phase 11 以降）

- `serviceMode: true` による常駐化（ウィンドウを閉じても動く）
- フォルダ指定・スマートフォルダ連携
- ログのファイル保存・セッション履歴
- per-tag 閾値の最適化
