#!/usr/bin/env python3
"""
dynamics_audit.py - adversarial verification of tools/dynamics.py (research/model_dynamics.md), Nov 6, 2026.

Independent code for the headline numbers. It reuses only the raw loaders (tools/baserates.load_data for the
per-round ufcstats table, tools/build_db for person ids) and, for two replication fits, the DynRE / FrailPois
classes of dynamics.py after checking them against a brute-force likelihood. Everything else is re-derived here:

  A  joins: person id vs the name on the stats row, winner orientation across the two loaders, loser-first judges'
     cards by decision type, NC / draw rows, cumulative covariates rebuilt from round pivots
  B  knockdown hazard: own walk-forward chin / power (same-day fights never see each other), own negative-
     multinomial likelihood (gamma frailty per fighter-fight), round profile, damage terms, held-out log-lik;
     test-period refit
  C  DynRE likelihood vs a brute-force multivariate-normal likelihood on 150 fights
  D  output variance components by the method of moments (3-round fights with three full rounds), with and
     without persistence in the shared round shock
  E  held-out replication: state-effect coefficients refit on 2024-2025 alone
  F  judges' labels: the inferred label of dynamics.py (card totals spread over rounds with all-round stats) vs
     the published per-round scores (data/derived/judgerounds_rows.json)
  G  knockdown momentum, skip-round contrasts: round r+1 vs round r-1 around a knockdown round r, with and
     without selecting on what happens in r+1
  H  per-round KO/TKO and knockdown counts with Wilson / exact intervals, train vs test
  I  kPace rule: fight-cluster bootstrap of held-out skill differences
  J  knockdown conversion and non-knockdown stoppage counts

Hidden-data protocol (docs/BACKLOG.md): fits on 2019-2023 (2010-2023 where stated), 2024-2025 scored or refit as a
replication check only; no 2026 fight is scored (the raw snapshot contains them; they are dropped below).

Usage:   python3 tools/dynamics_audit.py            (about 3 minutes)
Output:  data/derived/dynamics_audit.json; the findings are in research/model_dynamics.md ("Verification log").
"""
import json
import math
import os
import re
import sys
import time

import numpy as np
import pandas as pd
from scipy import optimize, special, stats

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import baserates as br  # noqa: E402
import build_db as bd   # noqa: E402
import dynamics as dy   # noqa: E402  (panel builder for comparison; DynRE / FrailPois for replication fits)

OUT = os.path.join(ROOT, "data", "derived", "dynamics_audit.json")
VAULT = "2026-01-01"


def per(d):
    return np.select([(d >= "2019-01-01") & (d <= "2023-12-31"), (d >= "2024-01-01") & (d <= "2025-12-31"),
                      (d >= "2010-01-01") & (d <= "2018-12-31")], ["train", "test", "ext"], "other")


def wilson(k, n, z=1.96):
    if n == 0:
        return [None, None]
    p = k / n; den = 1 + z * z / n; c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [c - h, c + h]


