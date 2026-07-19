# HANDOFF — Eagle OppaiOracle Tagger Plugin (2026-07-19 23:02)

## 使用ツール
OpenCode (oh-my-opencode)

## 現在の状態

### プラグイン動作確認済み
- Eagle 上でプラグイン起動、UI 表示、実行ボタン動作を確認
- `preprocess | inference | tags | main OK` — 全モジュール読み込み成功
- モデルファイル（model.onnx, selected_tags.csv, pr_thresholds.json）を `models/V1.1/` に手動配置済み
- **次のステップ**: 画像を選択してタグ付けを実際に試す

### 実装済みの機能（Phase 1-9a）
| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | 画像前処理 (Jimp letterbox + Python 照合) | ✅ MAE < 5e-9 |
| 2 | ONNX 推論 + タグ変換 (inference.js / tags.js) | ✅ |
| 3 | Eagle 連携 (eagle-bridge.js / main.js / settings.js) | ✅ |
| 4 | UI/UX (5セクション + NSFW 警告) | ✅ |
| 5 | モデルダウンローダー (downloader.js) | ✅ renderer では fs 未検証 |
| 6 | プロファイリングスクリプト | ✅ |
| 7 | Python FastAPI 推論サーバ (server/) | ✅ |
| 8 | プラグイン側クライアント化（サーバ優先・フォールバック） | ✅ |
| 9a | モック E2E テスト | ✅ |

### 全テスト PASS (174+)

### Git 履歴
```
main
├── f46a010  feat: 初回コミット
├── 77b4a41  chore: 配布準備（npm scripts / README / LICENSE / NOTICE）
├── 5713bca  docs: USER-GUIDE.md
├── eb0df83  Merge security/adm-zip-override (CVE-2026-39244 対応)
├── b754d84  docs(spec): v3 - サーバ推論アーキテクチャ対応
├── 34d2fa0  feat(server): Phase 7 - Python FastAPI 推論サーバ
├── 14be3f5  feat(client): Phase 8 - クライアント化
├── 0d12437  test(e2e): Phase 9a - モック E2E テスト
├── (各種 fix/ui コミット × 約10件)
└── (最新) fix: 絶対パス + __dirname 修正
```

## 試したこと・結果

### 成功したアプローチ
- **絶対パス require**: Eagle の renderer では `require()` がラップされ、相対パスが Eagle の内部ディレクトリ基準で解決される。`path.join(__dirname, "src", "モジュール名")` で絶対パス化して回避
- **ui.js 単独読み込み**: HTML で main.js を先に読み込むと crash 時に後続の ui.js が実行されない。ui.js のみ読み込み、main.js は「実行」ボタンクリック時に遅延ロード
- **dl-btn onclick 属性**: addEventListener より先に HTML の onclick で対応。JS ロード失敗時も最低限動作
- **B1 スパイク**: onnxruntime-node 1.27.0 が Eagle Electron 22.3.7 / Node 16.17.1 で動作することを事前確認

### 失敗したアプローチ（理由）
- **`fs` が使えないという誤診断**: checkModelStatus の require("fs") が失敗すると思い込んだが、実際は `__dirname` と require パス解決の問題だった
- **downloader.js の自動 DL**: renderer では動作未検証。手動 DL にフォールバック
- **inference-client.js のトップレベル require("fs")**: IIFE 全体が crash。遅延 require に変更

## 次のセッションで最初にやること

1. **実タグ付けテスト**: Eagle で画像を選択 → 「実行」ボタン → タグが付与されるか確認
2. **タグ CSV 読み込み確認**: `tags.js` が `models/V1.1/selected_tags.csv` を正しく読めるか検証
3. **必要に応じて**: renderer で `fs.readFileSync` が使えない場合は fetch ベースに変更
4. **Phase 9b**: 自宅サーバでの実環境検証（USER-GUIDE.md §F）

## 注意点・ブロッカー

- **Eagle の `require` ラッピング**: 常に絶対パスを使う。`__dirname` はプロジェクトルートを指す（`src/` ではない）
- **モデルファイル配置先**: `E:\Documents\Projects\EagleOppaiTagger\models\V1.1\` に3ファイル（model.onnx, selected_tags.csv, pr_thresholds.json）
- **プラグイン更新時**: シンボリックリンクを貼り直さないと Eagle が変更を検知しない場合がある。Eagle 完全終了 → 再リンク → 再起動
- **downloader.js**: Node 環境では動作するが、Eagle renderer では未検証。手動 DL 案内で運用中
- **@electron/remote エラー**: `main.js` の読み込み時に出ることがあるが、絶対パス修正後は出ていないはず
