#!/usr/bin/env python3
"""Standing blind-test harness: an event-by-event walk-forward replay of every registered model (task key: blindtest).

Run from the project root (Python 3.13 + numpy/pandas/scipy/scikit-learn/lightgbm/xgboost; nice it on the shared box):

    nice -n 5 python3 tools/blindtest.py list                    # registered models, versions, refit schedules
    nice -n 5 python3 tools/blindtest.py replay                  # replay 2024-01-01..2025-12-31, score, write outputs
    nice -n 5 python3 tools/blindtest.py replay --models elo,ml_lr,moe_noline     # a subset (+ what they need)
    nice -n 5 python3 tools/blindtest.py replay --ml-refit month # refit the ML logistic monthly instead of per event
    nice -n 5 python3 tools/blindtest.py score                   # re-score the stored replay, rewrite the report
    python3 tools/blindtest.py replay --quick                    # first 8 events, 300 bootstrap resamples (smoke)

What a replay does (docs/BACKLOG.md "Evaluation rule" and "Hidden-data protocol"):
  1. Universe: data/derived/backtest_dev.json fights (both men had a prior UFC fight; every fight dated 2026-01-01 or
     later is dropped on load, and any plugin output for a fight outside this set is discarded at the door).
     Replay window 2024-01-01..2025-12-31 (the protocol's validation years); history 2019-01-01..2023-12-31 feeds only
     the stackers, through each model's strictly out-of-sample 2019-2023 predictions.
  2. For each UFC event date in the window, in order, every registered model is refit/updated with data strictly
     before that date and predicts that card. Schedules: 'event' (refit before every card), 'month' (refit before the
     first card of each month), 'never' (frozen fit made before 2024, or a sequential rating whose pre-fight state
     already uses every earlier fight: Elo, market rating, WHR...). Stackers refit before every card on all earlier
     rows (history + the replay's own earlier predictions). Every fit records fit_through (its last training fight)
     and the harness refuses a fit_through on or after the card's date.
  3. Each prediction is stored per backtest fight id with the model version, the refit cutoff and fit_through; the
     replay itself carries a UTC timestamp. P is always P(first-named fighter A wins | decisive).
  4. Scoring is symmetric (per-fight log loss on the probability given to the actual winner, models are corner-
     symmetric by construction and the refit models are checked with A and B swapped), with 95% event-cluster
     bootstrap CIs (2,000 resamples of event dates, the same draws for every model and paired difference),
     cumulative curves over the window, mirrored calibration tables and slopes, and per-segment tables
     (newcomers = the less experienced man has 1-2 prior UFC fights).
  Outputs: data/derived/blindtest.json (predictions + fits + scores), the auto section of research/model_blindtest.md.
  Heavy fits are cached in out/blindtest_cache/ (keyed by model version and cutoff; --no-cache recomputes).

Adding a model is a ~10-line plugin, either here or in a file tools/blindtest_plugins/<name>.py (auto-imported):

    from blindtest import register, Stored

    @register("ml2", group="model", line=None, desc="ML v2 (tools/ml2.py), walk-forward per its protocol")
    def _ml2(ctx):
        d = ctx.json("ml2.json")                      # None when the file is absent -> the model is skipped
        if not d:
            return None
        P = {i: r["p"] for i, r in d["fights"].items()}
        hist = {i: r["p"] for i, r in d["fights"].items() if r.get("set") == "oof"}   # strictly out-of-sample 2019-23
        return Stored(P, history=hist, version="ml2.json built " + d["meta"]["built"])

  A model that refits subclasses Model and implements fit(cutoff, P) (data strictly before cutoff) and
  predict(fids, P) (-> {fid: P(A)}), optionally predict_swapped(fids, P) for the symmetry check; see MLLogistic below.
  A stacker is one line with Stack(...) or MoEStack(...); see the registrations at the bottom.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):   # the box is shared and busy
    os.environ.setdefault(_v, "1")
import argparse
import datetime as dt
import glob
import hashlib
import importlib.util
import json
import math
import pickle
import sys
import time
import warnings

import numpy as np

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("BLINDTEST_CACHE", os.path.join(ROOT, "out", "blindtest_cache"))
OUT_JSON = os.environ.get("BLINDTEST_OUT", os.path.join(DERIVED, "blindtest.json"))
REPORT_MD = os.path.join(ROOT, "research", "model_blindtest.md")
PLUGIN_DIR = os.path.join(HERE, "blindtest_plugins")

VAULT_FROM = "2026-01-01"          # sealed: never read, fit or scored here
HIST_FROM = "2019-01-01"           # stacker history starts here (out-of-sample predictions 2019-2023)
WINDOW = ("2024-01-01", "2025-12-31")
PCLIP = 0.01                       # expert probabilities clipped before logits in the stackers (= tools/moe.py)
TOOL_VERSION = "blindtest 1.0 (2026-11-06)"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def logit(p):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def sigm(z):
    return 1.0 / (1.0 + np.exp(-np.asarray(z, float)))


def r4(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 4)


def r5(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 5)


def sha_files(*paths):
    h = hashlib.sha256()
    for p in paths:
        if p and os.path.exists(p):
            st = os.stat(p)
            h.update(("%s:%d:%d" % (os.path.basename(p), st.st_size, int(st.st_mtime))).encode())
    return h.hexdigest()[:10]


def wjson(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"), allow_nan=False)
    os.replace(tmp, path)


# ====================================================================== registry and model classes
REGISTRY = {}


def register(key, group="model", line=None, refit="never", needs=(), desc="", experimental=False):
    """Register a model factory: factory(ctx) -> Model or None (None = inputs missing, model skipped).
    group: 'benchmark' (market lines), 'model' (a forecaster), 'stack' (reads other models' predictions).
    line: None (pre-fight info only), 'open' (uses the opening line), 'close' (uses the closing line)."""
    def deco(factory):
        REGISTRY[key] = dict(factory=factory, group=group, line=line, refit=refit, needs=tuple(needs), desc=desc,
                             experimental=experimental)
        return factory
    return deco


class Model:
    """Base class. Subclasses that learn implement fit(); every model implements predict()."""
    refit = "never"
    version = ""
    note = ""
    symmetric = "by construction"

    def history(self):
        """{fid: P(A)} strictly out-of-sample predictions for HIST_FROM..window start (stacker training rows)."""
        return {}

    def fit(self, cutoff, P):
        """Refit on data strictly before cutoff (ISO date). P = {model: {fid: p}} known so far. Returns
        {'fit_through': last training date, 'n_train': rows} or None."""
        return None

    def predict(self, fids, P):
        raise NotImplementedError

    def bins7(self, fids):
        """Optional {fid: [A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO]}."""
        return {}

    def fit_through_of(self, fid):
        """For stored models that know it per fight (e.g. annual refits)."""
        return None


class Stored(Model):
    """Precomputed walk-forward predictions keyed by backtest fight id (sequential ratings, frozen fits made before
    the window, or a tool's own documented walk-forward output)."""
    def __init__(self, preds, history=None, bins=None, version="", note="", fit_through=None, symmetric="by construction"):
        self.preds = {k: float(v) for k, v in preds.items() if v is not None and np.isfinite(v)}
        self._hist = {k: float(v) for k, v in (history or {}).items() if v is not None and np.isfinite(v)}
        self._bins = bins or {}
        self.version, self.note, self.symmetric = version, note, symmetric
        self._ft = fit_through or {}

    def history(self):
        return self._hist

    def predict(self, fids, P):
        return {f: self.preds[f] for f in fids if f in self.preds}

    def bins7(self, fids):
        return {f: self._bins[f] for f in fids if f in self._bins}

    def fit_through_of(self, fid):
        return self._ft.get(fid)


# ====================================================================== context (data shared by plugins)
class Ctx:
    def __init__(self, args):
        self.args = args
        self._json = {}
        bt = json.load(open(os.path.join(DERIVED, "backtest_dev.json")))
        self.bt_meta = bt["meta"]
        fights = [f for f in bt["fights"] if f["date"] < VAULT_FROM]          # hidden-data protocol
        self.fights = {f["id"]: f for f in fights}
        self.order = [f["id"] for f in sorted(fights, key=lambda f: f["date"])]
        self.date = {i: self.fights[i]["date"] for i in self.order}
        self.y = {}
        for i, f in self.fights.items():
            w = f["result"]["winner"]
            self.y[i] = 1.0 if w == "A" else (0.0 if w == "B" else None)
        self.hist_ids = [i for i in self.order if HIST_FROM <= self.date[i] < WINDOW[0]]
        self.win_ids = [i for i in self.order if WINDOW[0] <= self.date[i] <= WINDOW[1]]
        self._ml = None
        self._moe_rows = None
        self.perturb_from = getattr(args, "perturb_from", None)   # selftest: outcomes on/after this date flipped
        if self.perturb_from:
            for i in self.y:
                if self.date[i] >= self.perturb_from and self.y[i] is not None:
                    self.y[i] = 1.0 - self.y[i]
        # input fingerprints at load time (other tools may rewrite these files while a replay runs)
        self.inputs = {n: sha_files(os.path.join(DERIVED, n)) for n in
                       ("backtest_dev.json", "ml.json", "market.json", "moe.json", "ratings.json", "methodround.json",
                        "preufc.json", "ml2.json")}

    def json(self, name):
        if name not in self._json:
            p = os.path.join(DERIVED, name)
            try:
                self._json[name] = json.load(open(p)) if os.path.exists(p) else None
            except Exception as ex:            # another agent may be mid-write
                log("could not read %s: %s" % (name, ex))
                self._json[name] = None
        return self._json[name]

    def path(self, name):
        return os.path.join(DERIVED, name)

    def dev(self, d):
        """Restrict a {fid: x} map to dev fights (drops 2026 and anything outside backtest_dev)."""
        return {k: v for k, v in d.items() if k in self.fights}

    # ---- tools/ml.py walk-forward feature table (stage-1 cache), 2026 rows removed
    def ml(self):
        if self._ml is None:
            import ml as M
            import __main__
            for n in ("LRModel", "SoftmaxLR"):                 # stage1.pkl was pickled from tools/ml.py's __main__
                if not hasattr(__main__, n):
                    setattr(__main__, n, getattr(M, n))
            path = os.path.join(ROOT, "out", "ml_cache", "stage1.pkl")
            if not os.path.exists(path):
                raise SystemExit("out/ml_cache/stage1.pkl missing: run python3 tools/ml.py once (stage one)")
            with open(path, "rb") as fh:
                R = pickle.load(fh)
            c = R["_ctx"]
            df = c["df"]
            dates = np.array([d.isoformat() for d in df["date"]])
            keep = dates < VAULT_FROM
            df = df[keep].reset_index(drop=True)
            specs = [t for t in M.lr_term_specs() if t["name"] in set(c["cols"])]
            X = M.lr_design(df, specs)[c["cols"]].to_numpy()
            dX = float(np.max(np.abs(X - c["X"][keep])))
            if dX > 1e-9:
                raise SystemExit("ML design drift: current tools/ml.py lr_design differs from stage1 by %g" % dX)
            self._ml = dict(M=M, df=df, X=X, y=c["y"][keep], dec=c["dec"][keep], dates=dates[keep],
                            years=c["years"][keep], G0=c["G0"][keep].reset_index(drop=True),
                            G1=c["G1"][keep].reset_index(drop=True), cols=c["cols"], lr_best=c["lr_best"],
                            lgb_best=c["lgb_best"], xgb_best=c["xgb_best"],
                            row={f: k for k, f in enumerate(df["fid"])}, sha=sha_files(path),
                            n_2026_dropped=int((~keep).sum()))
            if self.perturb_from:
                fl = (self._ml["dates"] >= self.perturb_from) & self._ml["dec"]
                self._ml["y"] = np.where(fl, 1.0 - self._ml["y"], self._ml["y"])
            log("ML table: %d rows 2010-2025 (%d rows from 2026 dropped), %d logistic terms"
                % (len(df), self._ml["n_2026_dropped"], X.shape[1]))
        return self._ml

    # ---- tools/moe.py rows (gating inputs, 2019-2025 backtest_dev fights)
    def moe_rows(self):
        if self._moe_rows is None:
            import moe as MO
            with open(os.path.join(ROOT, "out", "moe_cache", "experts.pkl"), "rb") as fh:
                E = pickle.load(fh)
            rows = {}
            for fid, r in zip(E["ids"], E["rows"]):
                if fid in self.fights:
                    r = dict(r)
                    f = self.fights[fid]
                    r["slugA"], r["slugB"] = f["A"]["slug"], f["B"]["slug"]
                    rows[fid] = r
            ids = list(rows)
            G = MO.gating_matrix([rows[i] for i in ids], None)
            pre = self.json("preufc.json")
            snaps = set()
            if pre:
                for slug, fr in pre.get("fighters", {}).items():
                    for s_ in fr.get("snapshots") or []:
                        if s_ and len(s_) > 3 and s_[3]:
                            snaps.add((slug, s_[1]))
            G[:, MO.GATE_NAMES.index("preufc")] = [0.5 * ((rows[i]["slugA"], i) in snaps) + 0.5 * ((rows[i]["slugB"], i) in snaps)
                                                   for i in ids]
            self._moe_rows = dict(MO=MO, E=E, G={i: G[k] for k, i in enumerate(ids)})
        return self._moe_rows


# ====================================================================== refit models
def _fit_lr_warm(X, y, lam, w0=None):
    """tools/ml.py fit_lr (L2 logistic, no intercept, standardised columns) with an optional warm start."""
    from scipy.optimize import minimize
    n, d = X.shape
    sw = np.full(n, 1.0 / n)

    def f(w):
        z = X @ w
        p = 1 / (1 + np.exp(-z))
        return np.sum(sw * (np.logaddexp(0, z) - y * z)) + 0.5 * lam * w @ w, X.T @ (sw * (p - y)) + lam * w
    r = minimize(f, np.zeros(d) if w0 is None else w0, jac=True, method="L-BFGS-B", options={"maxiter": 3000})
    return r.x


class MLLogistic(Model):
    """tools/ml.py winner logistic (selected 80 terms, lam and train set chosen by CV on 2010-2023), refit on every
    decisive fight before the cutoff (2010 on). Antisymmetric design, no intercept."""
    symmetric = "checked: P(B,A) = 1 - P(A,B) on every replayed fight"

    def __init__(self, ctx, refit="event"):
        self.ctx, self.refit = ctx, refit
        T = ctx.ml()
        self.T = T
        cfg = T["lr_best"]
        if cfg.get("train_set") != "all" or cfg.get("recency_half_life_years"):
            raise SystemExit("ml_lr plugin expects train_set 'all' without recency weights; got %s" % cfg)
        self.lam = cfg["lam"]
        self.version = "tools/ml.py logistic, %d terms, lam %g, stage1 %s, refit per %s" % (
            T["X"].shape[1], self.lam, T["sha"], refit)
        mlj = ctx.json("ml.json")
        self._hist = {i: r["lr"] for i, r in mlj["fights"].items() if r.get("set") == "oof" and r.get("lr") is not None}
        self.coef = None

    def history(self):
        return self.ctx.dev(self._hist)

    def fit(self, cutoff, P):
        T = self.T
        tr = (T["dates"] < cutoff) & T["dec"]
        X = T["X"][tr]
        s = X.std(0) + 1e-9
        w0 = None if self.coef is None else self.coef * s
        w = _fit_lr_warm(X / s, T["y"][tr], self.lam, w0)
        self.coef = w / s
        return {"fit_through": max(T["dates"][tr]), "n_train": int(tr.sum())}

    def _rows(self, fids):
        return [(f, self.T["row"][f]) for f in fids if f in self.T["row"]]

    def predict(self, fids, P):
        return {f: float(sigm(self.T["X"][k] @ self.coef)) for f, k in self._rows(fids)}

    def predict_swapped(self, fids, P):
        return {f: float(sigm(-self.T["X"][k] @ self.coef)) for f, k in self._rows(fids)}


class MLTrees(Model):
    """tools/ml.py LightGBM / XGBoost winner model with frozen hyperparameters (chosen on 2010-2023 CV), refit on every
    decisive fight before the cutoff. Trained on mirrored rows, predictions averaged over both corner orders."""
    symmetric = "by construction (mirrored rows, both orders averaged)"

    def __init__(self, ctx, kind, refit="month"):
        self.ctx, self.kind, self.refit = ctx, kind, refit
        T = ctx.ml()
        self.T, self.best = T, T["lgb_best" if kind == "lgb" else "xgb_best"]
        self.version = "tools/ml.py %s %s rounds %d, stage1 %s, refit per %s" % (
            kind, json.dumps(self.best["cfg"], sort_keys=True), self.best["rounds"], T["sha"], refit)
        mlj = ctx.json("ml.json")
        key = "gbm" if kind == "lgb" else "xgb"
        self._hist = {i: r[key] for i, r in mlj["fights"].items() if r.get("set") == "oof" and r.get(key) is not None}
        self.m = None

    def history(self):
        return self.ctx.dev(self._hist)

    def fit(self, cutoff, P):
        T, M = self.T, self.T["M"]
        tr = (T["dates"] < cutoff) & T["dec"]
        if self.kind == "lgb":
            self.m = M.lgb_fit(dict(self.best["cfg"], learning_rate=M.GBM_LR), T["G0"][tr], T["G1"][tr], T["y"][tr],
                               self.best["rounds"])
        else:
            self.m = M.xgb_fit(dict(self.best["cfg"], eta=M.XGB_ETA), T["G0"][tr], T["G1"][tr], T["y"][tr],
                               self.best["rounds"])
        return {"fit_through": max(T["dates"][tr]), "n_train": int(tr.sum())}

    def predict(self, fids, P):
        T, M = self.T, self.T["M"]
        rows = [(f, T["row"][f]) for f in fids if f in T["row"]]
        if not rows:
            return {}
        idx = [k for _, k in rows]
        fn = M.lgb_pred if self.kind == "lgb" else M.xgb_pred
        p = fn(self.m, T["G0"].iloc[idx], T["G1"].iloc[idx])
        return {f: float(v) for (f, _), v in zip(rows, p)}

    def predict_swapped(self, fids, P):
        T, M = self.T, self.T["M"]
        rows = [(f, T["row"][f]) for f in fids if f in T["row"]]
        if not rows:
            return {}
        idx = [k for _, k in rows]
        fn = M.lgb_pred if self.kind == "lgb" else M.xgb_pred
        p = fn(self.m, T["G1"].iloc[idx], T["G0"].iloc[idx])
        return {f: float(v) for (f, _), v in zip(rows, p)}


class FeatLR(Model):
    """tools/moe.py page feature LR ('feat_lr': side-feature differences a fighters.json profile carries, no
    intercept, C chosen on 2016-2018), refit on every decisive snapshot entry before the cutoff (2010 on)."""
    symmetric = "checked: P(B,A) = 1 - P(A,B) on every replayed fight"

    def __init__(self, ctx, refit="event"):
        self.ctx, self.refit = ctx, refit
        import moe as MO
        self.MO = MO
        with open(os.path.join(ROOT, "out", "moe_cache", "prep.pkl"), "rb") as fh:
            prep = pickle.load(fh)
        entries = [e for e in prep["entries"] if e["date"] < VAULT_FROM]
        rows = MO.build_table(entries, prep["keys"], prep["priors_asof"])
        MO.FEAT_NAMES = None
        XA, XB, _ = MO.mats(rows)
        E = ctx.moe_rows()["E"]
        names = E["lr_page"]["names"]
        cols = [MO.FEAT_NAMES.index(n) for n in names]
        self.XA, self.XB = XA[:, cols], XB[:, cols]
        self.y = np.array([r["y"] for r in rows])
        self.dates = np.array([r["date"] for r in rows])
        self.dec = np.isfinite(self.y)
        if ctx.perturb_from:
            fl = (self.dates >= ctx.perturb_from) & self.dec
            self.y = np.where(fl, 1.0 - self.y, self.y)
        self.row = {r["id"]: k for k, r in enumerate(rows)}
        self.C = E["lr_page"]["C"]
        self.version = "tools/moe.py page feature LR, %d features, C %g, prep %s, refit per %s" % (
            len(names), self.C, sha_files(os.path.join(ROOT, "out", "moe_cache", "prep.pkl")), refit)
        self._hist = {fid: float(p) for fid, d, p in zip(E["ids"], E["dates"], E["pred"]["feat_lr"])
                      if HIST_FROM <= d < WINDOW[0] and np.isfinite(p)}
        self.m = None

    def history(self):
        return self.ctx.dev(self._hist)

    def fit(self, cutoff, P):
        tr = (self.dates < cutoff) & self.dec
        self.m = self.MO.SymLR(self.C).fit(self.XA[tr], self.XB[tr], self.y[tr])
        return {"fit_through": max(self.dates[tr]), "n_train": int(tr.sum())}

    def predict(self, fids, P):
        idx = [(f, self.row[f]) for f in fids if f in self.row]
        if not idx:
            return {}
        k = [j for _, j in idx]
        p = self.m.predict(self.XA[k], self.XB[k])
        return {f: float(v) for (f, _), v in zip(idx, p)}

    def predict_swapped(self, fids, P):
        idx = [(f, self.row[f]) for f in fids if f in self.row]
        if not idx:
            return {}
        k = [j for _, j in idx]
        p = self.m.predict(self.XB[k], self.XA[k])
        return {f: float(v) for (f, _), v in zip(idx, p)}


# ====================================================================== stackers
class Stack(Model):
    """Symmetric logit-linear stack: p = sigmoid(sum_k w_k logit(p_k)), w_k >= 0, no intercept, one weight vector per
    availability pattern; optional recency half-life (years) and temperature. Refit before every card on every
    decisive fight from 2019-01-01 to the day before (history rows use each expert's out-of-sample predictions)."""
    symmetric = "by construction (antisymmetric logits, no intercept)"

    def __init__(self, ctx, experts, h=None, required=None, refit="event"):
        self.ctx, self.experts, self.h, self.refit = ctx, list(experts), h, refit
        self.required = list(required or experts)
        self.version = "linear stack of %s%s" % ("+".join(self.experts), (", half-life %g y" % h) if h else "")
        self.fits = {}
        self._train = None

    def _matrix(self, fids, P):
        L = np.zeros((len(fids), len(self.experts)))
        M = np.zeros((len(fids), len(self.experts)), bool)
        for j, e in enumerate(self.experts):
            pe = P.get(e, {})
            for i, f in enumerate(fids):
                v = pe.get(f)
                if v is not None and np.isfinite(v):
                    L[i, j] = logit(np.clip(v, PCLIP, 1 - PCLIP))
                    M[i, j] = True
        return L, M

    def _weights(self, dates):
        if not self.h:
            return np.ones(len(dates))
        t = np.array([dt.date.fromisoformat(d).toordinal() for d in dates], float)
        w = 0.5 ** ((t.max() - t) / (365.25 * self.h))
        return w * len(w) / w.sum()

    def fit(self, cutoff, P):
        ids = [i for i in self.ctx.order if HIST_FROM <= self.ctx.date[i] < cutoff and self.ctx.y[i] is not None]
        L, M = self._matrix(ids, P)
        y = np.array([self.ctx.y[i] for i in ids])
        w = self._weights([self.ctx.date[i] for i in ids])
        self._train = (L, M, y, w)          # kept: patterns first seen at prediction time are fit lazily on it
        self.fits = {}
        req = [self.experts.index(e) for e in self.required]
        ok = M[:, req].all(1)
        self._fit_pattern(tuple(range(len(self.experts))))
        return {"fit_through": max(self.ctx.date[i] for i, o in zip(ids, ok) if o), "n_train": int(ok.sum())}

    def _fit_pattern(self, idx):
        import moe as MO
        L, M, y, w = self._train
        ok = M[:, list(idx)].all(1)
        if ok.sum() < 50:
            return None
        self.fits[idx] = MO.LinStack().fit(L[ok][:, list(idx)], y[ok], w[ok]).w
        return self.fits[idx]

    def predict(self, fids, P):
        L, M = self._matrix(fids, P)
        req = [self.experts.index(e) for e in self.required]
        out = {}
        for i, f in enumerate(fids):
            if not M[i, req].all():
                continue
            idx = tuple(j for j in range(len(self.experts)) if M[i, j])
            wv = self.fits.get(idx)
            if wv is None:
                wv = self._fit_pattern(idx)
            if wv is None:
                continue
            out[f] = float(sigm(L[i, list(idx)] @ wv))
        return out

    def predict_swapped(self, fids, P):
        fs = set(fids)
        return self.predict(fids, {e: {f: 1 - v for f, v in P.get(e, {}).items() if f in fs} for e in self.experts})

    def weights(self):
        full = tuple(range(len(self.experts)))
        w = self.fits.get(full)
        return None if w is None else {e: round(float(v), 4) for e, v in zip(self.experts, w)}


class MoEStack(Model):
    """tools/moe.py stacker with the configuration data/derived/moe.json chose for a regime ('present' = a market line
    is an expert, 'absent' = no line): method, hyper-parameters and calibration kind. Refit before every card on every
    decisive fight from 2019-01-01 to the day before; the calibration is fit on forward-chained out-of-fold stack
    logits (each year 2021.. predicted by a stacker trained before Jan 1 of that year, the cutoff's own year up to the
    day before), as tools/moe.py does for its 2025 rolling fit."""
    symmetric = "by construction (antisymmetric logits, symmetric gates, no intercept)"

    def __init__(self, ctx, experts, regime, refit="event", cal=None, cal_days=None, cal_newcomer=False, method=None,
                 hp=None):
        """experts: {moe expert name: harness model key}, e.g. {'market': 'market_close', 'ml': 'ml_lr', ...}.
        cal overrides moe.json's calibration kind; cal_days fits it on the last cal_days of forward-chained logits."""
        self.ctx, self.map, self.regime, self.refit = ctx, dict(experts), regime, refit
        mo = ctx.json("moe.json")
        cfg = mo["model"][regime]
        self.method, self.hp = method or cfg["method"], dict(cfg.get("hp") or {}) if hp is None else dict(hp)
        self.cal_kind = cal or (cfg.get("calibration") or {}).get("type", "none")
        self.cal_days = cal_days
        self.cal_newcomer = cal_newcomer          # separate calibration for newcomer fights (less experienced man 1-2)
        self.names = [e for e in mo["model"]["experts"] if e in self.map] + [e for e in self.map if e not in mo["model"]["experts"]]
        R = ctx.moe_rows()
        self.MO, self.Gall = R["MO"], R["G"]
        self.drops = self.MO.make_drops(self.names)[0]
        self.version = "tools/moe.py %s %s cal=%s%s, experts %s" % (
            self.method, json.dumps(self.hp, sort_keys=True), self.cal_kind,
            ((" on the last %d days" % cal_days) if cal_days else "") + (" split newcomer/other" if cal_newcomer else ""),
            "+".join("%s=%s" % (e, self.map[e]) if e != self.map[e] else e for e in self.names))
        self._fold_cache = {}
        self.st, self.cal = None, None

    def _mats(self, fids, P):
        L = np.zeros((len(fids), len(self.names)))
        M = np.zeros((len(fids), len(self.names)), bool)
        for j, e in enumerate(self.names):
            pe = P.get(self.map[e], {})
            for i, f in enumerate(fids):
                v = pe.get(f)
                if v is not None and np.isfinite(v):
                    L[i, j] = logit(np.clip(v, PCLIP, 1 - PCLIP))
                    M[i, j] = True
        D = self.Gall
        G = np.array([D[f] if f in D else np.full(len(self.MO.GATE_NAMES), np.nan) for f in fids], float)
        return L, M, G

    def _gs(self, G):
        Gn = np.where(np.isfinite(G), G, self.mu)
        return np.hstack([np.ones((len(G), 1)), (Gn - self.mu) / self.sd])

    def _rows_before(self, cutoff, start=HIST_FROM):
        return [i for i in self.ctx.order if start <= self.ctx.date[i] < cutoff and self.ctx.y[i] is not None
                and i in self.Gall]

    def _fit_stacker(self, ids, P):
        L, M, G = self._mats(ids, P)
        y = np.array([self.ctx.y[i] for i in ids])
        yrs = np.array([int(self.ctx.date[i][:4]) for i in ids])
        ok = M.any(1)
        st = self.MO.Stacker(self.method, self.names, self.drops, self.hp)
        return st.fit(L[ok], M[ok], self._gs(G[ok]), y[ok], yrs[ok])

    def _logits(self, st, ids, P):
        """Stack logits under every availability pattern of this regime (as tools/moe.py's OOF folds)."""
        L, M, G = self._mats(ids, P)
        y = np.array([self.ctx.y[i] for i in ids])
        dd = np.array([dt.date.fromisoformat(self.ctx.date[i]).toordinal() for i in ids])
        gg = self._newcomer(ids)
        zs, ys, ds, gs = [], [], [], []
        for d in self.drops:
            if self.regime == "present" and "market" in d:
                continue
            Md = self.MO.drop_mask(M, self.names, d)
            ok = Md.any(1)
            if ok.sum():
                try:
                    zs.append(self._safe_logit(st, L[ok], Md[ok], self._gs(G[ok])))
                    ys.append(y[ok])
                    ds.append(dd[ok])
                    gs.append(gg[ok])
                except KeyError:
                    continue
        if not zs:
            return np.zeros(0), np.zeros(0), np.zeros(0), np.zeros(0, bool)
        return np.concatenate(zs), np.concatenate(ys), np.concatenate(ds), np.concatenate(gs)

    def _newcomer(self, ids):
        F = self.ctx.fights
        return np.array([min(F[i]["A"].get("n") or 0, F[i]["B"].get("n") or 0) <= 2 for i in ids], bool)

    def _safe_logit(self, st, L, M, G):
        if self.method != "linear":
            return st.logit(L, M, G)
        z = np.zeros(len(L))
        for i in range(len(L)):
            pat = frozenset(e for e, m in zip(self.names, M[i]) if m)
            if pat not in st.lin:                       # untrained pattern: largest trained pattern inside it
                best = max((p for p in st.lin if p <= pat), key=len, default=None)
                if best is None:
                    raise KeyError(sorted(pat))
                pat = best
            idx, m = st.lin[pat]
            z[i] = L[i, idx] @ m.w
        return z

    def fit(self, cutoff, P):
        ids = self._rows_before(cutoff)
        _, _, G = self._mats(ids, P)
        self.mu = np.nanmean(G, 0)
        self.sd = np.nanstd(G, 0) + 1e-9
        self.st = self._fit_stacker(ids, P)
        self.cal = self.MO.Calib("none").fit(None, None) if self.cal_kind == "none" else None
        if self.cal_kind != "none":
            T = int(cutoff[:4])
            zs, ys, gs = [], [], []
            lo = dt.date.fromisoformat(cutoff).toordinal() - self.cal_days if self.cal_days else -1
            for Y in range(2021, T + 1):
                start, end = "%d-01-01" % Y, min("%d-01-01" % (Y + 1), cutoff)
                te = self._rows_before(end, start)
                if not te:
                    continue
                key = (Y, end)
                if key not in self._fold_cache:
                    if ("st", Y) not in self._fold_cache:
                        self._fold_cache[("st", Y)] = self._fit_stacker(self._rows_before(start), P)
                    self._fold_cache[key] = self._logits(self._fold_cache[("st", Y)], te, P)
                z, yy, dd, g = self._fold_cache[key]
                zs.append(z[dd >= lo])
                ys.append(yy[dd >= lo])
                gs.append(g[dd >= lo])
            Z, Yc, Gc = np.concatenate(zs), np.concatenate(ys), np.concatenate(gs)
            self.cal = self.MO.Calib(self.cal_kind).fit(Z, Yc)
            self.cal_g = None
            if self.cal_newcomer and Gc.sum() >= 100 and (~Gc).sum() >= 100:
                self.cal_g = {True: self.MO.Calib(self.cal_kind).fit(Z[Gc], Yc[Gc]),
                              False: self.MO.Calib(self.cal_kind).fit(Z[~Gc], Yc[~Gc])}
        info = {"fit_through": max(self.ctx.date[i] for i in ids), "n_train": len(ids),
                "calibration": self.cal.export() if hasattr(self.cal, "export") else None}
        if getattr(self, "cal_g", None):
            info["calibration_newcomer"] = self.cal_g[True].export()
            info["calibration_other"] = self.cal_g[False].export()
        return info

    def predict(self, fids, P):
        fids = [f for f in fids if f in self.Gall]
        L, M, G = self._mats(fids, P)
        out = {}
        if self.regime == "present":
            mi = self.names.index("market")
            keep = M[:, mi]
        else:
            keep = M.any(1)
        for i, f in enumerate(fids):
            if not keep[i]:
                continue
            try:
                z = self._safe_logit(self.st, L[i:i + 1], M[i:i + 1], self._gs(G[i:i + 1]))
            except KeyError:                       # a required expert is missing for this fight
                continue
            cal = self.cal
            if getattr(self, "cal_g", None):
                cal = self.cal_g[bool(self._newcomer([f])[0])]
            out[f] = float(cal(sigm(z))[0])
        return out

    def predict_swapped(self, fids, P):
        Q = {self.map[e]: {f: 1 - v for f, v in P.get(self.map[e], {}).items() if f in set(fids)} for e in self.names}
        return self.predict(fids, Q)

    def weights(self):
        if self.method != "linear" or self.st is None:
            return None
        full = frozenset(self.names) if self.regime == "present" else frozenset(e for e in self.names if e != "market")
        best = max((p for p in self.st.lin if p <= full), key=len, default=None)
        if best is None:
            return None
        idx, m = self.st.lin[best]
        return {self.names[j]: round(float(v), 4) for j, v in zip(idx, m.w)}


# ====================================================================== registered models
def _bt_p(ctx, fn):
    return {i: fn(f) for i, f in ctx.fights.items()}


@register("market_close", group="benchmark", line="close",
          desc="consensus closing line, power de-vig (data/derived/market.json p_power_close; p_novig_close if absent)")
def _market_close(ctx):
    mk = ctx.json("market.json")
    P = {i: (r.get("p_power_close") or r.get("p_novig_close")) for i, r in mk["fights"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="market.json built " + mk["meta"]["built"],
                  note="known minutes before the fight: a benchmark and a stacking input, never a pre-fight feature")


@register("market_open", group="benchmark", line="open", desc="opening line, proportional de-vig (market.json p_novig_open)")
def _market_open(ctx):
    mk = ctx.json("market.json")
    P = {i: r.get("p_novig_open") for i, r in mk["fights"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="market.json built " + mk["meta"]["built"])


@register("elo", desc="walk-forward Elo (tools/build_db.py: K 44, x1.5 for the first 5 UFC fights; tuned 2019-2023)")
def _elo(ctx):
    P = _bt_p(ctx, lambda f: 1 / (1 + 10 ** ((f["B"]["elo"] - f["A"]["elo"]) / 400.0)))
    return Stored(P, history=P, version="build_db Elo K44 boost1.5, backtest_dev built " + str(ctx.bt_meta.get("built")),
                  note="sequential: each pre-fight rating includes every earlier result")


@register("elo_sig", desc="strike-share margin Elo (tools/ml.py, K and share tuned 2010-2023), walk-forward")
def _elo_sig(ctx):
    mlj = ctx.json("ml.json")
    P = {i: r.get("elo_sig") for i, r in mlj["fights"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="ml.json built " + mlj["meta"]["built"])


@register("mkt_rating", desc="market rating: walk-forward Kalman filter on earlier closing lines (tools/market.py)")
def _mkt_rating(ctx):
    mk = ctx.json("market.json")
    P = {i: r.get("p_market_rating") for i, r in mk["fights"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="market.json built " + mk["meta"]["built"])


@register("ratings_whr", desc="round-level WHR (tools/ratings.py whr_rounds; params tuned 2019-2023, stream cut 2024-01-01)")
def _ratings_whr(ctx):
    r = ctx.json("ratings.json")
    if not r:
        return None
    P = {i: v["p"].get("whr_rounds") for i, v in r["predictions"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="ratings.json built " + r["meta"]["built"],
                  note="2019-2023 rows are in-sample for its ~20 tuned hyper-parameters")


@register("ratings_stack", desc="tools/ratings.py logistic stack of its rating systems (weights fit on 2019-2023)")
def _ratings_stack(ctx):
    r = ctx.json("ratings.json")
    if not r:
        return None
    P = {i: v["p"].get("stack") for i, v in r["predictions"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="ratings.json built " + r["meta"]["built"],
                  note="2019-2023 rows are cross-validated by year; 2024+ frozen")


@register("ratings_plus", desc="tools/ratings.py rating logits + pre-fight covariates (fit on 2019-2023)")
def _ratings_plus(ctx):
    r = ctx.json("ratings.json")
    if not r:
        return None
    P = {i: v["p"].get("ratings_plus") for i, v in r["predictions"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="ratings.json built " + r["meta"]["built"])


@register("preufc_elo", desc="Elo seeded at debut from the Sherdog pre-UFC record (tools/preufc.py; beta fit on pre-2024 debuts)")
def _preufc_elo(ctx):
    d = ctx.json("preufc.json")
    if not d or "seeded_elo_backtest" not in d:
        return None
    P = d["seeded_elo_backtest"]
    return Stored(ctx.dev(P), history=ctx.dev(P), version="preufc.json built " + d["meta"]["built"])


@register("ml_lr", refit="event", desc="tools/ml.py logistic winner model, refit before every card")
def _ml_lr(ctx):
    return MLLogistic(ctx, refit=ctx.args.ml_refit)


@register("ml_lr_static", desc="tools/ml.py logistic frozen at its 2010-2023 fit (ml.json 'lr'): the no-refit control")
def _ml_lr_static(ctx):
    mlj = ctx.json("ml.json")
    P = {i: r.get("lr") for i, r in mlj["fights"].items()}
    return Stored(ctx.dev(P), history={i: r["lr"] for i, r in mlj["fights"].items() if r.get("set") == "oof"},
                  version="ml.json built " + mlj["meta"]["built"])


@register("ml_lr_annual", desc="tools/ml.py logistic refit each Jan 1 (ml.json 'lr_refit'): the annual-refit control")
def _ml_lr_annual(ctx):
    mlj = ctx.json("ml.json")
    P = {i: (r.get("lr_refit") if r.get("set") == "test" else r.get("lr")) for i, r in mlj["fights"].items()}
    return Stored(ctx.dev(P), history=ctx.dev(P), version="ml.json built " + mlj["meta"]["built"])


@register("ml_lgb", refit="month", desc="tools/ml.py LightGBM, frozen hyper-parameters, refit before each month's first card")
def _ml_lgb(ctx):
    return MLTrees(ctx, "lgb", refit=ctx.args.tree_refit)


@register("ml_xgb", refit="month", desc="tools/ml.py XGBoost, frozen hyper-parameters, refit before each month's first card")
def _ml_xgb(ctx):
    return MLTrees(ctx, "xgb", refit=ctx.args.tree_refit)


@register("feat_lr", refit="event", desc="tools/moe.py page feature LR, refit before every card")
def _feat_lr(ctx):
    return FeatLR(ctx, refit=ctx.args.ml_refit)


def _engine_factory(ver):
    def fac(ctx):
        P, B = {}, {}
        for split in ("train", "val"):
            p = os.path.join(DERIVED, "evalv", "%s_%s.json" % (ver, split))
            if not os.path.exists(p):
                continue
            d = json.load(open(p))
            for r in d["fights"]:
                if r["id"] in ctx.fights and r.get("pA") is not None:
                    P[r["id"]] = r["pA"]
                    if r.get("b7"):
                        B[r["id"]] = r["b7"]
            meta = d["meta"]
        if not any(WINDOW[0] <= ctx.date[i] <= WINDOW[1] for i in P):
            return None
        hist = {i: p for i, p in P.items() if ctx.date[i] < WINDOW[0]}
        return Stored(P, history=hist, bins=B, version="evalv %s (engine %s, params %s sha %s, %s sims/order, built %s)" % (
            ver, meta.get("engine_version"), meta.get("params_version"), str(meta.get("params_sha256", ""))[:12],
            meta.get("sims_per_order"), meta.get("built")),
            note="frozen engine (global scales self-calibrated on 2019-2023 train), walk-forward profiles, leak-free "
                 "learned stat-line rates; 2019-2023 rows are in-sample for those few scales",
            symmetric="by construction (both corner orders simulated and averaged)")
    return fac


def _engine_rejected():
    """Engine versions whose recorded validation decision says kept: false (data/derived/version_history.json)."""
    try:
        vh = json.load(open(os.path.join(DERIVED, "version_history.json")))
    except Exception:
        return set()
    return {"engine_" + v["version"] for v in vh.get("versions", [])
            if isinstance(v.get("decision"), dict) and v["decision"].get("kept") is False}


_ENG_REJECTED = _engine_rejected()
for _p in sorted(glob.glob(os.path.join(DERIVED, "evalv", "v*_val.json"))):
    _ver = os.path.basename(_p).split("_")[0]
    register("engine_" + _ver, desc="simulator %s (tools/evalv.js validation run, %s)%s" % (
        _ver, os.path.basename(_p), "; REJECTED at its validation look (version_history.json), scored for the record"
        if "engine_" + _ver in _ENG_REJECTED else ""))(_engine_factory(_ver))


def _mr_cells_to(cells, R):
    c = np.asarray(cells, float)
    aK, aS, bK, bS = c[:R].sum(), c[R:2 * R].sum(), c[2 * R:3 * R].sum(), c[3 * R:4 * R].sum()
    aD, bD, dr = c[4 * R], c[4 * R + 1], c[4 * R + 2]
    pa, pb = aK + aS + aD, bK + bS + bD
    return pa / max(1e-12, pa + pb), [aK, aS, aD, dr, bD, bS, bK]


def _mr_factory(variant):
    def fac(ctx):
        d = ctx.json("methodround.json")
        if not d:
            return None
        P, B, FT = {}, {}, {}
        for i, r in d["fights"].items():
            if i not in ctx.fights:
                continue
            key = variant + "_refit" if r.get(variant + "_refit") else variant
            if not r.get(key):
                continue
            ft = r.get("fit_through")
            if key.endswith("_refit"):
                ft = "%d-12-31" % (int(r["date"][:4]) - 1)
            p, b = _mr_cells_to(r[key], r["rounds"] or 3)
            P[i], B[i], FT[i] = p, b, ft
        return Stored(P, history={i: p for i, p in P.items() if ctx.date[i] < WINDOW[0]}, bins=B, fit_through=FT,
                      version="methodround.json %s (annual refit where published) built %s" % (variant, d["meta"]["built"]),
                      symmetric="by construction (both orientations averaged)")
    return fac


register("mr_S", desc="method/round model S (tools/methodround.py, stats only); P(A) = its A cells / (1 - draw)")(_mr_factory("S"))
register("mr_SM", line="close", desc="method/round model SM (S + the closing line as a feature)")(_mr_factory("SM"))

register("ml_blend", group="stack", refit="event", needs=("ml_lr", "ml_lgb", "ml_xgb"),
         desc="tools/ml.py blend of logistic, LightGBM and XGBoost (non-negative logit weights), refit before every card")(
    lambda ctx: Stack(ctx, ["ml_lr", "ml_lgb", "ml_xgb"]))
register("stack_elo_ml_mr", group="stack", refit="event", needs=("elo", "ml_lr", "mkt_rating"),
         desc="the ml.json recommended pre-line stack (Elo + ML + market rating), refit before every card")(
    lambda ctx: Stack(ctx, ["elo", "ml_lr", "mkt_rating"], required=["elo", "ml_lr"]))

def _engine_vkey(k):
    """'engine_v4.0.1' -> (4, 0, 1); 'engine_v4' -> (4,): numeric order, so v4 < v4.0.1 < v5."""
    return tuple(int(x) for x in k[len("engine_v"):].split(".") if x.isdigit())


_ENG = sorted([k for k in REGISTRY if k.startswith("engine_v")], key=_engine_vkey)
# The MoE stackers use the newest engine version that has made its validation look and was not rejected (the page's
# engine follows the same rule); BLINDTEST_MOE_ENGINE=engine_v4 pins another one.
_ENG_OK = [k for k in _ENG if k not in _ENG_REJECTED]
_ENGK = os.environ.get("BLINDTEST_MOE_ENGINE") or (_ENG_OK[-1] if _ENG_OK else None)
if _ENGK and _ENGK not in REGISTRY:
    raise SystemExit("BLINDTEST_MOE_ENGINE=%s is not a registered engine (%s)" % (_ENGK, ", ".join(_ENG)))
_MOE_BASE = {"mkt_rating": "mkt_rating", "ml": "ml_lr", "feat_lr": "feat_lr", "elo_sig": "elo_sig", "elo": "elo"}
if _ENGK:
    _MOE_BASE["engine"] = _ENGK


def _moe_reg(key, regime, extra, desc, experimental=False, **kw):
    ex = dict(_MOE_BASE, **extra)
    register(key, group="stack", line={"market_close": "close", "market_open": "open"}.get(extra.get("market")),
             refit=kw.get("refit", "event"), needs=tuple(sorted(set(ex.values()))), desc=desc,
             experimental=experimental)(lambda ctx: MoEStack(ctx, ex, regime, **kw))


_moe_reg("moe_noline", "absent", {}, "the MoE stacker without a line (moe.json 'absent' config), refit before every card")
_moe_reg("moe_open", "present", {"market": "market_open"}, "the MoE stacker with the opening line as its market expert")
_moe_reg("moe_close", "present", {"market": "market_close"}, "the MoE stacker with the closing line ('present' config)")
_moe_reg("moe_noline_plus", "absent", {"ratings": "ratings_whr", "mr": "mr_S"},
         "experiment: moe_noline + round-level WHR + method/round S as extra experts", experimental=True)
_moe_reg("moe_close_plus", "present", {"market": "market_close", "ratings": "ratings_whr", "mr": "mr_S"},
         "experiment: moe_close + round-level WHR + method/round S as extra experts", experimental=True)
_moe_reg("moe_noline_frozen", "absent", {}, "control: moe_noline fit once on 2019-2023 (refit 'once'), never updated",
         experimental=True, refit="once")
_moe_reg("moe_close_frozen", "present", {"market": "market_close"}, "control: moe_close fit once on 2019-2023",
         experimental=True, refit="once")
_moe_reg("moe_noline_pre", "absent", {"preufc": "preufc_elo"},
         "experiment: moe_noline + the pre-UFC-seeded Elo as an extra expert (newcomers)", experimental=True)
_moe_reg("moe_noline_rt", "absent", {}, "experiment: moe_noline with its temperature fit on the last 730 days only",
         experimental=True, cal="temperature", cal_days=730)
_moe_reg("moe_noline_nt", "absent", {}, "experiment: moe_noline with separate temperatures for newcomer fights and the rest",
         experimental=True, cal="temperature", cal_newcomer=True)
_moe_reg("moe_close_nt", "present", {"market": "market_close"},
         "experiment: moe_close with separate temperatures for newcomer fights and the rest", experimental=True,
         cal="temperature", cal_newcomer=True)
_moe_reg("moe_noline_gated", "absent", {}, "experiment: moe_noline as tools/moe.py's softmax-gated MoE (weights and "
         "confidence depend on experience, Elo gap, layoff, age, division, 5 rounds), lam 0.03, temperature",
         experimental=True, method="gated", hp={"lam": 0.03}, cal="temperature")
_moe_reg("moe_close_gated", "present", {"market": "market_close"}, "experiment: moe_close as the softmax-gated MoE, lam 0.03",
         experimental=True, method="gated", hp={"lam": 0.03})
_moe_reg("moe_close_rt", "present", {"market": "market_close"},
         "experiment: moe_close plus a temperature fit on the last 730 days (moe.json chose none)", experimental=True,
         cal="temperature", cal_days=730)


def load_plugins():
    sys.modules.setdefault("blindtest", sys.modules[__name__])
    if not os.path.isdir(PLUGIN_DIR):
        return []
    done = []
    for p in sorted(glob.glob(os.path.join(PLUGIN_DIR, "*.py"))):
        if os.path.basename(p).startswith("_"):
            continue
        spec = importlib.util.spec_from_file_location("blindtest_plugin_" + os.path.basename(p)[:-3], p)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        done.append(os.path.relpath(p, ROOT))
    return done


# ====================================================================== replay
def topo(keys):
    out, seen = [], set()

    def visit(k):
        if k in seen:
            return
        seen.add(k)
        for n in REGISTRY[k]["needs"]:
            if n in REGISTRY:
                visit(n)
        out.append(k)
    for k in keys:
        visit(k)
    return out


def due(schedule, last, cutoff):
    if last is None:
        return True
    if schedule == "event":
        return True
    if schedule == "once":
        return False
    if schedule == "month":
        return cutoff[:7] != last[:7]
    if schedule == "year":
        return cutoff[:4] != last[:4]
    return False


class FitCache:
    """Per-model pickle of {cutoff: (fit info, {fid: p}, {fid: p swapped})} keyed by the model's version string."""
    def __init__(self, key, version, enabled, write=True):
        self.enabled, self.write = enabled, write
        os.makedirs(CACHE, exist_ok=True)
        self.path = os.path.join(CACHE, "%s_%s.pkl" % (key, hashlib.sha256(version.encode()).hexdigest()[:12]))
        self.d = {}
        if enabled and os.path.exists(self.path):
            try:
                self.d = pickle.load(open(self.path, "rb"))
            except Exception:
                self.d = {}
        self.dirty = False

    def get(self, k):
        return self.d.get(k) if self.enabled else None

    def put(self, k, v):
        self.d[k] = v
        self.dirty = True

    def save(self):
        if self.dirty and self.write:
            if not self.enabled and os.path.exists(self.path):     # --no-cache: refresh entries, never drop others
                try:
                    old = pickle.load(open(self.path, "rb"))
                    old.update(self.d)
                    self.d = old
                except Exception:
                    pass
            pickle.dump(self.d, open(self.path + ".tmp", "wb"))
            os.replace(self.path + ".tmp", self.path)
            self.dirty = False


def replay(ctx, keys):
    t_start = time.time()
    replay_utc = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    models, skipped = {}, {}
    for k in topo(keys):
        spec = REGISTRY[k]
        if any(n not in models for n in spec["needs"]):
            skipped[k] = "needs %s" % [n for n in spec["needs"] if n not in models]
            continue
        try:
            m = spec["factory"](ctx)
        except SystemExit:
            raise
        except Exception as ex:
            skipped[k] = "factory failed: %r" % ex
            log("skip %s: %r" % (k, ex))
            continue
        if m is None:
            skipped[k] = "inputs not present"
            continue
        if spec["refit"] != "never" and getattr(m, "refit", None) is None:
            m.refit = spec["refit"]
        models[k] = m
    order = [k for k in topo(keys) if k in models]
    log("models: %s" % ", ".join(order))
    if skipped:
        log("skipped: %s" % skipped)

    # P[model][fid]: history (strictly out-of-sample 2019-2023) + replay predictions as they are made
    # (the harness keeps only history rows dated HIST_FROM..the day before the window: a plugin may pass its whole map)
    P = {k: {f: v for f, v in models[k].history().items() if f in ctx.fights and HIST_FROM <= ctx.date[f] < WINDOW[0]}
         for k in order}
    rec = {k: {} for k in order}                # fid -> [p, refit_at, fit_through]
    bins = {k: {} for k in order}
    fits = {k: [] for k in order}
    sym = {k: {"max_abs": 0.0, "n": 0} for k in order}
    # cache keys chain the versions of everything a model reads, so a stacker's cached predictions die with its inputs
    cver = {}
    for k in order:
        cver[k] = models[k].version + "".join("|" + cver[n] for n in REGISTRY[k]["needs"] if n in cver)
    caches = {k: FitCache(k, cver[k], not ctx.args.no_cache and not ctx.perturb_from,
                          write=not ctx.perturb_from) for k in order}
    last_fit = {k: None for k in order}         # cutoff of the fit in force
    fitted = {k: False for k in order}          # is the model object holding that fit in this process?
    fit_info = {k: None for k in order}
    leak = []
    events = []
    secs = {k: 0.0 for k in order}
    by_date = {}
    for i in ctx.win_ids:
        by_date.setdefault(ctx.date[i], []).append(i)
    dates = sorted(by_date)
    if ctx.args.quick or getattr(ctx.args, "cards", None):
        dates = dates[:getattr(ctx.args, "cards", None) or 8]
    for n_ev, d in enumerate(dates):
        fids = by_date[d]
        fset = set(fids)
        ev = {"date": d, "event": ctx.fights[fids[0]]["event"], "n": len(fids), "refit": []}
        for k in order:
            t_k = time.time()
            m = models[k]
            sched = getattr(m, "refit", "never") or "never"
            new_fit = sched != "never" and due(sched, last_fit[k], d)
            if new_fit:
                last_fit[k], fitted[k], fit_info[k] = d, False, None
            cacheable = sched != "never"
            hit = caches[k].get((last_fit[k], d)) if cacheable else None
            if hit is not None:
                info, pr, ps = hit
                fit_info[k] = fit_info[k] or info
            else:
                if sched != "never" and not fitted[k]:
                    fit_info[k] = m.fit(last_fit[k], P) or {}
                    fitted[k] = True
                pr = m.predict(fids, P)
                ps = m.predict_swapped(fids, P) if hasattr(m, "predict_swapped") else None
                if cacheable:
                    caches[k].put((last_fit[k], d), (fit_info[k], pr, ps))
            if new_fit:
                info = dict(fit_info[k] or {}, refit_at=d)
                fits[k].append(info)
                ev["refit"].append(k)
                if info.get("fit_through") and info["fit_through"] >= d:
                    leak.append("%s fit through %s for the %s card" % (k, info["fit_through"], d))
            if ps:
                for f, v in ps.items():
                    if f in pr:
                        sym[k]["max_abs"] = max(sym[k]["max_abs"], abs(pr[f] + v - 1.0))
                        sym[k]["n"] += 1
            ft_fit = (fit_info[k] or {}).get("fit_through")
            for f, v in pr.items():
                if f not in fset:
                    continue
                ft = m.fit_through_of(f) or ft_fit
                if ft and ft >= d:
                    leak.append("%s fit through %s predicts %s (%s)" % (k, ft, f, d))
                rec[k][f] = [float(v), last_fit[k], ft]
                P[k][f] = float(v)
            for f, b in m.bins7(fids).items():
                bins[k][f] = [float(x) for x in b]
            secs[k] += time.time() - t_k
        events.append(ev)
        if (n_ev + 1) % 10 == 0 or n_ev == len(dates) - 1:
            log("card %d/%d %s (%.0f s; slowest: %s)" % (n_ev + 1, len(dates), d, time.time() - t_start, ", ".join(
                "%s %.0fs" % kv for kv in sorted(secs.items(), key=lambda kv: -kv[1])[:4])))
            for c in caches.values():
                c.save()
    for c in caches.values():
        c.save()
    if leak:
        raise SystemExit("look-ahead guard tripped:\n  " + "\n  ".join(leak[:20]))
    for k in order:   # stackers served from the cache never fit in this process: refit the last fit for its weights
        m = models[k]
        if hasattr(m, "weights") and not fitted[k] and last_fit[k] and getattr(m, "refit", "never") != "never":
            try:
                m.fit(last_fit[k], P)
            except Exception as ex:
                log("weights refit for %s failed: %r" % (k, ex))
    meta_models = {}
    for k in order:
        m, spec = models[k], REGISTRY[k]
        w = m.weights() if hasattr(m, "weights") else None
        meta_models[k] = {"version": m.version, "desc": spec["desc"], "group": spec["group"], "line": spec["line"],
                          "refit": getattr(m, "refit", "never"), "needs": list(spec["needs"]),
                          "experimental": spec["experimental"], "n_fits": len(fits[k]), "note": m.note,
                          "symmetric": m.symmetric, "n_history": len(P[k]) - len(rec[k]),
                          "symmetry_check": {"n": sym[k]["n"], "max_abs_p_plus_pswap_minus_1": float("%.3g" % sym[k]["max_abs"])} if sym[k]["n"] else None,
                          "final_weights": w, "replay_cpu_wall_s": round(secs[k], 1)}
    return dict(replay_utc=replay_utc, seconds=round(time.time() - t_start), models=meta_models, skipped=skipped,
                rec=rec, bins=bins, fits=fits, events=events, order=order)


# ====================================================================== scoring
def bin7_of(f):
    w, m = f["result"]["winner"], f["result"]["method"]
    if w == "D":
        return 3
    if w not in ("A", "B"):
        return None
    k = {"KO": 0, "DOC": 0, "SUB": 1, "UD": 2, "SD": 2, "MD": 2}.get(m)
    if k is None:
        return None
    return k if w == "A" else 6 - k


def segments_of(f, p_close):
    a, b = f["A"], f["B"]
    nmin = min(a.get("n") or 0, b.get("n") or 0)
    div = f.get("division") or ""
    grp = "women" if div.startswith("Women") else {"Flyweight": "light (125-145)", "Bantamweight": "light (125-145)",
                                                   "Featherweight": "light (125-145)", "Light Heavyweight": "heavy (205+)",
                                                   "Heavyweight": "heavy (205+)"}.get(div, "middle (155-185)")
    s = {"experience": "1-2 (newcomer)" if nmin <= 2 else ("3-5" if nmin <= 5 else ("6-10" if nmin <= 10 else "11+")),
         "year": f["date"][:4], "rounds": "5 rounds" if f["rounds"] == 5 else "3 rounds",
         "title": "title" if f.get("title") else "non-title", "division": grp}
    if p_close is None:
        s["market_fav"] = "no closing line"
    else:
        q = max(p_close, 1 - p_close)
        s["market_fav"] = "50-60%" if q < 0.6 else ("60-70%" if q < 0.7 else ("70-80%" if q < 0.8 else "80%+"))
    return s


def calib_slope(p, y):
    """Mirrored, no-intercept logistic slope of y on logit(p) (1 = calibrated, > 1 underconfident)."""
    z = logit(p)
    z, yy = np.r_[z, -z], np.r_[y, 1 - y]
    b = 1.0
    for _ in range(50):
        q = sigm(b * z)
        g = np.sum((q - yy) * z)
        h = np.sum(q * (1 - q) * z * z) + 1e-12
        b -= g / h
        if abs(g / h) < 1e-10:
            break
    return float(b)


def basic_metrics(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    ll = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    acc = np.where(np.abs(p - 0.5) < 1e-12, 0.5, ((p > 0.5) == (y > 0.5)).astype(float))
    pm, ym = np.r_[p, 1 - p], np.r_[y, 1 - y]
    bins = np.minimum((pm * 10).astype(int), 9)
    ece = sum(abs(pm[bins == b].mean() - ym[bins == b].mean()) * (bins == b).mean() for b in range(10) if (bins == b).any())
    return {"n": int(len(y)), "log_loss": r5(ll.mean()), "brier": r5(np.mean((p - y) ** 2)), "accuracy": r4(acc.mean()),
            "ece": r4(ece), "slope": r4(calib_slope(p, y))}


def calib_table(p, y, nb=10):
    pm, ym = np.r_[p, 1 - p], np.r_[y, 1 - y]
    bins = np.minimum((pm * nb).astype(int), nb - 1)
    out = []
    for b in range(nb // 2, nb):
        s = bins == b
        if s.sum():
            out.append({"bin": "%d-%d%%" % (b * 100 // nb, (b + 1) * 100 // nb), "n": int(s.sum()),
                        "pred": r4(pm[s].mean()), "obs": r4(ym[s].mean())})
    return out


class Boot:
    """Event-cluster bootstrap with one fixed set of resampling weights over the window's event dates."""
    def __init__(self, clusters_all, B, seed=7):
        self.uc = sorted(set(clusters_all))
        self.ix = {c: k for k, c in enumerate(self.uc)}
        rng = np.random.default_rng(seed)
        C = len(self.uc)
        draws = rng.integers(0, C, (B, C))
        self.W = np.zeros((B, C))
        np.add.at(self.W, (np.repeat(np.arange(B), C), draws.ravel()), 1.0)

    def ci(self, vals, clusters):
        """Mean of vals with a 95% CI (resampling events; fights in unsampled events drop out)."""
        k = np.array([self.ix[c] for c in clusters])
        S = np.bincount(k, weights=vals, minlength=len(self.uc))
        N = np.bincount(k, minlength=len(self.uc)).astype(float)
        num, den = self.W @ S, self.W @ N
        ok = den > 0
        est = num[ok] / den[ok]
        lo, hi = np.percentile(est, [2.5, 97.5])
        return {"est": r5(vals.mean()), "lo": r5(lo), "hi": r5(hi), "p_gt0": r4(np.mean(est > 0))}


def score(ctx, R, B_boot=2000):
    rec, order = R["rec"], R["order"]
    close = {f: v[0] for f, v in rec.get("market_close", {}).items()}
    qd = set(R["quick_dates"]) if R.get("quick_dates") else None
    universe = [i for i in ctx.win_ids if qd is None or ctx.date[i] in qd]
    win_dec = [i for i in universe if ctx.y[i] is not None]
    seg = {i: segments_of(ctx.fights[i], close.get(i)) for i in win_dec}
    boot = Boot([ctx.date[i] for i in win_dec], B_boot)
    yv = {i: ctx.y[i] for i in win_dec}

    def arr(k, ids):
        return np.array([rec[k][i][0] for i in ids]), np.array([yv[i] for i in ids])

    def lls(k, ids):
        p, y = arr(k, ids)
        p = np.clip(p, 1e-6, 1 - 1e-6)
        return -(y * np.log(p) + (1 - y) * np.log(1 - p))

    out = {"n_window_decisive": len(win_dec), "own_coverage": {}, "common": {}, "paired": {}, "segments": {},
           "calibration": {}, "cumulative": {}, "seven_bin": {}, "by_year": {}}
    for k in order:
        ids = [i for i in win_dec if i in rec[k]]
        if len(ids) < 20:
            continue
        p, y = arr(k, ids)
        m = basic_metrics(p, y)
        m["coverage"] = r4(len(ids) / len(win_dec))
        m["ci"] = boot.ci(lls(k, ids), [ctx.date[i] for i in ids])
        out["own_coverage"][k] = m
    # common set: every non-experimental model with >= 95% coverage (the newcomer-only and partial models are left out)
    head = [k for k in order if k in out["own_coverage"] and out["own_coverage"][k]["coverage"] >= 0.95]
    common = [i for i in win_dec if all(i in rec[k] for k in head)]
    out["common"]["models"] = head
    out["common"]["n"] = len(common)
    out["common"]["n_events"] = len(set(ctx.date[i] for i in common))
    out["common"]["metrics"] = {}
    cl = [ctx.date[i] for i in common]
    for k in head:
        p, y = arr(k, common)
        m = basic_metrics(p, y)
        m["ci"] = boot.ci(lls(k, common), cl)
        out["common"]["metrics"][k] = m
        out["calibration"][k] = calib_table(p, y)
    refs = [r for r in ("market_close", "market_open", "elo", "ml_lr", "moe_noline", "moe_close") if r in out["own_coverage"]]
    for k in out["own_coverage"]:
        out["paired"][k] = {}
        for r in refs:
            if r == k:
                continue
            ids = [i for i in win_dec if i in rec[k] and i in rec[r]]
            if len(ids) < 20:
                continue
            d = lls(k, ids) - lls(r, ids)
            c = boot.ci(d, [ctx.date[i] for i in ids])
            c["n"] = len(ids)
            out["paired"][k][r] = c
    # segments (common set)
    ORDER = ["1-2 (newcomer)", "3-5", "6-10", "11+", "50-60%", "60-70%", "70-80%", "80%+", "no closing line"]
    for dim in ("experience", "year", "rounds", "title", "division", "market_fav"):
        levels = sorted(set(seg[i][dim] for i in common), key=lambda v: (ORDER.index(v) if v in ORDER else 99, v))
        out["segments"][dim] = {}
        for lv in levels:
            ids = [i for i in common if seg[i][dim] == lv]
            row = {"n": len(ids)}
            for k in head:
                row[k] = r5(lls(k, ids).mean())
            if "market_close" in head and len(ids) >= 20:
                for k in head:
                    if k != "market_close":
                        d = lls(k, ids) - lls("market_close", ids)
                        row.setdefault("d_close", {})[k] = boot.ci(d, [ctx.date[i] for i in ids])
            out["segments"][dim][lv] = row
    # newcomer table on each model's own coverage (includes partial-coverage models)
    out["newcomers_own"] = {}
    for k in out["own_coverage"]:
        ids = [i for i in win_dec if i in rec[k] and seg[i]["experience"].startswith("1-2")]
        if len(ids) >= 20:
            p, y = arr(k, ids)
            out["newcomers_own"][k] = basic_metrics(p, y)
    # cumulative curves on the common set, event by event
    ev_dates = sorted(set(cl))
    cum = {"dates": ev_dates, "n": [], "log_loss": {k: [] for k in head}, "d_close": {k: [] for k in head},
           "events_beating_close": {}}
    L = {k: lls(k, common) for k in head}
    dates_c = np.array(cl)
    for d in ev_dates:
        s = dates_c <= d
        cum["n"].append(int(s.sum()))
        for k in head:
            cum["log_loss"][k].append(r5(L[k][s].mean()))
            if "market_close" in head:
                cum["d_close"][k].append(r5((L[k][s] - L["market_close"][s]).mean()))
    if "market_close" in head:
        for k in head:
            per = [(L[k][dates_c == d] - L["market_close"][dates_c == d]).mean() for d in ev_dates]
            cum["events_beating_close"][k] = int(sum(1 for v in per if v < 0))
    out["cumulative"] = cum
    for yv_ in ("2024", "2025"):
        ids = [i for i in common if ctx.date[i].startswith(yv_)]
        out["by_year"][yv_] = {k: r5(lls(k, ids).mean()) for k in head}
    # 7-bin (models that publish bins), on the fights where they all do
    b7 = {i: bin7_of(ctx.fights[i]) for i in universe}
    bk = [k for k in order if sum(1 for i in universe if i in R["bins"].get(k, {})) >= 0.95 * len(universe)]
    ids7 = [i for i in universe if b7[i] is not None and all(i in R["bins"][k] for k in bk)]
    if bk and ids7:
        cl7 = [ctx.date[i] for i in ids7]
        L7 = {}
        for k in bk:
            v = []
            for i in ids7:
                b = np.clip(np.asarray(R["bins"][k][i], float), 1e-6, None)
                b = b / b.sum()
                v.append(-math.log(b[b7[i]]))
            L7[k] = np.array(v)
            out["seven_bin"][k] = boot.ci(L7[k], cl7)
        out["seven_bin"]["n"] = len(ids7)
        if len(bk) > 1:
            ref = "mr_S" if "mr_S" in bk else bk[0]
            out["seven_bin"]["paired_vs_" + ref] = {k: boot.ci(L7[k] - L7[ref], cl7) for k in bk if k != ref}
    return out


# ====================================================================== report
def fmt_ci(c, d=4):
    if not c:
        return ""
    return ("%." + str(d) + "f [%." + str(d) + "f, %." + str(d) + "f]") % (c["est"], c["lo"], c["hi"])


def fmt_d(c):
    if not c:
        return ""
    return "%+.4f [%+.4f, %+.4f]" % (c["est"], c["lo"], c["hi"])


def write_report(doc):
    S, M = doc["scores"], doc["meta"]["models"]
    lines = []
    A = lines.append
    cm = S["common"]
    A("_Generated by `python3 tools/blindtest.py` (replay %s UTC, %d events, %d decisive fights in the window; "
      "common set %d fights on %d events). Lower log loss is better; differences are model minus reference, "
      "negative = the model is better; 95%% event-cluster bootstrap CIs (%d resamples)._"
      % (doc["meta"]["replay_utc"].replace("+00:00", ""), len(doc["events"]), S["n_window_decisive"], cm["n"],
         cm["n_events"], doc["meta"]["bootstrap"]))
    A("")
    A("### Cumulative blind scoreboard, 2024-01-01..2025-12-31 (common set)")
    A("")
    A("| # | model | info | log loss [95% CI] | vs close | vs Elo | Brier | acc | slope | ECE |")
    A("|---|---|---|---|---|---|---|---|---|---|")
    rows = sorted(cm["metrics"].items(), key=lambda kv: kv[1]["log_loss"])
    for n, (k, m) in enumerate(rows, 1):
        info = {"close": "close", "open": "open"}.get(M[k]["line"], "no line")
        pc = S["paired"].get(k, {}).get("market_close")
        pe = S["paired"].get(k, {}).get("elo")
        A("| %d | `%s`%s | %s | %s | %s | %s | %.4f | %.1f%% | %.2f | %.3f |" % (
            n, k, " (exp.)" if M[k]["experimental"] else "", info, fmt_ci(m["ci"]), fmt_d(pc) if pc else "-",
            fmt_d(pe) if pe else "-", m["brier"], 100 * m["accuracy"], m["slope"], m["ece"]))
    A("")
    outside = [(k, m) for k, m in sorted(S["own_coverage"].items(), key=lambda kv: kv[1]["log_loss"]) if k not in cm["metrics"]]
    if outside:
        A("Models outside the common set (own coverage):")
        A("")
        A("| model | n | coverage | log loss [95% CI] | vs close (same fights) |")
        A("|---|---|---|---|---|")
        for k, m in outside:
            pc = S["paired"].get(k, {}).get("market_close")
            A("| `%s` | %d | %.0f%% | %s | %s |" % (k, m["n"], 100 * m["coverage"], fmt_ci(m["ci"]), fmt_d(pc) if pc else "-"))
        A("")
    if "ml_lr" in S["paired"]:
        A("Paired against the replayed ML logistic (`ml_lr`), the no-line MoE (`moe_noline`) and the MoE with the closing "
          "line (`moe_close`), same fights:")
        A("")
        A("| model | vs ml_lr | vs moe_noline | vs moe_close |")
        A("|---|---|---|---|")
        for k, _ in rows:
            a = S["paired"].get(k, {}).get("ml_lr")
            b = S["paired"].get(k, {}).get("moe_noline")
            c = S["paired"].get(k, {}).get("moe_close")
            A("| `%s` | %s | %s | %s |" % (k, fmt_d(a) if a else "-", fmt_d(b) if b else "-", fmt_d(c) if c else "-"))
        A("")
    cu = S["cumulative"]
    A("### Cumulative log loss over time (common set; checkpoints at the last card of each quarter)")
    A("")
    keys = [k for k, _ in rows]
    show = [k for k in ("market_close", "moe_close", "moe_open", "market_open", "moe_noline", "stack_elo_ml_mr",
                        "ml_blend", "ml_lr", "feat_lr", "ratings_stack", "mr_S", _ENGK, "elo") if k in keys]
    A("| through | n | " + " | ".join("`%s`" % k for k in show) + " |")
    A("|---|---|" + "---|" * len(show))
    qs = {}
    for j, d in enumerate(cu["dates"]):
        qs["%s Q%d" % (d[:4], (int(d[5:7]) - 1) // 3 + 1)] = j
    for q, j in qs.items():
        A("| %s (%s) | %d | " % (q, cu["dates"][j], cu["n"][j]) + " | ".join("%.4f" % cu["log_loss"][k][j] for k in show) + " |")
    A("")
    if cu.get("d_close"):
        A("Cumulative paired difference vs the closing line at the same checkpoints, and the number of the %d cards on "
          "which the model's mean log loss beat the close:" % len(cu["dates"]))
        A("")
        show2 = [k for k in show if k != "market_close"]
        A("| through | " + " | ".join("`%s`" % k for k in show2) + " |")
        A("|---|" + "---|" * len(show2))
        for q, j in qs.items():
            A("| %s | " % q + " | ".join("%+.4f" % cu["d_close"][k][j] for k in show2) + " |")
        A("| cards beating the close | " + " | ".join("%d" % cu["events_beating_close"].get(k, 0) for k in show2) + " |")
        A("")
    A("### By segment (common set, log loss)")
    A("")
    show3 = [k for k in ("market_close", "moe_close", "market_open", "moe_noline", "ml_lr", "ratings_stack", "mr_S", _ENGK, "elo") if k in keys]
    for dim, lab in (("experience", "less experienced man's prior UFC fights"), ("market_fav", "closing-line favourite"),
                     ("year", "year"), ("rounds", "scheduled rounds"), ("title", "title"), ("division", "division group")):
        A("**%s**" % lab)
        A("")
        A("| segment | n | " + " | ".join("`%s`" % k for k in show3) + " | moe_noline - close |")
        A("|---|---|" + "---|" * len(show3) + "---|")
        for lv, row in S["segments"][dim].items():
            dc = (row.get("d_close") or {}).get("moe_noline")
            A("| %s | %d | " % (lv, row["n"]) + " | ".join("%.4f" % row[k] for k in show3) + " | %s |" % (fmt_d(dc) if dc else "-"))
        A("")
    if S.get("newcomers_own"):
        A("Newcomer fights (the less experienced man has 1-2 prior UFC fights), each model's own coverage:")
        A("")
        A("| model | n | log loss | Brier | acc | slope |")
        A("|---|---|---|---|---|---|")
        for k, m in sorted(S["newcomers_own"].items(), key=lambda kv: kv[1]["log_loss"]):
            A("| `%s` | %d | %.4f | %.4f | %.1f%% | %.2f |" % (k, m["n"], m["log_loss"], m["brier"], 100 * m["accuracy"], m["slope"]))
        A("")
    A("### Calibration (mirrored; favourite side)")
    A("")
    show4 = [k for k in ("market_close", "moe_close", "moe_noline", "ml_lr", _ENGK, "elo") if k in S["calibration"]]
    bins = [b["bin"] for b in S["calibration"][show4[0]]] if show4 else []
    A("| bin | " + " | ".join("`%s` n / pred / obs" % k for k in show4) + " |")
    A("|---|" + "---|" * len(show4))
    for b in bins:
        cells = []
        for k in show4:
            r = next((x for x in S["calibration"][k] if x["bin"] == b), None)
            cells.append("%d / %.3f / %.3f" % (r["n"], r["pred"], r["obs"]) if r else "-")
        A("| %s | " % b + " | ".join(cells) + " |")
    A("")
    if S.get("seven_bin"):
        sb = S["seven_bin"]
        A("### 7-bin outcome (A KO / SUB / DEC, draw, B DEC / SUB / KO), n = %d" % sb["n"])
        A("")
        A("| model | 7-bin log loss [95% CI] | vs mr_S |")
        A("|---|---|---|")
        pv = sb.get("paired_vs_mr_S", {})
        for k, c in sb.items():
            if isinstance(c, dict) and "est" in c:
                A("| `%s` | %s | %s |" % (k, fmt_ci(c), fmt_d(pv[k]) if k in pv else "-"))
        A("")
    A("### Models, versions and refit schedules")
    A("")
    A("| model | group | refit | fits | version | symmetry |")
    A("|---|---|---|---|---|---|")
    for k, m in M.items():
        sc = m.get("symmetry_check")
        A("| `%s` | %s | %s | %d | %s | %s |" % (k, m["group"], m["refit"], m["n_fits"], m["version"].replace("|", "/"),
                                              ("swap-checked on %d fights, max dev %.1e" % (sc["n"], sc["max_abs_p_plus_pswap_minus_1"])) if sc else m["symmetric"]))
    A("")
    wts = {k: m["final_weights"] for k, m in M.items() if m.get("final_weights")}
    if wts:
        A("Final stack weights (last refit, before the 2025-12-13 card; full availability pattern):")
        A("")
        for k, w in wts.items():
            A("- `%s`: %s" % (k, ", ".join("%s %.3f" % (e, v) for e, v in w.items())))
        A("")
    body = "\n".join(lines)
    if os.path.exists(REPORT_MD):
        txt = open(REPORT_MD).read()
        a, b = "<!-- BEGIN AUTO (tools/blindtest.py) -->", "<!-- END AUTO -->"
        if a in txt and b in txt:
            txt = txt.split(a)[0] + a + "\n" + body + "\n" + b + txt.split(b, 1)[1]
            open(REPORT_MD, "w").write(txt)
            return
    open(REPORT_MD, "w").write("# Standing blind test\n\n<!-- BEGIN AUTO (tools/blindtest.py) -->\n" + body +
                               "\n<!-- END AUTO -->\n")


# ====================================================================== main
STACK_JSON = os.path.join(DERIVED, "blindtest_stack.json")
EXPORT = {"present": "moe_close", "absent": "moe_noline"}


def export_stack(args):
    """Refit the replay's two production stackers (moe_close for 'a line is given', moe_noline for 'no line') on every
    dev fight 2019-01-01..2025-12-31 (history + the replay's own predictions; nothing from 2026) and write them in
    src/ml/moe.js's format to data/derived/blindtest_stack.json, with Python-computed test vectors for the Node test
    (tests/test_blindtest_stack.js). tools/forward_ledger.js can use it instead of moe_page.json (--stack blindtest)."""
    doc = json.load(open(args.out or OUT_JSON))
    ctx = Ctx(args)
    keys = topo(list(EXPORT.values()))
    models = {}
    for k in keys:
        models[k] = REGISTRY[k]["factory"](ctx)
    P = {k: {f: v for f, v in models[k].history().items() if f in ctx.fights and HIST_FROM <= ctx.date[f] < WINDOW[0]}
         for k in keys}
    for f, r in doc["fights"].items():
        for k in keys:
            if k in r["p"] and r["p"][k][0] is not None:
                P[k][f] = r["p"][k][0]
    mo = ctx.json("moe.json")
    full = list(mo["model"]["experts"])
    out = {"method": "switch", "on": "market", "experts": full, "pclip": PCLIP,
           "optional_groups": mo["model"].get("optional_groups")}
    vectors = []
    fit_info = {}
    for regime, key in EXPORT.items():
        m = models[key]
        info = m.fit("2026-01-01", P)
        fit_info[key] = info
        lin = {}
        for pat, (idx, ls) in m.st.lin.items():
            names = [m.names[j] for j in idx]
            lin["+".join(e for e in full if e in names)] = {m.names[j]: float(w) for j, w in zip(idx, ls.w)}
        out[regime] = {"method": "linear", "experts": full, "pclip": PCLIP, "hp": m.hp,
                       "gate": {"names": list(m.MO.GATE_NAMES), "mu": [float(x) for x in m.mu], "sd": [float(x) for x in m.sd]},
                       "calibration": m.cal.export() if hasattr(m.cal, "export") else {"type": "none"}, "linear": lin}
        if m.method != "linear":
            raise SystemExit("export supports the linear method only (%s is %s)" % (key, m.method))
        # test vectors: the last 60 window fights of this regime, experts as the stack saw them
        ids = [i for i in ctx.win_ids if i in m.Gall][-60:]
        pr = m.predict(ids, P)
        for i in ids:
            if i not in pr:
                continue
            ex = {e: P[m.map[e]][i] for e in m.names if i in P[m.map[e]]}
            vectors.append({"regime": regime, "id": i, "experts": ex, "p": pr[i]})
    res = {"meta": {"tool": "tools/blindtest.py export", "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                    "replay_utc": doc["meta"]["replay_utc"], "fit": "every decisive dev fight 2019-01-01..2025-12-31 "
                    "(2019-2023 rows: each expert's out-of-sample predictions; 2024-2025 rows: the replay's blind ones); "
                    "fights from 2026 are never read",
                    "experts_map": {r: models[k].map for r, k in EXPORT.items()},
                    "versions": {k: models[k].version for k in keys}, "fit_info": fit_info,
                    "blind_scores": {k: doc["scores"]["common"]["metrics"].get(k) for k in EXPORT.values()},
                    "usage": "MoE.load(doc).predict({experts, gate}) with src/ml/moe.js; the 'engine' expert is engine "
                             "%s (FightEngine.summarize, both corner orders, draws removed)" % _ENGK},
           "model": out, "test_vectors": vectors}
    wjson(STACK_JSON, res)
    log("wrote %s: present %d patterns, absent %d patterns, %d test vectors; weights present %s, absent %s" % (
        STACK_JSON, len(out["present"]["linear"]), len(out["absent"]["linear"]), len(vectors),
        models[EXPORT["present"]].weights(), models[EXPORT["absent"]].weights()))


SELFTEST_MODELS = ["ml_lr", "feat_lr", "ml_lgb", "ml_xgb", "ml_blend", "stack_elo_ml_mr", "moe_noline", "moe_close"]


def selftest(args):
    """Look-ahead test of the harness's own refits: replay the first N cards twice, the second time with every outcome
    dated on/after the middle card flipped (backtest labels, the ML table, the feature-LR table). Predictions for the
    cards up to and including that card must be bit-identical; later cards must move (the flip took effect)."""
    n = args.cards or 6
    args.cards, args.no_cache = n, True
    keys = [k.strip() for k in args.models.split(",")] if args.models else SELFTEST_MODELS
    args.perturb_from = None
    ctxA = Ctx(args)
    RA = replay(ctxA, keys)
    dates = [e["date"] for e in RA["events"]]
    D = dates[n // 2]
    args.perturb_from = D
    ctxB = Ctx(args)
    RB = replay(ctxB, keys)
    bad, rows = [], []
    for k in RA["order"]:
        pre = [abs(RA["rec"][k][f][0] - RB["rec"][k][f][0]) for f in RA["rec"][k] if ctxA.date[f] <= D and f in RB["rec"][k]]
        post = [abs(RA["rec"][k][f][0] - RB["rec"][k][f][0]) for f in RA["rec"][k] if ctxA.date[f] > D and f in RB["rec"][k]]
        mp, mq = max(pre or [0.0]), max(post or [0.0])
        rows.append((k, len(pre), mp, len(post), mq))
        if mp > 1e-12:
            bad.append(k)
    print("selftest: outcomes flipped from %s (card %d of %d)" % (D, n // 2 + 1, n))
    print("%-18s %6s %14s %6s %14s" % ("model", "n<=D", "max |dp| <=D", "n>D", "max |dp| >D"))
    for r in rows:
        print("%-18s %6d %14.3g %6d %14.3g" % r)
    if bad:
        raise SystemExit("LOOK-AHEAD: predictions up to %s changed when later outcomes were flipped: %s" % (D, bad))
    print("selftest passed: no prediction depends on an outcome dated on or after its card")
    return rows


def build_doc(ctx, R, S, args, plugins):
    fights = {}
    for i in ctx.win_ids:
        f = ctx.fights[i]
        ps = {k: R["rec"][k][i] for k in R["order"] if i in R["rec"][k]}
        if not ps:
            continue
        fights[i] = {"date": f["date"], "event": f["event"], "A": f["A"]["slug"], "B": f["B"]["slug"],
                     "y": ctx.y[i], "bin7": bin7_of(f), "nA": f["A"].get("n"), "nB": f["B"].get("n"),
                     "p": {k: [r4(v[0]), v[1], v[2]] for k, v in ps.items()}}
    meta = {"tool": "tools/blindtest.py", "version": TOOL_VERSION, "replay_utc": R["replay_utc"],
            "replay_seconds": R["seconds"], "window": list(WINDOW), "history_from": HIST_FROM,
            "vault_from": VAULT_FROM, "bootstrap": args.boot,
            "protocol": "event-by-event walk-forward replay: before each UFC event date every model is refit/updated "
                        "with data strictly before that date (per its schedule) and predicts that card; fights dated "
                        "2026-01-01 or later are never read; history rows (2019-2023) carry each model's strictly "
                        "out-of-sample predictions and train only the stackers",
            "orientation": "p = P(first-named fighter A wins | decisive), A as in backtest_dev.json; scoring uses the "
                           "probability given to the actual winner (symmetric)",
            "keys": {"fights[id].p[model]": "[P(A), refit cutoff (null = frozen/sequential), fit_through]",
                     "fits[model]": "every refit: refit_at (the card date), fit_through, n_train"},
            "models": R["models"], "skipped": R["skipped"], "plugins": plugins,
            "inputs": ctx.inputs}
    return {"meta": meta, "events": R["events"], "fits": R["fits"], "fights": fights, "scores": S}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["list", "replay", "score", "selftest", "export"])
    ap.add_argument("--models", default=None, help="comma-separated model keys (default: all registered)")
    ap.add_argument("--ml-refit", default="event", choices=["event", "month", "year"])
    ap.add_argument("--tree-refit", default="month", choices=["event", "month", "year"])
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--quick", action="store_true", help="first 8 cards only, 300 resamples, no outputs written "
                                                         "unless --out is given")
    ap.add_argument("--out", default=None)
    ap.add_argument("--cards", type=int, default=None, help="replay only the first N cards")
    args = ap.parse_args()
    plugins = load_plugins()
    if args.cmd == "list":
        for k, s in REGISTRY.items():
            print("%-18s %-9s refit=%-6s line=%-5s %s%s" % (k, s["group"], s["refit"], s["line"] or "-", s["desc"],
                                                         " [experimental]" if s["experimental"] else ""))
        return
    if args.cmd == "selftest":
        selftest(args)
        return
    if args.cmd == "export":
        args.perturb_from = None
        export_stack(args)
        return
    out = args.out or (None if args.quick or args.cards else OUT_JSON)
    if args.quick:
        args.boot = min(args.boot, 300)
    ctx = Ctx(args)
    if args.cmd == "score":
        doc = json.load(open(args.out or OUT_JSON))
        R = {"rec": {}, "bins": {}, "order": list(doc["meta"]["models"]), "models": doc["meta"]["models"]}
        for k in R["order"]:
            R["rec"][k] = {i: v["p"][k] for i, v in doc["fights"].items() if k in v["p"]}
        R["bins"] = doc.get("_bins", {})
        doc["scores"] = score(ctx, R, args.boot)
        doc["meta"]["bootstrap"] = args.boot
        wjson(args.out or OUT_JSON, doc)
        write_report(doc)
        log("rescored -> %s, %s" % (args.out or OUT_JSON, REPORT_MD))
        return
    keys = [k.strip() for k in args.models.split(",")] if args.models else list(REGISTRY)
    for k in keys:
        if k not in REGISTRY:
            raise SystemExit("unknown model %s (python3 tools/blindtest.py list)" % k)
    log("universe: %d dev fights; window %s..%s: %d fights (%d decisive) on %d cards; history %d fights"
        % (len(ctx.fights), WINDOW[0], WINDOW[1], len(ctx.win_ids), sum(ctx.y[i] is not None for i in ctx.win_ids),
           len(set(ctx.date[i] for i in ctx.win_ids)), len(ctx.hist_ids)))
    R = replay(ctx, keys)
    if args.quick:
        R["quick_dates"] = [e["date"] for e in R["events"]]
    S = score(ctx, R, args.boot)
    doc = build_doc(ctx, R, S, args, plugins)
    doc["_bins"] = {k: {i: [r4(x) for x in b] for i, b in v.items() if i in doc["fights"]} for k, v in R["bins"].items() if v}
    for k, m in sorted(S["common"]["metrics"].items(), key=lambda kv: kv[1]["log_loss"]):
        pc = S["paired"].get(k, {}).get("market_close")
        log("  %-18s ll %.4f  acc %.3f  vs close %s" % (k, m["log_loss"], m["accuracy"], fmt_d(pc) if pc else "-"))
    if out:
        wjson(out, doc)
        if out == OUT_JSON:
            write_report(doc)
        log("wrote %s (%d fights) and %s" % (out, len(doc["fights"]), REPORT_MD if out == OUT_JSON else "no report"))


if __name__ == "__main__":
    main()
