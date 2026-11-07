"""Inline src/ and data/ into one self-contained page.

    python3 build.py                 # writes volk-gaethje-simulator.html (the published page)
    python3 build.py out/test.html   # writes somewhere else (handy for parallel work and tests)

The page loads three.js from a pinned CDN URL and inlines everything else: the engine and its
calibrated parameters (one script, so the tally Web Worker can be built from its text), the 3D rig,
arena, director, show and app scripts, and JSON blocks for the fighter roster, calibration results,
scenario presets and overrides (the roster, scouting files and likeness sheets ship gzip + base64 and the page inflates
them before it starts). Embedded binary assets (assets/embed/*) become data: URIs on
window.FightAssets. That is what the claude.ai artifact host allows.
"""
import base64
import json
import mimetypes
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# placeholder -> list of source files concatenated in order
SCRIPTS = {
    # engine v4: the learned stat-line adapter travels in the engine script, so the tally Web Worker built from this
    # script's text has MLRates too (the page posts the model JSON to the worker; FightEngine.loadMLRates)
    # v5.0.1 (v5 review): the page must run the same model as the Node production path; tests/test_page_parity.js checks it.
    # An engine whose params switch on embed / blend_anchor needs src/ml/embed.js / src/ml/blend.js here (ahead of engine3.js),
    # and durability / preufc / embed need their rosters loaded by src/app.js; otherwise switch them off for the page.
    "/*__ENGINE__*/": ["src/params3.js", "src/ml/mlrates.js", "src/styles_sos.js", "src/engine3.js"],
    "/*__RIG__*/": ["src/rig3d.js"],
    "/*__AVATAR__*/": ["src/avatar3d.js"],
    "/*__ARENA__*/": ["src/arena3d.js"],
    "/*__DIRECTOR__*/": ["src/director3.js"],
    "/*__SHOW__*/": ["src/show3d.js"],
    "/*__APP__*/": ["src/app.js"],
    # verified browser models (page pass 3, Nov 7, 2026): the ML v2 winner model and its three stacks (src/ml/ml2.js with
    # forward_models.json's fit-2019-2023 weights), the page recipe (src/ml/pagepredict.js), method x round S / S2
    # (tools/methodround_model.js), the distributional stat lines (statdist + the embedding it reads), the debut method
    # model, and moe.js for its de-vig helpers only (its stack no longer decides anything on the page)
    "/*__ML__*/": ["src/ml/moe.js", "src/ml/ml2.js", "src/ml/pagepredict.js", "tools/methodround_model.js",
                   "src/ml/statdist.js", "src/ml/embed.js", "src/ml/debut.js"],
    # broadcast sound (FightAudio); optional until the 3D workstream lands it
    "/*__AUDIO__*/": ["src/audio.js"],
}

# placeholder -> JSON file (minified and made safe inside <script type="application/json">)
JSON_BLOCKS = {
    "/*__CALIB_JSON__*/": "data/derived/calibration.json",
    "/*__SCENARIOS_JSON__*/": "data/scenarios.json",
    "/*__OVERRIDES_JSON__*/": "data/overrides.json",
}

ASSETS_MARKER = "/*__ASSETS__*/"
ASSETS_DIR = os.path.join(ROOT, "assets", "embed")
MAX_BYTES = 15 * 1024 * 1024


# pieces another workstream may not have written yet: missing ones build as empty with a warning
OPTIONAL = {"src/avatar3d.js": "", "src/director3.js": "", "data/derived/calibration.json": "null", "data/scenarios.json": "{}",
            "src/audio.js": "", "src/ml/moe.js": "", "src/ml/mlrates.js": "", "src/ml/mlpage.js": "",
            "tools/methodround_model.js": "", "src/ml/statdist.js": "", "src/ml/embed.js": "", "src/ml/debut.js": ""}

# the fighter roster: gzip + base64 (about a quarter of the plain JSON); the page inflates it before anything else runs.
# The plain placeholder still works for older page sources.
FIGHTERS_GZ_MARKER = "/*__FIGHTERS_GZ__*/"
FIGHTERS_JSON_MARKER = "/*__FIGHTERS_JSON__*/"
FIGHTERS_FILE = "data/derived/fighters.json"

