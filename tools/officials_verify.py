"""
officials_verify.py - adversarial review of tools/officials.py (v8 officials component): an independent
re-implementation of the judge model's headline, plus data-join and selection checks.

Does the home term (and named-judge effects) improve held-out decision predictions given the real round stats?
Fresh code: its own likelihood (cards with observed round scores only; round winner per judge, logistic own noise,
panel-shared Gaussian noise whose sd depends on the stat edge, Gauss-Hermite 12 nodes), its own 10-8 GLM (winner-
oriented stat differentials, year levels as a random walk, judge intercepts), its own simulator, metrics and
event-cluster bootstrap, and event-cluster sandwich SEs. Only the parsed decision rows (officials.build_data:
cards oriented to A/B, checked here by `--checks`) are shared with tools/officials.py.

Walk-forward folds: test (fit < 2024, score 2024-25), tune22 (fit < 2022, score 2022-23), tune (fit < 2019, score
2019-23). No 2026 fight is loaded (officials.build_data drops them).

Usage
  python3 tools/officials_verify.py <variant,...> <fold> [tag]   # e.g. league,lh,lh_abroad,lh_fw,j,jh test all
  python3 tools/officials_verify.py --checks                       # card orientation, nationality selection
  python3 tools/officials_verify.py --collect                      # data/derived/officials_verify.json
Outputs: out/officials/verify/fresh_<fold>_<tag>.json (per fight), data/derived/officials_verify.json (summary).
Report: the "Verification log" section of research/model_officials.md.
"""
import os, sys, json, pickle, math, time
os.environ.setdefault("XLA_FLAGS", "--xla_cpu_multi_thread_eigen=false intra_op_parallelism_threads=1")
import numpy as np
import jax, jax.numpy as jnp
from scipy.optimize import minimize
jax.config.update("jax_enable_x64", True)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "out", "officials", "verify")
os.makedirs(HERE, exist_ok=True)
SUMMARY = os.path.join(ROOT, "data", "derived", "officials_verify.json")


def _rows():
    p = os.path.join(HERE, "rows.pkl")
    if not os.path.exists(p):
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import officials as O
        F, S, Dd, rows, nat, info, notes, data_max = O.load_all()
        for r in rows:
            r.pop("Xall", None)
        pickle.dump({"rows": rows, "nat": nat, "info": info, "EVENT_OF": O.EVENT_OF, "JUDGE_NAMES": O.JUDGE_NAMES},
                    open(p, "wb"))
    return pickle.load(open(p, "rb"))


D = _rows()
ROWS, NAT, EVENT_OF = D["rows"], D["nat"], D["EVENT_OF"]
FW = json.load(open(os.path.join(ROOT, "data", "derived", "fightweek.json")))["fights"]

FOLDS = {"test": (2024, [2024, 2025]), "tune22": (2022, [2022, 2023]), "tune": (2019, [2019, 2020, 2021, 2022, 2023]),
         "test25": (2025, [2025])}
TAU = np.array([0.0752, 0.0740, 0.1250, 0.0978])   # n, v, p, g (analyst's tuned tau x 0.5); c handled in the 10-8 GLM
TAU_C = 0.2014


def home_diff(r, source):
    if source == "wikidata":
        a, b = NAT.get(r["n0"]), NAT.get(r["n1"])
        return (int(r["country"] in a) - int(r["country"] in b)) if (a and b) else 0
    if source == "fightweek":
        f = FW.get(r["fid"].rsplit("/", 1)[-1])
        if f is None:                     # before 2012: fall back to Wikidata
            return home_diff(r, "wikidata")
        ha, hb = f["home_any"]["A"], f["home_any"]["B"]
        if ha is None or hb is None:
            return 0
        return int(bool(ha)) - int(bool(hb))
    raise ValueError(source)


