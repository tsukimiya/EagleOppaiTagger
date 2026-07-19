---
name: autonomous-pr-resolution
description: "Autonomously resolve bot PR review comments (Copilot / github-actions[bot] / Claude[bot]). Triggered by pull_request_review or issue_comment events via GitHub Actions on self-hosted runner, or invoked manually. Inspects BOTH code-line review comments AND issue/PR-level comments, auto-applies high-confidence fixes, posts thread replies, and routes to humans via the 'needs-human' label only on rejection or architectural ambiguity. Includes retry logic for Claude model-availability errors. USE FOR: bot review auto-resolution, autonomous PR fix loop, hands-off bot feedback. TRIGGERS: 「PR の bot レビューに自動対応して」「Copilot レビューを自動マージ準備して」「autonomous PR resolution」「auto-resolve PR」"
---

# autonomous-pr-resolution

## Overview

PR レビューで **bot（Copilot / github-actions[bot] / Claude[bot]）** が投げる指摘を、人手を介さず一気に対応するための自動化スキル。GitHub Actions（self-hosted runner）でイベントトリガー実行されるのが基本形だが、ローカル Claude Code からも同じフローを呼び出せる。

**コア原則:**
1. **2 系統のコメントを必ず両方拾う** — code-line review comments と issue/PR-level comments は API エンドポイントが別。片方だけでは bot 指摘の取りこぼしが必ず出る（過去セッションで実際に発生）。
2. **高信頼度のみ auto-apply** — 「妥当性が明確」「修正範囲がスコープ内」「テストへの影響が予測可能」の 3 条件をすべて満たすケースだけ自動修正する。
3. **拒否・曖昧は `needs-human` ラベル経由で人に渡す** — 自動化は人を排除する仕組みではなく、人の判断時間を保護する仕組み。
4. **Claude API の transient error はリトライで吸収** — 過去セッションで model-availability エラー (529 / 503) が作業を止めた。retry policy を必須化。

## When to Use

### 自動起動（GitHub Actions, self-hosted runner）

以下のイベントで `.github/workflows/auto-resolve-pr.yml` がトリガーされ、このスキルを Claude Code で実行する:

- `pull_request_review (types: submitted)` — actor が `copilot[bot]` / `github-actions[bot]` / `claude[bot]` のとき
- `issue_comment (types: created)` — PR 上の issue-level コメント、actor が上記 bot のとき

### 手動起動（Claude Code から）

- ユーザーが「PR #N の bot レビューに自動対応して」と依頼
- 並列開発中の PR で bot レビューが大量に届いて手動対応が追いつかない

**Do NOT use when:**
- 人間のレビュワー（実 GitHub ユーザー）からの指摘 → `resolve-pr` スキルで対話的に対応
- bot 指摘が PR の方向性そのもの（アーキテクチャ判断・スコープ拡張）に関わる → `needs-human` 経由で人に渡す

## Inputs

| Input | 取得方法 |
|---|---|
| **PR 番号** | Actions: `github.event.pull_request.number` or `github.event.issue.number`。手動: ユーザー指定。 |
| **イベント種別** | Actions: `github.event_name`（`pull_request_review` / `issue_comment`）。手動: 全種別を網羅取得。 |
| **発火コメント / レビュー ID** | Actions: `github.event.review.id` or `github.event.comment.id`。手動: 取得不要（全件再評価）。 |
| **対象 bot ホワイトリスト** | `copilot[bot]` / `github-actions[bot]` / `claude[bot]`（プロジェクトで増減可、ワークフロー側の `if` で制御）。 |
| **ベースブランチ** | プロジェクトのデフォルトブランチ。 |
| **PR ブランチ** | `github.event.pull_request.head.ref`。 |

## Workflow

### 1️⃣ 全コメント取得（2 系統必須）

GitHub MCP サーバー (`github-mcp-server`) で構造化取得。**両方必ず呼ぶ**:

| 取得対象 | MCP method | 補足 |
|---|---|---|
| Code-line review comments（コード行付随） | `pull_request_read(method=get_review_comments)` | 行コメントスレッド |
| Review 本体（summary / approve / changes） | `pull_request_read(method=get_reviews)` | bot のレビューサマリ |
| PR 一般コメント | `pull_request_read(method=get_comments)` | 行に紐付かないコメント |
| Issue-level コメント | `issue_read(method=get_comments)` | **bot サマリの主流入口**（Copilot の全体評価など） |

過去セッションで `pull_request_read` 系だけ呼んで `issue_read` を忘れた結果、Copilot の全体評価を取りこぼした事故あり。**4 method 全部** を呼ぶこと。

