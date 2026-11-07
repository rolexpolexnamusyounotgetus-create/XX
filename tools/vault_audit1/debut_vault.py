#!/usr/bin/env python3
"""VAULT AUDIT 1 (auditor only): the debut METHOD model (src/ml/debut.js, data/derived/debut.json production coefficients,
refit 2012-2025) on the 2026 bouts with a UFC debutant, against the division base rates it replaced (descriptive side line).

    nice -n 5 python3 tools/vault_audit1/debut_vault.py [--vault <dir>]

Universe: every decisive UFC bout dated 2026-01-01..2026-10-31 (ufcstats, tools/build_db.py parse) where at least one man has
0 prior UFC bouts. backtest_vault.json holds none of these (it requires a prior UFC bout on both sides), and the vault's market
files cover only backtest fights, so the winner input is the forward ledger's no-line fallback: preufc_vault.json
p_seeded_elo (seeded Elo, fits on 2015-2023). Side columns, built the way the ledger's debut path needs them
(src/ml/debut.js methodSide): _n (prior UFC bouts), debut, pav (1 when preufc.json holds the side's pre-bout Sherdog snapshot),
pre_ko / pre_sub / pre_kol / pre_subl (tools/preufc.py side_pre on that snapshot), uko_w / usub_w / uko_l / usub_l (UFC KO / SUB
wins and losses before the bout, walk-forward). Approximation: debut.py's frame sets pav from its own resolver; here pav comes
from preufc.json's snapshot index (the same Sherdog pages). Base rates = debut.json model.live_division_base (2021-2025).
Scores: method given the actual winner (the adopted use: the winner comes from elsewhere) and the marginal KO / SUB / DEC with
pW; event-cluster bootstrap (2,000). Output <vault>/audit1/debut_vault.json."""
import argparse, json, math, os, subprocess, sys, tempfile
from collections import defaultdict
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_db as B  # noqa: E402
import preufc as PU  # noqa: E402
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
a = ap.parse_args()
AUD = os.path.join(a.vault, "audit1")
lg = {}
fights, _ = B.parse_fights(lg)
fights = [f for f in fights if f.date.isoformat() < "2026-11-01"]
people = B.build_people(fights, lg)
slug = {p: (P.get("slug") or p) for p, P in people.items()}
PJ = json.load(open(os.path.join(ROOT, "data", "derived", "preufc.json")))
cols = PJ["meta"]["snapshot_columns"]
ci = {c: k for k, c in enumerate(cols)}
snaps = {}
for s_, rec in PJ["fighters"].items():
    for row in rec.get("snapshots") or []:
        snaps[(row[ci["fid"]], s_)] = {c: row[ci[c]] for c in cols}
SEED = json.load(open(os.path.join(a.vault, "preufc_vault.json")))["seeded_elo_all_bouts"]
cnt = defaultdict(lambda: {"n": 0, "ko_w": 0, "sub_w": 0, "ko_l": 0, "sub_l": 0})
rows = []
for f in fights:
    pa, pb = f.persons
    if pa == pb:
        continue
    if f.date.isoformat() >= "2026-01-01" and (cnt[pa]["n"] == 0 or cnt[pb]["n"] == 0) and f.winner in ("A", "B") and f.cat in ("ko", "sub", "dec"):
        sides = []
        for p in (pa, pb):
            c = cnt[p]
            sn = snaps.get((f.fid, slug.get(p, p)))
            sp = PU.side_pre(sn, c["n"]) if sn else None
            s = {"_n": c["n"], "debut": 1 if c["n"] == 0 else 0, "pav": 1 if sp else 0,
                 "uko_w": c["ko_w"], "usub_w": c["sub_w"], "uko_l": c["ko_l"], "usub_l": c["sub_l"]}
            if sp:
                for k in ("pre_ko", "pre_sub", "pre_kol", "pre_subl"):
                    s[k] = sp[k]
            sides.append(s)
        rows.append({"id": f.fid, "date": f.date.isoformat(), "event": f.event, "division": f.division, "rounds": f.sched,
                     "winner": f.winner, "cls": f.cat, "pW": SEED.get(f.fid), "A": sides[0], "B": sides[1]})
    for s, p in ((0, pa), (1, pb)):
        c = cnt[p]
        won, lost = f.winner == ("A" if s == 0 else "B"), f.winner == ("B" if s == 0 else "A")
        if won and f.cat == "ko":
            c["ko_w"] += 1
        if won and f.cat == "sub":
            c["sub_w"] += 1
        if lost and f.cat == "ko":
            c["ko_l"] += 1
        if lost and f.cat == "sub":
            c["sub_l"] += 1
        c["n"] += 1
