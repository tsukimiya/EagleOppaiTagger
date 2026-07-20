# MEMORY — Eagle OppaiOracle Tagger Plugin

> セッションをまたぐ学習した知識・教訓。AGENTS.md と重複しない内容を 200 行以内で維持。

## Eagle Plugin Renderer の制約と対策

### require パス解決の罠（最重要）
- Eagle は `require()` をラップしており、**相対パスが Eagle 自身の内部ディレクトリ基準で解決される**
- `require("./preprocess")` → `E:\My Programs\Eagle\resources\app.asar\app\js\plugin\preprocess` を探しに行く
- **対策**: 常に絶対パス `path.join(__dirname, "src", "モジュール名")` を使う
- `__dirname` はプロジェクトルートを指す（`src/` ではない！）

### スクリプト読み込み順序
- HTML の `<script>` は逐次実行。先に読むスクリプトが例外を投げると後続は一切実行されない
- `main.js`（require チェーンが長い）を `<script>` で直接読み込まず、ui.js のみ読み込んで他は遅延 require

### 使える API / 使えない API（Eagle renderer）
- ✅ `require("onnxruntime-node")` — 動作確認済み（B1 スパイク）
- ✅ `require("jimp")` — 動作確認済み（B1 スパイク）
- ✅ `require("fs")` — **使える**（公式 doc + 実プラグインで確認）
- ✅ `require("https")` — **使える**（公式 doc にサンプルあり）
- ✅ `localStorage` — 使える（設定 UI で動作確認）
- ✅ `window.fetch` — Chromium 標準 API

### HTML ボタン表示の罠
- `style="display:none"` のインラインスタイルは、JS からの `style.display=""` では解除されないことがある
- 信頼できる方法: `removeAttribute("style")` または `style.display = "inline-block"` を明示
- 最も確実: ボタンはデフォルト表示にして、非表示にしたい時だけ JS で隠す

## npm セキュリティ（adm-zip CVE-2026-39244）
- `onnxruntime-node@1.27.0` が依存する `adm-zip@0.5.18` に HIGH 脆弱性
- **対策**: `package.json` の `overrides` で `"adm-zip": "0.6.0"` を強制注入（API 互換あり）
- `npm audit fix --force` は onnxruntime-node を 1.21.1 にダウングレードするため禁止

## Node.js テストで組み込みモジュールをモックする
- `require.cache[require.resolve("https")] = { loaded: true, exports: fakeHttps }` で差し替え可能
- 偽レスポンスは EventEmitter ベース。`resume()` / `pipe()` / `destroy()` を実装すること

## SHA256 プレースホルダー運用
- モデル実ファイル未 DL 段階ではハッシュを推測してハードコードしない
- `TO_BE_FILLED_*` プレースホルダーで運用。初回 DL 時に実ハッシュを出力し、ユーザーが手動で追記

## PowerShell `Compress-Archive` の罠（Phase 6）
- Windows PowerShell 5.x では `Compress-Archive -LiteralPath "path/*"` が「パスが存在しない」エラーになる（PS 7+ では動く）
- **対策**: `Push-Location $stagePath` してから `Compress-Archive -Path "*" -DestinationPath $zip` で相対指定する
- ファイル名のバージョン埋め込みは `manifest.json` を `ConvertFrom-Json` して `$manifest.version` を取得

## 配布 zip は allowlist 方式が安全（Phase 6）
- `node_modules/` `models/` `.git/` `.codegraph/` `.claude/` `.agents/` `.spec/` など除外対象が多数ある場合、denylist は漏れがち
- **allowlist 方式**（含めるファイルだけ明示）なら漏れなく安全。`src/` 内のテストも `phase*-test.js` / `verify.js` で除外
- サイズは結果的に 0.05 MB（5MB 目標）になった

## Windows junction 削除の罠（Phase 6 片付け）

worktree 内に `node_modules` 等の junction（`mklink /J`）がある状態で `git worktree remove --force` すると、junction が削除できず worktree の物理ディレクトリが残る。残ったディレクトリを `rmdir` で掃除しようとすると、**リンク先（main の node_modules）の実体が一部削除されることがある**（今回は `jimp` が消失・`onnxruntime-node` は無事）。

**対策**:
- worktree で `node_modules` 等の巨大ディレクトリを使う際は junction ではなく **`npm install` で別途展開** する（時間はかかるが安全）
- どうしても junction を使う場合、削除は `cmd /c rmdir <path>`（再帰なし・`/S` 付けない）で慎重に
- 事故っても `npm install` で即復旧可能（5秒程度）

**今回の事象**: Phase 6 worktree（`EagleOppaiTagger-phase6`）の `node_modules` junction を `rmdir` で削除したところ、main の `node_modules/jimp` が消失。`npm install` で即復元。

## その他
- `eagle-bridge.js` は `eagle` グローバルをトップレベルで参照せず、関数内で遅延参照（初期化タイミング問題対策）
- `inference-client.js` は `require("fs")` をトップレベルで実行せず、関数内で遅延 require（IIFE crash 防止）
- プラグイン更新を Eagle に反映させるにはシンボリックリンクを貼り直すのが確実
- プロファイリングのサンプル数が少なくても「1枚あたり速度・メモリ」の DoD 検証は可能。100枚は統計的有意性と長時間安定性が目的
