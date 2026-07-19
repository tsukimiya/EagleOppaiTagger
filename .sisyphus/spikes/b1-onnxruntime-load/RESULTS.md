# Spike B1 — 実行結果

> 実行後、このファイルに結果を記入してエージェントに報告してください。

---

## 実行環境

| 項目 | 値 |
|------|-----|
| 実行日時 | （例: 2026-07-19 14:32 JST） |
| OS | （例: Windows 11 22H2 x64） |
| Eagle バージョン | （例: 4.0 Build 18） |
| 外部 Node バージョン | （`node -v` の結果。例: v18.17.0） |
| 外部 npm バージョン | （`npm -v` の結果。例: 9.6.7） |
| onnxruntime-node バージョン | （`npm ls onnxruntime-node` の結果。例: onnxruntime-node@1.18.0） |
| 登録方法 | シンボリックリンク / コピー（該当する方） |

---

## Verdict

<!-- プラグインウィンドウに表示された Verdict を記載 -->
- [ ] `PASS_LOAD_AND_CALL` — onnxruntime-node 完全動作
- [ ] `PARTIAL_LOAD_ONLY` — ロードは成功・API 呼び出し失敗
- [ ] `FAIL_CANNOT_LOAD` — require 段階で失敗
- [ ] その他（プラグインが開かない / Eagle フリーズ 等）

---

## 診断結果 JSON

<!-- 「Copy result JSON」でコピーした JSON をそのまま貼り付ける -->

```json
{
  "startedAt": "...",
  "finishedAt": "...",
  "verdict": "...",
  "steps": {
    "env": { ... },
    "requireLookup": { ... },
    "moduleResolve": { ... },
    "requireOnnx": { ... },
    "tensorConstruct": { ... },
    "sessionCreate": { ... },
    "providers": { ... }
  }
}
```

---

## 観察所見（任意）

気づいたこと・プラグインの挙動・エラーメッセージの見え方など、自由記述。

-

---

## エージェント宛てメモ（任意）

次の判断に必要な追加情報があれば記載。

-
