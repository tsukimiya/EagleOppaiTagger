# MEMORY — Eagle OppaiOracle Tagger Plugin

> セッションをまたぐ学習した知識・教訓。AGENTS.md と重複しない内容を 200 行以内で維持。

## Eagle Plugin Renderer の制約と対策

### require パス解決の罠（最重要）
- Eagle renderer では `require()` がラップされており、**相対パスが Eagle 内部ディレクトリ基準で解決される**
- `__dirname` は **src/ ではなくプロジェクトルート** を指す（HTML の `<script src="src/ui.js">` で読む場合）
- CommonJS の通常挙動（`__dirname` = そのファイルのディレクトリ）と異なる特殊仕様
- **対策**: 常に絶対パス `path.join(__dirname, "src", "モジュール名")` を使う
- 子 require 先（例: main.js を ui.js から require した場合の main.js 内の `__dirname`）は通常通り「そのファイルの実ディレクトリ」

### スクリプト読み込み順序
- HTML の `<script>` は逐次実行。先に読むスクリプトが例外を投げると後続は一切実行されない
- `main.js`（require チェーンが長い）を `<script>` で直接読み込まず、ui.js のみ読み込んで他は遅延 require

### 使える API / 使えない API（Eagle renderer）
- ✅ `require("onnxruntime-node")` / `require("jimp")` / `require("fs")` / `require("https")`
- ✅ `localStorage` / `window.fetch` / `eagle.*` Plugin API
- ✅ `eagle.item.getIdsWithModifiedAt()` / `eagle.item.get({isUntagged:true})` / `count()` （Build12+）

### HTML ボタン表示の罠
- `style="display:none"` インラインは JS からの `style.display=""` で解除されないことがある
- **対策**: `removeAttribute("style")` または明示的な `style.display = "inline-block"`

## Eagle Plugin API の自動タグ付け（Phase 10 で検証済み）

### Event API の実態
- `onItemAdd` は**存在しない**（新規追加のイベントフック無し）
- あるのは `onPluginCreate` / `onPluginRun` / `onPluginBeforeExit` / `onPluginShow` / `onPluginHide` / `onLibraryChanged` / `onThemeChanged`
- 新規画像検知は **ポーリング** で実現するしかない

### `fields` プロジェクションの罠（Phase 10.1 で発見・最重要）
- `eagle.item.get({ fields: [..., "filePath", ...] })` で `filePath` を指定しても**正常に取得できない**
- 現象: `filePath` が `${name}.undefined` になり `ENOENT`（`ext` フィールド未選択のため）
- **対策**: `filePath` が必要な場合は `fields` を省略して `eagle.item.get({ ids: [id] })` または `getSelected()` / `getAll()` を使う
- ラッパー: `getItemById(id)`（`src/eagle-bridge.js`）が fields なしフル取得を提供
- 軽量データが欲しい場合は `fields: ["id", "tags"]` 等、`filePath` を含めないセットを使う
- OSS AIタガー（`BarnattW/eagle-ai-image-tagger` 等）は誰も `fields` を使わず全部 `getSelected()`/`getAll()`
- 公式 doc の例も `["id","name","tags","modifiedAt"]` 等、軽量メタデータのみ
- 詳細は `.spec/KNOWLEDGE.md` Phase 10.1 セクション + ADR-12 候補

### Background Service Plugin 型
- `manifest.json` の `main` に `"serviceMode": true` を追加するだけ（公式サポート）
- Eagle 起動時にバックグラウンドで常駐、ウィンドウも出せる
- v3 PLAN の「Event API 無しで不可」は誤り。Service 型ありなら常駐可能
- 公式サンプル: https://github.com/eagle-app/eagle-plugin-examples/tree/main/Service

### 自動タグ付けの設計パターン（Phase 10 採用）
- **Window 内ポーリング**（`setInterval` + `getIdsWithModifiedAt` 差分）
- 1 tick = 1枚処理で Eagle 本体への負荷分散
- 新規候補: `modifiedAt > lastScanAt` で抽出 → `tags.length === 0` でクライアント側フィルタ（タグ編集を巻き込まない）
- 既存未タグ付け: `get({isUntagged: true})` → `importedAt` 降順で「新規に近い順」を維持
- 排他制御: 手動 `run()` 中は `pauseForManualRun()` / `resumeAfterManualRun()`（循環 import 回避のため**両方向とも遅延 require**）

## JavaScript の罠

