# TODO — Eagle OppaiOracle Tagger Plugin (v3)

> `SPEC.md` 確定後に実作業へ。各 Phase に **DoD（検証項目）** を組み込んでいる。
> Phase を完了したら該当行にチェックを入れ、`KNOWLEDGE.md` に学びを記録する。
> v3 で Phase 7-9（サーバ化対応）を追加。

---

## Phase 0: セットアップ・技術選定確定

- [ ] `.spec/` の PLAN / SPEC / TODO / KNOWLEDGE がユーザー承認済み
- [ ] `manifest.json` と最小 `index.html` を作成
- [ ] Eagle 開発者モードでプラグインフォルダを登録（シンボリックリンク推奨）
- [ ] 空プラグインが Eagle にロードされることを手動確認
- [ ] `package.json` に `jimp@^0.22.10` と `onnxruntime-node` を追加（スパイク時の実バージョンを固定）
- [ ] `npm install` → `node_modules` が生成されることを確認
- [ ] **調査**: `eagle.plugin.*` 系 API で設定保存手段があるか公式 doc を確認
  - なければ `localStorage` 採用を ADR 化（KNOWLEDGE.md に ADR 候補として記録）
- [ ] **DoD**: renderer から `require('onnxruntime-node')` / `require('jimp')` が成功する（スパイクと同等）
- [ ] **DoD**: 空プラグインが再起動後も Eagle に表示される

---

## Phase 1: 前処理パイプライン + Python ベリファイア

- [ ] `scripts/python-ref/app.py` として公式 `web_interface/app.py` をクローン
- [ ] `scripts/python-ref/README.md` に venv セットアップ手順と依存 (`onnxruntime`, `numpy`, `Pillow`) を明記
- [ ] サンプル画像3種（ショート・ワイド・ロングのアスペクト比）を `scripts/python-ref/samples/` に配置
- [ ] Python 側でサンプルを処理し、`pixel_values` と `padding_mask` を `expected_*.json` に保存
- [ ] `src/preprocess.js` を実装:
  - Jimp 画像ロード
  - 448×448 キャンバスをパッド色 [114,114,114] で生成
  - アスペクト比保持リサイズ（LANCZOS 等価）
  - 中央配置
  - `padding_mask` 構築（余白 = true）
  - `(x/255 - 0.5) / 0.5` 正規化
  - RGB → BCHW float32
- [ ] JS 側でサンプル処理 → Python 側 `expected_*.json` と比較するテストを `src/verify.js` に実装
- [ ] **DoD**: 平均誤差 < 1e-4
- [ ] **DoD**: `padding_mask` を画像化して出力し、余白領域が正しく `true` になっていることを目視確認

---

## Phase 2: ONNX 推論ラッパー

- [ ] V1.1 ONNX モデル一式を手動 DL して `models/V1.1/{model.onnx, selected_tags.csv, pr_thresholds.json}` に配置（`.gitignore` 済み）
- [ ] `src/inference.js` を実装:
  - `ort.InferenceSession.create()` でセッション生成（初回のみ・キャッシュ）
  - `pixel_values` / `padding_mask` テンサー構築
  - `session.run(feeds)` で推論
  - `results.probabilities.data` を返す
- [ ] `src/tags.js` を実装:
  - `selected_tags.csv` 読み込み・キャッシュ
  - `probsToTags(probs, { threshold, maxTags, blacklist })`
- [ ] サンプル画像1枚を推論 → タグトップ10をコンソール出力
- [ ] **DoD**: エラーなく完了し、`probabilities.length === 19294`
- [ ] **DoD**: Python 参照実装（`app.py`）の出力トップ10と比較し、順位の違いが ±2 位以内

---

## Phase 3: Eagle 連携

- [x] `src/eagle-bridge.js` を実装:
  - `getSelectedItems(fields)` ラッパー
  - `saveItem(item)` ラッパー
