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
    # LEAK GUARD: ufcstats' tale of the tape is a current snapshot, and a missing DOB / reach / stance marks a
    # short career (debut sides with a missing reach lost 346 of 392 fights). No missingness flag reaches the
    # network: a missing DOB takes the opponent's age (as tools/ml.py does), size enters only as differences
    # when both values exist.
    ag = ages[s] if ages[s] is not None else ages[1 - s]
    feats["age"] = ((ag - 30.0) / 5.0) if ag is not None else 0.0
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
            info.append({"p": p, "hist": list(S["toks"]), "age": age, "gap": gap, "n": S["n"], "elo": pre[s]["elo"],
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
SIDE_NAMES = ["age", "d_height", "d_reach", "d_ape", "south", "switch", "layoff", "debut", "logn", "lbs_move",
              "elo"]          # the last column (current pre-fight Elo) is used only by configs with side_elo
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
            si, so = e["sides"][s], e["sides"][1 - s]
            h = si["hist"][-maxlen:]
            H[i, s, :len(h)] = h
            LEN[i, s] = len(h)
            NPRIOR[i, s] = si["n"]
            # leak guard (see token_features): no missingness flags; a missing DOB takes the opponent's age;
            # height / reach / ape only as own-minus-opponent differences when both men have the value
            age = si["age"] if si["age"] is not None else so["age"]
            both_h = bool(si["height"] and so["height"])
            both_r = bool(si["reach"] and so["reach"])
            d_ape = ((si["reach"] - si["height"]) - (so["reach"] - so["height"])) if (both_h and both_r) else 0.0
            SIDE[i, s] = [((age - 30.0) / 5.0) if age is not None else 0.0,
                          ((si["height"] - so["height"]) / 3.0) if both_h else 0.0,
                          ((si["reach"] - so["reach"]) / 4.0) if both_r else 0.0, d_ape / 3.0,
                          float(si["stance"] == "Southpaw"), float(si["stance"] == "Switch"),
                          math.log1p(si["gap"]) if si["gap"] is not None else 0.0, float(si["n"] == 0),
                          math.log1p(si["n"]),
                          ((e["lbs"] - si["last_lbs"]) / 10.0) if si["last_lbs"] else 0.0,
                          (si.get("elo", 1500.0) - 1500.0) / 200.0]
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
               "lam_s": 0.3, "train_from": 2005, "maxlen": 16, "pool": "attn", "tok_drop": 0.0,
               "patience": 8}


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
            self.enc = cfg.get("enc", "gru")
            if self.enc == "tfm":
                layer = nn.TransformerEncoderLayer(H, 4, 2 * H, dropout=p, batch_first=True, activation="gelu")
                self.tfm = nn.TransformerEncoder(layer, 2, enable_nested_tensor=False)
                self.pos = nn.Parameter(torch.zeros(64, H))
            else:
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
            mask = torch.arange(L)[None, :] < l1[:, None]
            if self.enc == "tfm":
                # positions counted back from the latest fight (index 0 = most recent), plus the dt features
                back = (l1[:, None] - 1 - torch.arange(L)[None, :]).clamp(min=0, max=63)
                out = self.tfm(e + self.pos[back], src_key_padding_mask=~mask)
                hl = out[torch.arange(N), l1 - 1]
            else:
                packed = nn.utils.rnn.pack_padded_sequence(e, l1.cpu(), batch_first=True, enforce_sorted=False)
                out, h = self.rnn(packed)
                out, _ = nn.utils.rnn.pad_packed_sequence(out, batch_first=True, total_length=L)
                hl = h[0]
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
        SIDE = A["SIDE"] if cfg.get("side_elo") else A["SIDE"][..., :-1]
        S = SIDE[tr_ex].reshape(-1, SIDE.shape[-1])
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
        self.SIDE = torch.tensor(((SIDE - self.smu) / self.ssd).astype(np.float32))
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
    ((ta, la, sa), (tb, lb, sb_)), ctx = prep.batch(idx)
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
            ((ta, la, sa), (tb, lb, sb_)), ctx = prep.batch(b)
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
    model = make_model(cfg, A["TOK"].shape[1], prep.SIDE.shape[-1], A["CTX"].shape[1])
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
            elif epochs is None and ep + 1 - best[1] >= cfg.get("patience", 8):
                break                      # no improvement for `patience` epochs
    if best_state is not None and epochs is None:
        model.load_state_dict(best_state)
    out = {"curve": curve, "best": best, "n_train": int(len(tr))}
    out["draw"] = prep.draw
    if pred_idx is not None and len(pred_idx):
        out["pred"] = predict(model, prep, pred_idx)
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


def run_pool(jobs, workers, on_result=None):
    """Run training jobs in <= workers forked processes (1 torch thread each); on_result(r) is called as each
    job finishes (incremental saves)."""
    out = []
    if workers <= 1:
        for j in jobs:
            r = _job(j)
            out.append(r)
            if on_result:
                on_result(r)
        return out
    import multiprocessing as mp
    ctx = mp.get_context("fork")
    with ctx.Pool(workers) as pool:
        for r in pool.imap_unordered(_job, jobs, chunksize=1):
            out.append(r)
            if on_result:
                on_result(r)
    return out


def ll_bin(z, y):
    p = np.clip(sig(z), 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


# ====================================================================== stage: hyperparameter CV (2016-2018)
# stage-1 grid (the first base runs overfit fast: best validation epoch 3-6, then the loss climbs), so it is weighted
# toward regularisation: smaller width, lower learning rate, more dropout / weight decay
HP_CONFIGS = {
    "base": {},
    "winner_only": {"lam_m": 0.0, "lam_s": 0.0},
    "small": {"H": 32},
    "slow": {"lr": 7e-4},
    "slow_reg": {"lr": 7e-4, "drop": 0.35, "wd": 1e-2},
    "long_hist": {"maxlen": 24},
    "from2010": {"train_from": 2010},
    "transformer": {"enc": "tfm"},
    "side_elo": {"side_elo": True},
}
HP_FOLDS = [2016, 2017, 2018]
SEL_MIN_HP = 0.0005


def cfg_of(name):
    """A grid name, or a stage-2 combination 'a+b' (the overrides of a, then b)."""
    out = {}
    for part in name.split("+"):
        out.update(HP_CONFIGS[part])
    return out
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
                jobs.append({"kind": "es", "cfg": cfg_of(nm), "seed": s, "Y": Y, "pred_years": [Y],
                             "name": nm})
    # es jobs train < Jan 1 (Y-1) and stop on Y-1; here the fold predicts Y with that model
    for j in jobs:
        j["Y"] = j["Y"]          # validation year = Y-1, prediction year = Y
    log("hpcv: %d jobs" % len(jobs))
    t0 = time.time()
    R.setdefault("runs", {})

    def save(r):
        j = r["job"]
        pidx = r["pidx"]
        R["runs"]["%s|%d|%d" % (j["name"], j["Y"], j["seed"])] = {
            "best": r["best"], "curve": [round(c, 5) for c in r["curve"]], "secs": r["secs"],
            "fid": A["FID"][pidx].tolist(), "z": np.round(r["pred"]["z"], 5).tolist()}
        json.dump(R, open(path, "w"))
        log("hpcv run %s %d seed %d: best epoch %d (val %.4f), %.0f s" % (j["name"], j["Y"], j["seed"], r["best"][1],
                                                                       r["best"][0], r["secs"]))
    run_pool(jobs, args.workers, save)
    # summary: seed-averaged logit per fold, scored on eval rows of the fold year
    summ = {}
    seen = sorted({k.split("|")[0] for k in R["runs"]}, key=lambda k: (k.count("+"), k))
    for nm in seen:
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



# ====================================================================== stage: walk-forward annual refits
WALK_YEARS = list(range(2019, 2026))
ES_SEEDS = [21, 22, 23]
FULL_SEEDS = [101, 102, 103, 104, 105, 106, 107, 108]


def chosen_cfg():
    """The configuration chosen by the hyperparameter CV (lowest 2016-2018 CV log loss), frozen in
    out/seqnet_cache/chosen.json the first time the walk runs."""
    path = os.path.join(CACHE, "chosen.json")
    if os.path.exists(path):
        return json.load(open(path))
    H = json.load(open(os.path.join(CACHE, "hpcv.json")))
    summ = H["summary"]
    # ml2's 0.0005 rule: a departure from the base config must beat it by more than SEL_MIN in the 2016-2018 CV
    # (stage 2 = the combination of every stage-1 change that passed, adopted on the same rule)
    best = min(summ, key=lambda k: summ[k]["cv_ll"] + (0 if k == "base" else SEL_MIN_HP))
    ch = {"name": best, "cfg": dict(DEFAULT_CFG, **cfg_of(best)), "cv_ll": summ[best]["cv_ll"],
          "all": {k: v["cv_ll"] for k, v in summ.items()}, "frozen": dt.datetime.utcnow().isoformat() + "Z"}
    json.dump(ch, open(path, "w"), indent=1)
    return ch


def stage_walk(args):
    A = get_arrays()
    ch = chosen_cfg()
    cfg = cfg_of(ch["name"])
    log("walk with config %s: %s" % (ch["name"], ch["cfg"]))
    path = os.path.join(CACHE, "walk.pkl")
    W = pickle.load(open(path, "rb")) if os.path.exists(path) else {"es": {}, "full": {}}
    jobs = [{"kind": "es", "cfg": cfg, "seed": s, "Y": Y, "pred_years": []} for Y in WALK_YEARS for s in ES_SEEDS
            if (Y, s) not in W["es"]]
    t0 = time.time()
    if jobs:
        log("walk phase 1 (early stopping): %d jobs" % len(jobs))

        def save1(r):
            W["es"][(r["job"]["Y"], r["job"]["seed"])] = {"curve": r["curve"], "best": r["best"], "secs": r["secs"]}
            pickle.dump(W, open(path, "wb"))
            log("es %d seed %d: best epoch %d (val %.4f), %.0f s" % (r["job"]["Y"], r["job"]["seed"], r["best"][1],
                                                                   r["best"][0], r["secs"]))
        run_pool(jobs, args.workers, save1)
    W["epochs"] = {}
    for Y in WALK_YEARS:
        cs = [W["es"][(Y, s)]["curve"] for s in ES_SEEDS]
        cur = np.mean([c[:min(map(len, cs))] for c in cs], 0)     # patience stops curves at different lengths
        W["epochs"][Y] = int(np.argmin(cur)) + 1
        log("refit %d: early-stopping curve on %d, best epoch %d (val ll %.4f)" % (Y, Y - 1, W["epochs"][Y], cur.min()))
    jobs = []
    for Y in WALK_YEARS:
        py = [2024, 2025] if Y == 2024 else [Y]
        for s in FULL_SEEDS[:args.seeds]:
            if (Y, s) not in W["full"]:
                jobs.append({"kind": "full", "cfg": cfg, "seed": s, "Y": Y, "epochs": W["epochs"][Y], "pred_years": py})
    if jobs:
        log("walk phase 2 (refits): %d jobs" % len(jobs))

        def save2(r):
            W["full"][(r["job"]["Y"], r["job"]["seed"])] = {"pidx": r["pidx"], "pred": r["pred"], "draw": r["draw"],
                                                            "secs": r["secs"], "n_train": r["n_train"]}
            pickle.dump(W, open(path, "wb"))
            log("refit %d seed %d: %d epochs on %d rows, %.0f s" % (r["job"]["Y"], r["job"]["seed"],
                                                                    r["job"]["epochs"], r["n_train"], r["secs"]))
        run_pool(jobs, args.workers, save2)
    W["cfg"] = ch
    pickle.dump(W, open(path, "wb"))
    log("walk done in %.0f s" % (time.time() - t0))


def ensemble(W, A, scheme="annual", seeds=None):
    """Per example arrays (nan where not predicted): winner logit z, method|winner probs for A and B (11 each),
    stat etas for A and B (18 each), draw share. scheme 'annual': year Y from the fit before Jan 1 Y; 'static':
    2024-2025 from the fit before 2024-01-01 (2019-2023 identical in both)."""
    n = len(A["DAY"])
    Z = np.full(n, np.nan)
    PA, PB = np.full((n, 11), np.nan), np.full((n, 11), np.nan)
    EA, EB = np.full((n, 18), np.nan), np.full((n, 18), np.nan)
    DR = np.full(n, np.nan)
    FIT = np.full(n, 0)
    seeds = seeds or sorted({s for (_, s) in W["full"]})
    for Y in WALK_YEARS:
        runs = [W["full"][(Y, s)] for s in seeds if (Y, s) in W["full"]]
        if not runs:
            continue
        pidx = runs[0]["pidx"]
        yrs = A["YEAR"][pidx]
        if scheme == "annual":
            take = yrs == Y
        else:
            take = (yrs == Y) if Y < 2024 else ((yrs >= 2024) if Y == 2024 else np.zeros(len(pidx), bool))
        ii = pidx[take]
        Z[ii] = np.mean([r["pred"]["z"][take] for r in runs], 0)
        PA[ii] = np.mean([r["pred"]["pa"][take] for r in runs], 0)
        PB[ii] = np.mean([r["pred"]["pb"][take] for r in runs], 0)
        EA[ii] = np.mean([r["pred"]["ea"][take] for r in runs], 0)
        EB[ii] = np.mean([r["pred"]["eb"][take] for r in runs], 0)
        FIT[ii] = Y
        dr = runs[0]["draw"]
        DR[ii] = np.where(A["SCHED"][ii] == 5, dr[5], dr[3])
    return {"z": Z, "pa": PA, "pb": PB, "ea": EA, "eb": EB, "draw": DR, "fit_year": FIT}


def joint23(E, i):
    """methodround's 23-cell joint (orientation X = A) for example rows i."""
    z, pa, pb, dr = E["z"][i], E["pa"][i], E["pb"][i], E["draw"][i]
    p = sig(z)
    P = np.zeros((len(i), 23))
    wa, wb = (1 - dr) * p, (1 - dr) * (1 - p)
    P[:, 0:5] = wa[:, None] * pa[:, 0:5]
    P[:, 5:10] = wa[:, None] * pa[:, 5:10]
    P[:, 10:15] = wb[:, None] * pb[:, 0:5]
    P[:, 15:20] = wb[:, None] * pb[:, 5:10]
    P[:, 20] = wa * pa[:, 10]
    P[:, 21] = wb * pb[:, 10]
    P[:, 22] = dr
    return P


# ====================================================================== stage: corner-swap test
def stage_swaptest(args):
    """Train a short model and check P(A,B) + P(B,A) = 1, method cells permute and stat lines swap exactly when the
    corners of every example are swapped (history, side features, labels)."""
    torch = _torch()
    A = get_arrays()
    cfg = dict(DEFAULT_CFG, **(cfg_of(chosen_cfg()["name"]) if os.path.exists(os.path.join(CACHE, "hpcv.json"))
                               else {}))
    r = fit_one(A, cfg, 5, day_of(2015), epochs=2)
    model = r["model"]
    prep = Prep(A, day_of(2015), cfg)
    idx = np.flatnonzero((A["YEAR"] == 2015) & (~np.isnan(A["YW"])))
    p1 = predict(model, prep, idx)
    # swapped copy of the arrays
    B2 = dict(A)
    for k in ("H", "LEN", "SIDE", "SY", "SN", "NPRIOR"):
        B2[k] = A[k][:, ::-1].copy()
    B2["YW"] = np.where(np.isnan(A["YW"]), np.nan, 1 - A["YW"]).astype(np.float32)
    prep2 = Prep(B2, day_of(2015), cfg)
    p2 = predict(model, prep2, idx)
    out = {"n": int(len(idx)),
           "max|pA+pA_swapped-1|": float(np.max(np.abs(sig(p1["z"]) + sig(p2["z"]) - 1))),
           "max|z+z_swapped|": float(np.max(np.abs(p1["z"] + p2["z"]))),
           "max|methodA-methodB_swapped|": float(np.max(np.abs(p1["pa"] - p2["pb"]))),
           "max|statA-statB_swapped|": float(np.max(np.abs(p1["ea"] - p2["eb"])))}
    log("swap test: %s" % out)
    assert out["max|z+z_swapped|"] < 1e-5 and out["max|methodA-methodB_swapped|"] < 1e-5 \
        and out["max|statA-statB_swapped|"] < 1e-5, "corner symmetry violated"
    json.dump(out, open(os.path.join(CACHE, "swaptest.json"), "w"), indent=1)



# ====================================================================== evaluation helpers
SEL_MIN = 0.0005
EMBED_STATE = os.environ.get("SEQNET_EMBED_STATE", "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/"
                             "scratchpad/embed_cache/eval_state.pkl")


def M2():
    """tools/ml2.py, for its stack code (stack_fit, zmat, rec_w, stack_predict), metrics and paired bootstrap; the
    seqnet expert is routed through ml2.col_for like ml2's own experts ("seqnet_static" / "seqnet_roll")."""
    import ml2 as m2
    if not getattr(m2, "_seqnet_patched", False):
        orig = m2.col_for

        def col_for(c, scheme):
            if c in ("seqnet",):
                return c + "_" + scheme
            return orig(c, scheme)
        m2.col_for = col_for
        m2._seqnet_patched = True
    return m2


def expert_D(W, A):
    """ml2's 2019-2025 expert table (out/ml2_cache/stack.pkl, every column as ml2's stack stage used it) plus the
    seqnet columns: OOF annual refits for 2019-2023; 'static' 2024-2025 = fit before 2024-01-01, 'roll' = fit before
    Jan 1 of the fight's year."""
    D = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "stack.pkl"), "rb"))["D"].copy()
    pos = {f: i for i, f in enumerate(A["FID"])}
    ii = np.array([pos[f] for f in D["fid"]])
    Es, Ea = ensemble(W, A, "static"), ensemble(W, A, "annual")
    D["seqnet_static"] = sig(Es["z"][ii])
    D["seqnet_roll"] = sig(Ea["z"][ii])
    D["ex_i"] = ii
    assert np.all(A["YW"][ii] == D["y"].to_numpy()), "label mismatch with ml2's table"
    return D, Es, Ea


