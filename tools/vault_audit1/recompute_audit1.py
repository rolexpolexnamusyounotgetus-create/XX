#!/usr/bin/env python3
"""VAULT AUDIT 1 - INDEPENDENT RECOMPUTATION of the headline rows of research/vault_audit_v5.md (auditor only).

    nice -n 5 python3 tools/vault_audit1/recompute_audit1.py [--vault <dir>] [--engines <dir with evalv/*_vault.json>]

Same opening as audit 1 (the vault was already open for it); nothing is tuned, no model or variant is added. This script
shares no scoring code with tools/vault_audit1/score_vault.py or models_vault.js. From the raw vault files and the frozen
model files it rebuilds:
  close        power de-vig of the mean decimal price of the US sportsbooks in market_vault `books` (exchanges absent),
               checked against p_power_close and against data/raw/odds/bfo_event_lines.csv / bfo_fighter_lines.csv
  open         multiplicative de-vig of market_vault `open` (American)
  Elo          1 / (1 + 10^((eloB - eloA) / 400)) on backtest_vault pre-fight Elo
  ML v2 LR     its own evaluation of the 81 antisymmetric terms (ml2.json page_model term definitions, src/ml/ml2.js
               semantics) on the raw A_/B_ side columns of the vault feature table; production = page_model coefficients
               (fit 2010-2025), static = fit.pkl lr|static (fit 2010-2023)
  ML v2 stacks forward_models.json ml2_static (2019-2023) and ml2.json page_model.stack (2019-2025): logit-linear, no
               intercept, pclip 0.01, missing market rating -> logit 0
  stacks       blindtest_stack.json `model` / `model_open` (present / absent blocks) and moe_page.json `model` (absent):
               its own linear-pattern evaluation (exact availability pattern, else largest contained), temperature on
               the absent block; feat_lr expert re-implemented here from moe_page.json `feat` (src/ml/moe.js semantics)
  engines      pA and the 7-bin cells from evalv per-fight outputs (rerun for this recomputation into --engines)
Scoring: decisive fights only for winner metrics; log loss, Brier, accuracy; calibration slope = no-intercept logistic slope
of the outcome on logit p (mirroring both corner orders gives the same root); 2,000 event-cluster (card) resamples with its
own seed; paired differences on the same draws; percentile CIs. Drift rule 6.5.1(a): switch iff point < 1.15 and the 95% CI
includes 1. Output: <vault>/audit1/recompute/recompute_audit1.json (+ printed tables). Never writes inside the repository.
"""
import argparse, csv, datetime as dt, json, math, os, pickle, re, sys, unicodedata
from collections import defaultdict
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
ap.add_argument("--engines", default=None, help="dir holding evalv/<v>_vault.json (default <vault>/audit1/recompute/vroot/audit1)")
ap.add_argument("--boot", type=int, default=2000)
ap.add_argument("--seed", type=int, default=4242)
a = ap.parse_args()
AUD = os.path.join(a.vault, "audit1")
OUT = os.path.join(AUD, "recompute")
os.makedirs(OUT, exist_ok=True)
ENGD = a.engines or os.path.join(OUT, "vroot", "audit1")
J = lambda p: json.load(open(p))
R = lambda rel: J(os.path.join(ROOT, rel))

BT = J(os.path.join(a.vault, "backtest_vault.json"))
FIGHTS = BT["fights"]
MV = J(os.path.join(a.vault, "market_vault.json"))["fights"]
MLV = J(os.path.join(a.vault, "ml_vault.json"))["fights"]
ids = [f["id"] for f in FIGHTS]
n = len(ids)
pos = {f: i for i, f in enumerate(ids)}
chk = {}                                     # every check this script makes, written to the output

# ------------------------------------------------------------------ outcomes, cards
win = np.array([{"A": 1.0, "B": 0.0}.get(f["result"]["winner"], np.nan) for f in FIGHTS])
dec = np.isfinite(win)
cards = sorted({(f["date"], f["event"]) for f in FIGHTS})
cidx = np.array([cards.index((f["date"], f["event"])) for f in FIGHTS])
G = len(cards)
chk["vault"] = {"fights": n, "unique_ids": len(set(ids)), "decisive": int(dec.sum()), "cards": G,
                "winner_counts": {k: sum(f["result"]["winner"] == k for f in FIGHTS) for k in ("A", "B", "D", "NC")},
                "dates": [min(f["date"] for f in FIGHTS), max(f["date"] for f in FIGHTS)]}


# ------------------------------------------------------------------ helpers
def lg(p, c=1e-6):
    p = min(max(p, c), 1 - c)
    return math.log(p / (1 - p))


def sg(z):
    return 1.0 / (1.0 + math.exp(-z))


