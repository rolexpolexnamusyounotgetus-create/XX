#!/usr/bin/env node
/* v9_gate.js: the TRAIN harness of engine v9's gate (docs/V6_V10_PLAN.md cycle 4 "Train-only acceptance test": rolling origin,
   levels always from earlier fights; 2019-2023 simulated, the binding checks on 2021-2023). Scored by tools/v9_gate.py.

   TRAIN 2019-01-01..2023-12-31 only (backtest_dev.json; nothing dated 2024 or later is simulated, 2026 is never read).
   Two passes, one engine directory (default src/), arms = params.components overrides (opts.params):
     pass 1  cmp4   every v9 flag off = engine 4.0.0 (tests/test_v9.js: bit for bit) on the honest inputs: the comparator, and
                    the reference engine of the level tracker
     levels  tools/v9_levels.js computeLevels(): per fight, factors from the cmp4 realised rates of fights dated strictly
                    before it (phi from data/derived/v9/levels_phi.json); r108 from the eradrift verified 10-8 tracker
     pass 2  all    levels + judgeWF + format (the candidate); -levels / -judgeWF / -format: leave-one-out (descriptive)
   (--arms picks a subset; --arm name='{json params override}' adds any arm, e.g. a format grid point.)
   Inputs (evalv's, leak-free): as-of priors mlcal_priors_asof.json[year]; fold-honest out-of-fold learned rates
   mlrates_oof_fh.json; per-year judging weights params.judgeWF.byYear (each fit on cards before Jan 1 of its year).
   Common random numbers: simulated fight i of fight f in order o uses makeRng(mix(mix(mix(hash(id), o), seed), i + 1)) in every
   arm. Per arm and fight: the joint outcome cells (evalv order), decision split, 10-8 judge-rounds and decision rounds, between-
   round (doctor / corner) stoppages by round, per-fighter means of 10 stats, simulated minutes, randomized PIT per stat, and the
   level factors / 10-8 threshold used.

     nice -n 5 node tools/v9_gate.js --out <file>.json [--sims 300] [--workers 3] [--seed 9] [--arms cmp4,all,...]
         [--arm name='{"components":{...}}'] [--years 2019,2020] [--every 2] [--phi data/derived/v9/levels_phi.json]
         [--binding --protocol data/derived/v9/gate_protocol.json]
   --binding: refuses unless the protocol file is committed at HEAD and the command line matches it, and refuses an existing output. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const ROOT = path.resolve(__dirname, "..");
const TRAIN = ["2019-01-01", "2024-01-01"];
const STATS = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_lnd", "td_att", "ctrl", "sub_att"];
const NS = STATS.length;
const ALLON = { levels: true, judgeWF: true, format: true };
const PRESET = {
  cmp4: { components: { levels: false, judgeWF: false, format: false } },
  all: { components: Object.assign({}, ALLON) },
  "-levels": { components: Object.assign({}, ALLON, { levels: false }) },
  "-judgeWF": { components: Object.assign({}, ALLON, { judgeWF: false }) },
  "-format": { components: Object.assign({}, ALLON, { format: false }) }
};
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
const readJSON = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function trainFights(years, every) {
  const bt = readJSON("data/derived/backtest_dev.json");
  let out = bt.fights.filter((f) => f.date >= TRAIN[0] && f.date < TRAIN[1] && f.date < "2026-01-01");
  if (years) out = out.filter((f) => years.includes(+f.date.slice(0, 4)));
  if (every > 1) out = out.filter((_, i) => i % every === 0);
  for (const f of out) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
  return out;
}
function outcome(f) {
  const r = f.result || {};
  const cls = { KO: "KO", DOC: "KO", SUB: "SUB", UD: "DEC", SD: "DEC", MD: "DEC", DRAW: "DRAW" }[r.method] || null;
  if (!cls || (cls !== "DRAW" && r.winner !== "A" && r.winner !== "B")) return null;
  return { winner: cls === "DRAW" ? "D" : r.winner, cls, round: r.round || 1, method: r.method };
}

// ================================================================== worker
if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(W.engineDir, "engine3.js"));
  const fights = trainFights(W.years, W.every);
  const byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const OOF = readJSON("data/derived/mlrates_oof_fh.json"), names = OOF.meta.targets;
  const rates = (a) => { const o = {}; names.forEach((n, i) => { o[n] = a[i]; }); return o; };
  parentPort.on("message", (msg) => {
    if (msg.cmd !== "run") return;
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id), R = f.rounds === 5 ? 5 : 3, NCELL = 4 * R + 3;
      const rec = { id, err: null, arms: {} };
      try {
        const ent = OOF.fights[f.id];
        if (!ent || !ent.A || !ent.B) throw new Error("no out-of-fold learned rates for " + f.id);
        const lvl = msg.levels ? msg.levels[f.id] : null;
        for (const arm of msg.arms) {
          const params = W.armParams[arm];
          const P = E.resolveParams(params);
          const C = P.components || {};
          if (C.levels && !lvl) throw new Error("levels on but no level for " + f.id);
          const a = { cells: new Float64Array(NCELL), dec: [0, 0, 0], mins: 0, n: 0, st: new Float64Array(2 * NS), n108: 0, decRounds: 0,
            stop: new Float64Array(R), stopKind: { DOC: 0, CORNER: 0 } };
          const vals = [];
          for (let k = 0; k < 2 * NS; k++) vals.push([]);
          let used = null;
          for (let o = 0; o < 2; o++) {
            const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A;
            const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)],
              ml: { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } }, params };
            if (lvl) opts.level = lvl;              // league-level factors: corner-free, the same in both orders
            const m = E.matchup(A, B, opts);
            if (!m.mlApplied) throw new Error("learned rates not applied for " + f.id);
            if (C.levels && !(m.level && m.level.applied)) throw new Error("levels not applied for " + f.id);
            if (!C.levels && m.level) throw new Error("levels ran with the flag off for " + f.id);
            if (C.judgeWF && !(m.judgeWF && m.judgeWF.src === "byYear")) throw new Error("judgeWF weights not applied for " + f.id);
            if (C.judgeWF && lvl && lvl.r108 != null && P.judgeWF && P.judgeWF.r108 && !(m.judgeWF.t108 > 0)) throw new Error("judgeWF 10-8 threshold not applied for " + f.id);
            if (!C.judgeWF && m.judgeWF) throw new Error("judgeWF ran with the flag off for " + f.id);
            if (C.format && !m.format) throw new Error("format not applied for " + f.id);
            if (o === 0) used = { level: m.level ? m.level.g : null, t108: m.judgeWF ? m.judgeWF.t108 : null, jwYear: m.judgeWF ? m.judgeWF.year : null, format: m.format || null };
            const h0 = mix(mix(hash32(f.id), o), W.seed);
            for (let i = 0; i < W.sims; i++) {
              const s = E.simulate(m, E.makeRng(mix(h0, i + 1)), false);
              const wD = s.winner === "D" ? "D" : ((s.winner === "A") === (o === 0) ? "A" : "B");
              const meth = s.method, isDec = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW";
              const r = Math.max(1, Math.min(R, s.round));
              if (wD === "D") a.cells[4 * R + 2]++;
              else if (isDec) { a.cells[wD === "A" ? 4 * R : 4 * R + 1]++; a.dec[meth === "UD" ? 0 : (meth === "SD" ? 1 : 2)]++; }
              else { const sub = meth === "SUB"; a.cells[(wD === "A" ? (sub ? R : 0) : (sub ? 3 * R : 2 * R)) + r - 1]++; }
              if (isDec) { a.decRounds += R; a.n108 += (s.n108 || 0) + 3 * (s.nDed || 0); }
              if (meth === "DOC" || meth === "CORNER") { a.stop[r - 1]++; a.stopKind[meth]++; }
              a.mins += isDec ? R * 5 : (s.round - 1) * 5 + s.t / 60;
              const TA = o === 0 ? s.totals.A : s.totals.B, TB = o === 0 ? s.totals.B : s.totals.A;
              for (let k = 0; k < NS; k++) {
                let va = TA[STATS[k]], vb = TB[STATS[k]];
                if (STATS[k] === "ctrl") { va = Math.round(va); vb = Math.round(vb); }
                a.st[k] += va; a.st[NS + k] += vb; vals[k].push(va); vals[NS + k].push(vb);
              }
              a.n++;
            }
          }
          const pit = new Array(2 * NS).fill(null);
          if (f.actual && f.actual.A && f.actual.B) {
            for (let sd = 0; sd < 2; sd++) for (let k = 0; k < NS; k++) {
              const y = f.actual[sd ? "B" : "A"][STATS[k]];
              if (y == null) continue;
              const v = vals[sd * NS + k]; let lt = 0, eq = 0;
              for (const x of v) { if (x < y) lt++; else if (x === y) eq++; }
              const u = hash32(f.id + "|" + sd + "|" + STATS[k]) / 4294967296;
              pit[sd * NS + k] = (lt + u * eq) / v.length;
            }
          }
          rec.arms[arm] = { cells: Array.from(a.cells), dec: a.dec, mins: a.mins / a.n, n: a.n, st: Array.from(a.st).map((x) => x / a.n), pit,
            n108: a.n108 / a.n, decRounds: a.decRounds / a.n, stop: Array.from(a.stop).map((x) => x / a.n), stopKind: a.stopKind, used };
        }
      } catch (e) { rec.err = String(e && e.stack || e); }
      out.push(rec);
    }
    parentPort.postMessage({ cmd: "done", out, version: E.VERSION, params: E.params().version });
  });
  return;
}

// ================================================================== main
const args = { arm: [] };
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith("--")) { const k = a[i].slice(2), v = a[i + 1]; if (v == null || v.startsWith("--")) args[k] = true; else { if (k === "arm") args.arm.push(v); else args[k] = v; i++; } } }
if (!args.out) { console.error("v9_gate: --out required"); process.exit(2); }
const OUT = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
const ENGINE_DIR = path.resolve(ROOT, args["engine-dir"] || "src");
const SIMS = +(args.sims || 300), WORKERS = Math.max(1, Math.min(3, +(args.workers || 3))), SEED = +(args.seed || 9);
const YEARS = args.years ? String(args.years).split(",").map(Number) : null, EVERY = +(args.every || 1);
const PHI = args.phi || "data/derived/v9/levels_phi.json";
const armNames = args.arms ? String(args.arms).split(",") : (args.arm.length ? [] : Object.keys(PRESET));
const armParams = {};
for (const n of armNames) { if (!PRESET[n]) { console.error("v9_gate: unknown arm " + n); process.exit(2); } armParams[n] = PRESET[n]; }
for (const s of args.arm) { const i = s.indexOf("="); const n = s.slice(0, i); armParams[n] = JSON.parse(s.slice(i + 1)); armNames.push(n); }
// the comparator always runs first (it is the level tracker's reference); --skip-ref (development runs only, never with
// --binding) drops it when no arm turns components.levels on
const SKIPREF = !!args["skip-ref"] && !args.binding && !Object.keys(armParams).some((n) => armParams[n].components && armParams[n].components.levels);
if (!armNames.includes("cmp4") && !SKIPREF) { armNames.unshift("cmp4"); armParams.cmp4 = PRESET.cmp4; }
const cmdline = process.argv.slice(2).join(" ");
const files = { engine: path.join(ENGINE_DIR, "engine3.js"), params: path.join(ENGINE_DIR, "params3.js"), mlrates: path.join(ENGINE_DIR, "ml", "mlrates.js"),
  levels_js: path.join(ROOT, "tools/v9_levels.js"), phi: path.resolve(ROOT, PHI), eradrift: path.join(ROOT, "data/derived/eradrift.json"),
  judge_wf: path.join(ROOT, "data/derived/v9/judge_wf.json"), oof_fh: path.join(ROOT, "data/derived/mlrates_oof_fh.json"),
  priors: path.join(ROOT, "data/derived/mlcal_priors_asof.json"), backtest: path.join(ROOT, "data/derived/backtest_dev.json"), harness: __filename };
const hashes = {}; for (const [k, p] of Object.entries(files)) hashes[k] = fs.existsSync(p) ? sha256(p) : null;
let gitHead = null;
try { gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(); } catch (e) { gitHead = null; }
if (args.binding) {
  if (!args.protocol) { console.error("v9_gate: --binding needs --protocol"); process.exit(2); }
  const pf = path.resolve(ROOT, args.protocol), rel = path.relative(ROOT, pf);
  if (fs.existsSync(OUT)) { console.error("v9_gate: binding output exists (" + args.out + "); the binding gate runs once"); process.exit(3); }
  let committed = null;
  try { committed = execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT }).toString(); } catch (e) { committed = null; }
  if (committed == null || committed !== fs.readFileSync(pf, "utf8")) { console.error("v9_gate: the protocol file is not committed at HEAD (or differs)"); process.exit(3); }
  const Pr = JSON.parse(committed);
  const want = Pr.commands && Pr.commands.harness;
  if (!want || want.replace(/^nice -n 5 node tools\/v9_gate\.js /, "") !== cmdline) { console.error("v9_gate: command line differs from the protocol's harness command"); process.exit(3); }
  for (const [k, h] of Object.entries(Pr.hashes || {})) if (hashes[k] !== h) { console.error("v9_gate: " + k + " hash differs from the protocol (" + hashes[k] + " vs " + h + ")"); process.exit(3); }
}
const fights = trainFights(YEARS, EVERY);
const LV = require(path.join(ROOT, "tools/v9_levels.js"));
const phi = fs.existsSync(path.resolve(ROOT, PHI)) ? readJSON(PHI).phi : null;
const pass2 = armNames.filter((n) => n !== "cmp4");
console.log(`v9_gate: ${fights.length} train fights x 2 orders x ${SIMS} sims, arms ${armNames.join(", ")}, ${WORKERS} workers, seed ${SEED}${args.binding ? ", BINDING" : ""}${phi ? "" : " (no phi file: phi 1)"}`);
const VERS = new Set();
function runPass(arms, levels) {
  return new Promise((resolve, reject) => {
    const ids = fights.map((f) => f.id), chunks = [];
    for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
    const res = []; let next = 0, live = 0, done = 0; const t0 = Date.now();
    function feed(w) {
      if (next >= chunks.length) { w.terminate(); live--; if (live === 0) resolve(res); return; }
      const ch = chunks[next++], lv = levels ? {} : null;
      if (levels) for (const id of ch) lv[id] = levels[id];
      w.postMessage({ cmd: "run", ids: ch, arms, levels: lv });
    }
    for (let k = 0; k < Math.min(WORKERS, chunks.length); k++) {
      const w = new Worker(__filename, { workerData: { engineDir: ENGINE_DIR, sims: SIMS, seed: SEED, armParams, years: YEARS, every: EVERY } });
      live++;
      w.on("message", (m) => { if (m.cmd === "done") { VERS.add(m.version + " | " + m.params); res.push(...m.out); done += m.out.length; if (done % 300 < m.out.length) console.log(`  [${arms.join(",")}] ${done}/${ids.length} fights, ${((Date.now() - t0) / 1000).toFixed(0)} s`); feed(w); } });
      w.on("error", reject);
      feed(w);
    }
  });
}
(async function () {
  const t0 = Date.now();
  const r1 = SKIPREF ? fights.map((f) => ({ id: f.id, err: null, arms: {} })) : await runPass(["cmp4"], null);
  const byId = new Map(r1.map((r) => [r.id, r]));
  // levels from the comparator's realised rates of earlier fights (strictly earlier dates), + the tracked 10-8 level
  const ref = new Map();
  for (const r of r1) if (!r.err && r.arms.cmp4) ref.set(r.id, { st: r.arms.cmp4.st, mins: r.arms.cmp4.mins });
  const L = LV.computeLevels(fights, ref, { phi });
  const levels = {};
  for (const f of fights) levels[f.id] = Object.assign({}, L.byId[f.id], { r108: LV.r108At(f.date) });
  let r2 = [];
  if (pass2.length) r2 = await runPass(pass2, levels);
  for (const r of r2) {
    const b = byId.get(r.id);
    if (!b) { byId.set(r.id, r); continue; }
    if (r.err && !b.err) b.err = r.err;
    Object.assign(b.arms, r.arms);
  }
  const res = [...byId.values()];
  const errs = res.filter((r) => r.err);
  if (errs.length) console.log(`  ${errs.length} fights FAILED, e.g. ${errs[0].id}: ${errs[0].err.split("\n")[0]}`);
  const outF = fights.filter((f) => byId.has(f.id)).map((f) => {
    const r = byId.get(f.id), y = outcome(f);
    return { id: f.id, date: f.date, event: f.event, rounds: f.rounds === 5 ? 5 : 3, title: !!f.title, outcome: y, actual: f.actual || null,
      result: { method: f.result && f.result.method, round: f.result && f.result.round, time_s: f.result && f.result.time_s, cards: f.result && f.result.cards },
      level: levels[f.id], err: r.err, arms: r.arms };
  });
  const O = { meta: { tool: "tools/v9_gate.js", built: new Date().toISOString(), cmdline, binding: !!args.binding, protocol: args.protocol || null, git_head: gitHead,
    engine_dir: path.relative(ROOT, ENGINE_DIR), engine_params: [...VERS], sims_per_order: SIMS, seed: SEED, arms: armNames, arm_params: armParams, stats: STATS,
    phi, level_cfg: L.cfg, level_trace: L.trace, r108_ref: LV.r108Ref(),
    n_fights: outF.length, failed_fights: errs.length, wall_s: (Date.now() - t0) / 1000, hashes,
    window: "TRAIN 2019-01-01..2023-12-31 (backtest_dev.json); nothing dated 2024 or later" }, fights: outF };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(O));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${outF.length} fights, ${errs.length} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s); engine/params ${[...VERS].join(", ")}`);
})().catch((e) => { console.error(e); process.exit(1); });
