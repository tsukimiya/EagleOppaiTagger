---
name: plan-phase-delivery
description: "Drive a single phase of a written implementation plan to a reviewed PR with iterative quality gates (implement → test → browser verification → code-simplifier review → loop) and finish with commit, PR creation, reviewer assignment, and trail-file updates (HANDOFF / MEMORY / TODO). The target phase ID is supplied per invocation — never assumed or hardcoded. USE FOR: implementing a specific phase from a plan, plan-driven phase landing, phase-by-phase delivery, gated implementation with mandatory loop, ship-a-phase workflow, plan-to-PR pipeline. TRIGGERS: 「プランの Phase X を実装して」「計画書の◯◯フェーズを進めて」「~/.claude/plans/ の Phase X」「.claude/plans/ から Phase X」「Phase X implement and PR」「implement phase X end-to-end」, also any request that combines (1) a plan reference and (2) a phase ID and (3) at least one of {iterative review, browser verification, simplify review, PR with reviewers, trail-file updates}."
---

# plan-phase-delivery

## Overview

書かれた実装プランから **1 フェーズだけ** を取り出し、品質ゲートをすべて満たした PR としてマージ可能な状態に持ち込み、プロジェクトの引き継ぎファイル群（HANDOFF / MEMORY / TODO）まで更新する。

**コア原則:**
1. **フェーズ ID は毎回ユーザーが指定する** — `Phase 4c` の例は使い回されない。プロンプトから抽出し、見つからなければ確認する。
2. **すべてのゲートを毎周回す** — 1 つでも失敗したら最初のゲートからやり直す。スキップは second-order regression を見逃す。
3. **スコープは依頼されたフェーズに限定** — 隣接コードの改善・無関係なリファクタは別 PR か別 issue に分ける（Karpathy: Surgical Changes）。
4. **trail ファイル更新は PR 作成後** — 起こったことの記録であって計画ではない。

開始時に宣言する: **「plan-phase-delivery スキルで Phase X を進めます。」**

## Inputs（毎回特定する）

| Input | 解決方法 |
|---|---|
| **プランファイル** | プロジェクトルートで `.claude/plans/*.md` を最優先で探索 → 見つからなければ `~/.claude/plans/*.md` にフォールバック。複数候補がある場合はフェーズ ID を本文に含むファイルを優先、それでも複数あれば mtime 最新を選ぶ。**選んだファイル名をユーザーに最初の応答で明示する。** |
| **フェーズ ID** | ユーザーのプロンプトから抽出（`Phase 4c`, `4-data` など）。プランの見出しと照合。親フェーズ配下のサブフェーズ（例: Phase 4 > 4c）の場合、サブフェーズが作業単位。**プロンプトに ID が無ければ作業前に確認する。** |
| **検証コマンド** | `package.json` の `scripts`（または `pyproject.toml` / `Makefile`）を読む。例: `npm test` / `npm run lint` / `npm run build` / `npm run dev`。 |
| **レビュワー指定** | ユーザーが指定した mention（例: `@copilot, @claude`）。**bot（@copilot / @claude など）は PR 作成後に「別コメント」で mention することでトリガーされる**（PR 本文や `--reviewer` ではトリガーされない）。実 GitHub ユーザーは `gh pr create --reviewer` でも可。指定が無ければ作業前に確認する。 |
| **trail ファイル** | このフレームワークの規約では `.agents/handoff/HANDOFF.md` / `.agents/memory/MEMORY.md` / `.spec/TODO.md`。これらが無いプロジェクトでは `.agents/`, `.spec/`, `docs/`, repo ルートを探索。既存ファイルの最新エントリを読んで書式を合わせる。 |
| **ブランチ** | `main`/`master`/`develop` 上なら新しいブランチを切る。命名はフェーズから派生（例: `feat/phase-4c-result-modal`）。プロジェクトに `wt` / worktrees 規約があれば従う。 |
| **ベースブランチ** | `git remote show origin` または既存 PR から判定（プロジェクトのデフォルトブランチ）。 |

## Workflow

### 1️⃣ プラン精読とフェーズ抽出

プランを **全文** 読む。フェーズだけ読むと前提（設計トークン、依存関係、未完フェーズの状況）を取り逃す。読んだ上で以下を抽出する:

- ゴール
- 具体的な成果物（ファイルパス / コンポーネント名 / モジュール名）
- 受け入れ基準 / Definition of Done
- 先行フェーズへの依存 — もし未完なら **コードを書く前に** ユーザーに上げる

プランと既存コードが矛盾している箇所（例: 言及されているファイルが既にリネーム済み）を発見したら、黙って再解釈せずに報告する。

### 2️⃣ ワークスペース設定

