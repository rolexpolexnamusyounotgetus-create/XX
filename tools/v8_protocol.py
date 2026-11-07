#!/usr/bin/env python3
"""v8_protocol.py: writes data/derived/v8/gate_protocol.json (engine v8's binding TRAIN gate protocol: comparator, inputs, rules,
file hashes, commands, interpretations, development runs), to be committed BEFORE the binding run (V6_V10_PLAN 7.1 item 10 a).

    python3 tools/v8_protocol.py            (after the full test suite ran on the candidate: data/derived/v8/tests/_status.txt)
"""
import datetime as dt
import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda p: os.path.join(ROOT, p)


def sha(p):
    return hashlib.sha256(open(J(p), "rb").read()).hexdigest()


FILES = {"engine": "src/engine3.js", "params": "src/params3.js", "mlrates": "src/ml/mlrates.js", "embed_js": "src/ml/embed.js",
         "mlpathrec": "tools/mlpathrec.js", "targets": "data/derived/v8/statlines_targets.json", "oof_fh": "data/derived/mlrates_oof_fh.json",
         "embed_blend_fh": "data/derived/embed_blend_fh.json", "embed_json": "data/derived/embed.json",
         "priors": "data/derived/mlcal_priors_asof.json", "backtest": "data/derived/backtest_dev.json", "harness": "tools/v8_gate.js"}
OTHER = {"scorer": "tools/v8_gate.py", "statlines_folds": "data/derived/v8/statlines_folds.json", "statlines_inputs": "data/derived/v8/statlines_inputs.json",
         "statdist_js": "src/ml/statdist.js", "test_v8": "tests/test_v8.js", "fold_builder": "tools/v8_statlines_folds.py", "targets_builder": "tools/v8_targets.js",
         "predict_score_helpers": "tools/predict_score.py"}
TOLERATED = {
    "test_page_parity": "2 of 12 checks fail by design of this cycle: 'component embed is on: its module FightEmbed is in the ENGINE bundle' and "
                        "'src/app.js loads its data (loadEmbed)'. The page is not rebuilt in cycle 3 (the published page keeps its own engine); a "
                        "page that ships engine v8 must bundle src/ml/embed.js + the embedding roster and pass statlines targets (cycle 5). The "
                        "check concerns the page build, not the backtest engine the gate measures.",
}


