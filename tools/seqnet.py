#!/usr/bin/env python3
"""seqnet: a deep sequence model over each fighter's UFC career (task key: seqnet).

A small siamese GRU reads each man's career as a sequence of fight tokens (his and his opponent's per-fight and
per-round stat vectors, outcome, method, round, layoff, age, weight-class change, the opponent's pre-fight Elo and
experience, and the closing line he carried into that fight), then three heads predict, for a matchup:

- the winner, through an antisymmetric head  z = g(s_A, s_B, c) - g(s_B, s_A, c)  (no intercept, so
  P(A) = 1 - P(B) by construction);
- method x round given the winner (KO/TKO r1..5, SUB r1..5, decision), from the same side-symmetric head applied to
  the winner's and the loser's states, so the 23-cell joint is a permutation under a corner swap;
- the 18 mlrates stat lines (attempts by position and target, accuracies, takedowns, control, subs, reversals, KD per
  landed head strike) for each man attacking the other, with Poisson / binomial likelihoods and minutes or attempts
  as exposure.

Protocol (docs/BACKLOG.md, docs/V6_V10_PLAN.md section 6):
- every fight dated 2026-01-01 or later is dropped right after parsing (build_db.parse_fights is wrapped) and never
  fit or scored; the nlbair odds stream is cut at the same date;
- hyperparameters are chosen by time-ordered CV on 2016, 2017 and 2018 (train before Jan 1 of Y-1, early stopping on
  Y-1, predict Y), so the 2019-2023 out-of-fold predictions that feed the stack gate are clean of the selection;
- walk-forward annual refits: for each year Y in 2019..2025 the model is trained on fights strictly before Jan 1 of Y
  (epochs chosen by early stopping on the last training year, then a refit on the whole window) and predicts Y;
  "static" 2024-2025 predictions come from the fit before 2024-01-01, "annual" from the fit before Jan 1 of the year;
- ensembles of seeds (logits averaged), torch on CPU with <= 2 threads;
- the stack gate is ml2's forward-chained 2021-2023 stack CV with the 0.0005 rule;
- 2024-2025 is scored once by the `confirm` stage, after every choice is frozen.

Stages:
    python3 tools/seqnet.py data       # sequences, tokens, targets -> out/seqnet_cache/data.pkl
    python3 tools/seqnet.py hpcv       # hyperparameter CV (2016-2018 folds) -> out/seqnet_cache/hpcv.json
    python3 tools/seqnet.py walk       # annual refits 2019..2025, seed ensembles -> out/seqnet_cache/walk.pkl
    python3 tools/seqnet.py swaptest   # corner-swap test on a trained model
    python3 tools/seqnet.py cv         # pre-2024 numbers only: OOF 2019-2023, stack gate 2021-2023, method, stats
    python3 tools/seqnet.py confirm    # 2024-2025, scored once (refuses to rerun without --force)
    python3 tools/seqnet.py export     # data/derived/seqnet.json
"""
import argparse
import datetime as dt
import json
import math
import os
import pickle
import sys
import time
import warnings
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("SEQNET_CACHE", os.path.join(ROOT, "out", "seqnet_cache"))
OUT_JSON = os.path.join(DERIVED, "seqnet.json")
VAULT = dt.date(2026, 1, 1)
VAULT_S = "2026-01-01"
os.makedirs(CACHE, exist_ok=True)
warnings.filterwarnings("ignore")

import build_db as B  # noqa: E402

_parse_orig = B.parse_fights


def _parse_dev_only(log):
    """build_db.parse_fights with every fight dated on or after VAULT removed right after parsing."""
    fights, ex = _parse_orig(log)
    return [f for f in fights if f.date < VAULT], ex


B.parse_fights = _parse_dev_only
import ml as M  # noqa: E402  (load_all: fights, people, Elo; uses the wrapped parser)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def jload(name):
    return json.load(open(os.path.join(DERIVED, name)))


def sig(z):
    return 1.0 / (1.0 + np.exp(-z))


