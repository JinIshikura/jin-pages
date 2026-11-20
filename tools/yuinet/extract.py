"""Extract sections, figure regions and inline icons from the two 結ネット manuals (v2).

Outputs (in build/):
  raw.json        sections (paragraphs with inline icon tokens {i:ID}) + figure / icon metadata
  figs/*.png      figure crops (zoom 4)
  icons/*.png     inline icon crops (zoom 4)
  review/*.png    page renders with detected regions drawn on top
"""
import json, os, re
import pymupdf
from PIL import Image, ImageDraw

SRC = {"guide": "src/guide.pdf", "disaster": "src/disaster.pdf"}
PFX = {"guide": "g", "disaster": "d"}
OUT = "build"
for sub in ("figs", "icons", "review"):
    os.makedirs(f"{OUT}/{sub}", exist_ok=True)

FOOTER_Y = 780
GROW = 10.0
ZOOM_FIG = 4
ZOOM_ICON = 4

# page-specific fixes
OVERRIDES = {
    # flow chart of the whole disaster-mode procedure (vector drawing) -> two image-only figures
    "d03": {"image_regions": [[48, 140, 566, 506], [48, 506, 566, 792]]},
    # QR code for the official install page (vector drawing)
    "g02": {"image_regions": [[103, 180, 186, 263]]},
}


def R(b):
    return pymupdf.Rect(b)


def near(a, b, d):
    return not (a.x1 + d < b.x0 or b.x1 + d < a.x0 or a.y1 + d < b.y0 or b.y1 + d < a.y0)


def classify_heading(s):
    sz, col, t = s["size"], s["color"], s["text"].strip()
    if 21 <= sz < 23 and col == 0xFFFFFF and t in ("Q", "A"):
        return "qa:" + t
    if "Rodin" not in s["font"]:
        return None
    if sz >= 27 and col == 0xFFFFFF:
        return "h1"
    if 19 <= sz < 21 and col == 0x231F20:
        return "h2"
    if 14 <= sz < 16 and col == 0xFFFFFF:
        return "h3"
    if 21 <= sz < 23 and col == 0xFFFFFF and t in ("Q", "A"):
        return "qa:" + t
    return None


def is_callout(s):
    return "Rodin" in s["font"] and 8 <= s["size"] <= 10.5 and s["color"] == 0xFFFFFF and s["text"].strip().isdigit()


def split_tall(reg, elems, lines_all):
    """Split a tall single-column region at gaps between content clusters."""
    if reg.height <= 460 or reg.width > 230:
        return [reg]
    ys = sorted((e.y0, e.y1) for e in elems if reg.intersects(e))
    clusters = []
    for y0, y1 in ys:
        if clusters and y0 <= clusters[-1][1] + 6:
            clusters[-1][1] = max(clusters[-1][1], y1)
        else:
            clusters.append([y0, y1])
    if len(clusters) < 2:
        return [reg]
    cuts = []
    for a, b in zip(clusters, clusters[1:]):
        lo, hi = a[1], b[0]
        best, bestc = (lo + hi) / 2, 10 ** 9
        y = lo
        while y <= hi:
            c = sum(1 for r in lines_all if r.y0 < y < r.y1 and reg.intersects(r))
            score = c * 100 + abs(y - (lo + hi) / 2)
            if score < bestc:
                best, bestc = y, score
            y += 1
        cuts.append(best)
    bounds = [reg.y0] + cuts + [reg.y1]
    parts = [[bounds[i], bounds[i + 1]] for i in range(len(bounds) - 1)]
    changed = True
    while changed and len(parts) > 1:
        changed = False
        for i, (a, b) in enumerate(parts):
            if b - a < 120:
                if i == 0:
                    parts[1][0] = a
                elif i == len(parts) - 1 or (parts[i - 1][1] - parts[i - 1][0]) <= (parts[i + 1][1] - parts[i + 1][0]):
                    parts[i - 1][1] = b
                else:
                    parts[i + 1][0] = a
                parts.pop(i)
                changed = True
                break
    return [pymupdf.Rect(reg.x0, a, reg.x1, b) for a, b in parts]


