# HANDOFF — Eagle OppaiOracle Tagger Plugin (2026-07-20 19:59)

## 使用ツール
OpenCode (oh-my-opencode)

## 現在の状態

### Phase 10 完了（マージ済み・実機検証待ち）

Phase 10（Window 内自動タグ付けモード）を実装し、PR #3 をマージ済み。
Copilot レビュー7件すべて対応済み（commit `a6f37ea`）。

**PR #3** (`051f1db`): feat(phase10): 自動タグ付けモード（Window 内ポーリング）
- `src/auto-tagger.js`（新規・ポーリングループ・排他制御・連続エラー停止）
- `src/eagle-bridge.js` に getItems / getIdsWithModifiedAt / getUntagged / countUntagged 追加
- `src/settings.js` に autoMode 設定 + loadLastScanAt / saveLastScanAt 追加
- `src/main.js` の run() に auto-tagger の pause/resume 追加
- `src/ui.js` + `index.html` に自動モード UI + 専用 NSFW 警告ダイアログ
- `src/phase10-test.js`（新規・71 tests）
- `.spec/PLAN.md` / `SPEC.md`（v4 セクション追加）/ `TODO.md` に Phase 10 を追記

### Copilot レビューで改善した点（commit a6f37ea）

1. 新規候補抽出を modifiedAt 降順 + cap + tags.length === 0 フィルタで精度向上
2. getUntagged() の結果を importedAt 降順でソートし新規優先を維持
3. ポーリング間隔を SPEC 通り 30〜300秒に clamp（clampIntervalSec ヘルパ）
4. autoOnWarning で localStorage の autoMode.enabled も更新（誤再開防止）
5. readSettingsFromUI の間隔下限を 30 に統一
6. SPEC §15.1 の「30〜60秒」を「30〜300秒」に修正
7. ui.js の auto-tagger require パスに Eagle renderer __dirname のコメント追記

### 検証済み DoD（Phase 10）

| DoD | 実測 |
|-----|------|
| 自動モード OFF（デフォルト）で何も起きない | ✅ テスト検証済み |
| 手動「実行」中は自動を一時停止 | ✅ テスト検証済み |
| 連続5回エラーで自動停止 + UI 反映 | ✅ テスト検証済み |
| 既存テスト 243+ PASS（回帰なし） | ✅ phase2/3/4/5/8/9/10 |

### 未検証 DoD（ユーザー実機作業）

- [ ] 自動モード ON → 新規画像を追加 → 60秒以内にタグ付与
- [ ] 既存の未タグ付け画像が順次タグ付けされる
- [ ] プラグインウィンドウを閉じて再び開くと resume する

### 実装済みの機能（累計）

| Phase | 内容 | 状態 |
|-------|------|------|
| 1 | 画像前処理 | ✅ MAE < 5e-9 |
| 2 | ONNX 推論 + タグ変換 | ✅ |
| 3 | Eagle 連携 | ✅ |
| 4 | UI/UX | ✅ |
| 5 | モデルダウンローダー | ✅ |
| 6 | プロファイリング・配布 | ✅ |
| 7 | Python FastAPI 推論サーバ | ✅ |
| 8 | プラグイン側クライアント化 | ✅ |
| 9a | モック E2E テスト | ✅ |
| **10** | **Window 内自動タグ付け** | ✅ **コード完成・テスト PASS・実機検証待ち** |

### Git 履歴（直近3件）

```
051f1db feat(phase10): 自動タグ付けモード（Window 内ポーリング） (#3)
a6f37ea fix(phase10): Copilot PR review 指摘対応
237543c feat(phase10): 自動タグ付けモード（Window 内ポーリング）
```

### worktree 状態

**なし**（クリーンアップ済み）。main ブランチ `051f1db` で作業完了。

## 次のセッションで最初にやること

### 優先度順

1. **Phase 10 実機検証**（ユーザー作業）— DoD §15.9 の残項目
   - 自動モード ON → 新規画像追加 → タグ付与されるか（60秒以内目安）
   - 既存の未タグ付け画像が順次処理されるか
   - プラグインウィンドウを閉じて再び開くと lastScanAt から resume するか

2. **Phase 6 クリーン環境検証**（ユーザー作業・前回持ち越し）
   - 別マシン/別ユーザーで配布 zip（`npm run dist` で生成）を展開
   - 初回起動 → モデル DL → タグ付け完結まで検証

3. **Phase 9b（任意）**: 自宅サーバでの実環境検証
   - USER-GUIDE.md §F の手順に従う

4. **Phase 11 検討**（自動タグ付けの Service 化）:
   - 実機検証で「ウィンドウを開きっぱなしで十分」と判れば Phase 11 不要
   - 「ウィンドウを閉じても動かしたい」要望が強ければ manifest に `serviceMode: true` を追加して常駐化を検討

## 試したこと・結果（前回セッション）

### 成功したアプローチ

- **公式 doc の再調査で v3 PLAN の前提を修正**: 「Event API 無しで不可」→「getIdsWithModifiedAt + isUntagged でポーリング実現可能」
- **段階的アプローチ**: Background Service（`serviceMode: true`）ではなく、まずは Window 内自動化で小さく始める。Service 化は Phase 11 で検討
- **循環 import 回避**: auto-tagger と main.js が相互参照するため、両者とも関数内で遅延 require
- **`??` 演算子**: `loadLastScanAt() ?? Date.now()`。`||` だと 0 が falsy で Date.now() に上書きされる罠を回避
- **Copilot レビュー7件すべて即日対応**: 新規候補精度・優先度維持・間隔 clamp など、実際の挙動改善に貢献

### 失敗したアプローチ（教訓化済み）

- 特になし。テストファーストではなかったが、実装後に71テストを一括追加して網羅的に検証できた

## 注意点・ブロッカー

- **Phase 10 実機検証**: Eagle アプリと実際の画像ライブラリが必要（自分では実施不可）
- **Phase 6 クリーン環境検証**: 物理的に別マシン/別ユーザーが必要
- **Phase 11 Service 化**: 自動 NSFW タグ付与のリスク（無人で NSFW タグが付く）をどう扱うか要検討
- **プロファイリングレポート**: `scripts/profile-report.json` は `.gitignore` 済み
- **配布 zip**: `dist/` も `.gitignore` 済み（`*.zip` でカバー）

## ADR 候補

- **ADR-11 候補**: 自動タグ付けは Background Service 型ではなく Window 内ポーリングで段階導入（Phase 10）。詳細は `.spec/KNOWLEDGE.md` の Phase 10 セクション参照
  - 見直し条件: Phase 10 の実機検証結果次第で Service 化の要否を判断

## その他

- Phase 10 の自動 NSFW タグ付与に対する初回警告ダイアログを別キー（`eagle-oppai-tagger:auto-nsfw-dismissed`）で管理。手動実行の NSFW 警告とは独立
- 自動モードはデフォルト OFF。ユーザーが明示的に ON しないと動かない
- main.js と auto-tagger.js の排他制御により、手動「実行」と自動処理が同時に走ることはない