def prep(rows, jidx, home_src):
    """Round arrays: X [n,8], t, home, us, judge idx [n,3] (len(jidx) = unknown), win sign [n,3] (+1 A, -1 B,
    0 = not observed or 10-10), and per-fight bookkeeping."""
    X, T, H, US, J, Y, F, YR = [], [], [], [], [], [], [], []
    for fi, r in enumerate(rows):
        R = r["R"]
        hd = home_diff(r, home_src)
        js, ys = [], []
        for c in r["cards"]:
            js.append(jidx.get(c[0], len(jidx)))
            if c[4] is None:
                ys.append(np.zeros(R))
            else:
                o = np.asarray(c[4], int)
                ys.append(np.where(o > 2, 1.0, np.where(o < 2, -1.0, 0.0)))
        X.append(r["X"]); T.append(np.full(R, (r["year"] - 2017) / 10)); H.append(np.full(R, hd))
        US.append(np.full(R, float(r["country"] == "USA"))); J.append(np.tile(js, (R, 1)))
        Y.append(np.stack(ys, 1)); F.append(np.full(R, fi)); YR.append(np.full(R, r["year"]))
    return dict(X=np.vstack(X), t=np.concatenate(T), home=np.concatenate(H), us=np.concatenate(US),
                J=np.vstack(J).astype(np.int32), Y=np.vstack(Y), f=np.concatenate(F), yr=np.concatenate(YR))


XQ, WQ = np.polynomial.hermite.hermgauss(12)
XQ, WQ = XQ * math.sqrt(2), WQ / math.sqrt(math.pi)
NG = 8 + 3 + 1 + 1 + 2   # beta, w, log_su, kappa, h(US, abroad)


def unpack(p, nJ):
    g = p[:NG]
    E = p[NG:].reshape(nJ, 4) if nJ else jnp.zeros((0, 4))
    return g[:8], g[8:11], g[11], g[12], g[13:15], E


def make_nll(d, nJ, flags):
    use_home, use_kappa, use_judges, home_abroad_only = flags
    X, t, home, us, J, Y = (jnp.asarray(d[k]) for k in ("X", "t", "home", "us", "J", "Y"))
    if nJ == 0:
        J = jnp.zeros_like(J)
    obs = (Y != 0)
    keep = np.asarray(obs.any(1))
    X, t, home, us, J, Y, obs = X[keep], t[keep], home[keep], us[keep], J[keep], Y[keep], obs[keep]

    def per_round(p):
        b, w, lsu, kap, h, E = unpack(p, nJ)
        Ez = jnp.vstack([E * use_judges, jnp.zeros((1, 4))])[J]          # n x 3 x 4
        V = X[:, :3] @ b[:3]; K = X[:, 3] * b[3]; G = X[:, 4:] @ b[4:]
        core0 = jnp.exp(w[0] * t) * V + jnp.exp(w[1] * t) * K + jnp.exp(w[2] * t) * G
        hU = h[0] * (1 - home_abroad_only)
        hh = use_home * (hU * us + h[1] * (1 - us)) * home
        core = (jnp.exp(Ez[..., 1] + w[0] * t[:, None]) * V[:, None] + jnp.exp(Ez[..., 2] + w[1] * t[:, None]) * K[:, None]
                + jnp.exp(Ez[..., 3] + w[2] * t[:, None]) * G[:, None] + hh[:, None])  # n x 3
        s = jnp.exp(lsu) * jnp.exp(-use_kappa * kap * jnp.abs(core0))
        u = s[:, None] * XQ[None, :]                                                    # n x Q
        eta = jnp.exp(Ez[..., 0])[:, :, None] * (core[:, :, None] + u[:, None, :])      # n x 3 x Q
        ll = jnp.where(obs[:, :, None], jax.nn.log_sigmoid(Y[:, :, None] * eta), 0.0).sum(1)  # n x Q
        return jax.scipy.special.logsumexp(ll + jnp.log(WQ)[None, :], axis=1)

    def nll(p):
        b, w, lsu, kap, h, E = unpack(p, nJ)
        pen = 0.5 * jnp.sum((E / TAU[None, :]) ** 2) * use_judges + 0.5 * 1e-2 * (jnp.sum(w ** 2) + jnp.sum(h ** 2)) \
            + 0.5 * kap ** 2 + 0.5 * (lsu / 2) ** 2
        return -jnp.sum(per_round(p)) + pen
    return jax.jit(nll), jax.jit(per_round), keep