def dec_odds(am):
    am = float(am)
    return 1 + am / 100.0 if am > 0 else 1 + 100.0 / abs(am)


def power_devig(da, db):
    qa, qb = 1.0 / da, 1.0 / db
    lo, hi = 0.5, 3.0
    for _ in range(100):
        k = 0.5 * (lo + hi)
        if qa ** k + qb ** k > 1:
            lo = k
        else:
            hi = k
    k = 0.5 * (lo + hi)
    return qa ** k / (qa ** k + qb ** k)


def mult_devig(da, db):
    qa, qb = 1.0 / da, 1.0 / db
    return qa / (qa + qb)


# ------------------------------------------------------------------ 1. market: close / open from raw fields
EXCH = {"Kalshi", "Polymarket"}


def consensus(books, max_dev=0.15):
    """the frozen close definition (tools/market.py book_consensus, re-implemented): sportsbooks only; a book is dropped if
    its overround is outside 0.98-1.25 or its no-vig p is more than 0.15 from the median book's (stale / in-play quotes);
    returns the mean decimal price per side of the kept books and the dropped books"""
    d = []
    for k, (qa, qb) in books.items():
        if k in EXCH or not qa or not qb:
            continue
        x = (dec_odds(qa), dec_odds(qb))
        if not (0.98 <= 1 / x[0] + 1 / x[1] <= 1.25):
            continue
        d.append((k, x, mult_devig(*x)))
    if not d:
        return None, []
    med = float(np.median([t[2] for t in d]))
    keep = [t for t in d if abs(t[2] - med) <= max_dev]
    return (float(np.mean([t[1][0] for t in keep])), float(np.mean([t[1][1] for t in keep]))), [t[0] for t in d if t not in keep]


close, close_mult, opn = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
mk_diff, mk_diff_mult, mk_diff_open, src_count, dropped = [], [], [], defaultdict(int), []
for i, fid in enumerate(ids):
    m = MV[fid]
    src_count[m.get("src")] += 1
    md, drop = consensus(m.get("books") or {})
    if drop:
        dropped.append({"id": fid, "dropped": drop, "quotes": {k: m["books"][k] for k in drop}})
    if md is None or m.get("src") != "bfo_books":
        # no per-book quotes (closing-range midpoint) or BFO's own mean over more books than were stored: the stored
        # mean decimal close (market.py), de-vigged here
        md = tuple(m["close_dec"]) if m.get("close_dec") else (dec_odds(m["close"][0]), dec_odds(m["close"][1]))
    close[i], close_mult[i] = power_devig(*md), mult_devig(*md)
    opn[i] = mult_devig(dec_odds(m["open"][0]), dec_odds(m["open"][1]))
    mk_diff.append(abs(close[i] - m["p_power_close"]))
    mk_diff_mult.append(abs(close_mult[i] - m["p_novig_close"]))
    mk_diff_open.append(abs(opn[i] - m["p_novig_open"]))
chk["market_rebuild"] = {"sources": dict(src_count), "max_abs_vs_p_power_close": max(mk_diff),
                         "max_abs_vs_p_novig_close": max(mk_diff_mult), "max_abs_vs_p_novig_open": max(mk_diff_open),
                         "exchange_books_in_close": sum(1 for f in ids for k in (MV[f].get("books") or {}) if k in EXCH),
                         "books_dropped_by_consensus_rule": dropped}


