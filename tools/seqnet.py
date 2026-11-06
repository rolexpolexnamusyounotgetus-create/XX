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



# ====================================================================== arrays for the network
MAXLEN = 24
SIDE_NAMES = ["age", "age_na", "height", "height_na", "reach", "reach_na", "ape", "south", "switch", "orth",
              "stance_na", "layoff", "debut", "logn", "lbs_move"]
CTX_NAMES = ["five", "title", "women", "catch", "lbs", "era"]


def build_arrays(d, maxlen=MAXLEN):
    """Per example: history token indices (last maxlen, chronological, left-aligned, -1 pad), lengths, side and
    context features, labels. Everything here is known before the fight."""
    ex = d["ex"]
    n = len(ex)
    H = np.full((n, 2, maxlen), -1, np.int64)
    LEN = np.zeros((n, 2), np.int64)
    SIDE = np.zeros((n, 2, len(SIDE_NAMES)), np.float32)
    CTX = np.zeros((n, len(CTX_NAMES)), np.float32)
    YW = np.full(n, np.nan, np.float32)
    CLS = np.full(n, -1, np.int64)
    SY = np.zeros((n, 2, 18), np.float32)
    SN = np.zeros((n, 2, 18), np.float32)
    DAY = np.zeros(n, np.int64)
    YEAR = np.zeros(n, np.int64)
    LBS = np.zeros(n, np.float32)
    SCHED = np.zeros(n, np.int64)
    AMB = np.zeros(n, bool)
    NPRIOR = np.zeros((n, 2), np.int64)
    for i, e in enumerate(ex):
        DAY[i], YEAR[i], LBS[i] = e["day"], e["year"], e["lbs"]
        SCHED[i] = 5 if e["five"] else 3
        AMB[i] = e["amb"]
        CTX[i] = [float(e["five"]), float(e["title"]), float(e["women"]), float(e["catch"]),
                  (e["lbs"] - 160.0) / 40.0, (e["year"] - 2015) / 10.0]
        for s in (0, 1):
            si = e["sides"][s]
            h = si["hist"][-maxlen:]
            H[i, s, :len(h)] = h
            LEN[i, s] = len(h)
            NPRIOR[i, s] = si["n"]
            age, ht, rc, stc = si["age"], si["height"], si["reach"], si["stance"]
            SIDE[i, s] = [((age - 30.0) / 5.0) if age is not None else 0.0, float(age is None),
                          ((ht - 70.0) / 3.0) if ht else 0.0, float(not ht),
                          ((rc - 72.0) / 4.0) if rc else 0.0, float(not rc),
                          ((rc - ht) / 3.0) if (rc and ht) else 0.0,
                          float(stc == "Southpaw"), float(stc == "Switch"), float(stc == "Orthodox"),
                          float(stc not in ("Southpaw", "Switch", "Orthodox")),
                          math.log1p(si["gap"]) if si["gap"] is not None else 0.0, float(si["n"] == 0),
                          math.log1p(si["n"]),
                          ((e["lbs"] - si["last_lbs"]) / 10.0) if si["last_lbs"] else 0.0]
        if e["winner"] in ("A", "B"):
            YW[i] = 1.0 if e["winner"] == "A" else 0.0
            if e["cls"] is not None and e["cls"] >= 0:
                CLS[i] = e["cls"]
        if e.get("sy") is not None:
            SY[i], SN[i] = e["sy"], e["sn"]
    TOK = d["TOK"].copy()
    nm = d["tok_names"]
    TOK[:, nm.index("dur")] = np.clip(TOK[:, nm.index("dur")], 0, 2)
    TOK[:, nm.index("end_rnd")] = np.clip(TOK[:, nm.index("end_rnd")], 0, 1.5)
    for r in range(1, 6):
        TOK[:, nm.index("r%d_sig" % r)] = np.clip(TOK[:, nm.index("r%d_sig" % r)], -4, 4)
        TOK[:, nm.index("r%d_td" % r)] = np.clip(TOK[:, nm.index("r%d_td" % r)], -4, 4)
        TOK[:, nm.index("r%d_kd" % r)] = np.clip(TOK[:, nm.index("r%d_kd" % r)], -2, 2)
    TOK[:, nm.index("card_mg")] = np.clip(TOK[:, nm.index("card_mg")], -1.5, 1.5)
    # draw share by format (for the 23-cell joint); computed per refit from training rows
    DRAW = np.array([e["winner"] == "D" for e in ex])
    return {"H": H, "LEN": LEN, "SIDE": SIDE, "CTX": CTX, "YW": YW, "CLS": CLS, "SY": SY, "SN": SN, "DAY": DAY,
            "YEAR": YEAR, "LBS": LBS, "SCHED": SCHED, "AMB": AMB, "NPRIOR": NPRIOR, "TOK": TOK,
            "TOK_DAY": d["tok_day"].astype(np.int64), "TOK_LBS": d["tok_lbs"], "DRAW": DRAW,
            "FID": np.array([e["fid"] for e in ex]), "EVENT": np.array([e["event"] for e in ex]),
            "WINNER": np.array([e["winner"] for e in ex])}


