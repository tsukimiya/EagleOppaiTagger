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
- **解決**: Phase 0 調査で Eagle 側 API は存在しないと確認（`.spec/eagle-config-api-research.md`）。localStorage で確定

### ADR-8: adm-zip を `overrides` で 0.6.0 に固定（CVE-2026-39244 対応）

- **Context**: `onnxruntime-node@1.27.0` が依存する `adm-zip@0.5.18` に HIGH 脆弱性（CVE-2026-39244・クラフト ZIP で 4GB メモリ確保）。npm audit が HIGH 6件を報告
- **Decision**: `package.json` の `overrides` で `adm-zip: "0.6.0"` を強制注入
- **根拠**:
  - `adm-zip@0.6.0` は Node >= 14 対応・API 互換性あり・Electron 22.3.7 で動作
  - `npm audit fix --force` は onnxruntime-node を 1.21.1 にダウングレード（B1 スパイク PASS 実績リセット）するため不可
  - onnxruntime-node 1.28.0-dev でも adm-zip `^0.5.16` のまま（Microsoft 側未対応）
  - overrides なら onnxruntime-node 本体を維持しつつ transitive のみ昇格
- **影響**: HIGH 脆弱性 0 件に減少。残り moderate 4件は ADR-9 で別処理

### ADR-9: jimp 0.22.x の file-type 脆弱性はリスク受容

- **Context**: `jimp@0.22.12` → `@jimp/core` → `file-type@16.5.4` に MODERATE 脆弱性（CVE-2026-31808・ASF パーサの無限ループ）
- **Decision**: jimp 0.22.x に留まり、file-type 脆弱性はリスク受容
- **根拠**:
  - jimp v1 は Node >= 18 必須 → Electron 22.3.7（Node 16.17.1）では動作不可
  - 当プラグインは PNG/JPEG/WebP/BMP のみ扱い、ASF (WMV/WMA) は未使用
  - 攻撃経路が狭い（ユーザーが自分の画像を選択する前提）
  - 影響は DoS（イベントループ停止）のみ
- **影響**: `npm audit` で moderate 4件（jimp/@jimp/custom/@jimp/core/file-type）が残存。実害ほぼなし
- **見直し条件**: Electron が Node 18+ に上がったら jimp v1 移行を再検討

### ADR-10: サーバ優先・ローカルフォールバックの二段構え採用

- **Context**: GPU 推論による高速化と Mac/Linux 対応を見据え、ローカル推論専用からサーバ + ローカルの二段構えに変更
- **Decision**:
  - サーバ（Python FastAPI + onnxruntime-gpu）を第一優先
  - onnxruntime-node ローカル推論（ADR-1）をフォールバックとして維持
  - プロトコルは REST (multipart + JSON)
  - 配置は自宅サーバ（VPN 含む）前提
- **根拠**:
  - onnxruntime-node は CPU プロバイダのみ → GPU 活用には Python 側が必要
  - フォールバック維持でサーバ停止時も最低限動作
  - 自宅 LAN 内で NSFW 画像がインターネットに出ない前提を維持
- **影響**:
  - B1 スパイク・Phase 2 inference.js・Phase 5 downloader.js はフォールバック経路として維持（廃止しない）
  - モデル DL は両側で必要（サーバは `server/` に配置・プラグイン側はフォールバック時に DL）
  - 配布サイズは変更なし（フォールバック維持のため）
  - ADR-1（onnxruntime-node 採用）は維持・補完される形（置換ではない）

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

## Phase 6 — プロファイリング・配布（2026-07-20）

### プロファイリング結果（3枚サンプル・ローカル CPU 推論）

- 速度: 平均 **2.92 s/枚**（DoD <5s ✅）・中央値 2.89 s・p95 3.06 s
- メモリ: ピーク RSS **1504 MB**（DoD <2.5GB ✅）・Heap 18.4 MB
- 前処理: 59.7 ms（Jimp・問題なし）
- 推論: 2.86 s（ONNX CPU・ボトルネック）

3枚サンプルなので統計的有意性は低い。100枚バッチでの安定性検証はユーザー作業に残す。

### ロングランプロファイリング（102枚・`--repeat 34`・5分連続実行）

`profile.js` に `--repeat N` オプションを追加し、3枚のサンプルを34回繰り返して102枚相当の長時間実行で安定性を検証。

- **処理枚数: 102 / 102（エラー0・全成功）**
- 総時間: 4.97 min
- 速度: 平均 **2.87 s/枚**・中央値 2.83 s・p95 3.14 s・最大 3.74 s
- メモリ: ピーク RSS **1503.6 MB**（3枚時と同等・**リークなし**）
- Heap 18.4 MB（安定）

