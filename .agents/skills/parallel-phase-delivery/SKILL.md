---
name: parallel-phase-delivery
description: "Implement multiple independent phases from .spec/TODO.md in parallel by spawning Task subagents — each in its own worktree — then run all quality gates and code-simplifier review per agent and produce a dependency-aware merge sequence plan. Use the plan-phase-delivery skill INSIDE each spawned agent. Tracks status via a coordinator markdown file. USE FOR: parallel phase implementation, multi-PR fan-out, independent phase batch landing, parallel rollout of TODO items. TRIGGERS: 「TODO の独立フェーズを並列実装」「Phase X と Y を並列で進めて」「parallel phase delivery」「fan out independent phases」「.spec/TODO.md から独立 phase を並列で」"
---

# parallel-phase-delivery

## Overview

`.spec/TODO.md`（または同等のプラン）から **互いに依存しない複数フェーズ** を抽出し、各フェーズを独立 worktree + subagent で並列実装する。各 subagent は `plan-phase-delivery` スキルを内包し、品質ゲート → PR → trail ファイル更新まで完走する。最後にコーディネータがマージ順を決定する。

**コア原則:**
1. **独立性は読み取りで証明する** — 「たぶん独立」ではなく、対象ファイル / モジュールの集合が交差しないことを diff/grep で確認。
2. **subagent は plan-phase-delivery を遵守** — 並列でも 4 品質ゲート + Trail-files gate は省略しない。
3. **コーディネータは状態を 1 つの markdown に集約** — 各 agent の進捗・PR URL・ゲート結果を可視化。途中失敗の影響範囲を即把握できるようにする。
4. **マージ順は依存グラフから機械的に決める** — 並列実装と並列マージは別物。マージで初めて依存解決される箇所もある。

開始時に宣言する: **「parallel-phase-delivery スキルで N フェーズを並列実装します。」**

## When to Use

- ユーザーが「TODO から独立フェーズを並列実装」を依頼
- 複数の小さなフェーズ（UI コンポーネント単独、独立な store の追加など）が滞留していて、順次実装より並列の方が速い
- バックグラウンド subagent と worktree が利用可能な環境

**Do NOT use when:**
- フェーズが 1 つしかない → `plan-phase-delivery` を直接使う
- フェーズ間に共有ファイル / API 契約変更が絡む → 直列で実装
- ローカル環境のリソース（CPU / メモリ / dev サーバ port）が並列実行に耐えない

## Inputs（毎回特定する）

| Input | 解決方法 |
|---|---|
| **プラン / TODO ファイル** | `.spec/TODO.md` を最優先。サブプラン参照があれば `.claude/plans/*.md` も読み込む。 |
| **並列実行候補のフェーズ ID** | プロンプトで明示されればそれを使う。未指定なら TODO から独立 phase を自動抽出（後述）して **ユーザーに確認**してから着手。 |
| **並列度上限** | デフォルト 4。ユーザー指定があればそれに従う。dev サーバの port 競合、メモリに留意。 |
| **レビュワー** | `plan-phase-delivery` の Inputs に従う（bot は PR 作成後別コメントで mention）。指定が無ければ作業前に確認。 |
| **ベースブランチ** | プロジェクトのデフォルトブランチ。`plan-phase-delivery` と同じ。 |
| **コーディネータファイル** | `.spec/PARALLEL-COORDINATOR-YYYYMMDD-HHMM.md`。タイムスタンプは `date -u +"%Y%m%d-%H%M"`。 |

## Workflow

### 1️⃣ TODO / プラン精読 + 依存グラフ構築

`.spec/TODO.md` を **全文** 読む。先行フェーズの状態、未完項目、共有モジュールへの言及を把握する。

各候補フェーズについて以下を抽出:

- 対象ファイル / モジュール集合（追加・変更・削除）
- 依存先（このフェーズが触る前に他のフェーズが完了している必要があるか）
- 提供する成果物（他フェーズから参照され得る symbol / API）

依存グラフを作成:

```text
Phase A → (touches: src/store/foo.ts)
Phase B → (touches: src/components/Bar.tsx)
Phase C → (touches: src/store/foo.ts, src/components/Baz.tsx)  # ← A と衝突
Phase D → (depends-on: A の export)
```

**独立性の判定基準:**

- ファイル集合の **交差が空** であること。
- 同じ symbol を export/import で取り合っていないこと。
- 同じ i18n キー namespace を取り合っていないこと（例: 共有ロケールファイル `src/i18n/locales/*.json` → 同じネームスペースは衝突候補）。

判断に迷う候補は **独立ではない側に倒す**（誤って並列実装すると merge conflict + 後戻りコスト大）。

### 2️⃣ 独立フェーズ集合の確定 + ユーザー確認

抽出した独立フェーズをチェックリストでユーザーに提示:

```markdown
## 並列実装候補（独立性確認済み）
- [ ] Phase 5d: 一覧画面リファクタ（touches: src/features/list/**）
- [ ] Phase 5g: 設定画面 polish（touches: src/features/settings/**）
- [ ] Phase 5h: 通知画面 polish（touches: src/features/notifications/**）

## 並列不可（共有依存あり）
- Phase 5e は 5d の `useListPanel` export 追加に依存 → 5d 完了後に直列

並列度上限: 3 (デフォルト 4 だが今回 3 で十分)
レビュワー: @copilot, @claude

このスコープで並列実装を開始してよろしいですか？
```

**ユーザー承認なしで先に進まない。**

### 3️⃣ コーディネータ markdown 作成

`.spec/PARALLEL-COORDINATOR-YYYYMMDD-HHMM.md` を作成。タイムスタンプは `date -u +"%Y%m%d-%H%M"` で取得（推測禁止）。

テンプレート:

```markdown
# Parallel Phase Delivery Coordinator (YYYY-MM-DD HH:MM UTC)

## Scope
- Plan: `.spec/TODO.md`
- 並列度: 3
- ベースブランチ: `<base-branch>`
- レビュワー: @copilot, @claude

## Agents

| Agent | Phase | Worktree | Branch | PR | Test | Static | Browser | Simplify | Trail | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| #1 | 5d | `.claude/worktrees/phase5d` | `feat/phase5d-...` | – | – | – | – | – | – | spawning |
| #2 | 5g | `.claude/worktrees/phase5g` | `feat/phase5g-...` | – | – | – | – | – | – | spawning |
| #3 | 5h | `.claude/worktrees/phase5h` | `feat/phase5h-...` | – | – | – | – | – | – | spawning |

## Dependency Graph
- 5d, 5g, 5h: 独立
- (5e は 5d 後)

## Merge Sequence Plan
(全 agent 完了後に書き込む)

## Issues / Blockers
(発生したら追記)
```

### 4️⃣ Subagent を並列 spawn

各独立フェーズに対して `Task` ツールで subagent を spawn。1 つのメッセージ内で **複数 Task 呼び出しを並列発行** すること（順次発行は逐次実行になる）。

subagent への prompt テンプレート（self-contained で渡す）:

```text
あなたは plan-phase-delivery スキルを使って Phase <ID> を実装するエージェントです。

## 前提
- プラン: <絶対パス>/.spec/TODO.md（および参照する .claude/plans/*.md）
- 対象フェーズ ID: <ID>
- ベースブランチ: <base-branch>
- レビュワー: <list>
- 並列実装中: 他に <N-1> 個のエージェントが別フェーズを実装しているので、
  以下を厳守:
  - 自分専用の worktree を `wt switch --create feat/phase-<id> --yes` で作成
  - `npm install` は worktree post-start hook で自動実行される
  - dev サーバ port が衝突した場合は `--port` で別 port を割当
  - 他フェーズの作業領域（指定ファイルパス外）を読み書きしない
  - main checkout に戻らない

## やること
plan-phase-delivery skill の Workflow を完走:
1. プラン精読 → フェーズ抽出
2. ワークスペース設定（自分専用 worktree）
3. 実装（スコープ厳守）
4. 4 品質ゲート（Test / Static / Browser / Simplify）を loop で完走
5. コミット → push
6. PR 作成 + bot mention 別コメント
7. trail ファイル更新（HANDOFF / MEMORY / TODO）
8. Trail-files gate
9. 完了報告

## 報告フォーマット（最終応答）
- 1 行ヘッドライン: Phase <ID> の PR URL
- 各ゲートの結果（passed/failed/skipped + 理由）
- 発見した依存・他フェーズへの影響（あれば）

result: Phase <ID> を PR #N で出しました
```

**Task tool の使い方:**

- `subagent_type`: `general-purpose`（必要に応じて）または専用 agent。
- `isolation`: `worktree` を指定すると Task tool 側でも worktree 隔離される。ただしここでは subagent 内で `wt` を使うので、`isolation` 指定は任意。
- `run_in_background`: `true` にして並列実行 + 完了通知を受ける。
- 1 つのメッセージ内に複数の `Task` ツール呼び出しを記述して並列発行する。

### 5️⃣ Code-simplifier review を並列で

各 PR が立ち上がったら、**追加で** code-simplifier subagent を並列 spawn:

```text
subagent_type: code-simplifier
prompt: PR #<N> (Phase <ID>) の差分をレビューし、重要度（高/中/低）で
ソートしたコメントを返してください。コード変更はせずレポートのみ。
プロジェクト規約（例: Karpathy ガイドライン、データ I/O 規約、
スタイルトークン、i18n / RTL 対応 など）はプロジェクトのものに置き換える。
```

各 phase agent が simplify gate を自前で回しているが、**別観点で第二意見** を取ることで second-order regression を捕まえる。レポートを coordinator markdown の `Simplify` 列に集約。

### 6️⃣ 全 agent 完了待機 + coordinator 更新

