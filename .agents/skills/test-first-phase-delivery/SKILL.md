---
name: test-first-phase-delivery
description: "Test-first autonomous phase implementation. Step 1: write comprehensive failing tests (unit + E2E) from .spec/plan.md acceptance criteria + edge cases (localStorage hydration with missing fields, integer clamping, RTL/locale). Commit tests. Step 2: enter autonomous loop — run all gates, parse failures, implement minimal fix, log to progress file, repeat until green (max 20 iterations). Step 3: code-simplifier subagent review, apply warranted suggestions, open PR with Trail-files gate. USE FOR: test-driven autonomous phase landing, TDD-first feature delivery, red-green-refactor loop with simplifier review. TRIGGERS: 「テストファーストで Phase X を実装」「TDD autonomous loop」「test-first autonomous iteration」「.spec/plan.md からテスト先行で」「red-green-refactor で進めて」"
---

# test-first-phase-delivery

## Overview

`.spec/plan.md`（または同等）から **失敗テストを先に書き** → **自律ループで実装** → **simplifier レビュー** → **PR** という TDD 駆動のフェーズ実装スキル。`plan-phase-delivery` の 4 品質ゲートに加え、「ループ内で各反復をログ化」「上限到達でエスカレーション」を明示することで、長時間の自律実行でも観測可能性と暴走防止を両立する。

**コア原則:**
1. **テストが先、実装が後** — acceptance criteria + edge cases を網羅した失敗テストを Step 1 で commit する。実装からスタートしない。
2. **自律ループは観測可能であること** — 各 iteration を `.spec/PROGRESS-*.md` に追記。「何が失敗し、何を修正し、次に何を見るか」を 1 行で記録。
3. **Minimal fix を逸脱しない** — 失敗を直す最小コード以上の変更を加えない。scope creep は次フェーズに送る。
4. **20 iterations が上限** — 超えたらユーザーにエスカレーション。20 回直らない問題は設計判断の領域。
5. **simplifier は loop の外で別観点として回す** — 自己レビューでは出てこない second-order の指摘を取る。

開始時に宣言する: **「test-first-phase-delivery で Phase X を進めます。Step 1（テスト作成）から開始します。」**

## When to Use

- Acceptance criteria が plan に明示されているフェーズ
- 過去の MEMORY.md に同種のバグ事例がある領域（localStorage hydration / RTL / アニメーション 等）
- 長時間の自律実行を許容するタスク（夜間バッチ的に進める場合）

**Do NOT use when:**
- 設計探索が主目的のフェーズ（要件が固まっていない）
- UI ポリッシュなど、acceptance criteria を測定不可能な変更
- 数行で済む typo / lint fix（オーバーキル）

## Inputs

| Input | 解決方法 |
|---|---|
| **プランファイル** | `.spec/plan.md` を最優先、なければ `.spec/TODO.md` の該当 phase セクション + `~/.claude/plans/*.md`。 |
| **フェーズ ID** | プロンプトから抽出。無ければ作業前に確認。 |
| **テストランナー** | プロジェクトのテストランナー（例: `vitest` を `npm test` で headless 実行）。 |
| **typecheck コマンド** | プロジェクトの型チェックコマンド（例: `tsc --noEmit`）。 |
| **E2E ランナー** | Playwright が `package.json` にあれば `npm run e2e`。**未導入なら `browser-use` skill + 接続先指定（例: `--cdp-url http://localhost:<port>`）で代替**（後述）。 |
| **iteration 上限** | デフォルト 20。ユーザー指定があれば従う。 |
| **progress file** | `.spec/PROGRESS-test-first-<phase>-YYYYMMDD-HHMM.md`。タイムスタンプは `date -u +"%Y%m%d-%H%M"`。 |

## Workflow

### Step 1: 失敗テストを書く（実装より先）

#### 1-a. acceptance criteria を列挙

プランを **全文** 読んで以下を抽出:

- 機能要件（ユーザー視点の挙動）
- 受け入れ基準 / Definition of Done
- 入出力の型 / state shape
- 副作用（永続化、analytics、navigate 等）