**結論**: 5分間の連続推論で RSS が増加していない → メモリリークなし。推論セッションのキャッシュが機能し、速度も安定。100枚バッチの「進捗バー滑らかさ」は Eagle 実機でのみ検証可能（ユーザー作業）。

### 進捗バー実装のコードレビュー（代替検証）

`src/ui.js` の `onProgress` コールバックを確認:
- `ev.current/ev.total*100%` で進捗バー更新（1枚でも100枚でも同じロジック）
- 経過時間・推定残り時間表示付き（`avg` から算出）
- 4状態（processing / done / error / cancelled）をハンドル
- ユーザーが「タグ付与成功・キャンセル動作」と確認済み → このコードパスは実機で動作検証済み

### 回帰テスト（`npm test` + phase8/9・87+ PASS）

今回の Phase 6 変更（`scripts/profile.js` の `--repeat` 追加、`make-dist.ps1` 新規、README/package.json/.gitignore 更新）が既存機能に与える影響を確認:

- phase2-test: PASS（ONNX 推論・タグ変換）
- phase3-test: PASS（Eagle 連携・キャンセル）
- phase4-test: PASS（UI・設定永続化）
- phase5-test: 29 PASS（ダウローダー・SHA256・レジューム・リトライ）
- phase8-test: 36 PASS（サーバ推論クライアント・フォールバック）
- phase9-test: 22 PASS（モック E2E）

**回帰なし・87+ tests 全 PASS**

### 配布 zip スクリプト（`scripts/make-dist.ps1`）

- **allowlist 方式** で含めるファイルを明示（manifest/index/package*.json/README/USER-GUIDE/LICENSE/NOTICE/assets/src/server）
- `src/` はテスト・検証を除外（`phase*-test.js` / `verify.js` / `.gitkeep`）
- `server/` は `__pycache__` を再帰的に除外
- バージョンは `manifest.json` から読み込み、ファイル名 `eagle-oppai-tagger-<version>.zip` を自動生成
- **Windows PowerShell 5.x の `Compress-Archive` は `-LiteralPath "x/*"` を受け付けない** — `Push-Location` して `-Path "*"` で回避
- 成果物: **0.05 MB (52,445 bytes)** で 5MB DoD を大幅クリア
- `npm run dist` エイリアス追加

### README 配布要件の修正

- 従来「推論はすべてローカル・外部送信なし」だったが、Phase 8 のサーバ推論と矛盾
- SPEC L724 のリスク対応「サーバ推論時は自宅サーバ前提・パブリッククラウド運用はユーザー責任」を追記

### 残作業（ユーザー環境依存）

- 100枚バッチでの安定性検証（統計的有意性・長時間実行・進捗バー滑らかさ）
- クリーン環境（別ユーザー/別マシン）での配布 zip 展開 → 初回起動 → タグ付け完結検証

## Phase 10 — 自動タグ付け（Window 内自動化・2026-07-20）

### v3 PLAN の前提修正

v3 PLAN/SPEC は「Event API に `onItemAdd` が無いため自動タグ付けは不可」としていたが、公式 doc の再調査で以下が判明:

- **Background Service Plugin 型**（`manifest.json` で `"main": { "serviceMode": true }`）が公式サポート
- Event API は `onItemAdd` 無し・`onPluginCreate` / `onLibraryChanged` 等のみ
- しかし `eagle.item.getIdsWithModifiedAt()`（Build12+）で id + modifiedAt の高速取得が可能 → 差分検知でポーリング実装可能
- `eagle.item.get({ isUntagged: true })` で未タグ付け抽出
- 結論: v4 Phase 10 として Window プラグイン内ポーリングで実現（Service 化は Phase 11 で検討）

### 設計判断（ユーザー合意）

- 1 tick = 1枚処理（Eagle 本体への負荷分散・「アイドル感」を保つ）
- 新規優先 → 既存の未タグ付け（新規は modifiedAt > lastScanAt、取得後に `tags.length === 0` でクライアント側フィルタ）
- エラー耐性: スキップ + 連続5回で自動停止
- 排他制御: 手動 `run()` 実行中は auto-tagger を pause / finally で resume（循環 import 回避のため main.js 側で遅延 require）

### 実装上の工夫

- **`??` 演算子の使用**: `start()` で `loadLastScanAt() ?? Date.now()`。`||` だと `0` が falsy 扱いで Date.now() に上書きされてしまう。Node 16.17.1 は ES2020 対応なので `??` が使える
- **auto-tagger と main.js の循環参照**: auto-tagger.js → main.js（inferDispatch を使うため）、main.js → auto-tagger.js（排他のため）。ロード時の循環を避けるため、両者とも関数内で遅延 require
- **inTick ガード**: setInterval は async 関数の完了を待たない。tick 内部の冒頭で `if (state.inTick) return` を入れることで再入を防止
- **連続エラー後の localStorage 整合**: UI 側で checkbox を OFF にするだけでは localStorage の `autoMode.enabled` が古いまま。`onSettingsChanged()` を呼んで永続化（Copilot レビューで指摘）

