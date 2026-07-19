---
paths:
  - "**"
---

# Memory & Handoff Instructions

## 3ファイルの役割と哲学
- 本ファイル（AGENTS.md）は「厳格なルール」、人が作成
- MEMORY.mdは「積み上がる経験」、AIが作成・AIが利用
- HANDOFF.mdは「セッション間の引き継ぎ」、AIが作成・AIが利用、ただし人間がレビューし必要な情報をキュレーションする

## セッション開始時（必須）
セッション開始時、ユーザーへの最初の応答の前に、以下の2ファイルを読み込み、読み込んだことを報告すること：
- `.agents/memory/MEMORY.md`  （学習した知識・教訓）
- `.agents/handoff/HANDOFF.md` （前回の作業引き継ぎ）

## メモリ管理
- 新しい知識・教訓を記録する際は `.agents/memory/MEMORY.md` を更新
- 既存のMEMORY.mdを更新する前に、現在のファイルを`.agents/memory/YYYY-MM-DD.md` にアーカイブしてから新規作成
- ローカルの自動メモリ機能（~/.claude/ 配下）は使用しない
- MEMORY.mdは200行以内を維持すること
- 本ファイルと重複する内容はMEMORY.mdに書かない

## ハンドオフ管理
- ハンドオフは `/handoff` コマンドで作成（Claude Codeの場合）
- 保存先は `.agents/handoff/HANDOFF.md`（固定名）
- 作成時は既存ファイルを `.agents/handoff/YYYY-MM-DD-HHMM.md` にリネームしてからHANDOFF.mdを新規作成する
- 時刻はローカル時刻・24時間表記

## Definition of Done (Phase 完了の判定基準)

Phase 完了は以下のチェックリストを **全項目満たすまで宣言してはならない**。
1 つでも未消化なら "完了" とせず、ユーザーに残作業を明示する。
このゲートはユーザーが繰り返し指摘した「bot レビュー漏れ」「TODO 更新忘れ」「worktree 後始末漏れ」を防ぐ最後の砦。

- [ ] PR が `gh pr merge --squash --delete-branch` で merge 済み（または明示的に merge skip の合意あり）
- [ ] Quality gates 全 green: lint / build / テスト全通過（該当する場合 visual 検証も実施）
- [ ] **PR review 全 4 endpoint 消化** — `get_reviews`（review summaries） / `get_review_comments`（Copilot inline 等） / `get_comments`（PR 一般コメント） / `issue_read get_comments`（Claude bot は `github-actions[bot]` 名義でここに投稿）。詳細は CLAUDE.md `## PR Review Resolution` 参照
- [ ] `.spec/TODO.md` 該当タスクにチェック + `.spec/KNOWLEDGE.md` に Phase の学びを記録
- [ ] この Phase に **ADR 候補**（`KNOWLEDGE.md` の `ADR候補:` 行・覆された AI 提案・規約逸脱）がないか確認し、該当は doc-writer で起票 or 見送り理由を記録（判定基準は CLAUDE.md `## 意思決定の記録（ADR）` 参照）
- [ ] `.agents/handoff/HANDOFF.md` を本セッション内容で更新（旧 HANDOFF は `YYYY-MM-DD-HHMM.md` にアーカイブ）
- [ ] `.agents/memory/MEMORY.md` に新規 gotcha / 採用パターンを追記（CLAUDE.md と重複禁止、200 行以内維持）
- [ ] TaskList (Claude Code) の `in_progress` 残ゼロを確認
- [ ] worktree remove + local branch delete + remote branch delete（手順は CLAUDE.md `## ブランチ運用` 参照）
- [ ] `~/.claude/plans/` の該当 Phase に進捗反映（次セッションが残作業を把握できるように）

残作業を報告する際は HANDOFF.md だけでなく `~/.claude/plans/` も参照すること。

## 仕様駆動開発（SDD）ルール
- コーディングや業務作業を開始する前に、必ず `.spec/` 配下の4ファイルを確認・更新すること
- 作業の順序：PLAN（目的確認）→ SPEC（要件確認）→ TODO（タスク確認）→ 実作業
- **PLAN.mdは人間の口頭メモ・自由記述**であり、箇条書き・口語・断片的な内容で構わない
- PLAN.mdを読んだら、そのまま実装に入らず、不明点をヒアリングしながらSPEC.mdを作成・確定させること
- SPEC.mdが確定してからTODO.mdのタスク分解を行い、ユーザーの承認を得てから実作業を開始する
- 作業完了後は TODO.md の該当タスクにチェックを入れ、KNOWLEDGE.md に学びを記録する
- 仕様が不明確な場合は作業を開始せず、ユーザーに確認してから SPEC.md を更新する