def norm_name(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().replace("-", " ")
    return re.sub(r"[^a-z ]", "", s).split()


def overlap(x, y):
    return len(set(norm_name(x)) & set(norm_name(y)))


def best_row(rows_by_name, nm, other):
    """the fighter-page row owned by `nm` (token overlap with nm minus overlap with the opponent; ties -> None)"""
    sc = sorted(((overlap(k, nm) - overlap(k, other), k) for k in rows_by_name), reverse=True)
    if not sc or sc[0][0] <= 0 or (len(sc) > 1 and sc[1][0] == sc[0][0]):
        return None
    return rows_by_name[sc[0][1]]


# raw BFO event-page lines (per book, t1/t2 orientation) and fighter-page closing ranges
raw = defaultdict(dict)
with open(os.path.join(ROOT, "data/raw/odds/bfo_event_lines.csv")) as fh:
    for r in csv.DictReader(fh):
        if r["date"] >= "2026-01-01" and r["book"] and r["mu"]:
            raw[int(r["mu"])][r["book"]] = (r["t1_name"], r["t2_name"], r["a1"], r["a2"])
rng_ = {}
with open(os.path.join(ROOT, "data/raw/odds/bfo_fighter_lines.csv")) as fh:
    for r in csv.DictReader(fh):
        if r["date"] >= "2026-01-01" and r["mu"]:
            rng_.setdefault(int(r["mu"]), {})[r["owner_name"]] = r
raw_ok, raw_mis, raw_none, outside, extreme, exch_post = 0, [], [], [], [], []
spark_gap = []
for i, fid in enumerate(ids):
    m, f = MV[fid], FIGHTS[i]
    mu = (m.get("bfo") or {}).get("matchup")
    books = m.get("books") or {}
    if mu is None or mu not in raw:
        raw_none.append(fid)
        continue
    rows = raw[mu]
    nA_, nB_ = f["A"]["name"], f["B"]["name"]
    for bk, (t1, t2, a1, a2) in rows.items():
        if bk in EXCH:
            continue
        flip = (overlap(t1, nB_) + overlap(t2, nA_)) > (overlap(t1, nA_) + overlap(t2, nB_))
        qa, qb = (a2, a1) if flip else (a1, a2)
        if bk in books:
            if [int(float(qa)), int(float(qb))] == [int(books[bk][0]), int(books[bk][1])]:
                raw_ok += 1
            else:
                raw_mis.append((fid, bk, (qa, qb), books[bk]))
    for bk, (t1, t2, a1, a2) in rows.items():   # exchanges: record post-result-looking prices (excluded anyway)
        if bk in EXCH and a1 and a2 and max(abs(float(a1)), abs(float(a2))) >= 2000:
            exch_post.append((fid, bk, a1, a2))
    for bk, v in books.items():
        if max(abs(v[0]), abs(v[1])) >= 2000:
            extreme.append((fid, bk, v))
    fr = rng_.get(mu, {})
    keep_books = {k: v for k, v in books.items() if k not in [d_ for x in dropped if x["id"] == fid for d_ in x["dropped"]]}
    for side, nm, ot in (("A", nA_, nB_), ("B", nB_, nA_)):
        r = best_row(fr, nm, ot)
        if not r:
            continue
        lo, hi = sorted([float(r["lo1"]), float(r["hi1"])], key=lambda x: dec_odds(x))
        for bk, v in keep_books.items():
            q = v[0] if side == "A" else v[1]
            if not (dec_odds(lo) - 1e-9 <= dec_odds(q) <= dec_odds(hi) + 1e-9):
                outside.append((fid, side, bk, q, (r["lo1"], r["hi1"])))
        sp = [float(x) for x in r["spark"].split(";") if x]
        if sp and keep_books:
            dmean = float(np.mean([dec_odds(v[0] if side == "A" else v[1]) for v in keep_books.values()]))
            spark_gap.append(abs(1 / sp[-1] - 1 / dmean))
chk["close_vs_raw_bfo"] = {"book_quotes_matching_raw_csv": raw_ok, "mismatches": raw_mis[:10], "n_mismatch": len(raw_mis),
                           "fights_without_raw_rows": raw_none,
                           "book_prices_outside_fighter_page_closing_range": len(outside), "outside_examples": outside[:6],
                           "sportsbook_prices_beyond_2000": extreme,
                           "exchange_quotes_beyond_2000_on_raw_pages_(excluded)": len(exch_post),
                           "sparkline_last_vs_book_mean_implied_prob": {"n": len(spark_gap),
                                                                         "median_abs": float(np.median(spark_gap)),
                                                                         "p95_abs": float(np.percentile(spark_gap, 95)),
                                                                         "max_abs": float(np.max(spark_gap)),
                                                                         "n_over_0.05": int(np.sum(np.array(spark_gap) > 0.05))}}

# opener sanity: openers whose favourite flips against BOTH the BFO sparkline's second point and the close (reversed openers)
flip_open = []
for i, fid in enumerate(ids):
    m, f = MV[fid], FIGHTS[i]
    mu = (m.get("bfo") or {}).get("matchup")
    fr = rng_.get(mu, {}) if mu else {}
    r = best_row(fr, f["A"]["name"], f["B"]["name"])
    if not r:
        continue
    sp = [float(x) for x in r["spark"].split(";") if x]
    if len(sp) >= 3 and abs(lg(opn[i]) - lg(close[i])) > 2.0:
        p2 = 1 / sp[1]
        flip_open.append({"id": fid, "A": f["A"]["name"], "B": f["B"]["name"], "open_pA": round(opn[i], 4),
                          "spark_first_pA_raw": round(1 / sp[0], 4), "spark_second_pA_raw": round(p2, 4), "close_pA": round(close[i], 4),
                          "winner": f["result"]["winner"]})
chk["reversed_opener_suspects"] = flip_open

# ------------------------------------------------------------------ 2. Elo, ML v1, mkt rating, elo_sig, ratings
elo = np.array([1 / (1 + 10 ** ((f["B"]["elo"] - f["A"]["elo"]) / 400.0)) for f in FIGHTS])
ml_lr = np.array([MLV[f]["lr_refit"] for f in ids], float)
ml_lr23 = np.array([MLV[f]["lr"] for f in ids], float)
elo_sig = np.array([MLV[f]["elo_sig"] for f in ids], float)
mkt_rating = np.array([MV[f].get("p_market_rating", np.nan) if MV[f].get("p_market_rating") is not None else np.nan for f in ids], float)
chk["elo_vs_ml_vault_elo_max_abs"] = float(np.max(np.abs(elo - np.array([MLV[f]["elo"] for f in ids]))))

# ------------------------------------------------------------------ 3. ML v2 logistic: own term evaluation on the vault table
import pandas as pd  # noqa: E402

TB = pickle.load(open(os.path.join(AUD, "ml2_cache", "table_vault.pkl"), "rb"))["T"]
TB = TB[TB["fid"].isin(set(ids))].set_index("fid").loc[ids]
PM = R("data/derived/ml2.json")["page_model"]
terms = PM["terms"]
CV = J(os.path.join(ROOT, "out", "ml2_cache", "cv.json"))
FIT = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "fit.pkl"), "rb"))
cols = CV["lr"]["cols"]
c_static = dict(zip(cols, np.asarray(FIT["coefs"]["lr|static"], float)))
assert set(cols) == {t["name"] for t in terms}, "static column set differs from the page model terms"


