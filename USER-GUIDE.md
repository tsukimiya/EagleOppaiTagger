# Eagle OppaiOracle Tagger — ユーザー作業手順書

> 本体実装（Phase 1-6）は完了済み。以下はユーザー環境でのみ完結する検証・運用手順。

---

## 前提

- Windows 10/11 x64
- Eagle 4.0 Build12 以降（Plugin API 対応版）
- Node.js 16 以降（`npm install` 実行用・Eagle 内蔵 Node とは別）

---

## C. Eagle プラグイン登録（Phase 0 DoD）

### C-1. 依存モジュールのインストール

```powershell
cd "E:\Documents\Projects\EagleOppaiTagger"
npm install
```

完了すると `node_modules/` に `jimp` と `onnxruntime-node` が展開される。

### C-2. プラグインフォルダへのシンボリックリンク登録

**管理者権限**の PowerShell で実行:

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$env:APPDATA\Eagle\Plugins\eagle-oppai-tagger" `
  -Target "E:\Documents\Projects\EagleOppaiTagger"
```

すでにリンクを貼った場合は一度削除してから貼り直す:

```powershell
Remove-Item "$env:APPDATA\Eagle\Plugins\eagle-oppai-tagger" -Force
# 上記 New-Item を再実行
```

### C-3. Eagle 起動とプラグイン確認

1. Eagle を起動（起動中の場合は完全終了してから再起動）
2. メニュー → プラグイン → 一覧に「OppaiOracle Tagger」が表示されることを確認
3. プラグインを起動 → 640×480 のウィンドウが開く
4. ヘッダーに「OppaiOracle Tagger」/ モデル状態「未ダウンロード」/ 設定エリアが表示されることを確認

**失敗する場合**:
- プラグインが一覧に表示されない → manifest.json の構文エラー・シンボリックリンクパス違いを確認
- プラグイン起動直後にクラッシュ → `node_modules/` が展開済みか確認。Eagle を起動したまま `npm install` した場合は一度 Eagle を再起動

---

## D. モデルダウンロード + 実推論テスト（Phase 2 DoD）

### D-1. モデルダウンロード

1. Eagle 上でプラグインを起動
2. 「モデルをダウンロード」ボタンをクリック
3. 進捗表示が 100% になるまで待つ（約 1GB・回線次第で 5〜20 分）
4. ステータスが「DL済み」に切り替わる

**失敗する場合**:
- DL が途中で止まる → 回線の問題。`models/V1.1/*.tmp` が残っていればレジュームされるので再度クリック
- SHA256 エラー → ダウンロード破損。`models/V1.1/` を削除して再試行
- 手動 DL を優先する場合 → HuggingFace (https://huggingface.co/Grio43/OppaiOracle/tree/main/V1.1_onnx) から `model.onnx` / `selected_tags.csv` / `pr_thresholds.json` を直接ダウンロードし、`models/V1.1/` に配置

### D-2. 実推論テスト

コマンドプロンプトまたは PowerShell で:

```powershell
cd "E:\Documents\Projects\EagleOppaiTagger"
node src/phase2-test.js
```

期待結果:

```
=== Real inference test (optional) ===
  Model found — running inference test...
  Preprocessed: pixel_values=602112, padding_mask=200704
  PASS: output is Float32Array
  PASS: output length is 19294 (got 19294)
  PASS: probabilities in [0,1] range (min=..., max=...)

Results: 29 passed, 0 failed
```

「19294 次元」「[0,1] 範囲」が PASS になれば、ローカル ONNX 推論が完全動作している。

### D-3. 実画像でタグ確認（オプション）

`test-images/` を作成し、任意のアニメ画像を数枚入れて Eagle で選択 → プラグインから「実行」をクリック。Eagle 上でタグが付与されることを確認。

---

## E. プロファイリング（Phase 6 DoD）

### E-1. プロファイル実行

```powershell
cd "E:\Documents\Projects\EagleOppaiTagger"
node scripts/profile.js <画像ディレクトリ> --warmup
```

例:

```powershell
node scripts/profile.js test-images\ --warmup
```

### E-2. 出力の見方

コンソールに以下が表示される:

```
プロファイリング結果
  処理枚数:     N / M
  1枚あたり:
    平均:       X.XX s
    中央値:     X.XX s
    ...
  メモリ:
    ピーク RSS: XXX MB

目標値判定:
  速度 ✅ 平均 X.XX s < 5秒
  メモリ ✅ ピーク XXX MB < 2.5 GB
```

### E-3. 目標値を満たさない場合の対策

- **速度**: 5秒超過 → 推論 (inferenceMs) が大半を占める場合は CPU 性能起因。前処理 (preprocessMs) が長い場合は Jimp の遅さが原因 → Sharp への差し替えを検討（別 ABI スパイク必要）
- **メモリ**: 2.5GB 超過 → 推論後の `probs` Float32Array(19294) を参照で持ち回さずすぐ GC させる。セッションを使い回す（既にキャッシュ実装済み）

### E-4. レポート保存

`scripts/profile-report.json` に詳細が保存される。Phase 6 DoD 判定はこのファイルを参照。

---

## 異常時のエスカレーション

| 現象 | エスカレーション先 |
|------|------------------|
| `require('onnxruntime-node')` で ReferenceError / TypeError | B1 スパイク結果を再確認（`.sisyphus/spikes/b1-onnxruntime-load/RESULTS.md`） |
| Eagle がフリーズ・即座にクラッシュ | `node_modules/onnxruntime-node/bin/napi-v3/win32/x64/` にネイティブバイナリが存在するか確認 |
| 推論結果のタグが Python 参照と大幅に違う | `scripts/python-ref/export_tensors.py` で期待テンサーを再生成し `node src/verify.js` で照合 |
| SHA256 検証エラーが継続 | `models/V1.1/*.tmp` を削除して再 DL |
