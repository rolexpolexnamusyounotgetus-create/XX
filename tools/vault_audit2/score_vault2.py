#!/usr/bin/env python3
"""VAULT AUDIT 2 (auditor only): every number of research/vault_audit_v10.md, scored once from the audit-2 run files.

    nice -n 5 python3 tools/vault_audit2/score_vault2.py [--vault <dir>]   ->  <vault>/audit2/score_vault2.json (+ printed summary)

Pre-registration: data/derived/version_history.json vault_audits[1] (case 'if_v4_stays': no confirmatory primary; headline =
open-regime winner log loss of cmp4 and of the shipped forward-model package vs the opener; v10 / v7 / v6 packages paired vs cmp4,
v8 at engine level vs v4; failure criteria reported without a decision). Scoring code is the repository's own: tools/predict_score.py
(losses, event-cluster bootstrap 20,000 resamples seed 7, Monte Carlo SE, clustered normal bound, check_upper), tools/v7_gate.py
(package composition: pool weight w, props pool pi, paired package metrics), tools/v10_gate.py (variants), tools/v8_gate.py (stat-line
losses, total relative deviance). Symmetric: every model is corner-symmetric; calibration slopes are mirrored with no intercept.

Deployment fits (no metric): pool weight w per package by tools/v10_gate.py's rule on 2019-2025 records (data/derived/v10/gate_train.json +
look_val.json for v10 / cmp4 / v7 = v10_simv4; data/derived/v6/gate_train.json + look_val.json for v6) and props pi on 2021-2025, each first
reproduced on 2019-2023 / 2021-2023 against the frozen value.
"""
import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys
import tempfile

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import predict_score as PS  # noqa: E402
import v7_gate as G7  # noqa: E402
import v8_gate as G8  # noqa: E402
import v10_gate as G10  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
ap.add_argument("--slope-boot", type=int, default=2000)
a = ap.parse_args()
V = a.vault
AUD1, AUD = os.path.join(V, "audit1"), os.path.join(V, "audit2")
J = lambda p: json.load(open(p if os.path.isabs(p) else os.path.join(ROOT, p)))
DER = "data/derived/"
OUT = {"meta": {"tool": "tools/vault_audit2/score_vault2.py", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                "boot": dict(PS.BOOT), "slope_boot": a.slope_boot, "vault": V}}
YR = (2026,)

# =============================================================== 1. deployment fits through 2025 (w, pi)
R10 = J(DER + "v10/gate_train.json")["fights"] + J(DER + "v10/look_val.json")["fights"]
G10.add_variants(R10)
R6 = J(DER + "v6/gate_train.json")["fights"] + J(DER + "v6/look_val.json")["fights"]
GS = J(DER + "v10/gate_train_score.json")["fits"]
fits = {"w": {}, "pi": {}, "reproduction": {}}
for name, recs, frozen in (("v10", R10, GS["w"]["v10"]["fit_2019_2023"]["w"]), ("cmp4", R10, GS["w"]["cmp4"]["fit_2019_2023"]["w"]),
                           ("v10_simv4", R10, GS["w"]["v10_simv4"]["fit_2019_2023"]["w"]), ("v6", R6, 0.35)):
    f23 = G7.fit_w(recs, name, range(2019, 2024))
    f25 = G7.fit_w(recs, name, range(2019, 2026))
    fits["w"][name] = f25
    fits["reproduction"]["w_" + name] = {"fit_2019_2023": f23["w"], "frozen": frozen, "equal": f23["w"] == frozen}
pi_frozen = GS["pi"]["fit_2021_2023"]["pi"]
for name in ("v10", "v10_simv4"):
    p23 = G7.fit_pi(R10, name, range(2021, 2024), fits["reproduction"]["w_" + name]["fit_2019_2023"])
    fits["pi"][name] = G7.fit_pi(R10, name, range(2021, 2026), fits["w"][name]["w"])
    fits["reproduction"]["pi_" + name] = {"fit_2021_2023": p23["pi"], "frozen": pi_frozen, "equal": p23["pi"] == pi_frozen}
OUT["fits"] = fits
print("fits through 2025:", {k: v["w"] for k, v in fits["w"].items()}, {k: v["pi"] for k, v in fits["pi"].items()})
print("reproduction:", fits["reproduction"])


def fitdoc(pkg, pi_from=None):
    return {"w": {pkg: {"2026": {"w": fits["w"][pkg]["w"]}}}, "pi": {"2026": {"pi": fits["pi"][pi_from]["pi"]}} if pi_from else {}}


FD = {"cmp4": fitdoc("cmp4"), "v10": fitdoc("v10", "v10"), "v10_simv4": fitdoc("v10_simv4", "v10_simv4"), "v6": fitdoc("v6")}