# ====================================================================== the network
DEFAULT_CFG = {"H": 64, "drop": 0.2, "lr": 2e-3, "wd": 1e-4, "bs": 256, "max_ep": 40, "lam_m": 0.3,
               "lam_s": 0.3, "train_from": 2005, "maxlen": 16, "pool": "attn", "tok_drop": 0.0}


def _torch():
    import torch
    torch.set_num_threads(1)
    return torch


def make_model(cfg, d_tok, d_side, d_ctx):
    torch = _torch()
    nn = torch.nn
    H, p = cfg["H"], cfg["drop"]
    D_DYN = 3

    class SeqNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.tok = nn.Sequential(nn.Linear(d_tok + D_DYN, H), nn.GELU(), nn.Dropout(p), nn.Linear(H, H), nn.GELU())
            self.rnn = nn.GRU(H, H, batch_first=True)
            self.att = nn.Linear(H, 1)
            self.empty = nn.Parameter(torch.zeros(2 * H))
            self.side = nn.Sequential(nn.Linear(2 * H + d_side + d_ctx, H), nn.GELU(), nn.Dropout(p),
                                      nn.Linear(H, H), nn.GELU())
            self.g = nn.Sequential(nn.Linear(2 * H + d_ctx, H), nn.GELU(), nn.Dropout(p), nn.Linear(H, 1))
            self.q = nn.Sequential(nn.Linear(2 * H + d_ctx, H), nn.GELU(), nn.Dropout(p), nn.Linear(H, 11))
            self.st = nn.Sequential(nn.Linear(2 * H + d_ctx, H), nn.GELU(), nn.Dropout(p), nn.Linear(H, 18))
            self.pool = cfg.get("pool", "attn")

        def encode(self, tok, lens):
            """tok: [N, L, d_tok + D_DYN]; lens: [N] (0 allowed). Returns [N, 2H]."""
            N, L, _ = tok.shape
            e = self.tok(tok)
            l1 = lens.clamp(min=1)
            packed = nn.utils.rnn.pack_padded_sequence(e, l1.cpu(), batch_first=True, enforce_sorted=False)
            out, h = self.rnn(packed)
            out, _ = nn.utils.rnn.pad_packed_sequence(out, batch_first=True, total_length=L)
            hl = h[0]
            mask = torch.arange(L)[None, :] < l1[:, None]
            if self.pool == "attn":
                a = self.att(out).squeeze(-1).masked_fill(~mask, -1e9)
                w = torch.softmax(a, 1)
                hp = (w.unsqueeze(-1) * out).sum(1)
            else:
                hp = (out * mask.unsqueeze(-1)).sum(1) / l1[:, None]
            r = torch.cat([hl, hp], 1)
            empty = (lens == 0).unsqueeze(-1)
            return torch.where(empty, self.empty.expand(N, -1), r)

        def forward(self, tokA, lenA, tokB, lenB, sideA, sideB, ctx):
            B_ = tokA.shape[0]
            r = self.encode(torch.cat([tokA, tokB], 0), torch.cat([lenA, lenB], 0))
            rA, rB = r[:B_], r[B_:]
            sA = self.side(torch.cat([rA, sideA, ctx], 1))
            sB = self.side(torch.cat([rB, sideB, ctx], 1))
            ab, ba = torch.cat([sA, sB, ctx], 1), torch.cat([sB, sA, ctx], 1)
            z = self.g(ab).squeeze(-1) - self.g(ba).squeeze(-1)
            return z, self.q(ab), self.q(ba), self.st(ab), self.st(ba)

    return SeqNet()


