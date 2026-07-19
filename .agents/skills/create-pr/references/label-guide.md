# PR ラベル設定ガイド

Pull Request に適切なラベルを付与するためのガイドです。

## ラベルの目的

1. **変更の種類を可視化** - 機能追加、バグ修正、リファクタリングなど
2. **優先度の管理** - 緊急度や重要度の明確化
3. **検索とフィルタリング** - 過去のPRを見つけやすくする
4. **自動化との連携** - CI/CDやリリースノート生成

---

## 基本ラベル

### 変更の種類

| ラベル | 説明 | 使用例 |
|--------|------|--------|
| `enhancement` | 新機能の追加 | 新しいAPI、UI要素、機能 |
| `bug` | バグ修正 | 不具合の解消、エラー修正 |
| `refactoring` | リファクタリング | コード構造の改善、最適化 |
| `documentation` | ドキュメント | README、API仕様書、コメント |
| `test` | テスト | ユニットテスト、統合テスト |
| `chore` | 雑務 | 依存関係更新、設定変更 |
| `performance` | パフォーマンス改善 | 速度最適化、メモリ削減 |
| `security` | セキュリティ | 脆弱性修正、セキュリティ強化 |

### 優先度

| ラベル | 説明 | 使用例 |
|--------|------|--------|
| `priority:high` | 高優先度 | 本番障害、重大なバグ |
| `priority:medium` | 中優先度 | 通常の機能追加・改善 |
| `priority:low` | 低優先度 | 小さな改善、将来的な対応 |

### ステータス

| ラベル | 説明 | 使用例 |
|--------|------|--------|
| `wip` | 作業中（Work In Progress） | ドラフトPR、レビュー前 |
| `ready-for-review` | レビュー準備完了 | レビュー依頼時 |
| `blocked` | ブロックされている | 依存関係待ち、決定待ち |
| `breaking-change` | 破壊的変更 | API変更、非互換な変更 |

---

## ラベル選択のフローチャート

### 1. 変更の種類を判断

```
新機能追加?
├─ Yes → enhancement
└─ No
   ├─ バグ修正? → bug
   └─ No
      ├─ コード改善のみ? → refactoring
      └─ No
         ├─ ドキュメントのみ? → documentation
         └─ その他 → chore
```

### 2. 追加ラベルを判断

```
セキュリティに関連?
├─ Yes → security を追加

パフォーマンス改善?
├─ Yes → performance を追加

Breaking Change?
├─ Yes → breaking-change を追加
```

---

## 実例

### 例1: 新機能追加

**変更内容:** 管理画面のHTTPSリダイレクト機能

**ラベル:**
- `enhancement`（新機能）
- `security`（セキュリティ強化）

**理由:**
- 新しい機能を追加している
- セキュリティを向上させる変更

---

### 例2: バグ修正

**変更内容:** 金額計算の丸め誤差を修正

**ラベル:**
- `bug`（バグ修正）
- `priority:high`（計算結果の正確性に関わる）

**理由:**
- 既存機能の不具合を修正
- 計算結果に影響するため高優先度

---

### 例3: リファクタリング

**変更内容:** Repository層へのクエリロジック移動

**ラベル:**
- `refactoring`（リファクタリング）

**理由:**
- 機能変更なし、コード構造の改善のみ

---

### 例4: パフォーマンス改善

**変更内容:** JWT検証にキャッシュを導入

**ラベル:**
- `enhancement`（機能追加としてのキャッシュ）
- `performance`（レスポンス時間改善）

**理由:**
- キャッシュ機能の追加
- パフォーマンスが主な目的

---

### 例5: Breaking Change

**変更内容:** ユーザーAPI のレスポンス形式を変更

**ラベル:**
- `enhancement`（API改善）
- `breaking-change`（非互換な変更）
- `priority:high`（クライアント対応が必要）

**理由:**
- 後方互換性を破壊する変更
- クライアント側の更新が必須

---

## Issue からのラベル引き継ぎ

PR が Issue をクローズする場合、Issue のラベルを引き継ぐことを検討します。

### GitHub CLI での確認

```bash
# Issue のラベルを確認
gh issue view 123 --json labels

# 出力例:
# {
#   "labels": [
#     {"name": "enhancement"},
#     {"name": "priority:high"}
#   ]
# }
```

### 引き継ぎの判断

**引き継ぐべきラベル:**
- 変更の種類（`enhancement`, `bug`, `refactoring`）
- 優先度（`priority:*`）
- 影響範囲（`breaking-change`）

**引き継がないラベル:**
- Issue 固有のステータス（`needs-discussion`, `needs-investigation`）
- PR では無関係なラベル

---

## 複数ラベルの組み合わせ例

### 組み合わせ1: セキュリティ関連の機能追加

```bash
gh pr create --label "enhancement,security,priority:high"
```

### 組み合わせ2: 緊急のバグ修正

```bash
gh pr create --label "bug,priority:high"
```

### 組み合わせ3: パフォーマンス改善のリファクタリング

```bash
gh pr create --label "refactoring,performance"
```

### 組み合わせ4: Breaking Change を含む機能追加

```bash
gh pr create --label "enhancement,breaking-change,priority:high"
```

---

## GitHub CLI コマンド

### PR 作成時にラベルを指定

```bash
gh pr create --label "enhancement,security"
```

### 既存の PR にラベルを追加

```bash
gh pr edit 123 --add-label "priority:high"
```

### ラベルを削除

```bash
gh pr edit 123 --remove-label "wip"
```

### 複数ラベルを一度に設定（上書き）

```bash
gh pr edit 123 --label "enhancement,security,ready-for-review"
```

---

## プロジェクト固有のラベル

プロジェクトごとに定義するラベルの例（導入時に実際の構成へ合わせて調整する）：

### モジュール別（例）

| ラベル | 説明 |
|--------|------|
| `area:backend` | バックエンド |
| `area:frontend` | フロントエンド |
| `area:infrastructure` | インフラ（IaC） |
| `area:database` | マイグレーション、スキーマ |
| `area:api` | API エンドポイント |

### 機能別（例・プロジェクトに合わせて定義）

| ラベル | 説明 |
|--------|------|
| `feature:auth` | 認証・認可 |
| `feature:<name>` | 各機能ドメインごとに定義 |

---

## ラベル選択のチェックリスト

PR 作成時に以下を確認:

- [ ] 変更の種類を示すラベル（`enhancement`, `bug`, `refactoring` など）
- [ ] セキュリティに関連する場合は `security`
- [ ] パフォーマンス改善の場合は `performance`
- [ ] Breaking Change の場合は `breaking-change`
- [ ] 優先度が高い場合は `priority:high`
- [ ] 関連する Issue のラベルを引き継ぐ
- [ ] プロジェクト固有のラベル（`area:*`, `feature:*`）

---

## Tips

### 迷った時の判断基準

1. **メインの変更** に基づいてラベルを選択
2. **複数の側面** がある場合は複数ラベルを使用
3. **Issue のラベル** を参考にする
4. **チーム内の慣例** に従う

### 良いラベル付けの例

```
Enhancement + Security:
新しいセキュリティ機能を追加

Bug + Priority:High:
本番で発生した重大なバグの修正

Refactoring + Performance:
パフォーマンス向上を目的としたリファクタリング
```

### 避けるべきパターン

```
ラベルなし:
何の変更か分からない

Bug + Enhancement:
矛盾するラベルの組み合わせ

多すぎるラベル:
10個以上のラベルで本質が不明
```
