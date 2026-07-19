# Spike B1 — onnxruntime-node ロード検証

> 目的: 計画書 §2.1, §7.2, §11 の前提（`require('onnxruntime-node')` が Eagle プラグイン環境で動く）を実証する。
> 結果が FAIL なら、OppaiOracle Tagger の中核（ローカル ONNX 推論）が成立せず、plan 全体の再設計が必要になる。

---

## 前提条件

| 項目 | 必要なもの |
|------|-----------|
| OS | Windows / macOS / Linux（Eagle がサポートする環境） |
| Eagle | 4.0 Build12 以上（Plugin API が有効なバージョン） |
| Node.js | 外部インストール済み（`npm install` を実行するため）。バージョンは不問 |
| Eagle 開発者モード | Eagle 設定で「プラグイン開発者モード」を有効にできること |

---

## セットアップ手順

### 1. 依存モジュールのインストール

このスパイクフォルダ内で `onnxruntime-node` をインストールする。

```powershell
# Windows
cd "E:\Documents\Projects\EagleOppaiTagger\.sisyphus\spikes\b1-onnxruntime-load"
npm install
```

```bash
# macOS / Linux
cd "/path/to/EagleOppaiTagger/.sisyphus/spikes/b1-onnxruntime-load"
npm install
```

完了すると `node_modules/onnxruntime-node/` ができる。

### 2. スパイクフォルダを Eagle プラグインとして登録

Eagle のプラグインフォルダは:

| OS | パス |
|----|------|
| Windows | `%APPDATA%\Eagle\Plugins\` |
| macOS | `~/Library/Application Support/Eagle/Plugins/` |
| Linux | `~/.config/Eagle/Plugins/` |

#### 推奨: シンボリックリンク（編集がすぐ反映される）

```powershell
# Windows PowerShell（管理者権限）
New-Item -ItemType SymbolicLink `
  -Path "$env:APPDATA\Eagle\Plugins\spike-onnxruntime-load" `
  -Target "E:\Documents\Projects\EagleOppaiTagger\.sisyphus\spikes\b1-onnxruntime-load"
```

```bash
# macOS / Linux
ln -s "/path/to/EagleOppaiTagger/.sisyphus/spikes/b1-onnxruntime-load" \
      ~/Library/Application\ Support/Eagle/Plugins/spike-onnxruntime-load
```

#### 代替: コピー（編集のたびに再コピーが必要）

フォルダ全体を Eagle プラグインディレクトリにコピーする。

### 3. Eagle を起動してプラグインを開く

1. Eagle を起動（既に起動している場合は再起動）
2. メニュー → プラグイン → 「Spike: onnxruntime-node load」を起動
3. 640×480 のウィンドウが開く

---

## 実行方法

1. プラグインウィンドウの「**Run diagnostic**」ボタンを押す
2. 処理が終わるまで待つ（通常1〜2秒、失敗時は30秒以内にタイムアウト）
3. 画面下部にJSONで結果が表示される
4. **Verdict** ラベルの色と文字を確認:
   - 🟢 `PASS_LOAD_AND_CALL` → onnxruntime-node が完全動作。ローカル推論は採用可能。
   - 🟡 `PARTIAL_LOAD_ONLY` → ロードはできたが API 呼び出し失敗。ネイティブバイナリ問題の可能性。
   - 🔴 `FAIL_CANNOT_LOAD` → require 段階で失敗。ローカル推論は不可能、代替設計が必要。
5. 「**Copy result JSON**」ボタンを押してクリップボードへコピー
6. コピーした JSON を `RESULTS.md` の該当欄に貼り付ける

---

## 結果の解釈

### PASS_LOAD_AND_CALL の場合

- `steps.requireOnnx.ok === true`
- `steps.tensorConstruct.ok === true` または `steps.sessionCreate.ok === true`
- → plan v2 を起票して B2〜W8 の修正を反映。ローカル推論路で継続。

### PARTIAL_LOAD_ONLY の場合

- `steps.requireOnnx.ok === true` だが、`steps.tensorConstruct.ok` / `steps.sessionCreate.ok` のいずれも false
- `steps.sessionCreate.errorCaught` に以下の文字列があれば **ABI 不整合（B1 ブロッカー確定）**:
  - `NODE_MODULE_VERSION`
  - `Module did not self-register`
  - `was compiled against a different Node.js version`
  - `The specified module could not be found`（Windows / `.node` バイナリ欠け）
- → 代替案の検討へ:
  1. `onnxruntime-web`（WASM）への切替（速度低下・スレッド制限あり）
  2. 別プロセスを spawn して Eagle 外の Node で推論（IPC オーバーヘッド）
  3. リモート推論 API（Python サーバ等）への委譲
  4. Sharp と onnxruntime-node を Eagle と同バージョンで自前ビルドして同梱（高コスト）

### FAIL_CANNOT_LOAD の場合

- `steps.requireOnnx.ok === false`
- `steps.requireOnnx.error` に原因が載っている
- → PARTIAL と同様、代替案検討へ。

---

## トラブルシューティング

| 現象 | 原因 | 対処 |
|------|------|------|
| プラグインが Eagle に表示されない | manifest.json 不正 / フォルダ構成ミス | Eagle を再起動・manifest の JSON 構文を確認 |
| `require is not defined` | renderer プロセスで nodeIntegration が無効 | renderer から require できない場合、service plugin に分割して main プロセスで require する設計変更が必要（B1 の結果の1つとして記録） |
| `Cannot find module 'onnxruntime-node'` | node_modules が無い / パス解決失敗 | `npm install` をスパイクフォルダで実行したか確認 |
| プラグインウィンドウが開かない | main.url のパス違い / index.html 不在 | フォルダ直下に `index.html` があるか確認 |
| Eagle がフリーズする | ネイティブバイナリロードでハング | Eagle を強制終了し、RESULTS.md に現象を記録 |

---

## 記録すべき追加情報

`RESULTS.md` に以下も併記すること:

- Eagle の正確なバージョン（ヘルプ → バージョン情報）
- OS と アーキテクチャ（例: Windows 11 22H2 x64）
- `node -v` と `npm -v`（外部 Node のバージョン）
- インストールした onnxruntime-node のバージョン（`npm ls onnxruntime-node`）
- Eagle プラグインフォルダへの登録方法（シンボリックリンク or コピー）

---

## 次のアクション（ユーザー→エージェント）

1. ユーザー: 上記手順でスパイクを実行し、`RESULTS.md` に結果を記入
2. ユーザー: 結果（または RESULTS.md のパス）をエージェントに報告
3. エージェント: 結果に基づき以下いずれかに分岐:
   - PASS → plan v2 の起票（B2〜W8 を反映）
   - PARTIAL / FAIL → 代替設計（onnxruntime-web / 別プロセス / リモート API）の比較検討を起票