#### 1-b. edge cases を必ず加える

経験的に事故率が高い以下の edge cases は **デフォルトで** テスト対象に加える（プロジェクトの MEMORY.md の落とし穴・State Management ルールに応じて調整）:

| 領域 | テストすべき edge case |
|---|---|
| **localStorage / persisted store** | 既存ユーザーの localStorage に **新フィールドが欠落** している場合の hydration（空 UI 防止）/ schema 変更 / `phase !== 'start' && Object.keys(field).length === 0` の bootstrap 再生成 |
| **整数クランプ** | 範囲外入力（負値 / 上限超過 / 非整数 / NaN / `Number.MAX_SAFE_INTEGER`）→ 期待値への clamping |
| **RTL / locale** | `dir="rtl"` 時の物理プロパティ → 論理プロパティ追従 / 数値方向の固定 / 全 i18n キーの存在 |
| **アニメーション** | `prefers-reduced-motion` 時の即時最終値 / アニメーション値の state 反映 |
| **DEV ガード** | `import.meta.env.DEV` 三項分岐の型 / prod build での tree-shake |

これら edge cases は **acceptance criteria に明記されていなくても** 必ず加える。過去の事故率が高い領域。

#### 1-c. テスト構成

- **Unit tests**: `src/**/*.test.ts(x)` に配置。vitest で実行。
  - 1 acceptance criterion → 1 `describe` ブロック
  - edge cases → 同じ `describe` 内に `it('with missing localStorage fields, ...')` 等
- **E2E tests**:
  - Playwright 導入済み: `e2e/*.spec.ts` に Playwright tests。
  - 未導入: `src/test/e2e/<phase>.browser-use.md` に **browser-use シナリオ** を Markdown で記述（手順 + 期待結果）。後で `browser-use` skill で実行する。

#### 1-d. テストをコミット

```bash
git add <test files>
git commit -m "test(<scope>): Phase <id> failing tests (TDD step 1)"
```

このコミット後 **必ず一度全テストを走らせて失敗していること** を確認:

```bash
npm test
# RED 状態を確認
```

全部パスしてしまったらテストが薄い → 1-b に戻る。

### Step 2: 自律ループ（最大 20 iterations）

#### 2-a. progress file 初期化

```bash
TS=$(date -u +"%Y%m%d-%H%M")
PROGRESS=.spec/PROGRESS-test-first-<phase>-${TS}.md
```

テンプレートは後述の「Progress File テンプレ」を使う。初期化時点では `Inputs` と `Step 1 Summary` までを埋め、`Iterations` 以降は空のまま置く。

#### 2-b. 1 iteration の手順

各反復:

1. **ゲート実行**: 以下を順に実行し、最初に失敗したゲートで止まる
   ```bash
   npm test
   tsc --noEmit
   npm run lint
   npm run build
   # Playwright 導入時:
   #   npm run e2e
   # 未導入時:
   #   skip — Step 3 後に browser-use で別途検証
   ```
2. **失敗 parse**: stderr/stdout を読み、失敗したテスト名 / 型エラー位置 / lint 違反を特定。
3. **Minimal fix 実装**: 失敗を解消する最小コードのみ。隣接コードを「ついでに改善」しない（Karpathy: Surgical Changes）。
4. **再ゲート実行**: 直した箇所だけでなく **全ゲート** を再実行（second-order regression 検出）。
5. **progress file 追記**:
   ```markdown
   ### Iter 5 — 2026-05-20T02:14:33Z
   - Failed: `cartStore > quantity > clamps quantity to max`
   - Root cause: quantity が `Math.min` 適用前に floor されていない
   - Fix: `src/store/cartStore.ts:42` で `Math.floor` を `Math.min` の前に追加
   - Next: e2e gate (skipped, browser-use 後段)
   ```
6. **次の反復へ進む** or **全 green ならループ脱出**。

#### 2-c. ループ脱出条件