def page_items(doc, name, pno):
    page = doc[pno]
    key = f"{PFX[name]}{pno+1:02d}"
    ov = OVERRIDES.get(key, {})
    d = page.get_text("dict")
    spans = []
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            for s in l["spans"]:
                if s["text"].strip():
                    spans.append({"bbox": R(s["bbox"]), "size": s["size"], "font": s["font"],
                                  "color": s["color"], "text": s["text"]})
    ded = []
    for s in spans:
        if any(t["text"] == s["text"] and abs(t["bbox"].x0 - s["bbox"].x0) < 1.5 and abs(t["bbox"].y0 - s["bbox"].y0) < 1.5 for t in ded):
            continue
        ded.append(s)
    spans = ded
    heads = []
    for s in spans:
        h = classify_heading(s)
        if h:
            s["head"] = h
            heads.append(s)
    head_rects = [s["bbox"] for s in heads]

    imgs = []
    for inf in page.get_image_info(xrefs=True):
        r = R(inf["bbox"])
        if r.width < 4 or r.height < 4 or r.y0 > FOOTER_Y:
            continue
        imgs.append((r, inf.get("xref", 0)))

    big = lambda r: r.width >= 60 and r.height >= 40
    seeds = [r for r, _ in imgs if big(r)] if key not in ("g01", "d01") else []
    raster_seeds = list(seeds)
    for s in spans:
        if s.get("head") or s["size"] >= 8.0 or s["bbox"].y0 > FOOTER_Y:
            continue
        cx = (s["bbox"].x0 + s["bbox"].x1) / 2
        if any(r.x0 - 10 <= cx <= r.x1 + 25 for r in raster_seeds):
            seeds.append(R(s["bbox"]))

    draws = [dr["rect"] for dr in page.get_drawings() if dr["rect"].y0 <= FOOTER_Y]
    cands = []
    for r in draws:
        if r.width > 250 or r.height > 320:
            continue
        if any(r.intersects(h) for h in head_rects):
            continue
        cands.append(r)
    for s in spans:
        if not s.get("head") and s["size"] < 9.6:
            cands.append(s["bbox"])
    for r, _ in imgs:
        if not big(r):
            cands.append(r)

    regions = [pymupdf.Rect(r) for r in seeds]
    used = [False] * len(cands)
    changed = True
    while changed:
        changed = False
        for i, c in enumerate(cands):
            if used[i]:
                continue
            for j in range(len(regions)):
                if near(regions[j], c, GROW):
                    regions[j] = pymupdf.Rect(regions[j]) | c
                    used[i] = True
                    changed = True
                    break
        merged = []
        for reg in regions:
            for k in range(len(merged)):
                if near(merged[k], reg, 2):
                    merged[k] = pymupdf.Rect(merged[k]) | reg
                    break
            else:
                merged.append(pymupdf.Rect(reg))
        if len(merged) != len(regions):
            changed = True
        regions = merged
    regions = [r for r in regions if r.width >= 40 and r.height >= 30]

    elems = list(raster_seeds) + [R(s["bbox"]) for s in spans if s["size"] < 8.0] + \
        [r for r in draws if min(r.width, r.height) >= 14 and r.width < 250]
    out = []
    for reg in regions:
        out.extend(split_tall(reg, elems, draws + [r for r, _ in imgs]))
    regions = out

    def in_region(r, pad=1.5):
        c = pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
        return any(pymupdf.Rect(g.x0 - pad, g.y0 - pad, g.x1 + pad, g.y1 + pad).contains(c) for g in regions)

    icons = [(r, x) for r, x in imgs if not big(r) and not in_region(r)] if key not in ("g01", "d01") else []

    fig_regions = regions + [pymupdf.Rect(x) for x in ov.get("image_regions", [])]
    fig_regions.sort(key=lambda r: (round(r.y0 / 20), r.x0))
    reg_steps = []
    for g in fig_regions:
        reg_steps.append(sorted({int(s["text"].strip()) for s in spans if is_callout(s) and g.contains(s["bbox"])}))

    body = []
    for s in spans:
        r = s["bbox"]
        if r.y0 > FOOTER_Y:
            continue
        h = s.get("head")
        if h == "qa:A":
            body.append({**s, "text": "Ａ", "color": 0x231F20})
            continue
        if h == "qa:Q":
            continue
        if h or ("Rodin" in s["font"] and s["size"] >= 12) or is_callout(s) or s["size"] < 8.0:
            continue
        body.append(s)
    return page, key, [h for h in heads if h["head"] in ("h1", "h2", "h3", "qa:Q")], fig_regions, reg_steps, icons, body