def missing(x):
    return x is None or (isinstance(x, float) and not math.isfinite(x))


def term_value(t, A, B, row):
    ty = t["type"]
    if ty == "logr":
        return math.log(A[t["key"]] + t["eps"]) - math.log(B[t["key"]] + t["eps"])
    if ty == "logit":
        return lg(A[t["key"]], 1e-4) - lg(B[t["key"]], 1e-4)
    if ty == "lin":
        x, y = A[t["key"]], B[t["key"]]
        return 0.0 if (missing(x) or missing(y)) else (x - y) * t["scale"]
    if ty == "hinge":
        x, y = A[t["key"]], B[t["key"]]
        return 0.0 if (missing(x) or missing(y)) else max(x - t["h"], 0) - max(y - t["h"], 0)
    if ty == "flag":
        x, y = A[t["key"]], B[t["key"]]
        return 0.0 if (missing(x) or missing(y)) else float(x > t["t"]) - float(y > t["t"])
    if ty == "share":
        ea, eb = A[t["u"]] * B[t["v"]], B[t["u"]] * A[t["v"]]
        return 0.5 * (ea - eb) / (ea + eb + 1e-12)
    if ty == "stance":
        g = lambda S, k: 0.0 if missing(S.get(k)) else S[k]
        return g(A, "southpaw") * g(B, "orthodox") - g(B, "southpaw") * g(A, "orthodox")
    if ty == "rating":
        return lg(row["r_" + t["sys"]], 1e-3)
    if ty == "mr":
        v = row["mr_p"]
        return 0.0 if missing(v) else lg(v, 1e-3)
    raise ValueError(ty)


def sides(row):
    A, B = {}, {}
    for c, v in row.items():
        if c.startswith("A_"):
            A[c[2:]] = None if (isinstance(v, float) and not math.isfinite(v)) else v
        elif c.startswith("B_"):
            B[c[2:]] = None if (isinstance(v, float) and not math.isfinite(v)) else v
    return A, B


ml2_prod, ml2_static, mr_ml2 = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
ml2_flip_dev = 0.0
for i, fid in enumerate(ids):
    row = TB.loc[fid].to_dict()
    A, B = sides(row)
    x = {t["name"]: term_value(t, A, B, row) for t in terms}
    zp = sum(t["coef"] * x[t["name"]] for t in terms)
    zs = sum(c_static[k] * x[k] for k in cols)
    ml2_prod[i], ml2_static[i] = sg(zp), sg(zs)
    mr_ml2[i] = row["mr_p"] if math.isfinite(row["mr_p"]) else np.nan
    # corner swap: swapped sides and P(A) -> 1 - P(A) for the rating / market-rating columns
    row2 = dict(row)
    for k in [c for c in row if c.startswith("r_")] + ["mr_p"]:
        if math.isfinite(row[k]):
            row2[k] = 1 - row[k]
    x2 = {t["name"]: term_value(t, B, A, row2) for t in terms}
    zp2 = sum(t["coef"] * x2[t["name"]] for t in terms)
    ml2_flip_dev = max(ml2_flip_dev, abs(zp + zp2))