# =============================================================== 2. vault records and per-fight predictions
H = J(os.path.join(AUD, "harness_vault.json"))
HF = [r for r in H["fights"] if not r.get("err")]
assert len(HF) == 373, len(HF)
G10.add_variants(HF)
MK = J(os.path.join(V, "market_vault.json"))["fights"]
MV = J(os.path.join(AUD1, "models_vault.json"))["fights"]
M2 = J(os.path.join(AUD, "ml2s2_vault.json"))["fights"]
MRJ = J(DER + "methodround.json")["fights"]
AUX = J(os.path.join(AUD, "aux_vault.json"))["fights"]
EV = {v: {r["id"]: r for r in J(os.path.join(AUD, "evalv", v + "_vault.json"))["fights"]} for v in ("v4", "v10", "v8")}
V6S = J(DER + "v6_stacks.json")["stacks"]
FM = J(DER + "forward_models.json")["ml2_static"]


def clip(x, lo, hi):
    return min(hi, max(lo, x))


def lg(p):
    return math.log(p / (1 - p))


def sg(z):
    return 1 / (1 + math.exp(-z))


def stackP(weights, inputs, pc=0.01):
    z = 0.0
    for w, q in zip(weights, inputs):
        if q is None:
            continue
        z += w * lg(clip(q, pc, 1 - pc))
    return sg(z)


def v6prod(kind, head, inp):
    blk = V6S[kind + "|" + head]
    cols = {"ml2": inp["blend"], "ml2lr": inp["lr"], "mkt_rating": inp["mr"], "open": inp["open"], "market": inp["close"]}
    return stackP(blk["production"]["weights"], [cols[c] for c in blk["columns"]], blk.get("pclip", 0.01))


def fwdP(kind, inp):
    st = FM[{"none": "noline", "open": "open", "close": "open"}[kind]]     # the ledger: any captured line goes to the open stack
    vals = {"ml2": inp["lr"], "ml2lr": inp["lr"], "mkt_rating": inp["mr"], "open": inp["open"] if kind == "open" else inp["close"],
            "market": inp["close"], "line": inp["close"]}
    return stackP(st["weights"], [vals.get(c) for c in st["inputs"]], st.get("pclip", 0.01))


def cells_winner(c, R):
    c = np.asarray(c, float)
    pa = c[0:2 * R].sum() + c[4 * R]
    pb = c[2 * R:4 * R].sum() + c[4 * R + 1]
    return float(pa / (pa + pb))


def rescale(c, R, p):
    return np.asarray(G10.rescale(list(c), R, p), float)


WIN = {}      # model -> {id: p}
CELLS = {}    # model -> {id: (cells, p)}  (cells-bearing models: packages and S / S2 / props benchmarks)
for r in HF:
    i, R = r["id"], r["rounds"]
    mk, mv, m2 = MK[i], MV[i], M2[i]
    inp = {"lr": m2["ml2_lr_prod"], "blend": m2["ml2_blend_prod"], "mr": mk.get("p_market_rating"), "open": mk["p_novig_open"], "close": mk["p_power_close"]}
    W = {"close": mk["p_power_close"], "open": mk["p_novig_open"], "elo": mv["elo"], "ml2_lr": inp["lr"], "ml2_blend": inp["blend"],
         "engine_v4": EV["v4"][i]["pA"], "engine_v10": EV["v10"][i]["pA"]}
    for kind in ("none", "open", "close"):
        W["ml2stack_lr_prod_" + kind] = v6prod(kind, "lr", inp)
        W["ml2stack_blend_prod_" + kind] = v6prod(kind, "blend", inp)
        W["fwd_" + kind] = fwdP(kind, inp)
        W["ml2stack_lr_2019_2023_" + kind] = stackP(FM[{"none": "noline", "open": "open", "close": "line"}[kind]]["weights"],
                                                    [{"ml2": inp["lr"], "ml2lr": inp["lr"], "mkt_rating": inp["mr"], "open": inp["open"], "market": inp["close"], "line": inp["close"]}.get(c)
                                                     for c in FM[{"none": "noline", "open": "open", "close": "line"}[kind]]["inputs"]])
    for k, v in W.items():
        WIN.setdefault(k, {})[i] = v
    # cells-bearing benchmarks
    S = MRJ[i]["S_refit"]
    SM = MRJ[i]["SM_refit"]
    S2 = M2[i]["S2"]
    for name, c in (("S", S), ("SM", SM), ("S2", S2)):
        CELLS.setdefault(name, {})[i] = (np.asarray(c, float), cells_winner(c, R))
    CELLS.setdefault("S2@close", {})[i] = (np.asarray(AUX[i]["S2@close"], float), mk["p_power_close"])
    if "props_pool@close" in AUX[i]:
        CELLS.setdefault("props_pool@close", {})[i] = (np.asarray(AUX[i]["props_pool@close"], float), mk["p_power_close"])
    # packages per regime
    for kind in ("none", "open", "close"):
        for name, pkg, mode, fd in (("cmp4", "cmp4", "cmp", FD["cmp4"]), ("v10np", "v10", "np", FD["v10"]), ("v10", "v10", "props", FD["v10"]),
                                    ("v7np", "v10_simv4", "np", FD["v10_simv4"]), ("v7", "v10_simv4", "props", FD["v10_simv4"]), ("v6", "v6", "np", FD["v6"])):
            pc = G7.package_cells(r, kind, pkg, fd, "v10", mode)
            CELLS.setdefault(name + "|" + kind, {})[i] = (np.asarray(pc[0], float), float(pc[1]))
        WIN.setdefault("cmp4_" + kind, {})[i] = r["pk"]["cmp4"][kind]["p"]
        WIN.setdefault("v10_" + kind, {})[i] = r["pk"]["v10"][kind]["p"]
        WIN.setdefault("v6_" + kind, {})[i] = r["pk"]["v6"][kind]["p"]
    # engines as cells models (evalv cells: compact order, both orders pooled)
    for v in ("v4", "v10"):
        e = EV[v][i]
        CELLS.setdefault("engine_" + v, {})[i] = (np.asarray(e["cells"], float), e["pA"])