### `||` と `??` の違い（タイムスタンプ取り扱い）
- `loadLastScanAt() || Date.now()` は **NG**: `0` が falsy 扱いで Date.now() に上書きされる
- `loadLastScanAt() ?? Date.now()` が **正解**: `0` を正当な値として扱う
- Node 16.17.1（Eagle 同梱）は ES2020 対応で `??` が使える

### setInterval で async 関数を呼ぶときの再入防止
- `setInterval` は前回の async 完了を待たずに次を発火する
- **対策**: ループ内部の冒頭で `if (state.inTick) return;` + finally で解除

### 循環 import の回避（CommonJS）
- A.js ↔ B.js の相互参照がある場合、両方とも「関数内で遅延 require」すれば OK
- モジュールロード時の循環は避けられる。実行時には両方ロード済みなので動作する

## npm セキュリティ（adm-zip CVE-2026-39244）
- `onnxruntime-node@1.27.0` が依存する `adm-zip@0.5.18` に HIGH 脆弱性
- **対策**: `package.json` の `overrides` で `"adm-zip": "0.6.0"` を強制注入（API 互換あり）
- `npm audit fix --force` は onnxruntime-node をダウングレードするため禁止

## Node.js テストで組み込みモジュールをモックする
- `require.cache[require.resolve("https")] = { loaded: true, exports: fakeHttps }` で差し替え可能
- 偽レスポンスは EventEmitter ベース。`resume()` / `pipe()` / `destroy()` を実装すること
- item モックには `async save() {}` を必ず実装する（`saveItem(item)` が呼ぶため）

## SHA256 プレースホルダー運用
- モデル実ファイル未 DL 段階ではハッシュを推測してハードコードしない
- `TO_BE_FILLED_*` プレースホルダーで運用。初回 DL 時に実ハッシュを出力し、ユーザーが手動で追記

## PowerShell `Compress-Archive` の罠（Phase 6）
- Windows PowerShell 5.x では `Compress-Archive -LiteralPath "path/*"` がエラー（PS 7+ では動く）
- **対策**: `Push-Location $stagePath` してから `Compress-Archive -Path "*"` で相対指定
- バージョン埋め込みは `manifest.json` を `ConvertFrom-Json` して `$manifest.version` を取得

## 配布 zip は allowlist 方式が安全（Phase 6）
- `node_modules/` `models/` `.git/` `.codegraph/` `.claude/` `.agents/` `.spec/` 等の除外対象が多いと denylist は漏れがち
- **allowlist 方式**（含めるファイルだけ明示）なら漏れなく安全
- `src/` 内は `phase*-test.js` / `verify.js` / `.gitkeep` を除外パターンで弾く
- Phase 10 で追加した `auto-tagger.js` は自動的に含まれる（除外パターンに一致しないため）

## Windows junction 削除の罠（Phase 6 片付け）

worktree 内に `node_modules` 等の junction（`mklink /J`）がある状態で `git worktree remove --force` すると junction が削除できず物理ディレクトリが残る。`rmdir` で掃除しようとすると**リンク先（main の node_modules）の実体が削除されることがある**。

**対策**:
- worktree で `node_modules` 等の巨大ディレクトリを使う際は junction ではなく `npm install` で別途展開する（時間はかかるが安全・Phase 10 で採用・8秒で完了）
- 事故っても `npm install` で即復旧可能

## Copilot PR レビューの傾向（Phase 10 で実測）

- 7件の指摘のうち**すべて有効**。Copilot は論理的バグ・一貫性欠如を見つけるのが得意
- 特に有用だった指摘:
  - `||` vs `??` 相当の falsy 問題（今回は出なかったが clamp が `Math.max(5,...)` で SPEC 違反）
  - 複数モジュール間の数値の不一致（UI の min/max vs 設定読み取り vs SPEC）
  - アルゴリズムの境界ケース（cap の並び替え不足・優先度崩れ）
- Eagle renderer の `__dirname` 特殊仕様は Copilot には分からないので、コメントか返信で補足説明が必要

## その他
- `eagle-bridge.js` / `inference-client.js` はトップレベルで `eagle` / `require` を参照せず、関数内で遅延参照（初期化タイミング問題対策）
- プラグイン更新を Eagle に反映させるにはシンボリックリンクを貼り直すのが確実
- プロファイリングのサンプル数が少なくても「1枚あたり速度・メモリ」の DoD 検証は可能。100枚は統計的有意性と長時間安定性が目的