# optional block: scouting files and likeness sheets by slug, inlined only when the page asks for them
# (gzip + base64 under SCOUTING_GZ_MARKER, plain JSON under SCOUTING_MARKER for older page sources)
SCOUTING_MARKER = "/*__SCOUTING_JSON__*/"
SCOUTING_GZ_MARKER = "/*__SCOUTING_GZ__*/"
SCOUTING_DIRS = (("data/scouting", "scouting"), ("data/likeness", "likeness"))


def read(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path) and rel in OPTIONAL:
        print("warning: " + rel + " is missing; building without it", file=sys.stderr)
        return OPTIONAL[rel]
    with open(path, encoding="utf-8") as f:
        return f.read()


def safe_json(rel):
    data = json.loads(read(rel))
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    # "</" inside a script block would end it; "<\/" is the same JSON string
    return text.replace("</", "<\\/")


def scouting_data():
    out = {}
    for rel, key in SCOUTING_DIRS:
        out[key] = {}
        d = os.path.join(ROOT, rel)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json") or name.startswith("."):
                continue
            try:
                with open(os.path.join(d, name), encoding="utf-8") as f:
                    out[key][name[:-5]] = json.load(f)
            except ValueError as e:
                print("warning: skipping " + rel + "/" + name + " (" + str(e) + ")", file=sys.stderr)
    return out


def scouting_json():
    text = json.dumps(scouting_data(), separators=(",", ":"), ensure_ascii=False)
    return text.replace("</", "<\\/")


# ------------------------------------------------------------------ model blocks (derived at build time)
# Each returns a JSON-serialisable object, or None when its source is missing (the page then shows the
# model as unavailable). Only what the browser evaluators read is kept, so the page stays small.