M2V = J(os.path.join(AUD, "ml2_vault.json"))["fights"]
chk["ml2_lr_own_eval"] = {
    "prod_max_abs_vs_auditor": float(np.nanmax(np.abs(ml2_prod - np.array([M2V[f]["ml2_lr_prod"] for f in ids])))),
    "static_max_abs_vs_auditor": float(np.nanmax(np.abs(ml2_static - np.array([M2V[f]["ml2_lr_static"] for f in ids])))),
    "corner_swap_max_abs_logit_sum": ml2_flip_dev,
    "page_model_train": PM["train"], "page_model_n_train": PM["n_train"], "page_model_snapshot_of_roster_only": PM["snapshot"],
    "mr_vs_market_vault_p_market_rating_max_abs": float(np.nanmax(np.abs(mr_ml2 - mkt_rating))),
}
# walk-forward sanity of the vault feature rows: UFC fight counts and Elo equal the backtest's pre-fight values
nA_t = TB["A_n"].to_numpy(float)
nA_b = np.array([f["A"]["n"] for f in FIGHTS], float)
eA_t = TB["A_elo"].to_numpy(float)
eA_b = np.array([f["A"]["elo"] for f in FIGHTS], float)
chk["ml2_table_walkforward"] = {"A_n_equals_backtest_n_share": float(np.mean(nA_t == nA_b)),
                                "A_n_max_abs_diff": float(np.max(np.abs(nA_t - nA_b))),
                                "A_elo_max_abs_diff_vs_backtest": float(np.nanmax(np.abs(eA_t - eA_b))),
                                "max_feature_row_date": str(TB["date"].max())}

# ------------------------------------------------------------------ 4. ML v2 stacks (own evaluation)
FM = R("data/derived/forward_models.json")["ml2_static"]
PS = PM["stack"]


def stack(st, inp):
    z = 0.0
    for k, w in zip(st["inputs"], st["weights"]):
        p = inp.get(k)
        if p is None or not math.isfinite(p):
            if k in ("market", "open"):
                return np.nan
            continue                                  # missing market rating enters as logit 0
        z += w * lg(p, st["pclip"])
    return sg(z)


S2 = {}
for nm, st, lrv in (("static", FM, ml2_prod), ("static_static", FM, ml2_static), ("prod", PS, ml2_prod)):
    for rk, sk in (("close", "line"), ("open", "open"), ("noline", "noline")):
        S2["ml2_stack_%s_%s" % (rk, nm)] = np.array([stack(st[sk], {"market": close[i], "open": opn[i], "ml2lr": lrv[i],
                                                                     "mkt_rating": mr_ml2[i]}) for i in range(n)])
# sensitivity: market_vault p_market_rating (tools/market.py) instead of ML v2's own market-rating column
S2_mv = np.array([stack(FM["noline"], {"ml2lr": ml2_prod[i], "mkt_rating": mkt_rating[i]}) for i in range(n)])