rows = [r for r in rows if isinstance(r["pW"], (int, float))]
js = r"""
const fs = require("fs"); const D = require(process.argv[2] + "/src/ml/debut.js");
const DJ = JSON.parse(fs.readFileSync(process.argv[2] + "/data/derived/debut.json", "utf8")); const M = D.load(DJ.model);
const rows = JSON.parse(fs.readFileSync(process.argv[3], "utf8")); const out = [];
for (const r of rows) { const m = M.method(r.A, r.B, { division: r.division, rounds: r.rounds, pA: r.pW });
  const base = DJ.model.live_division_base[r.division] || DJ.model.live_division_base._all; out.push({ id: r.id, A: m.A, B: m.B, base }); }
process.stdout.write(JSON.stringify(out));
"""
with tempfile.TemporaryDirectory() as td:
    jf, rf = os.path.join(td, "m.js"), os.path.join(td, "rows.json")
    open(jf, "w").write(js)
    json.dump(rows, open(rf, "w"))
    res = json.loads(subprocess.check_output(["node", jf, ROOT, rf]))
K = {"ko": 0, "sub": 1, "dec": 2}
L = {"debut_mgw": [], "base_mgw": [], "debut_marg": [], "base_marg": []}
ev = []
for r, m in zip(rows, res):
    k = K[r["cls"]]
    w = m["A"] if r["winner"] == "A" else m["B"]
    L["debut_mgw"].append(-math.log(w[k]))
    L["base_mgw"].append(-math.log(m["base"][k]))
    pa = r["pW"]
    marg = [pa * m["A"][c] + (1 - pa) * m["B"][c] for c in range(3)]
    L["debut_marg"].append(-math.log(marg[k]))
    L["base_marg"].append(-math.log(m["base"][k]))
    ev.append(r["event"] + "|" + r["date"])
evs = sorted(set(ev))
gi = np.array([evs.index(e) for e in ev])
rng = np.random.default_rng(20261107)
Lv = {k: np.array(v) for k, v in L.items()}


def boot(x):
    out = []
    for _ in range(2000):
        g = rng.integers(0, len(evs), len(evs))
        w = np.bincount(g, minlength=len(evs))[gi]
        out.append((w * x).sum() / w.sum())
    out = np.sort(out)
    return [float(out[50]), float(out[1949])]


summ = {"n_bouts": len(rows), "n_events": len(evs), "n_debut_sides": int(sum(r["A"]["debut"] + r["B"]["debut"] for r in rows)),
        "pav_share": float(np.mean([s["pav"] for r in rows for s in (r["A"], r["B"]) if s["debut"]])),
        "actual": {c: float(np.mean([r["cls"] == c for r in rows])) for c in K},
        "predicted_marginal_debut": {c: float(np.mean([rr[0] for rr in [[p["pW"] * m["A"][K[c]] + (1 - p["pW"]) * m["B"][K[c]]] for p, m in zip(rows, res)]])) for c in K},
        "predicted_base": {c: float(np.mean([m["base"][K[c]] for m in res])) for c in K}}
for k, v in Lv.items():
    summ[k] = {"est": float(v.mean()), "ci": boot(v)}
for a_, b_ in (("debut_mgw", "base_mgw"), ("debut_marg", "base_marg")):
    d = Lv[a_] - Lv[b_]
    summ[a_ + " - " + b_] = {"diff": float(d.mean()), "ci": boot(d)}
json.dump({"meta": {"tool": "tools/vault_audit1/debut_vault.py"}, "summary": summ, "rows": rows}, open(os.path.join(AUD, "debut_vault.json"), "w"))
print(json.dumps(summ, indent=1))