def fit_winner(d, nJ, flags, p0=None):
    nll, per_round, keep = make_nll(d, nJ, flags)
    vg = jax.jit(jax.value_and_grad(nll))
    if p0 is None:
        p0 = np.concatenate([[0.2, 0.15, 0.12, 2.5, 0.3, 0.6, 0.9, 0.3], [0, 0, 0], [0.5], [0.0], [0, 0], np.zeros(4 * nJ)])

    def f(p):
        v, g = vg(jnp.asarray(p))
        return float(v), np.asarray(g, float)
    res = minimize(f, p0, jac=True, method="L-BFGS-B", options={"maxiter": 5000, "maxcor": 30, "gtol": 1e-5, "ftol": 1e-13})
    return res.x, res, nll, per_round, keep


def cluster_se(p, d, nJ, flags, keep):
    """Event-cluster sandwich SEs for the global block (judge effects held fixed)."""
    _, per_round, _ = make_nll(d, nJ, flags)
    pg = jnp.asarray(p[:NG]); pe = jnp.asarray(p[NG:])
    fr = lambda g: per_round(jnp.concatenate([g, pe]))
    Jac = np.asarray(jax.jacfwd(fr)(pg))                      # n_rounds x NG
    H = np.asarray(jax.hessian(lambda g: -jnp.sum(fr(g)))(pg))
    ev = np.array([EVENT_OF[ROWS_FIT[i]["fid"]] for i in d["f"][keep]])
    u, gi = np.unique(ev, return_inverse=True)
    S = np.zeros((len(u), NG)); np.add.at(S, gi, Jac)
    H = H + np.diag(np.r_[np.zeros(8), np.full(3, 1e-2), [0.25], [1.0], np.full(2, 1e-2)])
    Hi = np.linalg.pinv(H)
    sand = Hi @ (S.T @ S) @ Hi
    return np.sqrt(np.clip(np.diag(Hi), 0, None)), np.sqrt(np.clip(np.diag(sand), 0, None))


# ---------------------------------------------------------------- 10-8 GLM (fresh)
def ten8_data(rows, jidx):
    Z, Yy, YR, JJ = [], [], [], []
    for r in rows:
        for c in r["cards"]:
            if c[4] is None:
                continue
            o = np.asarray(c[4], int)
            for k, oc in enumerate(o):
                if oc == 2:
                    continue
                sgn = 1.0 if oc > 2 else -1.0
                Z.append(sgn * r["X"][k]); Yy.append(float(oc in (0, 4))); YR.append(r["year"]); JJ.append(jidx.get(c[0], len(jidx)))
    return np.array(Z), np.array(Yy), np.array(YR), np.array(JJ)


def fit_ten8(rows, jidx, last_year, use_judges):
    Z, y, yr, jj = ten8_data(rows, jidx)
    years = list(range(2008, last_year + 1))
    yi = np.clip(yr, 2008, last_year) - 2008
    nY, nJ = len(years), len(jidx)
    Zj, yj, yij, jjj = map(jnp.asarray, (Z, y, yi, jj))

    def nll(p):
        b, c, e = p[:8], p[8:8 + nY], p[8 + nY:]
        ez = jnp.concatenate([e * use_judges, jnp.zeros(1)])
        eta = Zj @ b + c[yij] + ez[jjj]
        ll = jnp.sum(yj * jax.nn.log_sigmoid(eta) + (1 - yj) * jax.nn.log_sigmoid(-eta))
        return -ll + 0.5 * jnp.sum(e ** 2) / TAU_C ** 2 * use_judges + 0.5 * jnp.sum(jnp.diff(c) ** 2) / 0.3 ** 2 + 1e-4 * jnp.sum(b ** 2)
    vg = jax.jit(jax.value_and_grad(nll))
    p0 = np.r_[np.zeros(8), np.full(nY, -3.0), np.zeros(nJ)]
    res = minimize(lambda p: tuple(np.asarray(x, float) if i else float(x) for i, x in enumerate(vg(jnp.asarray(p)))),
                   p0, jac=True, method="L-BFGS-B", options={"maxiter": 3000, "gtol": 1e-6})
    p = res.x
    return {"b": p[:8], "c_last": p[8 + nY - 1], "c": dict(zip(years, p[8:8 + nY])), "e": p[8 + nY:]}