- ブランチ未分離なら新規ブランチを切る（命名: `feat/phase-<id>-<kebab-summary>`）。
- `CLAUDE.md` / `AGENTS.md` / `README.md` を読み、テストコマンド・lint・型チェック・フォーマッタ・コミットメッセージ規約を把握。
- UI 作業の場合、dev サーバの起動コマンドとポートを確認。

### 3️⃣ 実装

依頼されたフェーズに **スコープを限定** して書く。

- 無関係なリファクタは挟まない。
- 隣接コードのスタイル・コメントを「改善」しない。
- ブロッカーになる実バグを発見したら、別コミットで分離して PR 本文に明記。

### 4️⃣ 4 つの品質ゲート（毎周すべて回す）

ループは **すべてのゲートが同一周で通過した時** のみ終わる。順序は固定:

1. **Test gate** — プロジェクトのテストスイートを実行（例: `npm test` 系コマンドが定義されていれば実行。未定義なら新規挙動の最小カバレッジを同 PR で追加）。
2. **Static gate** — 型チェック + lint + フォーマッタ。例: `npm run lint`、`tsc --noEmit`、`npm run build` のいずれか。warning も CI と同様に扱う。
3. **Browser gate**（UI 変更時のみ）— dev サーバを起動し、**`browser-use` skill** で golden path + 隣接画面の最有力 regression（言語切替・リロード途中・前後画面）を実行する。
   - `browser-use` の接続先はプロジェクト設定に従う（例: `--cdp-url http://localhost:<port>`）。
   - 「何をクリックして何を観測した」を箇条書きで残し、PR 本文に転記。
4. **Simplify gate** — **`code-simplifier` skill** を使い、`git diff <base>...HEAD` の差分に対してレビュー。指摘は適用するか、書面で反論する。黙って無視しない。

**1 つでも失敗したら gate 1 からやり直す。** simplify の指摘が unit test を再度壊すこと、browser-use の発見が新しいユニットテスト要件を生むことは普通に起きる。

**同一原因で 3 周連続失敗** したら、ループを止めてユーザーに上げる。flaky ではなく実問題。

### 5️⃣ コミット（gate 全通過後）

- 関係するファイルだけ stage（`git add -A` / `git add .` は避ける）。
- コミット規約は **Conventional Commits**（`git-commit` skill 参照）。例: `feat(home): Phase 4c 結果モーダル化`。
- メッセージ本文には **WHY** を書く（diff は WHAT を語る）。

詳細は **`git-commit` skill** に従う。

### 6️⃣ PR 作成 + レビュワーコメント

**`create-pr` skill** に従って PR を作成する。基本:

```bash
gh pr create --draft --base <base-branch> \
  --title "feat(<scope>): Phase <id> <短い要約>"
```

PR 本文（必須セクション）:

```markdown
## 概要

このフェーズが必要な WHY を 1〜3 行で。プラン書類へのパス参照: `.claude/plans/<file>.md` の Phase <id>。

## 変更内容

- 主要な追加・変更ファイル
- 削除した内容（旧 ResultPage を消した等）

## 動作確認

### Test gate
- [x] `npm test`（または該当コマンド）の結果
### Static gate
- [x] `npm run lint`, `tsc --noEmit`
### Browser gate
- [x] browser-use で実行したシナリオ（箇条書き）
### Simplify gate
- [x] code-simplifier skill の所見と対応

## マージ条件
レビュー後マージ可
```

PR 作成 → **直後に別コメントを投稿** してレビュワーをトリガーする:

```bash
gh pr comment <pr-number> --body "@copilot @claude このPRの概要説明とレビューをしてください。"
```

レビュワー指名の使い分け:
- **bot（@copilot / @claude 等）**: PR 作成後に **別コメント** で `@<handle>` mention（**これだけが bot をトリガーする**）。PR 本文に書いただけでは発火しない。`gh pr create --reviewer` も bot 側で受け取れない場合がある。
- **実 GitHub ユーザー**: `gh pr create --reviewer <user>` で正規の review request を発行。必要なら追加で本文に `cc @<user>` を入れる。

ラベル設定（任意）は `create-pr` skill 参照。

### 7️⃣ trail ファイル更新（PR 作成後）

PR URL が確定してから書く。事前に書くと PR の変更でズレる。

**trail ファイル規約に従って:**

- **HANDOFF**: `.agents/handoff/HANDOFF.md` を更新する前に、既存ファイルを `.agents/handoff/YYYY-MM-DD-HHMM.md` にリネームしてから新規作成。タイムスタンプは `date -u +"%Y-%m-%dT%H:%M:%S"` で取得。次セッションが何から始めるべきかを書く。
- **MEMORY**: `.agents/memory/MEMORY.md` を更新する前に、既存ファイルを `.agents/memory/YYYY-MM-DD.md` にアーカイブしてから新規作成。**200 行以内**を維持。プランや diff から復元できないこと（学んだ落とし穴・非明白な不変条件・スキャフォルディング判断）だけ書く。
- **TODO**: `.spec/TODO.md` の該当タスクにチェックを入れる。途中で発見された後続タスクは新規エントリとして追加。