# wiring: v10 winner == v6 winner == the ML v2 blend-head production stack; v7 winner == v10 winner
wiring = {}
for kind in ("none", "open", "close"):
    wiring["v10_eq_ml2stack_blend_prod_" + kind] = max(abs(WIN["v10_" + kind][i] - WIN["ml2stack_blend_prod_" + kind][i]) for i in WIN["v10_" + kind])
    wiring["v6_eq_v10_" + kind] = max(abs(WIN["v6_" + kind][i] - WIN["v10_" + kind][i]) for i in WIN["v10_" + kind])
    wiring["v7_eq_v10_" + kind] = max(abs(CELLS["v7np|" + kind][i][1] - CELLS["v10np|" + kind][i][1]) for i in WIN["v10_" + kind])
wiring["cmp4_moe_recompute_max_abs"] = J(os.path.join(AUD, "aux_vault.json"))["meta"]["cmp4_moe_recompute_max_abs"]
wiring["v8_eq_v10_engine_rows"] = all(EV["v8"][i]["pA"] == EV["v10"][i]["pA"] and EV["v8"][i]["cells"] == EV["v10"][i]["cells"] for i in EV["v10"])
OUT["wiring"] = wiring
print("wiring:", wiring)

# =============================================================== 3. scoring helpers
FIGHTS = {r["id"]: r for r in HF}
IDS = [r["id"] for r in HF]
YS = {i: PS.outcome(FIGHTS[i]) for i in IDS}
GRP = {i: (FIGHTS[i]["event"] or "") + "|" + FIGHTS[i]["date"] for i in IDS}


def slope_ci(ps, ys, groups, B):
    """Mirrored no-intercept calibration slope with an event-cluster bootstrap CI (B resamples, seed 7)."""
    ps, ys = np.asarray(ps, float), np.asarray(ys, float)
    x = np.log(np.clip(ps, 1e-4, 1 - 1e-4) / (1 - np.clip(ps, 1e-4, 1 - 1e-4)))

    def fit(xx, yy):
        X = np.r_[xx, -xx]
        Y = np.r_[yy, 1 - yy]
        b = 1.0
        for _ in range(40):
            q = 1 / (1 + np.exp(-b * X))
            b += ((Y - q) * X).sum() / max(1e-9, (q * (1 - q) * X * X).sum())
        return b
    point = fit(x, ys)
    keys = sorted(set(groups))
    idx = {k: [] for k in keys}
    for j, g in enumerate(groups):
        idx[g].append(j)
    G = [np.array(idx[k]) for k in keys]
    rng = np.random.default_rng(7)
    bs = []
    for _ in range(B):
        k = rng.integers(0, len(G), len(G))
        sel = np.concatenate([G[t] for t in k])
        bs.append(fit(x[sel], ys[sel]))
    return float(point), [round(float(np.percentile(bs, 2.5)), 3), round(float(np.percentile(bs, 97.5)), 3)]


def win_level(model, ids):
    rows = [(i, WIN[model][i]) for i in ids if YS[i] and YS[i]["winner"] in ("A", "B")]
    L = [PS.win_losses(p, YS[i]) for i, p in rows]
    ll = np.array([l["winLL"] for l in L])
    g = [GRP[i] for i, _ in rows]
    bs = PS.cluster_boot(g, {"ll": ll})["ll"]
    ps = [l["_p"] for l in L]
    ysv = [l["_y"] for l in L]
    e, _ = PS.calib(ps, ysv)
    s, sci = slope_ci(ps, ysv, g, a.slope_boot)
    return {"n": len(rows), "n_cards": len(set(g)), "winLL": round(float(ll.mean()), 5), "ci": PS.ci(bs), "brier": round(float(np.mean([l["brier"] for l in L])), 5),
            "acc": round(float(np.mean([l["acc"] for l in L])), 4), "ece": e, "slope": round(s, 4), "slope_ci": sci,
            "slope_outside_0.8_1.6": bool(s < 0.8 or s > 1.6)}