| 条件 | 挙動 |
|---|---|
| 全ゲート green | Step 3 へ進む |
| 同一原因で 3 周連続失敗 | エスカレーション（後述） |
| iteration 数 = 20 | エスカレーション |
| `npm install` レベルの環境問題 / ゲート結果のパース失敗 | エスカレーション |
| acceptance criteria 自体に矛盾を発見 | エスカレーション |
| Plan に書かれていない仕様判断が必要になった | エスカレーション |

#### 2-d. エスカレーション

ループ脱出条件のいずれかに当たったら **質問なしに止まる** わけではなく、以下を実行:

1. progress file の `Final` セクションに失敗状況・推測される根本原因・試した修正を記録
2. `result:` を書かずに **ユーザーに状況を提示**（job 内に `needs input:` 行を出す）
3. ユーザー回答後に loop 再開 or 別アプローチに切替

「質問しない」のはあくまで **小さな判断（minimal fix の選択肢など）**。20 回直らない構造的問題は人の判断領域。

### Step 3: simplifier subagent レビュー

ループ脱出（全 green）後、`code-simplifier` を Task tool で spawn:

```text
subagent_type: code-simplifier
prompt: |
  PR #<N> (Phase <id>) ではなく、現在の worktree の `git diff <base>..HEAD`
  の差分をレビューしてください。コード変更はせずレポートのみ。
  プロジェクト規約（例: Karpathy ガイドライン、データ I/O 規約、
  スタイルトークン、i18n / RTL 対応、State Management migration ルール など）は
  プロジェクトのものに置き換える。
  重要度 (高/中/低) でソート。
```

返ってきた指摘について:

- **高 / 中**: 適用する。適用後に **再度 Step 2 のゲートを 1 周** 回す（regression 防止）。
- **低**: 適用するか書面で反論（progress file に記録）。
- **黙って無視は不可**。

simplifier 適用後、もう一度 progress file に `### Simplify Pass` セクションで何を入れたか記録。

### Step 4: PR 作成 + bot mention

`create-pr` skill に従う:

```bash
gh pr create --draft --base <base-branch> \
  --title "feat(<scope>): Phase <id> <summary> (test-first)"
```

PR 本文（必須セクション）:

```markdown
## 概要
このフェーズが必要な WHY を 1〜3 行。Plan 参照。

## TDD ログ
- Test commit: <sha>
- Progress file: `.spec/PROGRESS-test-first-<phase>-YYYYMMDD-HHMM.md`
- Iterations: <N> / 20
- Simplifier 指摘: 高 <a> / 中 <b> / 低 <c>（適用 <m> 件）

## 動作確認
- [x] `npm test` (vitest)
- [x] `tsc --noEmit`
- [x] `npm run lint`
- [x] `npm run build`
- [ ] `npm run e2e`（未導入。`browser-use` で <シナリオ> 実行: 結果）
- [x] code-simplifier subagent review

## マージ条件
レビュー後マージ可
```

PR 作成 → 別コメントで `@copilot @claude` mention（既存運用通り）。

### Step 5: Trail-files gate（最終必須）

`plan-phase-delivery` の Trail-files gate と同じ:

```bash
git diff <base>..HEAD -- .spec/TODO.md .agents/handoff/HANDOFF.md .agents/memory/MEMORY.md
```

3 ファイル全てに当該フェーズ関連の diff が無ければ `result:` を書かずに trail 更新へ戻る。progress file 自体も `.spec/` 配下に commit するので、TODO.md には「Phase X test-first 完了。progress: PROGRESS-...-md」エントリを追加する。

### Step 6: 完了報告

- 1 行ヘッドライン: Phase X を PR #N で出した（test-first / N iterations / simplifier 適用済）
- 箇条書き:
  - 各ゲートの最終結果
  - iteration 数 + 主要な root cause
  - simplifier 適用件数
  - フォローアップ（e2e が未導入なら導入 issue 起票推奨）
- `result:` を独立行で書く

## Progress File テンプレ