def build_lines(body, icons, icon_ids):
    toks = []
    for s in body:
        t = s["text"].replace("\t", " ")
        if s["color"] == 0xFFFFFF and t.strip():
            t = "「" + re.sub(r"[ \u3000]", "", t.strip()) + "」"
        toks.append({"r": s["bbox"], "t": t, "size": s["size"], "icon": False})
    for (r, _), iid in zip(icons, icon_ids):
        toks.append({"r": r, "t": "{i:%s}" % iid, "size": 0, "icon": True})
    toks.sort(key=lambda k: ((k["r"].y0 + k["r"].y1) / 2, k["r"].x0))
    bands = []
    for k in toks:
        cy = (k["r"].y0 + k["r"].y1) / 2
        if bands and abs(bands[-1]["cy"] - cy) < 5.5:
            bands[-1]["toks"].append(k)
        else:
            bands.append({"cy": cy, "toks": [k]})
    out = []
    for b in bands:
        ts = sorted(b["toks"], key=lambda k: k["r"].x0)
        segs = [[ts[0]]]
        for k in ts[1:]:
            if k["r"].x0 - segs[-1][-1]["r"].x1 > 80:
                segs.append([k])
            else:
                segs[-1].append(k)
        for sg in segs:
            txt, gap_flag = "", False
            for i, k in enumerate(sg):
                if i:
                    gap = k["r"].x0 - sg[i - 1]["r"].x1
                    if gap > 9 and not k["icon"] and not sg[i - 1]["icon"] and not k["t"].startswith("「") and not sg[i - 1]["t"].endswith("」"):
                        txt += "　"
                        gap_flag = True
                txt += k["t"]
            txt = re.sub(r"[ ]+", " ", txt).strip()
            if txt:
                size = max([k["size"] for k in sg] + [0]) or 11
                out.append({"x0": sg[0]["r"].x0, "x1": sg[-1]["r"].x1, "cy": b["cy"], "size": size,
                            "text": txt, "gap": gap_flag})
    out.sort(key=lambda l: (l["cy"], l["x0"]))
    return out


MARK = re.compile(r"^([①-⑳❶-❿＊\*・•◆■□▼●]|\d+[）\)]|＜|【|Ｑ|Ａ|※|［)")


def join_lines(lines):
    paras = []
    prev = None
    for l in lines:
        t = l["text"]
        new = True
        if prev is not None and not MARK.match(t) and not l.get("gap") and not prev.get("gap"):
            gap = l["cy"] - prev["cy"]
            if 0 < gap < max(l["size"], 10) * 2.05 and l["x0"] > prev["x0"] - 14 and abs(l["x0"] - prev["x0"]) < 120:
                new = False
        if new or not paras:
            paras.append(t)
        else:
            a = paras[-1]
            sep = " " if (re.match(r"[A-Za-z0-9]", a[-1]) and re.match(r"[A-Za-z0-9]", t[0])) else ""
            paras[-1] = a + sep + t
        prev = l
    return paras


