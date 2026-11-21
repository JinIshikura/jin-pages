// 当日の予定（分＝0時からの分数、日本時間）と、遅れたときの組み直しルール
export const DAY = "2026-11-22";
export const PAGE = "https://jin-pages.pages.dev/outing/2026-11-22-shiga/";

// arr:予定の到着 stay:滞在 min:短縮できる下限 travel:次までの移動
export const STOPS = [
  { id: "start", name: "ファミマ千里丘を出発", arr: 540, stay: 0, min: 0, travel: 105 },
  { id: "namiki", name: "メタセコイア並木", arr: 645, stay: 60, min: 40, travel: 0, gps: true },
  { id: "cafe", name: "並木カフェ メタセコイア", arr: 705, stay: 45, min: 30, travel: 70 },
  { id: "sakamoto", name: "坂本の町歩き", arr: 820, stay: 50, min: 0, travel: 0, gps: true },
  { id: "hiyoshi", name: "日吉大社", arr: 870, stay: 80, min: 45, travel: 45 },
  { id: "shira", name: "白鬚神社", arr: 995, stay: 20, min: 5, travel: 50, gps: true },
  { id: "yume", name: "夢見が丘", arr: 1065, stay: 75, min: 45, travel: 0, gps: true },
  { id: "dinner", name: "一乗寺で夕食", arr: 1140, stay: 90, min: 60, travel: 60 },
  { id: "end", name: "ファミマ千里丘に到着", arr: 1290, stay: 0, min: 0, travel: 0 },
];
// 遅れを吸収するときに削る順番
const SHRINK_ORDER = ["sakamoto", "cafe", "hiyoshi", "shira", "namiki", "yume", "dinner"];

export const hm = (m) => `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, "0")}`;

// arrivals: { id: 分 } GPSで記録された実際の到着
export function compute(arrivals = {}) {
  const idx = Object.fromEntries(STOPS.map((s, i) => [s.id, i]));
  let k = -1;
  STOPS.forEach((s, i) => { if (arrivals[s.id] != null) k = i; });
  const out = STOPS.map((s) => ({ id: s.id, name: s.name, plan: s.arr, time: s.arr, stay: s.stay, status: "ok", note: "", arrived: arrivals[s.id] ?? null }));
  if (k < 0) return { stops: out, delay: 0, summary: "", actions: [] };
  const delay = Math.max(0, arrivals[STOPS[k].id] - STOPS[k].arr);
  // 遅れの分だけ、これから先の滞在を短くする
  let left = delay;
  const act = {};
  for (const id of SHRINK_ORDER) {
    const i = idx[id];
    if (i < k || left <= 0) continue;
    const can = STOPS[i].stay - STOPS[i].min;
    const cut = Math.min(can, left);
    if (cut > 0) {
      out[i].stay -= cut; left -= cut;
      out[i].status = out[i].stay === 0 ? "skipped" : "short";
      out[i].note = out[i].stay === 0 ? "時間調整のためカット" : `${cut}分短縮`;
      act[id] = out[i].stay === 0 ? `${STOPS[i].name}をカット` : `${STOPS[i].name}を${cut}分短縮`;
    }
  }
  // 時刻を順に計算し直して、閉まる時間などを確認する
  let t = arrivals[STOPS[k].id];
  for (let i = k; i < STOPS.length; i++) {
    const o = out[i];
    if (i > k) o.time = Math.max(t, STOPS[i].arr);
    if (arrivals[o.id] != null) o.time = arrivals[o.id];
    if (o.id === "cafe" && o.time > 960) { o.stay = 0; o.status = "skipped"; o.note = "閉店時間を過ぎるのでカット"; act.cafe = "カフェをカット"; }
    if (o.id === "hiyoshi") {
      const max = 960 - o.time;
      if (max < 20) { o.stay = 0; o.status = "skipped"; o.note = "拝観終了（16:00）に間に合わないのでカット"; act.hiyoshi = "日吉大社をカット"; }
      else if (o.stay > max) { o.stay = max; o.status = "short"; o.note = "16:00の拝観終了まで"; }
    }
    if (o.id === "shira" && o.time > 1015) { o.stay = Math.min(o.stay, 5); o.status = "window"; o.note = "日の入り後なので車窓から鳥居を"; act.shira = "白鬚神社は車窓から"; }
    if (o.id === "yume") {
      if (o.time > 1230) { o.stay = 0; o.status = "skipped"; o.note = "ライトアップ終了に間に合わないのでカット"; act.yume = "夢見が丘をカット"; }
      else o.stay = Math.min(o.stay, 1260 - o.time);
    }
    t = o.time + o.stay + STOPS[i].travel;
  }
  const actions = Object.values(act);
  const late = out[out.length - 1].time - STOPS[STOPS.length - 1].arr;
  let summary = "";
  if (delay >= 10) summary = `約${delay}分の遅れ。${actions.length ? actions.join("、") + "で調整します。" : ""}${late > 5 ? `帰りは約${late}分遅くなりそうです。` : "このあとは予定どおりに戻せます。"}`;
  return { stops: out, delay, summary, actions };
}

export function scheduleText(c) {
  return c.stops.map((s) => `${hm(s.time)} ${s.name}${s.status === "skipped" ? "（カット）" : s.status === "window" ? "（車窓から）" : s.status === "short" ? `（${s.note}）` : ""}`).join("\n");
}
