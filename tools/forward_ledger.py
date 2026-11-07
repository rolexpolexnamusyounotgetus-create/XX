#!/usr/bin/env python3
"""Forward-test ledger: write-once predictions for an upcoming UFC card, and scoring once the results land.

Run from the project root (data/predictions/README.md has the rules this tool enforces):

    python3 tools/forward_ledger.py predict --event 2026-11-14            # writes data/predictions/<date>_<slug>.json
    python3 tools/forward_ledger.py predict --event "Gane vs. Hokit" --sims 3000
    python3 tools/forward_ledger.py predict --event 2026-11-14 --dry-run  # compute and print, write nothing
    python3 tools/forward_ledger.py predict --event 2026-11-14 --supersede   # a _v2 file before the lock (names the old one)
    python3 tools/forward_ledger.py score                                 # pull results for finished ledger events, rescore
    python3 tools/forward_ledger.py score --no-fetch                      # rescore from results.json only
    python3 tools/forward_ledger.py score --manual my_results.json        # append hand-entered results (ESPN, Sherdog...)
    python3 tools/forward_ledger.py status                                # ledger files, lock times, scored or not

predict
  - The card comes from data/predictions/cards_upcoming.json (every bout on it, whatever its status; debutants included
    and flagged). The lock is the card's earliest start_utc; predicting at or after the lock is refused.
  - The file name is <date>_<event-slug>.json; it is created with O_EXCL and made read-only, so an existing file is never
    overwritten. --supersede writes <date>_<event-slug>_v<N>.json (before the lock only) and records which file it
    replaces; the latest file created before the lock is the one scored.
  - Market: the newest odds snapshot (data/predictions/odds_snapshot_*.json from tools/odds_upcoming.py) taken before
    the lock. The ledger market block is the README benchmark (mean of BestFightOdds' books, multiplicative no-vig);
    the line the stack reads is the power de-vig of the mean decimal odds over every sportsbook (consensus
    p_meandec_power), the same construction as the closing line the stack was trained on (market.json p_power_close).
  - Model: the page's current package, evaluated in Node by tools/forward_ledger.js: the MoE stack (moe_page.json) over
    feat_lr, Elo, the ML page model, the market rating, the simulator (FightEngine.summarize with the learned stat-line
    rates, both corner orders) and, when present, the market line; method and round from the method-and-round model
    scaled to the stack's winner odds. p_a is the stack WITH the line captured at prediction time (this model version
    says so explicitly, as the README requires) and p_a_noline the same stack without it; both are scored.
    Debutants (not in fighters.json): the stack never saw a debut, so p_a falls back to the line and p_a_noline to Elo
    with a 1500 debut rating; method from division base rates. The bout is flagged.
  - Forward model v4.1 (data/predictions/README.md, "Forward model v4.1 (Nov 6, 2026)", pre-registered): every bout also
    carries a "models" block (tools/forward_ledger.js: the benchmark line, both MoE stacks with the line and without,
    the ML v2 logistic and its page stacks with weights fit 2019-2023 and with the page's production weights, whr_rounds,
    the ratings stack, Elo and the simulator), and p_a is the PRIMARY entry of that block (PRIMARY below: the ML v2 open
    stack fed the line captured at prediction time; FALLBACK when it cannot run). p_a_noline stays the MoE stack without
    the line. Debutants: Elo seeded from the pre-UFC record (data/predictions/debutants_*.json, else preufc.json
    roster_priors) replaces the 1500 fallback when a seed exists; the bout stays flagged.
score
  - Results: for every ledger event whose date has passed, fetches ufcstats results through the Greco1899/scrape_ufc_stats
    CSVs on raw.githubusercontent.com (saved under out/forward_results/, never into data/raw/) and ESPN's public
    scoreboard JSON as the second source; only bouts that are in a ledger file are matched and recorded. Appends new
    results to data/predictions/results.json (append-only; existing entries are never changed). --manual adds results
    typed in by hand in the same format.
  - Scores: every scored file vs the market at prediction time, the closing line (results.json closing_odds, else
    data/derived/odds_upcoming.json's last pre-start capture), walk-forward Elo and a coin: log loss, Brier, accuracy,
    paired differences with event-cluster bootstrap intervals (widened to the bout-level bootstrap where that is
    wider, so one or a few events never give a spuriously tight interval), running totals event by event, method
    (7-way) log loss and distance Brier; per model version. Writes data/predictions/scores.json and scores.md (regenerated each time).
  - Models block (v4.1 files on): every model in each bout's "models" block gets log loss, Brier and accuracy, and its
    paired log-loss difference vs the market at prediction time and vs the close (event-cluster bootstrap), per model
    version (scores.json "models").

Forward model v4.2 (data/predictions/README.md, "Forward model v4.2 (Nov 6-7, 2026)", pre-registered before this code)
  - --fwd auto (default) picks the version the README assigns to the event date: fwd-4.2 for events dated 2026-11-14 or
    later, fwd-4.1 before; writing a ledger file under any other version is refused (dry runs may use either). The
    fwd-4.1 path is byte-identical to tool 1.1 (tests/test_forward_v42.js).
  - fwd-4.2 reads only the pinned files of the README table (FWD42_PINNED below; refuses to write when one differs) and
    the frozen engine in versions/v4. Winner: unchanged. A bout with a debutant takes p_method / p_distance /
    p_finish_round from the debut method model (debut.json) fed p_a, with fwd-4.1's division-base-rate cells kept as
    p_method_secondary; models.debut_model is the monitored debut winner model. Every bout gets a "statlines" block
    (tools/forward_statlines.js: src/ml/statdist.js prod tables mixed over the primary method cells' length grid).
  - score: also scores the debut method against its base-rate secondary, and the stat-line block against ufcstats
    per-fight totals (Greco1899 ufc_fight_stats.csv), appended to data/predictions/statlines_results.json (append-only)
    for bouts whose two-source result is verified.

Forward model v4.3 (data/predictions/README.md, "Forward model v4.3 (Nov 7, 2026)", pre-registered before this code)
  - Supersedes fwd-4.2 for events dated 2026-11-14 or later: --fwd auto picks fwd-4.3 there (fwd-4.1 before); fwd-4.2
    stays a dry-run option. The fwd-4.1 and fwd-4.2 paths write exactly what the tool wrote before fwd-4.3 existed
    (tests/test_forward_v43.js; their files still say tool 1.1 / 1.2).
  - Everything fwd-4.2 writes, except: p_a_noline (bout without a debutant) = models.ml2_stack_noline, the ML v2 no-line
    stack with weights fit 2019-2023 (forward_models.json ml2_static.noline); the MoE no-line stack becomes the scored
    secondary models.moe_noline and is p_a_noline's fallback (flag noline_fallback); p_a_noline_source records which.
    A bout without a line therefore gets p_a = the ML v2 no-line stack. Debut bouts: unchanged (p_a_noline = seeded Elo).
  - Pinned inputs: FWD43_PINNED (fwd-4.2's table with src/ml/ml2.js and tools/methodround_model.js re-pinned).

Forward model v4.4 (data/predictions/README.md, "Forward model v4.4 (Nov 7, 2026)", pre-registered before this code)
  - Supersedes fwd-4.3 for events dated 2026-11-14 or later (--fwd auto); fwd-4.1 / 4.2 / 4.3 paths unchanged and still
    write tool 1.1 / 1.2 / 1.3 (tests/test_forward_v44.js, golden fixtures).
  - fwd-4.3's models, rules and columns exactly; the roster-level inputs come from data/derived/live/ (tools/live_refresh.py:
    fighters, market, ratings, ml, ml2, methodround) when tools/live_refresh.py check_live passes at prediction time,
    else every one falls back to fwd-4.3's pinned file (model.live_inputs.fallback, flag live_inputs_fallback on every
    bout). The manifest's path and sha256 and each live file's sha256 go into model.live_inputs.

Forward model v4.5 (data/predictions/README.md, "Forward model v4.5 (Nov 7, 2026)", pre-registered before this code)
  - Supersedes fwd-4.4 for events dated 2026-11-14 or later (--fwd auto); fwd-4.1 to 4.4 paths unchanged and still write
    tool 1.1 to 1.4 (tests/test_forward_v45.js, golden fixtures).
  - fwd-4.4 exactly (winner, live inputs and fallback, flags, debut handling, stat lines), except: a bout without a debutant
    whose props snapshot (the newest data/predictions/props_snapshot_*.json from tools/props.py capture taken before the
    lock) has method props takes p_method / p_distance / p_finish_round from PropsPool (src/ml/propspool.js on
    data/derived/props.json, production weights, round shapes from the cells, decision tilt 0; tools/forward_ledger.js
    --props-pool) fed p_a and fwd-4.4's cells, which stay the scored secondary p_method_secondary.fwd44_cells; a debut bout
    with method props records the debut-bout pool as the monitored secondary p_method_secondary.debut_props_pool. Every
    bout carries a props_pool record. propspool.js and props.json are pinned by full sha256 (FWD45_PINNED_FULL).
  - score: also scores each method secondary against its primary (scores.json "method_secondary").
"""
import argparse
import csv
import datetime as dt
import glob
import hashlib
import io
import json
import math
import os
import re
import subprocess
import tempfile
import unicodedata
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
PRED_DIR = os.path.join(ROOT, "data", "predictions")
FETCH_DIR = os.path.join(ROOT, "out", "forward_results")
GRECO = "https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=%s"
UA = "FightLabSim/1.0 (forward-ledger)"     # the project's fetch User-Agent (no browser string, no email)
DEBUT_ELO = 1500.0                        # tools/build_db.py start rating
TOOL = "tools/forward_ledger.py 1.1"     # the fwd-4.1 path writes this exact string (byte-identical files)
TOOL_42 = "tools/forward_ledger.py 1.2"  # tool version of fwd-4.2 files
TOOL_43 = "tools/forward_ledger.py 1.3"  # tool version of fwd-4.3 files
TOOL_44 = "tools/forward_ledger.py 1.4"  # tool version of fwd-4.4 files
TOOL_45 = "tools/forward_ledger.py 1.5"  # tool version of fwd-4.5 files
# Forward model v4.1 (pre-registered in data/predictions/README.md): p_a = the first of these models-block entries that
# exists for the bout, when a line was captured before the lock; the ML v2 open stack (weights fit 2019-2023 on opening
# lines) is the primary, the rest are fallbacks for a fighter missing from the ML v2 roster.
MODEL_VERSION = "fwd-4.1"
PRIMARY = "ml2_stack_open"
FALLBACK = ("stack_open", "stack_line")
MODEL_DEFS = {
    "market_novig": "benchmark: BestFightOdds mean line at prediction time, multiplicative no-vig (market.p_a_novig)",
    "stack_line": "MoE stack, close-trained weights (blindtest_stack.json model), fed the power de-vig consensus line "
                  "(fwd-1's p_a; = p_a_line)",
    "stack_open": "MoE stack, open-trained weights (blindtest_stack.json model_open), fed the multiplicative de-vig "
                  "consensus line",
    "stack_noline": "MoE stack without a line (blindtest_stack.json model, absent block; = p_a_noline when no debutant)",
    "ml2_lr": "ML v2 logistic page model (src/ml/ml2.js, ml2.json page_model, refit 2010-2025)",
    "ml2_stack_close": "ML v2 page line stack, weights fit 2019-2023 on closing lines (market 0.7733 + ML v2 0.3397; "
                       "forward_models.json), fed the power de-vig consensus line",
    "ml2_stack_open": "PRIMARY. ML v2 page open stack, weights fit 2019-2023 on opening lines (open 0.6596 + ML v2 "
                      "0.5825; forward_models.json), fed the multiplicative de-vig consensus line",
    "ml2_stack_noline": "ML v2 page no-line stack, weights fit 2019-2023 (ML v2 0.7049 + market rating 0.5526, h 1.5)",
    "ml2_stack_close_prod": "ml2_stack_close with the page's production weights (refit 2019-2025, ml2.json page_model.stack)",
    "ml2_stack_open_prod": "ml2_stack_open with the page's production weights (refit 2019-2025)",
    "ml2_stack_noline_prod": "ml2_stack_noline with the page's production weights (refit 2019-2025)",
    "whr_rounds": "round-level WHR, ratings.json current roster ratings (kappa 1.1)",
    "ratings_stack": "ratings.json rating stack: whr_rounds + glicko2 + dims, logit weights fit 2019-2023",
    "elo": "walk-forward Elo (fighters.json); a debutant gets 1500 + his pre-UFC seed (debutants_*.json, else "
           "preufc.json roster_priors), else 1500 (= p_elo)",
    "simulator": "engine (src/engine3.js) summarize, both corner orders, learned stat-line rates, draws removed",
}
LEDGER_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_([a-z0-9-]+?)(?:_v(\d+))?\.json$")

# ---- forward model v4.2 (data/predictions/README.md "Forward model v4.2 (Nov 6-7, 2026)")
# (first event date, version) as the README assigns them, later rows win; before the first: 4.1. fwd-4.3 (pre-registered
# Nov 7, 2026) supersedes fwd-4.2 from the same date, before any fwd-4.2 file was written.
FWD_EFFECTIVE = (("2026-11-14", "4.2"), ("2026-11-14", "4.3"), ("2026-11-14", "4.4"), ("2026-11-14", "4.5"))
MODEL_VERSION_42 = "fwd-4.2"
FWD42_ENGINE_DIR = "versions/v4"          # frozen engine 4.0.0 / params 4.0.0-selfcal-pre2024 (= Vegas 124's engine)
# the README table "Files and hashes fwd-4.2 reads" (sha256, first 16 hex); a different hash refuses a fwd-4.2 file
FWD42_PINNED = {
    "data/derived/fighters.json": "df4d868a2195fb4a", "data/derived/moe_page.json": "34a33d1837e9b912",
    "data/derived/ml.json": "444b7b1e62086cc1", "data/derived/market.json": "8edb0a6cc9c3ca4f",
    "data/derived/methodround.json": "b26b7e373367f346", "data/derived/mlrates.json": "6dec930e670f7c70",
    "data/derived/ml2.json": "0837826dbc05cd1f", "data/derived/forward_models.json": "20269ec7642c1db8",
    "data/derived/ratings.json": "5fc4f8a3be14051f", "data/derived/preufc.json": "30111c93e864dfe0",
    "data/derived/blindtest_stack.json": "ded17ce026bbff29", "data/derived/debut.json": "f6709d52292ccc83",
    "data/derived/statlines.json": "30c3a959a1a3ac2a", "data/derived/embed_model.json": "061d9fba48cc6633",
    "data/derived/oppadj.json": "c27c8c6de3733c59",
    "versions/v4/engine3.js": "6c661f68a4c41c1d", "versions/v4/params3.js": "e16a6481319f9b15",
    "versions/v4/ml/mlrates.js": "b563032dd9468f7b",
    "src/ml/moe.js": "ad1097b488bbb3ac", "src/ml/mlpage.js": "d4c72febf5c57666", "src/ml/ml2.js": "a840ae6ad9e6bcc3",
    "src/ml/debut.js": "e5bbc188f4cf42c9", "src/ml/statdist.js": "c7facbbc4b406be1", "src/ml/embed.js": "e3fa72fd6c0b140b",
    "tools/methodround_model.js": "60d90d231bb4300f",
}
FWD42_CODE = ("tools/forward_ledger.py", "tools/forward_ledger.js", "tools/forward_statlines.js")
STAT_KEYS = ("sig_lnd", "sig_att", "td_lnd", "td_att", "ctrl", "kd", "sub_att")
MODEL_DEFS_42 = dict(MODEL_DEFS, debut_model=(
    "monitored secondary (fwd-4.2): the no-line debut winner model (src/ml/debut.js winner(), data/derived/debut.json; "
    "16-column symmetric logistic refit 2012-2025) for a bout with a debutant; null otherwise; never the primary"))

