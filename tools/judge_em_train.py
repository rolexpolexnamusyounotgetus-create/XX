#!/usr/bin/env python3
"""judge_em_train.py: refit the EM round-winner judging weights on TRAIN-era cards only (engine v4.0.1).

v4 took its judging weights from data/derived/baserates.json round_model.em_all_cards, which tools/baserates.py fits on
every decision card from --since (2015-01-01) through the end of the data (2026-10-31): validation years and the vault
included (v4 review, Nov 6). This script runs the same code (tools/baserates.py round_model_block: EM over 10-9-only cards,
latent round winners per judge, weighted no-intercept logistic M-step) on fights dated before 2024-01-01 only. The fight
table is cut right after loading, before any statistic is computed, so no 2024+ row enters any number here.

    python3 tools/judge_em_train.py [--since 2015-01-01] [--until 2024-01-01] [--out data/derived/judge_em_train.json]
Output: the EM fit ("target" feature set, the one the engine uses), the clean-subset fit, and a 2023 holdout (fit on cards
before 2023-01-01, predict 2023 decision winners), all inside the train era.
"""
import argparse
import importlib.util
import json
import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("baserates", os.path.join(HERE, "baserates.py"))
br = importlib.util.module_from_spec(spec)
spec.loader.exec_module(br)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", default=os.path.join(ROOT, "data", "raw"))
    ap.add_argument("--since", default="2015-01-01")
    ap.add_argument("--until", default="2024-01-01")
    ap.add_argument("--holdout-from", default="2023-01-01")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "derived", "judge_em_train.json"))
    a = ap.parse_args()
    F, S, notes, _ = br.load_data(a.raw, a.since)
    F = F[F.DATE < pd.Timestamp(a.until)].copy()          # hidden-data protocol: nothing from 2024-01-01 on
    S = S[S.fid.isin(set(F.fid))].copy()
    _, cards = br.judging_block(F)
    M = br.round_model_block(F, S, cards, holdout_from=a.holdout_from)
    em = M["em_all_cards"]
    out = {"meta": {"tool": "tools/judge_em_train.py", "since": a.since, "until": a.until, "holdout_from": a.holdout_from,
                    "date_max_used": str(F.DATE.max().date()), "n_fights": int(len(F)), "notes": notes,
                    "source_code": "tools/baserates.py round_model_block (same EM as baserates.json round_model.em_all_cards)"},
           "em_all_cards": em, "clean_subset_target": M["clean_subset"]["target"],
           "holdout": {k: v for k, v in M["holdout"].items()}}
    out = br.clean(out)
    with open(a.out, "w") as fh:
        json.dump(out, fh, indent=1)
    c = em["target"]["coef"]
    print("EM (cards %s..%s, %d cards, %d fights): " % (a.since, out["meta"]["date_max_used"], em["n_cards"], em["n_fights"]) +
          ", ".join("%s %.4f" % (k, v) for k, v in c.items()))
    h = M["holdout"]
    print("2023 holdout (fit before %s): accuracy %.4f, log loss %.4f, n %d" % (a.holdout_from, h["accuracy"], h["log_loss"], h["n_test_decisions"]))
    print("wrote", os.path.relpath(a.out, ROOT))


if __name__ == "__main__":
    main()