# ------------------------------------------------------------------ 5. feat_lr expert (own re-implementation of moe.js featLR)
MP = R("data/derived/moe_page.json")
FEAT = MP["feat"]
SIDES = J(os.path.join(AUD, "sides_vault.json"))["fights"]
assert FEAT["keys"] == BT["meta"]["keys"]
LBS = {"Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
       "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
       "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145}


def fnum(x):
    return float("nan") if (x is None or not math.isfinite(float(x))) else float(x)


def side_feats(s, P):
    S = {k: float(s["S"][i] or 0) for i, k in enumerate(FEAT["keys"])}
    pr = lambda k: float(P[k]) if P.get(k) is not None else 0.0
    o = {k: fnum(s.get(k)) for k in ("age", "height_in", "reach_in", "n", "ko_losses", "kd_absorbed", "elo", "cmin", "w", "l",
                                       "streak", "last3", "n5", "fin_w", "fin_l", "layoff")}
    o["layoff"] = math.log1p(min(o["layoff"], 2000)) if math.isfinite(o["layoff"]) else float("nan")
    o["cmin"] = math.log1p(o["cmin"]) if math.isfinite(o["cmin"]) else float("nan")
    o["n_log"] = math.log1p(o["n"])
    m = S["min"]
    o["dmin"], o["dn"] = math.log1p(m), S["n"]
    for name, ks, c in FEAT["rate_defs"]:
        o[name] = (sum(S[k] for k in ks) + c * sum(pr(k) for k in ks)) / (m + c)
    for name, lk, ak, c, inv in FEAT["acc_defs"]:
        l_, a_ = sum(S[k] for k in lk), sum(S[k] for k in ak)
        pl, pa = sum(pr(k) for k in lk), sum(pr(k) for k in ak)
        p0 = pl / pa if pa > 0 else 0.4
        acc = (l_ + c * p0) / (a_ + c)
        o[name] = 1 - acc if inv else acc
    nf, wins = S["n"], S["ko_w"] + S["sub_w"] + S["dec_w"]
    o["winr"] = (wins + 1) / (nf + 2)
    for k in ("ko_w", "sub_w", "dec_w", "ko_l", "sub_l", "dec_l"):
        o[k + "_r"] = (S[k] + 0.25) / (nf + 1.5)
    o["wl_c"] = (o["w"] + 1) / (o["w"] + o["l"] + 2)
    o["fin_wr"] = (o["fin_w"] + 0.5) / (o["w"] + o["l"] + 2)
    o["fin_lr"] = (o["fin_l"] + 0.5) / (o["w"] + o["l"] + 2)
    o["diff_sl"] = o["slpm"] - o["sapm"]
    o["southpaw"] = 1.0 if s.get("stance") == "Southpaw" else 0.0
    o["switch"] = 1.0 if s.get("stance") == "Switch" else 0.0
    o["streak6"] = max(-6, min(6, o["streak"])) if math.isfinite(o["streak"]) else 0.0
    return [o.get(k, float("nan")) for k in FEAT["names"]]


def feat_lr_p(f):
    div = f["division"]
    if div not in LBS:
        homes = [h for h in (f["A"].get("home"), f["B"].get("home")) if h in LBS]
        if homes:
            div = max(homes, key=lambda h: LBS[h])
    P = FEAT["priors"].get(div) or FEAT["priors"]["ALL"]
    out = []
    for t in ("A", "B"):
        s, c = f[t], SIDES[f["id"]][t]
        rec = {"S": s["S"], "age": s.get("age"), "height_in": s.get("height_in"), "reach_in": s.get("reach_in"), "n": s.get("n"),
               "ko_losses": s.get("ko_losses"), "kd_absorbed": s.get("kd_absorbed"), "elo": s.get("elo"), "stance": s.get("stance"),
               "cmin": c.get("cmin"), "w": c.get("w"), "l": c.get("l"), "streak": c.get("streak"), "last3": c.get("last3"),
               "n5": c.get("n5"), "fin_w": c.get("fin_w"), "fin_l": c.get("fin_l"), "layoff": c.get("layoff")}
        out.append(side_feats(rec, P))
    z = 0.0
    for cf, xa, xb in zip(FEAT["coef"], out[0], out[1]):
        d = xa - xb
        if math.isfinite(d):
            z += cf * d
    return sg(z)


feat_lr = np.array([feat_lr_p(f) for f in FIGHTS])

# ------------------------------------------------------------------ 6. engines (rerun evalv outputs)
ENG, B7, CELLS = {}, {}, {}
for v in ("v4", "v5", "v5.0.1"):
    E = J(os.path.join(ENGD, "evalv", v + "_vault.json"))
    d = {x["id"]: x for x in E["fights"]}
    ENG[v] = np.array([d[f]["pA"] for f in ids], float)
    B7[v] = np.array([d[f]["b7"] for f in ids], float)
    chk.setdefault("engine_meta", {})[v] = {"engine_sha256_16": E["meta"]["engine_sha256"][:16],
                                            "params_sha256_16": E["meta"]["params_sha256"][:16],
                                            "sims_per_order": E["meta"]["sims_per_order"], "seed": E["meta"]["seed"],
                                            "n_fights": E["meta"]["n_fights"]}

# ------------------------------------------------------------------ 7. production stacks (own linear-pattern evaluation)
STK = R("data/derived/blindtest_stack.json")


def moe_linear(block, experts):
    E, pc = block["experts"], block["pclip"]
    used = [e for e in E if e in experts and experts[e] is not None and math.isfinite(experts[e]) and 0 <= experts[e] <= 1]
    key = "+".join(used)
    w = block["linear"].get(key)
    if w is None:
        best = None
        for kk in block["linear"]:
            parts = kk.split("+")
            if all(p in used for p in parts) and (best is None or len(parts) > len(best)):
                best = parts
        w = block["linear"]["+".join(best)]
    z = sum(wk * lg(min(max(experts[k], pc), 1 - pc)) for k, wk in w.items())
    p = sg(z)
    cal = block.get("calibration") or {}
    if cal.get("type") == "temperature":
        p = sg(cal["a"] * lg(p))
    elif cal.get("type") not in (None, "none"):
        raise ValueError(cal)
    return p, "+".join(w.keys())


stk_close, stk_open, stk_noline, moe_noline = (np.full(n, np.nan) for _ in range(4))
pattern_counts = defaultdict(int)
for i in range(n):
    ex = {"mkt_rating": mkt_rating[i], "engine": ENG["v4"][i], "ml": ml_lr[i], "feat_lr": feat_lr[i], "elo_sig": elo_sig[i], "elo": elo[i]}
    stk_noline[i], pat = moe_linear(STK["model"]["absent"], ex)
    pattern_counts["noline:" + pat] += 1
    moe_noline[i], _ = moe_linear(MP["model"]["absent"], ex)
    stk_close[i], pat = moe_linear(STK["model"]["present"], dict(ex, market=close[i]))
    pattern_counts["close:" + pat] += 1
    stk_open[i], _ = moe_linear(STK["model_open"]["present"], dict(ex, market=opn[i]))
# corner symmetry of the stack evaluation (swap every expert p -> 1 - p)
sym = 0.0
for i in range(n):
    ex = {"mkt_rating": mkt_rating[i], "engine": ENG["v4"][i], "ml": ml_lr[i], "feat_lr": feat_lr[i], "elo_sig": elo_sig[i], "elo": elo[i]}
    exs = {k: 1 - v for k, v in ex.items()}
    sym = max(sym, abs(moe_linear(STK["model"]["absent"], ex)[0] + moe_linear(STK["model"]["absent"], exs)[0] - 1),
              abs(moe_linear(STK["model"]["present"], dict(ex, market=close[i]))[0]
                  + moe_linear(STK["model"]["present"], dict(exs, market=1 - close[i]))[0] - 1))
chk["stacks"] = {"patterns_used": dict(pattern_counts), "corner_swap_max_abs_p_plus_pswap_minus_1": sym,
                 "fit_through": {k: v.get("fit_through") for k, v in STK["meta"]["fit_info"].items()},
                 "noline_temperature": STK["model"]["absent"]["calibration"], "moe_page_temperature": MP["model"]["absent"]["calibration"]}

# ------------------------------------------------------------------ compare every rebuilt input with the auditor's per-fight file
MVA = J(os.path.join(AUD, "models_vault.json"))["fights"]
mine = {"close": close, "close_mult": close_mult, "open": opn, "elo": elo, "ml_lr": ml_lr, "ml_lr_2023": ml_lr23, "elo_sig": elo_sig,
        "mkt_rating": mkt_rating, "feat_lr": feat_lr, "engine_v4": ENG["v4"], "ml2_lr": ml2_prod, "ml2_lr_static": ml2_static,
        "stack_close": stk_close, "stack_open": stk_open, "stack_noline": stk_noline, "moe_page_noline": moe_noline}
mine.update(S2)
cmp_ = {}
for k, arr in mine.items():
    ref = np.array([MVA[f].get(k) if MVA[f].get(k) is not None else np.nan for f in ids], float)
    cmp_[k] = float(np.nanmax(np.abs(arr - ref)))
chk["max_abs_vs_auditor_models_vault"] = cmp_

# ------------------------------------------------------------------ 8. scoring with its own bootstrap
rs = np.random.default_rng(a.seed)
draw = rs.integers(0, G, size=(a.boot, G))
W = np.zeros((a.boot, n))
members = [np.flatnonzero(cidx == g) for g in range(G)]
for b in range(a.boot):
    cnt = np.bincount(draw[b], minlength=G)
    for g in np.flatnonzero(cnt):
        W[b, members[g]] = cnt[g]


def pct(v):
    v = v[np.isfinite(v)]
    return [float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))]