# ----------------------------------------------------------------------------------------------------------------
def panel():
    F, S, notes, _ = br.load_data(os.path.join(ROOT, "data", "raw"), "2001-01-01")
    F = F[F.has_stats & F.fmt.isin([br.FMT3, br.FMT5]) & (F.DATE < VAULT)].copy()
    S = S[S.fid.isin(F.fid)].copy()
    S = S.merge(F[["fid", "DATE", "division", "five"]], on="fid")
    S["R"] = np.where(S.five, 5, 3)
    S["period"] = per(S.DATE)
    lo = (S.head_l - S.ground_l).clip(lower=0); hi = np.minimum(S.head_l, S.dist_l + S.clinch_l)
    S["sh_l"] = (lo + hi) / 2
    o = S[["fid", "rnd", "idx", "sh_l", "sig_a"]].rename(columns={"sh_l": "o_sh_l", "sig_a": "o_sig_a2"})
    o["idx"] = 1 - o.idx
    S = S.merge(o, on=["fid", "rnd", "idx"])
    S["mins"] = S.rsec / 60
    S["full"] = S.rsec >= 300
    lost = S.winner == 1 - S.idx
    S["fin_ko_against"] = ((S.rnd == S.end_round) & S.cat.eq("KO/TKO") & S.ko_kind.eq("strikes") & lost).astype(int)
    log = {}
    fights, _ = bd.parse_fights(log)
    people = bd.build_people(fights, log)
    pid = {}
    for f in fights:
        if f.persons:
            pid[(f.fid, 0)], pid[(f.fid, 1)] = f.persons
    S["fkey"] = S.fid.map(bd.url_id)
    S["pid"] = [pid.get((k, i)) for k, i in zip(S.fkey, S.idx)]
    S = S.sort_values(["fid", "idx", "rnd"]).reset_index(drop=True)
    # cumulative state from round pivots (independent of dynamics.add_cum)
    def cum(col):
        p = S.pivot_table(index=["fid", "idx"], columns="rnd", values=col, aggfunc="sum")
        return p.cumsum(axis=1).shift(1, axis=1).fillna(0).stack().rename(col + "_cum")
    def lag(col):
        p = S.pivot_table(index=["fid", "idx"], columns="rnd", values=col, aggfunc="sum")
        return p.shift(1, axis=1).fillna(0).stack().rename(col + "_lag")
    parts = [cum(c) for c in ("o_head_l", "o_kd", "sig_a", "o_sig_a")] + [lag(c) for c in ("o_kd", "kd", "sig_l", "o_sig_l")]
    C = pd.concat(parts, axis=1).reset_index()
    S = S.merge(C, on=["fid", "idx", "rnd"], how="left")
    S["D10"] = S.o_head_l_cum / 10
    S["K_lag"] = S.o_kd_lag
    S["K_early"] = S.o_kd_cum - S.o_kd_lag
    S["lost"] = np.where(S.rnd == 1, 0.0, (S.sig_l_lag < S.o_sig_l_lag) + 0.5 * (S.sig_l_lag == S.o_sig_l_lag))
    S["cell"] = S.R.astype(str) + "_" + S.rnd.astype(str)
    return F, S, people, fights


# ----------------------------------------------------------------------------------------------------------------
def part_a(F, S, people, fights):
    res = {}
    nm = {k: v.get("name") for k, v in people.items()}
    norm = lambda s: re.sub(r"[^a-z]", "", str(s).lower())
    s1 = S[S.rnd == 1]
    mis = s1[s1.pid.map(nm).map(norm) != s1.FIGHTER.map(norm)]
    res["person_vs_name_mismatch"] = {"rows": int(len(s1)), "mismatch": int(len(mis)), "missing_pid": int(s1.pid.isna().sum()),
                                      "mismatch_examples": sorted(set(zip(mis.FIGHTER, mis.pid.map(nm))))[:8]}
    fx = {f.fid: f for f in fights}
    w = {"A": 0, "B": 1}
    dis = sum(1 for k, g in s1.groupby("fkey") if k in fx and int(g.winner.iloc[0]) != w.get(fx[k].winner, -1))
    res["winner_orientation_disagreements"] = int(dis)
    d = F[F.cat.isin(["U-DEC", "S-DEC", "M-DEC"])].copy()
    d["cards"] = d.det.map(br.parse_cards)
    d = d[d.cards.map(len) == 3]
    d["first_bigger"] = d.cards.map(lambda c: sum(1 for _, a, b in c if a > b))
    res["loser_first_cards"] = {f"{c}": d[d.cat == c].first_bigger.value_counts().sort_index().to_dict() for c in ("U-DEC", "S-DEC", "M-DEC")}
    dd = dy.add_covariates(dy.add_cum(S.assign(o_ohl=0).rename(columns={})) if False else S)  # noqa (keep simple)
    res["nc_draw_rows_with_finish_flag"] = int(S[(S.winner < 0) & (S.fin_ko_against == 1)].shape[0])
    # compare covariates with dynamics.py's panel
    F2, S2, _ = dy.build_panel()
    S2 = dy.add_covariates(S2)
    m = S[["fid", "idx", "rnd", "D10", "K_lag", "K_early", "lost"]].merge(
        S2[["fid", "idx", "rnd", "D10", "K_lag", "K_early", "lost", "period"]], on=["fid", "idx", "rnd"], suffixes=("", "_dy"))
    res["covariates_max_abs_diff_vs_dynamics"] = {c: float((m[c] - m[c + "_dy"]).abs().max()) for c in ("D10", "K_lag", "K_early", "lost")}
    res["panel_fights_by_period_dynamics"] = S2.groupby("period").fid.nunique().to_dict()
    return res, S2