def main():
    status = open(J("data/derived/v8/tests/_status.txt")).read().split()
    rcs = {l.split()[0]: l.split()[1] for l in open(J("data/derived/v8/tests/_status.txt")) if "rc=" in l}
    failing = sorted(k for k, v in rcs.items() if v != "rc=0")
    untolerated = [k for k in failing if k not in TOLERATED]
    assert "ALLDONE" in status, "the test suite has not finished"
    assert not untolerated, "untolerated failing tests: %s" % untolerated
    T8 = json.load(open(J("data/derived/v8/tests/test_v8.json")))
    P = {
        "version": "v8", "run": "gate", "split": "train",
        "written_at": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "+00:00",
        "status": "committed BEFORE the binding gate run (V6_V10_PLAN 7.1 item 10 a); the binding run happens once (tools/v8_gate.js --binding "
                  "--protocol refuses an uncommitted or different protocol, a different command line, a changed input file and an existing output)",
        "candidate": {"engine_dir": "src", "engine_version": "8.0.0", "params_version": "8.0.0-selfcal-pre2024",
                      "what": "the v4 simulator (4.0.0, bit for bit with every v8 flag off) + docs/V6_V10_PLAN.md cycle 3: components.embed (embedding "
                              "blend of the learned targets, the v6 engine's code), components.retarget (realised-rate retarget toward the verified "
                              "statlines layer, like for like over all pilot simulations), components.tdIntent / ctrlSpread (fight-level mean-1 "
                              "lognormal takedown intent / top-stint length per fighter, acting only on a retargeted matchup; sds 1.1 / 0)",
                      "params_blocks": {"components": {"embed": True, "retarget": True, "tdIntent": True, "ctrlSpread": True},
                                        "retarget": {"pilot": 200, "iters": 2, "damp": 0.9, "kDec": 20, "kMin": 5, "kAcc": 5, "seed": 20261107},
                                        "spread": {"td": 1.1, "ctrl": 0}}},
        "hashes": {k: sha(v) for k, v in FILES.items()},
        "hashes_recorded": {k: sha(v) for k, v in OTHER.items()},
        "files": FILES,
        "commands": {
            "tests": "data/derived/v8/tests/_jobs.txt (34 jobs, run on the candidate files before this commit; status in _status.txt)",
            "harness": "nice -n 5 node tools/v8_gate.js --out data/derived/v8/gate_train.json --sims 300 --workers 3 --seed 8 --binding --protocol data/derived/v8/gate_protocol.json",
            "score": "python3 tools/v8_gate.py score data/derived/v8/gate_train.json --out data/derived/v8/gate_train_score.json",
            "confirmation_if_needed": "if the kept set matches no simulated arm (two or more sub-parts dropped while at least one is kept): a second "
                                      "protocol file data/derived/v8/gate_protocol_confirm.json, written mechanically (same hashes; arms cmp4 + final "
                                      "= the kept components) and committed first; one run of tools/v8_gate.js with the same seed and sims; scored "
                                      "with --final-arm final; its package result is binding"},
        "arms": {"cmp4": "every v8 flag off (= engine 4.0.0)", "all": "every v8 flag on",
                 "-embed / -retarget / -tdIntent / -ctrlSpread": "all minus one sub-part (leave-one-out, V6_V10_PLAN cycle 3)"},
        "comparator": {
            "name": "cmp4: the latest kept version v4 (4.0.0) on the same honest inputs (the one pre-registered comparator; 7.1 item 10 b)",
            "definition": "the candidate engine with params.components all false, which tests/test_v8.js check 1 proves bit-identical to versions/v4 "
                          "(matchup tables, 300 simulations, traced fights) with the learned rates on; the same fights, corner orders and "
                          "per-simulation seeds as every v8 arm (common random numbers)",
            "inputs": "both get the same honest inputs: as-of priors mlcal_priors_asof.json[year]; fold-honest out-of-fold learned rates "
                      "mlrates_oof_fh.json (stack weights for year y fit on earlier years; what tools/evalv.js gives engines of major >= 6); the "
                      "v8 arms additionally get the fold-honest embedding etas / recipe (tools/mlpathrec.js, embed_blend_fh.json coef_fh[year], "
                      "2019 = identity) and the leak-free statlines targets (data/derived/v8/statlines_targets.json: forward-chained fold tables "
                      "f2020..f2023 fit on 2019..Y-1 by tools/v8_statlines_folds.py with statlines' pre-registered choice; none for 2019)",
            "refit_schedule": "static per year: every fitted input of year Y (learned-rate stack weights, embedding recipe, statlines tables) is fit on "
                              "years before Y; the look (if any) uses the 2019-2023 fits (statlines dev table, coef_fh['2024'], mlrates dev rates) "
                              "for both versions"},
        "rules": {"file": "tools/v8_gate.py", "sha256": sha("tools/v8_gate.py"),
                  "summary": "the RULES block of tools/v8_gate.py, verbatim: per sub-part leave-one-out (all vs all-minus-x) on the 2020-2023 train "
                             "fights; mean-moving sub-parts (embed, retarget) kept if K1 total relative 10-stat deviance CI upper < 0, K2 no stat's "
                             "deviance worse (CI lower <= 0), K3 TD / control MAE not worse (CI lower <= 0), K4 TD-attempt PIT of the arm with it "
                             "(in80 >= 0.78, >P90 <= 0.12), K5 winner / 7-bin / method CI upper <= +0.002, K6 KO / SUB / DEC / KD per 100 head / "
                             "TD per 15 / control per 15 inside the mlcal tolerances; spread sub-parts (tdIntent, ctrlSpread) kept if S1 their "
                             "stat's PIT calibration error improves (CI upper < 0), S2 deviance not worse (total and each stat CI lower <= 0), "
                             "and K3-K6; the version passes if at least one sub-part is kept and the kept configuration vs cmp4 passes K1-K6; "
                             "20,000 event-cluster resamples (seed 7), Monte Carlo SE, marginal bounds decided by the clustered normal bound",
                  "interpretations_set_before_the_binding_run": [
                      "'total 10-stat Poisson deviance' = per fight the mean over the 10 recorded stats (sig landed / attempted, head / body / leg "
                      "landed, KD, TD landed / attempted, control, sub attempts) of the per-fighter deviance divided by cmp4's train mean of that "
                      "stat (x100 = mean relative change in %); the raw sum is reported (it would be control-dominated)",
                      "'no single stat worse' and 'not worse beyond the CI' = not significantly worse (paired CI lower bound <= 0)",
                      "mean-preserving spread sub-parts cannot lower the deviance of the mean by construction, and K4 needs the TD-intent draw: "
                      "their improvement criterion is their purpose (S1, PIT calibration), their deviance criterion 'not worse' (S2)",
                      "DEC share tolerance 0.035 (= KO + SUB tolerance; mlcal has none for DEC)",
                      "binding scope 2020-2023 (1,606 fights): 2019 has no earlier 2019+ year for any of the cycle's fitted inputs, so on 2019 "
                      "fights every v8 arm runs as cmp4 does (no statlines table, identity embedding recipe, spread inactive without the "
                      "retarget); the 2019-2023 values are reported as a secondary"]},
        "tests": {"status_file": "data/derived/v8/tests/_status.txt", "failing": failing, "tolerated": TOLERATED,
                  "test_v8": {"checks": len(T8["checks"]), "pass": T8["pass"]}},
        "design_constants_not_tuned": "params.retarget (pilot 200 per order and iteration, 2 iterations, damp 0.9, kDec 20, kMin 5 minutes, kAcc 5 "
                                      "attempts, seed 20261107): set before any development number; params.embed recipe = the v6 engine's (backtests "
                                      "use the fold-honest per-year recipe)",
        "fitted_on_train_before_the_protocol": {
            "spread.td": "1.1: the smallest grid value whose train takedown-attempt PIT meets the plan's band (in80 >= 0.78, >P90 <= 0.12) in the "
                         "final fit run (data/derived/v8/dev/spread_fit_td.json: 1.1 -> 0.781 / 0.117 on 2019-2023 with the spread also on "
                         "2019 fights, 0.794 / 0.107 on 2020-2023); rule chosen after the first grids (the PIT-uniformity minimum is 1.25-1.3, "
                         "whose wider spread costs Monte Carlo noise in the per-fight means)",
            "spread.ctrl": "0: the minimiser of control's PIT calibration error given td 1.1 (data/derived/v8/dev/spread_fit_ctrl.json: 0 -> 0.799 / "
                           "0.101 / 0.100; 0.2 / 0.4 / 0.6 worse), so ctrlSpread is a no-op at this value (its gate check S1 cannot pass)"},
        "development_runs_disclosed": [
            "out/v8/smoke.json: 100 fights (every 20th), cmp4 vs all (spread 0, the first, decision-subset retarget), 60 sims: code path only; "
            "its PIT / deviance printout was seen",
            "out/v8/old_spread_fit_td_decisionmode.json (+ a deleted 1.0-1.5 extension): decision-subset retarget, td grid, full train, 150 sims",
            "out/v8/dev_noRT.json: half the train fights, embed-only and retarget arms with / without td 1.1 (decision-subset retarget): showed "
            "the intent draw alone lowers realised takedown attempts ~15%",
            "out/v8/superseded/spread_fit_td.json: all-simulations retarget, td grid 0-1.5, full train",
            "out/v8/dev_all2.json, dev_all3.json, dev_all4.json: half the train fights (every 2nd), 150 sims, seed 1: arms cmp4-like (c0), "
            "embed-only, embed + retarget, + td 1.1 / 1.3; paired contrasts of the gate's kind were computed and seen (dev_all4, the final "
            "design before the coupling: embed + retarget vs embed-only total -0.68% [-1.20, -0.19]; + td 1.1 vs without +0.21% [-0.30, +0.67]; "
            "the package vs c0 total -0.96% [-1.78, -0.14], control -4.07 s [-6.85, -1.37], winner -0.0065 [-0.0130, -0.0001])",
            "data/derived/v8/dev/spread_fit_td.json, spread_fit_ctrl.json: the final sd fits (full train, 150 sims, seed 1)",
            "out/v8/smoke2.json: 80 fights, the six preset arms, 30 sims: scorer smoke test only"],
        "design_changes_informed_by_development_runs (train only)": [
            "retarget matching changed from the decision-simulation subset to all pilot simulations, each compared with the statlines mean at "
            "its own length and finished status (targets gained the finished-fight grid)",
            "takedown accuracy odds added to the retarget's accuracy step (single-fight diagnosis: with the stand-up hazard at its floor, about "
            "18% of train sides, control can only follow the takedowns landed)",
            "a substep occupancy integrator for the retarget's refit (a one-second Euler step diverged on one 2019-23 matchup: NaN tables)",
            "an elasticity-scaled second step was tried and reverted (noisier, deviance worse)",
            "stratified spread draws inside the pilot (variance reduction)",
            "spread draws coupled to an applied retarget (alone they lower realised takedown attempts and leave the upper tail light; live "
            "matchups without targets stay v4 + embed)",
            "binding scope 2020-2023 and the S2 reading above"],
        "honesty_note": "the binding run re-measures on the same train fights the development runs used (fresh seed 8, 300 sims), so it guards "
                        "against Monte Carlo luck and wiring errors more than it tests the design choices made on those fights; it is "
                        "optimistic as a test of them. Nothing dated 2024 or later was simulated or scored by any v8 run; 2026 was never read.",
        "expected_from_the_plan": "V6_V10_PLAN cycle 3: control deviance -1.5 to -4 s, attempts -0.4 to -1.0, landed -0.1 to -0.3 (validation "
                                  "expectations, extrapolated from the train gap); winner, 7-bin and method within +-0.002",
    }
    os.makedirs(J("data/derived/v8"), exist_ok=True)
    with open(J("data/derived/v8/gate_protocol.json"), "w") as fh:
        json.dump(P, fh, indent=1)
    print("wrote data/derived/v8/gate_protocol.json; failing tests:", failing, "(tolerated)" if failing else "")


if __name__ == "__main__":
    main()