def main():
    sections, figs, icon_meta = [], {}, {}
    for name in ("guide", "disaster"):
        doc = pymupdf.open(SRC[name])
        cur = {"h1": "", "h2": "", "h3": ""}
        sec = None
        for pno in range(1, doc.page_count):
            page, key, heads, regions, reg_steps, icons, body = page_items(doc, name, pno)
            icon_ids = []
            for i, (r, xref) in enumerate(icons):
                iid = f"{key}i{i+1}"
                icon_ids.append(iid)
                pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM_ICON, ZOOM_ICON), clip=r, alpha=False)
                pix.save(f"{OUT}/icons/{iid}.png")
                icon_meta[iid] = {"page": key, "w": round(r.width, 1), "h": round(r.height, 1), "xref": xref}
            lines = build_lines(body, icons, icon_ids)
            events = []
            for h in heads:
                events.append((h["bbox"].y0 - 0.5, h["bbox"].x0, "head", h))
            for i, (g, st) in enumerate(zip(regions, reg_steps)):
                events.append((g.y0, g.x0, "fig", (f"{key}f{i+1}", g, st)))
            for l in lines:
                events.append((l["cy"], l["x0"], "line", l))
            events.sort(key=lambda e: (e[0], e[1]))
            for y, x, kind, obj in events:
                if kind == "head":
                    lvl, t = obj["head"], obj["text"].strip()
                    if lvl == "h1":
                        cur = {"h1": t, "h2": "", "h3": ""}
                    elif lvl == "h2":
                        cur = {"h1": cur["h1"], "h2": t, "h3": ""}
                    elif lvl == "qa:Q":
                        cur = {"h1": cur["h1"], "h2": "Q", "h3": ""}
                    else:
                        cur = {"h1": cur["h1"], "h2": cur["h2"], "h3": t}
                    sec = {"doc": name, **cur, "page_start": pno + 1, "page_end": pno + 1,
                           "lines": [], "figs": [], "y": round(y)}
                    sections.append(sec)
                elif sec is None:
                    continue
                elif kind == "fig":
                    fid, g, st = obj
                    clip = pymupdf.Rect(g.x0 - 3, g.y0 - 3, g.x1 + 3, g.y1 + 3) & page.rect
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM_FIG, ZOOM_FIG), clip=clip, alpha=False)
                    pix.save(f"{OUT}/figs/{fid}.png")
                    figs[fid] = {"page": pno + 1, "doc": name, "steps": st, "w": pix.width, "h": pix.height,
                                 "rect": [round(v, 1) for v in clip]}
                    sec["figs"].append(fid)
                    sec["page_end"] = pno + 1
                else:
                    sec["lines"].append(obj)
                    sec["page_end"] = max(sec["page_end"], pno + 1)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(1, 1), alpha=False)
            im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            dr = ImageDraw.Draw(im)
            for g in regions:
                dr.rectangle([g.x0 - 3, g.y0 - 3, g.x1 + 3, g.y1 + 3], outline=(230, 0, 0), width=2)
            for r, _ in icons:
                dr.rectangle([r.x0, r.y0, r.x1, r.y1], outline=(0, 90, 255), width=2)
            for h in heads:
                dr.line([30, h["bbox"].y0 - 2, 565, h["bbox"].y0 - 2], fill=(0, 170, 0), width=2)
            im.save(f"{OUT}/review/{key}.png")
    out = []
    for s in sections:
        s2 = {k: v for k, v in s.items() if k != "lines"}
        s2["paras"] = join_lines(s["lines"])
        out.append(s2)
    json.dump({"sections": out, "figs": figs, "icons": icon_meta}, open(f"{OUT}/raw.json", "w"),
              ensure_ascii=False, indent=1)
    print("sections", len(out), "figs", len(figs), "icons", len(icon_meta))


if __name__ == "__main__":
    main()
