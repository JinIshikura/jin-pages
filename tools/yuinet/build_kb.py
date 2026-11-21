"""Build public/yuinet/kb.json and the images (figures, inline icons, full pages)."""
import json, os, re, sys
import pymupdf
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import curate as C

OUT = sys.argv[1] if len(sys.argv) > 1 else "site/public/yuinet"
for sub in ("f", "i", "p"):
    os.makedirs(f"{OUT}/{sub}", exist_ok=True)

raw = json.load(open("build/raw.json"))
secs_in = json.load(open("build/sections.json"))
FIGS, ICONS = raw["figs"], raw["icons"]

TOKEN = re.compile(r"\{i:([a-z0-9]+)\}")
cat_of = {}
for c in C.CATS:
    for sid in c["secs"].split():
        cat_of[sid] = c["id"]

secs, used_figs, used_icons = [], [], set()
for s in secs_in:
    sid = s["id"]
    paras = C.PARA_OVERRIDES.get(sid, s["paras"])
    paras = [re.sub(r"\s+", " ", p).strip() for p in paras if p.strip()]
    def tidy(p):
        p = re.sub(r"」\s+(?=[^\sA-Za-z0-9「{])", "」", p)
        p = re.sub(r"(\{i:[a-z0-9]+\})\s+(?=[^\sA-Za-z0-9{（(])", r"\1", p)
        p = re.sub(r"(?<=[^\sA-Za-z0-9}、。])\s+(\{i:)", r"\1", p)
        return p
    paras = [tidy(p) for p in paras]
    for p in paras:
        for m in TOKEN.finditer(p):
            if m.group(1) not in ICONS:
                raise SystemExit(f"unknown icon {m.group(1)} in {sid}")
            used_icons.add(m.group(1))
    if sid not in cat_of:
        raise SystemExit(f"section {sid} has no category")
    item = {
        "id": sid, "doc": s["doc"], "p": C.PAGES.get(sid, [s["page_start"], s["page_end"]]),
        "title": C.TITLES.get(sid, s["title"]), "crumb": s["crumb"],
        "cat": cat_of[sid], "kw": C.KEYWORDS.get(sid, ""), "paras": paras, "figs": [f for f in s["figs"] if f not in C.DROP_FIGS],
    }
    if sid in C.ADMIN:
        item["admin"] = True
    if sid == "g02a":
        item["links"] = [{"label": "インストールページを開く（開発元の公式ページ）", "url": C.INSTALL_URL}]
    secs.append(item)
    used_figs.extend(f for f in s["figs"] if f not in C.DROP_FIGS)
for x in C.EXTRA_SECTIONS:
    secs.append(dict(x))
missing_kw = [s["id"] for s in secs if not s["kw"]]
if missing_kw:
    print("WARNING no keywords:", missing_kw)

# figures -> webp (max 1100 px wide)
figs = {}
for fid in used_figs:
    im = Image.open(f"build/figs/{fid}.png").convert("RGB")
    if im.width > 1100:
        h = round(im.height * 1100 / im.width)
        im = im.resize((1100, h), Image.LANCZOS)
    im.save(f"{OUT}/f/{fid}.webp", "WEBP", quality=80, method=6)
    meta = FIGS[fid]
    figs[fid] = {"w": im.width, "h": im.height, "st": meta["steps"], "pg": meta["page"], "doc": meta["doc"]}

# inline icons -> webp
icons = {}
for iid in sorted(used_icons):
    im = Image.open(f"build/icons/{iid}.png").convert("RGB")
    im.save(f"{OUT}/i/{iid}.webp", "WEBP", quality=88, method=6)
    meta = ICONS[iid]
    label = C.ICON_LABELS.get(meta["xref"], "")
    icons[iid] = {"w": im.width, "h": im.height, "label": label}
unlabeled = [k for k, v in icons.items() if not v["label"]]
if unlabeled:
    print("WARNING unlabeled icons:", unlabeled)

# full pages
for name, path in (("guide", "src/guide.pdf"), ("disaster", "src/disaster.pdf")):
    doc = pymupdf.open(path)
    for pno in range(doc.page_count):
        key = f"{name[0]}{pno+1:02d}"
        out = f"{OUT}/p/{key}.webp"
        if os.path.exists(out):
            continue
        pix = doc[pno].get_pixmap(matrix=pymupdf.Matrix(2, 2), alpha=False)
        Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(out, "WEBP", quality=72, method=6)

kb = {
    "updated": "2026-11-21",
    "docs": C.DOCS,
    "help": C.HELP_NOTE,
    "cats": [{"id": c["id"], "name": c["name"], "desc": c["desc"], "secs": c["secs"].split()} for c in C.CATS],
    "quick": [{"label": l, "sec": s} for l, s in C.QUICK],
    "secs": secs, "figs": figs, "icons": icons,
}
json.dump(kb, open(f"{OUT}/kb.json", "w"), ensure_ascii=False, separators=(",", ":"))

# AI context size estimate
def ai_text(s):
    body = "\n".join(TOKEN.sub(lambda m: "［" + (icons[m.group(1)]["label"] or "アイコン") + "］", p) for p in s["paras"])
    pg = "" if s["doc"] == "support" else f"P.{s['p'][0]}" + (f"-{s['p'][1]}" if s['p'][1] != s['p'][0] else "")
    return f"[{s['id']}] {C.DOCS[s['doc']]['name']} {pg} ／ {s['crumb']}（{s['title']}）\n{body}"
ctx = "\n\n".join(ai_text(s) for s in secs)
print("sections", len(secs), "figs", len(figs), "icons", len(icons), "ai_context_chars", len(ctx))
sz = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
print("output size MB", round(sz / 1e6, 1))