class Prep:
    """Standardisation (training-period tokens and sides only) and batch assembly for one refit."""

    def __init__(self, A, cutoff_day, cfg):
        torch = _torch()
        self.A, self.cfg = A, cfg
        tr_tok = A["TOK_DAY"] < cutoff_day
        mu = A["TOK"][tr_tok].mean(0)
        sd = A["TOK"][tr_tok].std(0) + 1e-6
        T = np.clip((A["TOK"] - mu) / sd, -5, 5).astype(np.float32)
        self.TOK = torch.tensor(np.vstack([T, np.zeros((1, T.shape[1]), np.float32)]))   # last row = pad
        self.pad = T.shape[0]
        tr_ex = A["DAY"] < cutoff_day
        S = A["SIDE"][tr_ex].reshape(-1, A["SIDE"].shape[-1])
        self.smu, self.ssd = S.mean(0), S.std(0) + 1e-6
        self.TOK_DAY = torch.tensor(np.r_[A["TOK_DAY"], 0])
        self.TOK_LBS = torch.tensor(np.r_[A["TOK_LBS"], 0.0].astype(np.float32))
        L = cfg["maxlen"]
        Hh = A["H"][:, :, -L:] if A["H"].shape[2] >= L else A["H"]
        # keep the most recent L tokens (H is left-aligned: re-slice per row)
        n = len(A["DAY"])
        H2 = np.full((n, 2, L), -1, np.int64)
        LEN2 = np.minimum(A["LEN"], L)
        for s in (0, 1):
            for i in np.flatnonzero(A["LEN"][:, s] > L):
                h = A["H"][i, s, :A["LEN"][i, s]][-L:]
                H2[i, s, :L] = h
            m = A["LEN"][:, s] <= L
            H2[m, s, :] = A["H"][m, s, :L]
        del Hh
        self.H = torch.tensor(np.where(H2 < 0, self.pad, H2))
        self.LEN = torch.tensor(LEN2)
        self.SIDE = torch.tensor(((A["SIDE"] - self.smu) / self.ssd).astype(np.float32))
        self.CTX = torch.tensor(A["CTX"])
        self.DAY = torch.tensor(A["DAY"])
        self.LBSx = torch.tensor(A["LBS"])
        self.YW = torch.tensor(A["YW"])
        self.CLS = torch.tensor(A["CLS"])
        self.SY = torch.tensor(A["SY"])
        self.SN = torch.tensor(A["SN"])
        five = torch.tensor(A["SCHED"] == 5)
        m = torch.zeros(len(A["DAY"]), 11, dtype=torch.bool)
        m[:, [3, 4, 8, 9]] = True
        self.CLSMASK = m & (~five)[:, None]
        # stat base rates (training rows): log rate per minute or logit of accuracy
        sy, sn = A["SY"][tr_ex].reshape(-1, 18), A["SN"][tr_ex].reshape(-1, 18)
        base = np.zeros(18, np.float32)
        bdev = np.zeros(18, np.float32)
        for t in range(18):
            ok = sn[:, t] > 0
            r = sy[ok, t].sum() / sn[ok, t].sum()
            if t < N_POIS:
                base[t] = math.log(max(r, 1e-6))
                mu_ = sn[ok, t] * r
                yy = sy[ok, t]
                dv = 2 * (np.where(yy > 0, yy * np.log(np.maximum(yy, 1e-12) / mu_), 0) - (yy - mu_))
            else:
                r = min(max(r, 1e-6), 1 - 1e-6)
                base[t] = math.log(r / (1 - r))
                yy, nn_ = sy[ok, t], sn[ok, t]
                ph = np.clip(yy / nn_, 1e-12, 1 - 1e-12)
                dv = 2 * (yy * np.log(ph / r) + (nn_ - yy) * np.log(np.maximum(1 - ph, 1e-12) / (1 - r)))
                dv = np.where(np.isfinite(dv), dv, 0)
            bdev[t] = max(dv.mean(), 1e-3)
        self.base = torch.tensor(base)
        self.sw = torch.tensor(1.0 / bdev)
        self.draw = {}
        for sch in (3, 5):
            mm = tr_ex & (A["SCHED"] == sch) & (A["YEAR"] >= 2005) & ((A["WINNER"] == "A") | (A["WINNER"] == "B")
                                                                      | (A["WINNER"] == "D"))
            self.draw[sch] = float(A["DRAW"][mm].mean()) if mm.any() else 0.01

    def batch(self, idx):
        torch = _torch()
        idx = torch.as_tensor(idx)
        out = []
        for s in (0, 1):
            h = self.H[idx, s]                          # [B, L]
            tok = self.TOK[h]
            dt_ = (self.DAY[idx][:, None] - self.TOK_DAY[h]).float() / 365.25
            dl = (self.LBSx[idx][:, None] - self.TOK_LBS[h]) / 10.0
            pad = (h == self.pad)
            dyn = torch.stack([dt_ / 5.0, torch.log1p(dt_.clamp(min=0)), dl], -1).masked_fill(pad.unsqueeze(-1), 0.0)
            out.append((torch.cat([tok, dyn], -1), self.LEN[idx, s], self.SIDE[idx, s]))
        return out, self.CTX[idx]


