---
name: resolve-pr
description: "GitHub PRの未対応レビューコメント（Review Comments）に自動対応。妥当性判定 → コード修正 → commit・push → 返信まで一気通貫で実行。USE FOR: /resolve-pr コマンド, PR review response, unresolved comments対応, レビューフィードバックの実装, PRレビュー修正の自動化, レビューコメントへの対応依頼。"
---

# resolve-pr

## Overview

GitHub PR のレビューコメント(未対応)に対して、指摘の妥当性判定 → コード修正 → コミット・プッシュ → 返信まで一気通貫で対応する。

**コア原則:**
1. 指摘の妥当性をまず判定する
2. 判断に迷う場合は必ずユーザーに確認する
3. 各対応後に即座に返信を投稿する

**ツール選定:** GitHub MCP サーバー (`github-mcp-server`, Remote / OAuth) を最優先で使用。`gh` CLI は MCP が利用できない場合のフォールバック。詳細コマンド対応は [github-api-guide.md](references/github-api-guide.md) を参照。

## When to Use

- ユーザーが `/resolve-pr` でPR対応を依頼
- 未対応のレビューコメント(unresolved threads)への対応が必要
- PR修正の一連プロセス(読む → 判定 → 修正 → 返信)を自動化したい

## Workflow at a Glance

| 順番 | 作業 | 例 (MCP 優先 / gh フォールバック) |
| --- | --- | --- |
| 1️⃣ | **Reviewer roster + ユーザー確認** | 全 reviewer (人間 + bot) をコメント数つきチェックリストで提示し、対応対象を **ユーザーに確認してから次へ進む**（詳細は下記） |
| 2️⃣ | ブランチチェックアウト | `gh pr checkout 42`（git 操作は引き続き CLI を利用）|
| 3️⃣ | レビューコメント取得 | MCP: `pull_request_read(method=get_review_comments)` / gh: `gh api repos/{owner}/{repo}/pulls/42/comments` |
| 4️⃣ | 未対応判定 | 返信の有無確認 |
| 5️⃣ | コメントごと対応 | 妥当性→修正判断→コード変更 |
| 6️⃣ | コミット & プッシュ | `git commit && git push` |
| 7️⃣ | コメントへ返信 | MCP: `add_reply_to_pull_request_comment` / gh: `gh api .../comments/{id}/replies` |
| 8️⃣ | 結果報告 | 修正数・スキップ数・コミットハッシュ |

### ステップ 1️⃣ Reviewer roster（必須・最初に必ず実行）

PR 番号が分かったら、**コード変更や branch checkout に着手する前に** 全 reviewer の一覧をユーザーに提示して確認を取る。これは「対応漏れ・誤った優先順位・想定外の bot レビュー」を最初に潰すためのゲート。

1. **両ソースから取得して集計する**（片方だけでは抜ける）:
   - MCP: `pull_request_read(method=get_reviews)` + `pull_request_read(method=get_review_comments)` + `pull_request_read(method=get_comments)` + `issue_read(method=get_comments)`
   - gh フォールバック: `gh pr view <N> --comments` AND `gh api repos/{owner}/{repo}/pulls/<N>/reviews`（**両方**実行する）
2. 集計結果を **人間 + bot の区別付き** でチェックリスト化して提示:

   ```markdown
   ## PR #42 Reviewer Roster
   - [ ] @username (human): review comments 3 / issue comments 1
   - [ ] @copilot[bot]: review comments 5 / reviews 1
   - [ ] @claude[bot]: issue comments 2 / reviews 1
   - [ ] @github-actions[bot]: issue comments 1
   ```
3. **ユーザーに確認**: 「全件対応してよろしいですか？それとも特定 reviewer に絞りますか？」と明示的に聞く。承認なしで先に進まない。
4. 承認後、対応スコープ（全件 or 絞り込み）を本セッションのメモリとして固定し、後続ステップで遵守する。

**重要:** ステップ 3️⃣ で **inline review comments と issue-level comments の両方** を取得すること。MCP では `pull_request_read(get_review_comments)` + `issue_read(get_comments)` を併用。gh フォールバックでは `gh pr view --json comments` だけでは Review Comments が取れないため `/pulls/{number}/comments` エンドポイントが必須。詳細は [github-api-guide.md](references/github-api-guide.md) を参照。

## Key Concepts

**未対応コメント:** 返信がない、または返信に「修正」「対応」等の完了表現がないレビューコメント（コード行に付属）

**Review Comments vs Issue Comments:**
- **Review Comments**: コード行に付属したレビューコメント（取得: `/pulls/{number}/comments`）
- **Issue Comments**: PR 説明下の全体コメント（取得: `/issues/{number}/comments` または `gh pr view --json comments`）
- **resolve-pr で対象:** Review Comments のみ

**妥当性判定:** [decision-logic.md](references/decision-logic.md) を参照

**GitHub API:** [github-api-guide.md](references/github-api-guide.md) でコマンド集を確認（特に「コメント取得方法の区別」セクション）

**詳細ワークフロー:** [workflow.md](references/workflow.md) で段階ごとの実装手順を確認

## Prerequisites

- GitHub MCP サーバー (`github-mcp-server`) が apm.yml 経由で設定済み（OAuth 認可ずみ）
- `gh` CLI もインストール・ログイン済み（MCP 不可時のフォールバック用 / `gh pr checkout` 等の git 操作用）
- 対象リポジトリへのアクセス権
- ローカルで PR ブランチをチェックアウト可能

## Outcome

修正済みコメント数、スキップ理由、コミットハッシュを含む結果一覧を報告

## If You're Unsure

| 状況 | 対応 |
| --- | --- |
| PR番号が不明 | ユーザーに質問 |
| Reviewer roster の対象が曖昧 | 1️⃣ のチェックリストを提示し、対応スコープをユーザーに確認 |
| 指摘内容が曖昧 | 妥当性判定を保留、ユーザーに相談 |
| 修正内容が決定不可 | 具体的な案をユーザーに要求 |
| コードの影響範囲が不明 | テスト実行・他ファイル確認してから修正 |

## Anti-Patterns（絶対回避）

- **Reviewer roster のスキップ** — 1️⃣ をスキップしてコード変更に着手しない。承認なしに先に進むと、bot レビュー（Copilot / Claude / github-actions）の見落としや対応漏れが発生する。
- **片方のソースだけで roster を組む** — `gh pr view --comments` だけ、または `gh api .../reviews` だけでは reviewer が抜ける。両方を集計してから提示する（MCP では `pull_request_read` の 3 method + `issue_read(get_comments)` を併用）。
- **コメント本文で `#N` を指摘番号として書く** — GitHub のオートリンクで別 PR / Issue 参照に展開され、混乱を招く。複数指摘の番号付けには `[N]`（角括弧）形式を使う。`#N` は実際の他 PR / Issue を参照したいときだけ使う。コミット SHA は 7 桁短縮で OK（自動的に commit リンクになる）。