```markdown
# Test-first Autonomous Progress (Phase <id>, <timestamp> UTC)

## Inputs
- Plan: `.spec/plan.md`
- Phase ID: <id>
- Test commit: <sha>
- Iteration limit: 20
- E2E mode: vitest only / playwright / browser-use fallback

## Step 1 Summary
- 失敗テスト件数: <N>
  - Unit: <a> (acceptance: <x>, edge: <y>)
  - E2E: <b>
- Coverage targets: <files/modules>

## Iterations

### Iter 1 — <timestamp>
- Failed: <test name>
- Root cause: <one line>
- Fix: <file:line summary>
- Next: <expected next failing test>

### Iter 2 — ...

## Step 3 — Simplifier Pass
- 高: <件数> ＞ 適用 <件数>
- 中: <件数> ＞ 適用 <件数>
- 低: <件数> ＞ 適用 <件数>
- 反論記録: <if any>

## Final
- Outcome: green / escalated / stopped
- Total iterations: <N>
- PR: <url>
- Open follow-ups: <list or none>
```

## Anti-Patterns（絶対回避）

- **実装を先に書いてからテストを足す** — TDD ではない。Step 1 が成立しない。
- **edge cases を「明示されてないから」とスキップ** — 1-b のリストは経験則として最低ライン。
- **progress file を更新しない** — 観測可能性が失われ、エスカレーションも適切にできない。
- **scope creep** — failing test 以外の改善を loop 内で混ぜない。
- **simplifier をスキップ** — 自己レビューでは second-order の指摘が出ない。
- **20 iterations 超で続行** — 構造問題なのでエスカレーション必須。
- **e2e ゲート無視（Playwright 未導入を理由に）** — `browser-use` で代替 → PR 本文にシナリオと結果を記録。

## Coordination with Other Skills

- **`plan-phase-delivery`** — 兄弟スキル。「テスト後追い OK」「自律ループ不要」のフェーズに使う。
- **`parallel-phase-delivery`** — 各 subagent の中身として本スキルを呼べる（より厳密な並列 TDD）。
- **`code-simplifier`** — Step 3 で subagent として spawn。
- **`browser-use`** — Playwright 未導入時の E2E 代替。
- **`git-commit`** / **`create-pr`** / **`resolve-pr`** — それぞれ Step 1, Step 4, レビュー後対応。
- **CLAUDE.md の State Management ルール** — Step 1-b の edge case リストの根拠。

## Project Notes（プロジェクト固有・要設定）

- 言語: プロジェクトの記述言語
- ベースブランチ: プロジェクトのデフォルトブランチ（`main` / `develop` 等）
- テスト: テストコマンド（例: `npm test`（vitest）/ `npm run test:run`）
- typecheck: 型チェックコマンド（例: `tsc --noEmit`）
- lint: lint コマンド（例: `npm run lint`）
- build: ビルドコマンド（例: `npm run build`）
- **E2E**: Playwright 等が未導入なら `npm run e2e` は失敗する。E2E 必要時は `browser-use` skill + 接続先指定（例: `--cdp-url http://localhost:<port>`）で代替。導入する場合は本スキル更新と同時に `package.json` に `e2e` script を追加。
- worktree: `wt switch --create feat/phase-<id> --yes`
- progress file: `.spec/PROGRESS-test-first-<phase>-YYYYMMDD-HHMM.md`
- trail パス: `.agents/handoff/HANDOFF.md`, `.agents/memory/MEMORY.md`, `.spec/TODO.md`
- bot mention: PR 作成後別コメント
- State Management 規約: 永続化 store の新フィールドは hydration fallback 必須（Step 1-b 適用）

## Why This Discipline

TDD は「テストが先」という規律自体に価値があるのではなく、「acceptance criteria を実装前に文書化する」ことに価値がある。テストは仕様の executable な表現で、実装した後に書くテストはバイアスで仕様を狭めがちになる。

自律ループは「人間が常時監視しなくても進む」ことではなく、「人間が必要な判断にだけ呼び戻される」状態を作る。progress file はその呼び戻しの根拠資料であり、エスカレーション時の出発点。

20 iterations 上限は、ヒューリスティック的に妥当な目安。経験的に、それを超えて green にならない問題は **テストが過剰** か **設計が間違っている** か **acceptance criterion 自体が誤り** のいずれかで、いずれも人の判断が必要。
