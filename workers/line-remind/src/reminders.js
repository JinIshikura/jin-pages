import { PAGE, hm } from "./schedule.js";
// リマインド。at:固定の時刻 / id+when("arr"|"dep")+off:予定に合わせて動く時刻
// text は関数で、組み直した予定(s)を受け取る。予定がカットされたときは送らない
export const REMINDERS = [
  { at: 480, text: () => `おはよう！今日は滋賀ドライブ\n9:00 ファミマ千里丘を出発です。\n予定はこちら：${PAGE}` },
  { at: 525, text: () => "そろそろ出発の準備を。\nETCカード・上着・スマホの充電器を確認してね。" },
  { id: "namiki", when: "arr", off: -15, text: () => "まもなくメタセコイア並木。\n車はマキノピックランドの無料駐車場へ。" },
  { id: "cafe", when: "arr", off: -5, text: () => "並木カフェでランチの時間。\nお昼どきは混むので早めに入ろう。" },
  { id: "cafe", when: "dep", off: -5, text: (s) => `${hm(s.dep)}に出発して坂本へ（南へ約1時間10分）。` },
  { id: "hiyoshi", when: "arr", off: -5, text: (s) => `日吉大社へ。拝観は16:00まで。${s.status === "short" ? `\n今日は${s.stay}分くらいで。` : ""}` },
  { id: "hiyoshi", when: "dep", off: -5, text: (s) => `${hm(s.dep)}に出発して白鬚神社へ。\n日の入りは17時前。国道は渡らずに。` },
  { id: "shira", when: "dep", off: -5, text: (s) => `${hm(s.dep)}ごろ夢見が丘へ出発。ライトアップは21:00まで。\n夜は冷えるので上着を忘れずに。` },
  { id: "yume", when: "dep", off: -5, text: (s) => `${hm(s.dep)}に下山して一乗寺で夕食。\nお店の候補はページの「夕食」の「楽しみ方」にあります。` },
];