# ---------------------------------------------------------------- simulator (fresh)
def simulate(rows, jidx, p, nJ, flags, t8, e10, ded_rate, home_src, nsim=20000, seed=123):
    use_home, use_kappa, use_judges, abroad_only = flags
    b, w, lsu, kap, h, E = unpack(np.asarray(p), nJ)
    b, w, h, E = map(np.asarray, (b, w, h, E))
    lsu, kap = float(lsu), float(kap)
    Ez = np.vstack([E * use_judges, np.zeros((1, 4))]) if nJ else np.zeros((1, 4))
    ce = np.r_[t8["e"] * use_judges, 0.0] if len(t8["e"]) else np.zeros(1)
    rng = np.random.default_rng(seed)
    P = np.zeros((len(rows), 7))
    for fi, r in enumerate(rows):
        X = r["X"]; R = len(X)
        t = (r["year"] - 2017) / 10
        us = float(r["country"] == "USA")
        hd = home_diff(r, home_src)
        hh = use_home * ((0 if abroad_only else h[0]) * us + h[1] * (1 - us)) * hd
        V, K, G = X[:, :3] @ b[:3], X[:, 3] * b[3], X[:, 4:] @ b[4:]
        core0 = np.exp(w[0] * t) * V + np.exp(w[1] * t) * K + np.exp(w[2] * t) * G
        s = math.exp(lsu) * np.exp(-use_kappa * kap * np.abs(core0))
        u = rng.standard_normal((nsim, R)) * s[None, :]
        tot = np.zeros((nsim, 3))
        for j, c in enumerate(r["cards"]):
            ji = jidx.get(c[0], nJ)
            e = Ez[min(ji, len(Ez) - 1)]
            core = np.exp(e[1] + w[0] * t) * V + np.exp(e[2] + w[1] * t) * K + np.exp(e[3] + w[2] * t) * G + hh
            eta = np.exp(e[0]) * (core[None, :] + u)
            aw = rng.random((nsim, R)) < 1 / (1 + np.exp(-eta))
            sg = np.where(aw, 1.0, -1.0)
            z8 = t8["c_last"] + ce[min(ji, len(ce) - 1)] + sg[:, :, None].__mul__(X[None, :, :]) @ t8["b"]
            big = rng.random((nsim, R)) < 1 / (1 + np.exp(-z8))
            tie = rng.random((nsim, R)) < e10
            m = np.where(tie, 0, np.where(big, 2, 1)) * sg          # round margin for A
            tot[:, j] = m.sum(1)
        dd = rng.random(nsim) < ded_rate
        side = np.where(rng.random(nsim) < 0.5, 1.0, -1.0)
        tot = tot - (dd * side)[:, None]
        ca, cb = (tot > 0).sum(1), (tot < 0).sum(1)
        cd = 3 - ca - cb
        cls = np.full(nsim, 3)
        cls[ca == 3] = 0; cls[(ca == 2) & (cb == 1)] = 1; cls[(ca == 2) & (cd == 1)] = 2
        cls[(cb == 2) & (cd == 1)] = 4; cls[(cb == 2) & (ca == 1)] = 5; cls[cb == 3] = 6
        P[fi] = np.bincount(cls, minlength=7) / nsim
    return P


def actual(r):
    if r["winner"] == -1:
        return 3
    k = {"U-DEC": 0, "S-DEC": 1, "M-DEC": 2}[r["cat"]]
    return k if r["winner"] == 0 else 6 - k


def losses(P, rows):
    y = np.array([actual(r) for r in rows])
    P7 = np.clip(P, 1e-4, 1); P7 /= P7.sum(1, keepdims=True)
    l7 = -np.log(P7[np.arange(len(y)), y])
    pA, pB = P[:, :3].sum(1), P[:, 4:].sum(1)
    q = np.clip(pA / np.maximum(pA + pB, 1e-12), 1e-4, 1 - 1e-4)
    ya = y < 3
    lw = np.where(y != 3, -(ya * np.log(q) + (~ya) * np.log(1 - q)), np.nan)
    pn = np.clip(1 - P[:, 0] - P[:, 6], 1e-4, 1 - 1e-4); yn = ~np.isin(y, [0, 6])
    ls = -(yn * np.log(pn) + (~yn) * np.log(1 - pn))
    return {"l7": l7, "lw": lw, "ls": ls, "pred_split": float(pn.mean()), "obs_split": float(yn.mean())}


