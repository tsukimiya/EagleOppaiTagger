---
description: 新しい開発サイクルを開始するための手順を実行するプロンプト
---

以下の手順で新しい開発サイクルを開始してください：

1. `.spec/` 配下の4ファイルが存在する場合、本日の日付（ローカル時刻）でアーカイブする：
  - `PLAN.md`      → `PLAN-YYYY-MM-DD.md`      にリネーム
  - `SPEC.md`      → `SPEC-YYYY-MM-DD.md`      にリネーム
  - `TODO.md`      → `TODO-YYYY-MM-DD.md`      にリネーム
  - `KNOWLEDGE.md` → `KNOWLEDGE-YYYY-MM-DD.md` にリネーム

2. 新しいファイルを以下の通り作成する：
  - `PLAN.md`：空テンプレートで新規作成
  - `SPEC.md`：空テンプレートで新規作成
  - `TODO.md`：空テンプレートで新規作成
  - `KNOWLEDGE.md`：アーカイブした内容をそのままコピーして新規作成（知見を引き継ぐ）

3. 完了後、以下を報告する：
  - アーカイブしたファイル一覧
  - 「新しいPLAN.mdにやりたいことを自由に書いてください」


## 仕様駆動開発ファイルの作成（.spec/）

### .spec/PLAN.md
\```bash
cat << 'EOF' > .spec/PLAN.md
# PLAN - やりたいこと

<!-- ここに思ったことを自由に書いてください。箇条書きでも口語でもOK -->
<!-- Claude がこの内容を読んでヒアリングし、SPEC.md を作成します -->
EOF
\```

### .spec/SPEC.md
\```bash
cat << 'EOF' > .spec/SPEC.md
# SPEC - 技術仕様・要件定義

## 機能要件
## 非機能要件
## 技術構成
EOF
\```

### .spec/TODO.md
\```bash
cat << 'EOF' > .spec/TODO.md
# TODO - タスクリスト

## 優先度：高
## 優先度：中
## 優先度：低
## 完了済み
- [x] 初期セットアップ
EOF
\```

### .spec/KNOWLEDGE.md
\```bash
cat << 'EOF' > .spec/KNOWLEDGE.md
# KNOWLEDGE - ドメイン知識・調査結果

## 業務・ドメイン知識
## 調査・リサーチ結果
## 技術的な知見
## 決定事項と理由
EOF
\```