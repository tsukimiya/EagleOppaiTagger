# トラブルシューティング

PR 作成時によく遭遇する問題とその解決策をまとめています。

## Common Issues（よくある問題）

### 1. 未コミットの変更がある

**問題:**

```bash
git status
# Changes not staged for commit:
#   modified:   app/Services/AuthService.php
```

PR を作成しようとしたが、コミットされていない変更がある。

**解決策:**

git-commit スキルに従ってコミット:

```bash
# 変更を確認
git diff

# ステージング
git add app/Services/AuthService.php

# コミット
git commit -m "feat(auth): JWT検証にキャッシュを導入"
```

---

### 2. リモートブランチが存在しない

**問題:**

```bash
git push
# fatal: The current branch feature/xxx has no upstream branch.
```

初めてプッシュする際に、リモートブランチが設定されていない。

**解決策:**

```bash
# -u オプションでリモートブランチを設定
git push -u origin feature/xxx
```

次回以降は `git push` だけで OK。

---

### 3. PR 作成時にベースブランチを間違える

**問題:**

デフォルトで `main` や `master` にマージしようとしてしまう。

**解決策:**

`--base` オプションで明示的に指定:

```bash
gh pr create --base <base-branch> --draft
```

プロジェクトのデフォルトブランチ（`main` / `develop` 等）を指定する。

---

### 4. PR タイトルが Conventional Commits に従っていない

**問題:**

```bash
gh pr create --title "管理画面を修正"
```

タイトルに type や scope がない。

**解決策:**

Conventional Commits 形式でタイトルを指定:

```bash
gh pr create --title "feat(search): 全文検索機能を追加" --draft
```

**形式:** `<type>(<scope>): <subject>`

---

### 5. 関連 Issue を正しく参照できない

**問題:**

PR 説明文に Issue 番号を書いたが、自動的にクローズされない。

**解決策:**

正しいキーワードを使用:

```markdown
## 概要

管理画面のHTTPS化を実装します。

close #122
```

**有効なキーワード:**
- `close #123`, `closes #123`, `closed #123`
- `fix #123`, `fixes #123`, `fixed #123`
- `resolve #123`, `resolves #123`, `resolved #123`

**無効な例:**
```markdown
issue #123  ❌
関連: #123  ❌
ref #123    ❌（クローズされない、参照のみ）
```

---

### 6. ラベルが正しく設定されない

**問題:**

```bash
gh pr create --label "enhancement,bug"
# エラーまたは意図しないラベルが付与される
```

矛盾するラベルを指定している。

**解決策:**

メインの変更に基づいて適切なラベルを選択:

```bash
# 機能追加の場合
gh pr create --label "enhancement"

# バグ修正の場合
gh pr create --label "bug"

# セキュリティ関連の機能追加
gh pr create --label "enhancement,security"
```

詳細は [label-guide.md](label-guide.md) を参照。

---

### 7. テストが失敗している

**問題:**

PR を作成した後、CI でテストが失敗する。

**解決策:**

PR 作成前にローカルでテストを実行:

```bash
# 全テスト実行
<テスト実行コマンド>

# 特定のテストのみ
<テスト実行コマンド> --filter=<TestName>

# 型チェック / 静的解析
<型チェック・静的解析コマンド>
```

エージェントの場合は LSP / `get_errors` 等のツールを使用。

---

### 8. PR 説明文が不十分

**問題:**

```markdown
## 概要

コードを修正しました。
```

何を、なぜ修正したかが不明。

**解決策:**

WHY を重視した説明を記述:

```markdown
## 概要

管理画面へのHTTPアクセスを自動的にHTTPSにリダイレクトする機能を追加します。

本番環境のロードバランサーはHTTPSのみを受け付けるため、HTTP接続時の
ユーザー体験を改善し、セキュリティを強化します。

close #122

## 変更内容

- HTTPS強制ミドルウェアを追加
- アプリ初期化処理でミドルウェアをグローバル登録
- HTTPSリダイレクトのテストを追加

## 動作確認

- [x] HTTP接続時に301リダイレクトが返される
- [x] HTTPS接続時は正常にページが表示される
- [x] 既存機能に影響がない
```

詳細は [pr-template-guide.md](pr-template-guide.md) を参照。

---

### 9. ドラフト PR を通常の PR に変換できない

