"""durability_heldout_dev.py (v5.0.1 vault cleanup; v5 review "two research efforts scored the 2026 vault").

tools/durability.py scored its held-out tables over 2024-01-01..2026-10-31 (1,503 test fights, 474 of them in the sealed 2026
vault) and published 2026 KD / KO levels. This script re-runs only the held-out parts on the development window, 2024-01-01 ..
2025-12-31, with exactly the same code, spec and fits (every model is fit on 2008-2023), and rewrites them in
data/derived/durability.json; the vault-period items go to the vault directory first:

    python3 tools/durability_heldout_dev.py [--vault-dir DIR]

Moved to DIR/durability_vault.json (outside the repo, next to backtest_vault.json): the 2026 entries of backtest[] (walk-forward
records of vault fights, for the vault auditor), the 2026 kd_level_series rows, and the old held-out blocks over 2024-2026
(meta.info, ladder_test, pairwise_test, calibration_test, fighter_effect_calibration_slopes.test*, ko_loss_model,
verification.chin_exponent test gain). Re-computed on 2024-2025: the same blocks. Not touched: the live production fit (roster,
coef_live, terms, engine.level_now_*, engine.norm_* for live use: production constants fit on everything through the snapshot, by
the release rule), the strict walk-forward backtest records of 2019-2025 fights, and every 2008-2023 fit. The vault file is written
without being read or printed here. """
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import durability as D  # noqa: E402

VAULT_FROM = "2026-01-01"
DEV_UNTIL = "2025-12-31"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault-dir", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
    a = ap.parse_args()
    path = D.OUT_JSON
    J = json.load(open(path))
    dev_ids = {f["id"] for f in json.load(open(os.path.join(D.ROOT, "data", "derived", "backtest_dev.json")))["fights"]}

    # ---- 1. move the vault-period items out, unread
    vault = {"meta": {"tool": "tools/durability_heldout_dev.py", "moved_from": "data/derived/durability.json",
                      "note": "vault-period items of the durability research (2026 fights and 2024-2026 held-out tables); for the vault auditor only"}}
    bt = J["backtest"]
    vault["backtest"] = {k: v for k, v in bt.items() if k not in dev_ids}
    J["backtest"] = {k: v for k, v in bt.items() if k in dev_ids}
    vault["kd_level_series"] = [r for r in J.get("kd_level_series", []) if str(r.get("period", ""))[:4] >= VAULT_FROM[:4]]
    J["kd_level_series"] = [r for r in J.get("kd_level_series", []) if str(r.get("period", ""))[:4] < VAULT_FROM[:4]]
    old = {}
    for k in ("ladder_test", "pairwise_test", "calibration_test", "ko_loss_model"):
        old[k] = J.pop(k, None)
    old["meta_info"] = J["meta"].get("info")
    old["fighter_effect_calibration_slopes"] = J.get("fighter_effect_calibration_slopes")
    old["verification_chin_exponent"] = (J.get("verification") or {}).get("chin_exponent")
    vault["heldout_2024_2026"] = old
    os.makedirs(a.vault_dir, exist_ok=True)
    with open(os.path.join(a.vault_dir, "durability_vault.json"), "w") as fh:
        json.dump(vault, fh, separators=(",", ":"), default=lambda o: None)
    n_moved = len(vault["backtest"])

    # ---- 2. re-run the held-out blocks on 2024-01-01..2025-12-31 (same code, spec and 2008-2023 fits)
    df, state, people, fights, snap_day = D.build_table()
    spec = dict(J["meta"]["spec"])
    X = D.prepare(df, spec)                       # trailing levels from earlier fights only, as before
    X = X[X.date < VAULT_FROM].reset_index(drop=True)
    groups = X["def"].to_numpy()
    res, ladder_rows, info = D.ladder(X, spec)
    tm = D.window(X, D.TEST_FROM, DEV_UNTIL)
    pw = D.pairwise(X, res, tm, [("F", "M0L"), ("E3", "M0L"), ("F", "V3"), ("F", "E3"), ("F", "M3"), ("E3", "V3"),
                                 ("M3", "M1"), ("F36", "F"), ("F36", "V3"), ("F36", "E3"), ("F+move", "F"), ("F+lbs", "F"),
                                 ("F+body", "F"), ("C30", "M1"), ("M2", "C30")])
    fm = D.window(X, D.FIT_FROM, "2023-12-31")
    eb = dict(J.get("fighter_effect_calibration_slopes") or {})
    eb.update({"train": D.ebslope(X, res["F"], fm), "test": D.ebslope(X, res["F"], tm), "test_F36": D.ebslope(X, res["F36"], tm),
               "test_E3": D.ebslope(X, res["E3"], tm)})
    cal = D.calib_all(X, res, tm)
    ko_rows, ko_info, _ = D.ko_model(X, res["F"], spec)
    # chin exponent: the 2019-2023 estimate is unchanged; its 2024+ test gain re-scored on 2024-2025
    ce = dict((J.get("verification") or {}).get("chin_exponent") or {})
    bc = float(ce.get("chin_exponent_2019_2023", 1.0))
    rF = res["F"]
    base_F = np.exp(rF["lin"] + np.log(np.where(rF["E"] > 0, rF["E"], 1)) + rF["lv"] + rF["xo"])
    mu_e = base_F * rF["walk"]["chin"] ** bc * rF["walk"]["pow"]
    mu_e *= rF["mu"][fm].sum() / mu_e[fm].sum()
    d_e = D.pois_dev(rF["y"], mu_e) - D.pois_dev(rF["y"], rF["mu"])
    fd_e = D.fight_diff(X, tm, d_e[tm], 0 * d_e[tm])
    ce.update({"test_dev_gain": round(fd_e["total"], 2), "test_se_fight": round(fd_e["se_total"], 2),
               "test_se_fighter": round(D.se_fighter(X, tm, d_e), 2)})

    J["meta"]["info"] = info
    J["meta"]["test_window"] = [D.TEST_FROM, DEV_UNTIL]
    J["meta"]["vault_cleanup"] = ("v5.0.1 (Nov 7, 2026): the held-out tables were first scored on 2024-01-01..2026-10-31, which reached "
                                  "into the sealed 2026 vault; they were moved to the vault directory (durability_vault.json) with the "
                                  "%d 2026 backtest records and the 2026 kd_level_series rows, and re-scored here on 2024-01-01.."
                                  "2025-12-31 by tools/durability_heldout_dev.py (same code, spec and 2008-2023 fits). The live "
                                  "production fit (roster, terms, level_now, norm_*) still uses every fight through the snapshot, by "
                                  "the release rule; nothing in it is a held-out score." % n_moved)
    J["ladder_test"] = ladder_rows
    J["pairwise_test"] = pw
    J["fighter_effect_calibration_slopes"] = eb
    J["calibration_test"] = cal
    J["ko_loss_model"] = {"models": ko_rows, "info": ko_info}
    J.setdefault("verification", {})["chin_exponent"] = ce
    with open(path, "w") as fh:
        json.dump(J, fh, separators=(",", ":"), default=lambda o: None if (isinstance(o, float) and not np.isfinite(o)) else o)
    print("moved %d vault backtest records and %d series rows; re-scored the held-out blocks on %s..%s (%s test fights)" % (
        n_moved, len(vault["kd_level_series"]), D.TEST_FROM, DEV_UNTIL, info.get("fights_test")))
    for r in ladder_rows:
        print("  %-58s dev %.1f  vs M0L %+.1f (se %.1f)" % (r["model"], r["dev_test"], r["vs_M0L"]["total"], r["vs_M0L"]["se_total"]))


if __name__ == "__main__":
    main()