各コメントを (source, thread_id, author, body, file_path?, line?) のレコードに正規化して 1 つの配列にまとめる。

### 2️⃣ bot 著者フィルタ

レコードを `author IN {copilot[bot], github-actions[bot], claude[bot]}` でフィルタ。

イベント駆動時（Actions）は当該イベント発火元 1 件だけでなく、**未対応の bot 指摘を全件再評価** する。理由: 前回処理から漏れた指摘が累積している可能性があり、毎回スキャンするのが安全。

### 3️⃣ 妥当性判定 + 信頼度スコア

各指摘について 3 軸で評価:

| 軸 | 高信頼度の条件 |
|---|---|
| **妥当性** | 指摘が事実（バグ / lint 違反 / typo 等）として明確に検証可能 |
| **スコープ** | 修正が PR の対象範囲内、隣接コードに波及しない |
| **影響予測** | 既存テスト or 新規テストで挙動を検証可能、副作用の範囲が想定できる |

3 軸すべて高信頼度 → **auto-apply 候補**
1 軸でも曖昧 → **needs-human 候補**

例:

- ✅ auto-apply: `unused import 削除`, `typo 修正`, `null チェック追加（test 追加可能）`, `lint --fix で済む`
- ⚠️ needs-human: アーキテクチャ変更, API 契約変更, 命名規約の総入れ替え, テストで再現できない race condition

### 4️⃣ Auto-apply 実行

auto-apply 候補だけ修正実行:

1. PR ブランチを checkout（Actions: `actions/checkout@v6` で head.ref、ローカル: `gh pr checkout <N>`）。
2. 修正を 1 件ずつ別コミットに分ける（後で revert 容易）。コミットメッセージは `fix(pr-review): <thread の要点>`。Conventional Commits 規約 (`git-commit` skill) に従う。
3. 修正後、各品質ゲートを実行:
   - Test gate: プロジェクトのテストコマンド（例: `npm test`）
   - Static gate: lint + 型チェック + build（例: `npm run lint && tsc --noEmit && npm run build`）
4. ゲート失敗 → ロールバック（`git reset --hard <pre-fix>`）して当該指摘を **needs-human** に降格。
5. 全件処理後 `git push` で PR ブランチに反映。

### 5️⃣ スレッド返信

各 thread に MCP の `add_reply_to_pull_request_comment` で返信:

- auto-apply 済み: `修正しました: <commit-sha>`
- needs-human 降格: `指摘内容について判断が必要なため、メンテナーレビュー待ちです（needs-human）。`
- 既に対応済み（重複検出）: `<commit-sha> で既に対応済みです。`

返信は **1 thread 1 回** に絞る（連投で bot をループさせない）。

### 6️⃣ needs-human ラベル運用

以下のいずれかなら PR に `needs-human` ラベルを付与:

- 妥当性 / スコープ / 影響予測のどれか曖昧
- 自動修正後にゲート失敗
- 同一 thread に対する 2 回目以降の bot 指摘（=「もう一度 try した結果、まだ満足されていない」サイン）
- 3️⃣ で aggregate した needs-human 候補件数が ≥ 全指摘件数の 50%（指摘の傾向が auto-fix で扱う範囲を超えている）

ラベル付与は MCP には適切な method がない場合、`gh api -X POST /repos/{owner}/{repo}/issues/{number}/labels` でも代替可能。

ラベルが付いた PR は、別途 `resolve-pr` スキルで対話的に対応する運用に切替。

### 7️⃣ Retry policy（model-availability errors）

Claude API の transient error は自動化を止めるので、以下を必須化:

- **対象エラー**: HTTP 529 (overloaded), 503 (service unavailable), 504 (gateway timeout), network error
- **最大リトライ回数**: 3
- **バックオフ**: 60s 固定（`nick-fields/retry@v3` の `retry_wait_seconds` は固定待機）。指数的バックオフが必要な場合はワークフロー側で `sleep` 付きのカスタムループに置き換える
- **タイムアウト**: 1 ジョブ全体で 30 分上限
- **失敗時**: PR に `needs-human` ラベルを付与し、コメントで `auto-resolve がモデル可用性エラーで失敗したため、後続対応をメンテナーに委ねます。<error summary>` と通知

Actions では `nick-fields/retry@v3` または同等の retry 機構を使う。ローカル Claude Code 起動では同等のラッパースクリプトで包む。

### 8️⃣ 完了報告

自動化なのでサイレント終了せず、PR にサマリコメントを 1 件投稿:

```markdown
## 🤖 Autonomous PR Resolution Summary

Triggered by: <event> from @<bot>
Comments scanned: <N> (review:<a> / issue:<b>)

Auto-applied:
- [1] <要約> — commit <sha1>
- [2] <要約> — commit <sha2>

Routed to human (needs-human):
- [3] <理由>

Skipped (書面反論):
- [4] <理由>

Gate results: ✅ test / ✅ lint / ✅ build
Replied threads: <m>
Skipped retries: <model-availability error count>
```

**マーカー固定**: 冒頭行は `## 🤖 Autonomous PR Resolution Summary` を変えない。自己ループ防止ガード (`auto-resolve-pr.yml` の `if:` で `startsWith` 判定) がこの文字列に依存している。

**指摘 ID は `[N]` 形式で書く**: GitHub のオートリンクで `#N` は別 PR / Issue 参照に展開されるため、本文中の指摘番号は必ず角括弧 `[1]` `[2]` 等を使う。`#N` は実際に他 PR / Issue をリンクしたいときだけ使う。コミット SHA は 7 桁短縮で OK（自動 commit リンクになる）。

## Coordination with Other Skills

- **`pr-review-check`** — Reviewer roster / 全件取得の手法を共有
- **`resolve-pr`** — needs-human 降格後の対話的対応
- **`code-simplifier`** — auto-apply 前に simplify gate を回したい場合（Actions の中で別 step として呼べる）
- **`git-commit`** — Conventional Commits 規約
- **`plan-phase-delivery`** — このスキルは「フェーズ実装」の後工程として位置づく（PR を出してからの自動 polish）

## Anti-Patterns（絶対回避）

- **`issue_read(get_comments)` を呼び忘れる** — Copilot の全体評価を取りこぼす最頻パターン。
- **bot ホワイトリストを広げすぎる** — 人間のレビューに対して自動修正してしまうと判断を奪う。
- **needs-human ラベルを付けない判断** — 「軽微だから auto-apply」を続けると、判断が必要な指摘も自動で処理してしまう。
- **retry なしで Claude API を叩く** — 529 一発で自動化が止まる。
- **3️⃣ の信頼度評価を 1 軸だけで判定** — 「妥当性」だけ見て修正すると、スコープ外の改変が混入する。
- **修正コミットを 1 まとめにする** — 1 件失敗で全部ロールバックになる。
- **サマリコメントで指摘 ID を `#N` と書く** — GitHub のオートリンクで別 PR / Issue 参照に展開され、混乱を招く。**必ず `[N]` 角括弧形式**を使う。`#N` は実際の他 PR / Issue 参照のみに留める。コミット SHA は 7 桁短縮で OK（自動 commit リンクになる）。
- **サマリコメント冒頭行を変更する** — `auto-resolve-pr.yml` の自己ループ防止ガードが `startsWith('## 🤖 Autonomous PR Resolution Summary')` で判定しているため、文字列を変えると無限ループのリスクが復活する。

## When to Stop and Ask（needs-human）

- 同一 thread に対し 2 回目以降の bot 指摘
- アーキテクチャ / API 契約 / 命名規約レベルの変更要求
- 既存テストが対応できない race condition / async タイミング
- 信頼度評価で曖昧な指摘が過半数

## Local Invocation（Actions 不在時 / 手動再実行）

ローカル Claude Code から起動:

```text
PR #42 の bot レビューに autonomous-pr-resolution で自動対応して
```

手動でも 1️⃣〜8️⃣ の同フローを回す。Actions と違い、ゲート失敗時はユーザーに対話的に判断を聞ける（対話モードの利点）。

## Project Notes（プロジェクト固有・要設定）

- 言語: プロジェクトの記述言語（コミットメッセージ・スレッド返信）
- ベースブランチ: プロジェクトのデフォルトブランチ（`main` / `develop` 等）
- self-hosted runner: 必要に応じて導入（`runs-on: self-hosted`）
- 品質ゲート: プロジェクトのテスト / lint / 型チェック / build コマンド（例: `npm test` / `npm run lint` / `tsc --noEmit` / `npm run build`）
- worktree: Actions では runner の workspace 直で OK（短命）。ローカル起動時は `wt switch --create` で独立 worktree
- bot ホワイトリスト: `copilot[bot]`, `github-actions[bot]`, `claude[bot]`
- ワークフロー定義: `.github/workflows/auto-resolve-pr.yml`

## Why This Discipline

bot レビューは「機械の指摘なのだから機械で対応すればよい」と短絡しがちだが、bot 指摘の半分は **人の判断が必要な設計問題** として混ざってくる。本スキルは「機械で確実に処理できる範囲」と「人に渡すべき範囲」を信頼度評価で分離し、`needs-human` ラベルでルーティングする。これにより人は「判断が必要な指摘」だけに集中でき、自動化が人の意思決定を奪わない。