def wmean(L):
    m = np.isfinite(L)
    Lz = np.where(m, L, 0.0)
    return float(Lz[m].mean()), pct((W @ Lz) / np.maximum(W @ m, 1e-12)), int(m.sum())


def slope(x, y, w):
    Wm = np.atleast_2d(w).astype(float)
    beta = np.ones(Wm.shape[0])
    for _ in range(60):
        q = 1 / (1 + np.exp(-beta[:, None] * x[None, :]))
        g = (Wm * (y - q) * x).sum(1)
        h = (Wm * q * (1 - q) * x * x).sum(1)
        step = g / np.maximum(h, 1e-12)
        beta = beta + step
        if np.max(np.abs(step)) < 1e-12:
            break
    return beta


P = dict(mine)
P.update({"engine_v5": ENG["v5"], "engine_v5.0.1": ENG["v5.0.1"]})
LL, res = {}, {}
for k, p in P.items():
    m = dec & np.isfinite(p)
    pc = np.clip(p, 1e-6, 1 - 1e-6)
    ll = np.where(m, -(win * np.log(pc) + (1 - win) * np.log(1 - pc)), np.nan)
    br = np.where(m, (pc - win) ** 2, np.nan)
    ac = np.where(m, np.where(np.abs(pc - 0.5) < 1e-12, 0.5, ((pc > 0.5) == (win == 1)).astype(float)), np.nan)
    LL[k] = ll
    x = np.where(m, np.log(pc / (1 - pc)), 0.0)
    y = np.where(m, win, 0.0)
    e = {"n": int(m.sum())}
    for nm, L in (("log_loss", ll), ("brier", br), ("accuracy", ac)):
        est, ci, _ = wmean(L)
        e[nm] = {"est": est, "ci": ci}
    # mirrored no-intercept slope: stack (x, y) with (-x, 1 - y); the root is the same as the one-orientation fit
    xm, ym, mm = np.r_[x, -x], np.r_[y, 1 - y], np.r_[m, m].astype(float)
    e["slope"] = {"est": float(slope(xm, ym, mm)[0]), "ci": pct(slope(xm, ym, np.c_[W, W] * mm[None, :]))}
    res[k] = e


