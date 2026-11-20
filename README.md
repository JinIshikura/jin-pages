# jin-pages

小さな作成物をまとめて置く場所です。Cloudflare Pages で `public/` を公開します。

- `public/outing/` … おでかけのタイムラインページ（日付ごとのフォルダ）
- `public/yuinet/` … 結ネット 使い方サポート（健康村自治会向けのチャット）
- `functions/yuinet/api/ask.js` … チャットのAI回答（Cloudflare Pages Functions。シークレット `ANTHROPIC_API_KEY` を使用）
- `tools/yuinet/` … マニュアルPDFからチャットのデータと画像を作るスクリプト
