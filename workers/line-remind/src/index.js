import { REMINDERS } from "./reminders.js";
import { PLAN } from "./plan.js";

// 予定時刻（日本時間）を "YYYY-MM-DD HH:MM" の形にする
function jstKey(ms) {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function lineApi(env, path, body) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LINE_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.log("LINE error", path, res.status, await res.text());
}

// LINEからの通知が本物か確かめる（チャネルシークレットで署名を検証）
async function verify(env, body, signature) {
  if (!env.LINE_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return b64 === signature;
}

const SYSTEM = (now) => `あなたはドライブデート中の2人をサポートするLINEのアシスタントです。
今の日本時間は ${now} です。下の予定とスポット情報をもとに、日本語で短く（目安200字以内）答えてください。
LINEで読むので、見出しや表、**などの記号は使わず、普通の文章か短い箇条書き（・）にしてください。
わからないことや、調べても確かでないことは、そう伝えてください。営業時間などは変わることがあるので、大事なことは現地で確認するよう添えてください。
位置情報が送られてきたら、その場所を前提に答えてください。
${PLAN}`;

async function askClaude(env, userText) {
  const body = {
    model: env.MODEL || "claude-haiku-5-5",
    max_tokens: 700,
    system: SYSTEM(jstKey(Date.now())),
    messages: [{ role: "user", content: userText }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2, user_location: { type: "approximate", country: "JP", region: "Shiga", timezone: "Asia/Tokyo" } }],
  };
  const call = async (b) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(b),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  };
  let data;
  try { data = await call(body); }
  catch (e) { console.log("Claude error (with search)", String(e)); delete body.tools; data = await call(body); }
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
  return text.slice(0, 4500) || "うまく答えられませんでした。もう一度送ってみてください。";
}

async function handleEvent(env, ev) {
  if (ev.type !== "message" || !ev.replyToken) return;
  const uid = ev.source && ev.source.userId;
  console.log("message from", uid);
  if (env.ALLOWED_USERS && !env.ALLOWED_USERS.split(",").includes(uid)) return;
  let q = "";
  if (ev.message.type === "text") q = ev.message.text;
  else if (ev.message.type === "location") q = `今いる場所です：${ev.message.address || ""}（緯度${ev.message.latitude}、経度${ev.message.longitude}）。この近くで役立つ情報や、次の予定までの動き方を教えて。`;
  else return lineApi(env, "reply", { replyToken: ev.replyToken, messages: [{ type: "text", text: "文字か位置情報で送ってね。" }] });
  if (!env.ANTHROPIC_API_KEY) return lineApi(env, "reply", { replyToken: ev.replyToken, messages: [{ type: "text", text: "AIの鍵（ANTHROPIC_API_KEY）がまだ設定されていません。" }] });
  let answer;
  try { answer = await askClaude(env, q); }
  catch (e) { console.log("Claude error", String(e)); answer = "いまAIにつながりませんでした。少ししてからもう一度送ってください。"; }
  await lineApi(env, "reply", { replyToken: ev.replyToken, messages: [{ type: "text", text: answer }] });
}

export default {
  // Cron（毎分）：その分の予定があれば、友だち全員に送る
  async scheduled(controller, env, ctx) {
    if (!env.LINE_TOKEN) return;
    const key = jstKey(controller.scheduledTime);
    for (const [when, text] of REMINDERS) {
      if (when === key) ctx.waitUntil(lineApi(env, "broadcast", { messages: [{ type: "text", text }] }));
    }
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // LINEからの受け口
    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.text();
      if (!(await verify(env, body, request.headers.get("x-line-signature")))) return new Response("bad signature", { status: 401 });
      const { events = [] } = JSON.parse(body || "{}");
      for (const ev of events) ctx.waitUntil(handleEvent(env, ev));
      return new Response("ok");
    }
    // ブラウザで開いたとき：設定の状態と次の予定
    const now = jstKey(Date.now());
    const next = REMINDERS.filter(([w]) => w >= now).slice(0, 3).map(([w, t]) => `${w}  ${t.split("\n")[0]}`);
    const ok = (v) => (v ? "OK" : "まだ");
    return new Response(`line-remind: 動いています\nLINE_TOKEN: ${ok(env.LINE_TOKEN)}\nLINE_SECRET: ${ok(env.LINE_SECRET)}\nANTHROPIC_API_KEY: ${ok(env.ANTHROPIC_API_KEY)}\n次の予定:\n${next.join("\n") || "なし"}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
