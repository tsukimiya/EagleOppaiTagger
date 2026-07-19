# HANDOFF — Eagle OppaiOracle Tagger Plugin

> 前回セッションの作業引き継ぎ。次回セッション開始時に必ず読む。

## 最終作業日時

2026-07-19

## 前回の作業内容

- `src/downloader.js` を新規作成
  - HuggingFace から OppaiOracle V1.1 ONNX モデル3ファイルを DL
  - SHA256 検証（プレースホルダー運用）、レジューム、リトライ（最大3回・指数関数的バックオフ）、進捗コールバック
- `src/phase5-test.js` を新規作成
  - ネットワーク不要の単体テスト（https モック）
  - sha256File、URL 構築、Range ヘッダー、進捗コールバック、リトライ、レジュームを検証
- `src/ui.js` の `dl-btn` ハンドラーを更新
  - `downloader.downloadAll()` を呼び出し、進捗・成功・失敗を UI に反映
- `.spec/TODO.md` と `.spec/KNOWLEDGE.md` を更新

## 検証結果

- `node src/phase5-test.js` → 29 passed, 0 failed
- `node src/phase4-test.js` → 59 passed, 0 failed

## 次回の作業候補

- Phase 5 残タスク: ブラックリスト入力 UI と probsToTags への統合、README 更新
- 実際のモデル DL 検証（ネットワーク環境で `downloader.downloadAll()` を実行）
- 実ハッシュを `SHA256` マップに登録