# ---- forward model v4.3 (data/predictions/README.md "Forward model v4.3 (Nov 7, 2026)")
MODEL_VERSION_43 = "fwd-4.3"
# the README table "Files and hashes fwd-4.3 reads": fwd-4.2's, with the two evaluators that gained v6's additive code
# re-pinned (output-identical, checked before the pre-registration)
FWD43_PINNED = dict(FWD42_PINNED, **{"src/ml/ml2.js": "0b62c4462dd7a915", "tools/methodround_model.js": "fea58a2f9beff3ca"})
NOLINE_PRIMARY = "ml2_stack_noline"      # fwd-4.3: p_a_noline for a bout without a debutant
NOLINE_FALLBACK = "moe_noline"           # ... when the ML v2 no-line stack cannot run (flag noline_fallback)
MODEL_DEFS_43 = dict(
    MODEL_DEFS_42,
    stack_noline="MoE stack without a line (blindtest_stack.json model, absent block; h 1.5, temperature 1.1607); the "
                 "same number as moe_noline",
    ml2_stack_noline="NO-LINE PRIMARY (fwd-4.3; = p_a_noline when no debutant). ML v2 page no-line stack, weights fit "
                     "2019-2023 (ML v2 0.7049 + market rating 0.5526, h 1.5; forward_models.json ml2_static.noline)",
    moe_noline="scored secondary (fwd-4.3): the MoE stack without a line (= stack_noline), fwd-4.1 / fwd-4.2's p_a_noline "
               "on bouts without a debutant, and p_a_noline's fallback; the series drift rule 6.5.1(b) tracks beside "
               "p_a_noline")


# ---- forward model v4.4 (data/predictions/README.md "Forward model v4.4 (Nov 7, 2026)"): fwd-4.3 on live inputs
MODEL_VERSION_44 = "fwd-4.4"
FWD44_CODE = FWD42_CODE + ("tools/live_refresh.py",)

# ---- forward model v4.5 (data/predictions/README.md "Forward model v4.5 (Nov 7, 2026)"): fwd-4.4 + the props pool's method
# cells on bouts without a debutant whose props snapshot has method props
MODEL_VERSION_45 = "fwd-4.5"
FWD45_CODE = FWD44_CODE                  # forward_ledger.py, forward_ledger.js, forward_statlines.js, live_refresh.py
# README v4.5 item 8: the two added pins, checked by full sha256
FWD45_PINNED_FULL = {
    "src/ml/propspool.js": "78f5574d20d0bf2c8a275b07b0eea9ebcbb30f1f965c07a382759d052ceca96a",
    "data/derived/props.json": "6870d44c20cc2e990ab4fc06d4871e800c5eeaa46d6cff8a39e3c5179d169bdd",
}
PROPS_KEEP = ("m6", "gd", "er", "wr", "mr", "itd", "ou", "ml", "n_books", "n_dropped")
PROPS_FAMILIES = ("m6", "gd", "er", "wr", "mr", "itd", "ou")
POOL_TOL = 1e-9                          # README v4.5 item 2: the pool's cells must sum to 1 and keep p_a within this


def sha256_full(path):
    if not os.path.exists(path):
        return None
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def pinned_mismatches_45():
    """README v4.5 item 8: src/ml/propspool.js and data/derived/props.json against their full sha256."""
    out = []
    for p, h in FWD45_PINNED_FULL.items():
        a = sha256_full(os.path.join(ROOT, p))
        if a != h:
            out.append({"file": p, "pinned": h, "found": a})
    return out


def latest_props_snapshot(pred_dir, before):
    """README v4.5 item 1: the newest props_snapshot_*.json (tools/props.py capture) whose meta.snapshot_utc is before the
    lock; a snapshot without snapshot_utc (a --replay rebuild) is not used. -> (t, path, doc) or None."""
    best = None
    for f in sorted(glob.glob(os.path.join(pred_dir, "props_snapshot_*.json"))):
        d = jload(f)
        su = ((d or {}).get("meta") or {}).get("snapshot_utc")
        if not su:
            continue
        t = parse_utc(su)
        if t < before and (best is None or t >= best[0]):
            best = (t, f, d)
    return best


def props_key(bid):
    """A bout_id compared after slugifying each fighter part (capture writes a null-slug name lower-cased with hyphens)."""
    if not bid or ":" not in bid or "__" not in bid:
        return None
    d0, rest = bid.split(":", 1)
    sa, sb = rest.split("__", 1)
    return (d0, slugify(sa), slugify(sb))


def mirror_props(c):
    """A/B swap of a de-vigged consensus (tools/props_ledger.py mirror_props, src/ml/blend.js mirrorProps)."""
    o = dict(c)
    if isinstance(c.get("m6"), list) and len(c["m6"]) == 6:
        o["m6"] = c["m6"][3:6] + c["m6"][0:3]
    if isinstance(c.get("wr"), list):
        K = (len(c["wr"]) - 2) // 2
        o["wr"] = c["wr"][K:2 * K] + c["wr"][0:K] + [c["wr"][2 * K + 1], c["wr"][2 * K]]
    if isinstance(c.get("mr"), list):
        K = (len(c["mr"]) - 2) // 4
        o["mr"] = c["mr"][2 * K:4 * K] + c["mr"][0:2 * K] + [c["mr"][4 * K + 1], c["mr"][4 * K]]
    if isinstance(c.get("itd"), list) and len(c["itd"]) == 2:
        o["itd"] = [c["itd"][1], c["itd"][0]]
    if isinstance(c.get("ml"), (int, float)):
        o["ml"] = 1 - c["ml"]
    return o


def has_method_props(cons):
    m6 = (cons or {}).get("m6")
    return (isinstance(m6, list) and len(m6) == 6 and all(isinstance(x, (int, float)) and math.isfinite(x) and x >= 0
                                                          for x in m6) and sum(m6) > 0)


def props_for_bout(snapt, bid, lock):
    """README v4.5 item 1: the snapshot entry for a ledger bout, oriented to its a / b. -> (consensus or None, record)."""
    if snapt is None:
        return None, {"found": False, "applied": False, "reason": "no props snapshot before the lock"}
    want = props_key(bid)
    rev = (want[0], want[2], want[1]) if want else None
    cands = []
    for i, x in enumerate(snapt[2].get("bouts") or []):
        k = props_key(x.get("bout_id"))
        if k is None or want is None:
            continue
        if k == want or k == rev:
            cons = x.get("consensus") or {}
            n6 = ((cons.get("n_books") or {}).get("m6") or 0) if has_method_props(cons) else 0
            cands.append((n6, len(x.get("families_present") or []), -i, i, x, k == rev))
    if not cands:
        return None, {"found": False, "applied": False, "reason": "no matching entry in the props snapshot"}
    cands.sort(key=lambda c: c[:3], reverse=True)
    n6, nf, _, i, x, flip = cands[0]
    cons = dict(x.get("consensus") or {})
    if flip:
        cons = mirror_props(cons)
    rec = {"found": True, "entry": {"index": i, "event_slug": x.get("event_slug"), "fetched_utc": x.get("fetched_utc"),
                                    "page_t1": x.get("page_t1"), "page_t2": x.get("page_t2"), "rounds": x.get("rounds"),
                                    "flipped_from_snapshot": flip, "families_present": x.get("families_present"),
                                    "n_books": cons.get("n_books")},
           "other_entries": [{"index": c[3], "event_slug": c[4].get("event_slug"), "n_books_m6": c[0]} for c in cands[1:]],
           "has_method_props": has_method_props(cons)}
    fu = x.get("fetched_utc")
    if not fu or parse_utc(fu) >= lock:
        rec.update({"applied": False, "reason": "the entry's page was fetched at or after the lock (or has no fetch time)",
                    "has_method_props": False})
        return None, rec
    if not rec["has_method_props"]:
        rec.update({"applied": False, "reason": "no method props (m6 family) in the matching entry"})
        return None, rec
    return {k: cons[k] for k in PROPS_KEEP if k in cons}, rec


def run_props_pool(jobs):
    """tools/forward_ledger.js --props-pool (PropsPool on props.json, production weights) on the fwd-4.5 jobs."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"params": "production", "bouts": jobs}, fh)
        tmp = fh.name
    try:
        res = subprocess.run(["node", os.path.join(HERE, "forward_ledger.js"), "--props-pool", tmp], capture_output=True,
                             text=True, cwd=ROOT, check=True)
    finally:
        os.unlink(tmp)
    return json.loads(res.stdout)


def apply_props_45(out_bouts, bouts_in, fj, snapt, lock):
    """README v4.5 items 1-4 on the finished fwd-4.4 bouts (in place). Each bout still holds its unrounded fwd-4.4 cells in
    "_cells"; the stat-line block keeps them (item 5). Returns the props-pool run's meta (None when nothing ran)."""
    jobs, cons_by, recs = [], {}, {}
    for ob, bi in zip(out_bouts, bouts_in):
        bid = ob["bout_id"]
        cons, rec = props_for_bout(snapt, bid, lock)
        recs[bid] = rec
        if cons is None:
            continue
        cons_by[bid] = cons
        R = bi["rounds"]
        if bi["a"] is None or bi["b"] is None:
            dm = ob.get("debut_method")
            if dm:
                jobs.append({"bout_id": bid, "kind": "debut", "pA": ob["p_a"], "pW": dm["p_w_used"], "rounds": R,
                             "props": cons, "debut": {"A": dm["given_a"], "B": dm["given_b"]}})
            else:
                rec.update({"applied": False, "reason": "debut bout without the debut method model's output"})
        else:
            jobs.append({"bout_id": bid, "kind": "pool", "pA": ob["p_a"], "rounds": R, "props": cons, "cells": ob["_cells"]})
    PJ = run_props_pool(jobs) if jobs else None
    res = {x["bout_id"]: x for x in (PJ or {}).get("bouts", [])}
    if PJ is not None:
        for k, h in (("propspool_sha256", FWD45_PINNED_FULL["src/ml/propspool.js"]),
                     ("props_json_sha256", FWD45_PINNED_FULL["data/derived/props.json"])):
            if PJ["meta"][k] != h:
                raise SystemExit("fwd-4.5: the props pool ran on %s %s, not the pinned %s" % (k, PJ["meta"][k], h))
    for ob, bi in zip(out_bouts, bouts_in):
        bid = ob["bout_id"]
        rec, x, cons = recs[bid], res.get(bid), cons_by.get(bid)
        if cons is not None and ((cons.get("n_books") or {}).get("m6") or 0) == 1:
            ob["flags"].append("props_single_book")
        R = bi["rounds"]
        if x is not None and x["kind"] == "pool":
            ck = x["check"]
            bad = (not ck["finite"] or ck["min"] < 0 or abs(ck["sum"] - 1) > POOL_TOL
                   or abs(ck["p_a_not_draw"] - ob["p_a"]) > POOL_TOL)
            rec.update({"kind": "pool", "check": ck, "source": x["source"]})
            if bad:
                rec.update({"applied": False, "reason": "pool output failed the check (README v4.5 item 2)"})
                ob["flags"].append("props_pool_failed")
            else:
                c = x["cells23"]
                sec = {"p_method": dict(ob["p_method"]), "p_distance": ob["p_distance"],
                       "p_finish_round": ob["p_finish_round"], "source": ob["p_method_source"],
                       "note": "fwd-4.4's cells (the pre-4.5 primary), scored secondary"}
                ob["p_method"] = {k: round(v, 5) for k, v in x["p_method"].items()}
                ob["p_distance"] = round(x["p_distance"], 5)
                ob["p_finish_round"] = {"a": [round(c[r] + c[5 + r], 5) for r in range(R)],
                                        "b": [round(c[10 + r] + c[15 + r], 5) for r in range(R)]}
                ob["p_method_source"] = "props pool (props.json, production weights) on " + str(sec["source"])
                ob["p_method_secondary"] = dict(ob.get("p_method_secondary") or {}, fwd44_cells=sec)
                rec.update({"applied": True, "reason": None,
                            "method_given_winner": {"classes": ["ko", "sub", "dec"], "cells": x["M_cells"],
                                                    "props": x["M_props"], "pool": x["M_pool"]},
                            "p_a_cells_own": x["p_own_cells"], "p_a_props": x["p_props"],
                            "p_decision_given_not_draw": x["p_dec_given_not_draw"]})
        elif x is not None and x["kind"] == "debut":
            _, _, _, dr = division_method_prior(fj["priors"], ob.get("weight_class"), R)
            pa = ob["p_a"]
            qa, qb = pa * (1 - dr), (1 - pa) * (1 - dr)
            A, B = x["A"], x["B"]
            pm = {"a_ko": qa * A[0], "a_sub": qa * A[1], "a_dec": qa * A[2],
                  "b_ko": qb * B[0], "b_sub": qb * B[1], "b_dec": qb * B[2], "draw": dr}
            ko_prof, sub_prof = round_profile(fj["priors"], ob.get("weight_class"), R)
            cells = cells_from_profile(pm, ko_prof, sub_prof)
            ob["p_method_secondary"] = dict(ob.get("p_method_secondary") or {}, debut_props_pool={
                "p_method": {k: round(v, 5) for k, v in pm.items()}, "p_distance": round(pm["a_dec"] + pm["b_dec"] + dr, 5),
                "p_finish_round": {"a": [round(cells[i] + cells[R + i], 5) for i in range(R)],
                                   "b": [round(cells[2 * R + i] + cells[3 * R + i], 5) for i in range(R)]},
                "given_a": A, "given_b": B, "source": x["source"] + " (props.json debut pool, production weights)",
                "note": "monitored secondary (README v4.5 item 4); the debut method model stays the primary"})
            rec.update({"kind": "debut", "applied": False, "reason": "debut bout: the debut method model stays the primary; "
                        "the debut-bout pool is recorded as p_method_secondary.debut_props_pool", "secondary_recorded": True,
                        "source": x["source"]})
        ob["props_pool"] = rec
    return PJ["meta"] if PJ else None


