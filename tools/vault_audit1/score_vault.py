#!/usr/bin/env python3
"""VAULT AUDIT 1 (auditor only): score every frozen model on the sealed 2026 vault (373 fights, 2026-01-24..2026-10-31).

    nice -n 5 python3 tools/vault_audit1/score_vault.py [--vault <dir>] [--boot 2000]

Reads the per-fight outputs written by the other tools/vault_audit1 scripts (all under <vault>/audit1/) and the vault results
(<vault>/backtest_vault.json). Every probability is P(first-named fighter A); every model is corner-symmetric (swap -> 1 - p),
so both corner orders give the same log loss; calibration slopes are mirrored (both orientations, no intercept). Draws and
no-contests are excluded from winner metrics. CIs: 2,000 event-cluster resamples (cards drawn with replacement), the SAME draws
for every model, so paired differences are exact paired bootstraps. Method x round metrics use tools/methodround.py's own
per-fight losses (outcome_cells / per_fight_losses / expand_cells). Writes <vault>/audit1/score_vault.json and prints the
tables quoted in research/vault_audit_v5.md."""
import argparse, json, os, sys
import numpy as np
import pandas as pd
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
os.environ.setdefault("OMP_NUM_THREADS", "1")
import methodround as MR  # noqa: E402
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
ap.add_argument("--boot", type=int, default=2000)
a = ap.parse_args()
AUD = os.path.join(a.vault, "audit1")
J = lambda p: json.load(open(p))
BT = J(os.path.join(a.vault, "backtest_vault.json"))["fights"]
ids = [f["id"] for f in BT]
n = len(ids)
pos = {f: i for i, f in enumerate(ids)}
res = [f["result"] for f in BT]
win = np.array([{"A": 1.0, "B": 0.0}.get(r["winner"], np.nan) for r in res])
dec = ~np.isnan(win)
ev_key = [f["event"] + "|" + f["date"] for f in BT]
evs = sorted(set(ev_key))
ev_idx = np.array([evs.index(k) for k in ev_key])
G = len(evs)
rng = np.random.default_rng(20261107)
draws = rng.integers(0, G, size=(a.boot, G))
CNT = np.zeros((a.boot, n))
ev_members = [np.flatnonzero(ev_idx == g) for g in range(G)]
for b in range(a.boot):
    gc = np.bincount(draws[b], minlength=G)
    for g in np.flatnonzero(gc):
        CNT[b, ev_members[g]] += gc[g]


def ci(v):
    v = np.sort(v[np.isfinite(v)])
    return [float(v[int(0.025 * len(v))]), float(v[min(len(v) - 1, int(0.975 * len(v)))])]


def boot_mean(L):
    m = np.isfinite(L)
    Lz = np.where(m, L, 0.0)
    num, den = CNT @ Lz, CNT @ m.astype(float)
    return float(Lz.sum() / m.sum()), ci(num / np.maximum(den, 1e-12)), int(m.sum())


def slope_fit(x, y, w):
    """no-intercept logistic slope of y on x = logit p (mirroring doubles gradient and Hessian, same root); w: weights or
    a (B, n) matrix of resample counts"""
    W = np.atleast_2d(w)
    beta = np.ones(W.shape[0])
    for _ in range(40):
        q = 1 / (1 + np.exp(-beta[:, None] * x[None, :]))
        g = (W * (y - q) * x).sum(1)
        h = (W * q * (1 - q) * x * x).sum(1)
        beta = beta + g / np.maximum(h, 1e-12)
    return beta


def ece(p, y):
    pp, yy = np.r_[p, 1 - p], np.r_[y, 1 - y]
    b = np.minimum(9, (pp * 10).astype(int))
    e = 0.0
    for k in range(10):
        m = b == k
        if m.any():
            e += m.sum() / len(pp) * abs(pp[m].mean() - yy[m].mean())
    return float(e)


# ---------------------------------------------------------------- winner models
MV = J(os.path.join(AUD, "models_vault.json"))["fights"]
ENG = {}
for v in ("v4", "v5", "v5.0.1"):
    E = J(os.path.join(AUD, "evalv", v + "_vault.json"))
    ENG[v] = E
P = {}
for v in ENG:
    arr = np.full(n, np.nan)
    for x in ENG[v]["fights"]:
        arr[pos[x["id"]]] = x["pA"]
    P["engine_" + v] = arr