def losses(model, prep, idx, cfg, train=True):
    torch = _torch()
    F = torch.nn.functional
    (ta, la, sa), (tb, lb, sb_), ctx = prep.batch(idx)
    idx_t = torch.as_tensor(idx)
    z, qa, qb, ea, eb = model(ta, la, tb, lb, sa, sb_, ctx)
    yw = prep.YW[idx_t]
    dm = ~torch.isnan(yw)
    lw = F.binary_cross_entropy_with_logits(z[dm], yw[dm]) if dm.any() else z.sum() * 0
    cls = prep.CLS[idx_t]
    cm = cls >= 0
    lm = z.sum() * 0
    if cm.any() and cfg["lam_m"] > 0:
        mask = prep.CLSMASK[idx_t]
        qa = qa.masked_fill(mask, -1e9)
        qb = qb.masked_fill(mask, -1e9)
        qw = torch.where((yw == 1).unsqueeze(-1), qa, qb)
        lm = F.cross_entropy(qw[cm], cls[cm])
    ls = z.sum() * 0
    if cfg["lam_s"] > 0:
        tot, cnt = 0.0, 0.0
        for s, e in ((0, ea), (1, eb)):
            eta = e + prep.base
            y, n = prep.SY[idx_t, s], prep.SN[idx_t, s]
            ok = (n > 0).float()
            nll_p = n[:, :N_POIS] * torch.exp(eta[:, :N_POIS].clamp(max=8)) - y[:, :N_POIS] * eta[:, :N_POIS]
            nll_b = n[:, N_POIS:] * F.softplus(eta[:, N_POIS:]) - y[:, N_POIS:] * eta[:, N_POIS:]
            nll = torch.cat([nll_p, nll_b], 1) * ok * prep.sw
            tot = tot + nll.sum()
            cnt = cnt + ok.sum()
        ls = tot / cnt.clamp(min=1)
    return lw + cfg["lam_m"] * lm + cfg["lam_s"] * ls, lw


def predict(model, prep, idx, bs=1024):
    torch = _torch()
    model.eval()
    Z, PA, PB, EA, EB = [], [], [], [], []
    with torch.no_grad():
        for k in range(0, len(idx), bs):
            b = idx[k:k + bs]
            (ta, la, sa), (tb, lb, sb_), ctx = prep.batch(b)
            z, qa, qb, ea, eb = model(ta, la, tb, lb, sa, sb_, ctx)
            mask = prep.CLSMASK[torch.as_tensor(b)]
            PA.append(torch.softmax(qa.masked_fill(mask, -1e9), 1).numpy())
            PB.append(torch.softmax(qb.masked_fill(mask, -1e9), 1).numpy())
            Z.append(z.numpy())
            EA.append((ea + prep.base).numpy())
            EB.append((eb + prep.base).numpy())
    return {"z": np.concatenate(Z), "pa": np.concatenate(PA), "pb": np.concatenate(PB),
            "ea": np.concatenate(EA), "eb": np.concatenate(EB)}


