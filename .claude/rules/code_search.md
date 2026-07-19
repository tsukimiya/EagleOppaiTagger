---
paths:
  - "**"
---

# コード検索（CodeGraph 主体・ドキュメントは semble）

このプロジェクトでは [CodeGraph](https://github.com/colbymchenry/codegraph) を利用している。

**使い分けの原則:** コードは CodeGraph（正確・グラフベース・1回で完結） / ドキュメント・設定は semble（意味的な曖昧検索） / grep = リテラル一致 / 編集は組み込みの Edit・Write。

## 1. コード調査はまず CodeGraph

grep / glob / Read を多用する前に、まず CodeGraph で以下を確認する。1回の呼び出しで、関連シンボルのソース（行番号付き）と呼び出しパス・影響範囲がまとめて返る。

- 対象シンボルの定義
- 呼び出し元（動的ディスパッチ越しも辿れる — grep では追えない）
- 呼び出し先
- 影響範囲（変更のブラストラディウス）
- 関連テスト

「Xの仕組みは?」「XからYへの流れは?」のような自然言語の質問にもそのまま答えられるため、コードに関する探索的な問いも CodeGraph が第一手。

MCP ツールが使える環境では `codegraph_explore` を使う。使えない場合は CLI で同じ結果が得られる:

```bash
codegraph explore "How does the auth flow work?"   # 質問・シンボル名でまとめて調査
codegraph callers <symbol>                          # 呼び出し元を漏れなく列挙
codegraph callees <symbol>                          # 呼び出し先を列挙
codegraph impact <symbol>                           # 変更の影響範囲を分析
codegraph query <search>                            # シンボル検索
```

インデックスはリポジトリ直下の `.codegraph/` にある。無いリポジトリでは CodeGraph をスキップする（`codegraph init` の実行はユーザーの判断に委ね、勝手に実行しない）。ファイル変更は自動同期されるが、結果が古そうなら `codegraph sync` で更新できる。

## 2. 必要最小限のファイルだけを読む

CodeGraph の結果には該当シンボルのソースが含まれるため、多くの場合ファイル全体を読む必要はない。返ってきたチャンクで文脈が足りないときだけ、対象範囲を絞って Read する。

## 3. ドキュメント・設定ファイルの検索は semble

作業メモや手順書などの Markdown、設定ファイル（yaml, toml 等）は CodeGraph の守備範囲外。これらを内容で検索するときは `semble search` を使う。

```bash
semble search "deployment guide" ./my-project --content docs
semble search "database host port" ./my-project --content config
semble search "authentication" ./my-project --content all   # コード・docs・設定を横断
```

インデックスは初回実行時に構築され（以降キャッシュ）、ファイル変更時に自動で無効化される。`semble` が `$PATH` に無ければ `uvx --from "semble[mcp]" semble` で代替する。

## 4. grep / Read はフォールバック

完全一致のリテラル検索、網羅的な文字列スイープ、パスの即時確認のときだけ grep / Glob / Read を使う。

## 5. 編集は組み込みの Edit / Write

編集はエージェント組み込みの Edit / Write を使う（カレントディレクトリを尊重するため worktree 環境でも安全）。シンボリック編集系の MCP ツールは使わない。

## ワークフロー

1. コードに関する問いは CodeGraph（`codegraph_explore` / `codegraph explore`）で調べ、定義・呼び出し元/先・影響範囲・関連テストを確認する。
2. 返ってきたソースで文脈が足りないときだけ、必要最小限のファイルを Read する。
3. ドキュメント・設定ファイルを探すときは `semble search --content docs` / `--content config` を使う。
4. grep は網羅的なリテラル一致や厳密な文字列確認が要るときだけ使う。
5. 編集は Edit / Write で行う。
