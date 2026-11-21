import { REMINDERS } from "./reminders.js";
import { PLAN } from "./plan.js";
import { DAY, STOPS, compute, scheduleText, hm } from "./schedule.js";

// 日本時間の "YYYY-MM-DD" と 0時からの分
function jst(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return { day: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

async function loadState(env) {
  if (!env.STATE) return { arrivals: {}, noticed: 0 };
  return (await env.STATE.get(`state:${DAY}`, "json")) || { arrivals: {}, noticed: 0 };
}
async function saveState(env, st) { if (env.STATE) await env.STATE.put(`state:${DAY}`, JSON.stringify(st)); }

async function lineApi(env, path, body) {
  if (!env.LINE_TOKEN) return;
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LINE_TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.log("LINE error", path, res.status, await res.text());
}

async function verify(env, body, signature) {
  if (!env.LINE_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LINE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac))) === signature;
}

// リマインドの送信時刻を、組み直した予定から決める
function dueReminders(c, min) {
  const by = Object.fromEntries(c.stops.map((s, i) => [s.id, { ...s, dep: s.time + s.stay }]));
  const out = [];
  for (const r of REMINDERS) {
    if (r.at != null) { if (r.at === min) out.push(r.text()); continue; }
    const s = by[r.id];
    if (!s || s.status === "skipped") continue;
    const at = (r.when === "dep" ? s.dep : s.time) + r.off;
    if (at === min) out.push(r.text(s));
  }
  return out;
}

const SYSTEM = (now, c) => `あなたはドライブデート中の2人をサポートするLINEのアシスタントです。
今の日本時間は ${now} です。下の予定とスポット情報をもとに、日本語で短く（目安200字以内）答えてください。
LINEで読むので、見出しや表、**などの記号は使わず、普通の文章か短い箇条書き（・）にしてください。
わからないことや、調べても確かでないことは、そう伝えてください。営業時間などは変わることがあるので、大事なことは現地で確認するよう添えてください。
位置情報が送られてきたら、その場所を前提に答えてください。
${PLAN}
【いまの組み直し後の予定】${c.summary || "予定どおり"}
${scheduleText(c)}`;

async function askClaude(env, userText, c) {
  const n = jst(Date.now());
  const body = {
    model: env.MODEL || "claude-haiku-5-5",
    max_tokens: 700,
    system: SYSTEM(`${n.day} ${hm(n.min)}`, c),
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
  try { data = await call(body); } catch (e) { console.log("Claude error (with search)", String(e)); delete body.tools; data = await call(body); }
  const text = (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("").trim();
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
  const c = compute((await loadState(env)).arrivals);
  let answer;
  try { answer = await askClaude(env, q, c); } catch (e) { console.log("Claude error", String(e)); answer = "いまAIにつながりませんでした。少ししてからもう一度送ってください。"; }
  await lineApi(env, "reply", { replyToken: ev.replyToken, messages: [{ type: "text", text: answer }] });
}

export default {
  async scheduled(controller, env, ctx) {
    const n = jst(controller.scheduledTime);
    if (n.day !== DAY) return;
    const c = compute((await loadState(env)).arrivals);
    for (const text of dueReminders(c, n.min)) ctx.waitUntil(lineApi(env, "broadcast", { messages: [{ type: "text", text }] }));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.text();
      if (!(await verify(env, body, request.headers.get("x-line-signature")))) return new Response("bad signature", { status: 401 });
      const { events = [] } = JSON.parse(body || "{}");
      for (const ev of events) ctx.waitUntil(handleEvent(env, ev));
      return new Response("ok");
    }
    // ページから：いまの状態（到着記録と組み直した予定）
    if (url.pathname === "/state") {
      const st = await loadState(env);
      return json({ day: DAY, arrivals: st.arrivals, ...compute(st.arrivals), storage: !!env.STATE });
    }
    // ページから：GPSで目的地に着いたことを記録（当日だけ・最初の1回だけ）
    if (request.method === "POST" && url.pathname === "/arrive") {
      const { id } = await request.json().catch(() => ({}));
      const n = jst(Date.now());
      const stop = STOPS.find((s) => s.id === id && s.gps);
      if (!stop) return json({ error: "unknown stop" }, 400);
      if (n.day !== DAY) return json({ ignored: "not the day" });
      const st = await loadState(env);
      if (st.arrivals[id] == null) {
        st.arrivals[id] = n.min;
        const c = compute(st.arrivals);
        if (c.delay >= 10 && c.delay - (st.noticed || 0) >= 10) {
          st.noticed = c.delay;
          ctx.waitUntil(lineApi(env, "broadcast", { messages: [{ type: "text", text: `【予定の組み直し】${stop.name}に${hm(n.min)}着。${c.summary}\n${c.stops.filter((s) => s.time >= n.min && s.id !== "end").slice(0, 4).map((s) => `${hm(s.time)} ${s.name}${s.status === "skipped" ? "（カット）" : s.status === "window" ? "（車窓から）" : ""}`).join("\n")}` }] }));
        }
        await saveState(env, st);
      }
      return json({ ok: true, arrivals: st.arrivals, ...compute(st.arrivals) });
    }
    const n = jst(Date.now());
    const ok = (v) => (v ? "OK" : "まだ");
    return new Response(`line-remind: 動いています\nLINE_TOKEN: ${ok(env.LINE_TOKEN)}\nLINE_SECRET: ${ok(env.LINE_SECRET)}\nANTHROPIC_API_KEY: ${ok(env.ANTHROPIC_API_KEY)}\n保存場所(KV): ${ok(env.STATE)}\n今: ${n.day} ${hm(n.min)}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  },
};