- [x] `src/main.js` のメインループ構築:
  - 選択画像取得
  - 各画像: preprocess → infer → probsToTags → mergeTags → save
  - 進捗コールバック（進行 / 完了 / エラー / キャンセル）
  - キャンセルフラグ監視（画像境界で break）`[- N4]`
- [x] `src/settings.js` を実装（localStorage load / save / reset）
- [x] `src/phase3-test.js` スタンドアロンテストを実装
- [ ] **DoD**: 手動で選択した画像1枚のタグが Eagle 上で更新される
- [ ] **DoD**: キャンセルボタンで次の画像境界で停止する（保存済みタグは保持）

---

## Phase 4: UI/UX

- [ ] `index.html` でレイアウト構築（ヘッダー / 設定 / 実行 / 進捗 / サマリ）
- [ ] `src/ui.js` でイベントハンドラ実装
- [ ] `src/settings.js` で設定の load / save（localStorage or Phase 0 調査結果による）
- [ ] 初回警告ダイアログ（NSFW タグ含有の告知・「今後表示しない」）
- [ ] 進捗バー・現在のファイル名・経過時間・推定残り時間
- [ ] 結果サマリ（処理枚数・平均時間・最終画像のタグ一覧）
- [ ] **DoD**: 設定変更 → 再起動 → 設定が保持される
- [ ] **DoD**: 100枚バッチで進捗バーが滑らかに動く
- [ ] **DoD**: キャンセルが即座に UI に反映する

---

## Phase 5: モデル配布・品質

- [x] `src/downloader.js` を実装:
  - HF から3ファイルを DL（model.onnx / selected_tags.csv / pr_thresholds.json）
  - SHA256 検証（ハードコード or `models.sha256` ファイル）
  - Range リクエストでレジューム対応
  - リトライ（最大3回・exponential backoff）
  - `onprogress` コールバック
- [x] ブラックリスト入力 UI と probsToTags への統合
- [x] `README.md`（配布用）に以下を明記:
  - 前提 Eagle バージョン
  - 初回 DL サイズと所要時間目安
  - NSFW タグ含有の告知
  - プライバシー（ローカル推論・クラウドへ送信しない）
- [ ] **DoD**: `models/` を削除 → プラグイン起動 → 初回 DL が完了し推論できる
- [ ] **DoD**: DL 中にネットワーク切断 → リトライ → 復帰でレジュームされる

---

## Phase 6: プロファイリング・配布

- [x] 100枚バッチで計測スクリプト実行:
  - 1枚あたり wall-clock（平均・中央値・p95）
  - `process.memoryUsage()` の rss / heapUsed ピーク
- [x] 目標値に対するギャップ分析（必要なら最適化）
- [x] `git archive` or 手動で配布 zip 作成（`models/` / `node_modules/` 除外）
- [ ] クリーン環境（別マシン or 別ユーザー）で展開 → 初回起動 → タグ付けまで完結するか検証
- [ ] **DoD**: 1枚5秒以内 / ピーク 2.5 GB 以下 / クリーン環境で完結（速度・メモリは検証済・クリーン環境検証が残り）
- [x] **DoD**: 配布 zip が 5 MB 以下

---

## Phase 7: 推論サーバ実装

- [ ] `server/requirements.txt` を作成（FastAPI, uvicorn[standard], onnxruntime-gpu, pillow, numpy, python-multipart）
- [ ] `server/model_loader.py` を実装:
  - `get_session(model_path)` — onnxruntime session 生成・キャッシュ
  - プロバイダー自動検出（CUDA → DirectML → CPU の優先順）
  - `get_provider_info()` — 使用中プロバイダー・GPU 名を返す
- [ ] `server/preprocess.py` を実装:
  - PIL で画像読み込み
  - letterbox（448×448・パッド色 [114,114,114]・アスペクト比保持）
  - `padding_mask` 構築（余白 = true）
  - `(x/255 - 0.5) / 0.5` 正規化
  - BCHW float32 テンソル + bool マスクを返す
  - **公式 `app.py` の `letterbox()` / `preprocess()` を流用**
