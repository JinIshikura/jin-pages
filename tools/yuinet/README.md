# 結ネット 使い方サポート（/yuinet/）の作り直し方

マニュアルPDFから、回答データ（`public/yuinet/kb.json`）と画像を作るスクリプトです。

1. 作業用フォルダに `src/guide.pdf`（利用者ガイド）と `src/disaster.pdf`（災害モードマニュアル）を置く
2. 次を順に実行する（Python 3、`pip install pymupdf pillow`）
   - `python3 extract.py` … 見出し・本文・画面図を取り出す（`build/` に出力）
   - `python3 sections.py` … 項目に分けてIDをつける
   - `python3 build_kb.py ../../public/yuinet` … `kb.json` と画像を出力
3. 見出しの言いかえ、検索キーワード、分野、アイコン名は `curate.py` で直す

AIの回答は `functions/yuinet/api/ask.js` が行います。Cloudflare Pages のシークレット `ANTHROPIC_API_KEY` が無いときは、画面はキーワード検索で答えます。