def boot_paired(la, lb, groups, n=2000, seed=7):
    """Event-cluster bootstrap of mean(la - lb): returns mean diff and 95% CI."""
    rng = np.random.default_rng(seed)
    g = pd.factorize(groups)[0]
    G = g.max() + 1
    d = la - lb
    S = np.bincount(g, d, G)
    C = np.bincount(g, minlength=G).astype(float)
    bs = []
    for _ in range(n):
        w = np.bincount(rng.integers(0, G, G), minlength=G)
        bs.append((w * S).sum() / (w * C).sum())
    return float(d.mean()), [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]


def ll_vec(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def cal_slope(p, y):
    from scipy.optimize import minimize_scalar
    z = logit(p)
    f = lambda b: np.sum(np.logaddexp(0, b * z) - y * b * z)
    return float(minimize_scalar(f, bounds=(0.05, 5), method="bounded").x)


def winner_metrics(p, y):
    return {"n": int(len(y)), "ll": round(float(ll_vec(p, y).mean()), 5),
            "brier": round(float(np.mean((p - y) ** 2)), 5), "acc": round(float(np.mean((p > 0.5) == (y == 1))), 4),
            "slope": round(cal_slope(p, y), 3)}


def cmp(pa, pb, y, groups):
    a, b = ll_vec(pa, y), ll_vec(pb, y)
    d, ci = boot_paired(a, b, groups)
    return {"n": int(len(y)), "a": round(float(a.mean()), 5), "b": round(float(b.mean()), 5), "diff": round(d, 5),
            "ci": [round(ci[0], 5), round(ci[1], 5)]}


STACK_SETS = {
    "line": [("market+ml2", ["market", "ml2"]), ("page: market+ml2lr", ["market", "ml2lr"]),
             ("market+seqnet", ["market", "seqnet"])],
    "noline": [("ml2+mkt_rating+feat_lr", ["ml2", "mkt_rating", "feat_lr"]),
               ("page: ml2lr+mkt_rating", ["ml2lr", "mkt_rating"]),
               ("seqnet alone", ["seqnet"]), ("seqnet+mkt_rating", ["seqnet", "mkt_rating"])],
    "open": [("open+ml2", ["open", "ml2"]), ("page: open+ml2lr", ["open", "ml2lr"]),
             ("open+seqnet", ["open", "seqnet"])],
}
GATE_PAIRS = {   # base set -> base + seqnet (the gate: CV gain beyond SEL_MIN)
    "line": ["market+ml2", "page: market+ml2lr"],
    "noline": ["ml2+mkt_rating+feat_lr", "page: ml2lr+mkt_rating"],
    "open": ["open+ml2", "page: open+ml2lr"],
}


def stack_cv_one(m2, D, cols, rows_ok, y, yr):
    cvs, preds = {}, {}
    for h in (None, 3.0, 1.5):
        tot = nn = 0.0
        pr = np.full(len(D), np.nan)
        for Y in (2021, 2022, 2023):
            m = rows_ok & (yr == Y)
            p, _ = m2.stack_predict(D, cols, "static", h, Y - 1, m, rows_ok)
            pr[m] = p
            tot += m2.ll(p, y[m]) * m.sum()
            nn += m.sum()
        cvs[str(h)] = round(tot / nn, 5)
        preds[str(h)] = pr
    hbest = min(cvs, key=lambda k: cvs[k] + (0 if k == "None" else SEL_MIN))
    return cvs, hbest, preds[hbest]


def stack_gate(W, A):
    """Forward-chained 2021-2023 stack CV (fit on 2019..Y-1 OOF rows, predict Y), ml2's code and rules."""
    m2 = M2()
    D, _, _ = expert_D(W, A)
    y, yr = D["y"].to_numpy(float), D["year"].to_numpy()
    rows_of = {"line": D["market"].notna().to_numpy(), "noline": np.ones(len(D), bool),
               "open": D["open"].notna().to_numpy()}
    R = {"sets": {}, "gate": {}, "paired_cv_years": {}}
    P = {}
    for regime, sets in STACK_SETS.items():
        allsets = list(sets) + [(nm + " + seqnet", cols + ["seqnet"]) for nm, cols in sets if nm in GATE_PAIRS[regime]]
        for nm, cols in allsets:
            cvs, hb, pr = stack_cv_one(m2, D, cols, rows_of[regime], y, yr)
            h = None if hb == "None" else float(hb)
            _, b = m2.stack_predict(D, cols, "static", h, 2023, np.zeros(len(D), bool), rows_of[regime])
            R["sets"]["%s|%s" % (regime, nm)] = {"cols": cols, "cv_by_h": cvs, "chosen_h": h, "cv": cvs[hb],
                                                 "weights_fit_2019_2023": dict(zip(cols, np.round(b, 4).tolist()))}
            P["%s|%s" % (regime, nm)] = pr
            log("stack CV %-6s %-34s CV %.5f (h %s) w<=2023 %s" % (regime, nm, cvs[hb], h, np.round(b, 3)))
        for base in GATE_PAIRS[regime]:
            kb, kn = "%s|%s" % (regime, base), "%s|%s + seqnet" % (regime, base)
            gain = R["sets"][kn]["cv"] - R["sets"][kb]["cv"]
            R["gate"][kn] = {"cv_base": R["sets"][kb]["cv"], "cv_plus": R["sets"][kn]["cv"], "gain": round(gain, 5),
                             "enters": bool(gain < -SEL_MIN),
                             "seqnet_weight": R["sets"][kn]["weights_fit_2019_2023"]["seqnet"]}
            m = rows_of[regime] & (yr >= 2021) & (yr <= 2023)
            R["paired_cv_years"][kn + " vs base"] = cmp(P[kn][m], P[kb][m], y[m], D["event"].to_numpy()[m])
            log("GATE %-40s gain %+.5f -> %s %s" % (kn, gain, "ENTERS" if gain < -SEL_MIN else "rejected",
                                                    R["paired_cv_years"][kn + " vs base"]))
    return R, D, P


def stat_rows(A, years):
    """Directed stat rows (example i, side s) in the backtest universe with stats."""
    m = np.isin(A["YEAR"], years) & (~A["AMB"]) & (A["NPRIOR"].min(1) >= 1) & (A["SN"].sum((1, 2)) > 0)
    ii = np.flatnonzero(m)
    return np.r_[ii, ii], np.r_[np.zeros(len(ii), int), np.ones(len(ii), int)]


def unit_dev(y, n, eta, t):
    """mlrates' unit deviance for target t: Poisson on counts with exposure n (eta = log rate per minute), binomial
    with n trials (eta = logit)."""
    if t < N_POIS:
        mu = n * np.exp(eta)
        return 2 * (np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / np.maximum(mu, 1e-12)), 0) - (y - mu))
    p = np.clip(sig(eta), 1e-9, 1 - 1e-9)
    ph = np.clip(y / np.maximum(n, 1e-12), 0, 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        a = np.where(y > 0, y * np.log(np.maximum(ph, 1e-300) / p), 0)
        b = np.where(n - y > 0, (n - y) * np.log(np.maximum(1 - ph, 1e-300) / (1 - p)), 0)
    return np.where(n > 0, 2 * (a + b), 0.0)


def mlrates_eta(A, ii, ss):
    """mlrates OOF / dev rates (mlrates_oof.json) on the link scale; nan where the fight is missing."""
    mo = jload("mlrates_oof.json")
    assert mo["meta"]["targets"] == STAT_TARGETS
    F = mo["fights"]
    out = np.full((len(ii), 18), np.nan)
    for k, (i, s) in enumerate(zip(ii, ss)):
        e = F.get(A["FID"][i])
        if e is None or e["date"] >= VAULT_S:
            continue
        v = np.array(e["A" if s == 0 else "B"], float)
        out[k, :N_POIS] = np.log(np.maximum(v[:N_POIS], 1e-9))
        out[k, N_POIS:] = logit(np.clip(v[N_POIS:], 1e-6, 1 - 1e-6))
    return out


def embed_eta(A, ii, ss):
    """The embedding task predictor (tools/embed.py walk, cached eval_state) per directed row; nan if missing."""
    if not os.path.exists(EMBED_STATE):
        return None
    import embed as EM
    T = pickle.load(open(EMBED_STATE, "rb"))["T"]
    row = {f: j for j, f in enumerate(T["id"])}
    out = np.full((len(ii), 18), np.nan)
    cols = [EM.TI[EM.MLR_MAP[t]] for t in STAT_TARGETS]
    for k, (i, s) in enumerate(zip(ii, ss)):
        j = row.get(A["FID"][i])
        if j is None or A["YEAR"][i] >= 2026:
            continue
        out[k] = (T["eta_ab"] if s == 0 else T["eta_ba"])[j, cols]
    return out


def glm_fit(Z, y, n, binom, iters=50):
    """Newton for a Poisson-log (exposure n) or binomial-logit (n trials) GLM, tiny ridge."""
    b = np.zeros(Z.shape[1])
    for _ in range(iters):
        eta = Z @ b
        if binom:
            p = sig(eta)
            g = Z.T @ (n * p - y)
            Hs = (Z * (n * p * (1 - p))[:, None]).T @ Z
        else:
            mu = n * np.exp(np.clip(eta, -30, 10))
            g = Z.T @ (mu - y)
            Hs = (Z * mu[:, None]).T @ Z
        step = np.linalg.solve(Hs + 1e-6 * np.eye(len(b)), g + 1e-6 * b)
        b -= step
        if np.max(np.abs(step)) < 1e-9:
            break
    return b


RECIPES = {"recal": ["ml"], "+seqnet": ["ml", "seq"], "+emb": ["ml", "emb"], "+emb+seqnet": ["ml", "emb", "seq"]}


def stat_eval(A, Ea, years_fit=(2019, 2023), years_score=None, cv=True):
    """Per target: deviance of seqnet alone vs mlrates alone, and of embed-style recipes (link = b0 + b1 link(mlrates)
    + b2 link(seqnet) [+ b3 eta_emb]), with the keep rule by time-ordered CV inside 2019-2023. years_score None ->
    CV numbers only; else recipes fit on years_fit and scored on years_score."""
    yrs_all = list(range(years_fit[0], (years_score or years_fit)[-1] + 1)) if years_score else \
        list(range(years_fit[0], years_fit[1] + 1))
    ii, ss = stat_rows(A, yrs_all)
    Y, N = A["SY"][ii, ss], A["SN"][ii, ss]
    SEQ = np.where(ss[:, None] == 0, Ea["ea"][ii], Ea["eb"][ii])
    ML = mlrates_eta(A, ii, ss)
    EMB = embed_eta(A, ii, ss)
    yr = A["YEAR"][ii]
    ok_rows = ~np.isnan(ML).any(1) & ~np.isnan(SEQ).any(1)
    if EMB is not None:
        ok_rows &= ~np.isnan(EMB).any(1)
    ev = A["EVENT"][ii]
    res = {"n_rows": {}, "per_target": {}, "emb_available": EMB is not None}
    fitm = ok_rows & (yr >= years_fit[0]) & (yr <= years_fit[1])
    scm = ok_rows & np.isin(yr, years_score) if years_score else None
    contrib = defaultdict(lambda: np.zeros(int((scm if years_score else fitm).sum())))
    for t, tn in enumerate(STAT_TARGETS):
        binom = t >= N_POIS
        y, n = Y[:, t], N[:, t]
        has = n > 0
        cols = {"ml": ML[:, t], "seq": SEQ[:, t], "emb": EMB[:, t] if EMB is not None else np.zeros(len(y))}
        if not binom:
            offs = np.log(np.maximum(n, 1e-9))
        r = {}
        # raw: each model as is
        if years_score:
            m = scm & has
        else:
            m = fitm & has
        d_ml = unit_dev(y[m], n[m], cols["ml"][m], t)
        d_sq = unit_dev(y[m], n[m], cols["seq"][m], t)
        dd, ci = boot_paired(d_sq, d_ml, ev[m], n=1000)
        r["raw_seqnet_vs_mlrates"] = {"dev_ml": round(float(d_ml.mean()), 5), "dev_seq": round(float(d_sq.mean()), 5),
                                      "rel": round(dd / d_ml.mean(), 4), "ci": [round(c / d_ml.mean(), 4) for c in ci],
                                      "n": int(m.sum())}
        sel = (scm if years_score else fitm)
        # recipes: time-ordered CV inside 2019-2023 (fit years < v, score v = 2020..2023)
        cvd = {}
        for rn, cs in RECIPES.items():
            if "emb" in cs and EMB is None:
                continue
            Z = np.c_[np.ones(len(y)), np.column_stack([cols[c] for c in cs])]
            tot = 0.0
            for v in range(2020, 2024):
                a = fitm & has & (yr < v)
                bb = fitm & has & (yr == v)
                if binom:
                    b = glm_fit(Z[a], y[a], n[a], True)
                    tot += unit_dev(y[bb], n[bb], Z[bb] @ b, t).sum()
                else:
                    b = glm_fit(Z[a], y[a], n[a], False)
                    tot += unit_dev(y[bb], n[bb], Z[bb] @ b, t).sum()
            cvd[rn] = tot
        r["cv_dev"] = {k: round(v, 2) for k, v in cvd.items()}
        r["cv_rel_seqnet_on_mlrates"] = round((cvd["+seqnet"] - cvd["recal"]) / cvd["recal"], 5)
        r["keep_seqnet_on_mlrates"] = bool(cvd["+seqnet"] < cvd["recal"])
        if "+emb" in cvd:
            r["cv_rel_emb_on_mlrates"] = round((cvd["+emb"] - cvd["recal"]) / cvd["recal"], 5)
            r["cv_rel_seqnet_on_mlrates_emb"] = round((cvd["+emb+seqnet"] - cvd["+emb"]) / cvd["+emb"], 5)
            r["keep_emb"] = bool(cvd["+emb"] < cvd["recal"])
            r["keep_seqnet_on_mlrates_emb"] = bool(cvd["+emb+seqnet"] < cvd["+emb"])
        if years_score:
            # fit each recipe on years_fit, score years_score
            dv = {}
            for rn, cs in RECIPES.items():
                if "emb" in cs and EMB is None:
                    continue
                Z = np.c_[np.ones(len(y)), np.column_stack([cols[c] for c in cs])]
                a = fitm & has
                b = glm_fit(Z[a], y[a], n[a], binom)
                dv[rn] = np.where(has[sel], unit_dev(y[sel], np.where(has[sel], n[sel], 1.0), Z[sel] @ b, t), 0.0)
            # CV-selected versions (the keep rule above)
            dv["mlrates+seqnet (CV keep)"] = dv["+seqnet"] if r["keep_seqnet_on_mlrates"] else dv["recal"]
            if "+emb" in dv:
                dv["mlrates+emb (CV keep)"] = dv["+emb"] if r["keep_emb"] else dv["recal"]
                base_e = dv["mlrates+emb (CV keep)"]
                dv["mlrates+emb+seqnet (CV keep)"] = (dv["+emb+seqnet"] if r["keep_emb"] else dv["+seqnet"]) \
                    if (r["keep_seqnet_on_mlrates_emb"] if r["keep_emb"] else r["keep_seqnet_on_mlrates"]) else base_e
            r["valid_dev"] = {k: round(float(v.mean()), 5) for k, v in dv.items()}
            for a_, b_ in (("+seqnet", "recal"), ("mlrates+seqnet (CV keep)", "recal"),
                           ("mlrates+emb (CV keep)", "recal"),
                           ("mlrates+emb+seqnet (CV keep)", "mlrates+emb (CV keep)")):
                if a_ in dv and b_ in dv:
                    d_, ci_ = boot_paired(dv[a_], dv[b_], ev[sel], n=1000)
                    base = dv[b_].mean()
                    r["valid %s vs %s" % (a_, b_)] = {"rel": round(d_ / base, 4),
                                                      "ci": [round(ci_[0] / base, 4), round(ci_[1] / base, 4)]}
                    contrib["%s vs %s" % (a_, b_)] += (dv[a_] - dv[b_]) / max(dv[b_].sum(), 1e-9) / 18
            # raw mean relative deviance contribution (seqnet alone vs mlrates alone)
            draw_ml = np.where(has[sel], unit_dev(y[sel], np.where(has[sel], n[sel], 1.0), cols["ml"][sel], t), 0)
            draw_sq = np.where(has[sel], unit_dev(y[sel], np.where(has[sel], n[sel], 1.0), cols["seq"][sel], t), 0)
            contrib["raw seqnet vs mlrates"] += (draw_sq - draw_ml) / max(draw_ml.sum(), 1e-9) / 18
        else:
            draw_ml = np.where(has[sel], unit_dev(y[sel], np.where(has[sel], n[sel], 1.0), cols["ml"][sel], t), 0)
            draw_sq = np.where(has[sel], unit_dev(y[sel], np.where(has[sel], n[sel], 1.0), cols["seq"][sel], t), 0)
            contrib["raw seqnet vs mlrates"] += (draw_sq - draw_ml) / max(draw_ml.sum(), 1e-9) / 18
        res["per_target"][tn] = r
    sel = (scm if years_score else fitm)
    res["n_rows"] = int(sel.sum())
    res["mean_rel"] = {}
    for k, c in contrib.items():
        if not np.any(c):
            continue
        d_, ci_ = boot_paired(c * len(c), np.zeros(len(c)), ev[sel], n=1000)
        res["mean_rel"][k] = {"mean": round(d_, 4), "ci": [round(ci_[0], 4), round(ci_[1], 4)]}
    cvm = {}
    for key in ("cv_rel_seqnet_on_mlrates", "cv_rel_emb_on_mlrates", "cv_rel_seqnet_on_mlrates_emb"):
        v = [res["per_target"][t].get(key) for t in STAT_TARGETS]
        if all(x is not None for x in v):
            cvm[key] = round(float(np.mean(v)), 5)
    res["cv_mean_rel"] = cvm
    return res


def method_eval(A, E, D_ids_years, ml2win=None, s2=None):
    """methodround metrics for the seqnet 23-cell joint vs methodround S (walk-forward), on backtest fights of the
    given years with an outcome cell (draws kept, DQ/NC dropped). ml2win: optional {fid: P(A)} replacing the
    winner; s2: optional {fid: 23-cell} (ml2's S2+ml2win, 2024-2025 only)."""
    import methodround as MR
    mr = jload("methodround.json")["fights"]
    years = D_ids_years
    m = np.isin(A["YEAR"], years) & (~A["AMB"]) & (A["NPRIOR"].min(1) >= 1) & ~np.isnan(E["z"])
    m &= (A["CLS"] >= 0) | A["DRAW"]
    ii = np.array([i for i in np.flatnonzero(m) if A["FID"][i] in mr and "S" in mr[A["FID"][i]]
                   and mr[A["FID"][i]]["date"] < VAULT_S])
    if s2 is not None:
        ii = np.array([i for i in ii if A["FID"][i] in s2])
    T = pd.DataFrame({"rounds": A["SCHED"][ii],
                      "cls": [("DRAW" if A["DRAW"][i] else ("DEC" if A["CLS"][i] == 10 else
                                                            ("KO" if A["CLS"][i] < 5 else "SUB"))) for i in ii],
                      "winner": A["WINNER"][ii], "rnd": [int(min(5, max(1, (A["CLS"][i] % 5) + 1)))
                                                         if 0 <= A["CLS"][i] < 10 else 1 for i in ii]})
    y = MR.outcome_cells(T)
    P = {"seqnet": joint23(E, ii)}
    if ml2win is not None:
        E2 = dict(E)
        z2 = E["z"].copy()
        for i in ii:
            q = ml2win.get(A["FID"][i])
            if q is not None:
                z2[i] = logit(q)
        E2["z"] = z2
        P["seqnet method + ml2 winner"] = joint23(E2, ii)
    P["S"] = np.stack([MR.expand_cells(mr[A["FID"][i]]["S"], int(A["SCHED"][i])) for i in ii])
    if s2 is not None:
        P["S2+ml2win"] = np.stack([np.asarray(s2[A["FID"][i]], float) for i in ii])
    ok = y >= 0
    L = {k: MR.per_fight_losses(v[ok], y[ok], T[ok]) for k, v in P.items()}
    ev = A["EVENT"][ii][ok]
    keys = ["joint", "method3", "bin7", "finish", "method_round", "round_given_fin", "method_given_winner", "winner"]
    out = {"n": int(ok.sum()), "means": {}, "paired": {}}
    for k, Lk in L.items():
        out["means"][k] = {m_: round(float(np.nanmean(Lk[m_])), 5) for m_ in keys}
    refs = ["S"] + (["S2+ml2win"] if s2 is not None else [])
    for k in L:
        for ref in refs:
            if k == ref:
                continue
            pr = {}
            for m_ in keys:
                a, b = L[k][m_], L[ref][m_]
                okm = ~np.isnan(a) & ~np.isnan(b)
                d_, ci_ = boot_paired(a[okm], b[okm], ev[okm])
                pr[m_] = {"diff": round(d_, 5), "ci": [round(ci_[0], 5), round(ci_[1], 5)]}
            out["paired"]["%s - %s" % (k, ref)] = pr
    return out


# ====================================================================== stage: cv (pre-2024 numbers only)
def stage_cv(args):
    A = get_arrays()
    W = pickle.load(open(os.path.join(CACHE, "walk.pkl"), "rb"))
    R = {"config": W["cfg"], "epochs": {str(k): v for k, v in W["epochs"].items()}}
    m2 = M2()
    D, Es, Ea = expert_D(W, A)
    y, yr, ev = D["y"].to_numpy(float), D["year"].to_numpy(), D["event"].to_numpy()
    oof = (yr >= 2019) & (yr <= 2023)
    R["oof"] = {"seqnet": winner_metrics(D["seqnet_static"].to_numpy()[oof], y[oof])}
    for c in ("ml2_static", "ml2lr_static", "mkt_rating", "elo", "ml"):
        R["oof"][c] = winner_metrics(D[c].to_numpy(float)[oof], y[oof])
    R["oof_paired"] = {}
    for c in ("ml2_static", "ml2lr_static", "mkt_rating", "elo", "ml"):
        R["oof_paired"]["seqnet - " + c] = cmp(D["seqnet_static"].to_numpy()[oof], D[c].to_numpy(float)[oof], y[oof],
                                               ev[oof])
    hl = oof & D["market"].notna().to_numpy()
    R["oof_paired"]["seqnet - close"] = cmp(D["seqnet_static"].to_numpy()[hl], D["market"].to_numpy(float)[hl], y[hl],
                                            ev[hl])
    R["oof_by_year"] = {}
    for Y in range(2019, 2024):
        m = yr == Y
        R["oof_by_year"][str(Y)] = {"n": int(m.sum()), "seqnet": round(float(ll_vec(D["seqnet_static"].to_numpy()[m], y[m]).mean()), 5),
                                    "ml2": round(float(ll_vec(D["ml2_static"].to_numpy()[m], y[m]).mean()), 5),
                                    "elo": round(float(ll_vec(D["elo"].to_numpy(float)[m], y[m]).mean()), 5)}
    # segments, OOF
    nmin = np.minimum(D["nA"].to_numpy(), D["nB"].to_numpy())
    segs = {"newcomer bout (min prior 1-2)": nmin <= 2, "middle (3-7)": (nmin >= 3) & (nmin <= 7),
            "veterans (8+)": nmin >= 8, "5 rounds": D["five"].to_numpy() == 1, "women": D["women"].to_numpy() == 1}
    R["oof_segments"] = {k: cmp(D["seqnet_static"].to_numpy()[oof & m], D["ml2_static"].to_numpy()[oof & m],
                                y[oof & m], ev[oof & m]) for k, m in segs.items()}
    for k, v in R["oof"].items():
        log("OOF 2019-2023 %-14s %s" % (k, v))
    for k, v in R["oof_paired"].items():
        log("OOF paired %-24s %s" % (k, v))
    # stack gate
    G, _, _ = stack_gate(W, A)
    R["stack"] = G
    # method x round on CV years (walk-forward S from methodround.json)
    ml2oof = {f: p for f, p in zip(D["fid"], D["ml2_static"]) if True}
    R["method_cv"] = method_eval(A, Ea, list(range(2019, 2024)), ml2win=ml2oof)
    for k, v in R["method_cv"]["means"].items():
        log("method 2019-2023 %-28s %s" % (k, v))
    for k, v in R["method_cv"]["paired"].items():
        log("method paired %-34s bin7 %s method3 %s joint %s mgw %s" % (k, v["bin7"], v["method3"], v["joint"],
                                                                        v["method_given_winner"]))
    # stat lines on 2019-2023 (OOF vs mlrates OOF; recipe CV)
    R["stats_cv"] = stat_eval(A, Ea)
    log("stats CV mean rel: %s | cv recipes: %s" % (R["stats_cv"]["mean_rel"], R["stats_cv"]["cv_mean_rel"]))
    for t in STAT_TARGETS:
        q = R["stats_cv"]["per_target"][t]
        log("  stat %-7s raw seq vs ml %+.4f %s | cv +seq %+.5f | +emb %s | +emb+seq %s" % (
            t, q["raw_seqnet_vs_mlrates"]["rel"], q["raw_seqnet_vs_mlrates"]["ci"], q["cv_rel_seqnet_on_mlrates"],
            q.get("cv_rel_emb_on_mlrates"), q.get("cv_rel_seqnet_on_mlrates_emb")))
    json.dump(R, open(os.path.join(CACHE, "cv.json"), "w"), indent=1, default=float)
    log("cv stage written")



# ====================================================================== stage: confirm (2024-2025, scored once)
def stage_confirm(args):
    mark = os.path.join(CACHE, "confirm.done")
    if os.path.exists(mark) and not args.force:
        raise SystemExit("2024-2025 was already scored once (%s); rerun only with --force, which is recorded" % mark)
    A = get_arrays()
    W = pickle.load(open(os.path.join(CACHE, "walk.pkl"), "rb"))
    cvj = json.load(open(os.path.join(CACHE, "cv.json")))
    m2 = M2()
    D, Es, Ea = expert_D(W, A)
    y, yr, ev = D["y"].to_numpy(float), D["year"].to_numpy(), D["event"].to_numpy()
    va = (yr >= 2024) & (yr <= 2025)
    R = {"scored_at": dt.datetime.utcnow().isoformat() + "Z", "forced_rerun": bool(os.path.exists(mark))}
    cols = {"seqnet static": "seqnet_static", "seqnet annual": "seqnet_roll", "ml2 blend static": "ml2_static",
            "ml2 blend rolling": "ml2_roll", "ml2 logistic static": "ml2lr_static", "ml2 logistic rolling": "ml2lr_roll",
            "market rating": "mkt_rating", "elo": "elo", "ml v1": "ml"}
    R["standalone"] = {k: winner_metrics(D[c].to_numpy(float)[va], y[va]) for k, c in cols.items()}
    hl = va & D["market"].notna().to_numpy()
    ho = va & D["open"].notna().to_numpy()
    R["standalone"]["close (845)"] = winner_metrics(D["market"].to_numpy(float)[hl], y[hl])
    R["standalone"]["open (843)"] = winner_metrics(D["open"].to_numpy(float)[ho], y[ho])
    R["paired"] = {}
    for sc in ("seqnet_static", "seqnet_roll"):
        for k, c in cols.items():
            if c.startswith("seqnet"):
                continue
            R["paired"]["%s - %s" % (sc, k)] = cmp(D[sc].to_numpy()[va], D[c].to_numpy(float)[va], y[va], ev[va])
        R["paired"]["%s - close" % sc] = cmp(D[sc].to_numpy()[hl], D["market"].to_numpy(float)[hl], y[hl], ev[hl])
        R["paired"]["%s - open" % sc] = cmp(D[sc].to_numpy()[ho], D["open"].to_numpy(float)[ho], y[ho], ev[ho])
    R["paired"]["seqnet annual - seqnet static"] = cmp(D["seqnet_roll"].to_numpy()[va], D["seqnet_static"].to_numpy()[va],
                                                       y[va], ev[va])
    R["by_year"] = {str(Y): {k: round(float(ll_vec(D[c].to_numpy(float)[yr == Y], y[yr == Y]).mean()), 5)
                             for k, c in cols.items()} for Y in (2024, 2025)}
    nmin = np.minimum(D["nA"].to_numpy(), D["nB"].to_numpy())
    segs = {"newcomer bout (min prior 1-2)": nmin <= 2, "middle (3-7)": (nmin >= 3) & (nmin <= 7),
            "veterans (8+)": nmin >= 8, "5 rounds": D["five"].to_numpy() == 1, "women": D["women"].to_numpy() == 1}
    R["segments"] = {k: {"seqnet - ml2 blend (static)": cmp(D["seqnet_static"].to_numpy()[va & m],
                                                             D["ml2_static"].to_numpy()[va & m], y[va & m], ev[va & m])}
                     for k, m in segs.items()}
    for k, v in R["standalone"].items():
        log("2024-25 %-22s %s" % (k, v))
    for k, v in R["paired"].items():
        log("2024-25 paired %-38s %s" % (k, v))
    # stacks: every gate pair, static (fit <= 2023, CV-chosen h) and rolling (refit each January on roll columns)
    rows_of = {"line": D["market"].notna().to_numpy(), "noline": np.ones(len(D), bool),
               "open": D["open"].notna().to_numpy()}
    R["stacks"] = {}
    for key, g in cvj["stack"]["sets"].items():
        regime, nm = key.split("|", 1)
        rows_ok = rows_of[regime]
        h = g["chosen_h"]
        m = rows_ok & va
        p_st, b = m2.stack_predict(D, g["cols"], "static", h, 2023, m, rows_ok)
        p_ro = np.full(len(D), np.nan)
        for Y in (2024, 2025):
            mm = rows_ok & (yr == Y)
            p_ro[mm], _ = m2.stack_predict(D, g["cols"], "roll", h, Y - 1, mm, rows_ok)
        R["stacks"][key] = {"static": winner_metrics(p_st, y[m]), "roll": winner_metrics(p_ro[m], y[m]),
                            "_p_static": p_st, "_p_roll": p_ro[m], "_m": m}
    for kn, gate in cvj["stack"]["gate"].items():
        regime = kn.split("|")[0]
        kb = kn[:-len(" + seqnet")]
        a, b = R["stacks"][kn], R["stacks"][kb]
        m = a["_m"]
        gate_r = {"enters_by_cv": gate["enters"], "cv_gain": gate["gain"],
                  "static": cmp(a["_p_static"], b["_p_static"], y[m], ev[m]),
                  "roll": cmp(a["_p_roll"], b["_p_roll"], y[m], ev[m])}
        if regime != "line":
            mc = m & D["market"].notna().to_numpy()
            sub = mc[m]
            gate_r["plus vs close (static)"] = cmp(a["_p_static"][sub], D["market"].to_numpy(float)[mc], y[mc], ev[mc])
        else:
            gate_r["plus vs close (static)"] = cmp(a["_p_static"], D["market"].to_numpy(float)[m], y[m], ev[m])
            gate_r["base vs close (static)"] = cmp(b["_p_static"], D["market"].to_numpy(float)[m], y[m], ev[m])
        R.setdefault("gate_valid", {})[kn] = gate_r
        log("2024-25 stack %-40s (CV %s) static %s roll %s" % (kn, "enters" if gate["enters"] else "rejected",
                                                              gate_r["static"], gate_r["roll"]))
    for k in R["stacks"]:
        for q in ("_p_static", "_p_roll", "_m"):
            R["stacks"][k].pop(q)
    # method x round: vs methodround S and ml2's S2+ml2win (same 857-fight universe)
    mj = json.load(open(os.path.join(ROOT, "out", "ml2_cache", "method.json")))
    s2 = mj.get("_pred_test", {})
    ml2st = dict(zip(D["fid"], D["ml2_static"]))
    R["method"] = method_eval(A, Es, [2024, 2025], ml2win=ml2st, s2=s2 if s2 else None)
    for k, v in R["method"]["means"].items():
        log("method 2024-25 %-28s %s" % (k, v))
    for k, v in R["method"]["paired"].items():
        log("method paired %-34s bin7 %s method3 %s joint %s mgw %s" % (k, v["bin7"], v["method3"], v["joint"],
                                                                        v["method_given_winner"]))
    # stat lines: seqnet static (fit < 2024) vs mlrates dev (fit 2010-2023), recipes fit on 2019-2023
    R["stats"] = stat_eval(A, Es, years_fit=(2019, 2023), years_score=[2024, 2025])
    log("stats 2024-25 mean rel: %s" % R["stats"]["mean_rel"])
    for t in STAT_TARGETS:
        q = R["stats"]["per_target"][t]
        log("  stat %-7s raw seq vs ml %+.4f %s | %s" % (
            t, q["raw_seqnet_vs_mlrates"]["rel"], q["raw_seqnet_vs_mlrates"]["ci"],
            {k: v for k, v in q.items() if k.startswith("valid ")}))
    json.dump(R, open(os.path.join(CACHE, "confirm.json"), "w"), indent=1, default=float)
    open(mark, "w").write(R["scored_at"] + ("\nforced rerun\n" if R["forced_rerun"] else "\n"))
    log("confirm written (2024-2025 scored once)")


# ====================================================================== stage: export
def n_params():
    A = get_arrays()
    cfg = chosen_cfg()["cfg"]
    m = make_model(cfg, A["TOK"].shape[1], A["SIDE"].shape[-1] - (0 if cfg.get("side_elo") else 1), A["CTX"].shape[1])
    return int(sum(p.numel() for p in m.parameters()))


def stage_export(args):
    A = get_arrays()
    W = pickle.load(open(os.path.join(CACHE, "walk.pkl"), "rb"))
    D, Es, Ea = expert_D(W, A)
    d = load_data()
    rd = lambda x: None if x is None or not np.isfinite(x) else round(float(x), 5)
    fights = {}
    for r in D.itertuples():
        i = r.ex_i
        rec = {"date": A["DAY"][i] and dt.date.fromordinal(int(A["DAY"][i])).isoformat(), "y": int(r.y),
               "set": "oof" if r.year <= 2023 else "valid", "p": rd(r.seqnet_static), "p_annual": rd(r.seqnet_roll),
               "fit_through": "%d-12-31" % (int(Ea["fit_year"][i]) - 1),
               "fit_through_static": "%d-12-31" % (int(Es["fit_year"][i]) - 1)}
        for nm, E in (("bins7", Es), ("bins7_annual", Ea)):
            P = joint23(E, np.array([i]))[0]
            rec[nm] = [rd(x) for x in (P[0:5].sum(), P[5:10].sum(), P[20], P[22], P[21], P[15:20].sum(),
                                       P[10:15].sum())]
            fr = P[0:5] + P[5:10] + P[10:15] + P[15:20]
            rec["fin_round" + nm[5:]] = [rd(x) for x in fr[:int(A["SCHED"][i])]]
        fights[r.fid] = rec
    out = {"meta": {"tool": "tools/seqnet.py", "built": dt.datetime.utcnow().isoformat() + "Z",
                    "data_last_fight": d["last_fight"],
                    "protocol": "fights dated 2026-01-01 or later dropped at parse; hyperparameters by time-ordered "
                                "CV on 2016-2018 folds; walk-forward annual refits 2019-2025 trained strictly before "
                                "Jan 1 of the predicted year (early stopping on the last training year, then a refit); "
                                "2024-2025 scored once (confirm stage)",
                    "config": W["cfg"], "epochs_by_refit_year": {str(k): v for k, v in W["epochs"].items()},
                    "seeds": sorted({s for (_, s) in W["full"]}), "n_params": n_params(),
                    "token_features": d["tok_names"], "side_features": SIDE_NAMES, "context_features": CTX_NAMES,
                    "stat_targets": STAT_TARGETS, "method_classes": METHOD_CLASSES,
                    "columns": {"p": "P(A wins): 2019-2023 annual OOF refit, 2024-2025 fit before 2024-01-01",
                                "p_annual": "P(A wins): fit before Jan 1 of the fight's year (walk-forward)",
                                "bins7": "[A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO] (static fit)",
                                "fin_round": "P(finish in round r), r = 1..scheduled (static fit)"}},
           "hpcv": json.load(open(os.path.join(CACHE, "hpcv.json")))["summary"],
           "swaptest": json.load(open(os.path.join(CACHE, "swaptest.json"))) if os.path.exists(
               os.path.join(CACHE, "swaptest.json")) else None,
           "cv": json.load(open(os.path.join(CACHE, "cv.json"))),
           "validation_2024_2025": json.load(open(os.path.join(CACHE, "confirm.json"))) if os.path.exists(
               os.path.join(CACHE, "confirm.json")) else None,
           "fights": fights}
    json.dump(out, open(OUT_JSON, "w"), separators=(",", ":"), default=float)
    log("wrote %s (%d fights, %.0f KB)" % (OUT_JSON, len(fights), os.path.getsize(OUT_JSON) / 1024))


STAGES = {"data": stage_data, "hpcv": stage_hpcv, "walk": stage_walk, "swaptest": stage_swaptest, "cv": stage_cv,
          "confirm": stage_confirm, "export": stage_export}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=sorted(STAGES))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--seeds", type=int, default=8)
    ap.add_argument("--configs", default=None)
    args = ap.parse_args()
    STAGES[args.stage](args)


if __name__ == "__main__":
    main()