def train_rows(A, cfg, until_day, from_day=None):
    m = (A["DAY"] < until_day) & (A["YEAR"] >= cfg["train_from"]) & (~A["AMB"])
    m &= (~np.isnan(A["YW"])) | (A["SN"].sum((1, 2)) > 0)
    if from_day is not None:
        m &= A["DAY"] >= from_day
    return np.flatnonzero(m)


def val_rows(A, y0_day, y1_day):
    return np.flatnonzero((A["DAY"] >= y0_day) & (A["DAY"] < y1_day) & (~A["AMB"]) & (~np.isnan(A["YW"])))


def fit_one(A, cfg, seed, until_day, epochs=None, val=None, pred_idx=None):
    """Train on rows before until_day. With val (indices), record the validation winner log loss per epoch and
    keep the best-epoch weights (early stopping). With epochs, train exactly that many epochs."""
    torch = _torch()
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    prep = Prep(A, until_day, cfg)
    model = make_model(cfg, A["TOK"].shape[1], A["SIDE"].shape[-1], A["CTX"].shape[1])
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=cfg["wd"])
    tr = train_rows(A, cfg, until_day)
    n_ep = epochs if epochs is not None else cfg["max_ep"]
    curve, best, best_state = [], (1e9, -1), None
    for ep in range(n_ep):
        model.train()
        perm = rng.permutation(tr)
        for k in range(0, len(perm), cfg["bs"]):
            b = perm[k:k + cfg["bs"]]
            loss, _ = losses(model, prep, b, cfg)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
        if val is not None and len(val):
            pv = predict(model, prep, val)
            y = A["YW"][val]
            p = np.clip(sig(pv["z"]), 1e-6, 1 - 1e-6)
            llv = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
            curve.append(llv)
            if llv < best[0]:
                best = (llv, ep + 1)
                best_state = {k: v.clone() for k, v in model.state_dict().items()}
    if best_state is not None and epochs is None:
        model.load_state_dict(best_state)
    out = {"curve": curve, "best": best, "n_train": int(len(tr))}
    if pred_idx is not None:
        out["pred"] = predict(model, prep, pred_idx)
        out["draw"] = prep.draw
    out["model"] = model
    out["prep_stats"] = (prep.base.numpy(), prep.sw.numpy())
    return out


def day_of(y, m=1, d_=1):
    return dt.date(y, m, d_).toordinal()


_A_CACHE = {}


def get_arrays():
    if "A" not in _A_CACHE:
        d = load_data()
        _A_CACHE["A"] = build_arrays(d)
    return _A_CACHE["A"]


def _job(job):
    """Worker: one training run. job = dict(kind, cfg, seed, Y, epochs)."""
    A = get_arrays()
    cfg = dict(DEFAULT_CFG, **job["cfg"])
    Y = job["Y"]
    t0 = time.time()
    if job["kind"] == "es":            # train < Jan 1 (Y-1), early stop on year Y-1, predict year(s) job["pred_years"]
        val = val_rows(A, day_of(Y - 1), day_of(Y))
        pidx = np.flatnonzero(np.isin(A["YEAR"], job.get("pred_years", [Y + 1])))
        r = fit_one(A, cfg, job["seed"], day_of(Y - 1), val=val, pred_idx=pidx)
    else:                              # full refit: train < Jan 1 Y for a fixed number of epochs, predict
        pidx = np.flatnonzero(np.isin(A["YEAR"], job["pred_years"]))
        r = fit_one(A, cfg, job["seed"], day_of(Y), epochs=job["epochs"], pred_idx=pidx)
    r.pop("model")
    r["pidx"] = pidx
    r["job"] = {k: v for k, v in job.items()}
    r["secs"] = round(time.time() - t0, 1)
    return r