def logit(p, c=1e-6):
    p = np.clip(np.asarray(p, float), c, 1 - c)
    return np.log(p / (1 - p))


# ====================================================================== data
# mlrates targets (tools/mlrates.py): Poisson counts per minute, binomial accuracies
STAT_TARGETS = ["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "td_att", "sub_att", "rev", "ctrl",
                "acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "td_acc", "kd_h"]
N_POIS = 10                      # the first ten are Poisson (ctrl: seconds, exposure minutes)
KI = B.KI
METHOD_CLASSES = ["KO1", "KO2", "KO3", "KO4", "KO5", "SUB1", "SUB2", "SUB3", "SUB4", "SUB5", "DEC"]


def stat_targets(v):
    """(y, n) for the 18 targets of one side's fight vector (fight totals, own stats)."""
    g = lambda k: float(v[KI[k]])
    mins = g("min")
    y, n = np.zeros(18), np.zeros(18)
    for t, k in enumerate(["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "td_att", "sub_att", "rev", "ctrl"]):
        y[t], n[t] = g(k), mins
    for t, (l_, a_) in enumerate([("h_lnd", "h_att"), ("b_lnd", "b_att"), ("l_lnd", "l_att"), ("d_lnd", "d_att"),
                                  ("c_lnd", "c_att"), ("g_lnd", "g_att"), ("td_lnd", "td_att"), ("kd", "h_lnd")]):
        y[10 + t], n[10 + t] = g(l_), g(a_)
    y[17] = min(y[17], n[17])            # a knockdown can come from a strike ufcstats did not count as landed
    return y, n


def per_round_table(fights):
    """Per (fid, side, round): sig landed, control seconds, takedowns landed, knockdowns, minutes (ufcstats rounds,
    matched to the kept fights exactly like build_db.build_vectors; 2026 rows match nothing and are dropped)."""
    st = B.load("ufc_fight_stats.csv")
    st = st[st["ROUND"] != ""].copy()
    key = defaultdict(list)
    for f in fights:
        key[(f.event, f.bout)].append(f)
    fmap = {k: v[0] for k, v in key.items() if len(v) == 1}
    st["fight"] = [fmap.get(k) for k in zip(st["EVENT"], st["BOUT"])]
    st = st[st["fight"].notna()].copy()
    st["side"] = [0 if n == f.names[0] else (1 if n == f.names[1] else -1) for n, f in zip(st["FIGHTER"], st["fight"])]
    st = st[st["side"] >= 0].copy()
    st["rnd"] = st["ROUND"].str.extract(r"(\d+)", expand=False).astype(int)
    out = defaultdict(dict)
    for r in st.itertuples(index=False):
        f = r.fight
        sig_ = 0.0
        for col in ("DISTANCE", "CLINCH", "GROUND"):
            m = str(getattr(r, col)).split(" of ")
            sig_ += float(m[0]) if m[0].isdigit() else 0.0
        td = str(r.TD).split(" of ")
        ctrl = str(r.CTRL).split(":")
        try:
            cs = int(ctrl[0]) * 60 + int(ctrl[1])
        except (ValueError, IndexError):
            cs = 0
        kd = float(r.KD) if str(r.KD).replace(".", "").isdigit() else 0.0
        if r.rnd > f.rnd:
            continue
        mins = (float(f.lengths[r.rnd - 1]) if f.lengths and r.rnd - 1 < len(f.lengths) else 5.0) \
            if r.rnd < f.rnd else ((f.time_s or 0) / 60.0)
        out[(f.fid, r.side)][r.rnd] = (sig_, cs, float(td[0]) if td[0].isdigit() else 0.0, kd, max(mins, 0.05))
    return out


def market_closes(fights):
    """No-vig closing P(first-named) per fight id: market.json for dev fights, else nlbair (cut at 2026-01-01).
    Returned per (fid, side) as the side's own closing probability."""
    nl = pd.read_csv(os.path.join(ROOT, "data", "raw", "odds", "nlbair_odds.csv"), low_memory=False)
    nl = nl[nl["event_date"] < VAULT_S]
    mk = {k: v for k, v in jload("market.json")["fights"].items()}
    byid = {f.fid: f for f in fights}
    out = {}
    for q in nl.itertuples():
        f = byid.get(q.fight_id)
        if f is None:
            continue
        p = None
        if q.fight_id in mk and mk[q.fight_id].get("p_novig_close") is not None:
            p = mk[q.fight_id]["p_novig_close"]          # oriented to the backtest's A = first-named
            pa = p
        elif q.has_odds and not pd.isna(q.f1_close_prob_novig):
            p = float(q.f1_close_prob_novig)
            # nlbair's f1 is a person id; orient to the fight's first-named person
            pa = p if q.f1_id == f.persons[0] else (1 - p if q.f2_id == f.persons[0] else None)
        else:
            pa = None
        if pa is not None:
            out[(f.fid, 0)] = pa
            out[(f.fid, 1)] = 1 - pa
    for fid, v in mk.items():                       # dev fights missing from nlbair
        f = byid.get(fid)
        if f is not None and (fid, 0) not in out and v.get("p_novig_close") is not None:
            out[(fid, 0)] = v["p_novig_close"]
            out[(fid, 1)] = 1 - v["p_novig_close"]
    return out


TOK_NAMES = None


def token_features(f, s, prt, close, ages, pre):
    """Date-independent features of side s's fight f (the token). pre: pre-fight dict for both sides."""
    feats = {}
    p, q = f.persons[s], f.persons[1 - s]
    me, op = pre[s], pre[1 - s]
    feats["age"] = ((ages[s] - 30.0) / 5.0) if ages[s] is not None else 0.0
    feats["age_na"] = 1.0 if ages[s] is None else 0.0
    feats["gap"] = math.log1p(me["gap"]) if me["gap"] is not None else 0.0
    feats["first"] = 1.0 if me["gap"] is None else 0.0
    feats["lbs"] = (me["lbs"] - 160.0) / 40.0
    feats["catch"] = 1.0 if f.division in B.NON_DIV else 0.0
    feats["women"] = 1.0 if f.division.startswith("Women") else 0.0
    feats["five"] = 1.0 if f.sched == 5 else 0.0
    feats["title"] = 1.0 if f.title else 0.0
    won = f.winner == ("A" if s == 0 else "B")
    lost = f.winner == ("B" if s == 0 else "A")
    feats["win"], feats["loss"] = float(won), float(lost)
    feats["draw"], feats["nc"] = float(f.winner == "D"), float(f.winner == "NC")
    m = f.method
    feats["m_ko"] = float(m in ("KO", "DOC"))
    feats["m_sub"] = float(m == "SUB")
    feats["m_ud"] = float(m == "UD")
    feats["m_sd"] = float(m in ("SD", "MD"))
    feats["m_oth"] = float(m not in ("KO", "DOC", "SUB", "UD", "SD", "MD"))
    sched = f.sched or 3
    feats["end_rnd"] = f.rnd / sched
    feats["dur"] = (f.fight_s / (sched * 300.0)) if f.fight_s else f.rnd / sched
    # decision margin (judges' cards, stored [A, B])
    mg = 0.0
    if f.cards:
        mg = float(np.mean([(c[s] - c[1 - s]) for c in f.cards])) / max(sched, 1)
    feats["card_mg"] = mg
    # opponent and own pre-fight state
    feats["opp_elo"] = (op["elo"] - 1500.0) / 200.0
    feats["own_elo"] = (me["elo"] - 1500.0) / 200.0
    feats["opp_n"] = math.log1p(op["n"])
    feats["opp_wpct"] = (op["w"] + 1.0) / (op["w"] + op["l"] + 2.0) - 0.5
    feats["opp_finl"] = (op["finl"] + 0.3) / (op["n"] + 1.0)
    feats["opp_amb"] = 1.0 if str(q).startswith("amb:") else 0.0
    # closing line carried into the fight
    pc = close.get((f.fid, s))
    feats["close"] = float(logit(pc, 0.02)) if pc is not None else 0.0
    feats["close_na"] = 0.0 if pc is not None else 1.0
    # fight stats (own and absorbed), per minute or per 15, logs
    st = f.stats
    feats["has_st"] = 1.0 if st else 0.0
    if st:
        v, o = st["v"][s], st["v"][1 - s]
        mins = max(float(v[KI["min"]]), 0.5)
        for tag, vec in (("", v), ("o", o)):
            g = lambda k: float(vec[KI[k]])
            sl = g("d_lnd") + g("c_lnd") + g("g_lnd")
            sa = g("d_att") + g("c_att") + g("g_att")
            feats[tag + "sl"] = math.log1p(sl / mins)
            feats[tag + "sa"] = math.log1p(sa / mins)
            feats[tag + "acc"] = (sl + 2.0) / (sa + 4.0) - 0.45
            for k in ("h_lnd", "b_lnd", "l_lnd", "d_lnd", "c_lnd", "g_lnd"):
                feats[tag + k] = math.log1p(g(k) / mins)
            feats[tag + "tot"] = math.log1p(g("t_lnd") / mins)
            feats[tag + "kd"] = math.log1p(15.0 * g("kd") / mins)
            feats[tag + "td"] = math.log1p(15.0 * g("td_lnd") / mins)
            feats[tag + "tda"] = math.log1p(15.0 * g("td_att") / mins)
            feats[tag + "tdacc"] = (g("td_lnd") + 1.0) / (g("td_att") + 3.0) - 0.33
            feats[tag + "sub"] = math.log1p(15.0 * g("sub_att") / mins)
            feats[tag + "rev"] = math.log1p(15.0 * g("rev") / mins)
            feats[tag + "ctrl"] = g("ctrl") / (60.0 * mins)
    else:
        for tag in ("", "o"):
            for k in ("sl", "sa", "acc", "h_lnd", "b_lnd", "l_lnd", "d_lnd", "c_lnd", "g_lnd", "tot", "kd", "td",
                      "tda", "tdacc", "sub", "rev", "ctrl"):
                feats[tag + k] = 0.0
    # per-round vectors: sig landed, control, takedown and knockdown differentials, rounds 1..5
    mine, theirs = prt.get((f.fid, s), {}), prt.get((f.fid, 1 - s), {})
    for r in range(1, 6):
        a, b = mine.get(r), theirs.get(r)
        if a and b:
            mins = a[4]
            feats["r%d_sig" % r] = (a[0] - b[0]) / (mins * 5.0)
            feats["r%d_ctrl" % r] = (a[1] - b[1]) / (mins * 60.0)
            feats["r%d_td" % r] = a[2] - b[2]
            feats["r%d_kd" % r] = a[3] - b[3]
            feats["r%d_on" % r] = 1.0
        else:
            for k in ("sig", "ctrl", "td", "kd", "on"):
                feats["r%d_%s" % (r, k)] = 0.0
    return feats


def stage_data(args):
    t0 = time.time()
    fights, people, elo_pre = M.load_all()
    assert max(f.date for f in fights) < VAULT, "vault leak"
    log("fights %d (%s .. %s)" % (len(fights), fights[0].date, fights[-1].date))
    prt = per_round_table(fights)
    close = market_closes(fights)
    log("per-round rows %d, closing lines for %d sides" % (len(prt), len(close)))
    # walk: per person pre-fight state and token list
    stt = defaultdict(lambda: {"n": 0, "w": 0, "l": 0, "finl": 0, "last_day": None, "last_lbs": None, "toks": []})
    tok_rows, tok_day, tok_lbs = [], [], []
    ex = []                  # examples: one per fight
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        lbs = B.LBS.get(f.division)
        pre, ages, info = [], [], []
        for s, p in enumerate((a, b)):
            S = stt[p]
            P = people.get(p, {})
            T = P.get("tott") or {}
            dob = T.get("dob")
            age = (f.date - dob).days / 365.25 if dob else None
            if age is not None and not (15 < age < 60):
                age = None
            l_ = lbs if lbs else (S["last_lbs"] or 170.0)
            gap = (f.day - S["last_day"]) / 365.25 if S["last_day"] is not None else None
            pre.append({"elo": elo_pre[f.fid][s] if f.fid in elo_pre else 1500.0, "n": S["n"], "w": S["w"],
                        "l": S["l"], "finl": S["finl"], "gap": gap, "lbs": l_})
            ages.append(age)
            info.append({"p": p, "hist": list(S["toks"]), "age": age, "gap": gap, "n": S["n"],
                         "last_lbs": S["last_lbs"], "height": T.get("height_in"), "reach": T.get("reach_in"),
                         "stance": T.get("stance")})
        e = {"fid": f.fid, "date": f.date, "day": f.day, "year": f.date.year, "event": f.event,
             "division": f.division, "lbs": lbs if lbs else max(pre[0]["lbs"], pre[1]["lbs"]),
             "catch": f.division in B.NON_DIV, "women": f.division.startswith("Women"), "five": f.sched == 5,
             "title": bool(f.title), "winner": f.winner, "method": f.method, "cls": None, "rnd": f.rnd,
             "sched": f.sched or 3, "amb": a.startswith("amb:") or b.startswith("amb:"), "sides": info,
             "has_stats": bool(f.stats)}
        if f.winner in ("A", "B"):
            c = {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC"}.get(f.method)
            if c == "DEC":
                e["cls"] = 10
            elif c in ("KO", "SUB"):
                e["cls"] = (0 if c == "KO" else 5) + min(max(f.rnd, 1), 5) - 1
        elif f.winner == "D":
            e["cls"] = -2           # draw
        if f.stats:
            ys, ns = zip(*[stat_targets(f.stats["v"][s]) for s in (0, 1)])
            e["sy"], e["sn"] = np.array(ys), np.array(ns)
        ex.append(e)
        # tokens of this fight for both sides, then update states
        for s, p in enumerate((a, b)):
            feats = token_features(f, s, prt, close, ages, pre)
            global TOK_NAMES
            if TOK_NAMES is None:
                TOK_NAMES = list(feats)
            tok_rows.append([feats[k] for k in TOK_NAMES])
            tok_day.append(f.day)
            tok_lbs.append(pre[s]["lbs"])
            k = len(tok_rows) - 1
            S = stt[p]
            S["toks"].append(k)
            S["n"] += 1
            won = f.winner == ("A" if s == 0 else "B")
            lost = f.winner == ("B" if s == 0 else "A")
            S["w"] += int(won)
            S["l"] += int(lost)
            S["finl"] += int(lost and f.method in ("KO", "DOC", "SUB"))
            S["last_day"] = f.day
            S["last_lbs"] = pre[s]["lbs"]
    TOK = np.array(tok_rows, np.float32)
    # evaluation universe: ml2's 2019-2025 rows (both men with a prior UFC fight, decisive, not ambiguous)
    D = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))["D"]
    ev_ids = set(D["fid"])
    have = {e["fid"] for e in ex}
    missing = sorted(ev_ids - have)
    log("tokens %s, examples %d, eval ids %d (missing %d)" % (TOK.shape, len(ex), len(ev_ids), len(missing)))
    obj = {"TOK": TOK, "tok_names": TOK_NAMES, "tok_day": np.array(tok_day), "tok_lbs": np.array(tok_lbs, np.float32),
           "ex": ex, "eval_ids": sorted(ev_ids), "built": dt.datetime.utcnow().isoformat() + "Z",
           "last_fight": fights[-1].date.isoformat()}
    pickle.dump(obj, open(os.path.join(CACHE, "data.pkl"), "wb"))
    log("data stage done in %.0f s" % (time.time() - t0))


def load_data():
    return pickle.load(open(os.path.join(CACHE, "data.pkl"), "rb"))


STAGES = {"data": stage_data}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=sorted(STAGES))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--configs", default=None)
    args = ap.parse_args()
    STAGES[args.stage](args)


if __name__ == "__main__":
    main()