def live_inputs_44(lock, live_dir=None):
    """README v4.4 section 4: the live set when tools/live_refresh.py check_live passes, else the fallback record.
    live_dir: data/derived/live unless a dry run's --live-dir says otherwise (tests)."""
    import sys
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import live_refresh as LR
    d = os.path.abspath(live_dir) if live_dir else LR.LIVE_DIR
    ok, why, info = LR.check_live(d, lock)
    rec = {"used": bool(ok), "fallback": not ok, "reason": why, "dir": os.path.relpath(d, ROOT),
           "readme_section": "data/predictions/README.md, Forward model v4.4 (Nov 7, 2026), sections 1-4",
           "live_set": {k: {"file": "data/derived/live/" + v["file"], "replaces": v["pinned"],
                            "live_paths": [".".join(x) for x in v["paths"]]} for k, v in LR.LIVE.items()},
           "not_live": {k: {"file": v, "why": "no roster builder in tools/live_refresh.py 1.0: read at its fwd-4.3 pin"}
                        for k, v in LR.NOT_LIVE.items()}}
    rec.update(info)
    return rec


def fwd_for_date(date):
    """The forward model version the README assigns to an event date."""
    v = "4.1"
    for start, ver in FWD_EFFECTIVE:
        if date >= start:
            v = ver
    return v


def pinned_mismatches(pins=None):
    out = []
    for p, h in (FWD42_PINNED if pins is None else pins).items():
        a = sha16(os.path.join(ROOT, p))
        if a != h:
            out.append({"file": p, "pinned": h, "found": a})
    return out


def round_profile(priors, division, rounds):
    """Division base-rate round profile (the table of division_method_prior): KO and SUB shares per round, each summing
    to 1; ALL's profile when the division's list sums to 0."""
    def prof(P):
        f = P.get("fin5" if rounds == 5 else "fin3") or P.get("fin3")
        return [list(f.get("KO") or []), list(f.get("SUB") or [])]
    P = priors.get(division) or priors.get("ALL")
    ko, sub = prof(P)
    allko, allsub = prof(priors["ALL"])
    out = []
    for xs, alt in ((ko, allko), (sub, allsub)):
        xs = (xs + [0.0] * rounds)[:rounds]
        if sum(xs) <= 0:
            xs = (alt + [0.0] * rounds)[:rounds]
        if sum(xs) <= 0:
            xs = [1.0] * rounds
        out.append([x / sum(xs) for x in xs])
    return out[0], out[1]


def cells_from_profile(pm, ko_prof, sub_prof):
    """S cells [a KO r1..R, a SUB r1..R, b KO r1..R, b SUB r1..R, a DEC, b DEC, draw] from 7-way method cells."""
    return ([pm["a_ko"] * w for w in ko_prof] + [pm["a_sub"] * w for w in sub_prof] +
            [pm["b_ko"] * w for w in ko_prof] + [pm["b_sub"] * w for w in sub_prof] +
            [pm["a_dec"], pm["b_dec"], pm["draw"]])


def now_utc():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(s):
    s = s.strip().replace("Z", "+00:00")
    if re.match(r".*T\d\d:\d\d\+", s):
        s = s.replace("+", ":00+", 1)
    return dt.datetime.fromisoformat(s).astimezone(dt.timezone.utc)