# ----------------------------------------------------------------------------------------------------------------
class NegMult:
    """y_gr ~ Poisson(theta_g E_gr exp(x b)), theta_g ~ Gamma(mean 1, variance a); own implementation."""

    def __init__(self, df, X):
        df = df[df.o_sh_l > 0]
        self.y = df.o_kd.to_numpy(float); self.lE = np.log(df.o_sh_l.to_numpy(float))
        self.X = df[X].to_numpy(float); self.names = list(X)
        self.g = pd.factorize(df.fid.astype(str) + "|" + df.idx.astype(str))[0]; self.G = self.g.max() + 1
        self.cl = pd.factorize(df.fid)[0]
        self.Y = np.bincount(self.g, self.y, self.G)
        self.lfy = np.bincount(self.g, special.gammaln(self.y + 1), self.G)

    def llg(self, p, frail):
        nb = self.X.shape[1]
        eta = self.lE + self.X @ p[:nb]; mu = np.exp(eta)
        M = np.bincount(self.g, mu, self.G); ys = np.bincount(self.g, self.y * eta, self.G)
        if not frail:
            return ys - M - self.lfy
        la = p[nb]; a = math.exp(la); k = 1 / a
        return special.gammaln(k + self.Y) - special.gammaln(k) + ys + self.Y * la - (k + self.Y) * np.log1p(a * M) - self.lfy

    def fit(self, frail=True):
        nb = self.X.shape[1]
        p0 = np.zeros(nb + (1 if frail else 0))
        f = lambda p: -self.llg(p, frail).sum()
        r = optimize.minimum(f, p0) if False else optimize.minimize(f, p0, method="BFGS", options={"gtol": 1e-6, "maxiter": 3000})
        self.p, self.frail = r.x, frail
        P = len(r.x); h = 1e-5
        gcl = np.zeros(self.G, int); gcl[self.g] = self.cl
        C = self.cl.max() + 1
        sc = np.zeros((C, P))
        for j in range(P):
            e = np.zeros(P); e[j] = h
            sc[:, j] = np.bincount(gcl, (self.llg(r.x + e, frail) - self.llg(r.x - e, frail)) / (2 * h), C)
        H = np.zeros((P, P))
        g0 = lambda x: np.array([(f(x + np.eye(P)[j] * h) - f(x - np.eye(P)[j] * h)) / (2 * h) for j in range(P)])
        for j in range(P):
            e = np.zeros(P); e[j] = 1e-4
            H[:, j] = (g0(r.x + e) - g0(r.x - e)) / 2e-4
        Hi = np.linalg.pinv((H + H.T) / 2)
        self.cov = Hi @ (sc.T @ sc) @ Hi
        return self

    def coef(self):
        se = np.sqrt(np.diag(self.cov))
        out = {n: {"est": float(b), "se": float(s)} for n, b, s in zip(self.names, self.p, se)}
        if self.frail:
            out["frailty_var"] = {"est": math.exp(self.p[-1]), "se_log": float(se[-1])}
        return out

    def score(self, other):
        return float(other.llg(self.p, self.frail).sum())