- [ ] `server/main.py` を実装:
  - FastAPI アプリ・uvicorn で起動
  - `POST /infer` — multipart/form-data で画像受信 → 前処理 → 推論 → JSON（`probabilities`, `elapsed_ms`）返却
  - `GET /health` — ステータス・モデルロード状態・GPU 利用可能性
  - `GET /info` — バリアント・タグ数・プロバイダー・平均応答時間
  - 起動時にモデルをロード（バックグラウンドロード・ロード中は `/health` が `model_loaded: false` を返す）
- [ ] `server/README.md` を作成:
  - venv セットアップ手順
  - GPU 認識確認方法（`nvidia-smi` + `/health`）
  - 起動コマンド（`uvicorn main:app --host 0.0.0.0 --port 8000`）
  - CPU のみ環境での動作について
- [ ] `server/tests/test_api.py` を実装:
  - `/health` のレスポンス形式検証
  - `/infer` の正常推論（テスト画像使用）
  - `/infer` の不正入力エラー（空ファイル・非画像ファイル）
  - `/info` のモデル情報返却
- [ ] **DoD**: GPU 環境で `/infer` が正常に確率配列（19294次元）を返す
- [ ] **DoD**: `/health` で GPU 利用可能性が正しく報告される
- [ ] **DoD**: CPU のみ環境でも自動フォールバックで動作する

---

## Phase 8: プラグイン側クライアント化

- [ ] `src/inference-client.js` を実装:
  - `InferenceClient` クラス（`serverUrl`, `timeoutMs` をコンストラクタで指定）
  - `healthCheck()` — `GET /health` を fetch・結果を返す
  - `getServerInfo()` — `GET /info` を fetch・モデル情報を返す
  - `inferImage(imageBuffer, filename)` — `POST /infer` を multipart/form-data で送信・確率配列を返す
  - タイムアウト処理（デフォルト 30秒）
  - リトライ（最大1回・タイムアウト時のみ）
  - Node 組み込みの `http` モジュールを使用（npm 依存なし）
- [ ] `src/settings.js` に以下を追加:
  - `serverUrl`（デフォルト: `'http://localhost:8000'`）
  - `useServer`（デフォルト: `true`）
  - `serverTimeoutMs`（デフォルト: `30000`）
  - `fallbackOnServerError`（デフォルト: `true`）
  - 既存設定との後方互換性を維持（`DEFAULTS` に追加するのみ）
- [ ] `src/main.js` の推論ルートを改修:
  - `useServer === true` → `healthCheck()` → OK なら `inferImage()` でサーバ推論
  - ヘルス NG or `useServer === false` → `inference.js` のローカル推論
  - サーバ推論中にネットワークエラー → `fallbackOnServerError` に応じてフォールバック or エラースロー
  - 既存の `preprocess` / `infer` / `probsToTags` / `mergeTags` / `save` パイプラインはローカル経路として維持
- [ ] `src/ui.js` にサーバ設定 UI を追加:
  - サーバ URL 入力フィールド
  - 「サーバを使用」チェックボックス
  - フォールバック設定（ラジオ: 自動切替 / エラー停止）
  - サーバステータス表示（ヘッダーに接続状態アイコン）
  - 「接続テスト」ボタン（`healthCheck()` を実行して結果表示）
- [ ] `src/phase8-test.js` を実装:
  - `InferenceClient` の URL 構築・ヘッダー生成
  - タイムアウト処理の動作
  - `main.js` のルーティング判定（サーバ ON/OFF・ヘルス OK/NG）
  - フォールバック動作（サーバエラー → ローカル）
  - `require.cache` を使ったモック（実際のネットワーク接続なし）
- [ ] **DoD**: サーバ接続時に `/infer` 経由で推論が成功し、Eagle にタグが書き込まれる
- [ ] **DoD**: サーバ停止時にローカル推論に自動フォールバックする
- [ ] **DoD**: フォールバック無効時にサーバエラーが正しく UI に通知される

