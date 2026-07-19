# MEMORY — Eagle OppaiOracle Tagger Plugin

> セッションをまたぐ学習した知識・教訓。AGENTS.md と重複しない内容を 200 行以内で維持。

## Node.js テストで組み込み `https` をモックする

- `require.cache[require.resolve("https")] = { loaded: true, exports: fakeHttps }` で差し替え可能。
- `downloader.js` を `require` する前にキャッシュを設定・クリアしておくと、モックが確実に注入される。
- 偽レスポンスは `EventEmitter` ベースだが、`resume()` / `pipe()` / `destroy()` を実装しないと実際の `https` レスポンスと互換性が失われる。

## SHA256 プレースホルダー運用

- モデル実ファイルをまだ DL していない段階では、ハッシュを推測してハードコードすべきでない。
- `TO_BE_FILLED_*` プレースホルダーで運用し、初回 DL 時にコンソールに実ハッシュを出力。ユーザーが手動でコードまたは外部ファイルに追記する運用が安全。