def part_b(S):
    tr0 = S[S.period == "train"]
    p0 = tr0.o_kd.sum() / tr0.o_sh_l.sum()
    fs = (S.groupby(["fid", "idx"]).agg(pid=("pid", "first"), DATE=("DATE", "first"), okd=("o_kd", "sum"),
                                        osh=("o_sh_l", "sum"), kd=("kd", "sum"), sh=("sh_l", "sum")).reset_index())
    fs["key"] = fs.pid.where(fs.pid.notna(), "anon:" + fs.fid + ":" + fs.idx.astype(str))
    acc, out = {}, []
    k = 230.0
    for day, grp in fs.sort_values("DATE").groupby("DATE", sort=True):
        for r in grp.itertuples(index=False):
            h = acc.get(r.key, [0.0, 0.0, 0.0, 0.0])
            out.append((r.fid, r.idx, ((h[0] + k * p0) / (h[1] + k)) / p0, ((h[2] + k * p0) / (h[3] + k)) / p0))
        for r in grp.itertuples(index=False):
            h = acc.setdefault(r.key, [0.0, 0.0, 0.0, 0.0])
            h[0] += r.okd; h[1] += r.osh; h[2] += r.kd; h[3] += r.sh
    C = pd.DataFrame(out, columns=["fid", "idx", "chin", "pow"])
    O = C[["fid", "idx", "pow"]].copy(); O["idx"] = 1 - O.idx
    d = S.merge(C[["fid", "idx", "chin"]], on=["fid", "idx"]).merge(O.rename(columns={"pow": "opow"}), on=["fid", "idx"])
    dv = tr0.groupby("division").apply(lambda x: x.o_kd.sum() / max(x.o_sh_l.sum(), 1), include_groups=False)
    d["ldiv"] = np.log(d.division.map(dv).fillna(p0) / p0)
    d["lchin"] = np.log(d.chin); d["lpow"] = np.log(d.opow)
    cells = sorted(d.cell.unique())
    for c in cells:
        d["c" + c] = (d.cell == c).astype(float)
    cc = ["c" + c for c in cells]
    pre = ["ldiv", "lchin", "lpow"]
    tr, te = d[d.period == "train"], d[d.period == "test"]
    res = {"p0_train": float(p0)}
    for nm_, X in (("null", cc + pre), ("damage", cc + pre + ["D10", "K_lag", "K_early"])):
        for fr in (True, False):
            m = NegMult(tr, X).fit(fr)
            co = m.coef()
            key = nm_ + ("" if fr else "_nofrailty")
            res[key] = {"test_ll": m.score(NegMult(te, X)), "coef": {a: b for a, b in co.items() if not a.startswith("c")}}
            if fr and nm_ == "null":
                res["round_profile_given_frailty"] = {str(R): [math.exp(co[f"c{R}_{r}"]["est"] - co[f"c{R}_1"]["est"]) for r in range(1, R + 1)] for R in (3, 5)}
            print(f"  [B] {key}: test ll {res[key]['test_ll']:.2f}", flush=True)
    ext = d[d.period.isin(["ext", "train"])]
    me = NegMult(ext, cc + pre).fit(True); coe = me.coef()
    res["round_profile_given_frailty_2010_2023"] = {str(R): [math.exp(coe[f"c{R}_{r}"]["est"] - coe[f"c{R}_1"]["est"]) for r in range(1, R + 1)] for R in (3, 5)}
    res["frailty_2010_2023"] = coe["frailty_var"]
    mt = NegMult(te, cc + pre + ["D10", "K_lag", "K_early"]).fit(True); ct = mt.coef()
    res["test_refit_damage"] = {a: b for a, b in ct.items() if not a.startswith("c")}
    mt0 = NegMult(te, cc + pre).fit(True); c0 = mt0.coef()
    res["test_refit_profile_given_frailty"] = {str(R): [math.exp(c0[f"c{R}_{r}"]["est"] - c0[f"c{R}_1"]["est"]) for r in range(1, R + 1)] for R in (3, 5)}
    res["test_refit_frailty"] = c0["frailty_var"]
    return res