VARIANTS = {  # use_home, use_kappa, use_judges, abroad_only, home source
    "league0": ((0, 0, 0, 0), "wikidata"),
    "league": ((0, 1, 0, 0), "wikidata"),
    "lh": ((1, 1, 0, 0), "wikidata"),
    "lh_abroad": ((1, 1, 0, 1), "wikidata"),
    "lh_fw": ((1, 1, 0, 0), "fightweek"),
    "lh_fw_abroad": ((1, 1, 0, 1), "fightweek"),
    "j": ((0, 1, 1, 0), "wikidata"),
    "jh": ((1, 1, 1, 0), "wikidata"),
    "jh_fw": ((1, 1, 1, 0), "fightweek"),
    "jh_fw_abroad": ((1, 1, 1, 1), "fightweek"),
}


# ---------------------------------------------------------------- data checks (joins, nationality selection)
def data_checks():
    from collections import Counter
    SC_A, SC_B = np.array([8, 9, 10, 10, 10]), np.array([10, 10, 10, 9, 8])
    bad, codes_bad, ex = [], 0, []
    for r in ROWS:
        cards, w, cat = r["cards"], r["winner"], r["cat"]
        ca = sum(c[2] > c[3] for c in cards); cb = sum(c[2] < c[3] for c in cards); cd = 3 - ca - cb
        if w in (0, 1):
            x, y = (ca, cb) if w == 0 else (cb, ca)
            ok = (cat == "U-DEC" and x == 3) or (cat == "S-DEC" and x == 2 and y == 1) or (cat == "M-DEC" and x == 2 and cd == 1)
            if not ok:
                bad.append({"year": r["year"], "bout": f"{r['n0']} vs {r['n1']}", "cat": cat,
                            "cards_AB": [[c[1], c[2], c[3]] for c in cards], "src": r["src"]})
        for c in cards:
            if c[4] is not None:
                dA, dB = r["dfix"] if r["dfix"] is not None else (0, 0)
                if (SC_A[c[4]].sum() - dA, SC_B[c[4]].sum() - dB) != (c[2], c[3]):
                    codes_bad += 1
    n_obs_cards = sum(c[4] is not None for r in ROWS for c in r["cards"])
    fw_order = Counter()
    pnames = {}
    fwp = json.load(open(os.path.join(ROOT, "data", "derived", "fightweek.json")))["fighters"]
    for sl, v in fwp.items():
        pnames[sl] = v["name"]
    for r in ROWS:
        f = FW.get(r["fid"].rsplit("/", 1)[-1])
        if f is None:
            continue
        a, b = pnames.get(f["A"]), pnames.get(f["B"])
        fw_order["same" if (a, b) == (r["n0"], r["n1"]) else "swapped" if (b, a) == (r["n0"], r["n1"]) else "spelling"] += 1
    # Wikidata coverage by result (fightweek nationality, 99.9% coverage 2012+, identifies the local fighter)
    cov = Counter()
    for r in ROWS:
        f = FW.get(r["fid"].rsplit("/", 1)[-1])
        if f is None or r["winner"] == -1:
            continue
        for side, nm, key in ((0, r["n0"], "A"), (1, r["n1"], "B")):
            grp = ("abroad" if r["country"] != "USA" else "usa") + ("_local" if f["home_any"][key] else "_visitor")
            res = "won" if r["winner"] == side else "lost"
            cov[(grp, res, "n")] += 1
            cov[(grp, res, "known")] += bool(NAT.get(nm))
    coverage = {f"{g}_{res}": cov[(g, res, "known")] / cov[(g, res, "n")] for g in
                ("abroad_local", "abroad_visitor", "usa_local", "usa_visitor") for res in ("won", "lost") if cov[(g, res, "n")]}
    raw = {}
    for src in ("wikidata", "fightweek"):
        n = Counter()
        for r in ROWS:
            if r["winner"] == -1 or r["year"] < 2012:
                continue
            hd = home_diff(r, src)
            if hd != 0:
                k = "abroad" if r["country"] != "USA" else "usa"
                n[k, "n"] += 1
                n[k, "w"] += int((r["winner"] == 0) == (hd > 0))
        raw[src] = {k: {"decisions": n[k, "n"], "home_win_rate": n[k, "w"] / n[k, "n"]} for k in ("abroad", "usa")}
    return {"decisions": len(ROWS), "cards_contradict_result": bad, "observed_cards": n_obs_cards,
            "observed_cards_codes_not_matching_total": codes_bad, "fightweek_order_vs_ufcstats": dict(fw_order),
            "wikidata_known_share_by_result_2012_on": coverage, "raw_home_decision_win_rate_2012_on": raw,
            "a_win_share": float(np.mean([r["winner"] == 0 for r in ROWS if r["winner"] != -1]))}


