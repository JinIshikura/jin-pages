"""Turn build/raw.json into an ordered list of final sections with stable ids (build/sections.json)."""
import json
raw = json.load(open("build/raw.json"))
S = raw["sections"]
DOCNAME = {"guide": "利用者ガイド", "disaster": "災害モードマニュアル"}

def textlen(s):
    return len("".join(s["paras"]))

# merge the two side-by-side headings on disaster p16
for i, s in enumerate(S):
    if s["doc"] == "disaster" and s["h3"] == "利用者識別アイコン" and textlen(s) == 0:
        nxt = S[i + 1]
        nxt["h3"] = "利用者識別アイコンとステータス"
        s["drop"] = True

out = []
pending = []   # short intros to prepend to the next section
for i, s in enumerate(S):
    if s.get("drop"):
        continue
    n = textlen(s)
    if n < 5 and not s["figs"]:
        continue
    if not s["figs"] and n < 120 and i + 1 < len(S) and S[i + 1]["doc"] == s["doc"]:
        pending.append(s)
        continue
    if pending:
        pre = []
        for p in pending:
            pre.extend(p["paras"])
        s["paras"] = pre + s["paras"]
        s["page_start"] = min([p["page_start"] for p in pending] + [s["page_start"]])
        pending = []
    out.append(s)

# ids
used = {}
for s in out:
    base = f"{s['doc'][0]}{s['page_start']:02d}"
    k = used.get(base, 0)
    used[base] = k + 1
    s["id"] = base + "abcdefgh"[k]
    s["title"] = s["h3"] or (s["h2"] if s["h2"] not in ("", "Q") else s["h1"])
    crumbs = [x for x in (s["h1"], s["h2"], s["h3"]) if x and x != "Q"]
    s["crumb"] = " ＞ ".join(crumbs)
    s["docname"] = DOCNAME[s["doc"]]
json.dump(out, open("build/sections.json", "w"), ensure_ascii=False, indent=1)
for s in out:
    pg = f"P.{s['page_start']}" + (f"-{s['page_end']}" if s['page_end'] != s['page_start'] else "")
    print(f"{s['id']} {pg:8s} {s['crumb']}  [{len(''.join(s['paras']))}字, 図{len(s['figs'])}]")
print(len(out))
