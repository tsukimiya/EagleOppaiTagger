# SPEC — Eagle OppaiOracle Tagger Plugin (v2)

> v1 plan (`.sisyphus/plans/eagle-oppai-tagger.md`) の敵対的検証結果を反映した確定版。
> 検証レポートの blocker / warning / nitpick の反映状況は各セクション末尾に `[- Bn/Wn/Nn]` で明示。

---

## 1. 目的・スコープ

Eagle 上で選択した画像に対し、HuggingFace `Grio43/OppaiOracle` モデル（ONNX）で**ローカル推論**を行い、結果を Eagle の `tags` に書き戻す Window プラグインを開発する。

### スコープ内（MVP）

- 選択画像を一括タグ付け（Window Plugin・ユーザー起動）
- V1.1 ONNX（448×448）で推論
- グローバル閾値スライダー・最大タグ数設定
- 進捗表示・キャンセル
- タグマージ戦略（追加 / 上書き / 差分）の切替
- 設定の `localStorage` 永続化

### スコープ外

- モデルの再学習・ファインチューニング
- 動画へのタグ付け
- V1（320×320）バリアント対応 `[- B3]`
- `explicit` / `questionable` / `safe` 等の分類タグ付与（General-only モデルでは出力不可） `[- W1]`
- Background Service による自動タグ付け（Event API に `onItemAdd` 無し・ポーリングはコスト過大） `[- B2]`
- 多言語 UI の本格サポート（日本語デフォルト・英語辞書は拡張機能） `[- N5]`

---

## 2. 前提調査結果（確定）

### 2.1 実行環境 `[- B1 解消 by spike]`

スパイク（`.sisyphus/spikes/b1-onnxruntime-load/`）で実測した環境:

| 項目 | 実測値 | 備考 |
|------|--------|------|
| Eagle 同梱 Chromium | **108.0.5359.215** | 公式 doc の「107」より新しい。Eagle 側の無言アップデート |
| Node.js | **16.17.1** | modules ABI = **99**（Node 16.x 系） |
| Electron | **22.3.7** | |
| プラットフォーム | win32 / x64 | 他 OS は未検証（将来要追加スパイク） |
| renderer の `require` | **グローバル `require` 利用可** | `nodeIntegration` 有効・main/renderer 分離不要 |
| 実 cwd | `C:\WINDOWS\system32`（Eagle 本体プロセス起動のため） | **コードは `__dirname` 基準でパス解決すること** |

### 2.2 使用する Eagle API

`librarian 検証済み（VERIFIED）`:

| API | 用途 | 公式 doc |
|-----|------|---------|
| `eagle.item.getSelected()` | 選択中アイテム取得 | [item API](https://developer.eagle.cool/plugin-api/api/item.md) |
| `eagle.item.get({ isSelected, fields })` | フィールド絞り込み取得 | 同上 |
| `item.tags = [...]` + `await item.save()` | タグ更新・永続化 | 同上 |
| `require('fs')` / `require('path')` | Node ネイティブ | [Node.js Native API](https://developer.eagle.cool/plugin-api/tutorial/node-js-native-api.md) |
| `require('onnxruntime-node')` | ローカル推論 | [3rd Modules](https://developer.eagle.cool/plugin-api/tutorial/3rd-modules.md) |
| CORS | 制限なし | [Introduction](https://developer.eagle.cool/plugin-api/get-started/readme.md) |

**最小 Eagle バージョン**: Build12+（Plugin API 一般提供開始版）。`[- N3]`
※開発・検証はユーザー環境の Build18 で実施。

### 2.3 OppaiOracle モデル仕様

`librarian 検証済み（HuggingFace の実ファイル一次確認）`:

| 項目 | V1.1（採用） | V1（不採用） |
|------|--------------|--------------|
| 入力解像度 | **448×448** | 320×320 |
| 形式 | `model.onnx`（993 MB） | `model.onnx`（992 MB） |
| 出力クラス数 | 19,294 | 19,294 |
| タグ種別 | General-only（`category=0` のみ） | 同左 |
| モデルサイズ | 約 993 MB | 約 992 MB |
| ライセンス | Apache 2.0 | Apache 2.0 |

> safetensors 版は V1.1 が bfloat16（496 MB）だが、ONNX で運用するため今回は不使用。

### 2.4 ONNX 入力・出力（V1.1） `[- B3: V1.1 専用と明記]`

`V1.1_onnx/preprocessing.json` より:

- **入力 `pixel_values`**: `(batch, 3, 448, 448)`, **float32**, **BCHW**
- **入力 `padding_mask`**: `(batch, 448, 448)`, **bool** → letterbox 余白領域を `true` に設定（`[- W3]`）
- **出力 `probabilities`**: `(batch, 19294)`, sigmoid **適用済み**（活性化関数不要）
- **前処理**: `RGB` / `letterbox` / pad `[114, 114, 114]` / normalize `(x/255 - 0.5) / 0.5`
- **opset**: 20

### 2.5 閾値

- `pr_thresholds.json`（全4バリアント ディレクトリに同梱）に per-tag P=R 閾値入り
- `skip_indices: [0, 1]` で `<PAD>` / `<UNK>` を除外
- **MVP はグローバル閾値（0.5 をデフォルト）**＋上位 N 件 `[- W8/#4]`
- per-tag 閾値は拡張機能

### 2.6 公式参照実装 `[- W4]`

`https://huggingface.co/Grio43/OppaiOracle/blob/main/web_interface/app.py`

- Gradio Web UI と統合された Python 実装
- 主要関数: `letterbox()` / `preprocess()` / `predict()`
- `onnxruntime` を使用、プロバイダーは Dml / CUDA / CPU を自動検出
- **前処理ベリファイアはこの実装の出力を基準にする（誤差 < 1e-4）**

---

## 3. 機能要件

### 3.1 MVP（最小実装）

- [ ] Eagle 上で選択中の画像を取得
- [ ] OppaiOracle V1.1 ONNX モデルで推論
- [ ] 推論結果を Eagle タグとして保存
- [ ] 閾値スライダー（グローバル・0.0〜1.0・デフォルト 0.5）
- [ ] 最大タグ数設定（デフォルト 30）
- [ ] マージ戦略切替（追加 / 上書き / 差分）
- [ ] 進捗表示・キャンセル
- [ ] 設定の `localStorage` 永続化 `[- W6]`
- [ ] NSFW タグの警告表示（初回のみ・設定で非表示化可）

### 3.2 拡張（実装しやすい順）

- [ ] モデルの整合性チェック（SHA256）・レジューム付き DL `[- W7]`
- [ ] ブラックリスト / ホワイトリスト
- [ ] フォルダ単位・未タグ付け画像のみの一括処理
- [ ] per-tag 閾値の使用
- [ ] 結果プレビュー（dry-run モード）

**スコープ外に移動** `[- W1, B2, B3]`:
- ~~explicit / questionable / safe 等の分類タグ~~ → General-only モデルでは出力不可
- ~~Background Service での自動タグ付け~~ → Event API に `onItemAdd` 無し
- ~~V1 / V1.1 バリアント切り替え~~ → V1.1 固定

---

## 4. 非機能要件

| 項目 | 目標 | 計測方法 `[- N6]` |
|------|------|------------------|
| 処理速度 | 1画像あたり 5 秒以内（CPU） | 100枚バッチの wall-clock / N |
| メモリ（1枚推論） | ピーク 1.5 GB 以下 | `process.memoryUsage().heapUsed` + 外部メモリ推定 |
| メモリ（100枚バッチ） | ピーク 2.5 GB 以下 | バッチ前後の `rss` 差分 |
| 互換性 | Eagle 4.0 Build12+ / win32 x64 | macOS / Linux は追加スパイク後に宣言 |
| 配布サイズ | 本体 5 MB 以下（モデル別途 DL） | zip 圧縮後 |
| 初回起動 DL | モデル 1 GB・5分以内（ブロードバンド） | レジューム機能付き |

---

## 5. アーキテクチャ

```text
┌────────────────────────────────────────────┐
│  Eagle App (Chromium 108 / Node 16.17.1)   │
│  ┌──────────────────────────────────────┐  │
│  │ Plugin Window (index.html / JS)      │  │
│  │  - 設定 UI / 進捗 / 結果プレビュー    │  │
│  │  - renderer で直接 require() 可能     │  │
│  └────────┬─────────────────────────────┘  │
│           │ global require() (nodeIntegration) │
│  ┌────────▼─────────────────────────────┐  │
│  │ ロジック（renderer プロセス内）       │  │
│  │  - image load (jimp) / preprocessing │  │
│  │  - onnxruntime-node 推論              │  │
│  │  - Eagle API write                    │  │
│  │  - localStorage 設定                  │  │
│  └────────┬─────────────────────────────┘  │
│  ┌────────▼─────────────────────────────┐  │
│  │ Eagle Plugin API                      │  │
│  │  eagle.item.get / save                │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘

外部:
  HuggingFace（初回 DL のみ）  ──  model.onnx / selected_tags.csv / pr_thresholds.json
```

### プラグインタイプ

- **MVP**: Window Plugin のみ
- **将来**: Background Service は Event API の拡張（`onItemAdd` 等）が追加されるまで保留 `[- B2]`

---

## 6. データフロー

1. ユーザーが Eagle 内で画像を選択（複数可）
2. プラグインウィンドウを開く
3. 初回起動時: モデル未ダウンロードなら DL（SHA256 検証・レジューム付き）`[- W7]`
4. UI で閾値・最大タグ数・マージ戦略を設定（`localStorage` に保存）`[- W6]`
5. 「実行」ボタン
6. `eagle.item.getSelected()` で選択画像を取得（`fields: ['id','name','filePath','tags']`）
7. 各画像:
   1. `jimp.read(filePath)` で画像ロード
   2. 前処理（letterbox / normalize / BCHW / `padding_mask` 構築）`[- W3]`
   3. `ort.InferenceSession.run()` で推論（セッションは初回生成してキャッシュ）
   4. 確率 → タグ変換（`selected_tags.csv` 参照・`<PAD>` / `<UNK>` 除外）
   5. 既存タグとマージ（選択戦略に従う）
   6. `await item.save()` で Eagle に反映
   7. 進捗更新
   8. キャンセル要求をチェック（`AbortController` 風フラグ）`[- N4]`
8. 完了サマリ表示

### キャンセル戦略 `[- N4]`

- キャンセルボタン押下 → 次の画像境界で停止（推論中のアイテムは最後まで完了）
- 保存済みタグはロールバックしない（ユーザーが Eagle の undo で対処）
- 進捗表示に「キャンセル済み・N/M 枚処理」と明示

---

## 7. 主要実装詳細

### 7.1 画像前処理（Jimp） `[- W3, W5, N7]`

`package.json` で **Jimp バージョンを固定**（v0 と v1 で API が異なるため）:

```json
{ "dependencies": { "jimp": "^0.22.10" } }
```

前処理手順（`web_interface/app.py` の `letterbox()` + `preprocess()` に一致させる）:

```text
1. Jimp.read(filePath)
2. 新キャンバス 448×448 をパッド色 [114,114,114] で塗りつぶし
3. 元画像をアスペクト比を保って 448×448 に収まるようリサイズ（HALMIT filter='LANCZOS' 等価）
4. 中央配置でキャンバスに貼り付け
5. padding_mask (448×448 bool) を構築:
   - letterbox 余白領域 = true
   - 元画像領域 = false
6. 各ピクセルを [0,1] に正規化 → (x/255 - 0.5) / 0.5
7. RGB → BCHW float32 テンソル化
```

**ベリファイア**: Python 参照実装（`app.py`）で同画像を処理し、テンソルの平均誤差 < 1e-4 を確認。`[- W4, W3]`

### 7.2 推論（onnxruntime-node）

`package.json` で onnxruntime-node バージョンを固定（スパイクで `listSupportedBackends` / `registerBackend` API を持つ版が入った）:

```json
{ "dependencies": { "onnxruntime-node": "^1.18.0" } }
```

※実際にスパイクで入ったバージョンは Phase 0 で `npm ls onnxruntime-node` で確認して固定。

```javascript
const path = require('path');
const ort = require('onnxruntime-node');

const MODEL_PATH = path.join(__dirname, '..', 'models', 'V1.1', 'model.onnx');
let _session = null;

async function getSession() {
  if (_session) return _session;
  _session = await ort.InferenceSession.create(MODEL_PATH);
  return _session;
}

async function infer(preprocessed) {
  // preprocessed = { pixel_values: Float32Array, padding_mask: Uint8Array }
  const session = await getSession();
  const feeds = {
    pixel_values: new ort.Tensor('float32', preprocessed.pixel_values, [1, 3, 448, 448]),
    padding_mask: new ort.Tensor('bool', preprocessed.padding_mask, [1, 448, 448]),
  };
  const results = await session.run(feeds);
  return results.probabilities.data; // Float32Array(19294), sigmoid 済み
}
```

**注意**: cwd が `C:\WINDOWS\system32` になるため、**すべてのパスは `__dirname` 基準**で構築。`[- §2.1 より]`

### 7.3 タグへの変換

```javascript
const SELECTED_TAGS_PATH = path.join(__dirname, '..', 'models', 'V1.1', 'selected_tags.csv');
// 起動時に1回読み込んでキャッシュ: string[] (index 0 = "<PAD>", 1 = "<UNK>", 2... = 実タグ)

function probsToTags(probs, { threshold, maxTags, blacklist }) {
  return Array.from(probs)
    .map((p, i) => ({ i, p }))
    .filter(x => x.i >= 2)                  // <PAD>, <UNK> を除外
    .filter(x => x.p >= threshold)
    .filter(x => !blacklist.has(SELECTED_TAGS[x.i]))
    .sort((a, b) => b.p - a.p)
    .slice(0, maxTags)
    .map(x => SELECTED_TAGS[x.i]);
}
```

### 7.4 Eagle 書き込み

```javascript
function mergeTags(existing, predicted, strategy) {
  switch (strategy) {
    case 'overwrite': return [...predicted];
    case 'diff':      return existing.filter(t => !predicted.includes(t)).concat(predicted);
    case 'append':
    default:          return [...new Set([...existing, ...predicted])];
  }
}

for (const item of items) {
  if (cancelRequested) break;  // [- N4]
  const pre = preprocess(await jimpRead(item.filePath));
  const probs = await infer(pre);
  const predicted = probsToTags(probs, settings);
  item.tags = mergeTags(item.tags, predicted, settings.mergeStrategy);
  await item.save();
  reportProgress(item);
}
```

### 7.5 設定永続化 `[- W6]`

**デフォルト**: `localStorage`（Chromium 系で確実動作）。

```javascript
const SETTINGS_KEY = 'eagle-oppai-tagger:settings';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? defaultSettings(); }
  catch { return defaultSettings(); }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
```

**Phase 0 で調査**: Eagle 専用の設定保存 API（`eagle.plugin.config` 等）があれば切替。無ければ localStorage 継続。

### 7.6 モデル配布 `[- W7]`

初回起動時に HuggingFace からダウンロード:

- URL: `https://huggingface.co/Grio43/OppaiOracle/resolve/main/V1.1_onnx/model.onnx` 他
- 保存先: `<plugin-folder>/models/V1.1/{model.onnx, selected_tags.csv, pr_thresholds.json}`
- **SHA256 チェックサム**をハードコード（または `manifest.json` 別ファイルに）。DL 後必須検証
- **レジューム**: Range リクエスト対応（`Range: bytes=N-`）。中断後再開可
- リトライ: 最大3回（exponential backoff）
- 進捗: `onprogress` コールバックで UI に反映

---

## 8. UI/UX

### ウィンドウサイズ

640×480（Eagle 公式例のデフォルト値・最小サイズも同値に固定してリサイズ無効化）`[- N3 補足]`

### 画面構成

1. **ヘッダー**
   - モデル状態（未 DL / DL 中 N% / DL 済み）
   - 初回 DL ボタン（未 DL 時のみ）
2. **設定エリア**（localStorage に自動保存）
   - 閾値スライダー（0.0〜1.0・0.05 刻み・デフォルト 0.5）
   - 最大タグ数（1〜100・デフォルト 30）
   - マージ戦略: 追加 / 上書き / 差分（ラジオ）
   - ブラックリスト入力（カンマ区切り）
3. **実行エリア**
   - 対象: 選択画像（MVP ではこれのみ）
   - 実行 / キャンセル ボタン
4. **進捗エリア**
   - プログレスバー（N / M 枚）
   - 現在処理中のファイル名
   - 経過時間 / 推定残り時間
5. **結果サマリ**（実行完了時）
   - 処理した枚数・平均処理時間
   - 最後に処理した画像と付与タグ一覧

### 初回警告ダイアログ

- 「OppaiOracle は汎用アニメ画像タガーで、語彙に NSFW タグを含みます。結果の運用は自己責任で行ってください」
- 「今後表示しない」チェックボックス

### i18n `[- N5]`

- **MVP**: 日本語固定
- **拡張**: `locales/{ja,en}.json` 形式で辞書化。`navigator.language` で自動切替（将来）

---

## 9. プロジェクト構成

```text
EagleOppaiTagger/
├── manifest.json
├── index.html
├── package.json
├── package-lock.json
├── README.md                # 配布用
├── LICENSE                  # Apache 2.0 + 本プラグインのライセンス
├── src/
│   ├── main.js              # エントリ・IPC 風のUI接続
│   ├── ui.js                # UI イベントハンドラ
│   ├── inference.js         # ONNX 推論・セッション管理
│   ├── preprocess.js        # Jimp 前処理（letterbox / normalize / mask）
│   ├── tags.js              # selected_tags 読み込み・probsToTags
│   ├── eagle-bridge.js      # Eagle API ラッパー
│   ├── settings.js          # localStorage 設定管理
│   ├── downloader.js        # モデル DL（SHA256・レジューム・リトライ）
│   └── verify.js            # Python 参照実装との照合ユーティリティ
├── assets/
│   └── logo.png
├── models/                  # .gitignore（実行時 DL）
│   └── V1.1/
│       ├── model.onnx
│       ├── selected_tags.csv
│       └── pr_thresholds.json
├── scripts/
│   └── python-ref/          # app.py のクローン・venv 手順書
└── node_modules/
```

### `manifest.json`

```json
{
  "id": "com.example.eagle-oppai-tagger",
  "version": "0.1.0",
  "name": "OppaiOracle Tagger",
  "logo": "/assets/logo.png",
  "keywords": ["tag", "ai", "image", "classify"],
  "main": {
    "url": "index.html",
    "width": 640,
    "height": 480,
    "minWidth": 640,
    "minHeight": 480,
    "maxWidth": 640,
    "maxHeight": 480
  }
}
```

`[- N3 補足]`: `min` / `max` を同値にしてリサイズ無効化（UI がシンプルなので）。

---

## 10. 開発フェーズとタスク（DoD 組み込み） `[- N2]`

各 Phase に検証（テスト）を DoD として組み込む（Phase 6「テスト」分離を廃止）。

### Phase 0: セットアップ・技術選定確定

- [ ] `manifest.json` と空 `index.html` を作成
- [ ] Eagle 開発者モードで空プラグインがロードされることを確認
- [ ] `package.json` で `jimp@^0.22.10` / `onnxruntime-node` を固定（スパイク時のバージョンを採用）
- [ ] Eagle 専用の設定保存 API の有無を調査（`eagle.plugin.*` 等）→ 無ければ localStorage 採用を ADR 化
- [ ] **DoD**: 空プラグイン起動 + `require('onnxruntime-node')` / `require('jimp')` が renderer から成功

### Phase 1: 前処理パイプライン + ベリファイア `[- W3, W4, N2]`

- [ ] `scripts/python-ref/` に `app.py` と venv セットアップ手順を配置
- [ ] Python 参照実装でサンプル画像を処理し、テンソルを `expected.json` に保存
- [ ] JS 側 `preprocess.js` 実装
- [ ] 同画像で `preprocess.js` を走らせ、`expected.json` と比較
- [ ] **DoD**: 平均誤差 < 1e-4（Float32 の丸め以内）
- [ ] **DoD**: `padding_mask` の余白領域が `true` になっていることを視覚確認（画像化して出力）

### Phase 2: ONNX 推論ラッパー

- [ ] V1.1 ONNX モデルを手動で `models/V1.1/` に配置
- [ ] `inference.js` 実装（セッション生成・キャッシュ・実行）
- [ ] `selected_tags.csv` / `pr_thresholds.json` を `tags.js` で読み込み
- [ ] サンプル画像で推論 → タグトップ10をコンソール出力
- [ ] **DoD**: 推論がエラーなく完了し、19294 次元の `probabilities` が返る
- [ ] **DoD**: 出力タグトップ10が Python 参照実装と（おおむね）一致

### Phase 3: Eagle 連携

- [ ] `eagle-bridge.js` 実装
- [ ] 選択画像取得 → 推論 → タグ書き込みの最小ループ
- [ ] 進捗コールバック
- [ ] キャンセル処理（画像境界で停止）`[- N4]`
- [ ] **DoD**: 選択画像1枚のタグが Eagle 上で更新される
- [ ] **DoD**: キャンセルボタンで次の画像境界で停止する

### Phase 4: UI/UX

- [ ] `index.html` / `ui.js` で設定パネル・進捗バー・結果サマリ構築
- [ ] `settings.js` で localStorage 永続化
- [ ] 初回警告ダイアログ
- [ ] **DoD**: 設定変更 → プラグイン再起動 → 設定が保持される
- [ ] **DoD**: 100枚バッチで進捗バーが滑らかに動き、キャンセルが即座に効く

### Phase 5: モデル配布・品質

- [ ] `downloader.js` 実装（SHA256 検証・レジューム・リトライ）`[- W7]`
- [ ] ブラックリスト機能
- [ ] README・プライバシー注意書き
- [ ] **DoD**: モデルを削除 → プラグイン起動 → 初回 DL が完了し推論できる
- [ ] **DoD: 回線切断 → リトライ → 復帰でレジュームされる**

### Phase 6: プロファイリング・配布

- [ ] 100枚バッチで wall-clock / ピークメモリ計測 `[- N6]`
- [ ] ZIP パッケージング（モデル除外）
- [ ] **DoD**: 目標値（1枚5秒以内 / ピーク 2.5 GB 以下）を満たす
- [ ] **DoD**: クリーン環境で zip 展開 → 初回起動 → タグ付けまで完結する

---

## 11. リスクと対策 `[- W2: NSFW フレーム修正]`

| リスク | 内容 | 対策 |
|--------|------|------|
| NSFW タグ含有 | モデルは汎用アニメタガーだが、Danbooru 系トレーニングデータに由来する NSFW タグ（`nipples`, `sex` 等）を語彙に含む。**NSFW 特化モデルではない**が、結果に NSFW タグが出る可能性はある | 初回警告ダイアログ・ブラックリスト機能・Eagle 利用規約とユーザー規約の照合をドキュメントに明記 |
| モデルサイズ | V1.1 ONNX = 約 993 MB | 初回 DL 方式（レジューム・SHA256 検証付き） |
| onnxruntime-node バージョン | スパイクで古めの API（`listSupportedBackends` 等）を持つ版が入った | `package.json` でバージョン固定・`package-lock.json` 同梱 |
| 画像前処理の速度 | Jimp（pure JS）は Sharp（ネイティブ）より遅い | 目標値（1枚5秒）を Phase 6 で検証。不達ならキャッシュ・バッチ最適化 or Sharp 試行（別 ABI スパイク必要） |
| メモリ負荷 | 大量画像で Eagle 本体が重くなる | 1枚ずつ処理・`gc()` 呼び出しオプション・キャンセル対応 |
| cwd のシステムフォルダ | renderer の cwd が `C:\WINDOWS\system32` | 全パスを `__dirname` 基準で構築（§7.2） |
| 多 OS 未検証 | スパイクは win32 x64 のみ | リリース前に macOS / Linux で追加スパイク |
| NSFW コンテンツの誤タグ付け | モデルは完美でない | UI に「人手での確認を推奨」・dry-run（プレビュー）モード拡張 |
| ライセンス | OppaiOracle: Apache 2.0 / onnxruntime: MIT / Jimp: MIT | NOTICE ファイルと LICENSE ファイルで明記 |

---

## 12. 検証項目（ベリファイア明記） `[- N6]`

- [ ] 空プラグインが Eagle に読み込まれる（目視）
- [ ] `eagle.item.getSelected()` が期待通り動作（手動・選択 → コンソール出力で確認）
- [ ] **前処理結果が Python 参照実装と一致**（対象: `scripts/python-ref/app.py` / 基準: 平均誤差 < 1e-4 / テスト画像: 3種以上）
- [ ] **ONNX 推論がエラーなく完了し `probabilities` が 19294 次元で返る**
- [ ] **推論結果のトップ10が Python 参照実装と一致**（許容差: 順位の違い ±2 位以内）
- [ ] 推論結果を Eagle のタグとして保存でき、Eagle 側で確認できる
- [ ] 100 枚のバッチ処理でクラッシュしない（`process.memoryUsage()` ピーク監視）
- [ ] 1 枚あたり wall-clock 5 秒以内（Phase 6 計測）
- [ ] ピークメモリ 2.5 GB 以下（Phase 6 計測）
- [ ] UI のキャンセルが次の画像境界で即座に反映する
- [ ] 設定変更 → 再起動 → 設定が保持される
- [ ] モデル未 DL 状態からの初回 DL が完了する（SHA256 検証 OK）
- [ ] DL 中断 → 再開でレジュームされる

---

## 13. ライセンス・注意事項

- OppaiOracle: **Apache License 2.0**
- onnxruntime-node: **MIT**
- Jimp: **MIT**
- Eagle Plugin API: Eagle 利用規約に従う
- 本プラグインは AI による自動推論であり、出力には誤りが含まれる可能性があることをユーザーに告知する
- NSFW タグが含まれうることを初回警告で告知

---

## 14. 技術選定（確定版） `[- W8]`

| 選択肢 | 決定 | 理由 |
|--------|------|------|
| ONNX 推論エンジン | **onnxruntime-node** | B1 スパイク PASS。Electron 22.3.7 / Node 16.17.1 / modules ABI 99 で動作確認済み |
| 画像前処理ライブラリ | **Jimp v0.22.x** | pure JS（ABI リスク回避）・スパイク環境で動作。Sharp は onnxruntime-node と同じ ABI 問題を抱えるため不採用 |
| モデル配布 | **初回 DL（SHA256 + レジューム付き）** | 配布 zip が巨大化するのを回避。ユーザー環境で Integrity 保証 |
| タグ閾値 | **MVP = グローバル**、**拡張 = per-tag** | MVP の単純化・拡張で `pr_thresholds.json` を活用 |
| 設定永続化 | **localStorage**（要調査で Eagle 专用 API 切替） | Chromium 系で確実。Phase 0 で `eagle.plugin.*` を調査 |
| UI 言語 | **日本語デフォルト**・英語は JSON 辞書で拡張 | ユーザーの主言語・i18n 仕込みを含む |

---

## 改訂履歴

- **v2** (2026-07-19): B1 スパイク PASS を受けて v1 の敵対的検証指摘（B2-B3 / W1-W8 / N1-N7）を全反映。`.spec/` 配下に移管して SDD フローに合流。
- **v1** (`.sisyphus/plans/eagle-oppai-tagger.md`): 初版。敵対的検証で多数の blocker / warning を指摘され差し替え。
