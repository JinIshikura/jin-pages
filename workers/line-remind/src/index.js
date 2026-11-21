import { REMINDERS } from "./reminders.js";

// 予定時刻（日本時間）を "YYYY-MM-DD HH:MM" の形にする
function jstKey(ms) {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function broadcast(env, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_TOKEN}`,
    },
    body: JSON.stringify({ messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.log("LINE error", res.status, await res.text());
}

export default {
  // Cron（毎分）：その分の予定があれば送る
  async scheduled(controller, env, ctx) {
    if (!env.LINE_TOKEN) return;
    const key = jstKey(controller.scheduledTime);
    for (const [when, text] of REMINDERS) {
      if (when === key) ctx.waitUntil(broadcast(env, text));
    }
  },
  // ブラウザで開いたときは、次に送る予定を表示するだけ
  async fetch(request, env) {
    const now = jstKey(Date.now());
    const next = REMINDERS.filter(([w]) => w >= now).slice(0, 3).map(([w, t]) => `${w}  ${t.split("\n")[0]}`);
    return new Response(`line-remind: 動いています\n鍵の設定: ${env.LINE_TOKEN ? "OK" : "まだ"}\n次の予定:\n${next.join("\n") || "なし"}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