def win_paired(ma, mb, ids, thr=None):
    rows = [i for i in ids if YS[i] and YS[i]["winner"] in ("A", "B")]
    la = np.array([PS.win_losses(WIN[ma][i], YS[i])["winLL"] for i in rows])
    lb = np.array([PS.win_losses(WIN[mb][i], YS[i])["winLL"] for i in rows])
    ba = np.array([PS.win_losses(WIN[ma][i], YS[i])["brier"] for i in rows])
    bb = np.array([PS.win_losses(WIN[mb][i], YS[i])["brier"] for i in rows])
    g = [GRP[i] for i in rows]
    d = la - lb
    bs = PS.cluster_boot(g, {"d": d, "db": ba - bb})
    rec = {"a": ma, "b": mb, "n": len(rows), "n_cards": len(set(g)), "diff": round(float(d.mean()), 5), "ci": PS.ci(bs["d"]), "ci_mcse": PS.ci_mcse(bs["d"]),
           "normal": PS.normal_ci(g, d, np.ones(len(d))), "brier_diff": round(float((ba - bb).mean()), 5), "brier_ci": PS.ci(bs["db"])}
    if thr is not None:
        rec["check_upper_le_%s" % thr] = PS.check_upper(rec, thr, False)
    return rec


def cells_rows(names, ids, need=None):
    rows = []
    for i in ids:
        y = YS[i]
        if y is None or (need and not need(i)):
            continue
        rows.append((FIGHTS[i], y, {n: CELLS[n][i] for n in names}))
    return rows


def pkg_paired(na, nb, kind_tag, ids, need=None):
    rows = cells_rows([na, nb], ids, need)
    rows = [(r, y, {"A_": cp[na], "B_": cp[nb]}) for r, y, cp in rows]
    P = G7.paired(rows, ["A_", "B_"], YR, kind_tag)
    d = P["paired"]["A_ - B_"]
    lev = P["packages"]
    keep = ("winLL", "brier", "bin7", "method", "joint", "rgf", "mgw", "soft")
    return {"a": na, "b": nb, "n_outcome": P["n_outcome"], "n_decisive": P["n_decisive"], "n_finish": P["n_finish"], "n_cards": P["n_cards"],
            "levels": {na: lev["A_"], nb: lev["B_"]}, "paired": {k: d[k] for k in keep if k in d},
            "pdec_bias": {na: d.get("pdec_bias_A_"), nb: d.get("pdec_bias_B_")}}


def cells_level(name, ids, need=None):
    rows = cells_rows([name], ids, need)
    rows = [(r, y, {"A_": cp[name], "B_": cp[name]}) for r, y, cp in rows]
    P = G7.paired(rows, ["A_", "B_"], YR, "level")
    return dict(P["packages"]["A_"], n_outcome=P["n_outcome"], n_decisive=P["n_decisive"])


has_props = lambda i: G7.has_props(FIGHTS[i])

# =============================================================== 4. headline (pre-registered, descriptive): open regime vs the opener
WIN["opener"] = WIN["open"]
head = {"note": "case if_v4_stays: no confirmatory primary; descriptive headline (vault_audits[1].primary.if_v4_stays)",
        "levels": {m: win_level(m, IDS) for m in ("opener", "cmp4_open", "fwd_open", "close")},
        "cmp4_minus_opener": win_paired("cmp4_open", "opener", IDS, 0.002),
        "fwd_minus_opener": win_paired("fwd_open", "opener", IDS, 0.002),
        "cmp4_minus_fwd": win_paired("cmp4_open", "fwd_open", IDS),
        "side_lines_vs_cmp4_open_winner": {"v10 (= v7 = v6 winner: ML v2 blend-head production stack)": win_paired("v10_open", "cmp4_open", IDS, 0.002)}}
OUT["headline"] = head

# =============================================================== 5. regimes: packages vs cmp4 (winner and cells), with and without props
regimes = {}
for kind in ("open", "none", "close"):
    rk = {}
    for side in ("v10np", "v10", "v7np", "v7", "v6"):
        rk[side + " - cmp4"] = pkg_paired(side + "|" + kind, "cmp4|" + kind, kind, IDS)
    rk["v10 - v10np (props effect, all fights)"] = pkg_paired("v10|" + kind, "v10np|" + kind, kind, IDS)
    rk["v10np - v7np (simulator: v10 vs v4 cells)"] = pkg_paired("v10np|" + kind, "v7np|" + kind, kind, IDS)
    regimes[kind] = rk
# close + props (bouts with method props)
cp = {}
for side in ("v10", "v7", "v10np", "v7np", "v6"):
    cp[side + " - cmp4"] = pkg_paired(side + "|close", "cmp4|close", "close+props", IDS, has_props)
cp["v10 - v10np"] = pkg_paired("v10|close", "v10np|close", "close+props", IDS, has_props)
cp["v7 - v7np"] = pkg_paired("v7|close", "v7np|close", "close+props", IDS, has_props)
regimes["close+props"] = cp
OUT["regimes"] = regimes

# =============================================================== 6. winner benchmarks (every model, 369 decisive)
bench_models = ["close", "opener", "elo", "ml2_lr", "ml2_blend", "engine_v4", "engine_v10"] + \
    ["%s_%s" % (m, k) for k in ("none", "open", "close") for m in ("cmp4", "fwd", "ml2stack_lr_prod", "ml2stack_blend_prod", "ml2stack_lr_2019_2023")]