def run_pool(jobs, workers):
    if workers <= 1:
        return [_job(j) for j in jobs]
    import multiprocessing as mp
    ctx = mp.get_context("fork")
    with ctx.Pool(workers, initializer=lambda: os.nice(0)) as pool:
        return pool.map(_job, jobs, chunksize=1)


def ll_bin(z, y):
    p = np.clip(sig(z), 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


# ====================================================================== stage: hyperparameter CV (2016-2018)
HP_CONFIGS = {
    "base": {},
    "winner_only": {"lam_m": 0.0, "lam_s": 0.0},
    "h128": {"H": 128},
    "mean_pool": {"pool": "mean"},
    "long_hist": {"maxlen": 24},
    "from2010": {"train_from": 2010},
    "reg": {"drop": 0.35, "wd": 1e-3},
}
HP_FOLDS = [2016, 2017, 2018]
HP_SEEDS = [11, 12]


def eval_mask(A, years):
    """ml2-like evaluation rows: decisive, not ambiguous, both men with a prior UFC fight."""
    return (np.isin(A["YEAR"], years) & (~A["AMB"]) & (~np.isnan(A["YW"])) & (A["NPRIOR"].min(1) >= 1))


def stage_hpcv(args):
    A = get_arrays()
    names = args.configs.split(",") if args.configs else list(HP_CONFIGS)
    path = os.path.join(CACHE, "hpcv.json")
    R = json.load(open(path)) if os.path.exists(path) else {}
    jobs = []
    for nm in names:
        for Y in HP_FOLDS:
            for s in HP_SEEDS:
                if "%s|%d|%d" % (nm, Y, s) in R.get("runs", {}):
                    continue
                jobs.append({"kind": "es", "cfg": HP_CONFIGS[nm], "seed": s, "Y": Y, "pred_years": [Y],
                             "name": nm})
    # es jobs train < Jan 1 (Y-1) and stop on Y-1; here the fold predicts Y with that model
    for j in jobs:
        j["Y"] = j["Y"]          # validation year = Y-1, prediction year = Y
    log("hpcv: %d jobs" % len(jobs))
    t0 = time.time()
    res = run_pool(jobs, args.workers)
    R.setdefault("runs", {})
    for r in res:
        j = r["job"]
        pidx = r["pidx"]
        R["runs"]["%s|%d|%d" % (j["name"], j["Y"], j["seed"])] = {
            "best": r["best"], "curve": [round(c, 5) for c in r["curve"]], "secs": r["secs"],
            "fid": A["FID"][pidx].tolist(), "z": np.round(r["pred"]["z"], 5).tolist()}
    # summary: seed-averaged logit per fold, scored on eval rows of the fold year
    summ = {}
    for nm in HP_CONFIGS:
        tot, nn_, per = 0.0, 0, {}
        okall = True
        for Y in HP_FOLDS:
            zs = [R["runs"].get("%s|%d|%d" % (nm, Y, s)) for s in HP_SEEDS]
            if any(z is None for z in zs):
                okall = False
                break
            pos = {f: i for i, f in enumerate(A["FID"])}
            fids = zs[0]["fid"]
            z = np.mean([np.array(q["z"]) for q in zs], 0)
            ii = np.array([pos[f] for f in fids])
            m = eval_mask(A, [Y])[ii]
            y = A["YW"][ii][m]
            l_ = ll_bin(z[m], y)
            per[str(Y)] = {"n": int(m.sum()), "ll": round(l_, 5), "best_ep": [q["best"][1] for q in zs]}
            tot += l_ * m.sum()
            nn_ += m.sum()
        if okall:
            summ[nm] = {"cv_ll": round(tot / nn_, 5), "n": int(nn_), "folds": per}
    R["summary"] = summ
    json.dump(R, open(path, "w"))
    for nm, v in sorted(summ.items(), key=lambda kv: kv[1]["cv_ll"]):
        log("hpcv %-12s CV %.5f  %s" % (nm, v["cv_ll"], {k: (q["ll"], q["best_ep"]) for k, q in v["folds"].items()}))
    log("hpcv done in %.0f s" % (time.time() - t0))


STAGES = {"data": stage_data, "hpcv": stage_hpcv}


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