他プロジェクトでは: 既存ファイルの最新エントリを読んで形式を合わせる。「日付付きの新規エントリ」が慣習なら従う。「単一の rolling file に追記」が慣習ならそれに従う。

### 8️⃣ Trail-files gate（最終必須・スキップ禁止）

完了報告の前に、trail 3 ファイルが **当該フェーズに関連する変更を本当に含んでいるか** を検証する。実コマンド例:

```bash
git diff <base>..HEAD -- .spec/TODO.md .agents/handoff/HANDOFF.md .agents/memory/MEMORY.md
```

判定基準（**すべて** を満たすこと):

- 3 ファイル **すべて** に diff があること。1 つでも空なら fail。
- 各 diff に当該フェーズ ID / プラン参照 / 主要成果物への言及が含まれること（grep で確認）。テンプレ更新や typo 修正だけは fail。
- HANDOFF.md は今回のセッションのタイムスタンプ + 「次にやること」が記載されていること（古いまま放置でないこと）。

fail した場合:

- 完了報告（次ステップ）を **絶対に出さない**。`result:` も書かない。
- 7️⃣ に戻って該当ファイルを更新してから再度このゲートを実行。
- HANDOFF.md は「リネーム→新規作成」を踏んだか、MEMORY.md は 200 行以内かも確認。

このゲートは Anti-Patterns「PR 作成前に trail を更新」「trail 未更新で完了報告」を防ぐ最後の砦。`Post-Phase Updates` 規約（CLAUDE.md）の強制ポイント。

### 9️⃣ 完了報告

最終応答:

- 1 行ヘッドライン: フェーズ名 + PR URL
- 箇条書き:
  - 通過したゲート
  - スキップ / 延期した項目とその理由
  - ユーザーが知るべきフォローアップ

バックグラウンド実行中の場合は `result:` を独立行で書く。

## Quick Examples

### 基本フロー（Phase X-y を指定された場合）

```text
1. プラン特定
   - .claude/plans/ を探索 → 該当 md を選定
   - 「<plan-file>.md の Phase X-y を進めます」と宣言
2. プラン精読 → フェーズ要件抽出
3. ブランチ: feat/phase-x-y-<summary>
4. 実装 → gate 1→4 全通過まで loop
5. commit (Conventional) → push → gh pr create --draft --base <base-branch>
6. gh pr comment <pr> --body "@copilot @claude このPRの概要説明とレビューをしてください。"（bot トリガーは本文 mention ではなく別コメント）
7. .agents/handoff/HANDOFF.md, .agents/memory/MEMORY.md, .spec/TODO.md 更新
8. Trail-files gate: `git diff <base>..HEAD -- .spec/TODO.md .agents/handoff/HANDOFF.md .agents/memory/MEMORY.md` で 3 ファイル全てに当該フェーズ関連の diff があることを確認（空なら 7 へ戻る）
9. result: Phase X-y を PR #N で出しました
```

### よくある脱線パターンと対策

| 脱線 | 対策 |
|---|---|
| 「ついでに隣の画面もきれいに」 | 別 PR / 別 TODO に切り出す |
| 「simplify の指摘は些細だから後で」 | 適用するか書面で反論する。無視は不可 |
| 「browser gate 通ったから unit test スキップ」 | 全 gate を毎周回す原則を守る |
| 「PR 作る前に HANDOFF 書こう」 | PR URL 確定後まで待つ |
| 「ID 不明だから既存フェーズで進める」 | 止めてユーザーに確認 |

## Quick Reference

### プラン探索順

1. `<repo>/.claude/plans/*.md`（プロジェクト固有）
2. `~/.claude/plans/*.md`（グローバル）
3. 複数候補があれば: フェーズ ID 言及 > mtime 最新

### ゲートチェックリスト（毎周）

- [ ] Test gate: プロジェクトのテストコマンド（例: `npm test`）
- [ ] Static gate: lint + 型チェック + build（例: `npm run lint` + `tsc --noEmit` + `npm run build`）
- [ ] Browser gate: `browser-use`（接続先はプロジェクト設定、例: `--cdp-url http://localhost:<port>`）で golden path + 隣接画面
- [ ] Simplify gate: `code-simplifier` skill を diff に適用

### Final gate（PR 作成 + trail 更新後・完了報告の直前）

- [ ] Trail-files gate: `git diff <base>..HEAD -- .spec/TODO.md .agents/handoff/HANDOFF.md .agents/memory/MEMORY.md` が 3 ファイル **すべて** に当該フェーズ関連の diff を返すこと（空なら 7️⃣ に戻る）