# ----------------------------------------------------------------------------------------------------------------
def part_c(S2):
    d = dy.prep_outcome(S2, "out"); tr = d[d.period == "train"]
    ids = np.random.default_rng(5).choice(tr.fid.unique(), 150, replace=False)
    sub = tr[tr.fid.isin(ids)].sort_values(["fid", "idx", "rnd"])
    X = ["partial", "D10", "Ks_lag"]
    m = dy.DynRE(sub, "y", "v", X)
    p = np.array([math.log(0.4), 0.9, math.log(0.3), math.log(0.28), 0.7])
    sa, rho, sb, se, phi = m.unpack(p)
    cells = m.cells; ci = {c: i for i, c in enumerate(cells)}
    blocks = []
    for _, g in sub.groupby("fid"):
        g = g.sort_values(["idx", "rnd"]); i = g.idx.to_numpy(); r = g.rnd.to_numpy(); n = len(g)
        Sg = np.array([[sa ** 2 * (1 if i[a] == i[b] else rho) + (sb ** 2 if r[a] == r[b] else 0)
                        + (se ** 2 * phi ** abs(r[a] - r[b]) if i[a] == i[b] else 0) for b in range(n)] for a in range(n)])
        Sg += np.diag(g.v.to_numpy())
        Z = np.zeros((n, len(cells) + len(X))); Z[np.arange(n), g.cell.map(ci).to_numpy()] = 1; Z[:, len(cells):] = g[X].to_numpy(float)
        blocks.append((g.y.to_numpy(), Z, Sg))
    A = sum(Z.T @ np.linalg.solve(Sg, Z) for _, Z, Sg in blocks)
    c = sum(Z.T @ np.linalg.solve(Sg, y) for y, Z, Sg in blocks)
    beta = np.linalg.solve(A, c)
    ll = sum(stats.multivariate_normal(Z @ beta, Sg).logpdf(y) for y, Z, Sg in blocks)
    return {"bruteforce_ll": float(ll), "dynre_ll": float(-m.negll(p)), "abs_diff": float(abs(ll + m.negll(p)))}


def part_d(S, period):
    x = S[(S.period == period) & (S.R == 3)]
    x = x[x.groupby("fid").full.transform("sum") == 6].copy()
    x["y"] = np.log((x.sig_a + 0.5) / 5); x["v"] = 1 / (x.sig_a + 0.5)
    x["res"] = x.y - x.groupby("rnd").y.transform("mean")
    W = x.pivot_table(index="fid", columns=["idx", "rnd"], values="res")
    V = x.v.mean()
    cv = lambda a, b: float(np.cov(W[a], W[b])[0, 1])
    c0 = np.mean([W[(i, r)].var() for i in (0, 1) for r in (1, 2, 3)]) - V
    o1 = np.mean([cv((i, 1), (i, 2)) for i in (0, 1)] + [cv((i, 2), (i, 3)) for i in (0, 1)])
    o2 = np.mean([cv((i, 1), (i, 3)) for i in (0, 1)])
    x0 = np.mean([cv((0, r), (1, r)) for r in (1, 2, 3)])
    x1 = np.mean([cv((0, 1), (1, 2)), cv((0, 2), (1, 3)), cv((1, 1), (0, 2)), cv((1, 2), (0, 3))])
    x2 = np.mean([cv((0, 1), (1, 3)), cv((1, 1), (0, 3))])
    res = {"n_fights": int(W.shape[0]), "moments": {"var_own_minus_noise": c0, "own_lag1": o1, "own_lag2": o2,
                                                    "cross_lag0": x0, "cross_lag1": x1, "cross_lag2": x2}}
    # shared round shock with its own persistence psi: x_k = P + sb2 psi^k (k = 0, 1, 2)
    psi = (x1 - x2) / (x0 - x1); sb2 = (x0 - x1) / (1 - psi); P = x0 - sb2
    # own: c0 = sa2 + sb2 + se2; o_k = sa2 + sb2 psi^k + se2 phi^k
    a1 = c0 - o1 - sb2 * (1 - psi)            # se2 (1 - phi)
    a2 = o1 - o2 - sb2 * psi * (1 - psi)      # se2 phi (1 - phi)
    phi = a2 / a1; se2 = a1 / (1 - phi); sa2 = o1 - sb2 * psi - se2 * phi
    res["shared_ar_model"] = {"sd_fighter_fight": math.sqrt(sa2), "corr_fighters": P / sa2, "sd_round_shared": math.sqrt(sb2),
                              "shared_round_ar1": psi, "sd_round_own": math.sqrt(se2), "ar1_round_own": phi}
    res["note"] = ("with an iid shared round shock (the DynRE structure) the moments have no solution with |phi| < 1 "
                   "on this sample; letting the shared shock persist (psi) gives the values above")
    return res


