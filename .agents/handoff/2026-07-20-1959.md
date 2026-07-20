# HANDOFF — Eagle OppaiOracle Tagger Plugin (2026-07-20 14:51)

## 使用ツール
OpenCode (oh-my-opencode)

## 現在の状態

### Phase 6 完了（主要 DoD クリア・マージ済み）

Phase 6（プロファイリング・配布）の主要 DoD をすべてクリアし、PR #1 / #2 をマージ済み。

**PR #1** (`99e4510`): feat(phase6): 配布 zip ビルダ + プロファイリング拡張
- `scripts/make-dist.ps1`（allowlist 方式配布 zip ビルダ・PS 5.x/7 両対応）
- `scripts/profile.js` に `--repeat N` オプション追加
- `README.md` にサーバ推論時のプライバシー注意追記（SPEC L724 対応）
- `npm run dist` エイリアス追加
- `.gitattributes` で `*.ps1 text eol=crlf` を強制
- Copilot レビュー3件すべて対応

**PR #2** (`d62fb61`): docs(memory): Windows junction 削除時の事故と対策を追記
- MEMORY.md に Phase 6 片付け時の事故と対策を記録

### 検証済み DoD（Phase 6）

| DoD | 実測 |
|-----|------|
| 1枚5秒以内 | ✅ 平均 2.87s（102枚ロングラン） |
| ピーク RSS 2.5GB 以下 | ✅ 1504MB |
| 配布 zip 5MB 以下 | ✅ 0.05MB |
| 回帰テスト | ✅ 87+ PASS（phase2/3/4/5/8/9） |

### 実装済みの機能

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | 画像前処理 | ✅ MAE < 5e-9 |
| 2 | ONNX 推論 + タグ変換 | ✅ |
| 3 | Eagle 連携 | ✅（実機タグ付与・キャンセル確認済） |
| 4 | UI/UX | ✅ |
| 5 | モデルダウンローダー | ✅ |
| 6 | プロファイリング・配布 | ✅（主要 DoD クリア・クリーン環境検証のみ残り） |
| 7 | Python FastAPI 推論サーバ | ✅ |
| 8 | プラグイン側クライアント化 | ✅ |
| 9a | モック E2E テスト | ✅ |

### Git 履歴（直近3件）

```
d62fb61 docs(memory): Windows junction 削除時の事故と対策を追記 (#2)
99e4510 feat(phase6): 配布 zip ビルダ + プロファイリング拡張 (#1)
1915fdd docs: HANDOFF.md + MEMORY.md をセッション内容で更新
```

### worktree 状態

**なし**（クリーンアップ済み）。すべて main で作業完了。

## 次のセッションで最初にやること

### 優先度順

1. **クリーン環境検証**（ユーザー作業）— Phase 6 真残作業
   - 別マシン/別ユーザーで配布 zip（`npm run dist` で生成）を展開
   - 初回起動 → モデル DL → タグ付け完結まで検証
   - 手順: USER-GUIDE.md §C（プラグイン登録）〜 §D（モデル DL + 実推論）

2. **Eagle 実機での100枚バッチ進捗バー検証**（ユーザー作業）
   - 100枚画像を選択 → プラグイン実行 → 進捗バーが滑らかに動くか確認
   - ロジックは1枚でも100枚でも同じ（コードレビュー済み）だが、実機描画で確認が必要

3. **Phase 9b（任意）**: 自宅サーバでの実環境検証
   - USER-GUIDE.md §F の手順に従う
   - `server/` で FastAPI 起動 → GPU 認識確認 → プラグインから `/infer` 経由で推論
   - ローカルフォールバック動作確認

## 試したこと・結果（前回セッション）

### 成功したアプローチ
- **サンプル3枚でのプロファイリング**: 100枚は無理だが、DoD「1枚5秒以内 / 2.5GB以下」は3枚で検証可能
- **102枚ロングラン**（3枚×34回・5分連続）: メモリリークなし・エラー0
- **PowerShell Compress-Archive の互換性**: `-LiteralPath "x/*"` は PS 5.x でエラー → `Push-Location` + `-Path "*"` で回避
- **allowlist 方式の配布 zip**: denylist より安全
- **Copilot レビュー3件対応**: すべて即日修正・両 PS バージョンで動作確認

### 失敗したアプローチ（教訓化済み）
- **Windows junction 削除**: `rmdir` で worktree 内 junction を削除したら main の `node_modules/jimp` が消失。`npm install` で5秒復元。→ MEMORY.md に記録

## 注意点・ブロッカー

- **クリーン環境検証**: 物理的に別マシン/別ユーザーが必要（自分では実施不可）
- **Eagle 実機100枚**: Eagle アプリと100枚の画像が必要（自分では実施不可）
- **プロファイリングレポート**: `scripts/profile-report.json` は `.gitignore` 済み（再生成可能）
- **配布 zip**: `dist/` も `.gitignore` 済み（`*.zip` でカバー）

## ADR 候補

今回のセッションで新規の ADR 候補は特になし。既存 ADR-1〜10 でカバー済み。

ただし、**main 直 commit の例外**（本更新）はルール逸脱だが「軽微なドキュメント更新・ユーザー明示指示」のため ADR 起票対象外と判断。
