---
name: create-pr
description: "Stage, commit, push, and create GitHub Pull Requests with proper templates and labels. USE FOR: creating PR, making pull request, PR workflow, commit and push, prepare for review, draft PR, submitting changes for review. TRIGGERS: create a PR, make a pull request, open a PR, submit for review, create pull request, push and PR."
---

# create-pr

## Overview

コード変更をコミット・プッシュし、適切なテンプレートとラベルを使用して GitHub Pull Request を作成する。

**コア原則:**
1. **コミット前の確認** - 変更内容を把握してから進める
2. **WHY を説明** - PR 説明文で変更の理由を明確に
3. **適切なラベル** - 変更の種類と優先度を示す
4. **Issue との連携** - `close #123` で自動クローズ

## Workflow

### 1️⃣ 変更状況の確認

```bash
git status
git diff
```

未コミットの変更がある場合は、次のステップへ。

### 2️⃣ コミット

git-commit スキルに従ってコミット:

```bash
# ステージング
git add <files>

# コミット（Conventional Commits形式）
git commit -m "feat(search): 全文検索機能を追加"
```

詳細は git-commit スキルを参照。

### 3️⃣ プッシュ

```bash
# 初回プッシュ
git push -u origin <branch-name>

# 2回目以降
git push
```

### 4️⃣ PR 作成

```bash
# ドラフトPRを作成（ベースはプロジェクトのデフォルトブランチを指定）
gh pr create --draft --base <base-branch>
```

**PR タイトル:** Conventional Commits 形式（`feat(search): 全文検索機能を追加`）

**PR 説明文の構成:**
```markdown
## 概要

変更の目的と理由を説明。

close #123

## 変更内容

- 追加したファイル・機能
- 変更した箇所
- 削除した内容

## 動作確認

- [x] ローカルで動作確認
- [x] テストが通ることを確認

## 確認事項

- [ ] コードレビューを受けた
- [ ] ドキュメントを更新した

## マージ条件

承認後、即時でOK

## レビューについて

1人以上のレビュー希望
```

詳細は [pr-template-guide.md](references/pr-template-guide.md) を参照。

### 5️⃣ ラベル設定

```bash
# PR 作成後にラベルを追加
gh pr edit <pr-number> --add-label "enhancement,security"
```

**ラベル選択:**
- 変更の種類: `enhancement`, `bug`, `refactoring`
- 追加属性: `security`, `performance`, `breaking-change`
- 優先度: `priority:high`, `priority:medium`, `priority:low`

詳細は [label-guide.md](references/label-guide.md) を参照。

## Quick Examples

### 機能追加の PR

```bash
# コミット
git add .
git commit -m "feat(search): 全文検索機能を追加"

# プッシュ
git push -u origin feature/search

# PR作成
gh pr create --draft --base <base-branch> --title "feat(search): 全文検索機能を追加"

# ラベル設定
gh pr edit --add-label "enhancement"
```

### バグ修正の PR

```bash
git commit -m "fix(cache): キャッシュ無効化のタイミング不整合を修正"
git push
gh pr create --draft --base <base-branch> --title "fix(cache): キャッシュ無効化のタイミング不整合を修正"
gh pr edit --add-label "bug,priority:high"
```

### リファクタリングの PR

```bash
git commit -m "refactor(api): クエリ構築ロジックを共通関数に抽出"
git push
gh pr create --draft --base <base-branch> --title "refactor(api): クエリ構築ロジックを共通関数に抽出"
gh pr edit --add-label "refactoring"
```

## Quick Reference

### PR 説明文の必須要素

- **概要:** WHY（なぜこの変更が必要か）
- **Issue 参照:** `close #123` でクローズ
- **動作確認:** 実施した確認内容
- **Breaking Change:** ある場合は明記

### ラベル選択フローチャート

1. 新機能追加? → `enhancement`
2. バグ修正? → `bug`
3. コード改善のみ? → `refactoring`
4. セキュリティ関連? → `security` 追加
5. Breaking Change? → `breaking-change` 追加

### GitHub CLI 基本コマンド

```bash
# ドラフトPR作成
gh pr create --draft --base <base-branch>

# ラベル追加
gh pr edit <number> --add-label "enhancement"

# ドラフト解除
gh pr ready <number>

# PR確認
gh pr view <number>
```

## Troubleshooting

| 問題 | 解決策 |
| --- | --- |
| 未コミットの変更がある | git-commit スキルでコミット |
| リモートブランチがない | `git push -u origin <branch>` |
| PR タイトルが不適切 | Conventional Commits 形式に修正 |
| Issue が自動クローズされない | `close #123` を使用 |
| ラベルが分からない | label-guide.md を参照 |

詳細は [troubleshooting.md](references/troubleshooting.md) を参照。

## Project Notes（プロジェクト固有・要設定）

プロジェクト固有の事項は導入時にここへ記載する。例:

- **ベースブランチ**: プロジェクトのデフォルトブランチ（`main` / `develop` 等）。`--base <base-branch>` で明示する。
- **コード生成・スキーマ変更**: 自動生成コード（API クライアント、モデル等）を伴う変更では、生成コマンドの実行と影響範囲を PR 説明文に記載する。
- **インフラ変更（IaC）**: `terraform plan` 等の結果を PR 説明文に添付する。
- **クライアント影響**: API 変更時に依存クライアントへの影響を PR 説明文に明記する。

## Reference Documentation

- **[pr-template-guide.md](references/pr-template-guide.md)** - PR 説明文の詳細ガイド、セクション別の書き方
- **[label-guide.md](references/label-guide.md)** - ラベルの選択基準、組み合わせ例
- **[troubleshooting.md](references/troubleshooting.md)** - よくある問題、解決策、チェックリスト