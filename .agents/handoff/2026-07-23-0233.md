# HANDOFF — Eagle OppaiOracle Tagger Plugin (2026-07-22 00:56)

## 使用ツール
OpenCode (oh-my-opencode)

## 現在の状態

### Phase 10.1 修正中（commit/push/PR 作成直前）

Phase 10（自動タグ付けモード）実機検証で発見された **`filePath` ENOENT バグ** を修正した。
worktree `E:\Documents\Projects\EagleOppaiTagger-fix-auto-tagger-filepath` ブランチ `fix/auto-tagger-filepath` で実装完了。
テスト全 green、code-simplifier レビュー実施済み。

### バグ内容

- 現象: 自動モード ON → ポーリング1回目で `ENOENT: no such file or directory, open 'Z:\...\{name}.undefined'`。連続5回エラーで自動停止
- 原因: `eagle.item.get({ fields: [..., "filePath", ...] })` の `fields` プロジェクションで `filePath` が正常に取得できない（`ext` が未選択で `${name}.undefined` になる）
- 手動モードは `getSelected()`（fields なし）なので無事だった

### 修正方針（ユーザー合意: 2段階取得）

1. 候補ID集め: lightweight な fields（`id`,`tags`,`importedAt`）で取得
2. 処理対象1枚: `getItemById(id)` で fields なしフル取得（filePath の正しい絶対パスを得る）
3. `processOneItem(fullItem, settings)` に渡す

### 変更ファイル

- `src/eagle-bridge.js`: `getItemById(id)` 追加（fields なしフル取得）+ `getUntagged` デフォルト fields から filePath 除外
- `src/auto-tagger.js`: `tick()` を2段階取得へリライト。workQueue は `{id, isNew}` のみ保持し、Step E で getItemById する
- `src/phase10-test.js`: モックに `opts.fields` ハンドリング追加 + getItemById 検証追加 + race condition テスト追加（`testTickSkipsWhenItemDisappears`）
- `.spec/TODO.md`: Phase 10.1 セクション追記
- `.spec/KNOWLEDGE.md`: Phase 10.1 セクション + ADR-12 候補 + code-simplifier レビュー結果追記
- `.agents/memory/MEMORY.md`: `fields` プロジェクションの罠を追記

### 検証結果

- `npm test`: phase2/3/4/5/10 全 green（計 192 tests passed / 0 failed、Phase 10 は 78 tests）
- `npm run check`: 全 .js 構文 OK
- code-simplifier レビュー: 高0件・中4件（2件対応・2件見送り）・低（外科原則でスキップ）

### 残作業（このセッションで進行中）

- [ ] commit + push + PR 作成
- [ ] Copilot レビュー対応（PR 作成後）

### 残作業（ユーザー実機検証）

- [ ] **Phase 10.1 DoD**: 自動モード ON → 新規画像追加 → `.undefined` エラーが出ずタグ付与される
- [ ] Phase 10 DoD §15.9 の残項目（自動モード各種挙動の実機確認）

## 次のセッションで最初にやること

### 優先度順

1. **PR マージ状況確認**: もし未マージならレビュー対応して `gh pr merge --squash --delete-branch`
2. **ユーザー実機検証結果待ち**: Phase 10.1 の DoD（`.undefined` が出ないか）
3. **Phase 11 検討**（Service 化）: 実機検証で「ウィンドウ開きっぱなしで十分」と判れば不要

## Git 履歴（直近）

```
8e29563 docs(phase10): DoD 完了 — TODO/KNOWLEDGE/HANDOFF/MEMORY 更新  (main HEAD)
051f1db feat(phase10): 自動タグ付けモード（Window 内ポーリング） (#3)
a6f37ea fix(phase10): Copilot PR review 指摘対応
```

## worktree 状態

- main: `E:\Documents\Projects\EagleOppaiTagger` @ `8e29563`
- **fix/auto-tagger-filepath**: `E:\Documents\Projects\EagleOppaiTagger-fix-auto-tagger-filepath`（commit/push/PR 前に作業中）

## 試したこと・結果（今回セッション）

### 成功したアプローチ

- **ユーザーからエラーメッセージ全文提供してもらい即座に原因特定**: `@iannahchandesu_.undefined` の `.undefined` から `${name}.${ext}` 組み立て失敗を推定
- **librarian で Eagle 公式 doc + OSS プラグイン調査**: 公式の `fields` の例が軽量メタデータのみ・AIタガー OSS は誰も `fields` を使っていないことを確認
- **2段階取得で パフォーマンスと正確性を両立**: lightweight fields で候補ID集め、処理対象1枚だけ getItemById
- **race condition 保護**: getItemById が null/throw を返すケースを catch + lastScanAt 更新で graceful degradation
- **code-simplifier レビューで getUntagged デフォルト fields の見落としを指摘** → 即座に修正

### 教訓

- Phase 10 実装時、`fields` プロジェクションは公式 doc の機能として載っていたため鵜呑みにした。実機検証で初めて罠が発覚
- 「公式 doc に書いてるから使える」ではなく、OSS プラグインの実例を確認すべきだった

## 注意点・ブロッカー

- **Phase 10.1 実機検証必須**: コード修正したが、実際の Eagle 4.0 Build12 で `eagle.item.get({ ids: [id] })` がフル item を返すかは未確認（`getSelected()` がフル item を返す事実から推定）
- もし `get({ ids })` でも filePath が取れない場合は別策（`getAll()` + filter 等）を検討
- 配布 zip は `npm run dist` で再生成が必要（古い zip を使うと直っていない）

## ADR 候補

- **ADR-12 候補**: Eagle Plugin API で `filePath` を使う場合は `fields` プロジェクションを避ける（詳細は `.spec/KNOWLEDGE.md` Phase 10.1）
- **ADR-11 候補**（継続）: 自動タグ付けは Window 内ポーリングで段階導入（Phase 11 で Service 化検討）