for name in ("S", "SM", "S2"):
    WIN["mr_" + name] = {i: CELLS[name][i][1] for i in IDS}
    bench_models.append("mr_" + name)
OUT["winner_benchmarks"] = {m: win_level(m, IDS) for m in bench_models}
pairs = [("cmp4_close", "close"), ("fwd_close", "close"), ("ml2stack_lr_prod_close", "close"), ("ml2stack_blend_prod_close", "close"),
         ("ml2stack_lr_2019_2023_close", "close"), ("opener", "close"), ("ml2stack_blend_prod_open", "opener"), ("ml2stack_lr_prod_open", "opener"),
         ("ml2stack_lr_2019_2023_open", "opener"), ("cmp4_none", "fwd_none"), ("v10_none", "cmp4_none"), ("v10_close", "cmp4_close"),
         ("fwd_none", "ml2_lr"), ("cmp4_none", "ml2_lr"), ("ml2_blend", "ml2_lr"), ("ml2_lr", "elo"), ("engine_v4", "elo"), ("engine_v10", "engine_v4"),
         ("engine_v4", "ml2_lr"), ("engine_v4", "close"), ("cmp4_none", "close"), ("fwd_none", "close")]
OUT["winner_paired"] = {"%s - %s" % p: win_paired(p[0], p[1], IDS) for p in pairs}

# =============================================================== 7. method / round side line (cells benchmarks)
OUT["cells_levels"] = {n: cells_level(n, IDS) for n in ("S", "SM", "S2", "S2@close", "engine_v4", "engine_v10", "cmp4|open", "cmp4|none", "cmp4|close",
                                                         "v10|open", "v10|none", "v10|close", "v10np|open", "v7|open", "v7np|open", "v6|open")}
OUT["cells_levels"]["props_pool@close"] = cells_level("props_pool@close", IDS, has_props)
OUT["cells_paired"] = {
    "S2 - S": pkg_paired("S2", "S", "level", IDS),
    "props_pool@close - S2@close": pkg_paired("props_pool@close", "S2@close", "close", IDS, has_props),
    "engine_v10 - engine_v4": pkg_paired("engine_v10", "engine_v4", "level", IDS),
    "engine_v4 - S": pkg_paired("engine_v4", "S", "level", IDS),
    "cmp4|close - SM": pkg_paired("cmp4|close", "SM", "close", IDS),
    "v10|close - props_pool@close": pkg_paired("v10|close", "props_pool@close", "close", IDS, has_props),
}

# =============================================================== 8. stat lines: v10 / v8 engines vs v4 (10-stat harness, arms all vs cmp4)
def stat_block(path):
    Hs = json.load(open(path))
    Fs = [f for f in Hs["fights"] if not f.get("err")]
    assert len(Fs) == 373 and all(f["date"] >= "2026-01-01" for f in Fs)
    _, Fbase = G8.load(os.path.join(ROOT, DER + "v10/gate_stat.json"), (2021, 2022, 2023))
    arms, Ls, groups = G8.table(Hs, Fs, base_fights=Fbase)
    norm = {s: float(np.nanmean(G8.col(Ls["cmp4"], "dev_" + s))) for s in G8.STATS}
    keys = ["total", "total_raw", "winLL", "bin7", "method"] + ["dev_" + s for s in G8.STATS] + ["mae_" + s for s in G8.STATS]
    P = G8.paired(groups, Ls["all"], Ls["cmp4"], keys, norm)
    worse = [k for k in ["dev_" + s for s in G8.STATS] if P[k]["ci"][0] > 0]
    better = [k for k in ["dev_" + s for s in G8.STATS] if P[k]["ci"][1] < 0]
    lev = {arm: {"dev": {s: round(float(np.nanmean(G8.col(Ls[arm], "dev_" + s))), 4) for s in G8.STATS}, "pit": G8.pit_summary(Ls[arm])} for arm in arms}
    return {"file": path, "n": len(Fs), "norm_dev_cmp4": norm, "paired_all_minus_cmp4": P, "deviance_worse_ci_excl_0": worse,
            "deviance_better_ci_excl_0": better, "levels": lev, "meta": {k: Hs["meta"][k] for k in ("engine_dir", "engine_params", "sims_per_order", "seed", "arms")}}


OUT["statlines"] = {"v10": stat_block(os.path.join(AUD, "stat_v10_vault.json")), "v8": stat_block(os.path.join(AUD, "stat_v8_vault.json"))}
EVJ = {v: J(os.path.join(AUD, "evalv", v + "_vault.json")) for v in ("v4", "v10", "v8")}
OUT["evalv"] = {v: {"metrics": EVJ[v]["metrics"], "baseRates": EVJ[v]["baseRates"], "compare": EVJ[v].get("compare"), "methodround": EVJ[v].get("methodround"),
                    "pitCoverage": EVJ[v].get("pitCoverage"), "meta": {k: EVJ[v]["meta"].get(k) for k in ("engine_version", "params_version", "engine_sha256", "params_sha256", "ml", "sims_per_order", "seed", "step4")}}
                for v in ("v4", "v10", "v8")}