PAIRS = [("lh", "league"), ("lh_abroad", "league"), ("lh_fw", "league"), ("lh_fw_abroad", "league"),
         ("lh_abroad", "lh"), ("lh_fw", "lh"), ("j", "league"), ("jh", "lh"), ("jh", "league"),
         ("jh_fw_abroad", "lh_fw_abroad"), ("jh_fw_abroad", "league")]


def boot(a, b, g, n=4000, seed=0):
    a, b, g = np.asarray(a, float), np.asarray(b, float), np.asarray(g)
    m = ~np.isnan(a) & ~np.isnan(b)
    a, b, g = a[m], b[m], g[m]
    d = a - b
    u, gi = np.unique(g, return_inverse=True)
    s_ = np.bincount(gi, d); c = np.bincount(gi).astype(float)
    pk = np.random.default_rng(seed).integers(0, len(u), (n, len(u)))
    bs = s_[pk].sum(1) / c[pk].sum(1)
    return {"mean": float(d.mean()), "lo": float(np.percentile(bs, 2.5)), "hi": float(np.percentile(bs, 97.5))}


def collect():
    out = {"meta": {"tool": "tools/officials_verify.py", "reviews": "tools/officials.py, data/derived/officials.json",
                    "note": "independent re-fit; paired differences with event-cluster bootstrap (4,000 draws); "
                            "negative = first model better for log losses; SEs: model (inverse Hessian) and "
                            "event-cluster sandwich, judge effects held fixed",
                    "variants": {k: {"home": f[0], "closeness": f[1], "named_judges": f[2], "abroad_only": f[3],
                                     "nationality": src} for k, (f, src) in VARIANTS.items()}},
           "folds": {}}
    names = ["b_head", "b_body", "b_leg", "b_kd", "b_td", "b_ctrl", "b_sub", "b_rev", "w_volume", "w_kd", "w_grappling",
             "log_sigma_u", "kappa", "h_usa", "h_abroad"]
    for fold in ("test", "tune22", "tune"):
        p = os.path.join(HERE, f"fresh_{fold}_all.json")
        if not os.path.exists(p):
            continue
        o = json.load(open(p))
        V, g = o["variants"], o["events"]
        blk = {k: o[k] for k in ("year_end", "eval_years", "n_train", "n_test", "nJ", "e10", "ded_rate")}
        blk["variants"] = {k: {"winner_logloss": float(np.nanmean(v["lw"])), "class7_logloss": float(np.mean(v["l7"])),
                               "split_logloss": float(np.mean(v["ls"])), "pred_split": v["pred_split"],
                               "obs_split": v["obs_split"], "converged": v["converged"],
                               "params": dict(zip(names, map(float, v["beta"] + v["w"] + [math.log(v["sigma_u"]), v["kappa"],
                                                                                         v["h_us"], v["h_abroad"]]))),
                               "se_model": dict(zip(names, v["se_model"])), "se_cluster": dict(zip(names, v["se_cluster"]))}
                           for k, v in V.items()}
        blk["paired"] = {f"{a} - {b}": {m: boot(V[a][k], V[b][k], g) for m, k in
                                        (("winner_logloss", "lw"), ("class7_logloss", "l7"), ("split_logloss", "ls"))}
                         for a, b in PAIRS if a in V and b in V}
        out["folds"][fold] = blk
    cp = os.path.join(HERE, "checks.json")
    if os.path.exists(cp):
        out["data_checks"] = json.load(open(cp))
    json.dump(out, open(SUMMARY, "w"), indent=1)
    print("wrote", SUMMARY)