### Copilot レビューで改善した点

1. **新規候補の精度**: modifiedAt 降順ソート後 cap（最新が落ちない）+ 取得後に `tags.length === 0` でクライアントフィルタ（タグ編集された画像を「新規」として誤処理しない）
2. **新規優先の維持**: `getUntagged()` の結果を importedAt 降順でソート。1 tick = 1枚 + lastScanAt 更新で残新規画像が古い未タグ付けに埋もれる問題を回避
3. **ポーリング間隔の clamp**: `clampIntervalSec()` ヘルパで `Math.max(30, Math.min(300, sec))`。UI / SPEC / auto-tagger の3箇所で 30-300 秒に統一
4. **UI 設定の下限チェック**: `readSettingsFromUI()` で `pi >= 30 && pi <= 300` に厳格化

### ADR 候補（Phase 10 関連）

- **ADR-11 候補**: 自動タグ付けは Background Service 型ではなく Window 内ポーリング（Phase 10）で段階導入
  - 理由: Service 化は「ウィンドウ閉じても動く」メリットがあるが、NSFW タグの無人付与リスク・メモリ常駐・Eagle アプリとのリソース競合を先に検証すべき。Window 内ならユーザーが「今このライブラリに対して動かしている」状態を保てる
  - 見直し条件: Phase 10 の実機検証で「ウィンドウを開きっぱなしにする運用で十分」と判明すれば Service 化不要。逆に「ウィンドウ閉じても動かしたい」要望が強ければ Phase 11 に進む

### 残作業（ユーザー環境依存）

- Eagle 実機での Phase 10 DoD §15.9 検証（自動モード ON → 新規画像追加 → 60秒以内タグ付与、連続エラー停止、手動との排他など）

## Phase 10.1 — 自動モード filePath バグ修正（2026-07-22）

### 現象

自動モード ON → ポーリング1回目で `ENOENT: no such file or directory, open 'Z:\...\{name}.undefined'`。
連続5回エラーで自動停止（SPEC §15.4 通りの正常動作）。

### 根本原因

`eagle.item.get({ fields: ["id","name","filePath","tags","importedAt"] })` の **`fields` プロジェクションで `filePath` が正しく取得できない**。

- 手動モードは `eagle.item.getSelected()`（fields なし）→ フル item の `filePath` は絶対パス → ✅ 動く
- 自動モードは `get({ fields: [...] })` → `filePath` が `${name}.undefined` になる
- 推定: Eagle 内部が `filePath = ${dir}/${name}.${ext}` を動的組み立てしており、`ext` が fields で select されないため undefined

### 証拠（librarian 調査）

- 公式 doc の `fields` 例は `["id","name","tags","modifiedAt"]` 等、軽量メタデータのみ。`filePath` を fields で使う例は無い
- OSS の AIタガー `BarnattW/eagle-ai-image-tagger` は**全て `getSelected()` / `getAll()` で fields なし**（`filePath` を直接 `fs.readFileSync` に渡している）
- `oniclaire/tagporter` も `item.filePath` を使うが fields 指定なし

### 修正方針（ユーザー合意）

**2段階取得**:
1. 候補ID集め: `getIdsWithModifiedAt()` と `getItems({ isUntagged: true, fields: ["id","importedAt"] })` で lightweight に ID のみ
2. 処理対象1枚: `eagle.item.get({ ids: [id] })` を **fields なし**で呼んでフル item を取得
3. `preprocess(item.filePath)` を呼ぶ

これで毎ポーリングのデータ転送量を最小限に抑えつつ、`filePath` が正しく取れる。

### ADR 候補（Phase 10.1 関連）

- **ADR-12 候補**: Eagle Plugin API で `filePath` を使う場合は `fields` プロジェクションを避け、`getSelected()` / `getAll()` / `get({ ids })` のいずれか（fields なし）を使う
  - 理由: `fields` で `filePath` を指定しても正常に取得できない（Eagle 4.0 Build12 時点）。filePath は `${name}.${ext}` の動的組み立てらしく、`ext` がプロジェクション対象外だと undefined になる
  - 見直し条件: Eagle 側が `fields` で `filePath` を正式サポートしたら再検討

### code-simplifier レビュー結果（2026-07-22）

- 高重要度: 0件（修正は妥当）
- 中重要度: 4件 → うち2件対応
  - ✅ `getUntagged` デフォルト fields から filePath を除去（バグ温存防止）
  - ✅ `getItemById` が null を返す race condition テストを追加（Phase 10.1 の保護ロジックをカバー）
  - ⏭ `getItemById` が throw するケースのテスト（low-risk で見送り・実機で再現したら追加）
  - ⏭ `getItems` JSDoc の「フルデータ」記述が古い（micro 修正・本次スコープ外）