OUT["decide_v10_vs_v4"] = J(os.path.join(AUD, "decide_v10_vs_v4_vault.json"))

# =============================================================== 9. base rates of the packages and benchmarks (cells shares vs actual)
def shares(name, ids, need=None):
    ko = sub = dec = n = 0.0
    r1 = {3: [0.0] * 3, 5: [0.0] * 5}
    nR = {3: 0, 5: 0}
    for i in ids:
        if YS[i] is None or (need and not need(i)):
            continue
        c, _ = CELLS[name][i]
        c = c / c.sum()
        R = FIGHTS[i]["rounds"]
        ko += c[0:R].sum() + c[2 * R:3 * R].sum()
        sub += c[R:2 * R].sum() + c[3 * R:4 * R].sum()
        dec += c[4 * R] + c[4 * R + 1] + c[4 * R + 2]
        n += 1
        for rr in range(R):
            r1[R][rr] += c[rr] + c[R + rr] + c[2 * R + rr] + c[3 * R + rr]
        nR[R] += 1
    return {"KO": round(ko / n, 4), "SUB": round(sub / n, 4), "DEC": round(dec / n, 4), "finish": round((ko + sub) / n, 4), "n": int(n),
            "by_round_3": [round(x / max(1, nR[3]), 4) for x in r1[3]], "by_round_5": [round(x / max(1, nR[5]), 4) for x in r1[5]]}


act = {"KO": 0, "SUB": 0, "DEC": 0, "n": 0, "r3": [0] * 3, "r5": [0] * 5, "n3": 0, "n5": 0}
for i in IDS:
    y = YS[i]
    if y is None:
        continue
    act["n"] += 1
    act["KO" if y["cls"] == "KO" else ("SUB" if y["cls"] == "SUB" else "DEC")] += 1
    R = FIGHTS[i]["rounds"]
    act["n%d" % R] += 1
    if y["cls"] in ("KO", "SUB"):
        act["r%d" % R][min(R, y["round"]) - 1] += 1
OUT["base_rates"] = {"actual": {"KO": round(act["KO"] / act["n"], 4), "SUB": round(act["SUB"] / act["n"], 4), "DEC": round(act["DEC"] / act["n"], 4),
                                "finish": round((act["KO"] + act["SUB"]) / act["n"], 4), "n": act["n"],
                                "by_round_3": [round(x / act["n3"], 4) for x in act["r3"]], "by_round_5": [round(x / act["n5"], 4) for x in act["r5"]]},
                     "models": {n: shares(n, IDS) for n in ("S", "S2", "engine_v4", "engine_v10", "cmp4|open", "v10|open", "v10np|open", "v7|open", "v6|open", "cmp4|close", "v10|close")},
                     "props_pool@close": shares("props_pool@close", IDS, has_props), "S2@close (props bouts)": shares("S2@close", IDS, has_props)}

# =============================================================== 10. per-segment (descriptive): open regime winner, packages vs cmp4 and vs the opener
seg = {}
for sname, pred in (("3-round", lambda i: FIGHTS[i]["rounds"] == 3), ("5-round", lambda i: FIGHTS[i]["rounds"] == 5),
                    ("women", lambda i: "Women" in (FIGHTS[i].get("division") or "")), ("men", lambda i: "Women" not in (FIGHTS[i].get("division") or "")),
                    ("opener favourite >= 0.70", lambda i: max(WIN["opener"][i], 1 - WIN["opener"][i]) >= 0.70),
                    ("opener favourite < 0.70", lambda i: max(WIN["opener"][i], 1 - WIN["opener"][i]) < 0.70)):
    ids = [i for i in IDS if pred(i)]
    seg[sname] = {"n_fights": len(ids), "cmp4 - opener": win_paired("cmp4_open", "opener", ids), "fwd - opener": win_paired("fwd_open", "opener", ids),
                  "v10 - cmp4": win_paired("v10_open", "cmp4_open", ids)}
OUT["segments_descriptive"] = seg

# =============================================================== 11. who x how x when vs model S (tools/methodround.py --score on the vault)
def mr_score(name, need=None):
    sub = {}
    for i in IDS:
        if need and not need(i):
            continue
        c = CELLS[name][i][0]
        sub[i] = {"cells": [float(x) for x in (c / c.sum())]}
    with tempfile.TemporaryDirectory() as td:
        inp, outp = os.path.join(td, "in.json"), os.path.join(td, "out.json")
        json.dump(sub, open(inp, "w"))
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "methodround.py"), "--score", inp, "--score-from", "2026-01-01", "--score-until", "2026-11-01",
                        "--score-out", outp, "--backtest", os.path.join(V, "backtest_vault.json")], check=True, capture_output=True, env=dict(os.environ, OMP_NUM_THREADS="1"))
        return json.load(open(outp))