def slugify(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def norm_name(s):
    return " ".join(slugify(s).split("-"))


def sha16(path):
    if not os.path.exists(path):
        return None
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def jload(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path) as fh:
        return json.load(fh)


def git(*a):
    try:
        return subprocess.check_output(["git", "-C", ROOT] + list(a), stderr=subprocess.DEVNULL, text=True).strip()
    except Exception:
        return None


def logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def dec(american):
    a = float(american)
    return 1 + a / 100 if a > 0 else 1 + 100 / abs(a)


def devig_power(oa, ob):
    qa, qb = 1 / dec(oa), 1 / dec(ob)
    lo, hi = 0.5, 3.0
    for _ in range(80):
        k = 0.5 * (lo + hi)
        if qa ** k + qb ** k > 1:
            lo = k
        else:
            hi = k
    k = 0.5 * (lo + hi)
    return qa ** k / (qa ** k + qb ** k)


# ====================================================================== cards, odds
def load_cards(path):
    return jload(path)


def find_event(cards, q):
    evs = cards["events"]
    hit = [e for e in evs if e["date"] == q] or [e for e in evs if q.lower() in e["name"].lower()
                                                  or any(q.lower() in a.lower() for a in e.get("alt_names", []))]
    if len(hit) != 1:
        raise SystemExit("event %r matches %d events: %s" % (q, len(hit), [e["name"] for e in hit]))
    return hit[0]


def lock_of(ev):
    st = ev.get("start_utc") or {}
    ts = [parse_utc(v) for v in st.values() if v]
    if ts:
        return min(ts), "earliest start_utc in cards_upcoming.json"
    return dt.datetime.fromisoformat(ev["date"] + "T00:00:00+00:00"), "no start_utc: 00:00 UTC on the event date"


def bout_id(date, b):
    return "%s:%s__%s" % (date, b["a"].get("slug") or slugify(b["a"]["name"]), b["b"].get("slug") or slugify(b["b"]["name"]))


def latest_snapshot(pred_dir, before, stamp=None):
    files = sorted(glob.glob(os.path.join(pred_dir, "odds_snapshot_*.json")))
    best = None
    for f in files:
        st = os.path.basename(f)[len("odds_snapshot_"):-5]
        if stamp and st != stamp:
            continue
        d = jload(f)
        t = parse_utc(d["meta"]["snapshot_utc"])
        if t < before:
            best = (t, f, d)
    return best


def market_for(snap, bid, b):
    """Snapshot market for the bout oriented to the card's (a, b); None when the snapshot has no line."""
    if not snap:
        return None
    by = {x["bout_id"]: x for x in snap["bouts"]}
    flip = False
    x = by.get(bid)
    if x is None:
        sa, sb = bid.split(":", 1)[1].split("__")
        x = by.get("%s:%s__%s" % (bid.split(":")[0], sb, sa))
        flip = x is not None
    if x is None or not x.get("market"):
        return None
    m, c = x["market"], x.get("consensus") or {}
    oa, ob = m.get("odds_a"), m.get("odds_b")
    if oa is None or ob is None:
        return None
    pm, pc, pp, pmm = m.get("p_a_novig"), c.get("p_consensus"), c.get("p_meandec_power"), c.get("p_meandec_mult")
    if flip:
        oa, ob = ob, oa
        pm, pc, pp, pmm = [None if v is None else 1 - v for v in (pm, pc, pp, pmm)]
    p_stack = pp if pp is not None else devig_power(oa, ob)
    # open-trained stacks were fit on a multiplicative no-vig line (market.json p_novig_open): feed them the
    # multiplicative de-vig of the same consensus, else the BFO mean's
    qa, qb = 1 / dec(oa), 1 / dec(ob)
    p_open_in = pmm if pmm is not None else (pm if pm is not None else qa / (qa + qb))
    return {"source": m.get("source", "bestfightodds"), "captured_utc": m.get("captured_utc"), "odds_a": oa, "odds_b": ob,
            "p_a_novig": pm, "p_a_consensus": pc, "p_a_power_meandec": pp, "p_a_stack_input": round(p_stack, 5),
            "p_a_mult_meandec": pmm, "p_a_open_stack_input": round(p_open_in, 5),
            "n_books": m.get("n_books"), "n_books_consensus": c.get("n_books"), "snapshot": snap["meta"]["stamp"],
            "flipped_from_snapshot": flip}


# ====================================================================== predict
def division_method_prior(priors, division, rounds):
    P = priors.get(division) or priors.get("ALL")
    fin = P.get("fin5" if rounds == 5 else "fin3") or P.get("fin3")
    ko, sub = sum(fin.get("KO") or []), sum(fin.get("SUB") or [])
    dc, dr = fin.get("DEC", 0.0), fin.get("DRAW", 0.0)
    tot = ko + sub + dc + dr
    if tot <= 0:
        return 0.3, 0.15, 0.55, 0.01
    return ko / tot, sub / tot, dc / tot, dr / tot


def cmd_predict(args):
    cards = load_cards(args.cards)
    ev = find_event(cards, args.event)
    lock, lock_basis = lock_of(ev)
    t0 = now_utc()
    if t0 >= lock:
        raise SystemExit("refused: the %s card locked at %s (now %s); a prediction after the lock is not a forward "
                         "test" % (ev["name"], iso(lock), iso(t0)))
    # forward model version (README "Forward model v4.2": fwd-4.2 from 2026-11-14 on, fwd-4.1 before)
    assigned = fwd_for_date(ev["date"])
    fwd = assigned if args.fwd == "auto" else args.fwd
    if fwd != assigned and not args.dry_run:
        raise SystemExit("refused: data/predictions/README.md assigns fwd-%s to events dated %s (asked for fwd-%s); a "
                         "ledger file is written under the pre-registered version only (--dry-run may compare)"
                         % (assigned, ev["date"], fwd))
    v42 = fwd in ("4.2", "4.3", "4.4", "4.5")   # the fwd-4.2 path (fwd-4.3 keeps all of it and changes p_a_noline)
    v43 = fwd in ("4.3", "4.4", "4.5")          # the fwd-4.3 rules (fwd-4.4 = fwd-4.3 on live inputs)
    v44 = fwd in ("4.4", "4.5")                 # live inputs (fwd-4.5 = fwd-4.4 + the props pool's method cells)
    v45 = fwd == "4.5"
    engine_dir = args.engine_dir or (FWD42_ENGINE_DIR if v42 else "src")
    mism = []
    if v42:
        mism = pinned_mismatches(FWD43_PINNED if v43 else FWD42_PINNED)
        if v45:
            mism += pinned_mismatches_45()
        if os.path.normpath(engine_dir) != os.path.normpath(FWD42_ENGINE_DIR):
            mism.append({"file": "--engine-dir", "pinned": FWD42_ENGINE_DIR, "found": engine_dir})
        if mism and not args.dry_run:
            raise SystemExit("refused: fwd-%s reads only the files pre-registered in data/predictions/README.md; these "
                             "differ: %s. A changed input is a new version (fwd-%s.1+) that needs a README addendum "
                             "first." % (fwd, json.dumps(mism), fwd))
        for m in mism:
            print("WARNING (dry run): fwd-%s pinned input differs: %s pinned %s, found %s" % (fwd, m["file"], m["pinned"], m["found"]))
    slug = slugify(ev["name"])
    base = os.path.join(args.dir, "%s_%s.json" % (ev["date"], slug))
    existing = sorted([f for f in glob.glob(os.path.join(args.dir, "%s_%s*.json" % (ev["date"], slug)))
                       if LEDGER_RE.match(os.path.basename(f))],
                      key=lambda f: int(LEDGER_RE.match(os.path.basename(f)).group(3) or 1))
    supersedes = None
    if existing and not args.supersede and not args.dry_run:
        raise SystemExit("refused: %s already exists and ledger files are write-once (use --supersede before the "
                         "lock to add a _v2 that replaces it)" % os.path.relpath(existing[-1], ROOT))
    target = base
    if existing and args.supersede:
        last = existing[-1]
        n = int(LEDGER_RE.match(os.path.basename(last)).group(3) or 1) + 1
        target = os.path.join(args.dir, "%s_%s_v%d.json" % (ev["date"], slug, n))
        supersedes = os.path.basename(last)
    snapt = latest_snapshot(PRED_DIR if args.odds_dir is None else args.odds_dir, lock, args.odds)
    snap = snapt[2] if snapt else None
    if args.live_dir and not args.dry_run:
        raise SystemExit("refused: --live-dir is for dry runs; a fwd-4.4 ledger file reads data/derived/live (README v4.4)")
    if args.props_dir and not args.dry_run:
        raise SystemExit("refused: --props-dir is for dry runs; a fwd-4.5 ledger file reads the newest props snapshot in "
                         "data/predictions taken before the lock (README v4.5)")
    live = live_inputs_44(lock, args.live_dir) if v44 else None   # README v4.4: live inputs, else fwd-4.3's pins
    if live is not None:
        print("fwd-%s inputs: %s" % (fwd, "live, as of %s (manifest sha256 %s)" % (live["as_of"], live["manifest_sha256"][:16])
                                     if live["used"] else "FALLBACK to fwd-4.3's pinned inputs: %s" % live["reason"]))
    props_snap = latest_props_snapshot(args.props_dir or PRED_DIR, lock) if v45 else None   # README v4.5 item 1
    live_dir = live["dir"] if (live and live["used"]) else None
    fj = jload(os.path.join(ROOT, live_dir, "fighters_live.json") if live_dir else os.path.join(DERIVED, "fighters.json"))
    roster = fj["fighters"]
    bouts_in, rows = [], []
    for b in sorted(ev["bouts"], key=lambda x: x.get("order", 99)):
        bid = bout_id(ev["date"], b)
        mk = market_for(snap, bid, b)
        sa, sb = b["a"].get("slug"), b["b"].get("slug")
        rows.append((b, bid, mk))
        bouts_in.append({"bout_id": bid, "a": sa if sa in roster else None, "b": sb if sb in roster else None,
                         "key_a": sa or slugify(b["a"]["name"]), "key_b": sb or slugify(b["b"]["name"]),
                         "name_a": b["a"]["name"], "name_b": b["b"]["name"],
                         "division": b.get("weight_class"), "rounds": b.get("rounds") or 3, "title": bool(b.get("title")),
                         "p_line": mk["p_a_stack_input"] if mk else None,
                         "p_open_in": mk["p_a_open_stack_input"] if mk else None,
                         "p_novig": mk["p_a_novig"] if mk else None})
        if mk and mk.get("captured_utc"):
            mk["hours_before_lock"] = round((lock - parse_utc(mk["captured_utc"])).total_seconds() / 3600, 2)
    bt_stack = os.path.join(DERIVED, "blindtest_stack.json")
    stack_file = None
    if args.stack == "blindtest" or (args.stack == "auto" and os.path.exists(bt_stack)):
        if not os.path.exists(bt_stack):
            raise SystemExit("--stack blindtest: run python3 tools/blindtest.py export first")
        stack_file = bt_stack
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        jin = {"date": ev["date"], "sims": args.sims, "bouts": bouts_in}
        if v42:
            jin["headline"] = args.headline
        json.dump(jin, fh)
        tmp = fh.name
    try:
        cmd = ["node", os.path.join(HERE, "forward_ledger.js"), tmp, "--engine-dir", engine_dir]
        if stack_file:
            cmd += ["--moe", os.path.relpath(stack_file, ROOT)]
        if v42:
            cmd += ["--fwd", fwd]
        if live_dir:
            cmd += ["--live-dir", live_dir]
        res = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT, check=True)
    finally:
        os.unlink(tmp)
    J = json.loads(res.stdout)
    jm = J["meta"]
    out_bouts = []
    for (b, bid, mk), bi, r in zip(rows, bouts_in, J["bouts"]):
        sa, sb = bi["a"], bi["b"]
        models = r.get("models") or {}
        seeds = r.get("elo_seed") or {}
        if models.get("elo") is not None:
            p_elo = models["elo"]               # fighters.json Elo; a debutant seeded from his pre-UFC record when found
        else:
            ea = roster[sa]["elo"] if sa else DEBUT_ELO
            eb = roster[sb]["elo"] if sb else DEBUT_ELO
            p_elo = 1 / (1 + 10 ** ((eb - ea) / 400))
        flags = []
        if r["debut_a"]:
            flags.append("debut_a")
        if r["debut_b"]:
            flags.append("debut_b")
        for side in ("a", "b"):
            if r["debut_" + side]:
                flags.append(("seeded_elo_" if (seeds.get(side) or {}).get("shift") is not None else "debut_elo_1500_")
                             + side)
        if b.get("status") != "official":
            flags.append("status_" + str(b.get("status")))
        if not mk:
            flags.append("no_line")
        for side, s in (("a", sa), ("b", sb)):
            if s and roster[s].get("division") and b.get("weight_class") and roster[s]["division"] != b["weight_class"]:
                flags.append("weight_change_" + side)
        if b.get("prior_ufc_meetings"):
            flags.append("rematch")
        if live is not None and not live["used"]:
            flags.append("live_inputs_fallback")
        debut = r["debut_a"] or r["debut_b"]
        hl, hn = r.get("head_line"), r.get("head_noline")
        p_primary, src_primary = None, None
        if debut:
            p_noline = p_elo
            src_no = ("elo_debut_seeded" if any((seeds.get(s) or {}).get("shift") is not None for s in ("a", "b"))
                      else "elo_debut_prior")
            p_line = mk["p_a_stack_input"] if mk else None
            ko, sub, dc, dr = division_method_prior(fj["priors"], b.get("weight_class"), bi["rounds"])
            head = None
        else:
            p_noline = r["stack_noline"]["p"] if r.get("stack_noline") else None
            src_no = "moe_stack"
            if v43:
                # README "Forward model v4.3": the ML v2 no-line stack (weights fit 2019-2023); the MoE stack is its
                # fallback when a fighter is missing from the ML v2 roster
                if models.get(NOLINE_PRIMARY) is not None:
                    p_noline, src_no = models[NOLINE_PRIMARY], NOLINE_PRIMARY
                elif p_noline is not None:
                    src_no = "moe_stack (noline_fallback)"
                    flags.append("noline_fallback")
                else:
                    src_no = None
            p_line = r["stack_line"]["p"] if r.get("stack_line") else None
            head = hl if (args.headline == "line" and hl) else hn
            if mk:
                for k in (PRIMARY,) + FALLBACK:
                    if models.get(k) is not None:
                        p_primary, src_primary = models[k], k
                        break
        if args.headline == "line" and p_line is not None:
            if debut:
                p_a, src = p_line, "market_line (debut fallback)"
            elif p_primary is not None:
                p_a, src = p_primary, src_primary
            else:
                p_a, src = p_line, "moe_stack_with_line"
        else:
            p_a, src = p_noline, src_no
        if args.headline == "line" and mk and not debut and src != PRIMARY:
            flags.append("primary_fallback")
        if p_a is None:
            p_a, src = p_elo, "elo (stack unavailable)"
            flags.append("stack_unavailable")
        if head and head.get("p_method"):
            pD = head["pD"]
            pm = dict(head["p_method"])
            pdist = head["p_distance"]
            fin_round = {"a": head.get("finA"), "b": head.get("finB")}
            # rescale the method cells to the headline p_a (they were built for the head's own stack variant)
            qa, qb = p_a * (1 - pD), (1 - p_a) * (1 - pD)
            sa_, sb_ = pm["a_ko"] + pm["a_sub"] + pm["a_dec"], pm["b_ko"] + pm["b_sub"] + pm["b_dec"]
            for k in ("a_ko", "a_sub", "a_dec"):
                pm[k] = pm[k] * qa / max(sa_, 1e-12)
            for k in ("b_ko", "b_sub", "b_dec"):
                pm[k] = pm[k] * qb / max(sb_, 1e-12)
            pdist = pm["a_dec"] + pm["b_dec"] + pD
            # the finishing-round cells get the same per-side factors, so sum(finA) = a_ko + a_sub stays true at p_a
            fa, fb = qa / max(sa_, 1e-12), qb / max(sb_, 1e-12)
            fin_round = {"a": None if fin_round["a"] is None else [round(v * fa, 5) for v in fin_round["a"]],
                         "b": None if fin_round["b"] is None else [round(v * fb, 5) for v in fin_round["b"]]}
            msrc = head.get("src")
        else:
            ko, sub, dc, dr = division_method_prior(fj["priors"], b.get("weight_class"), bi["rounds"])
            fs = ko + sub + dc
            qa, qb = p_a * (1 - dr), (1 - p_a) * (1 - dr)
            pm = {"a_ko": qa * ko / fs, "a_sub": qa * sub / fs, "a_dec": qa * dc / fs,
                  "b_ko": qb * ko / fs, "b_sub": qb * sub / fs, "b_dec": qb * dc / fs, "draw": dr}
            pdist, fin_round, msrc = pm["a_dec"] + pm["b_dec"] + dr, None, "division base rates"
        extra = None
        if v42:
            # README "Forward model v4.2": debut bouts take the debut method model fed p_a (division base rates kept as
            # the scored secondary); every bout's primary cells by round become the stat-line fight-length grid
            extra = {}
            ko_prof, sub_prof = round_profile(fj["priors"], b.get("weight_class"), bi["rounds"])
            dm = r.get("debut_method")
            if debut and not dm:
                raise SystemExit("fwd-%s: the debut method model did not run for %s (%s)" % (fwd, bid, r.get("notes")))
            if debut:
                if abs(dm["p_w_used"] - p_a) > 1e-9:
                    raise SystemExit("fwd-%s: debut method fed %r but p_a is %r for %s" % (fwd, dm["p_w_used"], p_a, bid))
                extra["p_method_secondary"] = {"division_base_rates": {
                    "p_method": {k: round(v, 5) for k, v in pm.items()}, "p_distance": round(pdist, 5),
                    "source": "division base rates scaled to p_a (fwd-4.1's debut method)"}}
                _, _, _, dr = division_method_prior(fj["priors"], b.get("weight_class"), bi["rounds"])
                qa, qb = p_a * (1 - dr), (1 - p_a) * (1 - dr)
                ga, gb = dm["given_a"], dm["given_b"]
                pm = {"a_ko": qa * ga[0], "a_sub": qa * ga[1], "a_dec": qa * ga[2],
                      "b_ko": qb * gb[0], "b_sub": qb * gb[1], "b_dec": qb * gb[2], "draw": dr}
                pdist = pm["a_dec"] + pm["b_dec"] + dr
                cells = cells_from_profile(pm, ko_prof, sub_prof)
                R_ = bi["rounds"]
                fin_round = {"a": [round(cells[i] + cells[R_ + i], 5) for i in range(R_)],
                             "b": [round(cells[2 * R_ + i] + cells[3 * R_ + i], 5) for i in range(R_)]}
                msrc = "debut method model (debut.json)"
                extra["debut_method"] = dm
                extra["debut_path"] = r.get("debut_path")
            elif head and head.get("p_method"):
                if head.get("koA") is not None:
                    cells = ([v * fa for v in head["koA"]] + [v * fa for v in head["subA"]] +
                             [v * fb for v in head["koB"]] + [v * fb for v in head["subB"]] +
                             [pm["a_dec"], pm["b_dec"], pm["draw"]])
                else:     # engine head: per-round finishes split into KO and SUB by its own KO / SUB totals
                    fa_ko = pm["a_ko"] / max(pm["a_ko"] + pm["a_sub"], 1e-12)
                    fb_ko = pm["b_ko"] / max(pm["b_ko"] + pm["b_sub"], 1e-12)
                    cells = ([v * fa * fa_ko for v in head["finA"]] + [v * fa * (1 - fa_ko) for v in head["finA"]] +
                             [v * fb * fb_ko for v in head["finB"]] + [v * fb * (1 - fb_ko) for v in head["finB"]] +
                             [pm["a_dec"], pm["b_dec"], pm["draw"]])
            else:
                cells = cells_from_profile(pm, ko_prof, sub_prof)
            extra["_cells"] = cells
            if v43:
                extra["p_a_noline_source"] = src_no
        out_bouts.append({
            "bout_id": bid, "order": b.get("order"), "segment": b.get("segment"),
            "a": {"name": b["a"]["name"], "slug": b["a"].get("slug")}, "b": {"name": b["b"]["name"], "slug": b["b"].get("slug")},
            "weight_class": b.get("weight_class"), "rounds": bi["rounds"], "title": bi["title"], "status": b.get("status"),
            "p_a": round(p_a, 5), "p_a_source": src,
            "p_a_noline": None if p_noline is None else round(p_noline, 5),
            "p_a_line": None if p_line is None else round(p_line, 5),
            "p_elo": round(p_elo, 5),
            "p_method": {k: round(v, 5) for k, v in pm.items()}, "p_method_source": msrc,
            "p_distance": round(pdist, 5), "p_finish_round": fin_round,
            "models": models, "elo_seed": seeds or None,
            "experts": r.get("experts"), "stack_weights": (r.get("stack_line") or r.get("stack_noline") or {}).get("weights"),
            "engine": r.get("engine"), "methodround_S": r.get("methodround_S"),
            "market": mk, "flags": flags, "notes": r.get("notes")})
        if extra is not None:
            out_bouts[-1].update(extra)
    pp_meta = apply_props_45(out_bouts, bouts_in, fj, props_snap, lock) if v45 else None   # README v4.5 items 1-4
    if v42:
        sl = run_statlines(ev["date"], bouts_in, out_bouts, engine_dir, live_dir)   # fwd-4.4's cells (README v4.5 item 5)
        for ob in out_bouts:
            ob.pop("_cells", None)
            ob["statlines"] = sl["bouts"][ob["bout_id"]]
            if v45:
                ob["props_pool"] = ob.pop("props_pool")      # fwd-4.5's record after fwd-4.4's fields
    commit = git("rev-parse", "HEAD")
    dirty = git("status", "--porcelain", "--", "src", "tools", "data/derived")
    doc = {
        "event": ev["name"], "alt_names": ev.get("alt_names"), "date": ev["date"], "location": ev.get("location"),
        "lock_utc": iso(lock), "lock_basis": lock_basis, "created_utc": iso(t0), "card_as_of": cards.get("as_of"),
        "supersedes": supersedes,
        "model": {
            "version": "%s: primary %s (ML v2 %s, fit-2019-2023 stacks %s); MoE stack %s (%s); engine %s / params %s; "
                       "methodround S/SM; ML page model %s" % (
                MODEL_VERSION, PRIMARY, jm.get("ml2_built"), jm.get("forward_models_sha256_16"),
                os.path.basename(jm.get("stack_source") or ""), jm.get("stack_built"), jm.get("engine_version"),
                jm.get("params_version"), jm.get("ml_page_snapshot")),
            "stack": {"source": jm.get("stack_source"), "built": jm.get("stack_built"), "sha256_16": jm.get("stack_sha256_16"),
                      "blind_scores_2024_2025": (jload(stack_file) or {}).get("meta", {}).get("blind_scores") if stack_file else None},
            "p_a": ("forward model v4.1 (data/predictions/README.md): p_a = models.%s, the ML v2 open stack (weights fit "
                    "2019-2023 on opening lines) fed the multiplicative de-vig consensus line captured at prediction "
                    "time (market.p_a_open_stack_input), whatever the capture time before the lock; if it cannot run, "
                    "the first of %s (flag primary_fallback); no line: p_a_noline. p_a_line = the MoE stack with the "
                    "line (fwd-1's p_a); p_a_noline = the MoE stack without it. Debutants: p_a = the line, p_a_noline = "
                    "Elo with the debutant seeded from his pre-UFC record when a seed exists (else 1500)"
                    % (PRIMARY, list(FALLBACK))) if args.headline == "line" else "MoE stack without the market line",
            "primary": PRIMARY if args.headline == "line" else "stack_noline", "fallback": list(FALLBACK),
            "models": MODEL_DEFS, "models_order": jm.get("model_keys"),
            "ml2_static_weights": jm.get("ml2_static_weights"), "ml2_prod_weights": jm.get("ml2_prod_weights"),
            "ratings_stack": jm.get("ratings_stack"), "seed_betas": jm.get("seed_betas"),
            "debutant_files": jm.get("debutant_files"),
            "headline": args.headline, "code_commit": commit, "uncommitted_changes": bool(dirty),
            "roster_snapshot": jm.get("roster_snapshot"), "n_sims": 2 * args.sims, "sims_per_corner_order": args.sims,
            "engine": {k: jm.get(k) for k in ("engine_dir", "engine_version", "params_version", "engine_sha256_16",
                                               "params_sha256_16", "mlrates_js_sha256_16", "mlrates_native")},
            "inputs_sha256_16": {n: sha16(os.path.join(DERIVED, n)) for n in
                                 ("fighters.json", "moe_page.json", "ml.json", "market.json", "methodround.json",
                                  "mlrates.json", "ml2.json", "forward_models.json", "ratings.json", "preufc.json",
                                  "blindtest_stack.json")},
            "tool": TOOL},
        "odds_snapshot": {"file": os.path.relpath(snapt[1], ROOT), "snapshot_utc": iso(snapt[0])} if snapt else None,
        "probability_conventions": "p_a, p_a_line, p_a_noline, p_elo = P(a wins | not a draw); p_method sums to 1 with "
                                   "the draw; a/b in cards_upcoming.json order",
        "bouts": out_bouts}
    if v42:
        apply_model_42(doc, jm, sl["meta"], args, mism)
    if v43:
        apply_model_43(doc, jm, sl["meta"], args, mism)
    if v44:
        apply_model_44(doc, jm, sl["meta"], args, mism, live)
    if v45:
        apply_model_45(doc, args, mism, props_snap, snapt, pp_meta)
    print_table(doc)
    if v42:
        print_table_42(doc)
    if v43:
        print_table_43(doc)
    if v44:
        print_table_44(doc)
    if v45:
        print_table_45(doc)
    if args.dry_run:
        if args.dry_out:
            with open(args.dry_out, "w") as fh:
                json.dump(doc, fh, indent=1)
            print("dry run: wrote %s (not a ledger file)" % args.dry_out)
        else:
            print("dry run: nothing written")
        return
    os.makedirs(args.dir, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
    with os.fdopen(fd, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    print("wrote %s (read-only; commit and push it before %s)" % (os.path.relpath(target, ROOT), iso(lock)))


def run_statlines(date, bouts_in, out_bouts, engine_dir, live_dir=None):
    """tools/forward_statlines.js on every bout's primary method cells by round (fwd-4.2 stat-line block)."""
    jb = []
    for bi, ob in zip(bouts_in, out_bouts):
        jb.append({"bout_id": bi["bout_id"], "a": bi["a"], "b": bi["b"], "key_a": bi["key_a"], "key_b": bi["key_b"],
                   "division": bi["division"], "rounds": bi["rounds"], "title": bi["title"], "S": ob["_cells"]})
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump({"date": date, "bouts": jb}, fh)
        tmp = fh.name
    try:
        res = subprocess.run(["node", os.path.join(HERE, "forward_statlines.js"), tmp, "--engine-dir", engine_dir]
                             + (["--live-dir", live_dir] if live_dir else []), capture_output=True, text=True, cwd=ROOT,
                             check=True)
    finally:
        os.unlink(tmp)
    J = json.loads(res.stdout)
    by = {}
    for x in J["bouts"]:
        bid = x.pop("bout_id")
        by[bid] = x
    return {"meta": J["meta"], "bouts": by}


def apply_model_42(doc, jm, slm, args, mism):
    """The model block of a fwd-4.2 file (README "Forward model v4.2"): fwd-4.1's block plus what v4.2 adds."""
    M = doc["model"]
    M["version"] = ("%s: primary %s (ML v2 %s, fit-2019-2023 stacks %s); debut method debut.json %s; stat lines "
                    "statlines.json %s (prod); MoE stack %s (%s); engine %s / params %s (%s); methodround S/SM; ML page "
                    "model %s" % (
                        MODEL_VERSION_42, PRIMARY, jm.get("ml2_built"), jm.get("forward_models_sha256_16"),
                        (jm.get("debut_model") or {}).get("sha256_16"), slm.get("statlines_sha256_16"),
                        os.path.basename(jm.get("stack_source") or ""), jm.get("stack_built"), jm.get("engine_version"),
                        jm.get("params_version"), jm.get("engine_dir"), jm.get("ml_page_snapshot")))
    M["p_a"] = M["p_a"].replace("forward model v4.1", "forward model v4.2 (winner rules unchanged from v4.1)", 1)
    M["models"] = MODEL_DEFS_42
    M["p_method"] = (
        "bouts without a debutant: as fwd-4.1 (method-and-round model scaled to p_a). Bouts with a debutant: the debut "
        "method model (data/derived/debut.json, src/ml/debut.js method()) fed pW = p_a (the line, power de-vig, else "
        "the seeded Elo): a_m = p_a (1 - dr) P(m | a wins), b_m = (1 - p_a)(1 - dr) P(m | b wins), draw = dr (division "
        "base-rate draw share); p_distance = a_dec + b_dec + draw; p_finish_round splits the KO and SUB cells by the "
        "division base-rate round profile; p_method_secondary.division_base_rates = fwd-4.1's cells (scored secondary)")
    M["statlines"] = {
        "definition": "per fighter, sig_lnd / sig_att / td_lnd / td_att / ctrl (s) / kd / sub_att: mean, p10, p50, p90 "
                      "(smallest integer y with mixture CDF >= q) of src/ml/statdist.js prod tables mixed over "
                      "StatDist.lengthGrid of the bout's primary method cells by round; blend_mean = the mlrates + "
                      "embedding blend rate x expected minutes (comparator)",
        "stats": list(STAT_KEYS), "evaluator": slm}
    M["debut_model"] = jm.get("debut_model")
    M["preregistration"] = {"readme_section": "data/predictions/README.md, Forward model v4.2 (Nov 6-7, 2026)",
                            "pinned_inputs": FWD42_PINNED, "pinned_inputs_ok": not mism, "pinned_mismatches": mism or None}
    M["inputs_sha256_16"] = dict(M["inputs_sha256_16"], **{n: sha16(os.path.join(DERIVED, n)) for n in
                                                            ("debut.json", "statlines.json", "embed_model.json", "oppadj.json")})
    M["code_sha256_16"] = {p: sha16(os.path.join(ROOT, p)) for p in FWD42_CODE}
    M["fwd"] = "4.2"
    M["tool"] = TOOL_42


def apply_model_43(doc, jm, slm, args, mism):
    """The model block of a fwd-4.3 file (README "Forward model v4.3"): fwd-4.2's block (already applied) with the no-line
    primary, the moe_noline secondary, the drift-rule column and the fwd-4.3 pins."""
    M = doc["model"]
    M["version"] = ("%s: primary %s, no-line primary %s (ML v2 %s, fit-2019-2023 stacks %s); debut method debut.json %s; "
                    "stat lines statlines.json %s (prod); MoE stack %s (%s); engine %s / params %s (%s); methodround "
                    "S/SM; ML page model %s" % (
                        MODEL_VERSION_43, PRIMARY, NOLINE_PRIMARY, jm.get("ml2_built"), jm.get("forward_models_sha256_16"),
                        (jm.get("debut_model") or {}).get("sha256_16"), slm.get("statlines_sha256_16"),
                        os.path.basename(jm.get("stack_source") or ""), jm.get("stack_built"), jm.get("engine_version"),
                        jm.get("params_version"), jm.get("engine_dir"), jm.get("ml_page_snapshot")))
    if args.headline == "line":
        M["p_a"] = ("forward model v4.3 (data/predictions/README.md): p_a = models.%s, the ML v2 open stack (weights fit "
                    "2019-2023 on opening lines) fed the multiplicative de-vig consensus line captured at prediction "
                    "time (market.p_a_open_stack_input), whatever the capture time before the lock; if it cannot run, "
                    "the first of %s (flag primary_fallback); no line: p_a_noline. p_a_line = the MoE stack with the "
                    "line (fwd-1's p_a). p_a_noline = models.%s, the ML v2 no-line stack (weights fit 2019-2023), else "
                    "the MoE stack without a line (models.%s, flag noline_fallback). Debutants: p_a = the line, "
                    "p_a_noline = Elo with the debutant seeded from his pre-UFC record when a seed exists (else 1500)"
                    % (PRIMARY, list(FALLBACK), NOLINE_PRIMARY, NOLINE_FALLBACK))
    else:
        M["p_a"] = ("p_a = p_a_noline: models.%s (ML v2 no-line stack), else models.%s (flag noline_fallback); "
                    "debutants: seeded Elo" % (NOLINE_PRIMARY, NOLINE_FALLBACK))
        M["primary"] = NOLINE_PRIMARY
    M["p_a_noline"] = ("bout without a debutant: models.%s (ML v2 no-line stack, forward_models.json ml2_static.noline, "
                       "weights fit 2019-2023), else models.%s (MoE no-line stack; flag noline_fallback); bout with a "
                       "debutant: p_elo (seeded Elo); p_a_noline_source says which" % (NOLINE_PRIMARY, NOLINE_FALLBACK))
    M["noline_primary"], M["noline_fallback"] = NOLINE_PRIMARY, NOLINE_FALLBACK
    M["drift_rule_b"] = ("docs/V6_V10_PLAN.md 6.5.1(b) reads p_a_noline from fwd-4.3 on (each scored row its own file's "
                         "p_a_noline; scored win bouts without a debutant); the MoE no-line series (fwd-4.1 / fwd-4.2 "
                         "p_a_noline, then models.moe_noline) is tracked beside it and never triggers")
    M["models"] = MODEL_DEFS_43
    M["preregistration"] = {"readme_section": "data/predictions/README.md, Forward model v4.3 (Nov 7, 2026)",
                            "pinned_inputs": FWD43_PINNED, "pinned_inputs_ok": not mism, "pinned_mismatches": mism or None,
                            "audit1_flag": "decided after vault audit 1 was read: listed in audit 2 as not clean on the "
                                           "vault (plan 6.5.2); its clean test is this ledger"}
    M["fwd"] = "4.3"
    M["tool"] = TOOL_43


def apply_model_44(doc, jm, slm, args, mism, live):
    """The model block of a fwd-4.4 file (README "Forward model v4.4"): fwd-4.3's block (already applied) on live inputs,
    with the live-input record (manifest path and sha256, as_of, live file hashes, fallback and its reason)."""
    M = doc["model"]
    tag = ("live roster inputs as of %s (data/derived/live, manifest sha256 %s)" % (live["as_of"], live["manifest_sha256"][:16])
           if live["used"] else "fallback: fwd-4.3 pinned inputs (%s)" % live["reason"])
    M["version"] = MODEL_VERSION_44 + M["version"][len(MODEL_VERSION_43):] + "; " + tag
    M["p_a"] = M["p_a"].replace("forward model v4.3 (data/predictions/README.md)",
                                "forward model v4.4 (data/predictions/README.md; fwd-4.3's rules on live inputs)", 1)
    M["inputs"] = ("README v4.4: fighters, market, ratings, ml, ml2 and methodround from data/derived/live/ (tools/live_refresh.py, "
                   "frozen parameters, results through as_of); every other input at its fwd-4.3 pin" if live["used"] else
                   "README v4.4 fallback: every input at its fwd-4.3 pin (the live set failed check_live: %s)" % live["reason"])
    M["live_inputs"] = live
    M["preregistration"] = {"readme_section": "data/predictions/README.md, Forward model v4.4 (Nov 7, 2026)",
                            "models_and_rules": "fwd-4.3's (README Forward model v4.3), unchanged",
                            "pinned_inputs": FWD43_PINNED, "pinned_inputs_ok": not mism, "pinned_mismatches": mism or None,
                            "pinned_note": "fighters, market, ratings, ml, ml2 and methodround are read from data/derived/live "
                                           "when model.live_inputs.used; their pinned copies above must still match for the "
                                           "fallback",
                            "audit1_flag": M["preregistration"].get("audit1_flag")}
    M["code_sha256_16"] = {p: sha16(os.path.join(ROOT, p)) for p in FWD44_CODE}
    M["fwd"] = "4.4"
    M["tool"] = TOOL_44


def apply_model_45(doc, args, mism, props_snap, odds_snapt, pp_meta):
    """The model block of a fwd-4.5 file (README "Forward model v4.5"): fwd-4.4's block (already applied) plus the props
    pool, the props snapshot record, the two added pins and the vault flag."""
    M = doc["model"]
    pj_sha16 = FWD45_PINNED_FULL["data/derived/props.json"][:16]
    snap_tag = ("props snapshot %s" % props_snap[2]["meta"].get("stamp") if props_snap else "no props snapshot before the lock")
    M["version"] = (MODEL_VERSION_45 + M["version"][len(MODEL_VERSION_44):] + "; method props pool props.json %s "
                    "(production weights) where the props snapshot has method props (%s)" % (pj_sha16, snap_tag))
    M["p_a"] = M["p_a"].replace("forward model v4.4 (data/predictions/README.md; fwd-4.3's rules on live inputs)",
                                "forward model v4.5 (data/predictions/README.md; fwd-4.4's winner rules and live inputs)", 1)
    M["p_method"] = (
        "README v4.5: a bout without a debutant whose props snapshot has method props (m6) takes p_method / p_distance / "
        "p_finish_round from PropsPool (src/ml/propspool.js predict on data/derived/props.json model, params 'production': "
        "joint-linear pool of fwd-4.4's cells and the props' method given the winner, weights cells %s / props %s, round shapes "
        "from the cells, decision tilt 0, draw = draw_c x P(decision)) fed p_a and fwd-4.4's cells, which are kept as "
        "p_method_secondary.fwd44_cells (scored secondary); every other bout keeps fwd-4.4's p_method (fwd-4.2's rules: "
        "method-and-round model scaled to p_a; debut bouts the debut method model, with the debut-bout props pool recorded as "
        "p_method_secondary.debut_props_pool when the bout has method props, monitored)" % tuple(
            (pp_meta or {}).get("w") or jload(os.path.join(DERIVED, "props.json"))["model"]["params_production"]["m"]["w"]))
    if isinstance(M.get("statlines"), dict):
        M["statlines"] = dict(M["statlines"], length_grid="fwd-4.4's method cells by round on every bout (README v4.5 item 5), "
                              "not the props pool's")
    pjm = jload(os.path.join(DERIVED, "props.json"))["model"]
    M["props_pool"] = {
        "evaluator": "src/ml/propspool.js create(props.json model).predict / debutMethod, called by tools/forward_ledger.js "
                     "--props-pool", "params": "production", "spec": pjm["spec"], "w": pjm["params_production"]["m"]["w"],
        "beta": pjm["params_production"]["m"]["beta"], "draw_c": pjm["draw_c"],
        "debut": {"mode": pjm["debut"]["mode"], "alpha": pjm["debut"]["params_production"]["alpha"],
                  "beta": pjm["debut"]["params_production"]["beta"]},
        "sha256": {p: sha256_full(os.path.join(ROOT, p)) for p in FWD45_PINNED_FULL},
        "run": pp_meta, "check_tolerance": POOL_TOL,
        "n_bouts_pooled": sum(1 for b in doc["bouts"] if (b.get("props_pool") or {}).get("applied")),
        "n_debut_secondary": sum(1 for b in doc["bouts"] if (b.get("props_pool") or {}).get("secondary_recorded")),
        "n_bouts": len(doc["bouts"])}
    if props_snap:
        t, f, d = props_snap
        gap = round((t - odds_snapt[0]).total_seconds() / 60.0, 1) if odds_snapt else None
        M["props_snapshot"] = {"file": os.path.relpath(f, ROOT), "snapshot_utc": iso(t), "stamp": d["meta"].get("stamp"),
                               "sha256_16": sha16(f), "tool": d["meta"].get("tool"), "devig": d["meta"].get("devig"),
                               "props_minus_odds_minutes": gap,
                               "hours_before_lock": round((parse_utc(doc["lock_utc"]) - t).total_seconds() / 3600, 2)}
    else:
        M["props_snapshot"] = None
    M["preregistration"] = {"readme_section": "data/predictions/README.md, Forward model v4.5 (Nov 7, 2026)",
                            "models_and_rules": "fwd-4.4's (README Forward model v4.4, on fwd-4.3's rules), unchanged except "
                                                "README v4.5 items 2-4 (method cells) and 6 (scoring additions)",
                            "pinned_inputs": FWD43_PINNED, "pinned_inputs_added_sha256": FWD45_PINNED_FULL,
                            "pinned_inputs_ok": not mism, "pinned_mismatches": mism or None,
                            "pinned_note": M["preregistration"].get("pinned_note"),
                            "audit1_flag": M["preregistration"].get("audit1_flag"),
                            "vault_flag": "the props pool's method cells were adopted on Nov 7 after both vault openings "
                                          "(audit 1 and audit 2; the pool's vault numbers are in both): not clean on the vault "
                                          "(plan 6.5.2); no vault test remains, so its clean test is this ledger"}
    M["code_sha256_16"] = {p: sha16(os.path.join(ROOT, p)) for p in FWD45_CODE}
    M["fwd"] = "4.5"
    M["tool"] = TOOL_45


def print_table_45(doc):
    """fwd-4.5: per bout, whether the props pool set the method cells, against fwd-4.4's cells."""
    S = doc["model"].get("props_snapshot")
    print("\nfwd-4.5 props pool: %s" % ("snapshot %s (%s, %.1f h before the lock)" % (S["stamp"], S["snapshot_utc"],
                                                                                     S["hours_before_lock"]) if S else
                                       "no props snapshot before the lock: every bout keeps fwd-4.4's cells"))
    cl = ("a_ko", "a_sub", "a_dec", "draw", "b_dec", "b_sub", "b_ko")
    for b in doc["bouts"]:
        rec = b.get("props_pool") or {}
        name = (b["a"]["name"] + " vs " + b["b"]["name"])[:44]
        sec = (b.get("p_method_secondary") or {})
        if rec.get("applied"):
            f44 = sec["fwd44_cells"]
            print("  %-44s POOL   %s  P(dist) %.3f (fwd-4.4 %.3f), books m6 %s" % (
                name, " ".join("%.3f" % b["p_method"][k] for k in cl), b["p_distance"], f44["p_distance"],
                (rec.get("entry") or {}).get("n_books", {}).get("m6")))
            print("  %-44s fwd44  %s" % ("", " ".join("%.3f" % f44["p_method"][k] for k in cl)))
        elif sec.get("debut_props_pool"):
            d = sec["debut_props_pool"]
            print("  %-44s debut: primary kept; debut props pool (secondary) P(dist) %.3f vs primary %.3f" % (
                name, d["p_distance"], b["p_distance"]))
        else:
            print("  %-44s fwd-4.4 cells (%s)" % (name, rec.get("reason")))


def print_table_44(doc):
    L = doc["model"]["live_inputs"]
    print("\nfwd-4.4 inputs: %s" % ("live as of %s, manifest %s sha256 %s, Greco1899 %s" % (
        L["as_of"], L["manifest"], L["manifest_sha256"][:16], (L.get("greco_commit") or "local")[:12]) if L["used"]
        else "FALLBACK (fwd-4.3 pinned inputs): %s" % L["reason"]))


def print_table_43(doc):
    """fwd-4.3: the no-line primary (ML v2) next to the MoE no-line secondary."""
    print("\nno-line (fwd-4.3): p_a_noline (source) vs models.moe_noline (MoE)")
    for b in doc["bouts"]:
        mo = (b.get("models") or {}).get("moe_noline")
        print("  %-48s %s  %-28s  MoE %s" % ((b["a"]["name"] + " vs " + b["b"]["name"])[:48],
                                           "   -  " if b["p_a_noline"] is None else "%6.3f" % b["p_a_noline"],
                                           b.get("p_a_noline_source"), "  -  " if mo is None else "%.3f" % mo))


def print_table_42(doc):
    """fwd-4.2 additions: debut bouts' method vs the base-rate secondary, and the stat-line blocks."""
    cl = ("a_ko", "a_sub", "a_dec", "draw", "b_dec", "b_sub", "b_ko")
    for b in doc["bouts"]:
        sec = (b.get("p_method_secondary") or {}).get("division_base_rates")
        if not sec:
            continue
        print("\ndebut bout %s vs %s (p_a %.4f, %s): p_method (%s)" % (b["a"]["name"], b["b"]["name"], b["p_a"],
                                                                     b["debut_method"]["p_w_source"], " ".join(cl)))
        print("  debut method model  " + " ".join("%6.3f" % b["p_method"][k] for k in cl) + "   p_distance %.3f" % b["p_distance"])
        print("  division base rates " + " ".join("%6.3f" % sec["p_method"][k] for k in cl) + "   p_distance %.3f" % sec["p_distance"])
        dm = b["debut_method"]
        print("  P(KO/SUB/DEC | a wins) %s, | b wins %s; debut_model P(a) %s" % (
            "/".join("%.3f" % v for v in dm["given_a"]), "/".join("%.3f" % v for v in dm["given_b"]),
            "%.4f" % b["models"]["debut_model"] if b["models"].get("debut_model") is not None else "-"))
    print("\nstat lines (P10 / P50 / P90 (mean)); length: P(distance), expected minutes")
    for b in doc["bouts"]:
        s = b.get("statlines")
        if not s:
            continue
        print("%s vs %s  [P(dist) %.3f, %.1f min]" % (b["a"]["name"], b["b"]["name"], s["length"]["p_distance"],
                                                     s["length"]["mean_minutes"]))
        for side in ("a", "b"):
            print("  %-22s " % b[side]["name"][:22] + "  ".join("%s %d/%d/%d (%.1f)" % (k, v["p10"], v["p50"], v["p90"], v["mean"])
                                                             for k, v in s[side].items()))


def print_table(doc):
    print("%s  %s  lock %s  (%d bouts)" % (doc["date"], doc["event"], doc["lock_utc"], len(doc["bouts"])))
    print("%-48s %6s %6s %6s %6s %6s %6s %6s  %s" % ("bout (a vs b)", "p_a", "line", "noline", "ml2c", "ml2lr", "mkt", "elo",
                                                    "flags"))
    for b in doc["bouts"]:
        mk = (b.get("market") or {}).get("p_a_novig")
        m = b.get("models") or {}
        f = lambda v: "   -  " if v is None else "%6.3f" % v
        print("%-48s %s %s %s %s %s %s %s  %s" % ((b["a"]["name"] + " vs " + b["b"]["name"])[:48], f(b["p_a"]),
                                                f(b["p_a_line"]), f(b["p_a_noline"]), f(m.get("ml2_stack_close")),
                                                f(m.get("ml2_lr")), f(mk), f(b["p_elo"]), ",".join(b["flags"])))


# ====================================================================== results
def ledger_files(d):
    out = []
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        m = LEDGER_RE.match(os.path.basename(f))
        if m and not os.path.basename(f).startswith(("odds_snapshot", "cards_upcoming")):
            out.append(f)
    return out


def scored_files(d):
    """Per event: the latest file created before its lock (README rule 2)."""
    by = {}
    for f in ledger_files(d):
        doc = jload(f)
        if not doc or "bouts" not in doc:
            continue
        created, lock = parse_utc(doc["created_utc"]), parse_utc(doc["lock_utc"])
        committed = git("log", "--diff-filter=A", "--format=%cI", "--", os.path.relpath(f, ROOT))
        ct = parse_utc(committed.splitlines()[-1]) if committed else None
        ok = created < lock and (ct is None or ct < lock)
        key = (doc["date"], slugify(doc["event"]))
        if ok and (key not in by or created > by[key][1]):
            by[key] = (f, created, doc, ct)
    return [v for _, v in sorted(by.items())]


def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    with open(dest, "wb") as fh:
        fh.write(data)
    return data


def greco_results(events, stamp_dir):
    """ufcstats results (Greco1899 CSV refresh) for the given ledger events only: {(date, norm a, norm b): row}."""
    os.makedirs(stamp_dir, exist_ok=True)
    evd = fetch(GRECO + "ufc_event_details.csv", os.path.join(stamp_dir, "ufc_event_details.csv")).decode("utf-8", "replace")
    want = {e["date"]: e for e in events}
    names = {}
    for row in csv.DictReader(io.StringIO(evd)):
        try:
            d = dt.datetime.strptime(row["DATE"].strip(), "%B %d, %Y").date().isoformat()
        except Exception:
            continue
        if d in want:
            names[row["EVENT"].strip()] = d
    if not names:
        return {}, []
    frd = fetch(GRECO + "ufc_fight_results.csv", os.path.join(stamp_dir, "ufc_fight_results.csv")).decode("utf-8", "replace")
    out = {}
    for row in csv.DictReader(io.StringIO(frd)):
        ev = row["EVENT"].strip()
        if ev not in names:
            continue
        parts = re.split(r"\s+vs\.?\s+", row["BOUT"].strip())
        if len(parts) != 2:
            continue
        out[(names[ev], norm_name(parts[0]), norm_name(parts[1]))] = {
            "outcome": row["OUTCOME"].strip(), "method": row["METHOD"].strip(), "round": row["ROUND"].strip(),
            "time": row["TIME"].strip(), "details": row["DETAILS"].strip(), "url": row["URL"].strip(), "event": ev}
    return out, sorted(names)


def _of(s):
    """ufcstats "x of y" -> (x, y); anything else -> (None, None)."""
    m = re.match(r"^\s*(\d+)\s+of\s+(\d+)\s*$", s or "")
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def _int(s):
    """A count as the Greco CSV writes it: "2" or, in most rows, "2.0"; anything else -> None."""
    m = re.match(r"^\s*(\d+)(?:\.0+)?\s*$", s or "")
    return int(m.group(1)) if m else None


def _mmss(s):
    m = re.match(r"^\s*(\d+):(\d\d)\s*$", s or "")
    return 60 * int(m.group(1)) + int(m.group(2)) if m else None


def stat_row(row):
    """One ufcstats per-round row (Greco1899 ufc_fight_stats.csv) -> the fwd-4.2 stat-line stats."""
    sl, sa = _of(row.get("SIG.STR."))
    tl, ta = _of(row.get("TD"))
    return {"sig_lnd": sl, "sig_att": sa, "td_lnd": tl, "td_att": ta, "ctrl": _mmss(row.get("CTRL")),
            "kd": _int(row.get("KD")), "sub_att": _int(row.get("SUB.ATT"))}


def parse_greco_stats(event_details_text, fight_stats_text, dates):
    """ufcstats per-round stat rows for events on the given dates: {(date, norm a, norm b): {"event", "fighters":
    {norm fighter: {round: stats}}}}. A round already seen for a fighter is kept (an event listed twice counts once)."""
    names = {}
    for row in csv.DictReader(io.StringIO(event_details_text)):
        try:
            d = dt.datetime.strptime(row["DATE"].strip(), "%B %d, %Y").date().isoformat()
        except Exception:
            continue
        if d in dates:
            names[row["EVENT"].strip()] = d
    out = {}
    if not names:
        return out
    for row in csv.DictReader(io.StringIO(fight_stats_text)):
        ev = (row.get("EVENT") or "").strip()
        if ev not in names:
            continue
        parts = re.split(r"\s+vs\.?\s+", (row.get("BOUT") or "").strip())
        m = re.match(r"^Round (\d+)$", (row.get("ROUND") or "").strip())
        if len(parts) != 2 or not m:
            continue
        rec = out.setdefault((names[ev], norm_name(parts[0]), norm_name(parts[1])), {"event": ev, "fighters": {}})
        fr = rec["fighters"].setdefault(norm_name(row.get("FIGHTER")), {})
        fr.setdefault(int(m.group(1)), stat_row(row))
    return out


def greco_stats(dates, stamp_dir):
    """Fetch (or reuse this run's copies of) ufc_event_details.csv and ufc_fight_stats.csv; parse for the dates."""
    os.makedirs(stamp_dir, exist_ok=True)
    texts = []
    for name in ("ufc_event_details.csv", "ufc_fight_stats.csv"):
        p = os.path.join(stamp_dir, name)
        data = open(p, "rb").read() if os.path.exists(p) else fetch(GRECO + name, p)
        texts.append(data.decode("utf-8", "replace"))
    return parse_greco_stats(texts[0], texts[1], set(dates))


def match_stats(doc, GS, have, results):
    """Stat totals for one ledger file's stat-line bouts: only bouts with a verified win / draw result in results.json,
    and only when both fighters' rows cover every round through the result's round (README "Forward model v4.2")."""
    out = []
    res = {r["bout_id"]: r for r in results}
    gk = {(a, b): v for (d, a, b), v in GS.items() if d == doc["date"]}
    gnames_ = {x for k in gk for x in k}
    for b in doc["bouts"]:
        r = res.get(b["bout_id"])
        if (not b.get("statlines") or b["bout_id"] in have or not r or not r.get("verified") or r.get("conflict")
                or r.get("outcome") not in ("win", "draw") or not isinstance(r.get("round"), int)):
            continue
        sl = lambda side: " ".join((b[side].get("slug") or "").split("-"))
        nm2 = lambda n, side, cands: name_match(n, cands) or (name_match(sl(side), cands) if sl(side) else None)
        na, nb = norm_name(b["a"]["name"]), norm_name(b["b"]["name"])
        ga, gb = nm2(na, "a", gnames_), nm2(nb, "b", gnames_)
        g = (gk.get((ga, gb)) or gk.get((gb, ga))) if ga and gb else None
        if not g:
            continue
        fa, fb = nm2(na, "a", set(g["fighters"])), nm2(nb, "b", set(g["fighters"]))
        if not fa or not fb or fa == fb:
            continue
        rounds = list(range(1, r["round"] + 1))
        if any(k not in g["fighters"][f] for f in (fa, fb) for k in rounds):
            continue
        tot = {}
        for side, f in (("a", fa), ("b", fb)):
            rows = [g["fighters"][f][k] for k in rounds]
            tot[side] = {s: (None if any(x[s] is None for x in rows) else sum(x[s] for x in rows)) for s in STAT_KEYS}
            tot[side]["ufcstats_name"] = f
        out.append({"bout_id": b["bout_id"], "a": tot["a"], "b": tot["b"], "rounds": r["round"], "event": g["event"],
                    "source": "ufcstats per-round rows (Greco1899 ufc_fight_stats.csv), summed through the result's "
                              "round", "recorded_utc": iso(now_utc())})
    return out


def espn_results(dates, stamp_dir):
    """Winner flags from ESPN's public scoreboard JSON: {(date, norm a, norm b): {winner_name, round, clock}}."""
    out = {}
    for d in dates:
        for dd in sorted({d, (dt.date.fromisoformat(d) + dt.timedelta(days=1)).isoformat()}):
            try:
                raw = fetch(ESPN % dd.replace("-", ""), os.path.join(stamp_dir, "espn_%s.json" % dd))
                j = json.loads(raw)
            except Exception:
                continue
            for ev in j.get("events", []):
                for c in ev.get("competitions", []):
                    cs = c.get("competitors") or []
                    st = (c.get("status") or {}).get("type") or {}
                    if len(cs) != 2 or not st.get("completed"):
                        continue
                    nm = [norm_name(x["athlete"]["displayName"]) for x in cs]
                    win = [x.get("winner") for x in cs]
                    w = nm[0] if win[0] else (nm[1] if win[1] else None)
                    rec = {"winner": w, "round": (c.get("status") or {}).get("period"),
                           "clock": (c.get("status") or {}).get("displayClock"), "event": ev.get("name")}
                    out[(d, nm[0], nm[1])] = rec
                    out[(d, nm[1], nm[0])] = rec
    return out


def name_match(n, cands):
    """n vs a set of normalized names: exact, else same last token + same first initial."""
    if n in cands:
        return n
    t = n.split()
    for c in cands:
        u = c.split()
        if t and u and t[-1] == u[-1] and t[0][0] == u[0][0]:
            return c
    return None


def map_method(m):
    m = (m or "").upper()
    if m.startswith("KO") or "TKO" in m or "DOCTOR" in m:
        return "KO/TKO"
    if m.startswith("SUB"):
        return "SUB"
    if "DEC" in m:
        return m.title()
    if "DQ" in m:
        return "DQ"
    return m.title() or None


def match_results(doc, G, S, have):
    """Results for one ledger file's bouts from the ufcstats (G) and ESPN (S) tables; only ledger bouts are returned."""
    out = []
    gk = {(a, b): v for (d, a, b), v in G.items() if d == doc["date"]}
    gnames_ = {x for k in gk for x in k}
    sk = {(a, b): v for (d, a, b), v in S.items() if d == doc["date"]}
    snames_ = {x for k in sk for x in k}
    for b in doc["bouts"]:
        if b["bout_id"] in have:
            continue
        na, nb = norm_name(b["a"]["name"]), norm_name(b["b"]["name"])
        # the roster slug is the ufcstats spelling ("Ko Seok-hyeon" is "SeokHyeon Ko" there): fall back to it
        sl = lambda side: " ".join((b[side].get("slug") or "").split("-"))
        nm2 = lambda n, side, cands: name_match(n, cands) or (name_match(sl(side), cands) if sl(side) else None)
        ga, gb = nm2(na, "a", gnames_), nm2(nb, "b", gnames_)
        rec = None
        if ga and gb:
            if (ga, gb) in gk:
                g, flip = gk[(ga, gb)], False
            elif (gb, ga) in gk:
                g, flip = gk[(gb, ga)], True
            else:
                g = None
            if g:
                o = g["outcome"]
                first = {"W/L": "first", "L/W": "second"}.get(o)
                if first:
                    winner = ("a" if first == "first" else "b") if not flip else ("b" if first == "first" else "a")
                    outcome = "win"
                elif o == "D/D":
                    winner, outcome = None, "draw"
                else:
                    winner, outcome = None, "nc"
                rec = {"bout_id": b["bout_id"], "outcome": outcome, "winner": winner,
                       "method": map_method(g["method"]), "round": int(g["round"]) if g["round"].isdigit() else None,
                       "time": g["time"], "details": g["details"], "sources": [g["url"] or "ufcstats via Greco1899"]}
        ea, eb = nm2(na, "a", snames_), nm2(nb, "b", snames_)
        if ea and eb and (ea, eb) in sk:
            s = sk[(ea, eb)]
            w_espn = None if s["winner"] is None else ("a" if s["winner"] == ea else "b")
            if rec is None:
                rec = {"bout_id": b["bout_id"], "outcome": "win" if w_espn else "unknown", "winner": w_espn,
                       "method": None, "round": s["round"], "time": s["clock"], "sources": []}
            rec["sources"].append("ESPN scoreboard (%s)" % s["event"])
            if rec["outcome"] == "win" and w_espn and w_espn != rec["winner"]:
                rec["conflict"] = "ufcstats winner %s, ESPN winner %s" % (rec["winner"], w_espn)
        if rec is None:
            continue
        rec["verified"] = len(rec["sources"]) >= 2 and "conflict" not in rec
        rec["closing_odds"] = closing_for(b["bout_id"])
        rec["recorded_utc"] = iso(now_utc())
        out.append(rec)
    return out


def cmd_score(args):
    os.makedirs(args.dir, exist_ok=True)
    rpath = os.path.join(args.dir, "results.json")
    R = jload(rpath, {"results": []})
    have = {r["bout_id"] for r in R["results"]}
    files = scored_files(args.dir)
    today = now_utc().date().isoformat()
    new = []
    if args.manual:
        for r in jload(args.manual)["results"]:
            if r["bout_id"] not in have:
                r.setdefault("recorded_utc", iso(now_utc()))
                r.setdefault("sources", ["manual"])
                new.append(r)
                have.add(r["bout_id"])
    pending = [(f, doc) for f, _, doc, _ in files if doc["date"] < today and any(b["bout_id"] not in have for b in doc["bouts"])]
    if pending and not args.no_fetch:
        stamp_dir = os.path.join(FETCH_DIR, now_utc().strftime("%Y%m%d-%H%M"))
        evs = [{"date": doc["date"], "event": doc["event"]} for _, doc in pending]
        try:
            G, _ = greco_results(evs, stamp_dir)
        except Exception as ex:
            print("ufcstats (Greco1899 CSV) fetch failed: %r" % ex)
            G = {}
        try:
            S = espn_results(sorted({e["date"] for e in evs}), stamp_dir)
        except Exception as ex:
            print("ESPN fetch failed: %r" % ex)
            S = {}
        for _, doc in pending:
            for rec in match_results(doc, G, S, have):
                # README: results come from two independent sources. results.json is append-only, so a single-source
                # or conflicting record would be frozen in; it waits for a later run (or --manual) instead
                if not rec.get("verified"):
                    print("pending (not recorded): %s %s, sources %s%s" % (rec["bout_id"], rec.get("outcome"),
                          rec.get("sources"), ", " + rec["conflict"] if rec.get("conflict") else ""))
                    continue
                new.append(rec)
                have.add(rec["bout_id"])
    if new:
        R["results"].extend(new)
        tmp = rpath + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(R, fh, indent=1)
            fh.write("\n")
        os.replace(tmp, rpath)
        print("results.json: +%d results (append-only)" % len(new))
    # fwd-4.2 stat lines: ufcstats per-fight totals for bouts with a verified win / draw (append-only file)
    spath = os.path.join(args.dir, "statlines_results.json")
    SR = jload(spath, {"results": []})
    have_s = {x["bout_id"] for x in SR["results"]}
    res_by = {x["bout_id"]: x for x in R["results"]}
    want_s = [(f, doc) for f, _, doc, _ in files
              if any(b.get("statlines") and b["bout_id"] not in have_s and (res_by.get(b["bout_id"]) or {}).get("verified")
                     for b in doc["bouts"])]
    new_s = []
    if want_s and not args.no_fetch:
        stamp_dir = os.path.join(FETCH_DIR, now_utc().strftime("%Y%m%d-%H%M"))
        try:
            GS = greco_stats(sorted({doc["date"] for _, doc in want_s}), stamp_dir)
        except Exception as ex:
            print("ufcstats stats (Greco1899 CSV) fetch failed: %r" % ex)
            GS = {}
        for _, doc in want_s:
            for rec in match_stats(doc, GS, have_s, R["results"]):
                new_s.append(rec)
                have_s.add(rec["bout_id"])
    if new_s:
        SR["results"].extend(new_s)
        tmp = spath + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(SR, fh, indent=1)
            fh.write("\n")
        os.replace(tmp, spath)
        print("statlines_results.json: +%d stat records (append-only)" % len(new_s))
    S = compute_scores(files, R["results"], args.boot, SR["results"])
    with open(os.path.join(args.dir, "scores.json"), "w") as fh:
        json.dump(S, fh, indent=1)
        fh.write("\n")
    with open(os.path.join(args.dir, "scores.md"), "w") as fh:
        fh.write(scores_md(S))
    print(scores_md(S))


def closing_for(bid):
    """Closing-line proxy from tools/odds_upcoming.py's timeline: the last capture before the bout started."""
    T = jload(os.path.join(DERIVED, "odds_upcoming.json"), {"bouts": []})
    for b in T.get("bouts", []):
        if b.get("bout_id") == bid:
            caps = [c for c in b.get("captures", []) if c.get("phase") == "pre_start"]
            if not caps:
                return None
            c = caps[-1]
            return {"source": "odds_upcoming last pre-start capture %s" % c.get("snapshot"), "captured_utc": c.get("t"),
                    "odds_a": (c.get("bfo_odds") or [None, None])[0], "odds_b": (c.get("bfo_odds") or [None, None])[1],
                    "p_a_novig": c.get("bfo_p_a_novig"), "p_a_consensus": c.get("p_consensus")}
    return None


# ====================================================================== scoring
COLS = [("p_a", "headline (stack + line at prediction)"), ("p_a_noline", "stack without a line"),
        ("p_elo", "walk-forward Elo"), ("market_pred", "market at prediction (BFO mean, no-vig)"),
        ("market_close", "closing line (no-vig)"), ("coin", "coin flip")]


def _ll(p, y):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return -(y * math.log(p) + (1 - y) * math.log(1 - p))


def _metrics(v):
    """[(p, y)] -> n, log loss, Brier, accuracy (a 0.5 forecast counts half)."""
    return {"n": len(v), "log_loss": sum(_ll(p, y) for p, y in v) / len(v),
            "brier": sum((p - y) ** 2 for p, y in v) / len(v),
            "accuracy": sum(0.5 if abs(p - 0.5) < 1e-12 else float((p > 0.5) == (y > 0.5)) for p, y in v) / len(v)}


def boot_ci(vals, clusters, B=2000, seed=11, units=None):
    """95% interval of a mean paired difference: the event-cluster bootstrap, widened to the bout-level bootstrap
    wherever that is wider. With one event the cluster bootstrap collapses to a point ([x, x] would 'exclude zero'),
    and with a handful of events it is far too narrow; the envelope is never narrower than either. units: the
    resampling unit of the bout-level bootstrap per value (default: each value is its own bout); the fwd-4.2 stat
    lines pass the bout id, so a bout's two fight-sides are resampled together (README "Forward model v4.2")."""
    import random

    def pct(cl, sd):
        rng = random.Random(sd)
        uc = sorted(set(cl))
        by = {c: [v for v, k in zip(vals, cl) if k == c] for c in uc}
        est = []
        for _ in range(B):
            s = n = 0
            for _ in uc:
                c = uc[rng.randrange(len(uc))]
                s += sum(by[c])
                n += len(by[c])
            if n:
                est.append(s / n)
        est.sort()
        return (est[int(0.025 * len(est))], est[int(0.975 * len(est)) - 1]) if est else None

    ev, bt = pct(clusters, seed), pct(list(range(len(vals))) if units is None else list(units), seed + 1)
    if not ev or not bt:
        return None
    return {"est": sum(vals) / len(vals), "lo": min(ev[0], bt[0]), "hi": max(ev[1], bt[1]),
            "lo_event": ev[0], "hi_event": ev[1], "lo_bout": bt[0], "hi_bout": bt[1],
            "n": len(vals), "n_events": len(set(clusters))}


def pois_dev(y, mu):
    """Poisson deviance of a mean (research/model_statlines.md): 2 [y ln(y / mu) - (y - mu)]."""
    mu = max(mu, 1e-10)
    return 2 * ((y * math.log(y / mu) if y > 0 else 0.0) - (y - mu))


def method_probs(pm, winner, k):
    """7-way cell, method given the winner, marginal KO / SUB / DEC of the actual outcome."""
    p7 = pm.get("%s_%s" % (winner, k))
    ws = sum(pm["%s_%s" % (winner, x)] for x in ("ko", "sub", "dec"))
    m3 = (pm["a_" + k] + pm["b_" + k]) / max(1 - pm.get("draw", 0.0), 1e-12)
    return p7, p7 / max(ws, 1e-12), m3


def score_method_debut(rows, B):
    """fwd-4.2: debut method (primary) vs division base rates (secondary) on bouts with a debutant, per version."""
    out = {}
    nl = lambda x: -math.log(max(x, 1e-6))
    for v in sorted({r["version"] for r in rows}):
        rs = [r for r in rows if r["version"] == v]
        o = {"n": len(rs), "n_events": len({r["date"] for r in rs}), "primary": {}, "base_rates": {}, "paired": {}}
        cl = [r["date"] for r in rs]
        for j, name in enumerate(("log_loss_7way", "log_loss_given_winner", "log_loss_method3")):
            a = [nl(r["prim"][j]) for r in rs]
            c = [nl(r["sec"][j]) for r in rs]
            o["primary"][name], o["base_rates"][name] = sum(a) / len(a), sum(c) / len(c)
            o["paired"][name] = boot_ci([x - y for x, y in zip(a, c)], cl, B) if len(rs) >= 2 else None
        a = [(r["dist"][0] - r["dist"][2]) ** 2 for r in rs]
        c = [(r["dist"][1] - r["dist"][2]) ** 2 for r in rs]
        o["primary"]["distance_brier"], o["base_rates"]["distance_brier"] = sum(a) / len(a), sum(c) / len(c)
        o["paired"]["distance_brier"] = boot_ci([x - y for x, y in zip(a, c)], cl, B) if len(rs) >= 2 else None
        out[v] = o
    return out


METHOD_SECONDARIES_45 = ("fwd44_cells", "debut_props_pool")    # README v4.5 item 6


def score_method_secondary(rows, B):
    """fwd-4.5: each method secondary (fwd44_cells, debut_props_pool) against its bout's primary, per version and secondary;
    the metrics and intervals of fwd-4.2's debut method scoring (paired: primary minus secondary)."""
    out = {}
    nl = lambda x: -math.log(max(x, 1e-6))
    for v in sorted({r["version"] for r in rows}):
        ov = {}
        for key in METHOD_SECONDARIES_45:
            rs = [r for r in rows if r["version"] == v and r["key"] == key]
            if not rs:
                continue
            o = {"n": len(rs), "n_events": len({r["date"] for r in rs}), "primary": {}, "secondary": {}, "paired": {}}
            cl = [r["date"] for r in rs]
            for j, name in enumerate(("log_loss_7way", "log_loss_given_winner", "log_loss_method3")):
                a = [nl(r["prim"][j]) for r in rs]
                c = [nl(r["sec"][j]) for r in rs]
                o["primary"][name], o["secondary"][name] = sum(a) / len(a), sum(c) / len(c)
                o["paired"][name] = boot_ci([x - y for x, y in zip(a, c)], cl, B) if len(rs) >= 2 else None
            a = [(r["dist"][0] - r["dist"][2]) ** 2 for r in rs]
            c = [(r["dist"][1] - r["dist"][2]) ** 2 for r in rs]
            o["primary"]["distance_brier"], o["secondary"]["distance_brier"] = sum(a) / len(a), sum(c) / len(c)
            o["paired"]["distance_brier"] = boot_ci([x - y for x, y in zip(a, c)], cl, B) if len(rs) >= 2 else None
            ov[key] = o
        out[v] = ov
    return out


def score_statlines(rows, B):
    """fwd-4.2 stat lines vs ufcstats totals, per version and stat (fight-sides)."""
    out = {}
    for v in sorted({r["version"] for r in rows}):
        mv = {}
        for st in STAT_KEYS:
            rs = [r for r in rows if r["version"] == v and r["stat"] == st]
            if not rs:
                continue
            dm = [pois_dev(r["y"], r["mean"]) for r in rs]
            db = [pois_dev(r["y"], r["blend_mean"]) for r in rs]
            n, nb = len(rs), len({r["bout_id"] for r in rs})
            mv[st] = {"n": n, "n_bouts": nb, "deviance_mean": sum(dm) / n,
                      "deviance_blend_mean": sum(db) / n,
                      "deviance_minus_blend": boot_ci([x - y for x, y in zip(dm, db)], [r["date"] for r in rs], B,
                                                      units=[r["bout_id"] for r in rs]) if nb >= 2 else None,
                      "coverage_p10_p90": sum(1 for r in rs if r["p10"] <= r["y"] <= r["p90"]) / n,
                      "above_p90": sum(1 for r in rs if r["y"] > r["p90"]) / n,
                      "below_p10": sum(1 for r in rs if r["y"] < r["p10"]) / n,
                      "mae_p50": sum(abs(r["y"] - r["p50"]) for r in rs) / n}
        out[v] = mv
    return out


def compute_scores(files, results, B, stats=None):
    res = {r["bout_id"]: r for r in results}
    srec = {x["bout_id"]: x for x in (stats or [])}
    rows, void, mrows, srows, mrows45 = [], [], [], [], []
    for f, created, doc, ct in files:
        for b in doc["bouts"]:
            r = res.get(b["bout_id"])
            if not r:
                continue
            # fwd-4.2 stat lines: verified win / draw results with ufcstats totals (README "Forward model v4.2")
            sx = srec.get(b["bout_id"])
            if (b.get("statlines") and sx and r.get("verified") and not r.get("conflict")
                    and r.get("outcome") in ("win", "draw")):
                for side in ("a", "b"):
                    for st in STAT_KEYS:
                        y, fc = (sx.get(side) or {}).get(st), (b["statlines"].get(side) or {}).get(st)
                        if y is None or not fc:
                            continue
                        srows.append({"version": doc["model"]["version"], "date": doc["date"], "bout_id": b["bout_id"],
                                      "side": side, "stat": st, "y": float(y), "mean": fc["mean"],
                                      "blend_mean": fc["blend_mean"], "p10": fc["p10"], "p50": fc["p50"], "p90": fc["p90"]})
            if r.get("outcome") != "win" or r.get("winner") not in ("a", "b") or r.get("conflict"):
                void.append({"bout_id": b["bout_id"], "outcome": r.get("outcome")})
                continue
            y = 1.0 if r["winner"] == "a" else 0.0
            close = (r.get("closing_odds") or {}).get("p_a_novig")
            pv = {"p_a": b.get("p_a"), "p_a_noline": b.get("p_a_noline"), "p_elo": b.get("p_elo"),
                  "market_pred": (b.get("market") or {}).get("p_a_novig"), "market_close": close, "coin": 0.5}
            m7 = None
            if b.get("p_method") and r.get("method"):
                k = {"KO/TKO": "ko", "SUB": "sub"}.get(r["method"], "dec" if "Dec" in str(r["method"]) else None)
                if k:
                    m7 = b["p_method"].get("%s_%s" % (r["winner"], k))
                    sec = (b.get("p_method_secondary") or {}).get("division_base_rates")
                    if sec:           # fwd-4.2 bout with a debutant: primary (debut method) vs base-rate secondary
                        went = 1.0 if k == "dec" else 0.0
                        mrows.append({"version": doc["model"]["version"], "date": doc["date"], "bout_id": b["bout_id"],
                                      "prim": method_probs(b["p_method"], r["winner"], k),
                                      "sec": method_probs(sec["p_method"], r["winner"], k),
                                      "dist": (b["p_distance"], sec["p_distance"], went)})
                    for key in METHOD_SECONDARIES_45:      # fwd-4.5 (README v4.5 item 6): primary vs each secondary
                        s45 = (b.get("p_method_secondary") or {}).get(key)
                        if s45:
                            mrows45.append({"version": doc["model"]["version"], "date": doc["date"], "bout_id": b["bout_id"],
                                            "key": key, "prim": method_probs(b["p_method"], r["winner"], k),
                                            "sec": method_probs(s45["p_method"], r["winner"], k),
                                            "dist": (b["p_distance"], s45["p_distance"], 1.0 if k == "dec" else 0.0)})
            rows.append({"bout_id": b["bout_id"], "event": doc["event"], "date": doc["date"], "file": os.path.basename(f),
                         "version": doc["model"]["version"], "y": y, "p": pv, "p_method_actual": m7,
                         "m": {k: v for k, v in (b.get("models") or {}).items() if v is not None},
                         "went_distance": None if not r.get("method") else (1.0 if "Dec" in str(r["method"]) else 0.0),
                         "p_distance": b.get("p_distance"), "verified": r.get("verified", False),
                         "flags": b.get("flags", [])})
    out = {"tool": TOOL, "built": iso(now_utc()), "n_scored": len(rows), "n_void": len(void), "void": void,
           "n_single_source": sum(1 for r in rows if not r["verified"]), "columns": dict(COLS), "overall": {},
           "paired": {}, "by_event": [], "by_version": {}, "method": None, "distance": None}

    def block(rs):
        o = {}
        for k, _ in COLS:
            v = [(r["p"][k], r["y"]) for r in rs if r["p"].get(k) is not None]
            if not v:
                continue
            o[k] = {"n": len(v), "log_loss": sum(_ll(p, y) for p, y in v) / len(v),
                    "brier": sum((p - y) ** 2 for p, y in v) / len(v),
                    "accuracy": sum(0.5 if abs(p - 0.5) < 1e-12 else float((p > 0.5) == (y > 0.5)) for p, y in v) / len(v)}
        return o
    out["overall"] = block(rows)
    for k in ("p_a", "p_a_noline", "p_elo"):
        for ref in ("market_pred", "market_close", "p_elo"):
            if ref == k:
                continue
            v = [(_ll(r["p"][k], r["y"]) - _ll(r["p"][ref], r["y"]), r["date"]) for r in rows
                 if r["p"].get(k) is not None and r["p"].get(ref) is not None]
            if len(v) >= 2:
                out["paired"]["%s - %s" % (k, ref)] = boot_ci([a for a, _ in v], [c for _, c in v], B)
    cum = []
    for d in sorted({r["date"] for r in rows}):
        ev = [r for r in rows if r["date"] == d]
        cum += ev
        out["by_event"].append({"date": d, "event": ev[0]["event"], "file": ev[0]["file"], "n": len(ev),
                                "event_scores": block(ev), "running": block(cum)})
    for v in sorted({r["version"] for r in rows}):
        out["by_version"][v] = block([r for r in rows if r["version"] == v])
    # models block (v4.1 files on): per model version, every model's metrics and its paired log-loss difference vs the
    # market at prediction time and vs the close, event-cluster bootstrap (same draws per comparison)
    out["models"] = {}
    order = list(MODEL_DEFS_43)
    for v in sorted({r["version"] for r in rows}):
        rs = [r for r in rows if r["version"] == v and r.get("m")]
        if not rs:
            continue
        mv = {}
        for k in sorted({k for r in rs for k in r["m"]}, key=lambda k: (order.index(k) if k in order else len(order), k)):
            o = _metrics([(r["m"][k], r["y"]) for r in rs if k in r["m"]])
            for ref in ("market_pred", "market_close"):
                d = [(_ll(r["m"][k], r["y"]) - _ll(r["p"][ref], r["y"]), r["date"]) for r in rs
                     if k in r["m"] and r["p"].get(ref) is not None]
                o["minus_" + ref] = boot_ci([a for a, _ in d], [c for _, c in d], B) if len(d) >= 2 else None
            mv[k] = o
        out["models"][v] = mv
    m = [r["p_method_actual"] for r in rows if r["p_method_actual"]]
    if m:
        out["method"] = {"n": len(m), "log_loss_7way": sum(-math.log(max(x, 1e-6)) for x in m) / len(m)}
    dd = [(r["p_distance"], r["went_distance"]) for r in rows if r["p_distance"] is not None and r["went_distance"] is not None]
    if dd:
        out["distance"] = {"n": len(dd), "brier": sum((p - y) ** 2 for p, y in dd) / len(dd)}
    # fwd-4.2 additions (README "Forward model v4.2", Scoring); absent until such bouts are scored
    if mrows:
        out["method_debut"] = score_method_debut(mrows, B)
    if mrows45:
        out["method_secondary"] = score_method_secondary(mrows45, B)
    if srows:
        out["statlines"] = score_statlines(srows, B)
        out["n_statline_bouts"] = len({r["bout_id"] for r in srows})
    return out


def scores_md(S):
    L = ["# Forward-test scores", "", "_Regenerated by `python3 tools/forward_ledger.py score` (%s). %d bouts scored, %d void, "
         "%d with a single results source. Log loss is the primary metric (coin 0.693); a lead over the market is not "
         "claimed until the paired interval excludes zero._" % (S["built"], S["n_scored"], S["n_void"], S["n_single_source"]), ""]
    if not S["n_scored"]:
        L.append("No scored bouts yet.")
        return "\n".join(L) + "\n"
    L += ["| column | n | log loss | Brier | accuracy |", "|---|---|---|---|---|"]
    for k, lab in COLS:
        o = S["overall"].get(k)
        if o:
            L.append("| %s (`%s`) | %d | %.4f | %.4f | %.1f%% |" % (lab, k, o["n"], o["log_loss"], o["brier"], 100 * o["accuracy"]))
    L += ["", "Paired log-loss differences (negative = the first column is better); 95% interval = event-cluster "
          "bootstrap, widened to the bout-level bootstrap where that is wider:", "",
          "| comparison | n | events | difference [95% CI] |", "|---|---|---|---|"]
    for k, c in S["paired"].items():
        if c:
            L.append("| %s | %d | %d | %+.4f [%+.4f, %+.4f] |" % (k, c["n"], c["n_events"], c["est"], c["lo"], c["hi"]))
    L += ["", "Running totals by event (log loss):", "", "| event | n | p_a | p_a_noline | Elo | market (pred) | close |",
          "|---|---|---|---|---|---|---|"]
    for e in S["by_event"]:
        r = e["running"]
        g = lambda k: ("%.4f" % r[k]["log_loss"]) if k in r else "-"
        L.append("| %s %s | %d | %s | %s | %s | %s | %s |" % (e["date"], e["event"], r["p_a"]["n"] if "p_a" in r else e["n"],
                                                             g("p_a"), g("p_a_noline"), g("p_elo"), g("market_pred"), g("market_close")))
    if S.get("method"):
        L += ["", "Method of victory (7-way log loss over p_method): %.4f on %d bouts." % (S["method"]["log_loss_7way"], S["method"]["n"])]
    if S.get("distance"):
        L += ["Goes the distance (Brier over p_distance): %.4f on %d bouts." % (S["distance"]["brier"], S["distance"]["n"])]
    if len(S["by_version"]) > 1:
        L += ["", "By model version:", ""]
        for v, o in S["by_version"].items():
            L.append("- %s: p_a %.4f (n %d)" % (v, o["p_a"]["log_loss"], o["p_a"]["n"]))
    ci = lambda c: "-" if not c else "%+.4f [%+.4f, %+.4f] (%d)" % (c["est"], c["lo"], c["hi"], c["n"])
    for v, mv in (S.get("models") or {}).items():
        L += ["", "Models block, %s (log loss; paired differences: negative = the model beats that market line; "
              "event-cluster bootstrap widened to the bout-level one where wider):" % v, "",
              "| model | n | log loss | Brier | accuracy | minus market at prediction [CI] (n) | minus close [CI] (n) |",
              "|---|---|---|---|---|---|---|"]
        for k, o in mv.items():
            L.append("| `%s` | %d | %.4f | %.4f | %.1f%% | %s | %s |" % (k, o["n"], o["log_loss"], o["brier"],
                                                                   100 * o["accuracy"], ci(o.get("minus_market_pred")),
                                                                   ci(o.get("minus_market_close"))))
    for v, o in (S.get("method_debut") or {}).items():
        L += ["", "Debut method model vs division base rates, %s (bouts with a debutant; %d bouts, %d events; paired "
              "differences: negative = the debut method model is better):" % (v, o["n"], o["n_events"]), "",
              "| metric | debut method | base rates | difference [CI] (n) |", "|---|---|---|---|"]
        for k in ("log_loss_7way", "log_loss_given_winner", "log_loss_method3", "distance_brier"):
            L.append("| %s | %.4f | %.4f | %s |" % (k, o["primary"][k], o["base_rates"][k], ci(o["paired"].get(k))))
    for v, ov in (S.get("method_secondary") or {}).items():
        for key, o in ov.items():
            lab = {"fwd44_cells": "props pool (primary) vs fwd-4.4's cells", "debut_props_pool":
                   "debut method model (primary) vs the debut-bout props pool (monitored)"}.get(key, key)
            L += ["", "Method secondary, %s: %s (%d bouts, %d events; paired differences: negative = the primary is "
                  "better):" % (v, lab, o["n"], o["n_events"]), "",
                  "| metric | primary | `%s` | difference [CI] (n) |" % key, "|---|---|---|---|"]
            for k in ("log_loss_7way", "log_loss_given_winner", "log_loss_method3", "distance_brier"):
                L.append("| %s | %.4f | %.4f | %s |" % (k, o["primary"][k], o["secondary"][k], ci(o["paired"].get(k))))
    for v, mv in (S.get("statlines") or {}).items():
        L += ["", "Stat lines, %s (fight-sides vs ufcstats totals; Poisson deviance of the mean, paired difference vs the "
              "blend mean: negative = the stat-line layer is better; band [p10, p90] inclusive):" % v, "",
              "| stat | n | deviance | blend deviance | difference [CI] (n) | in band | above p90 | below p10 | MAE p50 |",
              "|---|---|---|---|---|---|---|---|---|"]
        for st, o in mv.items():
            L.append("| %s | %d | %.3f | %.3f | %s | %.3f | %.3f | %.3f | %.2f |" % (
                st, o["n"], o["deviance_mean"], o["deviance_blend_mean"], ci(o.get("deviance_minus_blend")),
                o["coverage_p10_p90"], o["above_p90"], o["below_p10"], o["mae_p50"]))
    return "\n".join(L) + "\n"


def cmd_status(args):
    cards = load_cards(args.cards)
    R = jload(os.path.join(args.dir, "results.json"), {"results": []})
    have = {r["bout_id"] for r in R["results"]}
    files = {(jload(f) or {}).get("date"): f for f in ledger_files(args.dir)}
    for ev in cards["events"]:
        lock, _ = lock_of(ev)
        f = files.get(ev["date"])
        n_res = 0
        if f:
            doc = jload(f)
            n_res = sum(1 for b in doc["bouts"] if b["bout_id"] in have)
        print("%s  %-45s lock %s  %s  results %d" % (ev["date"], ev["name"][:45], iso(lock),
                                                   os.path.basename(f) if f else "no ledger file", n_res))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("predict")
    p.add_argument("--event", required=True, help="event date (YYYY-MM-DD) or a name substring")
    p.add_argument("--cards", default=os.path.join(PRED_DIR, "cards_upcoming.json"))
    p.add_argument("--dir", default=PRED_DIR, help="ledger directory (default data/predictions)")
    p.add_argument("--odds", default=None, help="odds snapshot stamp (default: the newest before the lock)")
    p.add_argument("--odds-dir", default=None)
    p.add_argument("--sims", type=int, default=2000, help="engine sims per corner order (default 2000)")
    p.add_argument("--engine-dir", default=None,
                   help="engine folder (default: src for fwd-4.1; fwd-4.2 to fwd-4.4 are pinned to versions/v4)")
    p.add_argument("--fwd", choices=["auto", "4.1", "4.2", "4.3", "4.4", "4.5"], default="auto",
                   help="forward model version; auto = the one data/predictions/README.md assigns to the event date "
                        "(fwd-4.5 from 2026-11-14, fwd-4.1 before); writing under another version is refused")
    p.add_argument("--headline", choices=["line", "noline"], default="line")
    p.add_argument("--live-dir", default=None, help="fwd-4.4 dry runs only: read the live inputs from this folder instead "
                                                    "of data/derived/live (tests)")
    p.add_argument("--props-dir", default=None, help="fwd-4.5 dry runs only: read the props snapshots from this folder "
                                                     "instead of data/predictions (tests)")
    p.add_argument("--stack", choices=["auto", "blindtest", "page"], default="auto",
                   help="MoE weights: blindtest = data/derived/blindtest_stack.json (refit with the current engine, blind-"
                        "tested by tools/blindtest.py), page = moe_page.json; auto = blindtest when the file exists")
    p.add_argument("--supersede", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--dry-out", default=None, help="with --dry-run: write the would-be file here (outside the ledger)")
    s = sub.add_parser("score")
    s.add_argument("--dir", default=PRED_DIR)
    s.add_argument("--no-fetch", action="store_true")
    s.add_argument("--manual", default=None)
    s.add_argument("--boot", type=int, default=2000)
    t = sub.add_parser("status")
    t.add_argument("--dir", default=PRED_DIR)
    t.add_argument("--cards", default=os.path.join(PRED_DIR, "cards_upcoming.json"))
    args = ap.parse_args()
    {"predict": cmd_predict, "score": cmd_score, "status": cmd_status}[args.cmd](args)


if __name__ == "__main__":
    main()
