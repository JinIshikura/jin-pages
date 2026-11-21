"""Extract the web admin manuals (heading-based, like the user guide) and the update notes (page-based)."""
import json, os, re
import pymupdf
from PIL import Image
import extract as E

ADMIN = {
    "w1": ("src2/yuinetweb-manual-admin-01.pdf", "Web版マニュアル 導入編", "Ver.6.3.0（2023年4月）"),
    "w2": ("src2/yuinetweb-manual-admin-02.pdf", "Web版マニュアル 記事作成（一般記事）編", "Ver.6.3.0（2023年4月）"),
    "w3": ("src2/yuinetweb-manual-admin-03.pdf", "Web版マニュアル 記事作成（総会型）編", "Ver.6.3.0（2023年4月）"),
    "w4": ("src2/yuinetweb-manual-admin-04.pdf", "Web版マニュアル 記事作成（掲示板型）編", "Ver.6.3.0（2023年4月）"),
    "w5": ("src2/yuinetweb-manual-admin-05.pdf", "Web版マニュアル 設定編", "Ver.7.0.0（2023年10月）"),
}
UPD = {
    "u910": ("src2/yuinet_update_v9_1_0.pdf", "Ver.9.1.0", "2026年11月"),
    "u900": ("src2/yuinet_update_v9_0_0.pdf", "Ver.9.0.0", "2026年2月"),
    "u810": ("src2/yuinet_update_v8_1_0.pdf", "Ver.8.1.0", "2025年5月"),
    "u800": ("src2/yuinet_update_v8_0_0.pdf", "Ver.8.0.0", "2024年9月"),
    "u710": ("src2/yuinet_update_v7_1_0.pdf", "Ver.7.1.0", "2024年3月"),
    "u700": ("src2/yuinet_update_v7_0_0.pdf", "Ver.7.0.0", "2023年9月"),
    "u630": ("src2/yuinet_update_v6_3_0.pdf", "Ver.6.3.0", "2023年4月"),
}
OUT = "build2"
for sub in ("figs", "icons", "review", "pages"):
    os.makedirs(f"{OUT}/{sub}", exist_ok=True)

# ---- admin manuals: same pipeline as the user guide ----
E.SRC = {k: v[0] for k, v in ADMIN.items()}
E.PFX = {k: k for k in ADMIN}
E.OUT = OUT
E.OVERRIDES = {}
E.main()
raw = json.load(open(f"{OUT}/raw.json"))

# sections with ids (merge rules as in sections.py)
S = raw["sections"]
tl = lambda s: len("".join(s["paras"]))
out, pending = [], []
for i, s in enumerate(S):
    n = tl(s)
    if n < 5 and not s["figs"]:
        continue
    if not s["figs"] and n < 120 and i + 1 < len(S) and S[i + 1]["doc"] == s["doc"] and (not s["h3"]):
        pending.append(s); continue
    if pending:
        pre = []
        for p in pending: pre.extend(p["paras"])
        s["paras"] = pre + s["paras"]
        s["page_start"] = min([p["page_start"] for p in pending] + [s["page_start"]])
        pending = []
    out.append(s)
used = {}
admin_secs = []
for s in out:
    base = f"{s['doc']}{s['page_start']:02d}"
    k = used.get(base, 0); used[base] = k + 1
    title = s["h3"] or s["h2"] or s["h1"]
    crumbs = [x for x in (s["h1"], s["h2"], s["h3"]) if x and x != "Q"]
    admin_secs.append({"id": base + "abcdefghij"[k], "doc": s["doc"], "p": [s["page_start"], s["page_end"]],
                       "title": title, "crumb": " ＞ ".join(crumbs), "paras": s["paras"], "figs": s["figs"]})

# ---- update notes: one section per page ----
def upd_heading(s):
    sz, col, t = s["size"], s["color"], s["text"].strip()
    if col == 0xFFFFFF and sz >= 14:
        return "skip"          # header band (結ネット Ver.x)
    if 13.5 <= sz <= 14.5 and col == 0x000000:
        return "skip"          # feature title, used as section title
    return None
E.classify_heading = upd_heading
upd_secs, upd_figs, upd_icons = [], {}, {}
for key, (path, ver, date) in UPD.items():
    doc = pymupdf.open(path)
    for pno in range(doc.page_count):
        page = doc[pno]
        d = page.get_text("dict")
        titles, names = [], []
        for b in d["blocks"]:
            for l in b.get("lines", []):
                for sp in l["spans"]:
                    t = sp["text"].strip()
                    if t and 13.5 <= sp["size"] <= 14.5 and sp["color"] == 0x000000:
                        titles.append((sp["bbox"][1], t))
        titles.sort()
        E.PFX = {key: key}
        page_, k2, heads, regions, steps, icons, body = E.page_items(doc, key, pno)
        icon_ids = []
        for i, (r, xref) in enumerate(icons):
            iid = f"{key}p{pno+1:02d}i{i+1}"
            icon_ids.append(iid)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(4, 4), clip=r, alpha=False)
            pix.save(f"{OUT}/icons/{iid}.png")
            upd_icons[iid] = {"w": round(r.width, 1), "h": round(r.height, 1), "xref": xref}
        lines = E.build_lines(body, icons, icon_ids)
        paras = E.join_lines(lines)
        paras = [p for p in paras if not re.fullmatch(r"[－\-–]\s*\d+\s*[－\-–]", p) and not p.startswith("提供日")]
        merged = []
        for _, t in titles:
            if merged and len(merged[-1]) < 40 and not merged[-1].endswith("。"):
                pass
            merged.append(t)
        title = "／".join(dict.fromkeys(merged)) or (paras[0][:30] if paras else f"{ver} の変更")
        fid = f"{key}p{pno+1:02d}"
        pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        im.save(f"{OUT}/pages/{fid}.png")
        upd_figs[fid] = {"page": pno + 1, "doc": key, "steps": [], "w": pix.width, "h": pix.height, "pagefig": True}
        upd_secs.append({"id": fid, "doc": key, "p": [pno + 1, pno + 1], "title": f"{ver}：{title}",
                         "crumb": f"更新内容 {ver}（{date}）", "paras": paras, "figs": [fid]})

json.dump({"admin": admin_secs, "upd": upd_secs, "figs": raw["figs"], "icons": raw["icons"],
           "upd_figs": upd_figs, "upd_icons": upd_icons,
           "docs": {**{k: {"name": v[1], "ver": v[2]} for k, v in ADMIN.items()},
                    **{k: {"name": f"更新内容 {v[1]}", "ver": v[2]} for k, v in UPD.items()}}},
          open(f"{OUT}/extra.json", "w"), ensure_ascii=False, indent=1)
print("admin sections", len(admin_secs), "admin figs", len(raw["figs"]), "update pages", len(upd_secs))