**問題:**

`gh pr create --draft` で作成した後、レビュー準備完了時に通常のPRにしたい。

**解決策:**

```bash
# ドラフト解除
gh pr ready 123

# または GitHub Web UI で "Ready for review" をクリック
```

---

### 10. 複数のコミットを1つにまとめたい

**問題:**

細かいコミットが多すぎて、PR が煩雑になっている。

**解決策（まだpushしていない場合）:**

```bash
# 直近3つのコミットをまとめる
git rebase -i HEAD~3

# エディタで "pick" を "squash" に変更
# pick abc123 feat(search): 基本実装
# squash def456 feat(search): バグ修正
# squash ghi789 feat(search): テスト追加

# コミットメッセージを編集
# 保存して終了
```

⚠️ **注意:** 既にpushしたコミットには使用しないこと。

**解決策（既にpushした場合）:**

そのままにするか、force push（チーム内で合意がある場合のみ）:

```bash
git rebase -i HEAD~3
git push --force-with-lease
```

---

## GitHub CLI のトラブルシューティング

### `gh` コマンドが見つからない

**問題:**

```bash
gh pr create
# bash: gh: command not found
```

**解決策:**

GitHub CLI をインストール:

```bash
# Ubuntu/Debian
sudo apt install gh

# macOS
brew install gh

# 認証
gh auth login
```

---

### 認証エラー

**問題:**

```bash
gh pr create
# error: HTTP 401: Bad credentials
```

**解決策:**

再認証:

```bash
gh auth login

# または既存のトークンを使用
gh auth login --with-token < token.txt
```

---

### リポジトリが認識されない

**問題:**

```bash
gh pr create
# error: could not determine repository
```

**解決策:**

正しいディレクトリにいることを確認:

```bash
# リポジトリのルートディレクトリに移動
cd /path/to/your-repo

# リモートを確認
git remote -v

# origin が設定されているか確認
# origin  git@github.com:<owner>/<repo>.git (fetch)
# origin  git@github.com:<owner>/<repo>.git (push)
```

---

## Workflow の一般的な問題

### PR 作成の手順を忘れた

**問題:**

どの順番で実行すればよいか分からない。

**解決策:**

標準ワークフローに従う:

1. `git status` で変更確認
2. 未コミットがあれば git-commit スキルでコミット
3. `git push -u origin <branch>` でプッシュ
4. `gh pr create --draft --base <base-branch>` でドラフトPR作成
5. ラベルを設定
6. レビュー準備完了後 `gh pr ready`

---

### どのラベルを付ければよいか分からない

**問題:**

変更内容に対して適切なラベルが判断できない。

**解決策:**

ラベル選択フローチャート:

1. 新機能追加? → `enhancement`
2. バグ修正? → `bug`
3. コード改善のみ? → `refactoring`
4. セキュリティ関連? → `security` を追加
5. パフォーマンス改善? → `performance` を追加
6. Breaking Change? → `breaking-change` を追加

詳細は [label-guide.md](label-guide.md) を参照。

---

### Issue のラベルを引き継ぐべきか分からない

**問題:**

Issue に複数のラベルがあり、どれをPRに引き継ぐべきか不明。

**解決策:**

**引き継ぐべきラベル:**
- 変更の種類（`enhancement`, `bug`, `refactoring`）
- 優先度（`priority:*`）
- 影響範囲（`breaking-change`）

**引き継がないラベル:**
- Issue 固有のステータス（`needs-discussion`, `needs-investigation`）

```bash
# Issue のラベルを確認
gh issue view 123 --json labels

# 適切なラベルをPRに設定
gh pr create --label "enhancement,priority:high"
```

---

## チェックリスト

PR 作成前に確認:

- [ ] 全ての変更がコミットされている（`git status` で確認）
- [ ] コミットメッセージが Conventional Commits に従っている
- [ ] テストが通る
- [ ] 構文エラーがない（`get_errors` または composer check-syntax）
- [ ] リモートブランチにプッシュ済み
- [ ] PR タイトルが Conventional Commits 形式
- [ ] PR 説明文に WHY が含まれている
- [ ] 関連 Issue を正しく参照（`close #123`）
- [ ] 適切なラベルを設定
- [ ] ベースブランチがプロジェクトのデフォルト（`main` / `develop` 等）

--ー