def paired(a_, b_):
    d = LL[a_] - LL[b_]
    est, ci, nn = wmean(d)
    return {"diff": est, "ci": ci, "n": nn}


PAIRS = [("engine_v5", "engine_v4"), ("engine_v5.0.1", "engine_v4"), ("stack_close", "close"), ("ml2_stack_close_static", "close"),
         ("ml2_stack_close_prod", "close"), ("stack_open", "open"), ("ml2_stack_open_static", "open"),
         ("ml2_stack_open_static", "stack_open"), ("ml2_stack_noline_static", "stack_noline"), ("ml2_stack_noline_prod", "stack_noline"),
         ("stack_noline", "ml2_lr"), ("stack_noline", "close"), ("open", "close"), ("ml2_lr", "close"), ("ml2_lr", "ml_lr"),
         ("ml2_lr", "elo"), ("engine_v4", "elo"), ("engine_v4", "ml2_lr"), ("engine_v4", "close")]
pairs = {"%s - %s" % p: paired(*p) for p in PAIRS}

# 7-bin (A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO) from the engines' stored b7, every fight with an outcome
BIN = {("A", "KO"): 0, ("A", "DOC"): 0, ("A", "SUB"): 1, ("A", "UD"): 2, ("A", "SD"): 2, ("A", "MD"): 2,
       ("B", "UD"): 4, ("B", "SD"): 4, ("B", "MD"): 4, ("B", "SUB"): 5, ("B", "KO"): 6, ("B", "DOC"): 6}
ybin = np.array([3 if f["result"]["winner"] == "D" else BIN.get((f["result"]["winner"], f["result"]["method"]), -1) for f in FIGHTS])
okb = ybin >= 0
L7 = {}
for v in B7:
    pb = B7[v] / B7[v].sum(1, keepdims=True)
    L7[v] = np.where(okb, -np.log(np.maximum(pb[np.arange(n), np.maximum(ybin, 0)], 1e-12)), np.nan)
bin7 = {v: dict(zip(("est", "ci", "n"), wmean(L7[v]))) for v in L7}
for v in ("v5", "v5.0.1"):
    est, ci, nn = wmean(L7[v] - L7["v4"])
    bin7[v + " - v4"] = {"diff": est, "ci": ci, "n": nn}


def rule(k):
    s = res[k]["slope"]
    lo, hi = s["ci"]
    fire = s["est"] < 1.15 and lo <= 1.0 <= hi
    br = ("persists" if (lo > 1 and s["est"] >= 1.2) else "reverts" if fire else "inconclusive")
    return {"column": k, "slope": s["est"], "ci": s["ci"], "switch_to_h3_T1": bool(fire), "plan_4_2_branch": br}


drift = {"primary": rule("stack_noline"), "secondary": [rule(k) for k in ("ml2_stack_noline_prod", "moe_page_noline", "ml2_stack_noline_static")]}
sens = {"ml2_stack_noline_static_with_market_vault_mr": {"max_abs_vs_ml2_mr": float(np.nanmax(np.abs(S2_mv - S2["ml2_stack_noline_static"])))}}

out = {"meta": {"tool": "tools/vault_audit1/recompute_audit1.py", "built": dt.datetime.now(dt.timezone.utc).isoformat(),
                "boot": a.boot, "seed": a.seed, "engines_dir": ENGD, "ci": "percentile 2.5 / 97.5 of 2,000 card resamples"},
       "checks": chk, "winner": res, "paired": pairs, "bin7": bin7, "drift_rule_6_5_1a": drift, "sensitivity": sens}
json.dump(out, open(os.path.join(OUT, "recompute_audit1.json"), "w"), indent=1, default=float)

# ------------------------------------------------------------------ print
print(json.dumps(chk, indent=1, default=str)[:12000])
print("\n| model | n | log loss [95% CI] | Brier | acc | slope [95% CI] |")
for k, e in res.items():
    print("| %s | %d | %.4f [%.4f, %.4f] | %.4f | %.3f | %.3f [%.3f, %.3f] |" % (k, e["n"], e["log_loss"]["est"], *e["log_loss"]["ci"],
          e["brier"]["est"], e["accuracy"]["est"], e["slope"]["est"], *e["slope"]["ci"]))
print("\n| paired | diff [95% CI] |")
for k, e in pairs.items():
    print("| %s | %+.4f [%+.4f, %+.4f] |" % (k, e["diff"], *e["ci"]))
print("\n7-bin:", json.dumps(bin7))
print("\ndrift rule:", json.dumps(drift, indent=1))
print("sensitivity:", json.dumps(sens))
