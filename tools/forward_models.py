#!/usr/bin/env python3
"""Exports for the forward ledger's per-bout "models" block (forward model v4.1): data/derived/forward_models.json.

    python3 tools/forward_models.py export      # writes data/derived/forward_models.json (with Node test vectors)
    node tests/test_forward_models.js           # JS evaluator vs these vectors + corner symmetry of every model

What it exports. Nothing is refit on data after 2023, nothing reads a 2026 fight, nothing reads a forward result.

  ml2_static: tools/ml2.py's three page stacks with the weights fit on 2019-2023 only (its "static" fits; ml2.json
    publishes them at 4 decimals in stacks.weights, the page ships the 2019-2025 production refit instead):
      line   = market (power de-vig consensus close) + ML v2 logistic, fit on closing lines
      open   = open (multiplicative no-vig opener) + ML v2 logistic, fit on opening lines
      noline = ML v2 logistic + market rating, recency half-life 1.5 y (CV-chosen)
    They are re-derived at full precision by calling tools/ml2.py's own stack_predict() on its cached stack table
    (out/ml2_cache/stack.pkl, the verified build: research/model_ml2.md, Verification log) with fit_until_year 2023 and
    the CV-chosen half-life from ml2.json stacks.cv. The export refuses to write unless (a) the weights round to the
    published 4-decimal ones, (b) the 2024-2025 predictions equal the cached static predictions, and (c) the 2024-2025
    log loss equals ml2.json stacks.valid. Every training row is dated 2019-2023 (asserted).
  test_vectors: ml2.json page_model.test_vectors (40 roster pairs, Python ML v2 logistic and market rating) with the
    three static stacks evaluated by tools/ml2.py page_stack_eval(); the Node test must reproduce them to 1e-12 through
    src/ml/ml2.js.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import pickle
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
OUT = os.path.join(DERIVED, "forward_models.json")
TOOL = "tools/forward_models.py 1.0"

# (regime, tools/ml2.py STACKS name): the JS-evaluable page stacks
PAGE_STACKS = (("line", "page: market+ml2lr"), ("open", "page: open+ml2lr"), ("noline", "page: ml2lr+mkt_rating"))


def sha16(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def cmd_export(args):
    import numpy as np
    sys.path.insert(0, HERE)
    import ml2  # noqa: E402  (the verified tool; importing it wraps build_db.parse_fights to drop 2026+)
    cache = os.environ.get("ML2_CACHE", os.path.join(ROOT, "out", "ml2_cache"))
    spath = os.path.join(cache, "stack.pkl")
    J = json.load(open(os.path.join(DERIVED, "ml2.json")))
    S = pickle.load(open(spath, "rb"))
    D, P = S["D"], S["preds"]
    yr = D["year"].to_numpy()
    y = D["y"].to_numpy(float)
    assert yr.max() <= 2025, "stack table holds a fight dated 2026 or later"
    rows_of = {"line": D["market"].notna().to_numpy(), "open": D["open"].notna().to_numpy(),
               "noline": np.ones(len(D), bool)}
    out_st, problems = {}, []
    for regime, name in PAGE_STACKS:
        key = "%s|%s" % (regime, name)
        cols = ml2.STACKS[regime][name]
        h = J["stacks"]["cv"][key]["chosen_h"]
        rows_ok = rows_of[regime]
        va = rows_ok & (yr >= 2024) & (yr <= 2025)
        tr = rows_ok & (yr <= 2023) & (yr >= 2019)
        assert yr[tr].max() <= 2023 and yr[tr].min() >= 2019
        p_st, b = ml2.stack_predict(D, cols, "static", h, 2023, va, rows_ok)
        pub = J["stacks"]["weights"][key]
        if [round(float(x), 4) for x in b] != [round(float(pub[c]), 4) for c in cols]:
            problems.append("%s: weights %s do not round to the published %s" % (key, b.tolist(), pub))
        cached = P[key + "|static"][va]
        dmax = float(np.max(np.abs(p_st - cached)))
        if dmax > 1e-12:
            problems.append("%s: 2024-25 predictions differ from the cached static ones by %.2e" % (key, dmax))
        llv = ml2.ll(p_st, y[va])
        llpub = J["stacks"]["valid"][key]["static"]["log_loss"]
        if abs(round(llv, 5) - llpub) > 1e-5:
            problems.append("%s: 2024-25 log loss %.5f vs published %.5f" % (key, llv, llpub))
        out_st[regime] = {
            "inputs": cols, "weights": [float(x) for x in b], "weights_published_4dp": [pub[c] for c in cols],
            "recency_half_life_years": h, "pclip": 0.01,
            "fit": "2019-01-01..2023-12-31 only (tools/ml2.py stage_stack 'static': ML v2 logistic annual-refit OOF "
                   "predictions, no intercept, non-negative logit weights, recency half-life by forward-chained CV "
                   "2021-2023)",
            "ml2_stacks_key": key, "n_fit": int(tr.sum()),
            "input_definitions": {"market": "power de-vig of the consensus closing line (market.json p_power_close)",
                                  "open": "multiplicative no-vig opening line (market.json p_novig_open)",
                                  "ml2lr": "ML v2 logistic (OOF 2019-2023 in the fit; page model at prediction)",
                                  "mkt_rating": "Kalman market rating (market.json; absent enters as logit 0)"},
            "cv_2021_2023": J["stacks"]["cv"][key]["by_h"][str(h)],
            "valid_2024_2025_static": J["stacks"]["valid"][key]["static"],
            "repro": {"max_abs_diff_vs_cached_static_2024_2025": dmax, "n_2024_2025": int(va.sum()),
                      "log_loss_2024_2025": round(llv, 6)}}
    if problems:
        raise SystemExit("refused, the re-derived stacks do not match the verified build:\n  " + "\n  ".join(problems))
    tv = []
    for e in J["page_model"]["test_vectors"]:
        p_mr = e.get("p_mr")
        p_line, p_open = e.get("p_line"), e.get("p_open")
        tv.append({"a": e["a"], "b": e["b"], "fight": e["fight"], "pA": e["pA"], "p_mr": p_mr,
                   "p_line": p_line, "p_open": p_open,
                   "p_stack_noline": ml2.page_stack_eval(out_st["noline"], e["pA"], p_mr),
                   "p_stack_line": ml2.page_stack_eval(out_st["line"], e["pA"], p_mr, p_line),
                   "p_stack_open": ml2.page_stack_eval(out_st["open"], e["pA"], p_mr, None, p_open)})
    doc = {
        "meta": {"tool": TOOL, "built": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                 "purpose": "fixed coefficients for the forward ledger's models block (forward model v4.1); "
                            "data/predictions/README.md pre-registers how each is used and scored",
                 "protocol": "no fit on anything after 2023-12-31, no 2026 fight read, no forward result read",
                 "sources": {"ml2.json": {"built": J["meta"]["built"], "sha256_16": sha16(os.path.join(DERIVED, "ml2.json"))},
                             "stack.pkl": {"path": os.path.relpath(spath, ROOT), "sha256_16": sha16(spath)},
                             "code": "tools/ml2.py stack_predict / stack_fit / page_stack_eval (sha256_16 %s)"
                                     % sha16(os.path.join(HERE, "ml2.py"))}},
        "ml2_static": out_st,
        "test_vectors": tv}
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, indent=1)
        fh.write("\n")
    os.replace(tmp, OUT)
    for regime, s in out_st.items():
        print("%-6s %s weights %s (published %s), h %s, CV %.5f, 2024-25 %.5f, repro %.1e" % (
            regime, s["inputs"], [round(w, 6) for w in s["weights"]], s["weights_published_4dp"],
            s["recency_half_life_years"], s["cv_2021_2023"], s["repro"]["log_loss_2024_2025"],
            s["repro"]["max_abs_diff_vs_cached_static_2024_2025"]))
    print("wrote %s (%d test vectors)" % (os.path.relpath(OUT, ROOT), len(tv)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("export")
    args = ap.parse_args()
    {"export": cmd_export}[args.cmd](args)


if __name__ == "__main__":
    main()
