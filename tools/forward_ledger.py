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
TOOL = "tools/forward_ledger.py 1.1"
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
    fj = jload(os.path.join(DERIVED, "fighters.json"))
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
        json.dump({"date": ev["date"], "sims": args.sims, "bouts": bouts_in}, fh)
        tmp = fh.name
    try:
        cmd = ["node", os.path.join(HERE, "forward_ledger.js"), tmp, "--engine-dir", args.engine_dir]
        if stack_file:
            cmd += ["--moe", os.path.relpath(stack_file, ROOT)]
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
    print_table(doc)
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
    S = compute_scores(files, R["results"], args.boot)
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


def boot_ci(vals, clusters, B=2000, seed=11):
    """95% interval of a mean paired difference: the event-cluster bootstrap, widened to the bout-level bootstrap
    wherever that is wider. With one event the cluster bootstrap collapses to a point ([x, x] would 'exclude zero'),
    and with a handful of events it is far too narrow; the envelope is never narrower than either."""
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

    ev, bt = pct(clusters, seed), pct(list(range(len(vals))), seed + 1)
    if not ev or not bt:
        return None
    return {"est": sum(vals) / len(vals), "lo": min(ev[0], bt[0]), "hi": max(ev[1], bt[1]),
            "lo_event": ev[0], "hi_event": ev[1], "lo_bout": bt[0], "hi_bout": bt[1],
            "n": len(vals), "n_events": len(set(clusters))}


def compute_scores(files, results, B):
    res = {r["bout_id"]: r for r in results}
    rows, void = [], []
    for f, created, doc, ct in files:
        for b in doc["bouts"]:
            r = res.get(b["bout_id"])
            if not r:
                continue
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
    order = list(MODEL_DEFS)
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
    p.add_argument("--engine-dir", default="src")
    p.add_argument("--headline", choices=["line", "noline"], default="line")
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
