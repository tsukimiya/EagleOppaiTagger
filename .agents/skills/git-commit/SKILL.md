---
name: git-commit
description: "Stage meaningful diffs and create Conventional Commits with WHY-focused messages. USE FOR: committing code changes, creating commits, git commit workflow, staging files, writing commit messages, conventional commits, preparing commits for PR. TRIGGERS: commit code, create a commit, stage changes, write commit message, need to commit, ready to commit, make a commit."
---

# git-commit

## Overview

コード変更を意味のある単位でステージングし、Conventional Commits 規約に従った「WHY」を重視したコミットメッセージを作成する。

**コア原則:**
1. **意味のあるまとまりで分割** - 無関係な変更は別コミットに
2. **WHY を説明** - 「何を」ではなく「なぜ」その変更が必要か
3. **Conventional Commits** - `type(scope): subject` 形式を厳守
4. **検証してからコミット** - 構文エラーやテスト失敗がないことを確認

## Workflow

### 1️⃣ 変更内容の確認

```bash
git status
git diff
```

変更ファイルを確認し、論理的なまとまりに分類する。

### 2️⃣ ステージング戦略の決定

**単一の目的:** 1つの機能追加・バグ修正・リファクタリングなら一括ステージング
```bash
git add .
```

**複数の目的が混在:** 関連するファイルごとにステージング
```bash
git add path/to/related/file1.php path/to/related/file2.php
```

**ファイル内の一部のみ:** インタラクティブモードで選択
```bash
git add -p path/to/file.php
```

詳細な戦略は [troubleshooting.md](references/troubleshooting.md) を参照。

### 3️⃣ コミット前の検証

```bash
# テスト実行
<テスト実行コマンド>

# 型チェック / 静的解析
<型チェック・静的解析コマンド>
```

エージェントの場合は LSP / `get_errors` 等のツールを使用。

### 4️⃣ コミットメッセージの作成

**Conventional Commits フォーマット:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**主な Type:**
- `feat` - 新機能
- `fix` - バグ修正
- `refactor` - リファクタリング
- `docs` - ドキュメント
- `test` - テスト
- `chore` - ビルド・依存関係

**Subject のポイント:**
- 命令形で記述（"add" not "added"）
- 50文字以内
- **WHY を暗示する表現**

**Body（推奨）:**
- 変更の「理由」と「背景」を説明
- What（何を）は不要、Why（なぜ）に焦点
- 72文字で改行

詳細な仕様は [conventional-commits.md](references/conventional-commits.md) を参照。

### 5️⃣ コミット実行

```bash
git commit -m "feat(admin): HTTPSリダイレクト機能を追加

管理画面へのHTTPアクセスを自動的にHTTPSにリダイレクトすることで、
セキュリティを強化し、証明書エラーを防ぐ。

Closes #122"
```

## Quick Examples

### ✅ Good

```
feat(auth): JWT検証にキャッシュを導入

頻繁に呼ばれる公開鍵取得APIのレスポンス時間を改善。
```

```
fix(billing): 小数点演算の誤差を解消するため固定小数点演算を使用

浮動小数点演算による金額の計算誤差を回避。
```

### ❌ Bad

```
fix: バグ修正
```
→ 何のバグか、なぜかが不明

```
feat(search): SearchController を変更して全文検索処理を追加
```
→ WHAT の羅列で WHY がない

より多くの例は [examples.md](references/examples.md) を参照。

## Quick Reference

### Type 選択フローチャート

1. 新機能追加? → `feat`
2. バグ修正? → `fix`
3. 機能変更なくコード改善? → `refactor`
4. ドキュメントのみ? → `docs`
5. テストのみ? → `test`
6. パフォーマンス改善? → `perf`
7. その他? → `chore`

### Scope（プロジェクト固有）

- `auth` - 認証
- `admin` - 管理画面
- `api` - API
- `db` - データベース
- `infra` - インフラ
- `skills` - Agent Skills

### Breaking Change の判断

以下の場合は `BREAKING CHANGE:` を明記:
- API URL/形式の変更
- 必須パラメータの追加
- データ構造の非互換な変更

## Troubleshooting

よくある問題と解決策:

| 問題 | 解決策 |
| --- | --- |
| 無関係な変更が混在 | `git add -p` で選択的にステージング |
| メッセージが WHAT の羅列 | WHY に焦点を当てる |
| Type/Scope が不明 | フローチャートを参照 |
| 判断に迷う | ユーザーに確認 |

詳細は [troubleshooting.md](references/troubleshooting.md) を参照。

## Reference Documentation

- **[conventional-commits.md](references/conventional-commits.md)** - Type/Scope/Subject/Body/Footer の完全仕様
- **[examples.md](references/examples.md)** - Good/Bad の詳細な例、プロジェクト固有の例
- **[troubleshooting.md](references/troubleshooting.md)** - よくある問題、判断基準、チェックリスト