# KNOWLEDGE — Eagle OppaiOracle Tagger Plugin

> セッションをまたぐ学び・ADR 候補を蓄積する。本ファイルは200行以内を維持。
> `AGENTS.md` と重複する内容は書かない。

---

## B1 スパイク結果（2026-07-18）

### 実環境情報（確定）

| 項目 | 値 |
|------|-----|
| Chromium | 108.0.5359.215（公式 doc の「107」より新しい） |
| Node.js | 16.17.1（modules ABI = 99） |
| Electron | 22.3.7 |
| プラットフォーム | win32 / x64 |
| renderer `require` | グローバル `require` 利用可（nodeIntegration 有効） |
| 実 cwd | `C:\WINDOWS\system32`（Eagle 本体プロセス起動のため） |

### 判定

- `require('onnxruntime-node')` ✓
- `new ort.Tensor()` ✓
- `InferenceSession.create('__not_exist__.onnx')` → "File doesn't exist" エラー
  - **ネイティブ `OnnxruntimeSessionHandler` まで到達** = 完全動作の決定的証拠
- `ort.env.backend.providers` / `ort.getAvailableProviders` API 無し（古めの onnxruntime-node が入った）
  - → バージョン固定の必要性を裏付け

### スパイクで学んだ実装上の注意

- **全パスは `__dirname` 基準**で構築する（cwd が system32 になるため）
- renderer で `require` が直接使えるので、main プロセス分割は不要
- 診断スクリプトは spikes ディレクトリに残す（将来の OS 追加時に再利用）

---

## ADR 候補（doc-writer で正式起票予定）

### ADR-1: onnxruntime-node をローカル推論エンジンとして採用

- **Context**: B1 ブロッカー（Eagle Electron ABI 不整合リスク）を検証するためスパイク実施
- **Decision**: `onnxruntime-node` を採用。`onnxruntime-web` (WASM) / 別プロセス spawn / リモート API は不採用
- **根拠**: スパイク PASS。ネイティブバイナリが Electron 22.3.7 / Node 16.17.1 / modules ABI 99 でロード成功
- **影響**: ローカル完結・NSFW コンテンツのクラウド送信なし・1GB の初回 DL が必要

### ADR-2: V1.1 固定（V1 バリアントはスコープ外）

- **Context**: v1 plan は V1 / V1.1 両対応を謳っていたが、ONNX 入力仕様が V1.1 (448×448) でしか書かれていなかった（B3）
- **Decision**: V1.1 固定。V1 (320×320) はユーザー要望が出るまで対応しない
- **根拠**: V1.1 の方が精度が高い・2バリアント両対応は前処理パイプラインが複雑化・MVP では片方で十分

### ADR-3: Jimp v0.22.x を画像前処理に採用

- **Context**: Sharp（ネイティブ）は高速だが onnxruntime-node と同じ Eagle Electron ABI 問題を抱える（W5）
- **Decision**: pure JS の Jimp を採用。Sharp は不採用
- **根拠**: ABI リスク回避。速度が問題になれば Phase 6 で Sharp 別スパイクを検討
- **注意**: Jimp v0 と v1 で API が異なるため `^0.22.10` で固定

### ADR-4: モデルは初回 DL 方式（SHA256 + レジューム付き）

- **Context**: 1GB 近いモデルを配布 zip に同梱すると巨大化（W7）
- **Decision**: HuggingFace から初回起動時に DL。SHA256 検証・Range リクエストによるレジューム・リトライ付き
- **根拠**: 配布サイズ抑制・Integrity 保証・ユーザー環境で DL 成否を早期検出

### ADR-5: グローバル閾値を MVP とする（per-tag は拡張）

- **Context**: モデルに `pr_thresholds.json` が同梱されているが、MVP では単純化が優先
- **Decision**: MVP はグローバル閾値（0.5 デフォルト）＋上位 N 件。per-tag は拡張機能
- **根拠**: UI 複雑化を避ける・ユーザーのチューニング容易性を優先

### ADR-6: Background Service / 自動タグ付けは将来保留

- **Context**: Eagle Event API に `onItemAdd` が無く、ポーリングはコスト過大（B2）
- **Decision**: 自動タグ付け機能は実装しない。ユーザー起動の Window Plugin のみ
- **根拠**: ポーリングは CPU / メモリ常時消費・Event API 拡張を待つ方が合理的

### ADR-7: 設定永続化は localStorage（要調査で Eagle 专用 API 切替）

- **Context**: Eagle Plugin API に設定 API の有無が不明（W6）
- **Decision**: デフォルトは `localStorage`。Phase 0 で `eagle.plugin.*` を調査し、存在すれば切替
- **根拠**: Chromium 系で確実動作・Eagle 専用 API があれば利便性向上

---

## v1 plan 敵対的検証の主要知見

- **Momus の形式レビューは shallow**: API 実在性を Web 確認せず「URL があるから OK」と扱い、致命的ブロッカー（onnxruntime-node ABI）を見落とした。実質検証は librarian と自前精読で賄う必要がある
- **外部依存の検証は必須**: HuggingFace モデルの実在仕様・Eagle API の正確な形状・ネイティブモジュールの ABI は、plan の前提になりやすいので librarian で裏付けを取る
- **Spike を plan 承認前に打つ**: 中核技術（onnxruntime-node）が実環境で動くかは plan レビューだけでは確定しない。スパイクで danger zone を早期に潰す

---

## Phase 3 — Eagle 連携

- `src/eagle-bridge.js` は `eagle.item.getSelected()` / `item.save()` の薄いラッパーに留め、テスト時は `global.eagle` を差し替え可能にした。
- `src/settings.js` は `localStorage` を基本としつつ、`localStorage` が存在しない Node 環境では自動的に in-memory フォールバックする。テストでは `global.localStorage` をモックして実際の永続化を検証できる。
- `src/main.js` のループは「現在の画像を最後まで処理し、次の画像を開始しない」というキャンセル戦略を実装。保存済みタグはロールバックしない（SPEC §6）。
- 進捗コールバックは `processing` / `done` / `error` / `cancelled` の4状態を通知し、UI 側でプログレスバー・サマリを更新できる。
- テストでは `require.cache` をクリアして `preprocess` / `inference` / `tags` をモックし、Eagle ランタイムなしで `run()` のキャンセル伝搬を検証した。

## Phase 5 — モデルダウンローダー

- `src/downloader.js` は Node 組み込みの `https` / `fs` / `crypto` / `path` のみで実装。npm 依存を追加しない。
- SHA256 ハッシュは初回 DL 前に不明なため、プレースホルダー値で運用。`verifySha256()` はプレースホルダー時に検証をスキップし、実ハッシュをコンソールに出力してユーザーが手動で登録できるようにする。
- レジュームは `targetPath + ".tmp"` の既存サイズを `Range: bytes={size}-` として送信。206 なら append、200 なら overwrite、416 なら tmp を削除して再開。
- リトライは `withRetry()` で最大 3 回、遅延は 1s / 2s / 4s の指数関数的バックオフ。
- `src/phase5-test.js` ではネットワークを使わず、`require.cache` を使って `https` モジュールをモックし、URL 構築、Range ヘッダー、進捗コールバック、リトライ、レジュームを検証する。EventEmitter ベースの偽レスポンスに `resume()` / `pipe()` / `destroy()` を実装することで、実際のストリームを模倣。