if __name__ == "__main__":
    if sys.argv[1] == "--checks":
        json.dump(data_checks(), open(os.path.join(HERE, "checks.json"), "w"), indent=1)
        print(json.dumps(data_checks(), indent=1)[:3000])
        sys.exit(0)
    if sys.argv[1] == "--collect":
        collect()
        sys.exit(0)
    variants = sys.argv[1].split(",")
    fold = sys.argv[2]
    year_end, eval_years = FOLDS[fold]
    train = [r for r in ROWS if r["year"] < year_end]
    test = [r for r in ROWS if r["year"] in eval_years]
    ROWS_FIT = train
    from collections import Counter
    cnt = Counter(c[0] for r in train for c in r["cards"] if c[0] != "unknown" and c[4] is not None)
    jidx = {k: i for i, k in enumerate(sorted(cnt))}
    nJ = len(jidx)
    # 10-10 rate and deductions from training
    nr = sum(len(c[4]) for r in train for c in r["cards"] if c[4] is not None)
    n10 = sum(int((np.asarray(c[4]) == 2).sum()) for r in train for c in r["cards"] if c[4] is not None)
    e10 = n10 / nr
    dk = [r for r in train if r.get("ded_known") is not None and r["year"] >= year_end - 5]
    ded_rate = float(np.mean([sum(r["ded_known"]) > 0 for r in dk])) if dk else 0.02
    out = {"fold": fold, "year_end": year_end, "eval_years": eval_years, "n_train": len(train), "n_test": len(test),
           "nJ": nJ, "e10": e10, "ded_rate": ded_rate, "variants": {}}
    t8cache = {}
    for v in variants:
        flags, src = VARIANTS[v]
        t0 = time.time()
        d = prep(train, jidx, src)
        p, res, nll, per_round, keep = fit_winner(d, nJ if flags[2] else 0, flags) if not flags[2] else fit_winner(d, nJ, flags)
        nJv = nJ if flags[2] else 0
        if not flags[2]:
            pass
        uj = flags[2]
        if uj not in t8cache:
            t8cache[uj] = fit_ten8(train, jidx, year_end - 1, uj)
        t8 = t8cache[uj]
        se_m, se_c = cluster_se(p, d, nJv, flags, keep)
        P = simulate(test, jidx, p, nJv, flags, t8, e10, ded_rate, src)
        L = losses(P, test)
        g = p[:NG]
        out["variants"][v] = {"nll": float(res.fun), "converged": bool(res.success), "nit": int(res.nit),
                              "beta": g[:8].tolist(), "w": g[8:11].tolist(), "sigma_u": float(np.exp(g[11])),
                              "kappa": float(g[12]) * flags[1], "h_us": float(g[13]), "h_abroad": float(g[14]),
                              "se_model": se_m.tolist(), "se_cluster": se_c.tolist(),
                              "l7": L["l7"].tolist(), "lw": L["lw"].tolist(), "ls": L["ls"].tolist(),
                              "pred_split": L["pred_split"], "obs_split": L["obs_split"], "P": P.tolist(),
                              "t8_c_last": float(t8["c_last"]), "secs": time.time() - t0}
        print(f"{fold} {v}: nll {res.fun:.2f} ({res.nit} it, {res.message}) h_us {g[13]:+.3f} (se {se_m[13]:.3f}/{se_c[13]:.3f}) "
              f"h_abr {g[14]:+.3f} (se {se_m[14]:.3f}/{se_c[14]:.3f}) su {np.exp(g[11]):.3f} kap {g[12]*flags[1]:+.4f} | "
              f"7cls {L['l7'].mean():.4f} win {np.nanmean(L['lw']):.4f} split {L['ls'].mean():.4f} "
              f"pred/obs split {L['pred_split']:.3f}/{L['obs_split']:.3f}  {time.time()-t0:.0f}s", flush=True)
    out["fids"] = [r["fid"] for r in test]
    out["events"] = [EVENT_OF[r["fid"]] for r in test]
    tag = sys.argv[3] if len(sys.argv) > 3 else "_".join(variants)
    json.dump(out, open(os.path.join(HERE, f"fresh_{fold}_{tag}.json"), "w"))
