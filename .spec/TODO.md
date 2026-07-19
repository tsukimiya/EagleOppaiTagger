# TODO — Eagle OppaiOracle Tagger Plugin (v2)

> `SPEC.md` 確定後に実作業へ。各 Phase に **DoD（検証項目）** を組み込んでいる。
> Phase を完了したら該当行にチェックを入れ、`KNOWLEDGE.md` に学びを記録する。

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
- [ ] ブラックリスト入力 UI と probsToTags への統合
- [ ] `README.md`（配布用）に以下を明記:
  - 前提 Eagle バージョン
  - 初回 DL サイズと所要時間目安
  - NSFW タグ含有の告知
  - プライバシー（ローカル推論・クラウドへ送信しない）
- [ ] **DoD**: `models/` を削除 → プラグイン起動 → 初回 DL が完了し推論できる
- [ ] **DoD**: DL 中にネットワーク切断 → リトライ → 復帰でレジュームされる

---

## Phase 6: プロファイリング・配布

- [ ] 100枚バッチで計測スクリプト実行:
  - 1枚あたり wall-clock（平均・中央値・p95）
  - `process.memoryUsage()` の rss / heapUsed ピーク
- [ ] 目標値に対するギャップ分析（必要なら最適化）
- [ ] `git archive` or 手動で配布 zip 作成（`models/` / `node_modules/` 除外）
- [ ] クリーン環境（別マシン or 別ユーザー）で展開 → 初回起動 → タグ付けまで完結するか検証
- [ ] **DoD**: 1枚5秒以内 / ピーク 2.5 GB 以下 / クリーン環境で完結
- [ ] **DoD**: 配布 zip が 5 MB 以下

---

## 完了後の仕上げ（全 Phase 共通）

- [ ] `KNOWLEDGE.md` に全 Phase の学びを集約
- [ ] ADR 候補を doc-writer skill で正式起票（KNOWLEDGE.md 参照）
- [ ] `.sisyphus/plans/eagle-oppai-tagger.md`（v1）に「v2 で差し替え済み」のリンクを追記
- [ ] Momus で v2 plan の最終レビュー（任意）
