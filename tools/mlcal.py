#!/usr/bin/env python3
"""mlcal.py: driver for the ML-driven engine calibration harness (evaluator: tools/mlcal.js).

Black-box tuning of an engine's global parameters on the walk-forward backtest:
  1. Optuna TPE (multivariate) with successive-halving pruning: every trial starts with a few sims per
     fight (rung 0) on a fixed train subsample; only the better half (eta) earns more sims (rungs 1, 2, ...).
     Rungs accumulate sims, so promotion costs only the extra sims. Trial 0 is the current parameter set.
  2. CMA-ES (pycma) in the normalized box, warm-started from the TPE incumbent (or the current values):
     each generation is ranked at a mid rung on common random numbers; the best 1/eta of each generation is
     promoted to the top rung so its value is comparable with the TPE trials.
  3. Confirmation: the best K distinct candidates plus the baseline are re-scored on a DISJOINT train
     window with fresh seeds (removes the winner's curse of the tuning sample and of the CRN draws).
  4. Validation (2024-01-01..2025-12-31): the K finalists and the baseline are scored once each, both
     corner orders averaged, with paired bootstrap CIs against the baseline and an Elo reference.
     data/derived/mlcal_val_ledger.json remembers every validated parameter set (hash of engine file,
     params file and overrides): a set is never re-run on validation; its stored result is reused.
Objective (on train): wWin * winner log loss + wBins * 7-bin log loss + base-rate penalties (spec "objective").
Fights dated 2026-01-01 or later are never loaded (mlcal.js drops them; the priors file stops at 2025).

Usage
  python3 tools/mlcal.py priors                                  # one-time: data/derived/mlcal_priors_asof.json
  python3 tools/mlcal.py tune --spec tools/mlcal_spec_engine3.json --trials 30 --cma-evals 32 \\
        --n-fights 600 --rungs 15,30,60 --workers 2 --top 3 --val-sims 80 \\
        --out data/derived/mlcal_candidates.json
  python3 tools/mlcal.py validate --cand data/derived/mlcal_candidates.json --ranks 1,2,3   # ledger-guarded
  node tools/mlcal.js export --cand data/derived/mlcal_candidates.json --rank 1 --out /tmp/params_r1.js
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import subprocess
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT_FROM = "2026-01-01"
LEDGER = os.environ.get("MLCAL_LEDGER") or os.path.join(ROOT, "data/derived/mlcal_val_ledger.json")


def rel(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)


# ------------------------------------------------------------------ priors (walk-forward, no 2026 data)
def cmd_priors(args):
    """Copy priors_asof[2019..2025] out of backtest.json. priors_asof[Y] is built only from fights before
    Jan 1 of Y (tools/build_db.py), so no 2026 fight enters; the 2026 key and the fights list are discarded
    without being read."""
    src = json.load(open(rel("data/derived/backtest.json")))
    pa = {y: v for y, v in src.get("priors_asof", {}).items() if int(y) < int(VAULT_FROM[:4])}
    del src
    if not pa:
        sys.exit("backtest.json has no priors_asof; rebuild with tools/build_db.py")
    out = rel(args.out)
    json.dump(pa, open(out, "w"), separators=(",", ":"))
    print("wrote %s: years %s" % (out, ", ".join(sorted(pa))))


# ------------------------------------------------------------------ evaluator process
class Evaluator:
    def __init__(self, spec, workers):
        self.p = subprocess.Popen(["node", rel("tools/mlcal.js"), "serve", "--spec", spec, "--workers", str(workers)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1, cwd=ROOT)
        self.tick = os.sysconf("SC_CLK_TCK")

    def call(self, **req):
        self.p.stdin.write(json.dumps(req) + "\n")
        self.p.stdin.flush()
        line = self.p.stdout.readline()
        if not line:
            raise RuntimeError("mlcal.js exited (see stderr)")
        r = json.loads(line)
        if "error" in r:
            raise RuntimeError(r["error"])
        return r

    def cpu(self):
        """CPU seconds used so far by the node process (all worker threads)."""
        try:
            f = open("/proc/%d/stat" % self.p.pid).read().rsplit(")", 1)[1].split()
            return (int(f[11]) + int(f[12])) / self.tick
        except OSError:
            return float("nan")

    def close(self):
        try:
            self.call(cmd="quit")
        except Exception:
            pass
        try:
            self.p.wait(timeout=10)
        except Exception:
            self.p.kill()


# ------------------------------------------------------------------ box transforms
def enc(d, v):
    if d["log"]:
        return (math.log(v) - math.log(d["lo"])) / (math.log(d["hi"]) - math.log(d["lo"]))
    return (v - d["lo"]) / (d["hi"] - d["lo"])


def dec(d, u):
    u = min(1.0, max(0.0, float(u)))
    v = math.exp(math.log(d["lo"]) + u * (math.log(d["hi"]) - math.log(d["lo"]))) if d["log"] else d["lo"] + u * (d["hi"] - d["lo"])
    return int(round(v)) if d.get("int") else v


def short(m):
    """Compact metrics for the history."""
    keys = ("objective", "winLL", "binLL", "basePen", "brier", "accuracy", "ece", "simsPerFight", "nFailed")
    o = {k: m.get(k) for k in keys}
    o["sigLndMAE"] = (m.get("statline") or {}).get("sigLndMAE")
    o["sigDiffCorr"] = (m.get("statline") or {}).get("sigDiffCorr")
    return o


def rnd(x, s=6):
    if isinstance(x, float):
        return float("%.*g" % (s, x))
    if isinstance(x, dict):
        return {k: rnd(v, s) for k, v in x.items()}
    if isinstance(x, list):
        return [rnd(v, s) for v in x]
    return x


# ------------------------------------------------------------------ successive halving on one candidate
def run_rungs(ev, key, x, rungs, start_rung=0, stop_rung=None, report=None):
    """Evaluate x rung by rung (accumulating sims). report(step, value) -> True to stop (pruned)."""
    stop_rung = len(rungs) - 1 if stop_rung is None else stop_rung
    vals, m, prev = {}, None, (rungs[start_rung - 1] if start_rung > 0 else 0)
    for ri in range(start_rung, stop_rung + 1):
        m = ev.call(cmd="eval", key=key, x=x, sims=rungs[ri] - prev, seedOff=ri)
        prev = rungs[ri]
        vals[str(rungs[ri])] = m["objective"]
        if report is not None and ri < len(rungs) - 1 and report(rungs[ri], m["objective"]):
            return vals, m, True
    return vals, m, False


def tpe_phase(ev, dims, rungs, eta, n_trials, seed, cpu_cap, history):
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    sampler = optuna.samplers.TPESampler(seed=seed, multivariate=True, n_startup_trials=min(10, max(4, n_trials // 3)))
    pruner = optuna.pruners.SuccessiveHalvingPruner(min_resource=rungs[0], reduction_factor=eta, min_early_stopping_rate=0)
    study = optuna.create_study(direction="minimize", sampler=sampler, pruner=pruner)
    study.enqueue_trial({d["name"]: d["value"] for d in dims})          # trial 0 = current parameters
    for t in range(n_trials):
        if ev.cpu() > cpu_cap:
            log("TPE: CPU cap reached after %d trials" % t)
            break
        trial = study.ask()
        x = {d["name"]: trial.suggest_float(d["name"], d["lo"], d["hi"], log=d["log"]) for d in dims}
        key = "tpe%d" % trial.number

        def report(step, v):
            trial.report(v, step)
            return trial.should_prune()

        vals, m, pruned = run_rungs(ev, key, x, rungs, report=report)
        ev.call(cmd="drop", key=key)
        last = m["objective"]
        if pruned:
            study.tell(trial, state=optuna.trial.TrialState.PRUNED)
        else:
            trial.report(last, rungs[-1])
            study.tell(trial, last)
        history.append({"opt": "tpe", "id": key, "x": x, "rungs": vals, "complete": not pruned, "last": short(m)})
        log("TPE %2d %s rungs %s  win %.4f bins %.4f base %.4f  cpu %.0fs" % (
            trial.number, "pruned " if pruned else "COMPLETE", {k: round(v, 4) for k, v in vals.items()},
            m["winLL"], m["binLL"], m["basePen"], ev.cpu()))
    imp = None
    try:
        if sum(1 for tr in study.trials if tr.state == optuna.trial.TrialState.COMPLETE) >= 5:
            imp = {k: round(v, 4) for k, v in optuna.importance.get_param_importances(study).items()}
    except Exception as e:  # importance is a nice-to-have
        log("importance failed:", e)
    return study, imp


def cma_phase(ev, dims, rungs, eta, n_evals, x0, sigma0, popsize, cma_rung, seed, cpu_cap, history):
    import cma
    d = len(dims)
    u0 = [min(0.98, max(0.02, enc(dd, x0[dd["name"]]))) for dd in dims]
    es = cma.CMAEvolutionStrategy(u0, sigma0, {"bounds": [[0.0] * d, [1.0] * d], "popsize": popsize, "seed": seed,
                                               "verbose": -9})
    used, gen = 0, 0
    while used < n_evals and not es.stop():
        if ev.cpu() > cpu_cap:
            log("CMA: CPU cap reached after %d evaluations" % used)
            break
        U = es.ask()
        fit, recs = [], []
        for j, u in enumerate(U):
            x = {dd["name"]: dec(dd, u[i]) for i, dd in enumerate(dims)}
            key = "cma%d_%d" % (gen, j)
            vals, m, _ = run_rungs(ev, key, x, rungs, stop_rung=cma_rung)
            fit.append(m["objective"])
            rec = {"opt": "cma", "id": key, "x": x, "rungs": vals, "complete": False, "gen": gen, "last": short(m)}
            recs.append(rec)
            used += 1
        es.tell(U, fit)
        # successive halving inside the generation: the best 1/eta go to the top rung
        order = np.argsort(fit)
        n_up = max(1, int(math.ceil(len(U) / eta)))
        if cma_rung < len(rungs) - 1:
            for j in order[:n_up]:
                rec = recs[j]
                vals, m, _ = run_rungs(ev, rec["id"], rec["x"], rungs, start_rung=cma_rung + 1)
                rec["rungs"].update(vals)
                rec["complete"] = True
                rec["last"] = short(m)
        else:
            for j in order[:n_up]:
                recs[j]["complete"] = True
        for rec in recs:
            ev.call(cmd="drop", key=rec["id"])
        history.extend(recs)
        best = min(recs, key=lambda r: r["rungs"][str(rungs[-1])] if r["complete"] else 9e9)
        log("CMA gen %d: rung-%d best %.4f median %.4f; top-rung best %.4f  sigma %.3f  cpu %.0fs" % (
            gen, rungs[cma_rung], min(fit), float(np.median(fit)), best["rungs"].get(str(rungs[-1]), float("nan")),
            es.sigma, ev.cpu()))
        gen += 1
    return es


def pick_finalists(history, dims, rungs, k, min_dist=0.03):
    top = str(rungs[-1])
    done = sorted([h for h in history if h["complete"] and top in h["rungs"] and h["id"] != "tpe0"],
                  key=lambda h: h["rungs"][top])
    out = []
    for h in done:
        u = np.array([enc(d, h["x"][d["name"]]) for d in dims])
        if all(np.sqrt(np.mean((u - o[1]) ** 2)) > min_dist for o in out):
            out.append((h, u))
        if len(out) >= k:
            break
    return [h for h, _ in out]


# ------------------------------------------------------------------ validation (ledger-guarded) and bootstrap
def cand_hash(info, overrides):
    blob = json.dumps({"engine": info["engineHash"], "params": info["paramsHash"],
                       "x": {k: float("%.6g" % v) for k, v in sorted(overrides.items())}}, sort_keys=True)
    return hashlib.sha1(blob.encode()).hexdigest()[:16]


def load_ledger():
    try:
        return json.load(open(LEDGER))
    except (OSError, ValueError):
        return {"note": "every parameter set ever scored on the 2024-2025 validation split by tools/mlcal.py; "
                        "a set listed here is not re-run (its stored result is reused)", "entries": []}


def per_fight_arrays(pf):
    pA = np.array([f["pA"] for f in pf])
    y = np.array([np.nan if f["winA"] is None else f["winA"] for f in pf], dtype=float)
    q = np.array([f["q"][f["bin"]] for f in pf])
    eA = np.array([f["eloA"] if f["eloA"] is not None else 1500 for f in pf], dtype=float)
    eB = np.array([f["eloB"] if f["eloB"] is not None else 1500 for f in pf], dtype=float)
    return pA, y, q, eA, eB


def fight_losses(pf):
    pA, y, q, eA, eB = per_fight_arrays(pf)
    w = ~np.isnan(y)
    ll = np.where(w, -(np.nan_to_num(y) * np.log(pA) + (1 - np.nan_to_num(y)) * np.log(1 - pA)), np.nan)
    br = np.where(w, (pA - np.nan_to_num(y)) ** 2, np.nan)
    acc = np.where(w, np.where(pA > 0.5, np.nan_to_num(y), np.where(pA < 0.5, 1 - np.nan_to_num(y), 0.5)), np.nan)
    pe = 1 / (1 + 10 ** ((eB - eA) / 400))
    elo = np.where(w, -(np.nan_to_num(y) * np.log(pe) + (1 - np.nan_to_num(y)) * np.log(1 - pe)), np.nan)
    return {"winLL": ll, "brier": br, "accuracy": acc, "binLL": -np.log(q), "eloLL": elo}


def boot(vals, B=2000, seed=11, paired=None):
    """Mean and 95% percentile bootstrap CI over fights (nan entries are skipped per resample)."""
    rng = np.random.default_rng(seed)
    v = np.asarray(vals, float) if paired is None else np.asarray(vals, float) - np.asarray(paired, float)
    n = len(v)
    idx = rng.integers(0, n, size=(B, n))
    means = np.nanmean(v[idx], axis=1)
    return {"mean": float(np.nanmean(v)), "lo": float(np.percentile(means, 2.5)), "hi": float(np.percentile(means, 97.5))}


def ece_sym(pf, nb=10):
    pA, y, *_ = per_fight_arrays(pf)
    w = ~np.isnan(y)
    p = np.concatenate([pA[w], 1 - pA[w]])
    yy = np.concatenate([y[w], 1 - y[w]])
    b = np.minimum(nb - 1, (p * nb).astype(int))
    rows, e = [], 0.0
    for i in range(nb):
        s = b == i
        if s.any():
            e += abs(p[s].mean() - yy[s].mean()) * s.sum()
            rows.append({"lo": i / nb, "hi": (i + 1) / nb, "n": int(s.sum()), "pred": float(p[s].mean()), "obs": float(yy[s].mean())})
    return e / len(p), rows


def validate_set(ev, info, finalists, val_sims, seed, force=False, split="val"):
    """finalists: list of (label, x-dict). Returns {label: result}. Each set runs on validation at most once.
    split="train" (with a scratch MLCAL_LEDGER) exercises this code path without touching validation."""
    ledger = load_ledger()
    known = {e["hash"]: e for e in ledger["entries"]}
    setup = None
    res, pfs = {}, {}
    for label, x in finalists:
        tree = ev.call(cmd="tree", x=x)
        h = cand_hash(info, tree["overrides"])
        if h in known and not force:
            log("validation: %s already scored on %s (hash %s); reusing the stored result" % (label, known[h]["when"], h))
            res[label] = dict(known[h]["result"], reused=True, hash=h)
            pfs[label] = known[h].get("perFight")
            continue
        if setup is None:
            setup = ev.call(cmd="setup", split=split, nFights=0 if split == "val" else 60, seed=seed, mirror="both")
            log("validation set: %d fights %s..%s, both corner orders, %d sims per order" % (setup["n"], setup["first"], setup["last"], val_sims))
        m = ev.call(cmd="eval", key="val_" + label, x=x, sims=val_sims, seedOff=0, detail=True)
        ev.call(cmd="drop", key="val_" + label)
        pf = m.pop("perFight")
        r = short(m)
        r.update({"baserates": rnd(m["baserates"], 4), "statline": rnd(m["statline"], 4), "n": m["nFights"],
                  "nWinner": m["nWinner"], "simsPerOrder": val_sims, "hash": h, "reused": False})
        res[label] = r
        pfs[label] = [{"id": f["id"], "pA": round(f["pA"], 5), "q": [round(v, 5) for v in f["q"]], "winA": f["winA"], "bin": f["bin"],
                       "eloA": f["eloA"], "eloB": f["eloB"]} for f in pf]
        ledger["entries"].append({"hash": h, "label": label, "when": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                                  "engine": info["engine"], "engineHash": info["engineHash"], "params": info["params"],
                                  "paramsHash": info["paramsHash"], "overrides": rnd(tree["overrides"]), "result": r,
                                  "perFight": pfs[label]})
        json.dump(ledger, open(LEDGER, "w"), separators=(",", ":"))
        log("validation %s: obj %.4f win %.4f bins %.4f base %.4f brier %.4f acc %.3f" % (
            label, r["objective"], r["winLL"], r["binLL"], r["basePen"], r["brier"], r["accuracy"]))
    # bootstrap CIs and paired differences against the baseline
    base_l = fight_losses(pfs["baseline"]) if pfs.get("baseline") else None
    for label in res:
        if not pfs.get(label):
            continue
        L = fight_losses(pfs[label])
        ci = {k: rnd(boot(L[k]), 5) for k in ("winLL", "brier", "accuracy", "binLL")}
        ci["eloLL"] = rnd(boot(L["eloLL"]), 5)
        ci["obj_wb"] = rnd(boot(L["winLL"] + 0.5 * L["binLL"]), 5)
        e, rows = ece_sym(pfs[label])
        res[label]["ece_sym"] = round(e, 5)
        res[label]["calibration"] = rnd(rows, 4)
        res[label]["ci"] = ci
        if base_l is not None and label != "baseline":
            res[label]["vs_baseline"] = {k: rnd(boot(L[k], paired=base_l[k]), 5) for k in ("winLL", "brier", "binLL")}
            res[label]["vs_baseline"]["obj_wb"] = rnd(boot(L["winLL"] + 0.5 * L["binLL"],
                                                           paired=base_l["winLL"] + 0.5 * base_l["binLL"]), 5)
        res[label]["vs_elo_winLL"] = rnd(boot(L["winLL"], paired=L["eloLL"]), 5)
    return res


# ------------------------------------------------------------------ tune
def cmd_tune(args):
    if not os.path.exists(rel("data/derived/mlcal_priors_asof.json")):
        cmd_priors(argparse.Namespace(out="data/derived/mlcal_priors_asof.json"))
    rungs = [int(v) for v in args.rungs.split(",")]
    eta = max(2, int(round(rungs[1] / rungs[0]))) if len(rungs) > 1 else 2
    t0 = time.time()
    ev = Evaluator(args.spec, args.workers)
    try:
        info = ev.call(cmd="spec")
        dims = info["dims"]
        log("engine %s (%s), params %s (%s), %d dimensions, rungs %s, eta %d" % (
            info["engine"], info["engineVersion"], info["params"], info["paramsVersion"], len(dims), rungs, eta))
        st = ev.call(cmd="setup", split="train", nFights=args.n_fights, offset=0, sampleSeed=args.sample_seed,
                     seed=args.seed, mirror="swap")
        log("tuning sample: %d of %d train fights (%s..%s), corner order by fixed hash" % (st["n"], st["nSplit"], st["first"], st["last"]))
        history = []
        cap_tpe = args.cpu_min * 60 * args.tpe_share
        study, importance = tpe_phase(ev, dims, rungs, eta, args.trials, args.seed, cap_tpe, history)
        top = str(rungs[-1])
        base_rec = next(h for h in history if h["id"] == "tpe0")
        complete = [h for h in history if h["complete"]]
        best_tpe = min(complete, key=lambda h: h["rungs"][top])
        es = None
        if args.cma_evals > 0:
            x0 = best_tpe["x"] if args.cma_start == "best" else base_rec["x"]
            cma_rung = min(len(rungs) - 1, max(0, args.cma_rung if args.cma_rung >= 0 else len(rungs) - 2))
            es = cma_phase(ev, dims, rungs, eta, args.cma_evals, x0, args.cma_sigma, args.cma_pop, cma_rung, args.seed,
                           args.cpu_min * 60, history)
        tune_cpu = ev.cpu()
        finalists = pick_finalists(history, dims, rungs, args.top)
        log("finalists: " + ", ".join("%s %.4f" % (h["id"], h["rungs"][top]) for h in finalists) +
            "; baseline %.4f" % base_rec["rungs"][top])

        # confirmation on a disjoint train window with fresh seeds
        conf = {}
        if args.confirm_fights > 0:
            cs = ev.call(cmd="setup", split="train", nFights=args.confirm_fights, offset=st["n"], sampleSeed=args.sample_seed,
                         seed=args.seed + 101, mirror="swap")
            log("confirmation sample: %d other train fights, fresh seeds" % cs["n"])
            for label, x in [("baseline", base_rec["x"])] + [(h["id"], h["x"]) for h in finalists]:
                m = ev.call(cmd="eval", key="conf_" + label, x=x, sims=args.confirm_sims, seedOff=0)
                ev.call(cmd="drop", key="conf_" + label)
                conf[label] = short(m)
                log("confirm %-10s obj %.4f win %.4f bins %.4f base %.4f" % (label, m["objective"], m["winLL"], m["binLL"], m["basePen"]))
            finalists.sort(key=lambda h: conf[h["id"]]["objective"])

        # validation, once per parameter set
        val = {}
        if not args.no_val:
            if args.val_split != "val" and not os.environ.get("MLCAL_LEDGER"):
                sys.exit("--val-split train is a code-path test: set MLCAL_LEDGER to a scratch file")
            val = validate_set(ev, info, [("baseline", base_rec["x"])] + [(h["id"], h["x"]) for h in finalists],
                               args.val_sims, args.seed + 202, split=args.val_split)
        total_cpu = ev.cpu()

        # output
        cands = []
        for r, h in enumerate(finalists, 1):
            tree = ev.call(cmd="tree", x=h["x"])
            cands.append({"rank": r, "source": h["opt"], "id": h["id"], "x": rnd(h["x"]), "overrides": rnd(tree["overrides"]),
                          "train": {"rungs": rnd(h["rungs"]), "top": h["last"]}, "confirm": conf.get(h["id"]),
                          "val": val.get(h["id"])})
        out = {
            "meta": {
                "tool": "tools/mlcal.py + tools/mlcal.js", "created": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "engine": info["engine"], "engineVersion": info["engineVersion"], "engineHash": info["engineHash"],
                "params": info["params"], "paramsVersion": info["paramsVersion"], "paramsHash": info["paramsHash"],
                "spec": args.spec, "dims": dims, "objective": info.get("objective"),
                "budget": {"trials": args.trials, "cma_evals": args.cma_evals, "cma_pop": args.cma_pop, "n_fights": st["n"],
                           "rungs": rungs, "eta": eta, "confirm_fights": args.confirm_fights, "confirm_sims": args.confirm_sims,
                           "val_sims_per_order": args.val_sims, "workers": args.workers, "seed": args.seed,
                           "sample_seed": args.sample_seed},
                "cpu_seconds": {"tuning": round(tune_cpu, 1), "total": round(total_cpu, 1)},
                "wall_seconds": round(time.time() - t0, 1),
                "protocol": "train 2019-2023 (tuning window + disjoint confirmation window), validation 2024-01-01..2025-12-31 "
                            "scored once per parameter set (ledger data/derived/mlcal_val_ledger.json), no 2026 fight loaded; "
                            "winner log loss is corner-symmetric (fixed-hash corner swap in tuning, both orders in validation)",
                "how_to_use": "node tools/mlcal.js export --cand data/derived/mlcal_candidates.json --rank 1 --out <file.js> writes a "
                              "full params file; the owner of src/params3.js copies the overrides in after review",
            },
            "baseline": {"x": rnd(base_rec["x"]), "train": {"rungs": rnd(base_rec["rungs"]), "top": base_rec["last"]},
                         "confirm": conf.get("baseline"), "val": val.get("baseline")},
            "candidates": cands,
            "tpe_importance": importance,
            "history": [dict(h, x=rnd(h["x"], 5), rungs=rnd(h["rungs"]), last=rnd(h["last"], 5)) for h in history],
        }
        json.dump(out, open(rel(args.out), "w"), indent=1)
        log("wrote %s; CPU %.0f s (tuning %.0f s), wall %.0f s" % (args.out, total_cpu, tune_cpu, time.time() - t0))
        summary(out)
    finally:
        ev.close()


def summary(out):
    b = out["baseline"]
    print("\nlabel        source  train(top)  confirm   val obj  val winLL [95% CI]           val binLL  val brier  acc    dWinLL vs base [CI]")
    rows = [("baseline", "-", b)] + [("rank %d" % c["rank"], c["source"], c) for c in out["candidates"]]
    for label, src, c in rows:
        top = c["train"]["top"]["objective"]
        conf = (c.get("confirm") or {}).get("objective")
        v = c.get("val") or {}
        ci = (v.get("ci") or {}).get("winLL") or {}
        d = (v.get("vs_baseline") or {}).get("winLL") or {}
        print("%-12s %-6s  %.4f      %s   %s   %s   %s  %s  %s  %s" % (
            label, src, top, "%.4f" % conf if conf else "  -   ", "%.4f" % v["objective"] if v else "  -   ",
            "%.4f [%.4f, %.4f]" % (ci["mean"], ci["lo"], ci["hi"]) if ci else "-",
            "%.4f" % v["binLL"] if v else "-", "%.4f" % v["brier"] if v else "-", "%.3f" % v["accuracy"] if v else "-",
            "%+.4f [%+.4f, %+.4f]" % (d["mean"], d["lo"], d["hi"]) if d else ""))
    if b.get("val") and b["val"].get("ci"):
        e = b["val"]["ci"]["eloLL"]
        print("Elo reference on the same validation fights: winner log loss %.4f [%.4f, %.4f]" % (e["mean"], e["lo"], e["hi"]))


# ------------------------------------------------------------------ validate (stand-alone)
def cmd_validate(args):
    cand = json.load(open(rel(args.cand)))
    ranks = [int(r) for r in args.ranks.split(",")] if args.ranks else [c["rank"] for c in cand["candidates"]]
    ev = Evaluator(args.spec or cand["meta"]["spec"], args.workers)
    try:
        info = ev.call(cmd="spec")
        fin = [("baseline", cand["baseline"]["x"])] + [(c["id"], c["overrides"]) for c in cand["candidates"] if c["rank"] in ranks]
        res = validate_set(ev, info, fin, args.val_sims, args.seed, force=args.force)
        cand["baseline"]["val"] = res.get("baseline")
        for c in cand["candidates"]:
            if c["id"] in res:
                c["val"] = res[c["id"]]
        json.dump(cand, open(rel(args.cand), "w"), indent=1)
        summary(cand)
    finally:
        ev.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("priors")
    p.add_argument("--out", default="data/derived/mlcal_priors_asof.json")
    p = sub.add_parser("tune")
    p.add_argument("--spec", default="tools/mlcal_spec_engine3.json")
    p.add_argument("--trials", type=int, default=30, help="Optuna TPE trials, trial 0 = current parameters (30)")
    p.add_argument("--cma-evals", type=int, default=32, help="CMA-ES candidate evaluations; 0 skips CMA (32)")
    p.add_argument("--cma-pop", type=int, default=8)
    p.add_argument("--cma-sigma", type=float, default=0.15, help="initial CMA step in the normalized box (0.15)")
    p.add_argument("--cma-start", choices=["best", "current"], default="best")
    p.add_argument("--cma-rung", type=int, default=-1, help="rung CMA ranks on (-1 = second to last)")
    p.add_argument("--n-fights", type=int, default=600, help="train fights in the tuning window (600)")
    p.add_argument("--sample-seed", type=int, default=1)
    p.add_argument("--rungs", default="15,30,60", help="cumulative sims per fight at each rung (15,30,60)")
    p.add_argument("--seed", type=int, default=20261106, help="common-random-number seed")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--top", type=int, default=3, help="finalists confirmed and validated (3)")
    p.add_argument("--confirm-fights", type=int, default=600)
    p.add_argument("--confirm-sims", type=int, default=60)
    p.add_argument("--val-sims", type=int, default=80, help="sims per corner order on validation (80)")
    p.add_argument("--no-val", action="store_true")
    p.add_argument("--val-split", default="val", choices=["val", "train"], help=argparse.SUPPRESS)
    p.add_argument("--cpu-min", type=float, default=20, help="CPU minutes for tuning (TPE + CMA) (20)")
    p.add_argument("--tpe-share", type=float, default=0.5, help="share of --cpu-min TPE may use (0.5)")
    p.add_argument("--out", default="data/derived/mlcal_candidates.json")
    p = sub.add_parser("validate")
    p.add_argument("--cand", default="data/derived/mlcal_candidates.json")
    p.add_argument("--ranks", default="")
    p.add_argument("--spec", default=None)
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--val-sims", type=int, default=80)
    p.add_argument("--seed", type=int, default=20261106 + 202)
    p.add_argument("--force", action="store_true", help="re-run sets already in the ledger (avoid: validation is single-use)")
    a = ap.parse_args()
    {"priors": cmd_priors, "tune": cmd_tune, "validate": cmd_validate}[a.cmd](a)


if __name__ == "__main__":
    main()