---

## Phase 9: 統合テスト・プロファイリング

- [ ] 推論サーバを GPU 環境で起動（`server/` のセットアップ手順に従う）
- [ ] プラグインからサーバリクエスト → 推論結果確認:
  - 10枚程度の画像でサーバ経由推論を実行
  - タグ出力がローカル推論と一致することを確認（±2位以内）
- [ ] ローカルフォールバック動作確認:
  - サーバ停止 → プラグインで実行 → 自動切替を確認
  - フォールバック無効設定 → サーバ停止 → エラー表示を確認
- [ ] サーバ vs ローカルのベンチマーク:
  - 同一の100枚バッチをサーバ（GPU）とローカル（CPU）で実行
  - 1枚あたり wall-clock（平均・中央値・p95）を計測
  - 結果を `KNOWLEDGE.md` に記録
- [ ] ネットワークエラー耐性テスト:
  - 100枚バッチ実行中にサーバを一時停止 → フォールバック → 再開
  - タイムアウト発生時の挙動確認
- [ ] **DoD**: サーバ経由がローカルより高速であることを確認（GPU 環境で実測）
- [ ] **DoD**: 100枚バッチでネットワークエラー → フォールバック → 完遂する
- [ ] **DoD**: サーバ `/info` のタグハッシュとクライアント側の `selected_tags.csv` が一致

---

## Phase 10: 自動タグ付け（Window 内自動化）

> SPEC §15 参照。Phase 11 で Background Service 化（`serviceMode: true`）を検討。

- [ ] `src/settings.js` に `autoMode` 設定追加（enabled / pollIntervalSec / maxConsecutiveErrors）
- [ ] `src/eagle-bridge.js` にラッパー追加:
  - `getIdsWithModifiedAt()`
  - `getUntagged(fields)`
  - `countUntagged()`
- [ ] `src/auto-tagger.js` を新規実装:
  - `start()` / `stop()` / `isRunning()`
  - setInterval ベースのポーリングループ
  - 新規画像 → 既存未タグ付けの優先度付きキュー
  - `lastScanAt` の localStorage 読み書き
  - 連続エラーカウント + 自動停止
  - `pauseForManualRun()` / `resumeAfterManualRun()`（排他制御）
- [ ] `src/main.js` に排他制御追加:
  - `run()`（手動）開始時: 自動ループを一時停止
  - `run()` 終了時: 自動ループを resume
- [ ] `src/ui.js` に自動モード UI イベント追加:
  - トグル・間隔スライダー・状態表示
  - 初回 ON 時の NSFW 警告（別キー）
  - 連続エラー停止時の表示
- [ ] `index.html` に自動モード セクション追加
- [ ] `src/phase10-test.js` を新規実装:
  - ポーリングロジック（モック Eagle API）
  - 新規 vs 既存の優先度
  - 連続エラー停止
  - 手動との排他
  - lastScanAt の永続化
- [ ] **DoD**: 自動モード OFF（デフォルト）→ 何も起きない
- [ ] **DoD**: 自動モード ON → 新規画像を追加 → 60秒以内にタグ付与
- [ ] **DoD**: 既存の未タグ付け画像が順次タグ付けされる
- [ ] **DoD**: 手動「実行」中は自動ポーリングが一時停止する
- [ ] **DoD**: プラグインウィンドウを閉じて再び開くと resume する
- [ ] **DoD**: 連続5回エラーで自動停止 + UI に理由表示
- [ ] **DoD**: 既存テスト（87+ tests）が全て PASS（回帰なし）

---

## 完了後の仕上げ（全 Phase 共通）

- [ ] `KNOWLEDGE.md` に全 Phase の学びを集約
- [ ] ADR 候補を doc-writer skill で正式起票（KNOWLEDGE.md 参照）
- [ ] `.sisyphus/plans/eagle-oppai-tagger.md`（v1）に「v2 で差し替え済み」のリンクを追記
- [ ] Momus で v2 plan の最終レビュー（任意）