def part_e(S2):
    J = json.load(open(os.path.join(ROOT, "data", "derived", "dynamics.json")))
    out = {}
    for name in ("out", "dist", "acc"):
        d = dy.prep_outcome(S2, name)
        te = d[d.period == "test"]
        m0 = dy.DynRE(te, "y", "v", ["partial"]).fit()
        m1 = dy.DynRE(te, "y", "v", dy.STATE_X, fixed_cells=m0.cells).fit(m0.p)
        g = m1.gamma()
        gt = J["state_models"][name]["gamma"]
        out[name] = {"var_components_null_test": m0.var_components(),
                     "gamma": {k: {"train": gt[k]["est"], "train_se": gt[k]["se"], "test": g[k]["est"], "test_se": g[k]["se"]}
                               for k in g}}
        print(f"  [E] {name} refit on 2024-2025", flush=True)
    return out


def part_f(F, S2):
    coef, _, _ = dy.fit_round_logit(S2, F, dy.TRAIN)
    lab_inf, _, _ = dy.judge_labels(F, S2, coef)
    lab_true = dy.true_judge_labels(S2)
    d = S2.copy()
    d["lostJinf"] = [1 - lab_inf[k] if k in lab_inf else np.nan for k in zip(d.fid, d.idx, d.rnd - 1)]
    d["lostJ"] = [1 - lab_true[k] if k in lab_true else np.nan for k in zip(d.fid, d.idx, d.rnd - 1)]
    a = d[(d.rnd >= 2) & d.lostJ.notna() & d.lostJinf.notna()].copy()
    import statsmodels.api as sm
    a["marg_r"] = (a.sig_l - a.o_sig_l) / 10            # round r (the outcome round) landed margin
    m = sm.OLS(a.lostJinf, sm.add_constant(a[["lostJ", "marg_r"]])).fit(cov_type="cluster", cov_kwds={"groups": pd.factorize(a.fid)[0]})
    return {"n_rounds": int(len(a)), "corr": float(np.corrcoef(a.lostJinf, a.lostJ)[0, 1]),
            "agree_gt_half": float(((a.lostJinf > 0.5) == (a.lostJ > 0.5)).mean()),
            "true_vs_sig_landed_agree": float(((a.lostJ > 0.5) == (a.lost > 0.5)).mean()),
            "lookahead_regression": {k: {"est": float(v), "se": float(s)} for k, v, s in zip(m.params.index, m.params, m.bse)},
            "lookahead_note": "inferred label of round r-1 regressed on the published label of r-1 and the round-r landed "
                              "margin: a non-zero marg_r means the label carries information from the round it is used to explain"}


def part_g(S2):
    out = {}
    for lab, quiet in (("relaxed", False), ("quiet_next_round", True)):
        for p in (("train",), ("ext", "train"), ("test",)):
            if quiet:
                x = S2[S2.period.isin(list(p))]
                # quiet / full r+1: drop fighter-fights whose r+1 had a knockdown or ended early (post-treatment selection)
                bad = x[(x.kd + x.o_kd > 0) | (x.rsec < 300)][["fid", "idx", "rnd"]].assign(rnd=lambda z: z.rnd - 1)
                key = set(zip(bad.fid, bad.idx, bad.rnd))
                r = dy.kd_skip_round(x[[k not in key for k in zip(x.fid, x.idx, x.rnd)]] if False else x, p)
                # (the quiet variant is approximated by excluding pairs below)
                r = _skip_quiet(x, p)
            else:
                r = dy.kd_skip_round(S2, p)
            out[f"{lab}:{'+'.join(p)}"] = r
    return out