- 低重要度: テストモックの非対称性・JSDoc の正確性等（外科的変更原則で見送り）

### Race condition 保護（Phase 10.1 で追加）

`getItemById(id)` が null や throw を返すケース（アイテムが候補選出後に削除された等）を考慮:
- null/throw を catch → `lastScanAt` を更新して次の tick へ
- `consecutiveErrors` には **カウントしない**（Eagle API の一時的不具合や削除 race は「推論エラー」ではない）
- 設計判断: silent fail を許容する graceful degradation。`getIdsWithModifiedAt` 失敗時の挙動と一貫

## Phase 10.2 — 自動停止時のエラー診断強化（2026-07-23）

### 背景

Phase 10.1 の実機調査で、連続エラー自動停止時の UI メッセージが
「停止: 連続エラーが閾値 (5) に到達したため自動停止しました」のみで、
原因特定に DevTools のログ全文（ユーザーからの貼り付け）が必要だった。

### 根本原因（3点）

1. **UI 層がペイロードの字段を捨てていた**: `auto-tagger.js` の `onWarning` には
   `lastError` / `consecutiveErrors` が含まれていたが、`ui.js` の `autoOnWarning` は
   `w.message` しか表示していなかった
2. **二重警告**: `tick()` が `onWarning(...)` 発火後に `stop(reason)` を呼び、
   `stop()` 内部が `onWarning({reason:"stopped", message})` を再発火（2回目は情報少）
3. **履歴不在**: `state.lastError` は直近1件のみ。5件が同一エラーか混在か区別不能。
   エラー本体は `console.warn` のみで DevTools 未開放時は消失

### 修正内容（SPEC §15.10）

- `errorHistory` リングバッファ（上限10件 `{at, fileName, message}`、`push`+`shift`）
- `onWarning` ペイロードに `lastError` / `errorHistory`（`slice()` コピー）を同梱
- 警告後は `stop()` を **reason なし**で呼び二重発火を解消（1停止 = 1警告）
- UI: 停止メッセージに直近エラー併記 / `title` に履歴全文 / 「詳細コピー」ボタン
  （`navigator.clipboard` + `execCommand` フォールバック）

### 教訓

- **コールバックペイロードの情報は UI 層で黙って捨てられ得る**。表示系の不備は
  「発信側が渡しているか」→「UI が表示しているか」の両方を確認する
- 前回セッションの「ユーザーがエラー全文を貼り付け → 即原因特定」が機能したため、
  詳細コピーボタンで同じワークフローを UI 側に内置した
- `stop(reason)` のような「理由付き停止 API」は内部呼び出しで二重通知を生みがち。
  呼び出し側で警告済みの場合は reason を渡さない規約をコメントで明記

### ADR 候補

- なし（UI 表示・内部状態の修正で、トレードオフを伴う架构決定ではない）

---

## Phase 10.3 検討 — 画像取り込みトリガーの可否（2026-07-22・未実装）

> 注: 前セッション（2026-07-22）の調査記録。当初「Phase 10.2 検討」と記録されていたが、
> エラー診断強化が Phase 10.2 として実装・マージ済み（PR #5）のため、本节は Phase 10.3 検討に改名した。

### 調査: 画像取り込みトリガーの可否（公式 doc で再確認）

- ユーザー要望: 「画像を Eagle に追加することをトリガーにタグ付けしたい」
- 結論: **不可能**。Eagle Plugin API にアイテム追加イベントは存在しない（Phase 10 調査の再確認・2026-07-22 に公式 doc で検証）
  - イベント全種: `onPluginCreate` / `onPluginRun` / `onPluginBeforeExit` / `onPluginShow` / `onPluginHide` / `onLibraryChanged` / `onThemeChanged`
  - `onLibraryChanged` は**ユーザーがリソースライブラリを切り替えたとき**のみ発火（アイテム追加では発火しない）
  - 出典: https://developer.eagle.cool/plugin-api/zh-cn/api/event
- 代替案として「新規画像だけ〜5秒間隔で差分監視する高速レーン」を AI が提案（既存45秒サイクルと併用）

### ADR 候補

- **ADR-13 候補**: 画像取り込みトリガーの高速検知レーンは追加せず、現行の45秒ポーリング設計を維持する（ユーザーが AI の高速レーン提案を覆して「実装不要・現状維持」を指示）
  - 理由: API 制約で完全なイベント駆動は不可。差分ポーリングの短縮は Eagle 本体負荷とのトレードオフで、現状の遅延（最大45秒・新規優先）は許容範囲
  - 見直し条件: 実機運用で「45秒遅延が実害」と判明した場合、または Eagle API にアイテム追加イベントが追加された場合