mrs = {}
for n in ("cmp4|open", "cmp4|close", "cmp4|none", "v10|open", "v10|close", "v10|none", "v7|open", "v6|open", "S2", "engine_v4", "engine_v10"):
    try:
        mrs[n] = mr_score(n)
    except Exception as ex:   # descriptive; record the failure
        mrs[n] = {"error": str(ex)[:300]}
OUT["methodround_vs_S"] = mrs

# =============================================================== 12. drift rule state (6.5.1) and failure criteria
DM = J("data/predictions/drift_monitor.json")
OUT["drift_rule"] = {"rule_a": "evaluated once, at audit 1: NOT TRIGGERED (production no-line stack slope 0.561 [0.380, 0.774]; CI excludes 1); audit 2 has no rule-(a) trigger",
                     "production_no_line_stack": {"blindtest_stack.json sha256_16": "ded17ce026bbff29", "moe_page.json sha256_16": "34a33d1837e9b912",
                                                  "setting": "h 1.5 with its temperature (unchanged since audit 1)"},
                     "rule_b": DM["rule_b"], "drift_monitor_built": DM["meta"]["built"],
                     "ledger_no_line_column_fwd_4_3_on": "ML v2 no-line stack (2019-2023 weights) = fwd_none here",
                     "vault_slopes_descriptive": {m: OUT["winner_benchmarks"][m]["slope"] for m in ("cmp4_none", "fwd_none", "ml2stack_lr_prod_none", "ml2stack_blend_prod_none")}}
fc = {}
fc["cmp4 vs opener (headline)"] = {"open_winner_ci_upper_gt_0.002": not head["cmp4_minus_opener"]["check_upper_le_0.002"]["pass"],
                                   "detail": head["cmp4_minus_opener"]["check_upper_le_0.002"],
                                   "calibration_slope_outside_0.8_1.6": OUT["winner_benchmarks"]["cmp4_open"]["slope_outside_0.8_1.6"],
                                   "slope": OUT["winner_benchmarks"]["cmp4_open"]["slope"], "stat_lines": "n/a (cmp4's simulator is the v4 reference)"}
fc["forward package vs opener"] = {"open_winner_ci_upper_gt_0.002": not head["fwd_minus_opener"]["check_upper_le_0.002"]["pass"],
                                   "detail": head["fwd_minus_opener"]["check_upper_le_0.002"],
                                   "calibration_slope_outside_0.8_1.6": OUT["winner_benchmarks"]["fwd_open"]["slope_outside_0.8_1.6"], "slope": OUT["winner_benchmarks"]["fwd_open"]["slope"]}
v10o = head["side_lines_vs_cmp4_open_winner"]["v10 (= v7 = v6 winner: ML v2 blend-head production stack)"]
for side, stat in (("v10", "v10"), ("v7", None), ("v6", None), ("v8 (engine)", "v8")):
    rec = {}
    if side != "v8 (engine)":
        rec["open_winner_ci_upper_gt_0.002"] = not v10o["check_upper_le_0.002"]["pass"]
        rec["detail"] = v10o["check_upper_le_0.002"]
        rec["calibration_slope_outside_0.8_1.6"] = OUT["winner_benchmarks"]["ml2stack_blend_prod_open"]["slope_outside_0.8_1.6"]
        rec["slope"] = OUT["winner_benchmarks"]["ml2stack_blend_prod_open"]["slope"]
    else:
        pv = OUT["evalv"]["v8"]["compare"] or {}
        rec["engine_winner_vs_v4"] = OUT["winner_paired"]["engine_v10 - engine_v4"]
        rec["calibration_slope_outside_0.8_1.6"] = OUT["winner_benchmarks"]["engine_v10"]["slope_outside_0.8_1.6"]
        rec["slope"] = OUT["winner_benchmarks"]["engine_v10"]["slope"]
    if stat:
        rec["any_stat_line_deviance_worse_ci_excl_0"] = bool(OUT["statlines"][stat]["deviance_worse_ci_excl_0"])
        rec["worse_stats"] = OUT["statlines"][stat]["deviance_worse_ci_excl_0"]
    else:
        rec["stat_lines"] = "the v4 simulator (v7) / the v6 engine: no stat-line contrast pre-registered for this side line"
    fc[side] = rec
OUT["failure_criteria_no_decision"] = fc
OUT["debut_method_model"] = {"note": "tools/vault_audit1/debut_vault.py re-run into <vault>/audit2/debut_vroot (frozen debut.json f6709d52292ccc83, unchanged since audit 1); identical to audit 1's summary (seen fights)",
                              "summary": J(os.path.join(AUD, "debut_vroot", "audit1", "debut_vault.json"))["summary"],
                              "identical_to_audit1": J(os.path.join(AUD, "debut_vroot", "audit1", "debut_vault.json"))["summary"] == J(os.path.join(AUD1, "debut_vault.json"))["summary"]}
