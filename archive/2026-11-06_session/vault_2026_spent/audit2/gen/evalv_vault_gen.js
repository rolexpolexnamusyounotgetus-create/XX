#!/usr/bin/env node
/* evalv.js: the STANDARD EVALUATION of a frozen engine version (engine v4 cycle on; docs/BACKLOG.md "Evaluation rule"
   and "Hidden-data protocol").

     node tools/evalv.js --version v4 [--split train] [--sims 300] [--workers 3] [--compare v3]
     node tools/evalv.js --version v4 --split val [--sims 300] [--workers 3] [--compare v3]     (ONE look per version)
     node tools/evalv.js --version v4 --engine-dir src --dev [--split train] ...                (unfrozen code: no history)

   What it runs. The engine and params of versions/<version>/ (engine3.js + params3.js, and ml/mlrates.js for engines
   with the learned stat-line layer) on data/derived/backtest_dev.json (every fight dated 2026-01-01 or later is dropped
   on load, whatever the file holds). TRAIN = 2019-01-01..2023-12-31, VALIDATION = 2024-01-01..2025-12-31.
   - Symmetric: every fight is simulated in both corner orders (sims per order = --sims) and the two are averaged in the
     data's orientation; nothing is fit with an intercept (BACKLOG: the first-named fighter wins 56.3%).
   - Common random numbers: fight f, order o uses makeRng(mix(hash(id), o, seed)), the same for every version.
   - Shrinkage priors: data/derived/mlcal_priors_asof.json[year] (walk-forward: division rates from the 5 years before
     Jan 1 of the fight's year; train-only for train fights).
   - Learned stat-line rates, leak-free, when the engine has them (FightEngine.loadMLRates and params mlWeight > 0):
     data/derived/mlrates_oof.json (2019-2023: time-ordered folds trained on 2010..year-1; 2024-2025: the dev model
     trained 2010-2023), passed per fight as opts.ml = { pred } in the simulation's corner order.
   - Durability (engine v5): durability.json walk-forward records + the train-only NORM (durOpts below).
   - Strength of schedule (engine v5, components.styles_sos sos "wf"): sos_wf.json walk-forward pairs per fight, A/B swapped
     with the corners; leave-one-year-out coefficients on train, the 2019-2023 fit on 2024-2025 (sosOpts below). The frozen
     copy must include styles_sos.js next to engine3.js.
   - Step-4 inputs (engine v5 merge step 4: components.embed, .oppadj, .preufc; each a no-op without its input): tools/mlpathrec.js
     (or the frozen copy's own mlpathrec.js + ml/embed.js when versions/<v>/ holds them): embedding task predictors from
     embed.json walk-forward snapshots with leave-one-year-out blend coefficients on train (data/derived/embed_blend_loyo.json) and
     the exported 2019-2023 recipe on 2024-2025; oppadj.json walk-forward factors; preufc.json pre-bout records for sides with
     0-3 UFC fights. A/B swapped with the corners; 2026 refused; a matchup whose component is on but did not get its input fails.
     Engines without these components (v3, v4) are untouched.
   Metrics (per split, 95% event-cluster bootstrap CIs, 2,000 resamples of events):
     winner log loss, Brier, accuracy, ECE (10 bins, mirrored), calibration slope (mirrored, no intercept), 7-bin log
     loss, method (KO / SUB / DEC) log loss, who x how x when log loss and the rest of tools/methodround.py's metrics
     (scored by `python3 tools/methodround.py --score`, paired against methodround model S), per-fight stat-line
     deviance (Poisson: sig landed, sig attempts, takedowns landed, control seconds, knockdowns; plus MAE), and the
     base-rate table (finish rate, KO / SUB / DEC, finish by round for 3- and 5-round fights, KD per 100 head landed,
     decision split UD / SD / MD, 10-8 rate) simulated vs actual. --compare <version> adds paired differences against
     that version's stored results on the same split.
   The blend test (validation runs only): the MoE stacker (tools/moe.py's Stacker, chosen linear family) refit with
     this version's engine probabilities, via tools/evalv_blend.py: validated engine weight and the blend's validation
     log loss with vs without the engine.
   v5.0.1 additions (v5 review): per-minute stat-line deviance conditioned on the real fight length (devpm_*; the unconditional
     dev_* mixes finish-rate and duration errors with rate accuracy); base rates by calendar year (the Calibrate gate's per-year
     KD / KO checks) and, on validation, by the dated glove-trial windows (information only); per-fight outputs at 6 decimals with
     the simulated stats, shares and minutes (b7 / cells, pKO / pSUB / pDEC, st, mins, dec), which tools/evalv_decide.js needs
     for the paired base-rate tests and the Holm-adjusted decision; every worker must report this version's engine and params
     (and the history entry's params version), and a durability record must be complete and fully applied (src "record").
   v8 additions (V6_V10_PLAN cycle 3): engines with components.retarget get the leak-free statlines targets per fight
     (data/derived/v8/statlines_targets.json; forward-chained fold tables on train, the 2019-2023 dev table on 2024-2025, none for
     2019) and must report the retarget applied; every run reports per-stat PIT coverage (pitCoverage: shares of fight-sides inside
     the central 80% band / above P90 / below P10; a pre-registered diagnostic, never a rule input in this tool).
   v9 additions (V6_V10_PLAN cycle 4): engines with components.judgeWF get the tracked 10-8 level per fight (opts.level.r108 from the
     eradrift verified tracker at the fight's month start, fit on fights strictly before it) and must report walk-forward judging
     applied (weights from params.judgeWF.byYear of the fight's year); components.levels is refused (no level-factor input here).
   Outputs: data/derived/evalv/<version>_<split>.json (metrics + per-fight predictions), and the version's entry in
   data/derived/version_history.json {version, date, engine_sha256, params_sha256, train, validation, blend, notes}.
   A train run creates or updates the entry's train block (and leaves validation null). A validation run fills
   validation and blend exactly once: it refuses when the entry already holds validation numbers for the same engine and
   params hashes, and when the frozen files no longer match the entry's hashes (a second look needs a new version entry
   and a note). --dev runs never touch the history. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = "/home/user/XX"; const VAULT_DIR = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault"; const AUD1 = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault/audit1"; const AUD2 = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault/audit2";
const VAULT_FROM = "2026-01-01";
const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"], vault: ["2026-01-01", "2026-11-01"] };
function loadDevTrain() { const btd = readJSON("data/derived/backtest_dev.json"); const keys = btd.meta.keys; const fs_ = btd.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01"); for (const f of fs_) { f.A.keys = keys; f.B.keys = keys; } return fs_; }
const STATK = ["sig_lnd", "sig_att", "td_lnd", "td_att", "ctrl", "kd", "h_lnd", "sub_att"];
const NSTAT = STATK.length;
const DEVK = ["sig_lnd", "sig_att", "td_lnd", "ctrl", "kd"];
// v8 (V6_V10_PLAN cycle 3 item 5): per-stat PIT coverage, a reported diagnostic (never a rule input here): each fighter's randomized
// PIT of the real total in the simulated distribution (both orders pooled; u from a hash of fight, side and stat; control in whole
// seconds); share of fight-sides inside the central 80% band, above P90 and below P10, for every stat backtest_dev records
const PITK = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_lnd", "td_att", "ctrl", "sub_att"];
const NPIT = PITK.length;

function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function readJSON(p) { return JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8")); }
function loadBacktest() {
  const bt = readJSON(path.join(VAULT_DIR, "backtest_vault.json"));
  const keys = bt.meta.keys;
  const fights = bt.fights.filter((f) => f.date >= VAULT_FROM && f.date < "2026-11-01");         // hidden-data protocol: never a 2026 fight
  for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
  return fights;
}
// outcome code in the data's orientation: { winner, cls: KO | SUB | DEC | DRAW | null (DQ, NC: excluded), round }
function outcome(f) {
  const r = f.result || {};
  const cls = { KO: "KO", DOC: "KO", SUB: "SUB", UD: "DEC", SD: "DEC", MD: "DEC", DRAW: "DRAW" }[r.method] || null;
  if (!cls || (cls !== "DRAW" && r.winner !== "A" && r.winner !== "B")) return null;
  return { winner: cls === "DRAW" ? "D" : r.winner, cls, round: r.round || 1, method: r.method };
}

// ================================================================== worker: simulate fights in both corner orders
if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(W.engineDir, "engine3.js"));
  const PRM = E.params();
  const useML = W.useML;
  const fights = loadBacktest();
  const byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON(path.join(AUD1, "priors_asof_vault.json"));
  // v6 (review gate 1): engines of major version 6+ read the fold-honest learned rates (tools/v6_foldhonest.py: stack weights
  // for year y fit on 2017..y-1 out-of-fold rows; 2024-2025 rows identical); earlier versions keep mlrates_oof.json
  const OOF = useML ? readJSON(path.join(AUD1, "mlrates_vault.json")) : null;
  // durability component (engine v5, params.components.durability): leak-free per-fight inputs. Without them the engine
  // falls back to the live-fit terms (2008..2026-10, which include the validation years and the vault) and the Oct 2026
  // league level. durability.json backtest[id] is strict walk-forward (2019-2023 entries fit on 2008..Y-1, 2024-2025
  // entries on 2008-2023); base = L730(t) x exp(const + division + context) recovered from p / (C x P); NORM = the
  // train-only strict-refit values (norm_*_backtest_2019_2023), so no 2024+ data enters either split.
  const useDur = typeof E.loadDurability === "function" && !!(PRM && PRM.components && PRM.components.durability);
  const DURJ = useDur ? readJSON(path.join(VAULT_DIR, "durability_vault.json")) : null; const DURN = useDur ? readJSON("data/derived/durability.json") : null;
  const durNorm = useDur ? { durability: { normChin: DURN.engine.norm_chin_backtest_2019_2023, normPow: DURN.engine.norm_pow_backtest_2019_2023 } } : null;
  function durOpts(id, o) {
    const d = DURJ && DURJ.backtest[id];
    if (!d) throw new Error("durability: no walk-forward record for fight " + id + " (refusing the live-fit fallback)");
    const side = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
    // v5.0.1 (v5 review): refuse a record with a missing or invalid field (the engine would fill it from the live fit)
    const ok = (v) => typeof v === "number" && isFinite(v) && v > 0;
    for (const s of ["A", "B"]) for (const k of ["chin_re", "chin_cov", "pow_re", "pow_cov"]) if (!d[s] || !ok(d[s][k])) throw new Error("durability: record " + id + " " + s + "." + k + " is not a finite positive number");
    if (!d.p || !ok(d.p.A) || !ok(d.p.B)) throw new Error("durability: record " + id + " has no valid p.A / p.B");
    const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
    const base = Math.sqrt(bA * bB);
    return o === 0 ? { A: side(d.A), B: side(d.B), base } : { A: side(d.B), B: side(d.A), base };
  }
  // styles_sos component (engine v5 merge step 3, params.components.styles_sos sub-flag sos, sosSource "wf"): a no-op until
  // opts.sos is passed. Per fight: the one-step walk-forward pair data/derived/sos_wf.json fights[id] (opponents' quality from
  // fights strictly before this one), A/B swapped together with the corners; coefficients meta.coef_loyo[path][year] for
  // train fights (leave-one-year-out, the out-of-fold policy of the learned rates) and meta.coef (the full 2019-2023 fit, =
  // src/styles_sos.js SOS_COEF) for 2024-2025. Same logic as tools/sosrec.js. The frozen copy must hold styles_sos.js next
  // to engine3.js, or the component silently stays off: refused below.
  const SSC = PRM && PRM.components && PRM.components.styles_sos;
  const useSOS = !!SSC && (SSC === true || SSC.sos !== false) && ((PRM.stylesSOS && PRM.stylesSOS.sosSource) || "wf") === "wf";
  if (useSOS && !fs.existsSync(path.join(W.engineDir, "styles_sos.js"))) throw new Error("styles_sos: " + W.engineDir + "/styles_sos.js missing (freeze it with the engine)");
  const SOSJ = useSOS ? readJSON(path.join(AUD1, "sos_wf_vault.json")) : null;
  function sosOpts(f, o, params) {
    const s = SOSJ.fights[f.id];
    if (!s || !s.A || !s.B) throw new Error("styles_sos: no walk-forward pair for fight " + f.id + " (refusing a neutral run)");
    const y = f.date.slice(0, 4), M = SOSJ.meta;
    const coef = f.date < "2024-01-01" ? { ml: M.coef_loyo.ml[y], base: M.coef_loyo.base[y] } : { ml: M.coef.ml, base: M.coef.base };
    if (!coef.ml || !coef.base) throw new Error("styles_sos: no coefficients for " + f.date);
    const p = Object.assign({}, params || {});
    p.stylesSOS = Object.assign({}, p.stylesSOS || {}, { sosCoef: coef });
    return { sos: o === 0 ? { A: s.A, B: s.B } : { A: s.B, B: s.A }, params: p };
  }
  // engine v5 merge step 4 (components.embed / .oppadj / .preufc): leak-free per-fight inputs from tools/mlpathrec.js, or the
  // frozen copy's own mlpathrec.js when the version directory holds one; for engines without these components it is a no-op
  const XR = require(W.mlpathrec)(E, ROOT);
  // engine v8 components.retarget: leak-free per-fight targets (tools/v8_targets.js: statdist engineTargets from forward-chained
  // statlines fold tables for 2020-2023, the dev table fit on 2019-2023 for 2024-2025; 2019 fights have none, so the retarget is
  // off for them), passed as opts.statTargets in the simulation's corner order; a fight with a table must get the retarget applied
  const P8 = typeof E.resolveParams === "function" ? E.resolveParams({}) : null;
  const useRT = !!(P8 && P8.components && P8.components.retarget);
  const RTJ = useRT ? readJSON(path.join(AUD2, "statlines_targets_vault.json")) : null;
  // engine v9 components.judgeWF: the walk-forward judging weights live in params.judgeWF.byYear (each fit on cards before Jan 1 of
  // its year); the 10-8 threshold follows the eradrift verified 10-8 tracker at the fight's month start, passed as opts.level.r108
  // (tools/v9_levels.js r108At; fit on fights strictly before that month). components.levels needs per-fight factors that this
  // tool does not build: refused (v9's candidate has it off).
  const useJW = !!(P8 && P8.components && P8.components.judgeWF);
  const useLV = !!(P8 && P8.components && P8.components.levels);
  if (useLV) throw new Error("evalv: components.levels is on but evalv has no level-factor input (tools/v9_levels.js computeLevels needs a reference run)");
  const LV9 = useJW ? require(path.join(ROOT, "tools/v9_levels.js")) : null;
  const names = OOF ? OOF.meta.targets : null;
  const rates = (arr) => { const o = {}; names.forEach((n, i) => { o[n] = arr[i]; }); return o; };
  parentPort.on("message", (msg) => {
    if (msg.cmd !== "run") return;
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id);
      const R = f.rounds === 5 ? 5 : 3;
      const NCELL = 4 * R + 3;
      const acc = { id, cells: new Float64Array(NCELL), dec: [0, 0, 0], draw: 0, n108: 0, judged: 0, decRounds: 0, decN108: 0,
        stats: new Float64Array(2 * NSTAT), mins: 0, n: 0, mlApplied: 0, rtApplied: 0, err: null, pit: null };
      const pv = []; for (let k = 0; k < 2 * NPIT; k++) pv.push([]);
      try {
        const rtT = useRT ? RTJ.fights[f.id] : null;
        if (useRT && !rtT) throw new Error("retarget: no statlines targets entry for fight " + f.id);
        for (let o = 0; o < 2; o++) {
          const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A;
          const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
          if (useML) {
            const ent = OOF.fights[f.id];
            if (ent && ent.A && ent.B) opts.ml = { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } };
            else opts.ml = false;
          } else if (typeof E.loadMLRates === "function") opts.ml = false;
          if (useDur) { opts.dur = durOpts(f.id, o); opts.params = durNorm; }
          if (useSOS) { const so = sosOpts(f, o, opts.params); opts.sos = so.sos; opts.params = so.params; }
          XR.apply(opts, f, o === 1, opts.params);   // step 4: opts.embed / opts.oppadj / opts.preufc for each component that is on
          if (useRT && rtT.fold) opts.statTargets = o === 0 ? { A: rtT.A, B: rtT.B, fin: rtT.fin } : { A: rtT.B, B: rtT.A, fin: { t: rtT.fin.t, A: rtT.fin.B, B: rtT.fin.A } };
          if (useJW) opts.level = Object.assign({}, opts.level || {}, { r108: LV9.r108At(f.date) });
          const m = E.matchup(A, B, opts);
          if (useJW && !(m.judgeWF && m.judgeWF.src === "byYear" && m.judgeWF.t108 > 0)) throw new Error("judgeWF: walk-forward judging not applied for " + f.id);
          if (useRT && rtT.fold && !(m.retarget && m.retarget.applied)) throw new Error("retarget: targets not applied for " + f.id);
          if (m.retarget && m.retarget.applied) acc.rtApplied++;
          XR.assertApplied(m, f.id, opts.params);
          if (useDur && !(m.dur && m.dur.baseFromRecord)) throw new Error("durability: walk-forward record not applied for " + f.id);
          if (useDur && (m.dur.A.src !== "record" || m.dur.B.src !== "record")) throw new Error("durability: computed chin / power fields used for " + f.id + " (" + m.dur.A.src + " / " + m.dur.B.src + ")");
          if (useSOS && !(m.stylesSOS && m.stylesSOS.sos && m.stylesSOS.sos.have && m.stylesSOS.sos.have[0] && m.stylesSOS.sos.have[1])) {
            throw new Error("styles_sos: walk-forward pair not applied for " + f.id);
          }
          if (m.mlApplied) acc.mlApplied++;
          const rng = E.makeRng(mix(mix(hash32(f.id), o), W.seed));
          for (let i = 0; i < W.sims; i++) {
            const s = E.simulate(m, rng, false);
            // map the simulated corner back to the data's orientation
            const wD = s.winner === "D" ? "D" : ((s.winner === "A") === (o === 0) ? "A" : "B");
            const meth = s.method, isDec = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW";
            const r = Math.max(1, Math.min(R, s.round));
            if (wD === "D") { acc.cells[4 * R + 2]++; acc.draw++; }
            else if (isDec) { acc.cells[wD === "A" ? 4 * R : 4 * R + 1]++; acc.dec[meth === "UD" ? 0 : (meth === "SD" ? 1 : 2)]++; }
            else {
              const sub = meth === "SUB";
              acc.cells[(wD === "A" ? (sub ? R : 0) : (sub ? 3 * R : 2 * R)) + r - 1]++;
            }
            acc.n108 += s.n108 || 0;
            const jr = isDec ? R : (meth === "CORNER" || meth === "DOC" ? s.round : s.round - 1);
            acc.judged += jr;
            // card-implied 10-8 points, comparable with the 'actual' from card totals: judges' 10-8s plus every point
            // deduction on all three cards (engine v4.0.1+; earlier engines have no deductions, so nothing changes for them)
            if (isDec) { acc.decRounds += R; acc.decN108 += (s.n108 || 0) + 3 * (s.nDed || 0); }
            acc.mins += isDec ? R * 5 : (s.round - 1) * 5 + s.t / 60;
            const TA = o === 0 ? s.totals.A : s.totals.B, TB = o === 0 ? s.totals.B : s.totals.A;
            for (let k = 0; k < NSTAT; k++) { acc.stats[k] += TA[STATK[k]]; acc.stats[NSTAT + k] += TB[STATK[k]]; }
            for (let k = 0; k < NPIT; k++) {
              let va = TA[PITK[k]], vb = TB[PITK[k]];
              if (PITK[k] === "ctrl") { va = Math.round(va); vb = Math.round(vb); }
              pv[k].push(va); pv[NPIT + k].push(vb);
            }
            acc.n++;
          }
        }
        if (f.actual && f.actual.A && f.actual.B) {
          acc.pit = new Array(2 * NPIT).fill(null);
          for (let sd = 0; sd < 2; sd++) for (let k = 0; k < NPIT; k++) {
            const y = f.actual[sd ? "B" : "A"][PITK[k]];
            if (y == null) continue;
            const v = pv[sd * NPIT + k]; let lt = 0, eq = 0;
            for (const x of v) { if (x < y) lt++; else if (x === y) eq++; }
            acc.pit[sd * NPIT + k] = (lt + (hash32(f.id + "|" + sd + "|" + PITK[k]) / 4294967296) * eq) / v.length;
          }
        }
      } catch (e) { acc.err = String(e && e.message || e); }
      out.push({ id: acc.id, cells: Array.from(acc.cells), dec: acc.dec, draw: acc.draw, n108: acc.n108, judged: acc.judged,
        decRounds: acc.decRounds, decN108: acc.decN108, stats: Array.from(acc.stats), mins: acc.mins, n: acc.n, mlApplied: acc.mlApplied,
        rtApplied: acc.rtApplied, pit: acc.pit, err: acc.err });
    }
    parentPort.postMessage({ cmd: "done", out, version: E.VERSION, params: PRM && PRM.version });
  });
  return;
}

// ================================================================== main
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2), v = argv[i + 1];
    if (v == null || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
if (!args.version) { console.error("evalv: --version vN is required"); process.exit(2); }
const VERSION = String(args.version);
const SPLIT = String(args.split || "train");
if (!SPLITS[SPLIT]) { console.error("evalv: --split train | val"); process.exit(2); }
const DEV = true;   // vault audit 2: never touches version_history.json
const ENGINE_DIR = path.resolve(ROOT, args["engine-dir"] || path.join("versions", VERSION));
const SIMS = +(args.sims || 300);
const WORKERS = Math.max(1, Math.min(3, +(args.workers || 3)));
const SEED = +(args.seed || 1);
const B = +(args.boot || 2000);
const OUTDIR = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault/audit2/evalv";
const HIST = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault/audit2/evalv/no_history.json";
if (!fs.existsSync(path.join(ENGINE_DIR, "engine3.js")) || !fs.existsSync(path.join(ENGINE_DIR, "params3.js"))) {
  console.error("evalv: no engine3.js / params3.js in " + ENGINE_DIR); process.exit(2);
}
if (!DEV && path.relative(path.join(ROOT, "versions"), ENGINE_DIR).startsWith("..")) {
  console.error("evalv: a history run needs a frozen copy under versions/ (use --dev for src/)"); process.exit(2);
}
const engineSha = sha256(path.join(ENGINE_DIR, "engine3.js")), paramsSha = sha256(path.join(ENGINE_DIR, "params3.js"));
const mlFile = path.join(ENGINE_DIR, "ml", "mlrates.js");
const mlSha = fs.existsSync(mlFile) ? sha256(mlFile) : null;
// step-4 inputs helper: the frozen copy's own mlpathrec.js when present, else tools/mlpathrec.js (its hash goes into the output)
const MLP_FILE = path.join(ROOT, "tools/vault_audit2/mlpathrec_vault.js"); process.env.VAUDIT_ENGINE_DIR = ENGINE_DIR;
const mlpSha = sha256(MLP_FILE);

function loadHistory() { return fs.existsSync(HIST) ? JSON.parse(fs.readFileSync(HIST, "utf8")) : { meta: {}, versions: [] }; }
function historyEntry(H) { return H.versions.find((v) => v.version === VERSION && !v.superseded) || null; }
if (SPLIT === "val" && !DEV) {
  const e = historyEntry(loadHistory());
  if (e && e.validation) {
    if (e.engine_sha256 === engineSha && e.params_sha256 === paramsSha) {
      console.error(`evalv: ${VERSION} already has validation numbers for these files (one look per version). A second look needs a new version entry and a note.`);
      process.exit(3);
    }
  }
  if (e && (e.engine_sha256 !== engineSha || e.params_sha256 !== paramsSha)) {
    console.error(`evalv: versions/${VERSION} no longer matches the history entry's hashes; freeze a new version instead.`);
    process.exit(3);
  }
  // v7 on (V6_V10_PLAN 6.2 item 4): no look without a passed train gate and a pre-registration written into the entry first
  if (e && (e.status === "gate_failed" || (e.train_gate && e.train_gate.result === "FAIL"))) {
    console.error(`evalv: ${VERSION} failed its binding train gate (version_history.json status ${e.status}); a validation look is not allowed.`);
    process.exit(3);
  }
  const maj = +String(VERSION).replace(/^v/, "").split(".")[0];
  if (maj >= 7 && !(e && e.prereg)) {
    console.error(`evalv: ${VERSION} has no pre-registration in data/derived/version_history.json; write it (after a passed train gate) before the look.`);
    process.exit(3);
  }
}

const E0 = require(path.join(ENGINE_DIR, "engine3.js"));
const P0 = E0.params();
const useML = !args["no-ml"] && typeof E0.loadMLRates === "function" && (P0.mlWeight == null || P0.mlWeight > 0);
const fightsAll = loadBacktest();
const [d0, d1] = SPLITS[SPLIT];
const fights = fightsAll.filter((f) => f.date >= d0 && f.date < d1);
const trainFights = loadDevTrain();
console.log(`evalv ${VERSION} (engine ${E0.VERSION}, params ${P0.version}) on ${SPLIT}: ${fights.length} fights x 2 orders x ${SIMS} sims, ` +
  `${WORKERS} workers, ML ${useML ? "on (out-of-fold)" : "off"}${DEV ? ", DEV run (no history)" : ""}`);

// ------------------------------------------------------------------ run the workers
const WORKER_VERSIONS = new Set();
function runAll() {
  return new Promise((resolve, reject) => {
    const ids = fights.map((f) => f.id);
    const chunks = [];
    const CH = 40;
    for (let i = 0; i < ids.length; i += CH) chunks.push(ids.slice(i, i + CH));
    const res = [];
    let next = 0, live = 0, done = 0;
    const t0 = Date.now();
    const workers = [];
    function feed(w) {
      if (next >= chunks.length) { w.terminate(); live--; if (live === 0) resolve(res); return; }
      w.postMessage({ cmd: "run", ids: chunks[next++] });
    }
    for (let k = 0; k < Math.min(WORKERS, chunks.length); k++) {
      const w = new Worker(__filename, { workerData: { engineDir: ENGINE_DIR, sims: SIMS, seed: SEED, useML, mlpathrec: MLP_FILE } });
      live++;
      w.on("message", (m) => {
        if (m.cmd === "done") {
          WORKER_VERSIONS.add(m.version + " | " + m.params);
          res.push(...m.out); done += m.out.length;
          if (done % 400 < m.out.length) console.log(`  ${done}/${ids.length} fights, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
          feed(w);
        }
      });
      w.on("error", reject);
      workers.push(w);
      feed(w);
    }
  });
}

// ------------------------------------------------------------------ metrics
const clip = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));
function baseDist(fs_) {
  // corner-symmetric outcome shares from TRAIN fights (smoothing prior; train-only for every split)
  const c = { KO: 0, SUB: 0, DEC: 0, DRAW: 0 }, byR = { 3: { ko: [0, 0, 0], sub: [0, 0, 0], dec: 0, draw: 0, n: 0 }, 5: { ko: [0, 0, 0, 0, 0], sub: [0, 0, 0, 0, 0], dec: 0, draw: 0, n: 0 } };
  let n = 0;
  for (const f of fs_) {
    const y = outcome(f); if (!y) continue;
    c[y.cls]++; n++;
    const R = f.rounds === 5 ? 5 : 3, q = byR[R]; q.n++;
    if (y.cls === "KO") q.ko[Math.min(R, y.round) - 1]++; else if (y.cls === "SUB") q.sub[Math.min(R, y.round) - 1]++; else if (y.cls === "DEC") q.dec++; else q.draw++;
  }
  const b7 = [c.KO / 2, c.SUB / 2, c.DEC / 2, c.DRAW, c.DEC / 2, c.SUB / 2, c.KO / 2].map((v) => v / n);
  const cells = {};
  for (const R of [3, 5]) {
    const q = byR[R], m = Math.max(1, q.n), v = [];
    for (let r = 0; r < R; r++) v.push(q.ko[r] / 2 / m); for (let r = 0; r < R; r++) v.push(q.sub[r] / 2 / m);
    for (let r = 0; r < R; r++) v.push(q.ko[r] / 2 / m); for (let r = 0; r < R; r++) v.push(q.sub[r] / 2 / m);
    v.push(q.dec / 2 / m, q.dec / 2 / m, q.draw / m);
    const s = v.reduce((a, b) => a + b, 0) || 1; cells[R] = v.map((x) => (x + 1e-4) / (s + 1e-4 * v.length));
  }
  return { b7, cells };
}
function perFight(sim, f, base) {
  const R = f.rounds === 5 ? 5 : 3, n = sim.n;
  const c = sim.cells;
  // smoothed joint cells (one pseudo-sim spread over the train base cells of this format)
  const cellsS = c.map((v, i) => (v + base.cells[R][i]) / (n + 1));
  const sumR = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += c[i]; return s; };
  const aKO = sumR(0, R), aSUB = sumR(R, 2 * R), bKO = sumR(2 * R, 3 * R), bSUB = sumR(3 * R, 4 * R), aDEC = c[4 * R], bDEC = c[4 * R + 1], DR = c[4 * R + 2];
  const raw7 = [aKO, aSUB, aDEC, DR, bDEC, bSUB, bKO];
  const b7 = raw7.map((v, i) => (v + base.b7[i]) / (n + 1));
  const aW = aKO + aSUB + aDEC, bW = bKO + bSUB + bDEC;
  const pA = clip((aW + 0.5) / (aW + bW + 1), 0.005, 0.995);
  const finR = []; for (let r = 0; r < R; r++) finR.push((c[r] + c[R + r] + c[2 * R + r] + c[3 * R + r]) / n);
  const stats = { A: {}, B: {} };
  for (let k = 0; k < NSTAT; k++) { stats.A[STATK[k]] = sim.stats[k] / n; stats.B[STATK[k]] = sim.stats[NSTAT + k] / n; }
  return { id: f.id, event: f.event, date: f.date, rounds: R, pA, b7, cells: cellsS, rawCounts: raw7, finR,
    pKO: (aKO + bKO) / n, pSUB: (aSUB + bSUB) / n, pDEC: (aDEC + bDEC + DR) / n, stats, mins: sim.mins / n,
    dec: sim.dec, draw: sim.draw, decRounds: sim.decRounds, decN108: sim.decN108, n };
}
function poisDev(y, mu) { mu = Math.max(mu, 1e-6); return 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu)); }
function losses(pf, f) {
  const y = outcome(f), L = {};
  if (y) {
    const k7 = y.cls === "DRAW" ? 3 : (y.cls === "DEC" ? (y.winner === "A" ? 2 : 4) : (y.cls === "SUB" ? (y.winner === "A" ? 1 : 5) : (y.winner === "A" ? 0 : 6)));
    L.bin7 = -Math.log(pf.b7[k7]);
    const s3 = { KO: pf.b7[0] + pf.b7[6], SUB: pf.b7[1] + pf.b7[5], DEC: pf.b7[2] + pf.b7[3] + pf.b7[4] };
    L.method = -Math.log(s3[y.cls === "DRAW" ? "DEC" : y.cls]);
    if (y.winner === "A" || y.winner === "B") {
      const yy = y.winner === "A" ? 1 : 0, p = pf.pA;
      L.winLL = -(yy * Math.log(p) + (1 - yy) * Math.log(1 - p));
      L.brier = (p - yy) * (p - yy);
      L.acc = p === 0.5 ? 0.5 : ((p > 0.5) === (yy === 1) ? 1 : 0);
      L._p = p; L._y = yy;
    }
  }
  if (f.actual && f.actual.A && f.actual.B) {
    // v5.0.1 (v5 review): per-minute deviance conditioned on the actual fight length: the simulated per-minute rate (ratio of
    // means over the sims) times the real minutes, so finish-rate and duration errors do not mix with rate accuracy
    const am = +f.actual.minutes || 0, smin = pf.mins > 0 ? pf.mins : null;
    for (const k of DEVK) {
      const ya = f.actual.A[k], yb = f.actual.B[k];
      if (ya == null || yb == null) continue;
      L["dev_" + k] = 0.5 * (poisDev(ya, pf.stats.A[k]) + poisDev(yb, pf.stats.B[k]));
      L["mae_" + k] = 0.5 * (Math.abs(ya - pf.stats.A[k]) + Math.abs(yb - pf.stats.B[k]));
      if (am > 0 && smin) L["devpm_" + k] = 0.5 * (poisDev(ya, pf.stats.A[k] / smin * am) + poisDev(yb, pf.stats.B[k] / smin * am));
    }
  }
  return L;
}
function ece(ps, ys) {
  const bins = new Array(10).fill(0).map(() => [0, 0, 0]);
  for (let i = 0; i < ps.length; i++) for (const [p, y] of [[ps[i], ys[i]], [1 - ps[i], 1 - ys[i]]]) {
    const b = Math.min(9, Math.floor(p * 10)); bins[b][0]++; bins[b][1] += p; bins[b][2] += y;
  }
  let e = 0, n = 0; for (const b of bins) { n += b[0]; } for (const b of bins) if (b[0]) e += b[0] / n * Math.abs(b[1] / b[0] - b[2] / b[0]);
  return e;
}
function calSlope(ps, ys) {
  // mirrored, no intercept: logit P(y) = beta * logit(p)
  let beta = 1;
  for (let it = 0; it < 30; it++) {
    let g = 0, h = 0;
    for (let i = 0; i < ps.length; i++) for (const [p, y] of [[ps[i], ys[i]], [1 - ps[i], 1 - ys[i]]]) {
      const x = Math.log(p / (1 - p)), q = 1 / (1 + Math.exp(-beta * x)); g += (y - q) * x; h += q * (1 - q) * x * x;
    }
    beta += g / Math.max(1e-9, h);
  }
  return beta;
}
function baseRates(pfs, fs_, simSide) {
  // simulated (mean over fights) vs actual on the same fights
  const o = {}, idx = new Map(fs_.map((f) => [f.id, f]));
  let n = 0, sFin = 0, sKO = 0, sSUB = 0, sDEC = 0, aFin = 0, aKO = 0, aSUB = 0, aDEC = 0;
  const fr = { 3: { n: 0, s: [0, 0, 0], a: [0, 0, 0] }, 5: { n: 0, s: [0, 0, 0, 0, 0], a: [0, 0, 0, 0, 0] } };
  let sKD = 0, sHL = 0, aKD = 0, aHL = 0, sUD = 0, sSD = 0, sMD = 0, aUD = 0, aSD = 0, aMD = 0, sW = 0, sR = 0, aW = 0, aR = 0;
  let sMin = 0, aMin = 0, sSL = 0, aSL = 0, sTD = 0, aTD = 0, sCT = 0, aCT = 0;
  for (const pf of pfs) {
    const f = idx.get(pf.id), y = outcome(f);
    if (y) {
      n++; sFin += pf.pKO + pf.pSUB; sKO += pf.pKO; sSUB += pf.pSUB; sDEC += pf.pDEC;
      if (y.cls === "KO") { aKO++; aFin++; } else if (y.cls === "SUB") { aSUB++; aFin++; } else aDEC++;
      const q = fr[pf.rounds]; q.n++;
      for (let r = 0; r < pf.rounds; r++) q.s[r] += pf.finR[r];
      if (y.cls === "KO" || y.cls === "SUB") q.a[Math.min(pf.rounds, y.round) - 1]++;
      const nd = pf.dec[0] + pf.dec[1] + pf.dec[2];
      if (nd) { sUD += pf.dec[0] / pf.n; sSD += pf.dec[1] / pf.n; sMD += pf.dec[2] / pf.n; }
      if (y.method === "UD") aUD++; else if (y.method === "SD") aSD++; else if (y.method === "MD") aMD++;
      sW += pf.decN108 / pf.n; sR += 3 * pf.decRounds / pf.n;
      const cards = f.result && f.result.cards;
      if ((y.method === "UD" || y.method === "SD" || y.method === "MD" || y.method === "DRAW") && cards && cards.length === 3) {
        // judged rounds from the card total, not the scheduled format: technical decisions/draws and mislabelled formats
        // carry fewer rounds (2025: a 2-round technical draw and a 3-round card on a fight stored as 5 rounds counted as
        // 19-38 phantom 10-8 points per card and lifted the 2024-25 'actual' from 2.4% to 6.3%; fixed Nov 6 after v4's val look)
        for (const c of cards) { const rj = Math.max(1, Math.round((c[0] + c[1]) / 19)); aW += Math.max(0, 19 * rj - (c[0] + c[1])); aR += rj; }
      }
    }
    if (f.actual && f.actual.A && f.actual.B) {
      sKD += pf.stats.A.kd + pf.stats.B.kd; sHL += pf.stats.A.h_lnd + pf.stats.B.h_lnd;
      aKD += f.actual.A.kd + f.actual.B.kd; aHL += f.actual.A.h_lnd + f.actual.B.h_lnd;
      sMin += pf.mins; aMin += f.actual.minutes || 0;
      sSL += pf.stats.A.sig_lnd + pf.stats.B.sig_lnd; aSL += f.actual.A.sig_lnd + f.actual.B.sig_lnd;
      sTD += pf.stats.A.td_lnd + pf.stats.B.td_lnd; aTD += f.actual.A.td_lnd + f.actual.B.td_lnd;
      sCT += pf.stats.A.ctrl + pf.stats.B.ctrl; aCT += f.actual.A.ctrl + f.actual.B.ctrl;
    }
  }
  const pair = (s, a) => ({ sim: s, actual: a, diff: s - a });
  o.n = n;
  o.finish = pair(sFin / n, aFin / n); o.KO = pair(sKO / n, aKO / n); o.SUB = pair(sSUB / n, aSUB / n); o.DEC = pair(sDEC / n, aDEC / n);
  for (const R of [3, 5]) { const q = fr[R]; o["finByRound" + R] = { n: q.n, sim: q.s.map((v) => v / Math.max(1, q.n)), actual: q.a.map((v) => v / Math.max(1, q.n)) }; }
  o.kdPer100Head = pair(100 * sKD / sHL, 100 * aKD / aHL);
  const sD = sUD + sSD + sMD, aD = aUD + aSD + aMD;
  o.decision = { sim: { UD: sUD / sD, SD: sSD / sD, MD: sMD / sD }, actual: { UD: aUD / aD, SD: aSD / aD, MD: aMD / aD }, nActual: aD };
  o.r108 = pair(sW / Math.max(1e-9, sR), aW / Math.max(1, aR));
  o.sigLndPer15 = pair(15 * sSL / 2 / sMin, 15 * aSL / 2 / aMin); o.tdPer15 = pair(15 * sTD / 2 / sMin, 15 * aTD / 2 / aMin); o.ctrlPer15 = pair(15 * sCT / 2 / sMin, 15 * aCT / 2 / aMin);
  return o;
}
function bootstrap(pfs, L, fs_, keys, extra) {
  // event-cluster bootstrap of per-fight means (and of ECE / slope via resampled fight lists)
  const ev = new Map();
  pfs.forEach((pf, i) => { const k = pf.event + "|" + pf.date; if (!ev.has(k)) ev.set(k, []); ev.get(k).push(i); });
  const groups = [...ev.values()];
  let st = 12345;
  const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const point = {}, draws = {};
  for (const k of keys) { const v = L.map((l) => l[k]).filter((x) => x != null && isFinite(x)); point[k] = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); draws[k] = []; }
  const winIdx = L.map((l, i) => (l._p != null ? i : -1)).filter((i) => i >= 0);
  point.ece = ece(winIdx.map((i) => L[i]._p), winIdx.map((i) => L[i]._y));
  point.calSlope = calSlope(winIdx.map((i) => L[i]._p), winIdx.map((i) => L[i]._y));
  draws.ece = []; draws.calSlope = [];
  for (let b = 0; b < B; b++) {
    const sums = {}, cnt = {}; for (const k of keys) { sums[k] = 0; cnt[k] = 0; }
    const ps = [], ys = [];
    for (let g = 0; g < groups.length; g++) {
      const G = groups[Math.floor(rnd() * groups.length)];
      for (const i of G) {
        const l = L[i];
        for (const k of keys) { const v = l[k]; if (v != null && isFinite(v)) { sums[k] += v; cnt[k]++; } }
        if (l._p != null && b < 400) { ps.push(l._p); ys.push(l._y); }
      }
    }
    for (const k of keys) draws[k].push(sums[k] / Math.max(1, cnt[k]));
    if (b < 400) { draws.ece.push(ece(ps, ys)); draws.calSlope.push(calSlope(ps, ys)); }
  }
  const out = {};
  for (const k of Object.keys(draws)) {
    const d = draws[k].slice().sort((a, b) => a - b);
    out[k] = { est: point[k], lo: d[Math.floor(0.025 * d.length)], hi: d[Math.min(d.length - 1, Math.floor(0.975 * d.length))] };
  }
  return out;
}
function pairedDiff(pfs, L, Lo, keys) {
  const ev = new Map();
  pfs.forEach((pf, i) => { const k = pf.event + "|" + pf.date; if (!ev.has(k)) ev.set(k, []); ev.get(k).push(i); });
  const groups = [...ev.values()];
  let st = 777;
  const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const out = {};
  for (const k of keys) {
    const d = L.map((l, i) => (l[k] != null && Lo[i] && Lo[i][k] != null ? l[k] - Lo[i][k] : null));
    const v = d.filter((x) => x != null), est = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    const ds = [];
    for (let b = 0; b < B; b++) {
      let s = 0, c = 0;
      for (let g = 0; g < groups.length; g++) for (const i of groups[Math.floor(rnd() * groups.length)]) if (d[i] != null) { s += d[i]; c++; }
      ds.push(s / Math.max(1, c));
    }
    ds.sort((a, b) => a - b);
    out[k] = { diff: est, lo: ds[Math.floor(0.025 * B)], hi: ds[Math.floor(0.975 * B)], n: v.length };
  }
  return out;
}
function methodroundScore(pfs) {
  // tools/methodround.py --score: who x how x when and friends, paired against model S on the same fights
  const dir = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault/audit2/evalv_mr"; fs.mkdirSync(dir, { recursive: true });
  const sub = {}; for (const pf of pfs) sub[pf.id] = { cells: compactCells(pf) };
  const inp = path.join(dir, `${VERSION}_${SPLIT}_cells.json`), outp = path.join(dir, `${VERSION}_${SPLIT}_methodround.json`);
  fs.writeFileSync(inp, JSON.stringify(sub));
  try {
    execFileSync("python3", [path.join(ROOT, "tools/methodround.py"), "--score", inp, "--score-from", d0, "--score-until", d1,
      "--score-out", outp, "--backtest", path.join(VAULT_DIR, "backtest_vault.json")], { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { OMP_NUM_THREADS: "1" }) });
    return JSON.parse(fs.readFileSync(outp, "utf8"));
  } catch (e) { return { error: String(e.stderr || e.message).slice(-2000) }; }
}
function compactCells(pf) {
  // evalv cells: A KO r, A SUB r, B KO r, B SUB r, A DEC, B DEC, DRAW (methodround's compact order)
  return pf.cells.map((v) => +v.toFixed(6));
}
function r4(x) { return x == null || !isFinite(x) ? x : Math.round(x * 1e4) / 1e4; }
function r6(x) { return x == null || !isFinite(x) ? x : Math.round(x * 1e6) / 1e6; }
function roundObj(o) { if (Array.isArray(o)) return o.map(roundObj); if (o && typeof o === "object") { const q = {}; for (const k in o) q[k] = roundObj(o[k]); return q; } return typeof o === "number" ? r4(o) : o; }

(async function main() {
  const t0 = Date.now(), c0 = process.cpuUsage();
  const sims = await runAll();
  // v5.0.1 (v5 review): every worker must have run this version's own engine and params (a process that loaded another version's
  // params on the global object once ran a v5 engine on v4 params with every component silently off)
  const expectV = E0.VERSION + " | " + P0.version;
  if (WORKER_VERSIONS.size !== 1 || !WORKER_VERSIONS.has(expectV)) { console.error("evalv: workers ran " + [...WORKER_VERSIONS].join(", ") + ", expected " + expectV); process.exit(4); }
  if (!DEV) {
    const he = historyEntry(loadHistory());
    if (he && he.params_version && he.params_version !== P0.version) { console.error("evalv: params version " + P0.version + " differs from the history entry's " + he.params_version); process.exit(4); }
  }
  console.log("  engine / params (all workers): " + expectV);
  const errs = sims.filter((s) => s.err);
  if (errs.length) console.log(`  ${errs.length} fights failed, e.g. ${errs[0].id}: ${errs[0].err}`);
  const simById = new Map(sims.filter((s) => !s.err).map((s) => [s.id, s]));
  const fsOk = fights.filter((f) => simById.has(f.id));
  const base = baseDist(trainFights);
  const pfs = fsOk.map((f) => perFight(simById.get(f.id), f, base));
  const L = pfs.map((pf, i) => losses(pf, fsOk[i]));
  const keys = ["winLL", "brier", "acc", "bin7", "method"].concat(DEVK.map((k) => "dev_" + k), DEVK.map((k) => "mae_" + k), DEVK.map((k) => "devpm_" + k));
  const met = bootstrap(pfs, L, fsOk, keys);
  const br = baseRates(pfs, fsOk);
  // v5.0.1 (v5 review): base rates by calendar year (the Calibrate gate's per-year KD / KO checks, 2023 the pseudo-holdout on
  // train) and, on validation, by the dated glove-trial windows (research/model_eradrift.md; information only, never a rule input)
  const brByYear = {};
  for (const y of [...new Set(pfs.map((pf) => pf.date.slice(0, 4)))].sort()) {
    const ix = pfs.map((pf, i) => (pf.date.slice(0, 4) === y ? i : -1)).filter((i) => i >= 0);
    brByYear[y] = baseRates(ix.map((i) => pfs[i]), ix.map((i) => fsOk[i]));
  }
  let brByWindow = null;
  if (SPLIT === "val") {
    const W = { pre_trial: ["2024-01-01", "2024-06-01"], glove_trial: ["2024-06-01", "2024-11-16"], post_trial: ["2024-11-16", "2025-02-15"], old_gloves_2025: ["2025-02-15", "2026-01-01"] };
    brByWindow = {};
    for (const [k, [a, b]] of Object.entries(W)) {
      const ix = pfs.map((pf, i) => (pf.date >= a && pf.date < b ? i : -1)).filter((i) => i >= 0);
      if (ix.length) brByWindow[k] = Object.assign({ range: [a, b] }, baseRates(ix.map((i) => pfs[i]), ix.map((i) => fsOk[i])));
    }
  }
  // v8: per-stat PIT coverage (reported diagnostic)
  const pitCov = {};
  for (let k = 0; k < NPIT; k++) {
    let n = 0, i80 = 0, hi = 0, lo = 0;
    for (const f of fsOk) { const pt = simById.get(f.id).pit; if (!pt) continue; for (const v of [pt[k], pt[NPIT + k]]) { if (v == null) continue; n++; if (v > 0.9) hi++; else if (v < 0.1) lo++; else i80++; } }
    if (n) pitCov[PITK[k]] = { in80: r4(i80 / n), gtP90: r4(hi / n), ltP10: r4(lo / n), n };
  }
  const rtShare = sims.reduce((a, s) => a + (s.rtApplied || 0), 0) / Math.max(1, 2 * sims.length);
  const nWin = L.filter((l) => l.winLL != null).length, nOut = L.filter((l) => l.bin7 != null).length;
  const mlShare = sims.reduce((a, s) => a + (s.mlApplied || 0), 0) / Math.max(1, 2 * sims.length);
  console.log(`\n${VERSION} ${SPLIT}: ${pfs.length} fights (${nWin} decisive, ${nOut} with an outcome), ML applied ${(100 * mlShare).toFixed(1)}% of matchups`);
  const show = (k, d) => met[k] && console.log(`  ${k.padEnd(12)} ${met[k].est.toFixed(d || 4)} [${met[k].lo.toFixed(d || 4)}, ${met[k].hi.toFixed(d || 4)}]`);
  ["winLL", "brier", "acc", "ece", "calSlope", "bin7", "method"].forEach((k) => show(k));
  DEVK.forEach((k) => show("dev_" + k, 3));
  console.log(`  base rates (sim vs actual): finish ${(100 * br.finish.sim).toFixed(1)} vs ${(100 * br.finish.actual).toFixed(1)}, KO ${(100 * br.KO.sim).toFixed(1)} vs ${(100 * br.KO.actual).toFixed(1)}, ` +
    `SUB ${(100 * br.SUB.sim).toFixed(1)} vs ${(100 * br.SUB.actual).toFixed(1)}, KD/100 head ${br.kdPer100Head.sim.toFixed(3)} vs ${br.kdPer100Head.actual.toFixed(3)}, ` +
    `UD ${(100 * br.decision.sim.UD).toFixed(1)} vs ${(100 * br.decision.actual.UD).toFixed(1)}, SD ${(100 * br.decision.sim.SD).toFixed(1)} vs ${(100 * br.decision.actual.SD).toFixed(1)}, ` +
    `10-8 ${(100 * br.r108.sim).toFixed(2)} vs ${(100 * br.r108.actual).toFixed(2)}`);
  console.log(`  finish by round 3-rd sim ${br.finByRound3.sim.map((v) => (100 * v).toFixed(1)).join("/")} vs ${br.finByRound3.actual.map((v) => (100 * v).toFixed(1)).join("/")}; ` +
    `5-rd sim ${br.finByRound5.sim.map((v) => (100 * v).toFixed(1)).join("/")} vs ${br.finByRound5.actual.map((v) => (100 * v).toFixed(1)).join("/")}`);
  console.log("  PIT coverage (in80 / >P90 / <P10): " + Object.entries(pitCov).map(([k, v]) => `${k} ${v.in80.toFixed(3)}/${v.gtP90.toFixed(3)}/${v.ltP10.toFixed(3)}`).join(", ") +
    (rtShare ? `; retarget applied ${(100 * rtShare).toFixed(1)}% of matchups` : ""));
  let mr = null;
  if (!args["no-methodround"]) {
    mr = methodroundScore(pfs);
    if (mr && mr.metrics) console.log("  methodround: " + Object.entries(mr.metrics).map(([k, v]) => `${k} ${v.submitted.toFixed(4)} (S ${v.model_S.toFixed(4)}, d ${v.diff >= 0 ? "+" : ""}${v.diff.toFixed(4)} [${v.ci95[0].toFixed(4)}, ${v.ci95[1].toFixed(4)}])`).join("; "));
    else if (mr && mr.error) console.log("  methodround --score failed: " + mr.error.split("\n").slice(-3).join(" "));
  }
  let cmp = null;
  if (args.compare) {
    const other = path.join(OUTDIR, `${args.compare}_${SPLIT}.json`);
    if (fs.existsSync(other)) {
      const O = JSON.parse(fs.readFileSync(other, "utf8"));
      const om = new Map(O.fights.map((x) => [x.id, x.L]));
      const Lo = pfs.map((pf) => om.get(pf.id) || null);
      cmp = { against: args.compare, paired: pairedDiff(pfs, L, Lo, keys) };
      console.log(`  paired vs ${args.compare}: ` + ["winLL", "brier", "acc", "bin7", "method"].map((k) => `${k} ${cmp.paired[k].diff >= 0 ? "+" : ""}${cmp.paired[k].diff.toFixed(4)} [${cmp.paired[k].lo.toFixed(4)}, ${cmp.paired[k].hi.toFixed(4)}]`).join("; "));
    } else console.log(`  (no stored ${args.compare} ${SPLIT} results to compare with: ${other})`);
  }
  const cpu = process.cpuUsage(c0);
  const result = {
    meta: { tool: "tools/evalv.js", version: VERSION, split: SPLIT, range: [d0, d1], built: new Date().toISOString(), dev: DEV,
      engine_dir: path.relative(ROOT, ENGINE_DIR), engine_version: E0.VERSION, params_version: P0.version,
      engine_sha256: engineSha, params_sha256: paramsSha, mlrates_js_sha256: mlSha, ml: useML ? ("out-of-fold rates (data/derived/" + (+String(E0.VERSION).split(".")[0] >= 6 ? "mlrates_oof_fh.json, fold-honest stack weights" : "mlrates_oof.json") + ")") : "off",
      ml_applied_share: mlShare, sims_per_order: SIMS, seed: SEED, bootstrap: B, n_fights: pfs.length, n_decisive: nWin, n_outcome: nOut, failed: errs.length,
      wall_s: (Date.now() - t0) / 1000, main_cpu_s: (cpu.user + cpu.system) / 1e6,
      priors: "data/derived/mlcal_priors_asof.json (walk-forward 5-year windows)",
      step4: (function () {
        const c = (P0 && P0.components) || {};
        return { embed: !!c.embed, oppadj: !!c.oppadj, preufc: !!c.preufc, mlpathrec: path.relative(ROOT, MLP_FILE), mlpathrec_sha256: mlpSha,
          inputs: "embed.json snapshots + embed_blend_loyo.json coef_loyo (train) / embed_model.json recipe (2024-25); oppadj.json snapshots; preufc.json snapshots" };
      })(),
      sos: P0.components && P0.components.styles_sos && (P0.components.styles_sos === true || P0.components.styles_sos.sos !== false) &&
        ((P0.stylesSOS && P0.stylesSOS.sosSource) || "wf") === "wf"
        ? "styles_sos sos 'wf': data/derived/sos_wf.json pairs (corners swapped with the order); coefficients meta.coef_loyo[year] on train, meta.coef (fit 2019-2023) on 2024-2025"
        : "off",
      notes: "CIs: 2,000 event-cluster resamples (400 for ece and calSlope). ECE is biased upward under resampling (noise in 10 " +
        "bins), so its interval is a spread, not a CI around the point estimate. Base-rate 'actual' 10-8 share is implied from " +
        "card totals (19 x judged rounds - card sum; deductions count as 10-8s); the simulated share counts judges' 10-8s plus " +
        "3 x deduction points (engines with deductions, v4.0.1+). Stat-line deviance: Poisson deviance of each fighter's " +
        "actual fight total vs the simulated mean (unconditional on fight length), averaged over both fighters" },
    metrics: met, baseRates: br, baseRatesByYear: brByYear, baseRatesByWindow: brByWindow, methodround: mr, compare: cmp,
    pitCoverage: pitCov, retargetAppliedShare: rtShare,
    // v5.0.1 (v5 review): b7 and the cells at 6 decimals (4 rounded draw cells to 0 and the 7-bin score could not be reproduced
    // from the file), plus the per-fight simulated stats and shares the paired base-rate tests use (tools/evalv_decide.js)
    fights: pfs.map((pf, i) => ({ id: pf.id, date: pf.date, event: pf.event, rounds: pf.rounds, pA: r6(pf.pA), b7: pf.b7.map(r6), cells: pf.cells.map(r6),
      finR: pf.finR.map(r6), pKO: r6(pf.pKO), pSUB: r6(pf.pSUB), pDEC: r6(pf.pDEC), mins: r6(pf.mins),
      dec: pf.dec.map((v) => r6(v / pf.n)), decN108: r6(pf.decN108 / pf.n), decRounds: r6(pf.decRounds / pf.n), L: roundObj(L[i]),
      sig: [r4(pf.stats.A.sig_lnd), r4(pf.stats.B.sig_lnd)],
      st: Object.fromEntries(STATK.map((k) => [k, [r6(pf.stats.A[k]), r6(pf.stats.B[k])]])) }))
  };
  fs.mkdirSync(OUTDIR, { recursive: true });
  const outFile = path.join(OUTDIR, `${VERSION}_${SPLIT}.json`);
  const fightsOut = result.fights; result.fights = null;
  const res4 = roundObj(result); res4.fights = fightsOut; result.fights = fightsOut;
  fs.writeFileSync(outFile, JSON.stringify(res4));
  console.log(`wrote ${path.relative(ROOT, outFile)} (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
  if (DEV) return;

  // ---------------- version history
  const summary = { n_fights: pfs.length, n_decisive: nWin, sims_per_order: SIMS, metrics: roundObj(met), baseRates: roundObj(br), pitCoverage: pitCov,
    methodround: mr && mr.metrics ? roundObj(mr.metrics) : null, compare: cmp ? roundObj(cmp) : null, file: path.relative(ROOT, outFile) };
  const H = loadHistory();
  H.meta = { tool: "tools/evalv.js", rule: "validation numbers are computed once per version (tools/evalv.js --split val refuses a second look at the same files); " +
    "train numbers can be refreshed; a second validation look needs a new version entry and a note", splits: SPLITS };
  let e = historyEntry(H);
  if (!e) {
    e = { version: VERSION, date: new Date().toISOString().slice(0, 10), engine_version: E0.VERSION, params_version: P0.version,
      engine_sha256: engineSha, params_sha256: paramsSha, mlrates_js_sha256: mlSha, train: null, validation: null, blend: null, notes: [] };
    H.versions.push(e);
  } else if (e.engine_sha256 !== engineSha || e.params_sha256 !== paramsSha) {
    if (e.validation) { console.error("evalv: history entry has validation numbers for other files; not overwriting"); process.exit(3); }
    e.engine_sha256 = engineSha; e.params_sha256 = paramsSha; e.mlrates_js_sha256 = mlSha; e.engine_version = E0.VERSION; e.params_version = P0.version;
    e.notes.push(`${new Date().toISOString().slice(0, 16)}: frozen files changed before validation; train block refreshed`);
  }
  if (SPLIT === "train") { e.train = summary; }
  else {
    e.validation = summary;
    e.validated_at = new Date().toISOString();
    // blend test: refit the MoE stacker with this version's engine probabilities (train + validation fights)
    const trainFile = path.join(OUTDIR, `${VERSION}_train.json`);
    if (fs.existsSync(trainFile) && !args["no-blend"]) {
      const T = JSON.parse(fs.readFileSync(trainFile, "utf8"));
      const eng = { meta: { tool: "tools/evalv.js", version: VERSION, engine_sha256: engineSha, params_sha256: paramsSha, sims_per_orientation: SIMS }, fights: {} };
      for (const x of T.fights.concat(result.fights)) eng.fights[x.id] = { pA: x.pA, pB: r4(1 - x.pA) };
      const engFile = path.join(ROOT, "out", "evalv", `${VERSION}_engine_bt.json`);
      fs.writeFileSync(engFile, JSON.stringify(eng));
      try {
        const txt = execFileSync("python3", [path.join(ROOT, "tools/evalv_blend.py"), "--engine-bt", engFile, "--out", path.join(OUTDIR, `${VERSION}_blend.json`)],
          { env: Object.assign({}, process.env, { OMP_NUM_THREADS: "1" }) }).toString();
        console.log(txt);
        e.blend = JSON.parse(fs.readFileSync(path.join(OUTDIR, `${VERSION}_blend.json`), "utf8")).summary;
      } catch (err) { e.blend = { error: String(err.stderr || err.message).slice(-1500) }; }
    } else e.blend = { error: "no train run stored for this version (run --split train first) or --no-blend" };
  }
  if (args.note) e.notes.push(`${new Date().toISOString().slice(0, 16)} ${SPLIT}: ${args.note}`);
  fs.writeFileSync(HIST, JSON.stringify(H, null, 1));
  console.log(`updated ${path.relative(ROOT, HIST)}: ${VERSION} ${SPLIT}`);
})().catch((e) => { console.error(e); process.exit(1); });