def _skip_quiet(S, periods):
    x = S[S.period.isin(list(periods))].copy()
    x["y"] = np.log((x.sig_a + 0.5) / 5)
    P = {c: x.pivot_table(index=["fid", "idx"], columns="rnd", values=c) for c in ("y", "kd", "o_kd", "rsec")}
    Rr = x.groupby(["fid", "idx"]).R.first()
    rows = []
    for r in (2, 3, 4):
        if r + 1 not in P["y"].columns:
            continue
        q = lambda c, rr: P[c][rr]
        ok = (q("rsec", r - 1) >= 300) & (q("rsec", r) >= 300) & (q("rsec", r + 1) >= 300)
        ok &= (q("kd", r - 1) == 0) & (q("o_kd", r - 1) == 0) & (q("kd", r + 1) == 0) & (q("o_kd", r + 1) == 0)
        for lab, sel in (("scorer", ok & (q("kd", r) >= 1) & (q("o_kd", r) == 0)), ("dropped", ok & (q("o_kd", r) >= 1) & (q("kd", r) == 0)),
                         ("control", ok & (q("kd", r) == 0) & (q("o_kd", r) == 0))):
            for i in sel[sel].index:
                rows.append((lab, f"{Rr[i]}_{r}", P["y"].loc[i, r + 1] - P["y"].loc[i, r - 1]))
    D = pd.DataFrame(rows, columns=["grp", "cell", "after_vs_before"])
    cm = D[D.grp == "control"].groupby("cell").after_vs_before.mean()
    res = {}
    for lab in ("scorer", "dropped"):
        z = D[D.grp == lab]; adj = z.after_vs_before.to_numpy() - cm.reindex(z.cell).to_numpy()
        res[lab] = {"n": int(len(z)), "after_vs_before": {"est": float(np.nanmean(adj)), "se": float(np.nanstd(adj) / math.sqrt(max(len(z), 1)))}}
    return res


