#!/usr/bin/env node
/* v8_gate.js: the TRAIN harness of engine v8's gate (docs/V6_V10_PLAN.md cycle 3 "Train-only acceptance test": 2019-2023,
   1,999 fights, both corner orders, common random numbers, out-of-fold learned rates and embedding snapshots, leave-one-out
   per sub-part). Scored by tools/v8_gate.py (rules, 20,000 event-cluster resamples, Monte Carlo SE, normal bound).

   TRAIN 2019-01-01..2023-12-31 only (backtest_dev.json; nothing dated 2024 or later is simulated, 2026 is never read).
   Arms = one engine directory (default src/), different params.components (opts.params overrides):
     cmp4        every v8 flag off = engine 4.0.0 (tests/test_v8.js: bit for bit) on the SAME honest inputs: the comparator
     all         embed + retarget + tdIntent + ctrlSpread
     -embed, -retarget, -tdIntent, -ctrlSpread   all minus one sub-part (leave-one-out)
   (--arms picks a subset; --arm name='{json params override}' adds any arm, e.g. the spread-fit grid.)
   Inputs (evalv's, leak-free): as-of priors mlcal_priors_asof.json[year]; fold-honest out-of-fold learned rates
   mlrates_oof_fh.json (engine major >= 6, as tools/evalv.js); embedding etas from walk-forward snapshots with fold-honest blend
   coefficients (tools/mlpathrec.js, embed_blend_fh.json coef_fh[year], 2019 = identity); retarget targets
   data/derived/v8/statlines_targets.json (statdist engineTargets from forward-chained fold tables; 2019 fights: none, so the
   retarget is off for them). Every arm asserts its inputs were applied.
   Common random numbers: simulated fight i of fight f in order o uses makeRng(mix(mix(mix(hash(id), o), seed), i + 1)) in every
   arm; the retarget pilot uses the engine's fixed pilot seeds; the spread draws use an auxiliary generator seeded by the fight's
   form draws (main stream untouched).
   Per arm and fight: the joint outcome cells (evalv order), decision split, per-fighter mean of 10 stats (sig landed / attempted,
   head / body / leg landed, KD, TD landed / attempted, control, sub attempts: every stat backtest_dev records), simulated
   minutes, and each fighter's randomized PIT of the real value in the simulated distribution (both orders pooled; u from a
   hash of fight, side and stat, the same in every arm; control compared in whole seconds).

     nice -n 5 node tools/v8_gate.js --out data/derived/v8/<file>.json [--sims 300] [--workers 3] [--seed 8] [--arms cmp4,all,...]
         [--arm name='{"components":{...},"spread":{...}}'] [--years 2021,2022] [--every 2]
         [--binding --protocol data/derived/v8/gate_protocol.json]
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
const ALLON = { embed: true, retarget: true, tdIntent: true, ctrlSpread: true };
const PRESET = {
  cmp4: { components: { embed: false, retarget: false, tdIntent: false, ctrlSpread: false } },
  all: { components: Object.assign({}, ALLON) },
  "-embed": { components: Object.assign({}, ALLON, { embed: false }) },
  "-retarget": { components: Object.assign({}, ALLON, { retarget: false }) },
  "-tdIntent": { components: Object.assign({}, ALLON, { tdIntent: false }) },
  "-ctrlSpread": { components: Object.assign({}, ALLON, { ctrlSpread: false }) }
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
  const TG = readJSON("data/derived/v8/statlines_targets.json").fights;
  const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
  if (!XR.foldHonest) throw new Error("v8_gate: mlpathrec is not fold-honest for engine " + E.VERSION);
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
        const tg = TG[f.id];
        if (!tg) throw new Error("no statlines targets entry for " + f.id);
        for (const arm of W.arms) {
          const params = W.armParams[arm];
          const P = E.resolveParams(params);
          const a = { cells: new Float64Array(NCELL), dec: [0, 0, 0], mins: 0, n: 0, st: new Float64Array(2 * NS), rt: 0, emb: 0 };
          const vals = [];
          for (let k = 0; k < 2 * NS; k++) vals.push([]);
          for (let o = 0; o < 2; o++) {
            const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A;
            const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)],
              ml: { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } }, params };
            if (tg.fold) opts.statTargets = o === 0 ? { A: tg.A, B: tg.B } : { A: tg.B, B: tg.A };
            XR.apply(opts, f, o === 1, params);
            const m = E.matchup(A, B, opts);
            XR.assertApplied(m, f.id, params);
            if (!m.mlApplied) throw new Error("learned rates not applied for " + f.id);
            if (P.components && P.components.embed) { if (!(m.embed && m.embed.src === "opts")) throw new Error("embed not applied for " + f.id); a.emb++; }
            if (P.components && P.components.retarget) {
              if (tg.fold && !(m.retarget && m.retarget.applied)) throw new Error("retarget not applied for " + f.id);
              if (!tg.fold && m.retarget && m.retarget.applied) throw new Error("retarget applied without a leak-free table for " + f.id);
              if (m.retarget && m.retarget.applied) a.rt++;
            } else if (m.retarget) throw new Error("retarget ran with the flag off for " + f.id);
            const h0 = mix(mix(hash32(f.id), o), W.seed);
            for (let i = 0; i < W.sims; i++) {
              const s = E.simulate(m, E.makeRng(mix(h0, i + 1)), false);
              const wD = s.winner === "D" ? "D" : ((s.winner === "A") === (o === 0) ? "A" : "B");
              const meth = s.method, isDec = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW";
              const r = Math.max(1, Math.min(R, s.round));
              if (wD === "D") a.cells[4 * R + 2]++;
              else if (isDec) { a.cells[wD === "A" ? 4 * R : 4 * R + 1]++; a.dec[meth === "UD" ? 0 : (meth === "SD" ? 1 : 2)]++; }
              else { const sub = meth === "SUB"; a.cells[(wD === "A" ? (sub ? R : 0) : (sub ? 3 * R : 2 * R)) + r - 1]++; }
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
          // randomized PIT of the real value (u: hash of fight, side, stat; the same in every arm)
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
          rec.arms[arm] = { cells: Array.from(a.cells), dec: a.dec, mins: a.mins / a.n, n: a.n, st: Array.from(a.st).map((x) => x / a.n), pit, rt: a.rt, emb: a.emb };
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
if (!args.out) { console.error("v8_gate: --out required"); process.exit(2); }
const OUT = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
const ENGINE_DIR = path.resolve(ROOT, args["engine-dir"] || "src");
const SIMS = +(args.sims || 300), WORKERS = Math.max(1, Math.min(3, +(args.workers || 3))), SEED = +(args.seed || 8);
const YEARS = args.years ? String(args.years).split(",").map(Number) : null, EVERY = +(args.every || 1);
const armNames = args.arms ? String(args.arms).split(",") : (args.arm.length ? [] : Object.keys(PRESET));
const armParams = {};
for (const n of armNames) { if (!PRESET[n]) { console.error("v8_gate: unknown arm " + n); process.exit(2); } armParams[n] = PRESET[n]; }
for (const s of args.arm) { const i = s.indexOf("="); const n = s.slice(0, i); armParams[n] = JSON.parse(s.slice(i + 1)); armNames.push(n); }
const cmdline = process.argv.slice(2).join(" ");
const files = { engine: path.join(ENGINE_DIR, "engine3.js"), params: path.join(ENGINE_DIR, "params3.js"), mlrates: path.join(ENGINE_DIR, "ml", "mlrates.js"),
  embed_js: path.join(ENGINE_DIR, "ml", "embed.js"), mlpathrec: path.join(ROOT, "tools/mlpathrec.js"), targets: path.join(ROOT, "data/derived/v8/statlines_targets.json"),
  oof_fh: path.join(ROOT, "data/derived/mlrates_oof_fh.json"), embed_blend_fh: path.join(ROOT, "data/derived/embed_blend_fh.json"),
  embed_json: path.join(ROOT, "data/derived/embed.json"), priors: path.join(ROOT, "data/derived/mlcal_priors_asof.json"),
  backtest: path.join(ROOT, "data/derived/backtest_dev.json"), harness: __filename };
const hashes = {}; for (const [k, p] of Object.entries(files)) hashes[k] = fs.existsSync(p) ? sha256(p) : null;
let gitHead = null;
try { gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(); } catch (e) { gitHead = null; }
if (args.binding) {
  if (!args.protocol) { console.error("v8_gate: --binding needs --protocol"); process.exit(2); }
  const pf = path.resolve(ROOT, args.protocol), rel = path.relative(ROOT, pf);
  if (fs.existsSync(OUT)) { console.error("v8_gate: binding output exists (" + args.out + "); the binding gate runs once"); process.exit(3); }
  let committed = null;
  try { committed = execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT }).toString(); } catch (e) { committed = null; }
  if (committed == null || committed !== fs.readFileSync(pf, "utf8")) { console.error("v8_gate: the protocol file is not committed at HEAD (or differs)"); process.exit(3); }
  const P = JSON.parse(committed);
  const want = P.commands && P.commands.harness;
  if (!want || want.replace(/^nice -n 5 node tools\/v8_gate\.js /, "") !== cmdline) { console.error("v8_gate: command line differs from the protocol's harness command"); process.exit(3); }
  for (const [k, h] of Object.entries(P.hashes || {})) if (hashes[k] !== h) { console.error("v8_gate: " + k + " hash differs from the protocol (" + hashes[k] + " vs " + h + ")"); process.exit(3); }
}
const fights = trainFights(YEARS, EVERY);
console.log(`v8_gate: ${fights.length} train fights x 2 orders x ${SIMS} sims, arms ${armNames.join(", ")}, ${WORKERS} workers, seed ${SEED}${args.binding ? ", BINDING" : ""}`);
const VERS = new Set();
function runAll() {
  return new Promise((resolve, reject) => {
    const ids = fights.map((f) => f.id), chunks = [];
    for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
    const res = []; let next = 0, live = 0, done = 0; const t0 = Date.now();
    function feed(w) { if (next >= chunks.length) { w.terminate(); live--; if (live === 0) resolve(res); return; } w.postMessage({ cmd: "run", ids: chunks[next++] }); }
    for (let k = 0; k < Math.min(WORKERS, chunks.length); k++) {
      const w = new Worker(__filename, { workerData: { engineDir: ENGINE_DIR, sims: SIMS, seed: SEED, arms: armNames, armParams, years: YEARS, every: EVERY } });
      live++;
      w.on("message", (m) => { if (m.cmd === "done") { VERS.add(m.version + " | " + m.params); res.push(...m.out); done += m.out.length; if (done % 200 < m.out.length) console.log(`  ${done}/${ids.length} fights, ${((Date.now() - t0) / 1000).toFixed(0)} s`); feed(w); } });
      w.on("error", reject);
      feed(w);
    }
  });
}
(async function () {
  const t0 = Date.now();
  const res = await runAll();
  const errs = res.filter((r) => r.err);
  if (errs.length) console.log(`  ${errs.length} fights FAILED, e.g. ${errs[0].id}: ${errs[0].err.split("\n")[0]}`);
  const byId = new Map(res.map((r) => [r.id, r]));
  const outF = fights.filter((f) => byId.has(f.id)).map((f) => {
    const r = byId.get(f.id), y = outcome(f);
    return { id: f.id, date: f.date, event: f.event, rounds: f.rounds === 5 ? 5 : 3, outcome: y, actual: f.actual || null, result: { method: f.result && f.result.method, cards: f.result && f.result.cards }, err: r.err, arms: r.arms };
  });
  const O = { meta: { tool: "tools/v8_gate.js", built: new Date().toISOString(), cmdline, binding: !!args.binding, protocol: args.protocol || null, git_head: gitHead,
    engine_dir: path.relative(ROOT, ENGINE_DIR), engine_params: [...VERS], sims_per_order: SIMS, seed: SEED, arms: armNames, arm_params: armParams, stats: STATS,
    n_fights: outF.length, failed_fights: errs.length, wall_s: (Date.now() - t0) / 1000, hashes,
    window: "TRAIN 2019-01-01..2023-12-31 (backtest_dev.json); nothing dated 2024 or later" }, fights: outF };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(O));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${outF.length} fights, ${errs.length} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s); engine/params ${[...VERS].join(", ")}`);
})().catch((e) => { console.error(e); process.exit(1); });
