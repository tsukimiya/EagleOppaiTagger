# PLAN — Eagle OppaiOracle Tagger Plugin

> SDD の PLAN.md は人間の口頭メモ・自由記述を想定。構造化仕様は `SPEC.md` 参照。

## 一言で

Eagle 上で画像を選択してボタンを押したら、OppaiOracle（Danbooru 系アニメ画像タガー）が自動タグ付けして、Eagle の `tags` に書き戻すプラグインが欲しい。

## 背景・気持ち

- Danbo 系画像を Eagle で整理しているが、手タグ付けが限界
- OppaiOracle は精度が良く ONNX でも提供されているので、ローカル推論で完結したい
- NSFW 含むドメインなので、クラウド API に勝手に送る構成にはしたくない（プライバシ・利用規約の観点）

## 前提（確定）

- 実行環境: Eagle 4.x（Chromium 108 / Node 16.17.1 / Electron 22.3.7 / Windows x64 で確認）
- モデル: HuggingFace `Grio43/OppaiOracle` V1.1 ONNX（448x448 / 19,294 クラス / General-only）
- 推論エンジン: `onnxruntime-node`（B1 スパイク PASS 済み・renderer からグローバル `require` で直接呼べる）

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
