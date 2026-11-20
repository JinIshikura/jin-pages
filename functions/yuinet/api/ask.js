// Cloudflare Pages Function: /yuinet/api/ask
// Answers questions about 結ネット with Claude, using only the manual text in /yuinet/kb.json.
// Needs the secret ANTHROPIC_API_KEY (Cloudflare Pages > Settings > Variables and Secrets).

const MODEL = "claude-haiku-5-5";
const MAX_Q = 300;
const PER_MIN = 8;      // requests per IP per minute (per worker instance)
const PER_DAY = 80;     // requests per IP per day (per worker instance)

let KB = null;
let SYSTEM = null;
const hits = new Map();

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function allow(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 86400000);
  const lastMin = list.filter((t) => now - t < 60000).length;
  if (lastMin >= PER_MIN || list.length >= PER_DAY) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

const RULES = `あなたは、地域ICTアプリ「結ネット」の使い方を案内するサポート係です。利用者は健康村自治会の住民で、スマホの操作に慣れていない高齢の方も多くいます。
後ろの「マニュアル」（結ネット 利用者ガイド Ver.6.1.0 と 災害モードマニュアル Ver.7.0.0 の内容）だけを根拠に、質問に答えてください。

回答のルール
- マニュアルに書かれている内容だけを使う。わかりやすく言いかえるのはよいが、マニュアルにない情報（画面のどこにあるか、誰が操作するか、条件、理由など）を付け足さない。
- マニュアルの手順・画面名・ボタン名を使い、やさしい言葉で短く答える。前置きやあいさつは書かない。最初の1行で、どの操作の説明かを短く書く。
- 手順は、マニュアルの丸数字（①②③…）のとおりに1行に1つずつ書く。丸数字は画面図の番号と対応しているので、手順を足したり、分けたり、まとめたり、番号を付け替えたりしない。「＊」の補足に番号をつけない。質問に関係する手順だけを、マニュアルの番号のまま抜き出してよい。
- マニュアルの①より前に必要な操作（記事を開く、設定メニューを開くなど）は、番号をつけずに最初の1行に書く。例：マニュアルが「①［回答する］を押す ②いずれかの回答を選択」なら、「回答したい記事を開いてから、次の手順で回答します。」と書き、「① 記事を開く」のような手順は足さない。
- 補足が必要なときだけ、「＊」で始まる行に書く。
- アイコンは、マニュアル中の［ ］の名前をそのまま使い、「［設定（歯車）］を押す」のように書く。
- 回答は長くても12行程度まで。質問に関係のない手順は書かない。
- マニュアルに書かれていないこと（自治会独自の決まり、端末の故障、アプリの不具合など）は推測で答えず、「マニュアルには載っていません」と伝え、班長またはデジタル化執行部への相談をすすめる。
- 役員・管理者など権限のある人だけができる操作は、そのことを書く。
- パスワードや番号などの個人情報は、このチャットに書かないよう案内する。質問に個人情報が含まれていても繰り返さない。
- 結ネットの使い方と関係のない質問には、結ネットの使い方の案内しかできないと短く伝える。
- 太字・見出し・表・マークダウン記号（#、*、- など）は使わない。

出力の形式（次の3つのタグだけを、この順で出力する）
<answer>回答本文</answer>
<refs>回答の根拠にしたマニュアル項目のID（[ ]内の英数字）を、関係の深い順に最大3つ、空白区切りで。根拠がなければ空にする。</refs>
<next>続けて聞かれそうな短い質問を最大3つ、「｜」区切りで。</next>`;

function buildSystem(kb) {
  const label = (id) => (kb.icons[id] && kb.icons[id].label) || "アイコン";
  const parts = kb.secs.map((s) => {
    const pg = "P." + s.p[0] + (s.p[1] !== s.p[0] ? "-" + s.p[1] : "");
    const head = `[${s.id}] ${kb.docs[s.doc].name} ${pg} ／ ${s.crumb}（${s.title}）${s.admin ? "［役員・管理者向けの操作］" : ""}`;
    const body = s.paras.map((p) => p.replace(/\{i:([a-z0-9]+)\}/g, (_, id) => "［" + label(id) + "］")).join("\n");
    return head + "\n" + body;
  });
  return "# マニュアル\n\n" + parts.join("\n\n");
}

async function callClaude(env, messages, attempt) {
  const base = env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const payload = {
    model: env.MODEL || MODEL,
    max_tokens: 4000,
    system: [
      { type: "text", text: RULES },
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages,
  };
  // first try: medium effort (adaptive thinking keeps answers close to the manual). second try: plain request.
  if (attempt === 0) {
    payload.output_config = { effort: "medium" };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 28000);
  try {
    return await fetch(base + "/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": attempt === 0 ? "2026-10-21" : "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet({ env }) {
  return json({ ok: true, ai: Boolean(env.ANTHROPIC_API_KEY) });
}

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, reason: "no_key" }, 503);

  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return json({ ok: false, reason: "origin" }, 403);
    } catch {
      return json({ ok: false, reason: "origin" }, 403);
    }
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!allow(ip)) return json({ ok: false, reason: "busy" }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  const q = String((body && body.q) || "").trim().slice(0, MAX_Q);
  if (!q) return json({ ok: false, reason: "empty" }, 400);

  try {
    if (!KB) {
      const r = await env.ASSETS.fetch(new URL("/yuinet/kb.json", request.url));
      KB = await r.json();
      SYSTEM = buildSystem(KB);
    }
  } catch {
    return json({ ok: false, reason: "kb" }, 500);
  }

  const messages = [];
  const hist = Array.isArray(body.history) ? body.history.slice(-2) : [];
  for (const h of hist) {
    const hq = String((h && h.q) || "").slice(0, MAX_Q).trim();
    const ha = String((h && h.a) || "").slice(0, 800).trim();
    if (hq && ha) {
      messages.push({ role: "user", content: hq });
      messages.push({ role: "assistant", content: `<answer>${ha}</answer>` });
    }
  }
  messages.push({ role: "user", content: q });

  let res, data;
  try {
    res = await callClaude(env, messages, 0);
    if (res.status === 400) {
      console.log("first attempt 400:", (await res.text()).slice(0, 300));
      res = await callClaude(env, messages, 1);
    }
    data = await res.json();
  } catch (e) {
    return json({ ok: false, reason: "upstream" }, 502);
  }
  if (!res.ok) {
    console.log("anthropic error", res.status, JSON.stringify(data).slice(0, 300));
    return json({ ok: false, reason: res.status === 429 ? "busy" : "upstream" }, 502);
  }
  if (data.stop_reason === "refusal") return json({ ok: false, reason: "refusal" }, 200);

  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const pick = (tag) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|<(?:answer|refs|next)>|$)`));
    return m ? m[1].trim() : "";
  };
  let answer = pick("answer") || text.split(/<(?:refs|next)>/)[0].replace(/<\/?answer>/g, "").trim();
  answer = answer.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").slice(0, 2000);
  const ids = new Set(KB.secs.map((s) => s.id));
  const refs = [...new Set((pick("refs").match(/[gd]\d{2}[a-h]/g) || []).filter((id) => ids.has(id)))].slice(0, 3);
  const next = pick("next").split(/[｜|\n]/).map((s) => s.trim()).filter((s) => s && s.length <= 40).slice(0, 3);
  if (data.usage) console.log("usage", JSON.stringify(data.usage));
  return json({ ok: true, answer, refs, next });
}