各 subagent の完了通知を受けるたびに coordinator markdown を更新:

- PR URL を記録
- 各ゲートの passed/failed を反映
- failed があれば Issues / Blockers に追記

**Anti-pattern**: 完了確認のために `sleep` で polling しない。`run_in_background` の通知を待つ。

### 7️⃣ Merge sequence plan の作成

全 agent が完了したら、依存グラフから merge 順を機械的に決定:

```markdown
## Merge Sequence Plan

### Round 1（並列マージ可）
- PR #101 (Phase 5d) — base: <base-branch>, 依存なし
- PR #102 (Phase 5g) — base: <base-branch>, 依存なし
- PR #103 (Phase 5h) — base: <base-branch>, 依存なし

### Round 2（Round 1 マージ後）
- PR #104 (Phase 5e) — base: <base-branch>, 依存: 5d (PR #101)
  - PR #101 マージ後に rebase + 再 push

### Notes
- 同じファイルを触る PR が複数あれば順次マージ + rebase
- bot レビューの追加指摘があれば resolve-pr スキルで対応してから次 Round
```

### 8️⃣ 最終報告

- 1 行ヘッドライン: N フェーズ並列実装完了 + コーディネータファイルパス
- 各 PR URL 一覧
- ゲート通過数 / failed 数
- マージ順プラン参照
- バックグラウンド実行中の場合は `result:` を独立行で書く

## Coordinator Markdown の更新タイミング

| イベント | 更新内容 |
|---|---|
| subagent spawn | Status を `spawning` → `in_progress` |
| 各ゲート通過 | 該当列を ✓ |
| PR 作成完了 | PR 列に URL |
| code-simplifier review 完了 | Simplify 列に「重要度別件数」サマリ |
| failure | Status を `failed` + Issues セクションに詳細 |
| 全 agent 完了 | Merge Sequence Plan を記入 |

## Anti-Patterns（絶対回避）

- **独立性の判定を勘で決める** — ファイル集合・symbol 依存・i18n key namespace を必ず読んで確認。
- **コーディネータ markdown を更新しない** — 単一の真実源として運用しないと並列の意味が消える。
- **subagent 内で main checkout に戻る** — Worktree Isolation (STRICT) 規約違反。`wt` で別 worktree を作成。
- **port 競合を無視する** — dev サーバが衝突したら `--port` で別 port を割当。
- **マージ順を考えず一気にマージ** — 依存 phase 同士は順次 + rebase が必須。
- **sleep / polling で完了待ち** — `run_in_background` の通知を待つ。
- **simplify を agent 内だけで済ませる** — コーディネータからの追加 simplify subagent で第二意見を取る。

## When to Stop and Ask

- TODO から独立フェーズが 1 つしか見つからない → `plan-phase-delivery` を直接使う旨を提案
- 候補フェーズ間で依存判定が曖昧 → ユーザーに判定を仰ぐ
- 並列度上限を超える候補（リソース不足の懸念） → ユーザーに上限調整を確認
- どの subagent も同一ファイルで衝突 → 直列実行に切替を提案

## Quick Reference

### 並列実行コマンド・パス

- worktree: `wt switch --create feat/phase-<id> --yes`
- coordinator: `.spec/PARALLEL-COORDINATOR-YYYYMMDD-HHMM.md`
- タイムスタンプ: `date -u +"%Y%m%d-%H%M"`
- ベースブランチ: `<base-branch>`
- dev port: プロジェクトの既定ポート、競合時は別 port を割当（例: `npm run dev -- --port <port>`）

### 関連スキル

- **`plan-phase-delivery`** — 各 subagent が内包する単一フェーズ実装スキル
- **`code-simplifier`** — 並列 simplify review
- **`create-pr`** — PR テンプレ・ラベル
- **`resolve-pr`** — bot レビュー対応（並列マージ前に必要なら）
- **`git-commit`** — Conventional Commits

### Project Notes（プロジェクト固有・要設定）

- 言語: プロジェクトの記述言語
- ベースブランチ: プロジェクトのデフォルトブランチ（`main` / `develop` 等）
- dev サーバ: 起動コマンドと既定ポート（例: `npm run dev`）
- worktree post-start: 依存インストール等の自動処理（例: `npm install`）
- trail パス: `.agents/handoff/HANDOFF.md`, `.agents/memory/MEMORY.md`, `.spec/TODO.md`
- bot mention: PR 作成後に別コメントで `@copilot @claude`

## Why This Discipline

並列実装は **時間短縮** のためではなく、**独立性が証明された変更を独立にレビュー可能にする** ためにある。1 つの PR に複数 phase を混ぜると、レビュワーは関心領域を再構成しないと読めず、merge conflict も雪だるま式に膨らむ。

並列前提を満たすには「独立性の証明」「状態の集約」「マージ順の明示」の 3 つが揃う必要があり、このスキルはそれぞれを工程として強制する。