### trail ファイル（フレームワーク規約）

- `.agents/handoff/HANDOFF.md` — リネーム→新規作成
- `.agents/memory/MEMORY.md` — アーカイブ→200 行以内維持
- `.spec/TODO.md` — チェックイン + 派生タスク追加

### 関連スキル

- **`browser-use`** — Browser gate を実行
- **`code-simplifier`** — Simplify gate を実行
- **`git-commit`** — Conventional Commits 規約に従う
- **`create-pr`** — PR 作成のテンプレ・ラベル管理
- **`resolve-pr`** — PR レビュー後の対応（このスキルの「後工程」）

## Troubleshooting

| 問題 | 解決策 |
| --- | --- |
| プランにフェーズ ID が無い | 作業せずユーザーに確認 |
| 先行フェーズが未完 | コード書く前に上げる |
| ゲートが 3 周連続同原因で失敗 | ループを止めてユーザーに上げる |
| dev サーバが起動済かわからない | `lsof -i:<port>` などで確認、無ければ起動コマンド（例: `npm run dev &`） |
| code-simplifier skill の指摘と test が衝突 | 設計判断としてユーザーに上げる |
| trail ファイル書式が複数混在 | 最新エントリの書式に合わせる |
| @copilot / @claude が反応しない | PR 本文や `--reviewer` ではなく **PR 作成後に別コメント**で mention する（`gh pr comment <PR> --body "@copilot @claude ..."`）。これが bot の起動条件 |

## Anti-Patterns（絶対回避）

- **ゲートのスキップ** — 「明らかに通る」は判断ではなく省略。
- **Trail-files gate のスキップ** — `git diff` で 3 ファイル更新を確認する前に `result:` を書かない。空 diff は完了拒否事由。
- **自分で merge** — レビュー依頼した相手の判断を奪う。明示的な auto-merge 指示がない限り merge しない。
- **無関係な変更の同梱** — フェーズ commit に別件を混ぜない。
- **PR 作成前に trail を更新** — PR が変わるとズレる。
- **`main`/`master`/`develop` への直 push** — 必ず PR 経由。
- **フェーズ ID の捏造** — プロンプトに無い ID を勝手に作らない。
- **`~/.claude/` 配下に memory 保存** — このフレームワークの memory 規約で禁止。`.agents/memory/` を使う。

## When to Stop and Ask

- プランファイルが見つからない / 該当フェーズが無い
- 先行フェーズが未完で依存解決不可
- 同一原因のゲート失敗が 3 周連続
- レビュワー指定が無い
- trail ファイルの書式が複数混在で判別不能

## Project Notes（プロジェクト固有・要設定）

導入時に対象プロジェクトの値で埋める:

- **言語**: プロジェクトの記述言語（プラン・コミットメッセージ・PR 本文）
- **ベースブランチ**: プロジェクトのデフォルトブランチ（`main` / `develop` 等）
- **dev サーバ**: 起動コマンドと既定ポート（例: `npm run dev`）
- **テスト**: テストコマンド（例: `npm test`）
- **lint**: lint コマンド（例: `npm run lint`）
- **型チェック**: 型チェックコマンド（例: `tsc --noEmit`）
- **ビルド**: ビルドコマンド（例: `npm run build`）
- **browser-use**: 接続先（例: `--cdp-url http://localhost:<port>`）
- **タイムスタンプ取得**: `date -u +"%Y-%m-%dT%H:%M:%S"` を使用（推測しない）
- **trail パス**:
  - `.agents/handoff/HANDOFF.md`（リネーム→新規作成）
  - `.agents/memory/MEMORY.md`（アーカイブ→200 行以内）
  - `.spec/TODO.md` / `.spec/TODO-YYYY-MM-DD.md`
- **memory の保存先**: プロジェクト規約に従う（このフレームワークでは `.agents/memory/` を使用）

### 任意のプロジェクトへの適用

このスキルは特定プロジェクト専用ではなく、以下を上書きすれば任意のプロジェクトで動く:

- `Inputs` 表のコマンド・パス
- `Project Notes` セクションのプロジェクト固有事項
- `Workflow > 6️⃣` の base ブランチ・PR テンプレ

汎用部分（プラン探索 → 4 ゲートループ → trail 更新 → 報告）は変更不要。

## Why This Discipline

このスキルは「Phase X を実装した」と「Phase X が PR としてレビューされ、ゲートを通り、半年後でも trail から復元可能」の差を埋める。プランがフェーズに切られているのは、フェーズが小さくクリーンに出荷可能だから。ループがあるのは、小さなフェーズでも周辺コードに乗っているために予期しない壊れ方をするから。**毎周全ゲートを回せば、second-order 破損はレビュワーに見つけてもらう前に表面化する。**