import hashlib
sha16 = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()[:16]
OUT["inputs_sha256_16"] = {os.path.relpath(p, V) if p.startswith(V) else os.path.relpath(p, ROOT): sha16(p) for p in [
    os.path.join(V, "backtest_vault.json"), os.path.join(V, "market_vault.json"), os.path.join(V, "durability_vault.json"), os.path.join(V, "preufc_vault.json"),
    os.path.join(AUD1, "mlrates_vault.json"), os.path.join(AUD1, "priors_asof_vault.json"), os.path.join(AUD1, "sos_wf_vault.json"), os.path.join(AUD1, "models_vault.json"),
    os.path.join(AUD1, "ml2_cache", "table_vault.pkl"), os.path.join(AUD, "ml2s2_vault.json"), os.path.join(AUD, "statlines_targets_vault.json"),
    os.path.join(AUD, "cmp_stack_v4pkg_fit2025.json"), os.path.join(AUD, "harness_vault.json"), os.path.join(AUD, "stat_v10_vault.json"), os.path.join(AUD, "stat_v8_vault.json"),
    os.path.join(AUD, "evalv", "v4_vault.json"), os.path.join(AUD, "evalv", "v10_vault.json"), os.path.join(AUD, "evalv", "v8_vault.json"), os.path.join(AUD, "evalv", "v7cmp_val.json"),
    os.path.join(AUD, "aux_vault.json"), os.path.join(ROOT, DER + "v6_stacks.json"), os.path.join(ROOT, DER + "mr_s2.json"), os.path.join(ROOT, DER + "methodround.json"),
    os.path.join(ROOT, DER + "props.json"), os.path.join(ROOT, DER + "statlines.json"), os.path.join(ROOT, DER + "ml2_trees.json"), os.path.join(ROOT, DER + "ml2.json"),
    os.path.join(ROOT, DER + "forward_models.json"), os.path.join(ROOT, DER + "embed_model.json"), os.path.join(ROOT, DER + "embed_blend_fh.json"), os.path.join(ROOT, DER + "oppadj.json"),
    os.path.join(ROOT, DER + "blindtest.json"), os.path.join(ROOT, DER + "v10/gate_train.json"), os.path.join(ROOT, DER + "v10/look_val.json"),
    os.path.join(ROOT, DER + "v6/gate_train.json"), os.path.join(ROOT, DER + "v6/look_val.json"), os.path.join(ROOT, DER + "v10/gate_stat.json")]}
OUT["harness_meta"] = {k: H["meta"][k] for k in ("packages", "sims_per_order", "kinds", "n_fights", "failed", "wall_s")}
OUT["pkg_manifest"] = J(os.path.join(AUD, "pkgs", "manifest.json"))
OUT["ml2s2_checks"] = J(os.path.join(AUD, "ml2s2_vault.json"))["meta"]["checks"]
OUT["cmp_stack_fit2025"] = {k: J(os.path.join(AUD, "cmp_stack_v4pkg_fit2025.json"))["meta"][k] for k in ("fit_info", "rows_2024_2025", "reproduction_fit2023")}
OUT["targets_meta"] = {k: v for k, v in J(os.path.join(AUD, "statlines_targets_vault.json"))["meta"].items()}
json.dump(OUT, open(os.path.join(AUD, "score_vault2.json"), "w"), indent=1, default=float)

# =============================================================== summary
def fmt(d):
    return "%+.4f [%+.4f, %+.4f]" % (d["diff"], d["ci"][0], d["ci"][1])


print("\nHEADLINE (open, %d decisive): opener %.4f, cmp4 %.4f, fwd %.4f, close %.4f" % (head["levels"]["opener"]["n"], head["levels"]["opener"]["winLL"],
      head["levels"]["cmp4_open"]["winLL"], head["levels"]["fwd_open"]["winLL"], head["levels"]["close"]["winLL"]))
print("  cmp4 - opener", fmt(head["cmp4_minus_opener"]), head["cmp4_minus_opener"]["check_upper_le_0.002"])
print("  fwd - opener ", fmt(head["fwd_minus_opener"]), head["fwd_minus_opener"]["check_upper_le_0.002"])
print("  cmp4 - fwd   ", fmt(head["cmp4_minus_fwd"]))
print("  v10 - cmp4   ", fmt(v10o))
for kind, rk in regimes.items():
    for k, v in rk.items():
        p = v["paired"]
        print("  %-11s %-44s win %s | bin7 %s | method %s | joint %s" % (kind, k, fmt(p["winLL"]) if "winLL" in p else "-", fmt(p["bin7"]), fmt(p["method"]), fmt(p["joint"])))
for v in ("v10", "v8"):
    s = OUT["statlines"][v]
    print("  stat lines %s - v4: total %s; worse %s; better %s" % (v, fmt(s["paired_all_minus_cmp4"]["total"]), s["deviance_worse_ci_excl_0"], s["deviance_better_ci_excl_0"]))
print("  failure criteria:", json.dumps({k: {kk: vv for kk, vv in v.items() if kk not in ("detail", "engine_winner_vs_v4")} for k, v in fc.items()}))
print("wrote", os.path.join(AUD, "score_vault2.json"))
