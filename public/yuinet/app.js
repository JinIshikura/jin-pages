/* 結ネット 使い方サポート — chat UI (works with or without the AI endpoint) */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const log = $("#log");
  const input = $("#q");
  const API = "api/ask";
  let KB = null;
  const SEC = {};
  let ORDER = [];
  const ICON_BY_LABEL = {};
  let aiState = "unknown"; // on | off | unknown
  const chatHist = [];     // last answers for follow-up questions
  let busy = false;

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const pageLabel = (s) => s.doc === "support" ? KB.docs[s.doc].name : KB.docs[s.doc].name + " P." + s.p[0] + (s.p[1] !== s.p[0] ? "–" + s.p[1] : "");
  const pageKey = (doc, pg) => doc[0] + String(pg).padStart(2, "0");
  const circled = (n) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n));
  function scrollToEl(e) { setTimeout(() => e.scrollIntoView({ behavior: "smooth", block: "start" }), 30); }

  function iconHTML(id) {
    const ic = KB.icons[id];
    if (!ic) return "";
    const wide = ic.w / ic.h > 2.2;
    return `<img class="ico${wide ? " btn" : ""}" src="i/${id}.webp" alt="${esc(ic.label || "アイコン")}" loading="lazy" decoding="async">`;
  }
  const richText = (t) => esc(t).replace(/\{i:([a-z0-9]+)\}/g, (_, id) => iconHTML(id));
  const labelIcons = (escaped) => escaped.replace(/［([^［］]{1,24})］/g, (all, label) => {
    const id = ICON_BY_LABEL[label];
    return id ? iconHTML(id) + all : all;
  });

  // ---------- text rendering ----------
  function parasHTML(paras, faq) {
    let h = "";
    for (const p of paras) {
      let m;
      if ((m = p.match(/^([①-⑳])\s*/))) h += `<div class="row"><span class="n">${m[1]}</span><span class="t">${richText(p.slice(m[0].length))}</span></div>`;
      else if ((m = p.match(/^(\d+）)\s*/))) h += `<div class="row"><span class="n">${m[1]}</span><span class="t">${richText(p.slice(m[0].length))}</span></div>`;
      else if (/^[＊*]/.test(p)) h += `<div class="ast">${richText(p.replace(/^[＊*]\s*/, "＊ "))}</div>`;
      else if (/^＜.*＞/.test(p)) h += `<div class="sub-h">${richText(p)}</div>`;
      else if (faq && /^[•・]/.test(p)) h += `<p><span class="qa">Q</span>${richText(p.replace(/^[•・]\s*/, ""))}</p>`;
      else if (faq && /^Ａ/.test(p)) h += `<p><span class="qa">A</span>${richText(p.replace(/^Ａ\s*/, ""))}</p>`;
      else h += `<p>${richText(p)}</p>`;
    }
    return h;
  }

  function aiHTML(text) {
    let h = "";
    for (const raw of String(text).split(/\n+/)) {
      const ln = raw.replace(/^[-・•]\s*(?=[①-⑳])/, "").trim();
      if (!ln) continue;
      const body = (s) => labelIcons(esc(s));
      let m;
      if ((m = ln.match(/^([①-⑳])\s*/))) h += `<div class="row"><span class="n">${m[1]}</span><span class="t">${body(ln.slice(m[0].length))}</span></div>`;
      else if ((m = ln.match(/^(\d{1,2})[.．）)]\s*/))) h += `<div class="row"><span class="n">${m[1]}.</span><span class="t">${body(ln.slice(m[0].length))}</span></div>`;
      else if (/^[＊*]/.test(ln)) h += `<div class="ast">${body(ln.replace(/^[＊*]\s*/, "＊ "))}</div>`;
      else if (/^【マニュアル外/.test(ln)) { const rest = ln.replace(/^【[^】]*】\s*/, ""); if (rest) h += `<p>${body(rest)}</p>`; }
      else if (/^(iPhone|Android|アンドロイド)(の場合)?[:：]?$/.test(ln)) h += `<div class="sub-h">${esc(ln)}</div>`;
      else h += `<p>${body(ln)}</p>`;
    }
    return h;
  }

  // ---------- figures ----------
  const groups = [];
  function reg(items, title) { groups.push({ items, title }); return groups.length - 1; }
  function stepsCap(st) {
    if (!st || !st.length) return "";
    if (st.length === 1) return "手順 " + circled(st[0]);
    const seq = st.every((v, i) => i === 0 || v === st[i - 1] + 1);
    return "手順 " + (seq ? circled(st[0]) + "〜" + circled(st[st.length - 1]) : st.map(circled).join(""));
  }
  function figsHTML(ids, g) {
    if (!ids || !ids.length) return "";
    const items = ids.map((id, i) => {
      const f = KB.figs[id];
      const wide = f.w / f.h > 0.95;
      const cap = stepsCap(f.st);
      return `<button class="fig ${wide ? "wide" : "tall"}" type="button" data-g="${g}" data-i="${i}" aria-label="画面図を拡大${cap ? "（" + cap + "）" : ""}">` +
        `<img src="f/${id}.webp" width="${f.w}" height="${f.h}" alt="マニュアルの画面図" loading="lazy" decoding="async">` +
        `<span class="cap">${cap || "画面図"}</span></button>`;
    }).join("");
    const hint = ids.length > 1 ? `← 横にスクロールできます（${ids.length}枚）・タップで拡大 →` : "タップで拡大";
    return `<div class="figs${ids.length === 1 ? " one" : ""}">${items}</div><div class="figs-count">${hint}</div>`;
  }

  // ---------- cards ----------
  function addMe(text) {
    const m = el("div", "me");
    m.textContent = text;
    log.appendChild(m);
    return m;
  }
  function badges(s) {
    return `<span class="badge src">${esc(pageLabel(s))}</span>` + (s.admin ? `<span class="badge adm">役員・管理者向け</span>` : "");
  }
  function relatedChips(s) {
    const cat = KB.cats.find((c) => c.id === s.cat);
    const list = cat ? cat.secs : ORDER;
    const i = list.indexOf(s.id);
    const out = [];
    const prev = SEC[list[i - 1]], next = SEC[list[i + 1]];
    if (prev) out.push(`<button class="chip" type="button" data-sec="${prev.id}">← ${esc(prev.title)}</button>`);
    if (next) out.push(`<button class="chip" type="button" data-sec="${next.id}">${esc(next.title)} →</button>`);
    return out.length ? `<p class="muted" style="margin:12px 0 0">同じ分野の前後の項目</p><div class="chips" style="margin-top:6px">${out.join("")}</div>` : "";
  }
  function sectionCard(s, lead) {
    const g = reg(s.figs.map((id) => ({ kind: "fig", id })), s.title);
    const faq = s.title.startsWith("Q ");
    const c = el("div", "card");
    c.innerHTML =
      (lead ? `<p class="muted" style="margin:0 0 6px">${esc(lead)}</p>` : "") +
      `<h3>${esc(s.title)}</h3><div class="crumb">${badges(s)}<br>${esc(s.crumb)}</div>` +
      figsHTML(s.figs, g) +
      `<div class="ans manual">${parasHTML(s.paras, faq)}</div>` +
      (s.links ? `<div class="links">${s.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("<br>")}</div>` : "") +
      (s.doc === "support" ? "" : `<div class="acts"><button class="act" type="button" data-pages="${s.id}">マニュアルのページ全体を見る</button></div>`) +
      relatedChips(s) +
      `<p class="help">${esc(KB.help)}</p>`;
    return c;
  }
  function showSection(sid, label) {
    const s = SEC[sid];
    if (!s) return;
    const me = addMe(label || s.title);
    log.appendChild(sectionCard(s));
    scrollToEl(me);
  }
  function showCategory(cid) {
    const c = KB.cats.find((x) => x.id === cid);
    if (!c) return;
    const me = addMe(c.name);
    const card = el("div", "card");
    card.innerHTML = `<b>${esc(c.name)}</b>の項目です。見たいものを押してください。<div class="chips">` +
      c.secs.map((sid) => `<button class="chip" type="button" data-sec="${sid}">${esc(SEC[sid].title)}</button>`).join("") + `</div>`;
    log.appendChild(card);
    scrollToEl(me);
  }
  function catButtons() {
    return `<div class="cats">${KB.cats.map((c) => `<button class="cat" type="button" data-cat="${c.id}">${esc(c.name)}<small>${esc(c.desc)}</small></button>`).join("")}</div>`;
  }
  function welcome() {
    const c = el("div", "card");
    c.innerHTML =
      `<h2>結ネットの使い方をご案内します</h2>` +
      `<p class="lead">知りたいことを下の欄に入力するか、ボタンを押してください。</p>` +
      `<div class="chips">${KB.quick.map((x) => `<button class="chip" type="button" data-sec="${x.sec}">${esc(x.label)}</button>`).join("")}</div>` +
      `<hr class="sep"><b>分野から探す</b>${catButtons()}` +
      `<p class="note-ai" id="modeNote"></p>`;
    log.appendChild(c);
    updateModeNote();
  }
  function updateModeNote() {
    const n = $("#modeNote");
    if (!n) return;
    n.textContent = aiState === "off"
      ? "入力した言葉から、マニュアル（利用者ガイド・災害モードマニュアル）の項目を探して表示します。"
      : "文章で質問すると、AIがマニュアル（利用者ガイド・災害モードマニュアル）をもとに答えます。";
  }
  function addLoading() {
    const c = el("div", "card", `<span class="dots" aria-label="回答を作成中"><span></span><span></span><span></span></span> <span class="muted">回答を作成しています…</span>`);
    log.appendChild(c);
    return c;
  }

  // ---------- AI answer ----------
  function aiCard(res, q) {
    const c = el("div", "card");
    let h = (res.general ? `<p class="gen-note">マニュアル外の一般的な手順です。機種やOSによって画面が違うことがあります。</p>` : "") +
      `<div class="ans">${aiHTML(res.answer)}</div>`;
    let refs = (res.refs || []).filter((id) => SEC[id]);
    if (!refs.length) refs = search(q, 2).filter((r) => r.sc >= THRESH).map((r) => r.s.id);
    refs = refs.slice(0, 3);
    const stripAt = refs.findIndex((id) => SEC[id].figs.length);
    refs.forEach((rid, k) => {
      const s = SEC[rid];
      const g = reg(s.figs.map((id) => ({ kind: "fig", id })), s.title);
      h += `<div class="ref"><div class="ref-h"><b>${esc(s.title)}</b>${badges(s)}</div>` +
        (k === stripAt ? figsHTML(s.figs, g) : "") +
        (s.links ? `<div class="links">${s.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("<br>")}</div>` : "") +
        `<div class="acts">` +
        (k !== stripAt && s.figs.length ? `<button class="act" type="button" data-g-open="${g}">画面図を見る（${s.figs.length}枚）</button>` : "") +
        `<button class="act" type="button" data-sec="${s.id}">${s.doc === "support" ? "くわしく見る" : "マニュアルの説明を読む"}</button></div></div>`;
    });
    const next = (res.next || []).slice(0, 3);
    if (next.length) h += `<div class="chips">${next.map((t) => `<button class="chip" type="button" data-q="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
    h += `<p class="note-ai">AIがマニュアルをもとに作った回答です。画面図とあわせてご確認ください。</p><p class="help">${esc(KB.help)}</p>`;
    c.innerHTML = h;
    return c;
  }

  // ---------- keyword search (fallback, no AI) ----------
  const THRESH = 6;
  let IDX = null;
  function norm(s) {
    return String(s).normalize("NFKC").toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/\{i:[a-z0-9]+\}/g, "")
      .replace(/[\s　、。，．,.・「」『』（）()［］\[\]【】＜＞<>!?！？…:：;；\/／〜~＊*①-⑳→←]/g, "");
  }
  function bigrams(s) { const o = []; for (let i = 0; i < s.length - 1; i++) o.push(s.slice(i, i + 2)); return o; }
  function buildIndex() {
    const df = new Map();
    const docs = KB.secs.map((s) => {
      const vec = new Map();
      const add = (t, w) => { for (const b of bigrams(norm(t))) vec.set(b, (vec.get(b) || 0) + w); };
      add(s.title, 3); add(s.crumb, 1.5); add(s.kw, 3); add(s.paras.join(" "), 1);
      for (const b of vec.keys()) df.set(b, (df.get(b) || 0) + 1);
      const kws = s.kw.split(/\s+/).map(norm).filter((k) => k.length >= 2);
      kws.push(norm(s.title));
      return { s, vec, kws };
    });
    IDX = { df, docs, N: docs.length };
  }
  function search(q, n = 4) {
    if (!IDX) buildIndex();
    const nq = norm(q);
    if (nq.length < 2) return [];
    const qb = [...new Set(bigrams(nq))];
    const out = [];
    for (const d of IDX.docs) {
      let sc = 0;
      for (const b of qb) { const tf = d.vec.get(b); if (tf) sc += Math.log(1 + IDX.N / IDX.df.get(b)) * Math.log(1 + tf); }
      for (const k of d.kws) if (nq.includes(k)) sc += 2 + k.length * 0.9;
      if (sc > 0) out.push({ s: d.s, sc });
    }
    out.sort((a, b) => b.sc - a.sc);
    return out.slice(0, n);
  }
  function searchCard(q, results, note) {
    const hits = results.filter((r) => r.sc >= THRESH);
    if (!hits.length) {
      const c = el("div", "card");
      c.innerHTML = `<p>すみません。「${esc(q)}」に合う項目が見つかりませんでした。短い言葉にするか、分野から探してください。</p>` +
        (note ? `<p class="muted">${esc(note)}</p>` : "") + catButtons() + `<p class="help">${esc(KB.help)}</p>`;
      return c;
    }
    const c = sectionCard(hits[0].s, (note ? note + " " : "") + `「${q}」に近い項目です。`);
    const others = hits.slice(1, 4).filter((r) => r.sc >= hits[0].sc * 0.35);
    if (others.length) {
      const box = el("div", "", `<p class="muted" style="margin:12px 0 0">ほかの候補</p><div class="chips" style="margin-top:6px">${others.map((r) => `<button class="chip" type="button" data-sec="${r.s.id}">${esc(r.s.title)}</button>`).join("")}</div>`);
      c.insertBefore(box, c.querySelector(".help"));
    }
    return c;
  }

  // ---------- asking ----------
  async function callAI(q) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 35000);
    try {
      const r = await fetch(API, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ q, history: chatHist }), signal: ctl.signal,
      });
      const j = await r.json().catch(() => null);
      return j || { ok: false, reason: "http" + r.status };
    } catch (e) {
      return { ok: false, reason: "network" };
    } finally {
      clearTimeout(t);
    }
  }
  function setBusy(b) { busy = b; $("#send").disabled = b; }
  async function ask(q) {
    q = String(q || "").trim();
    if (!q || busy) return;
    const me = addMe(q);
    if (aiState === "off") {
      log.appendChild(searchCard(q, search(q)));
      scrollToEl(me);
      return;
    }
    const loading = addLoading();
    scrollToEl(me);
    setBusy(true);
    try {
      const res = await callAI(q);
      loading.remove();
      if (res && res.ok && res.answer) {
        chatHist.push({ q, a: String(res.answer).slice(0, 800) });
        while (chatHist.length > 2) chatHist.shift();
        log.appendChild(aiCard(res, q));
        scrollToEl(me);
      } else if (res && res.reason === "off_topic") {
        const c = el("div", "card", `<p style="margin:0">${esc(res.message || "このチャットでは、結ネットの使い方についての質問にだけお答えしています。")}</p>${catButtons()}`);
        log.appendChild(c);
        scrollToEl(me);
      } else {
        if (res && res.reason === "no_key") { aiState = "off"; updateModeNote(); }
        const note = res && res.reason === "busy" ? "いま混み合っているため、キーワードで探しました。" :
          (aiState === "off" ? "" : "AIが使えなかったため、キーワードで探しました。");
        log.appendChild(searchCard(q, search(q), note));
        scrollToEl(me);
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------- viewer ----------
  const V = { items: [], i: 0, title: "", page: false, zoom: 0 };
  const ZOOMS = [1, 1.5, 2, 3];
  let overlayOpen = null;
  function openOverlay(name) {
    if (!overlayOpen) history.pushState({ ov: name }, "");
    overlayOpen = name;
    document.body.style.overflow = "hidden";
  }
  function hideOverlays() {
    $("#viewer").hidden = true;
    $("#toc").hidden = true;
    overlayOpen = null;
    document.body.style.overflow = "";
  }
  function closeOverlay() { if (overlayOpen) history.back(); else hideOverlays(); }
  window.addEventListener("popstate", hideOverlays);

  function openViewer(items, i, title) {
    V.items = items; V.i = i; V.title = title; V.page = false; V.zoom = 0;
    $("#viewer").hidden = false;
    openOverlay("viewer");
    renderViewer();
  }
  function curInfo() {
    const it = V.items[V.i];
    if (it.kind === "fig") {
      const f = KB.figs[it.id];
      return { doc: f.doc, pg: f.pg, src: V.page ? `p/${pageKey(f.doc, f.pg)}.webp` : `f/${it.id}.webp`, wide: V.page || f.w / f.h > 0.95, fig: true };
    }
    return { doc: it.doc, pg: it.pg, src: `p/${pageKey(it.doc, it.pg)}.webp`, wide: true, fig: false };
  }
  function renderViewer() {
    const c = curInfo();
    const img = $("#vImg");
    img.src = c.src;
    img.alt = "マニュアルの画像";
    $("#vTitle").innerHTML = `${esc(V.title)}<small>${esc(KB.docs[c.doc].name)} P.${c.pg}${!c.fig || V.page ? "（ページ全体）" : ""}</small>`;
    $("#vCount").textContent = `${V.i + 1} / ${V.items.length}`;
    $("#vPrev").disabled = V.i === 0;
    $("#vNext").disabled = V.i === V.items.length - 1;
    const pb = $("#vPage");
    pb.hidden = !c.fig;
    pb.textContent = V.page ? "画面図にもどる" : "ページ全体を見る";
    applyZoom();
    $("#vBody").scrollTo(0, 0);
  }
  function applyZoom() {
    const c = curInfo();
    const avail = Math.max(200, $("#vBody").clientWidth - 24);
    const base = Math.min(avail, c.wide ? 980 : 520);
    $("#vImg").style.width = Math.round(base * ZOOMS[V.zoom]) + "px";
    $("#vOut").disabled = V.zoom === 0;
    $("#vIn").disabled = V.zoom === ZOOMS.length - 1;
  }
  $("#vClose").addEventListener("click", closeOverlay);
  $("#vPrev").addEventListener("click", () => { if (V.i > 0) { V.i--; V.page = false; V.zoom = 0; renderViewer(); } });
  $("#vNext").addEventListener("click", () => { if (V.i < V.items.length - 1) { V.i++; V.page = false; V.zoom = 0; renderViewer(); } });
  $("#vPage").addEventListener("click", () => { V.page = !V.page; V.zoom = 0; renderViewer(); });
  $("#vIn").addEventListener("click", () => { if (V.zoom < ZOOMS.length - 1) { V.zoom++; applyZoom(); } });
  $("#vOut").addEventListener("click", () => { if (V.zoom > 0) { V.zoom--; applyZoom(); } });
  window.addEventListener("resize", () => { if (!$("#viewer").hidden) applyZoom(); });

  function openPages(sid) {
    const s = SEC[sid];
    const items = [];
    for (let p = s.p[0]; p <= s.p[1]; p++) items.push({ kind: "page", doc: s.doc, pg: p });
    openViewer(items, 0, s.title);
  }

  // ---------- table of contents ----------
  function renderTOC() {
    let h = "";
    for (const c of KB.cats) {
      h += `<div class="toc-cat"><h3>${esc(c.name)}<small>${esc(c.desc)}</small></h3>`;
      for (const sid of c.secs) {
        const s = SEC[sid];
        h += `<button class="toc-item" type="button" data-toc="${sid}"><span>${esc(s.title)}</span><span class="pg">${s.doc === "support" ? "公式" : "P." + s.p[0]}</span></button>`;
      }
      h += `</div>`;
    }
    h += `<p class="toc-foot">出典：結ネット 利用者ガイド（${esc(KB.docs.guide.ver)}）、災害モードマニュアル（${esc(KB.docs.disaster.ver)}）。開発元：株式会社シーピーユー。アプリは現在Ver.9系のため、画面がマニュアルと違うことがあります。画面や表示は、お使いの端末や組織体によっても異なります。<br><a href="https://www.cpu-net.co.jp/product/yui-net/yui-support.html" target="_blank" rel="noopener">開発元サポートページ（最新のマニュアル・更新履歴）↗</a></p>`;
    $("#tocBody").innerHTML = h;
  }
  $("#tocBtn").addEventListener("click", () => { $("#toc").hidden = false; openOverlay("toc"); $("#toc").scrollTo(0, 0); });
  $("#tocClose").addEventListener("click", closeOverlay);
  $("#tocBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-toc]");
    if (!b) return;
    closeOverlay();
    setTimeout(() => showSection(b.dataset.toc), 60);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlayOpen) closeOverlay(); });

  // ---------- events ----------
  log.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || busy && t.dataset.q) return;
    if (t.dataset.g != null && t.classList.contains("fig")) {
      const g = groups[+t.dataset.g];
      openViewer(g.items, +t.dataset.i, g.title);
    } else if (t.dataset.gOpen != null) {
      const g = groups[+t.dataset.gOpen];
      openViewer(g.items, 0, g.title);
    } else if (t.dataset.sec) {
      showSection(t.dataset.sec, t.classList.contains("chip") ? t.textContent.replace(/^← |\s→$/g, "") : null);
    } else if (t.dataset.cat) {
      showCategory(t.dataset.cat);
    } else if (t.dataset.q) {
      ask(t.dataset.q);
    } else if (t.dataset.pages) {
      openPages(t.dataset.pages);
    }
  });
  $("#ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value;
    if (!q.trim() || busy) return;
    input.value = "";
    input.blur();
    ask(q);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) e.preventDefault();
  });

  window.yuiDebug = { search: (q) => search(q).map((r) => [r.s.id, r.s.title, Math.round(r.sc * 10) / 10]) };

  // ---------- start ----------
  fetch("kb.json?v=5").then((r) => r.json()).then((kb) => {
    KB = kb;
    ORDER = kb.secs.map((s) => s.id);
    for (const s of kb.secs) SEC[s.id] = s;
    for (const [id, ic] of Object.entries(kb.icons)) if (ic.label && !ICON_BY_LABEL[ic.label]) ICON_BY_LABEL[ic.label] = id;
    renderTOC();
    welcome();
    fetch(API, { method: "GET" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { aiState = j && j.ai ? "on" : "off"; updateModeNote(); })
      .catch(() => { aiState = "off"; updateModeNote(); });
  }).catch(() => {
    log.appendChild(el("div", "card", "読み込みに失敗しました。通信状態を確認して、ページを再読み込みしてください。"));
  });
})();