WIN_MODELS = ["close", "close_mult", "open", "elo", "elo_sig", "ml_lr", "ml_lr_2023", "mkt_rating", "feat_lr", "ml2_lr", "ml2_lr_static",
              "ml2_blend_static", "whr_rounds", "ratings_stack", "stack_close", "stack_open", "stack_noline", "moe_page_noline",
              "ml2_stack_close_static", "ml2_stack_open_static", "ml2_stack_noline_static", "ml2_stack_close_static_static",
              "ml2_stack_open_static_static", "ml2_stack_noline_static_static", "ml2_stack_close_prod", "ml2_stack_open_prod",
              "ml2_stack_noline_prod"]
for k in WIN_MODELS:
    P[k] = np.array([MV[f].get(k) if MV[f].get(k) is not None else np.nan for f in ids], float)
# predict() package (if scored): <vault>/audit1/predict_vault.json
pv_path = os.path.join(AUD, "predict_vault.json")
PKG = J(pv_path) if os.path.exists(pv_path) else None
if PKG:
    for kind in ("close", "open", "none"):
        P["predict_" + kind] = np.array([((PKG["fights"].get(f) or {}).get(kind) or {}).get("pA", np.nan) for f in ids], float)

common = dec.copy()
for k in P:
    common &= np.isfinite(P[k])
win_out = {}
LLs = {}
for k, p in P.items():
    m = dec & np.isfinite(p)
    pc = np.clip(p, 1e-6, 1 - 1e-6)
    ll = np.where(m, -(win * np.log(pc) + (1 - win) * np.log(1 - pc)), np.nan)
    br = np.where(m, (pc - win) ** 2, np.nan)
    ac = np.where(m, np.where(np.abs(pc - 0.5) < 1e-12, 0.5, ((pc > 0.5) == (win == 1)) * 1.0), np.nan)
    LLs[k] = ll
    x = np.log(pc / (1 - pc))
    x0, y0 = np.where(m, x, 0.0), np.where(m, win, 0.0)
    s_pt = float(slope_fit(x0, y0, m.astype(float))[0])
    s_bs = slope_fit(x0, y0, CNT * m[None, :])
    e = {"n": int(m.sum())}
    for nm, L in (("log_loss", ll), ("brier", br), ("accuracy", ac)):
        est, c, _ = boot_mean(L)
        e[nm] = {"est": est, "ci": c}
    e["slope"] = {"est": s_pt, "ci": ci(s_bs)}
    e["ece"] = ece(pc[m], win[m])
    win_out[k] = e


def paired(a_, b_):
    d = LLs[a_] - LLs[b_]
    m = np.isfinite(d)
    dz = np.where(m, d, 0.0)
    num, den = CNT @ dz, CNT @ m.astype(float)
    return {"diff": float(dz.sum() / m.sum()), "ci": ci(num / np.maximum(den, 1e-12)), "n": int(m.sum())}


PAIRS = [("engine_v5", "engine_v4"), ("engine_v5.0.1", "engine_v4"), ("engine_v5.0.1", "engine_v5"),
         ("stack_close", "close"), ("stack_open", "open"), ("stack_noline", "close"), ("moe_page_noline", "close"),
         ("ml2_stack_close_static", "close"), ("ml2_stack_close_prod", "close"), ("ml2_stack_close_static_static", "close"),
         ("ml2_stack_open_static", "open"), ("ml2_stack_open_prod", "open"), ("ml2_stack_open_static_static", "open"),
         ("ml2_stack_open_static", "stack_open"), ("ml2_stack_close_static", "stack_close"),
         ("ml2_stack_noline_static", "stack_noline"), ("ml2_stack_noline_prod", "stack_noline"), ("moe_page_noline", "stack_noline"),
         ("open", "close"), ("elo", "close"), ("ml_lr", "close"), ("ml2_lr", "close"), ("ml2_lr", "ml_lr"), ("ml2_lr", "elo"),
         ("whr_rounds", "close"), ("whr_rounds", "elo"), ("engine_v4", "close"), ("engine_v4", "elo"), ("engine_v4", "ml2_lr"),
         ("stack_noline", "ml2_lr"), ("ml2_lr_static", "ml2_lr"), ("ml_lr_2023", "ml_lr"), ("close_mult", "close")]
if PKG:
    PAIRS += [("predict_close", "close"), ("predict_open", "open"), ("predict_none", "close"), ("predict_close", "stack_close"),
              ("predict_none", "stack_noline")]
pair_out = {"%s - %s" % p: paired(*p) for p in PAIRS if p[0] in LLs and p[1] in LLs}