def load_json(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except ValueError as e:
        print("warning: " + rel + " is not valid JSON (" + str(e) + ")", file=sys.stderr)
        return None


def mlrates_block():
    return load_json("data/derived/mlrates.json")


def methodround_block():
    d = load_json("data/derived/methodround.json")
    if not d or "js_model" not in d:
        return None
    jm = dict(d["js_model"])
    jm.pop("source", None)          # the evaluator's own source text; the page inlines tools/methodround_model.js
    return jm


def g(o, *path):
    for p in path:
        if not isinstance(o, dict) or p not in o:
            return None
        o = o[p]
    return o


# ------------------------------------------------------------------ page pass 3 (Nov 7, 2026): the verified prediction stack

def ml2_block():
    """ML v2 page model (ml2.json page_model: terms, roster, ratings, market rating) with the forward ledger's fit-2019-2023
    stack weights (forward_models.json ml2_static), not the 2019-2025 production refit: the ledger scores these weights,
    and on the sealed 2026 fights they beat the refit in all three regimes (research/vault_audit_v5.md section 2)."""
    m = load_json("data/derived/ml2.json")
    fm = load_json("data/derived/forward_models.json")
    if not m or "page_model" not in m or not fm or "ml2_static" not in fm:
        print("warning: ml2.json / forward_models.json missing; the page falls back to the simulator for the winner", file=sys.stderr)
        return None
    pm = {k: v for k, v in m["page_model"].items() if k not in ("test_vectors", "train", "stack")}
    stack, info = {}, {}
    for reg in ("line", "open", "noline"):
        st = fm["ml2_static"][reg]
        stack[reg] = {"inputs": st["inputs"], "weights": st["weights"], "pclip": st.get("pclip", 0.01)}
        info[reg] = {"weights_4dp": st.get("weights_published_4dp"), "fit": st.get("fit"), "cv_2021_2023": st.get("cv_2021_2023"),
                     "valid_2024_2025": st.get("valid_2024_2025_static"), "half_life": st.get("recency_half_life_years")}
    pm["stack"] = stack
    pm["page_meta"] = {"ml2_built": g(m, "meta", "built"), "weights_built": g(fm, "meta", "built"),
                       "weights_source": "data/derived/forward_models.json ml2_static (tools/forward_models.py)", "stacks": info}
    return pm


def s2_block():
    """Method x round S2 (tools/v6_prep.py s2 -> mr_s2.json js_model, fit 2012-2025; research/model_ml2.md section 7),
    evaluated by tools/methodround_model.js createS2 on top of the S model (mr-gz block). The parity vectors stay out."""
    d = load_json("data/derived/mr_s2.json")
    if not d or "js_model" not in d:
        return None
    return {k: v for k, v in d["js_model"].items() if k != "vectors"}


STATDIST_KEYS = ("stats", "labels", "mlrates_targets", "glm_names", "glm_oppadj", "embed_tasks", "finish_time", "choice_js")
EMBED_KEYS = ("K", "tasks", "divs", "default_division", "era_date", "C", "W", "V", "ua", "ud", "M", "roster", "mlrates_blend",
              "nn_min_expo")


def statdist_block():
    """Distributional stat lines (research/model_statlines.md): statlines.json's production tables only, the embedding
    model StatDist reads (embed_model.json without its check vectors and neighbour tables) and the oppadj roster factors
    the GLM uses, as compact arrays."""
    st = load_json("data/derived/statlines.json")
    em = load_json("data/derived/embed_model.json")
    oa = load_json("data/derived/oppadj.json")
    if not st or "models" not in st or "prod" not in st["models"] or not em:
        return None
    sd = {k: st[k] for k in STATDIST_KEYS if k in st}
    sd["models"] = {"prod": st["models"]["prod"]}
    sd["meta"] = {"built": g(st, "meta", "built"), "which": "prod"}
    emb = {k: em[k] for k in EMBED_KEYS if k in em}
    keys = st.get("glm_oppadj") or []
    opp = None
    if oa and "roster" in oa:
        opp = {"keys": keys, "roster": {s: [r.get(k) for k in keys] for s, r in oa["roster"].items()}}
    return {"statlines": sd, "embed": emb, "opp": opp}


def debut_block():
    """Debut method model (research/model_debut.md; debut.json model, evaluated by src/ml/debut.js) plus the card desk's
    debutant entries (data/predictions/debutants_*.json), slimmed to the fields src/ml/debut.js sideFromDebutant reads."""
    d = load_json("data/derived/debut.json")
    if not d or "model" not in d:
        return None
    model = {k: v for k, v in d["model"].items() if k != "side_columns"}
    deb = {}
    base = os.path.join(ROOT, "data", "predictions")
    names = sorted(os.listdir(base)) if os.path.isdir(base) else []
    for n in names:
        if not (n.startswith("debutants_") and n.endswith(".json")):
            continue
        f = load_json("data/predictions/" + n) or {}
        for blk in ("also_upcoming", "fighters"):          # a "fighters" entry overrides an "also_upcoming" one
            for key, e in (f.get(blk) or {}).items():
                dv = e.get("derived") or {}
                deb[key] = {"name": e.get("name"), "file": n,
                            "bout": {k: (e.get("bout") or {}).get(k) for k in ("event", "date", "bout_id", "side", "weight_class", "notice", "notice_days")},
                            "derived": {"side_pre": dv.get("side_pre"), "age_at_ufc_debut": dv.get("age_at_ufc_debut"),
                                        "seeded_elo": {"elo_debut_shift": g(dv, "seeded_elo", "elo_debut_shift")}},
                            "record": {k: (e.get("record") or {}).get(k) for k in ("pro", "layoff_days")},
                            "ufcstats_tott": {"dob": g(e, "ufcstats_tott", "dob")}, "sherdog": {"dob": g(e, "sherdog", "dob")},
                            "debut": {"exh_n": g(e, "debut", "exh_n")}, "debut_model": e.get("debut_model")}
    return {"model": model, "built": g(d, "meta", "built"), "debutants": deb}


def scorecard_block():
    """The honest scorecard: 2024-25 numbers (ml2.json, forward_models.json), the sealed 2026 vault (version_history.json
    vault_audits: audit 1 and the final audit 2) and the engine versions (version_history.json versions), plus the few
    report-only numbers in data/derived/page_scorecard.json (each with its source line). Read, never recomputed."""
    m = load_json("data/derived/ml2.json") or {}
    fm = load_json("data/derived/forward_models.json") or {}
    vh = load_json("data/derived/version_history.json") or {}
    ps = load_json("data/derived/page_scorecard.json") or {}
    vs = g(m, "results", "valid_2024_2025", "static") or {}
    out = {"valid": {}, "vault": None, "vault2": None, "versions": [], "notes": ps}

    def met(o):
        return None if not o else {"ll": o.get("log_loss"), "n": o.get("n"), "acc": o.get("accuracy"), "slope": o.get("calib_slope")}
    V = out["valid"]
    V["close"] = met(vs.get("close (fights with a line)"))
    V["open"] = met(vs.get("open (fights with both lines)"))
    V["ml2_lr"] = met(vs.get("ml2_lr"))
    V["ml2_blend"] = met(vs.get("ml2_blend"))
    V["ml_v1"] = met(vs.get("ml_v1_lr"))
    V["elo"] = met(vs.get("elo"))
    for reg in ("noline", "open", "line"):
        V["stack_" + reg] = met(g(fm, "ml2_static", reg, "valid_2024_2025_static"))
    P = g(m, "results", "paired") or {}
    SP = g(m, "stacks", "paired") or {}
    PO = g(m, "stacks", "pooled_2021_2025") or {}

    def pr(o):
        return None if not o else {"diff": o.get("diff"), "ci": o.get("diff_ci"), "n": o.get("n")}
    V["paired"] = {"ml2_lr_minus_close": pr(P.get("static ml2_lr - close")),
                   "ml2_lr_minus_open": pr(P.get("static ml2_lr - open")),
                   "line_stack_minus_close": pr(SP.get("line|static|current+ml2 vs close")),
                   "line_stack_minus_close_2021_2023": pr(PO.get("line CV years 2021-2023 current+ml2 - close")),
                   "line_stack_minus_close_pooled": pr(PO.get("line current+ml2 - close")),
                   "open_stack_minus_open": pr(SP.get("open|static|page: open+ml2lr vs open")),
                   "close_weights_fed_open": pr(SP.get("open|static|close-trained line stack fed the open vs page: open+ml2lr"))}
    audits = vh.get("vault_audits") or []
    au = next((a for a in audits if a.get("audit") == 1), audits[0] if audits else None)
    au2 = next((a for a in audits if a.get("audit") == 2), None)
    if au:
        B = au.get("benchmarks") or {}
        keep = ("close", "open", "ml2_lr", "ml2_stack_close_static", "ml2_stack_open_static", "ml2_stack_noline_static",
                "stack_noline", "moe_page_noline", "stack_close", "stack_open", "elo", "whr_rounds", "ml2_stack_noline_prod")
        out["vault"] = {"date": au.get("date"), "run_utc": au.get("run_utc"), "report": au.get("report"),
                        "n_fights": g(au, "vault", "n_fights"), "n_decisive": g(au, "vault", "n_decisive"), "n_cards": g(au, "vault", "n_cards"),
                        "dates": g(au, "vault", "dates"), "bench": {k: B[k] for k in keep if k in B},
                        "engine_v4": g(au, "engines", "v4"), "engines": {k: g(au, "engines", k) for k in ("v4", "v5", "v5.0.1")},
                        "close_edge": au.get("close_edge"), "open_regime": au.get("open_regime"),
                        "drift": g(au, "drift_rule_6_5_1a", "state"),
                        "props_pool_minus_s2": g(au, "side_line", "props_pool_minus_S2_same_winner", "bin7")}
    # audit 2 (final opening, case if_v4_stays): the pre-registered descriptive headline (open regime vs the opener), the
    # v10 side line, the props-pool effect and the v10 / v8 stat-line total, as recorded in its results block
    R2 = (au2 or {}).get("results") or {}
    if R2:
        H2 = R2.get("headline_descriptive") or {}
        SL = R2.get("side_lines_vs_cmp4") or {}
        out["vault2"] = {"case": g(au2, "case_that_applies", "case"),
                         "opener": H2.get("opener"), "forward_open": H2.get("forward_package_open"), "cmp4_open": H2.get("cmp4_open"),
                         "close": H2.get("close"), "forward_minus_opener": H2.get("forward_minus_opener"),
                         "cmp4_minus_opener": H2.get("cmp4_minus_opener"), "cmp4_minus_forward": H2.get("cmp4_minus_forward"),
                         "v10_minus_cmp4_open": g(SL, "winner", "open"), "props_effect_bin7": g(SL, "props_effect_in_v10_open", "bin7"),
                         "statlines_total": g(R2, "statlines_v10_v8_vs_v4", "total_relative_deviance"),
                         "slopes": R2.get("calibration_slopes")}
    for v in vh.get("versions") or []:
        d = v.get("decision") or {}
        out["versions"].append({"version": v.get("version"), "engine": v.get("engine_version"), "date": v.get("date"),
                                "winLL": g(v, "validation", "metrics", "winLL"), "acc": g(v, "validation", "metrics", "acc"),
                                "bin7": g(v, "validation", "metrics", "bin7"), "n": g(v, "validation", "n_decisive"),
                                "kept": d.get("kept"), "against": d.get("against"), "basis": (d.get("basis") or "")[:400]})
    return out


def git(*args):
    import subprocess
    try:
        r = subprocess.run(["git", "-C", ROOT] + list(args), capture_output=True, text=True, timeout=30)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def committed_ledgers():
    """Every forward-ledger prediction file (data/predictions/YYYY-MM-DD_*.json) as COMMITTED: the content is read from
    the commit that added the file (git show), with that commit's hash and time, so the page shows exactly what was
    locked, never a recomputation or a later local edit. Falls back to the working tree (commit unknown) without git."""
    base = "data/predictions"
    d = os.path.join(ROOT, base)
    names = sorted(os.listdir(d)) if os.path.isdir(d) else []
    out = []
    for n in names:
        if not (len(n) > 11 and n[:4].isdigit() and n[4] == "-" and n[10] == "_" and n.endswith(".json")):
            continue
        rel = base + "/" + n
        log = git("log", "--diff-filter=A", "--format=%H|%cI", "--", rel)
        commit = commit_utc = None
        content = None
        if log and log.strip():
            commit, commit_utc = log.strip().splitlines()[-1].split("|", 1)
            txt = git("show", commit + ":" + rel)
            if txt:
                try:
                    content = json.loads(txt)
                except ValueError:
                    content = None
            disk = load_json(rel)
            if content is not None and disk is not None and disk != content:
                print("warning: " + rel + " differs from its committed version; the page shows the committed one", file=sys.stderr)
        if content is None:
            content = load_json(rel)
            if content is None:
                continue
            print("warning: " + rel + " has no commit; shown without a commit hash", file=sys.stderr)
        out.append({"file": n, "commit": commit, "commit_utc": commit_utc, "doc": content})
    # a file that names another in "supersedes" replaces it (data/predictions/README.md rule 2)
    gone = {x["doc"].get("supersedes") for x in out if x["doc"].get("supersedes")}
    return [x for x in out if x["file"] not in gone and ("data/predictions/" + x["file"]) not in gone]


def ledger_block():
    out = []
    for x in committed_ledgers():
        f = x["doc"]
        lock = f.get("lock_utc")
        ver = str(g(f, "model", "version") or "")
        bouts = []
        for b in f.get("bouts") or []:
            mk = b.get("market") or {}
            bouts.append({"id": b.get("bout_id"), "order": b.get("order"), "a": b.get("a"), "b": b.get("b"), "wc": b.get("weight_class"),
                          "rounds": b.get("rounds"), "title": b.get("title"), "p_a": b.get("p_a"), "src": b.get("p_a_source"),
                          "p_noline": b.get("p_a_noline"), "p_ml2_noline": g(b, "models", "ml2_stack_noline"),
                          "p_market": mk.get("p_a_novig"), "odds_a": mk.get("odds_a"), "odds_b": mk.get("odds_b"),
                          "hours_before_lock": mk.get("hours_before_lock"), "p_method": b.get("p_method"),
                          "method_src": b.get("p_method_source"), "p_distance": b.get("p_distance"), "flags": b.get("flags")})
        out.append({"file": x["file"], "commit": x["commit"], "commit_utc": x["commit_utc"], "event": f.get("event"),
                    "alt_names": f.get("alt_names"), "date": f.get("date"), "lock_utc": lock, "created_utc": f.get("created_utc"),
                    "version": ver.split(":", 1)[0], "version_full": ver, "odds_snapshot": f.get("odds_snapshot"),
                    "committed_before_lock": (x["commit_utc"] is not None and lock is not None and
                                              _utc(x["commit_utc"]) is not None and _utc(lock) is not None and _utc(x["commit_utc"]) < _utc(lock)),
                    "bouts": bouts})
    return out


def _utc(s):
    import datetime as dt
    try:
        t = dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def versions_block():
    return load_json("data/derived/version_history.json")


def forward_block():
    """Upcoming cards, the latest odds snapshot, committed ledger files and results (data/predictions/)."""
    base = "data/predictions"
    cards = load_json(base + "/cards_upcoming.json")
    if not cards:
        return None
    d = os.path.join(ROOT, base)
    names = sorted(os.listdir(d)) if os.path.isdir(d) else []
    snaps = [n for n in names if n.startswith("odds_snapshot_") and n.endswith(".json")]
    odds = {}
    snap_meta = None
    if snaps:
        o = load_json(base + "/" + snaps[-1]) or {}
        snap_meta = {"file": snaps[-1], "utc": g(o, "meta", "snapshot_utc")}
        for b in o.get("bouts") or []:
            c = b.get("consensus") or {}
            m = b.get("market") or {}
            odds[b.get("bout_id")] = {"p": c.get("p_consensus"), "n": c.get("n_books"),
                                      "oa": m.get("odds_a"), "ob": m.get("odds_b"),
                                      "a": g(b, "A", "slug"), "an": g(b, "A", "name")}
    # committed ledger files, read from git (ledger_block): the page shows those picks as locked, never recomputed
    ledgers = ledger_block()
    ledger = {}
    for li, L in enumerate(ledgers):
        for bi, b in enumerate(L["bouts"]):
            ledger[b["id"]] = {"file": L["file"], "li": li, "bi": bi, "p_a": b["p_a"], "model": L["version"]}
    res = {}
    rj = load_json(base + "/results.json")
    for r in (rj or {}).get("results") or []:
        res[r.get("bout_id")] = {k: r.get(k) for k in ("outcome", "winner", "method", "round", "time", "closing_odds")}

    def slugify(s):
        import re
        import unicodedata
        s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
        return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

    events = []
    for ev in cards.get("events") or []:
        bouts = []
        for b in ev.get("bouts") or []:
            a, bb = b.get("a") or {}, b.get("b") or {}
            bid = ev["date"] + ":" + (a.get("slug") or slugify(a.get("name"))) + "__" + (bb.get("slug") or slugify(bb.get("name")))
            ob = odds.get(bid)
            mk = None
            if ob and ob.get("p") is not None:
                p, oa, obb = ob["p"], ob.get("oa"), ob.get("ob")
                # the snapshot is oriented like the card; flip if its A is the card's B
                if ob.get("a") and a.get("slug") and ob["a"] != a.get("slug"):
                    p, oa, obb = 1 - p, obb, oa
                mk = {"p": p, "n": ob.get("n"), "oa": oa, "ob": obb}
            bouts.append({"id": bid, "order": b.get("order"), "seg": b.get("segment"), "wc": b.get("weight_class"),
                          "rounds": b.get("rounds"), "title": bool(b.get("title")), "status": b.get("status"),
                          "a": {"name": a.get("name"), "slug": a.get("slug")}, "b": {"name": bb.get("name"), "slug": bb.get("slug")},
                          "mkt": mk, "ledger": ledger.get(bid), "result": res.get(bid)})
        events.append({"name": ev.get("name"), "date": ev.get("date"), "loc": ev.get("location"),
                       "status": ev.get("event_status"), "bouts": bouts})
    return {"as_of": cards.get("as_of"), "odds": snap_meta, "n_ledger": len(ledger), "n_results": len(res), "events": events,
            "ledgers": ledgers}


DERIVED = {
    "/*__SCORECARD_JSON__*/": scorecard_block,
    "/*__FORWARD_JSON__*/": forward_block,
}


def no_nan(o):
    """NaN / Infinity are not JSON; the browser's JSON.parse would reject the whole block."""
    if isinstance(o, float):
        return o if o == o and o not in (float("inf"), float("-inf")) else None
    if isinstance(o, dict):
        return {k: no_nan(v) for k, v in o.items()}
    if isinstance(o, list):
        return [no_nan(v) for v in o]
    return o


# the three big model files ship gzip-compressed and base64-encoded (about half the bytes); the page inflates them
# with the browser's DecompressionStream, like the avatar assets
DERIVED_GZ = {
    "/*__MLRATES_GZ__*/": mlrates_block,
    "/*__MR_GZ__*/": methodround_block,
    "/*__ML2_GZ__*/": ml2_block,
    "/*__S2_GZ__*/": s2_block,
    "/*__STATDIST_GZ__*/": statdist_block,
    "/*__DEBUT_GZ__*/": debut_block,
}


def gz_b64(data):
    import gzip
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return base64.b64encode(gzip.compress(raw, 9, mtime=0)).decode("ascii")


def derived_gz(fn):
    try:
        data = no_nan(fn())
    except Exception as e:
        print("warning: " + fn.__name__ + " failed (" + repr(e) + "); building without it", file=sys.stderr)
        data = None
    if data is None:
        return ""
    return gz_b64(data)


def derived_json(fn):
    try:
        data = no_nan(fn())
    except Exception as e:  # a broken report must not break the page build
        print("warning: " + fn.__name__ + " failed (" + repr(e) + "); building without it", file=sys.stderr)
        data = None
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return text.replace("</", "<\\/")


def assets_js():
    out = {}
    if os.path.isdir(ASSETS_DIR):
        for name in sorted(os.listdir(ASSETS_DIR)):
            path = os.path.join(ASSETS_DIR, name)
            if not os.path.isfile(path) or name.startswith("."):
                continue
            mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
            if name.endswith(".glb"):
                mime = "model/gltf-binary"
            with open(path, "rb") as f:
                out[name] = "data:" + mime + ";base64," + base64.b64encode(f.read()).decode("ascii")
    return "window.FightAssets = " + json.dumps(out, separators=(",", ":")) + ";"



def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "volk-gaethje-simulator.html")
    page = read("src/page.src.html")

    for marker, files in SCRIPTS.items():
        code = "\n".join(read(f) for f in files)
        if "</script" in code.lower():
            raise SystemExit(", ".join(files) + " contains a closing script tag; it would break the inline build")
        if page.count(marker) != 1:
            raise SystemExit("placeholder " + marker + " must appear exactly once in page.src.html")
        page = page.replace(marker, code)

    # the roster: exactly one of the two placeholders
    n_gz, n_js = page.count(FIGHTERS_GZ_MARKER), page.count(FIGHTERS_JSON_MARKER)
    if n_gz + n_js != 1:
        raise SystemExit("page.src.html needs exactly one roster placeholder (" + FIGHTERS_GZ_MARKER + " or " + FIGHTERS_JSON_MARKER + ")")
    if n_gz:
        page = page.replace(FIGHTERS_GZ_MARKER, gz_b64(json.loads(read(FIGHTERS_FILE))))
    else:
        page = page.replace(FIGHTERS_JSON_MARKER, safe_json(FIGHTERS_FILE))

    for marker, rel in JSON_BLOCKS.items():
        if page.count(marker) != 1:
            raise SystemExit("placeholder " + marker + " must appear exactly once in page.src.html")
        page = page.replace(marker, safe_json(rel))

    for marker, fn in DERIVED.items():
        if page.count(marker) == 1:
            page = page.replace(marker, derived_json(fn))
    for marker, fn in DERIVED_GZ.items():
        if page.count(marker) == 1:
            page = page.replace(marker, derived_gz(fn))

    if page.count(SCOUTING_GZ_MARKER) == 1:
        page = page.replace(SCOUTING_GZ_MARKER, gz_b64(scouting_data()))
    elif page.count(SCOUTING_MARKER) == 1:
        page = page.replace(SCOUTING_MARKER, scouting_json())

    if ASSETS_MARKER in page:
        page = page.replace(ASSETS_MARKER, assets_js())

    size = len(page.encode("utf-8"))
    if size > MAX_BYTES:
        raise SystemExit("built page is %d bytes, over the %d byte budget" % (size, MAX_BYTES))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    print("built", out, size, "bytes")


if __name__ == "__main__":
    main()
