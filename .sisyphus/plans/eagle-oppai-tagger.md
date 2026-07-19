# Eagle OppaiOracle Tagger Plugin 計画書

> 対象プロジェクト: `E:\Documents\Projects\EagleOppaiTagger`  
> 作成日: 2026-07-19  
> モデル: [Grio43/OppaiOracle](https://huggingface.co/Grio43/OppaiOracle)  
> Eagle Plugin API: https://developer.eagle.cool/plugin-api

---

## 1. 目的・スコープ

Eagle 内の画像に対して、Hugging Face の `Grio43/OppaiOracle` モデルを使って**自動タグ付け・分類**を行うプラグインを開発する。

### このプラグインで実現すること

- Eagle 上で選択した画像（またはフォルダ単位）を OppaiOracle で推論
- 推論結果を Eagle の `tags` に書き戻す
- 必要に応じて NSFW レベルなどの「分類」もタグやメタデータとして付与
- ユーザーが閾値やモデルバリアントを選べる UI を提供

### この計画で対象外とすること

- モデルの再学習・ファインチューニング
- Eagle 4.0 未満の互換対応
- 動画へのタグ付け

---

## 2. 前提調査結果

### 2.1 Eagle Plugin 環境

| 項目 | 値 |
|------|-----|
| ベース | Chromium 107 + Node 16 |
| 言語 | JavaScript |
| CORS | 制限なし |
| サードパーティモジュール | `require()` で利用可能 |
| Node ネイティブ API | 利用可能 |

### 2.2 使用する Eagle API

```javascript
// 選択画像の取得
const items = await eagle.item.getSelected();
// または
const items = await eagle.item.get({ isSelected: true, fields: ['id', 'name', 'filePath', 'tags'] });

// タグの上書き・追加
item.tags = [...new Set([...item.tags, ...predictedTags])];
await item.save();
```

### 2.3 OppaiOracle モデル仕様

| 項目 | V1 | V1.1 |
|------|-----|------|
| 入力解像度 | 320×320 | 448×448 |
| 形式 | `safetensors`, `onnx` | `safetensors`, `onnx` |
| 出力クラス数 | 19,294 | 19,294 |
| タグ種別 | General のみ | General のみ |
| 推奨用途 | スループット重視 | 精度重視 |

### 2.4 ONNX 入力・出力

`V1.1_onnx/preprocessing.json` より:

- 入力 `pixel_values`: `(batch, 3, 448, 448)`, float32, BCHW
- 入力 `padding_mask`: `(batch, 448, 448)`, bool
- 出力 `probabilities`: `(batch, 19294)`, sigmoid 済み
- 前処理: RGB / letterbox / pad `[114,114,114]` / normalize `(x/255 - 0.5) / 0.5`

### 2.5 閾値

`pr_thresholds.json` にタグごとの P=R 閾値が入っている。簡易実装では「グローバル閾値 + 上位 N 件」で十分。品質重視なら per-tag 閾値を採用する。

---

## 3. 機能要件

### 3.1 MVP（最小実装）

- [ ] Eagle 上で選択中の画像を取得
- [ ] OppaiOracle ONNX モデルで推論
- [ ] 推論結果を Eagle タグとして保存
- [ ] 閾値スライダー（グローバル）と最大タグ数設定
- [ ] 進捗表示とキャンセル機能

### 3.2 拡張（実装しやすい順）

- [ ] モデルバリアント切り替え（V1 / V1.1）
- [ ] per-tag 閾値の使用
- [ ] ブラックリスト / ホワイトリスト
- [ ] 既存タグとのマージ戦略（上書き/追加/差分）
- [ ] フォルダ単位・未タグ付け画像のみの一括処理
- [ ] 軽い「分類」タグ付け（`explicit` / `questionable` / `safe` 等）

---

## 4. 非機能要件

| 項目 | 目標 |
|------|------|
| 処理速度 | 1画像あたり数秒以内（CPU でも許容範囲） |
| メモリ | 1画像推論時に 1GB 以下を目安 |
| 互換性 | Eagle 4.0 build18+ |
| 配布 | プラグインフォルダを ZIP 化して配布 |
| モデルサイズ | ONNX モデルは別途ダウンロード or 同梱（サイズ注意） |

---

## 5. アーキテクチャ

```text
┌──────────────────────────────────────┐
│  Eagle App (Chromium 107 / Node 16)  │
│  ┌──────────────────────────────┐    │
│  │ Plugin Window (HTML/CSS/JS)  │    │
│  │ - 設定 UI / 進捗 / プレビュー │    │
│  └────────┬─────────────────────┘    │
│           │ IPC / require            │
│  ┌────────▼─────────────────────┐    │
│  │ Node 側ロジック              │    │
│  │ - image load / preprocessing │    │
│  │ - onnxruntime-node inference │    │
│  │ - Eagle API write            │    │
│  └────────┬─────────────────────┘    │
│           │                            │
│  ┌────────▼─────────────────────┐    │
│  │ Eagle Plugin API             │    │
│  │ eagle.item.get / save etc.   │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

### プラグインタイプ

- **MVP: Window Plugin**
  - ユーザーが明示的に実行ボタンを押してタグ付け
- **将来的: Background Service Plugin**
  - 画像追加時の自動タグ付け（`serviceMode: true`）

---

## 6. データフロー

1. ユーザーが Eagle 内で画像を選択
2. プラグインウィンドウを開く
3. UI で閾値・モデル・タグ戦略を設定
4. 「実行」ボタン
5. 選択画像を `eagle.item.getSelected()` で取得
6. 各画像の `filePath` からバッファ読み込み
7. 前処理（letterbox / normalize / BCHW / padding_mask）
8. ONNX Runtime で推論
9. 確率 → タグ変換（selected_tags.csv 参照）
10. 既存タグとマージ
11. `item.save()` で Eagle に反映
12. 進捗更新

---

## 7. 主要実装詳細

### 7.1 画像前処理

`jimp` などの pure-JS ライブラリを使用（Node 16 でも動作しやすい）。

```text
1. Jimp.read(filePath)
2. contain(448, 448, Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE)
   -> ただし背景色 #727272 (114,114,114)
3. canvas 448x448 に中央配置
4. ピクセル値を [0,1] に正規化 -> (x - 0.5) / 0.5
5. BCHW float32 テンソル化
6. padding_mask は全 false（letterbox 領域は pad だが ONNX 入力の説明で「all-False でも可」とのこと）
   -> 正確にするなら pad 領域を true にする
```

### 7.2 推論

```javascript
const ort = require('onnxruntime-node');
const session = await ort.InferenceSession.create(modelPath);
const feeds = {
  pixel_values: new ort.Tensor('float32', data, [1, 3, 448, 448]),
  padding_mask: new ort.Tensor('bool', maskData, [1, 448, 448])
};
const results = await session.run(feeds);
const probs = results.probabilities.data; // Float32Array(19294)
```

### 7.3 タグへの変換

```javascript
// 上位 N 件 or 閾値以上
const threshold = 0.5; // ユーザー設定
const maxTags = 30;
const tagIds = probs
  .map((p, i) => ({ i, p }))
  .filter(x => x.p >= threshold && x.i >= 2) // 0=<PAD>, 1=<UNK> を除外
  .sort((a, b) => b.p - a.p)
  .slice(0, maxTags)
  .map(x => selectedTags[x.i]);
```

### 7.4 Eagle 書き込み

```javascript
for (const item of items) {
  const predicted = await infer(item.filePath);
  item.tags = mergeTags(item.tags, predicted, strategy);
  await item.save();
}
```

---

## 8. UI/UX

### ウィンドウサイズ

- 640×480（Eagle 推奨）

### 画面構成

1. **ヘッダー**
   - モデル状態（未ロード / ロード済み）
   - モデルダウンロードボタン（初回）
2. **設定エリア**
   - モデルバリアント: V1 / V1.1
   - 閾値スライダー（0.0〜1.0）
   - 最大タグ数
   - マージ戦略: 追加 / 上書き / 差分のみ
   - ブラックリスト入力
3. **実行エリア**
   - 対象: 選択画像 / フォルダ / 未タグ付け
   - 実行ボタン / キャンセルボタン
4. **進捗エリア**
   - プログレスバー
   - 現在処理中のファイル名
   - 推定残り時間
5. **結果プレビュー（任意）**
   - 最後に処理した画像と付与されたタグ一覧

---

## 9. プロジェクト構成

```text
EagleOppaiTagger/
├── manifest.json
├── index.html
├── package.json
├── src/
│   ├── main.js          # プラグインエントリ
│   ├── ui.js            # UI イベント
│   ├── inference.js     # ONNX 推論・前処理
│   ├── eagle-bridge.js  # Eagle API ラッパー
│   ├── tags.js          # selected_tags / thresholds 読み込み
│   └── utils.js         # パス・ログ・設定管理
├── assets/
│   └── logo.png
├── models/              # 実行時ダウンロード or 同梱
│   ├── V1.1/
│   │   ├── model.onnx
│   │   ├── selected_tags.csv
│   │   └── pr_thresholds.json
│   └── V1/
└── node_modules/
```

### `manifest.json` 例

```json
{
  "id": "com.example.eagle-oppai-tagger",
  "version": "0.1.0",
  "name": "OppaiOracle Tagger",
  "logo": "assets/logo.png",
  "keywords": ["tag", "ai", "image", "classify"],
  "main": {
    "url": "index.html",
    "width": 640,
    "height": 480
  }
}
```

---

## 10. 開発フェーズとタスク

### Phase 0: プロジェクトセットアップ

- [ ] Node 16 環境確認
- [ ] `manifest.json` と最小 UI 作成
- [ ] Eagle 開発者モードで空プラグインがロードされることを確認

### Phase 1: 画像前処理パイプライン

- [ ] `jimp` 依存追加
- [ ] letterbox / normalize / BCHW 変換実装
- [ ] Python 版（Hugging Face のデモ）と出力を比較検証

### Phase 2: ONNX 推論ラッパー

- [ ] `onnxruntime-node` 依存追加と動作確認
- [ ] モデルダウンロード or 配置
- [ ] セッション生成と推論実行
- [ ] 出力が `19294` 次元であることを検証

### Phase 3: Eagle 連携

- [ ] 選択画像取得
- [ ] タグ書き込み・保存
- [ ] 進捗通知

### Phase 4: UI/UX

- [ ] 設定パネル
- [ ] 進捗バー
- [ ] タグプレビュー

### Phase 5: 品質・配布

- [ ] ブラックリスト / ホワイトリスト
- [ ] per-tag 閾値対応
- [ ] README・プライバシー注意書き作成
- [ ] ZIP パッケージング

### Phase 6: テスト

- [ ] 前処理一致テスト
- [ ] 小規模画像セットでのタグ付けテスト
- [ ] メモリ・速度プロファイリング

---

## 11. リスクと対策

| リスク | 内容 | 対策 |
|--------|------|------|
| NSFW タグ | OppaiOracle は成人向けタグを含む | UI で警告表示。利用者の責任で利用。Eagle 内の規約確認。 |
| モデルサイズ | ONNX ファイルは数百 MB〜1GB 超 | 初回起動時に HF からダウンロードする方式を基本とする |
| Node 16 互換 | 最新 onnxruntime-node が Node 16 を切り捨てる可能性 | 動作確認したバージョンを固定。問題時は `onnxruntime-web` wasm へフォールバック設計 |
| ネイティブモジュール | Eagle の Electron ABI と合わない | 事前ビルド済みバイナリを含めて配布 or pure-JS 経路を用意 |
| 処理負荷 | 大量画像で Eagle が固まる | バッチ処理・非同期・キャンセル対応。1枚ずつ GC を挟む |
| タグの誤り | モデルは完美でない | UI に「人手での確認を推奨」と明記 |
| ライセンス | Apache 2.0 | ライセンス表記を含める |

---

## 12. 検証項目

- [ ] 空プラグインが Eagle に読み込まれる
- [ ] `eagle.item.getSelected()` が期待通り動作
- [ ] 画像前処理結果が Python 参照実装と一致（平均誤差 < 1e-4）
- [ ] ONNX 推論がエラーなく完了し `19294` 次元の確率が返る
- [ ] 推論結果を Eagle のタグとして保存でき、Eagle 側で確認できる
- [ ] 100 枚程度のバッチ処理でクラッシュしない
- [ ] UI のキャンセルが即座に反映する

---

## 13. ライセンス・注意事項

- OppaiOracle: Apache License 2.0
- Eagle Plugin API: Eagle 利用規約に従う
- 本プラグインは AI による自動推論であり、出力には誤りが含まれる可能性があることを必ずユーザーに告知する

---

## 14. 次のアクション

この計画書を承認いただければ、**Phase 0 から順次実装タスクを実行**する。

必要に応じて以下の技術選定を先に詰めることも可能:

1. ONNX 推論エンジン: `onnxruntime-node` vs `onnxruntime-web` wasm
2. 画像前処理ライブラリ: `jimp` vs `sharp` vs `image-js`
3. モデル配布方法: 同梱 vs 初回ダウンロード
4. タグ閾値: グローバル閾値 vs per-tag 閾値