# ---------------------------------------------------------------- drift rule 6.5.1(a)
def rule(k):
    s = win_out[k]["slope"]
    lo, hi = s["ci"]
    fire = s["est"] < 1.15 and lo <= 1.0 <= hi
    branch = ("persists (CI excludes 1, point >= 1.2)" if (lo > 1.0 and s["est"] >= 1.2) else
              "reverts (point < 1.15, CI includes 1)" if fire else "inconclusive")
    return {"column": k, "slope": s["est"], "ci": s["ci"], "switch_to_h3_T1": bool(fire), "plan_4_2_branch": branch}


drift = {"primary": rule("stack_noline"), "secondary": [rule("ml2_stack_noline_prod"), rule("moe_page_noline"), rule("ml2_stack_noline_static")]}

# ---------------------------------------------------------------- method x round (cells)
T = pd.DataFrame([{"id": f["id"], "rounds": 5 if f["rounds"] == 5 else 3,
                   "cls": {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC", "DRAW": "DRAW"}.get(f["result"]["method"])
                   if f["result"]["winner"] in ("A", "B", "D") else None,
                   "winner": f["result"]["winner"], "rnd": f["result"]["round"], "event": f["event"]} for f in BT])
y = MR.outcome_cells(T)
okc = y >= 0
MRJ = J(os.path.join(ROOT, "data", "derived", "methodround.json"))["fights"]
ML2V = J(os.path.join(AUD, "ml2_vault.json"))["fights"]
CELLS = {}
for v in ENG:
    CELLS["engine_" + v] = {x["id"]: x["cells"] for x in ENG[v]["fights"]}
for key in ("S", "SM", "S_refit", "SM_refit"):
    CELLS[key] = {f: MRJ[f][key] for f in ids if f in MRJ and MRJ[f].get(key)}
for key in ("S2", "S2+ml2win"):
    CELLS[key + " (fit<2024)"] = {f: ML2V[f]["cells"][key] for f in ids if f in ML2V and "cells" in ML2V[f]}
CELLS["S (fit<2024, re-derived)"] = {f: ML2V[f]["cells"]["S"] for f in ids if f in ML2V and "cells" in ML2V[f]}
pp_path = os.path.join(AUD, "props_vault.json")
if os.path.exists(pp_path):
    PPV = J(pp_path)["fights"]
    for key in sorted({k for v in PPV.values() for k in v.get("cells", {})}):
        CELLS[key] = {f: PPV[f]["cells"][key] for f in PPV if key in PPV[f].get("cells", {})}
if PKG:
    for kind in ("close", "open", "none"):
        CELLS["predict_" + kind] = {f: (PKG["fights"][f].get(kind) or {}).get("cells") for f in PKG["fights"] if (PKG["fights"][f].get(kind) or {}).get("cells")}
Lc = {}
cell_out = {}
for k, cd in CELLS.items():
    Pm = np.full((n, MR.NC_), np.nan)
    have = np.zeros(n, bool)
    for f, c in cd.items():
        if f in pos and c is not None:
            i = pos[f]
            Pm[i] = MR.expand_cells(c, T["rounds"].iloc[i])
            have[i] = True
    m = have & okc
    Pz = np.where(have[:, None], Pm, 1.0 / MR.NC_)
    L = MR.per_fight_losses(Pz, np.where(m, y, -1), T)
    L = {kk: np.where(m, vv, np.nan) for kk, vv in L.items()}
    Lc[k] = L
    cell_out[k] = {"n": int(m.sum())}
    for met in MR.METRICS:
        if met in L:
            est, c, nn = boot_mean(L[met])
            cell_out[k][met] = {"est": est, "ci": c, "n": nn}
    # implied base rates
    cell_out[k]["implied"] = {}
    sub = Pm[m]
    if len(sub):
        KO = sub[:, MR.I_XKO:MR.I_XKO + 5].sum(1) + sub[:, MR.I_YKO:MR.I_YKO + 5].sum(1)
        SB = sub[:, MR.I_XSUB:MR.I_XSUB + 5].sum(1) + sub[:, MR.I_YSUB:MR.I_YSUB + 5].sum(1)
        tot = sub.sum(1)
        cell_out[k]["implied"] = {"KO": float((KO / tot).mean()), "SUB": float((SB / tot).mean()), "DEC": float(1 - ((KO + SB) / tot).mean())}
        for R in (3, 5):
            mr_ = (T["rounds"].to_numpy()[m] == R)
            if mr_.any():
                s2 = sub[mr_] / tot[mr_, None]
                cell_out[k]["implied"]["finByRound%d" % R] = [float((s2[:, r] + s2[:, 5 + r] + s2[:, 10 + r] + s2[:, 15 + r]).mean()) for r in range(R)]


def cpaired(a_, b_, met):
    d = Lc[a_][met] - Lc[b_][met]
    m = np.isfinite(d)
    dz = np.where(m, d, 0.0)
    num, den = CNT @ dz, CNT @ m.astype(float)
    return {"diff": float(dz.sum() / max(m.sum(), 1)), "ci": ci(num / np.maximum(den, 1e-12)), "n": int(m.sum())}


CPAIRS = [(e, "S") for e in CELLS if e != "S"] + [("engine_v5", "engine_v4"), ("engine_v5.0.1", "engine_v4"),
                                                  ("S2+ml2win (fit<2024)", "S2 (fit<2024)"), ("engine_v4", "S2+ml2win (fit<2024)"),
                                                  ("engine_v5", "S2+ml2win (fit<2024)"), ("engine_v5.0.1", "S2+ml2win (fit<2024)"),
                                                  ("S_refit", "S"), ("props_pool@close", "S2@close"),
                                                  ("predict_close", "SM_refit"), ("predict_open", "S_refit"), ("predict_none", "S_refit"),
                                                  ("predict_close", "engine_v4"), ("predict_none", "engine_v4")]
cpair_out = {}
for a_, b_ in CPAIRS:
    if a_ in Lc and b_ in Lc:
        cpair_out["%s - %s" % (a_, b_)] = {met: cpaired(a_, b_, met) for met in MR.METRICS if met in Lc[a_]}

# ---------------------------------------------------------------- engine stat-line deviances (evalv per-fight L)
DEV = ["dev_sig_lnd", "dev_sig_att", "dev_td_lnd", "dev_ctrl", "dev_kd", "devpm_sig_lnd", "devpm_sig_att", "devpm_td_lnd", "devpm_ctrl",
       "devpm_kd", "bin7", "method"]
Ld = {}
dev_out = {}
for v in ENG:
    Ld[v] = {}
    dev_out[v] = {}
    for k in DEV:
        arr = np.full(n, np.nan)
        for x in ENG[v]["fights"]:
            val = x["L"].get(k)
            if val is not None:
                arr[pos[x["id"]]] = val
        Ld[v][k] = arr
        est, c, nn = boot_mean(arr)
        dev_out[v][k] = {"est": est, "ci": c, "n": nn}
dev_pairs = {}
for v in ("v5", "v5.0.1"):
    dev_pairs[v + " - v4"] = {}
    for k in DEV:
        d = Ld[v][k] - Ld["v4"][k]
        m = np.isfinite(d)
        dz = np.where(m, d, 0.0)
        dev_pairs[v + " - v4"][k] = {"diff": float(dz.sum() / m.sum()), "ci": ci((CNT @ dz) / np.maximum(CNT @ m.astype(float), 1e-12))}

# ---------------------------------------------------------------- base rates: actual (with event-cluster CIs) vs simulated
meth = [r["method"] for r in res]
w_ok = np.array([r["winner"] in ("A", "B", "D") and m_ in ("KO", "DOC", "SUB", "UD", "SD", "MD", "DRAW") for r, m_ in zip(res, meth)])
isKO = np.array([m_ in ("KO", "DOC") for m_ in meth]) & w_ok
isSUB = np.array([m_ == "SUB" for m_ in meth]) & w_ok
isDEC = np.array([m_ in ("UD", "SD", "MD", "DRAW") for m_ in meth]) & w_ok


def share(ind, base):
    num, den = CNT @ (ind & base).astype(float), CNT @ base.astype(float)
    return {"est": float((ind & base).sum() / base.sum()), "ci": ci(num / den), "n": int(base.sum())}


actual = {"n_outcome": int(w_ok.sum()), "KO": share(isKO, w_ok), "SUB": share(isSUB, w_ok), "DEC": share(isDEC, w_ok),
          "finish": share(isKO | isSUB, w_ok)}
rounds = np.array([5 if f["rounds"] == 5 else 3 for f in BT])
rnd = np.array([r["round"] or 1 for r in res])
for R in (3, 5):
    base = w_ok & (rounds == R)
    actual["finByRound%d" % R] = [share((isKO | isSUB) & (np.minimum(rnd, R) == r + 1), base) for r in range(R)]
kd = np.array([(f["actual"]["A"]["kd"] + f["actual"]["B"]["kd"]) if f.get("actual") and f["actual"].get("A") else np.nan for f in BT])
hl = np.array([(f["actual"]["A"]["h_lnd"] + f["actual"]["B"]["h_lnd"]) if f.get("actual") and f["actual"].get("A") else np.nan for f in BT])
mk = np.isfinite(kd) & np.isfinite(hl)
kdz, hlz = np.where(mk, kd, 0), np.where(mk, hl, 0)
actual["kdPer100Head"] = {"est": float(100 * kdz.sum() / hlz.sum()), "ci": ci(100 * (CNT @ kdz) / (CNT @ hlz)), "n": int(mk.sum())}
dmeth = np.array([m_ in ("UD", "SD", "MD") for m_ in meth])
for k in ("UD", "SD", "MD"):
    actual["decision_" + k] = share(np.array([m_ == k for m_ in meth]), dmeth)
sim = {v: ENG[v]["baseRates"] for v in ENG}
glove = {"note": "2026 bouts used the standard UFC gloves (the new-glove trial ran Jun 1 - Nov 15, 2024; the old gloves returned "
                 "from Feb 15, 2025; research/model_eradrift.md). The glove-window amendment (V6_V10_PLAN 7.1 item 9) excludes "
                 "only the 2024 trial dates, so it never touches the vault.",
         "reference_2025_old_gloves_actual": {"decision_share": 0.490, "KO_share": 0.328, "kd_per_100_head": 0.87,
                                              "source": "docs/BACKLOG.md eradrift entry (Feb 15 - Dec 31, 2025)"}}

out = {"meta": {"tool": "tools/vault_audit1/score_vault.py", "n_fights": n, "n_decisive": int(dec.sum()), "n_events": G, "boot": a.boot,
                "date_range": [min(f["date"] for f in BT), max(f["date"] for f in BT)], "n_common_winner": int(common.sum())},
       "winner": win_out, "paired": pair_out, "drift_rule": drift, "cells": cell_out, "cells_paired": cpair_out,
       "engine_dev": dev_out, "engine_dev_paired": dev_pairs, "base_rates": {"actual": actual, "sim": sim, "glove": glove},
       "engine_evalv_metrics": {v: ENG[v]["metrics"] for v in ENG}, "engine_evalv_compare": {v: ENG[v].get("compare") for v in ENG}}
json.dump(out, open(os.path.join(AUD, "score_vault.json"), "w"), indent=1)

f4 = lambda x: "%.4f" % x
print("vault: %d fights, %d decisive, %d events (%s..%s); %d decisive fights with every winner model" % (
    n, dec.sum(), G, out["meta"]["date_range"][0], out["meta"]["date_range"][1], common.sum()))
print("\n| model | n | log loss [95% CI] | Brier | accuracy | slope [95% CI] |\n|---|---|---|---|---|---|")
for k, e in win_out.items():
    print("| %s | %d | %s [%s, %s] | %s | %.3f | %.2f [%.2f, %.2f] |" % (k, e["n"], f4(e["log_loss"]["est"]), f4(e["log_loss"]["ci"][0]),
          f4(e["log_loss"]["ci"][1]), f4(e["brier"]["est"]), e["accuracy"]["est"], e["slope"]["est"], e["slope"]["ci"][0], e["slope"]["ci"][1]))
print("\n| paired log loss | diff [95% CI] | n |\n|---|---|---|")
for k, e in pair_out.items():
    print("| %s | %+.4f [%+.4f, %+.4f] | %d |" % (k, e["diff"], e["ci"][0], e["ci"][1], e["n"]))
print("\ndrift rule:", json.dumps(drift, indent=1))
print("\n| cells model | n | joint | method3 | bin7 | round|fin | method|winner | winner |\n|---|---|---|---|---|---|---|---|")
for k, e in cell_out.items():
    g = lambda m: "%.4f" % e[m]["est"] if m in e else "-"
    print("| %s | %d | %s | %s | %s | %s | %s | %s |" % (k, e["n"], g("joint"), g("method3"), g("bin7"), g("round_given_fin"), g("method_given_winner"), g("winner")))
print("\n| cells paired | joint | method3 | bin7 | round|fin | method|winner |\n|---|---|---|---|---|---|")
for k, e in cpair_out.items():
    g = lambda m: "%+.4f [%+.4f, %+.4f]" % (e[m]["diff"], e[m]["ci"][0], e[m]["ci"][1]) if m in e else "-"
    print("| %s | %s | %s | %s | %s | %s |" % (k, g("joint"), g("method3"), g("bin7"), g("round_given_fin"), g("method_given_winner")))
print("\nengine stat lines:", json.dumps({v: {k: round(e["est"], 4) for k, e in d.items()} for v, d in dev_out.items()}))
print("paired:", json.dumps({p: {k: [round(e["diff"], 4), [round(c, 4) for c in e["ci"]]] for k, e in d.items()} for p, d in dev_pairs.items()}))
print("\nactual base rates:", json.dumps(actual))
