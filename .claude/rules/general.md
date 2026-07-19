---
paths:
  - "**"
---

# AGENTS.md - プロジェクトガイドライン（テンプレート）

> このファイルはプロジェクト共通のガイドラインのテンプレートです。`{project_name}` や空欄のセクションを各プロジェクトの内容で埋めて使用してください。

## プロジェクトの原則

- **言語**: 本プロジェクトのプラン・コメント・説明は全て**日本語**で行う
- **フレームワーク**: Agent Skills フレームワークを積極的に活用
- **仕様駆動開発**: `.spec/` ディレクトリの PLAN → SPEC → TODO → 実装フローを遵守

## Worktree Isolation (STRICT)
- NEVER work directly on the main checkout. Always create/enter a worktree via the EnterWorktree hook or `wt` CLI before making changes for a phase/PR.
- If the EnterWorktree hook fails, fall back to `wt` CLI directly — do not proceed on main.
- Before starting any code change task, run: `pwd && git worktree list && git branch --show-current` and confirm we are NOT on the main checkout or main branch. If we are, stop and create/enter a worktree first via `wt` CLI.

## タイムスタンプの取得方法 (How to get timestamps)
タイムスタンプは必ず date コマンドで取得せよ。自分で推測するな。
```
# Powershell
Get-Date -UFormat "%Y-%m-%dT%H:%M:%S"

# Bash/zsh
date -u +"%Y-%m-%dT%H:%M:%S"
```

## プロジェクト概要

**{project_name}** {project_name}は、{target}を対象とした{main_functionality}を提供するアプリケーションです。
- **対象**: 
- **主機能**:

## 環境・技術スタック

### フロントエンド
- **言語**: 
- **ランタイム**: 
- **ビルドツール**: 
- **UI フレームワーク**: 
- **コンポーネントライブラリ**: 
- **スタイリング**: 

### 開発ツール
- **型チェック**: 
- **リンター**: 
- **フォーマッター**: 
- **CSS プリプロセッサ**: 

### ユーティリティ
- **className 管理**: 
- **アニメーション**: 

### ディレクトリ構成
```

```

### 開発コマンド


### ブラウザ操作
- ブラウザ検証に `browser-use` を使う場合の接続先をここに記載する（例: `--cdp-url http://localhost:<port>`）

### パスエイリアス
- プロジェクトで設定済みのパスエイリアスがあればここに記載する（例: `@/` → `src/`）

## State Management

## コード規約

## 意思決定の記録（ADR）

AI 開発では「選択肢の提示 → トレードオフ → 1つを選ぶ」が常時発生する。
その瞬間こそ ADR の検知点。後から人が思い出すより精度が高いので、
「書くか迷う瞬間」を仕組みで捕まえる。記録は doc-writer skill で
`docs/decisions/` に起票する。

**ADR 候補の検知シグナル**（1つでも該当したら候補）:
- 複数の妥当な選択肢から1つを選んだ（=トレードオフがあった）
- 元に戻すコストが高い（DB スキーマ・永続化・認証・API 契約・言語/FW・外部依存の追加や置換）
- 既存の規約やパターンから意図的に逸脱した
- 新しいチーム規約・標準を定めた
- **ユーザーが AI のデフォルト提案を覆して別方針を指示した**（AI 開発特有・最重要）
- 後で「なぜこうなっている?」と問われそうな暗黙の前提を置いた

**2分判定テスト**（迷ったら）:
> 半年後の新メンバーがこの選択に出会い「なぜ?」と問い、かつ別案に戻すのが面倒——
> なら残す。どちらか欠けるなら残さなくてよい。

**残さなくてよいもの**: 自明な実装詳細 / 命名 / 局所的リファクタ / すぐ戻せる小さな選択。

**運用フロー（自動化の実体）**:
1. 作業中にシグナルを検知したら、その場で「これは ADR 候補です」と一言申告する。
   流れを止めないため、即起票はせず最低限 `.spec/KNOWLEDGE.md` に
   `ADR候補: <決定を一文で>` を残す。
2. 起票は doc-writer skill で行い、Context / Decision の根拠は人にヒアリングして埋める。
3. Phase 完了時、DoD で未起票の候補を掃き出す（memory.instructions の DoD 参照）。

## リリース手順

## PR Review Resolution
- Prefer the GitHub MCP server (`github-mcp-server`) over `gh` CLI for structured access. Required calls to capture ALL feedback:
  - `pull_request_read` with `method=get_reviews` — review-level (summaries, approvals, changes-requested).
  - `pull_request_read` with `method=get_review_comments` — inline (file-level) review threads.
  - `pull_request_read` with `method=get_comments` — general PR comments.
  - `issue_read` with `method=get_comments` — issue-level comments where Copilot / github-actions[bot] / Claude bot summaries usually appear.
- Address every Copilot, github-actions[bot], and Claude bot finding across all four sources before declaring done.
- Reviewer mention requests must be posted as a separate PR comment (not in PR body or --reviewer flag) to trigger bot reviews. Use `add_reply_to_pull_request_comment` for thread replies.
- Issue Comment への返信は GitHub 仕様で「新規 Issue Comment 投稿」のみ。reply スレッドは Review Comments 専用。
- Claude bot レビュー（`@claude` mention 経由）は `github-actions[bot]` 名義で Issue Comments に投稿される。Reviews エンドポイントには出ないため、レビュー完了を `pulls/N/reviews length>0` で待つのは NG。
- GitHub コメントで指摘 ID `#N` はオートリンクで化ける → 必ず `[N]` 角括弧形式で書く。

## ブランチ運用

- デフォルトブランチへの直 commit は禁止。Phase 単位、または Phase 内サブタスク単位でブランチを切る。base はプロジェクトのデフォルトブランチ（`main` 等）。
- マージ後の片付け手順:
  1. `gh pr merge --squash --delete-branch`（remote branch は GitHub 上で削除される）
  2. `git fetch --prune` で remote tracking を整理
  3. `git worktree remove <path>`
  4. `git branch -d <branch>`
- worktree 残存中は `gh pr merge --delete-branch` の local checkout 後処理が失敗することがあるため、上記順序で手動完結させる。

## code-simplifier サブエージェント

- **発動閾値**: 「ファイル数 ≧ 5 または LOC ≧ 100 または新規コンポーネント ≧ 2」で原則必須。条件未満かつ純粋ロジックのみの場合に限り省略可。マージ済み diff にも遡って実施可。
- 呼出時はプロジェクト規約（例: Karpathy ガイドライン）を明示する。「コード変更はせずレポートのみ」「重要度（高/中/低）でソート」を指示する。
- 「現状維持推奨」「観察のみ」「投機的」と明記された指摘はスキップ可。低リスクの集約指摘（placeholder JSX 重複等）は即対応する。

## フォルダ用途

| フォルダ | 用途 |
|---------|------|
| `.spec/` | 設計ドキュメント（PLAN / SPEC / TODO / KNOWLEDGE） |
| `.output/` | 成果物（完成した記事MD、コード、資料） |
| `.references/` | 参考資料・素材（PDF、サンプルコード等）|
| `.agents/memory/` | セッション間引き継ぎ用メモリ |
| `.agents/handoff/` | セッション間ハンドオフ |
| `.agents/workflows/` | 反復的なワークフロー定義 |
| `.agents/skills/` | 既存スキル管理 |