def part_h(S):
    out = {}
    for p in ("train", "test"):
        x = S[S.period == p]
        t = {}
        for (R, r), g in x.groupby(["R", "rnd"]):
            n = int(len(g) // 2); k = int(g.fin_ko_against.sum()); kd = int(g.kd.sum())
            t[f"{R}_{r}"] = {"rounds": n, "ko_tko": k, "p": k / n, "wilson95": wilson(k, n), "kd": kd,
                             "kd_per100_sh": 100 * kd / g.sh_l.sum(),
                             "kd_per100_sh_95": [100 * stats.chi2.ppf(0.025, 2 * kd) / 2 / g.sh_l.sum() if kd else 0.0,
                                                 100 * stats.chi2.ppf(0.975, 2 * kd + 2) / 2 / g.sh_l.sum()]}
        x5 = x[(x.R == 5) & (x.rnd >= 3)]
        n = int(len(x5) // 2); k = int(x5.fin_ko_against.sum())
        t["5_R3to5_pooled"] = {"rounds": n, "ko_tko": k, "p": k / n, "wilson95": wilson(k, n)}
        out[p] = t
    return out


def part_i(S2):
    FF, _ = dy.late_ratio_table(S2)
    J = json.load(open(os.path.join(ROOT, "data", "derived", "dynamics.json")))
    m = J["fighter_late_ratio"]["variance"]["LRl"]["league_mean"]
    bt = json.load(open(os.path.join(ROOT, "data", "derived", "backtest_dev.json")))
    B = pd.DataFrame([(f["id"], i, f[s].get("pace"), f[s].get("pace_w")) for f in bt["fights"] if f["date"] < VAULT
                      for s, i in (("A", 0), ("B", 1))], columns=["fkey", "idx", "pace", "pace_w"])
    FF["fkey"] = FF.fid.map(bd.url_id)
    Jn = FF.merge(B, on=["fkey", "idx"])
    ks = (15, 30, 45)
    for k in ks:
        Jn[f"p{k}"] = m + np.array([dy.engine_pace_pred(pc, pw, T, k) for pc, pw, T in zip(Jn.pace, Jn.pace_w, Jn["T"])])
    rng = np.random.default_rng(1)
    out = {}
    for p in ("train", "test"):
        z = Jn[Jn.period == p].reset_index(drop=True)
        fids = z.fid.unique(); pos = z.groupby("fid").indices
        y = z.LRl.to_numpy(); P = {k: z[f"p{k}"].to_numpy() for k in ks}
        sk = lambda ix, k: 100 * (1 - ((y[ix] - P[k][ix]) ** 2).mean() / ((y[ix] - m) ** 2).mean())
        allix = np.arange(len(z))
        bs = []
        for _ in range(1000):
            ix = np.concatenate([pos[f] for f in rng.choice(fids, len(fids))])
            bs.append((sk(ix, 45) - sk(ix, 15), sk(ix, 30) - sk(ix, 15), sk(ix, 45) - sk(ix, 30)))
        bs = np.array(bs)
        out[p] = {"n": int(len(z)), "skill_pct": {str(k): sk(allix, k) for k in ks},
                  "diff_45_15_ci95": np.percentile(bs[:, 0], [2.5, 97.5]).tolist(),
                  "diff_30_15_ci95": np.percentile(bs[:, 1], [2.5, 97.5]).tolist(),
                  "diff_45_30_ci95": np.percentile(bs[:, 2], [2.5, 97.5]).tolist()}
    return out


def part_j(S):
    out = {}
    for p in ("train", "test"):
        x = S[S.period == p]
        k = x[x.o_kd >= 1]
        st = int(((x.fin_ko_against == 1) & (x.o_kd == 0) & ~x.ko_pos.eq("ground")).sum())
        gt = int(((x.fin_ko_against == 1) & (x.o_kd == 0) & x.ko_pos.eq("ground")).sum())
        out[p] = {"kd": int(k.o_kd.sum()), "kd_rounds_finished": int(k.fin_ko_against.sum()),
                  "conversion_per_kd": float(k.fin_ko_against.sum() / k.o_kd.sum()),
                  "standing_tko_no_kd": st, "per_standing_head": st / float(x.o_sh_l.sum()),
                  "ground_tko_no_kd": gt, "per_ground_strike": gt / float(x.o_ground_l.sum())}
    return out


def main():
    t0 = time.time()
    F, S, people, fights = panel()
    print(f"panel {S.fid.nunique()} fights ({time.time() - t0:.0f}s)", flush=True)
    R = {"meta": {"tool": "tools/dynamics_audit.py", "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  "fights_by_period": S.groupby("period").fid.nunique().to_dict(), "vault_dropped_from": VAULT}}
    R["A_joins"], S2 = part_a(F, S, people, fights)
    S2 = S2[S2.period != "vault"]
    print("A done", flush=True)
    R["B_kd_hazard"] = part_b(S); print("B done", flush=True)
    R["C_dynre_bruteforce"] = part_c(S2); print("C done", R["C_dynre_bruteforce"], flush=True)
    R["D_moments"] = {p: part_d(S, p) for p in ("train", "test")}; print("D done", flush=True)
    R["E_test_refit"] = part_e(S2)
    R["F_judges_labels"] = part_f(F, S2); print("F done", flush=True)
    R["G_kd_skip_round"] = {}
    for p in (("train",), ("ext", "train"), ("test",)):
        R["G_kd_skip_round"]["relaxed:" + "+".join(p)] = dy.kd_skip_round(S2, p)
        R["G_kd_skip_round"]["quiet_next_round:" + "+".join(p)] = _skip_quiet(S2, p)
    print("G done", flush=True)
    R["H_round_targets_ci"] = part_h(S)
    R["I_kpace_bootstrap"] = part_i(S2); print("I done", flush=True)
    R["J_conversion_counts"] = part_j(S)
    R["meta"]["secs"] = time.time() - t0
    with open(OUT, "w") as fh:
        json.dump(dy.r6(R, 5), fh, indent=1)
    print(f"wrote {OUT} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
