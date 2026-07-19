# GitHub API Guide - resolve-pr

`gh` CLI を使った GitHub API の実装ガイド。

## 基本コマンド構造

```bash
gh api <endpoint> [options] [--jq <filter>]
```

- `endpoint`: GitHub API v3 パス（例: `repos/{owner}/{repo}/pulls`）
- `--jq`: JSON フィルタリング（JQ 構文）
- HTTP メソッド: `GET` (デフォルト), `-X POST`, `-X PATCH` など

---

## コマンド集

### 1. PR情報取得

```bash
# PR 詳細情報
gh api repos/{owner}/{repo}/pulls/<PR番号>

# PR タイトル + ステータス確認
gh api repos/{owner}/{repo}/pulls/<PR番号> --jq '{title, state, draft}'
```

---

## ⚠️ コメント取得方法の区別

**重要:** PR には 2 種類のコメントが存在し、エンドポイントが異なります：

| コメント種別 | 場所 | エンドポイント | `gh pr view --json` | 用途 |
|-------------|------|-------------|------------------|------|
| **Review Comments** | コード行に付属 | `/pulls/{number}/comments` | ❌ 取得不可 | コード指摘への対応確認（resolve-pr で必要） |
| **Issue Comments** | PR 説明下 | `/issues/{number}/comments` | ✅ `comments` で取得 | 全体的な議論・質問 |
| **Reviews** | Review 集約 | `/pulls/{number}/reviews` | ✅ `reviews` で取得 | Approve/Request Changes 等 |

### 取得時の注意点

```bash
# ❌ これでは Review Comments（コード行のコメント）が取得できない
gh pr view 122 --json reviews,comments

# ✅ Review Comments を取得するには別エンドポイント必須
gh api repos/{owner}/{repo}/pulls/122/comments
```

---

### 2. Review Comments 取得（コード行のコメント）

```bash
gh api repos/{owner}/{repo}/pulls/<PR番号>/comments \
  --jq '[.[] | select(.in_reply_to_id == null) | {id, path, line, body, user: .user.login, created_at}]'
```

**出力:**
```json
[
  {
    "id": 1234567,
    "path": "app/Services/MyService.php",
    "line": 45,
    "body": "このメソッドは冗長です。",
    "user": "reviewer-name",
    "created_at": "2026-02-18T10:00:00Z"
  }
]
```

**フィルタ説明:**
- `.in_reply_to_id == null`: トップレベル（返信ではない）コメントのみ
- `{id, path, line, body, user, created_at}`: 必要な情報を抽出

---

### 3. コメントへの返信取得

```bash
# コメントID 1234567 への返信を全て取得
gh api repos/{owner}/{repo}/pulls/<PR番号>/comments \
  --jq '[.[] | select(.in_reply_to_id == 1234567) | {id, body, user: .user.login, created_at}]'
```

**出力:**
```json
[
  {
    "id": 1234568,
    "body": "修正しました。冗長な処理を削除しました。",
    "user": "author-name",
    "created_at": "2026-02-18T11:30:00Z"
  }
]
```

**返信がない場合:** 空配列 `[]`

---

## よく使う JQ フィルタ

### トップレベルコメント抽出
```bash
select(.in_reply_to_id == null)
```

### 特定コメントへの返信
```bash
select(.in_reply_to_id == <コメントID>)
```

### 特定フィールド抽出
```bash
{id, path, line, body, user: .user.login}
```

### 配列から最新1件
```bash
sort_by(.created_at) | last
```

### キーワード検索
```bash
select(.body | contains("修正"))
```

---

## トラブルシューティング

| エラー | 原因 | 対応 |
| --- | --- | --- |
| コメントが取得されない | 間違ったエンドポイント使用 | Review Comments は `/pulls/{number}/comments` 必須（`gh pr view --json` では取得不可） |
| `Not Found` (404) | リポジトリ・PR が存在しない | PR番号・リポジトリ名確認 |
| `Unauthorized` (401) | 認証失敗 | `gh auth login` 再実行 |
| `Forbidden` (403) | アクセス権限なし | リポジトリへのアクセス権確認 |
| `Invalid JQ filter` | フィルタ構文エラー | JQ 構文確認（括弧・引用符等） |

---

## 実装例

### Review Comments 取得・返信フロー（resolve-pr の典型パターン）

```bash
# 1. PR 122 の Review Comments（コード行のコメント）をすべて取得
gh api repos/owner/repo/pulls/122/comments \
  --jq '[.[] | {id, path, body, state: .in_reply_to_id}]'

# 2. トップレベルコメント（返信ではない）のみ抽出
gh api repos/owner/repo/pulls/122/comments \
  --jq '[.[] | select(.in_reply_to_id == null) | {id, path, body}]'

# 3. 特定コメント（ID: 2820890195）へ返信を投稿
gh api repos/owner/repo/pulls/122/comments/2820890195/replies \
  -X POST \
  -f body="✅ 対応完了しました。コミット abc1234 で変更が反映されています。"
```

**説明:**
- `/pulls/{number}/comments` – コード行に付いた Review Comment を取得
- `select(.in_reply_to_id == null)` – トップレベル（返信ではない）コメントのみ
- `/comments/{comment_id}/replies` – 特定コメントへの返信投稿

---

### Issue Comments 取得例（PR 説明下のコメント）

```bash
# Issue-level comments を取得
gh api repos/owner/repo/issues/122/comments \
  --jq '[.[] | {id, body, user: .user.login}]'

# または gh pr view でも取得可能（Review Comments は取得不可）
gh pr view 122 --json comments --jq '.comments[].body'
```

---

## 実装例（従来版）

### レビューコメント取得 & 返信確認の一括実行

```bash
# 1. トップレベルコメント取得
COMMENTS=$(gh api repos/{owner}/{repo}/pulls/42/comments \
  --jq '[.[] | select(.in_reply_to_id == null) | {id, path, line, body}]')

# 2. 各コメントについて返信を確認
echo "$COMMENTS" | jq '.[] | .id' | while read COMMENT_ID; do
  echo "=== Comment $COMMENT_ID ==="
  gh api repos/{owner}/{repo}/pulls/42/comments \
    --jq "[.[] | select(.in_reply_to_id == $COMMENT_ID)]"
done
```

---

## 参考

- [GitHub API v3 - Pull Request Comments](https://docs.github.com/en/rest/reference/pulls#comments)
- [gh cli documentation](https://cli.github.com/manual/)
- [jq manual](https://stedolan.github.io/jq/manual/)

