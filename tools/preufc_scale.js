#!/usr/bin/env node
/* preufc_scale.js: the hazard exponents params.preufc.scale for the engine's pre-UFC newcomer priors (engine v5 merge step 4,
   params.components.preufc; research/model_preufc.md "Recommendation for the engine" 3).

   The recipe's multipliers are ODDS multipliers on per-fight finish probabilities (KO win, submission win, KO loss); the engine
   applies them as M^scale on per-second / per-strike hazards (knockdown + ground-and-pound + standing TKO hazards for KO,
   submission attempt rates for SUB). This tool measures, on league-average pairs, how the simulated per-fight odds respond to
   a hazard multiplier x: OR(x) ~ x^gamma, so scale = 1 / gamma makes the simulated odds move by M. It fits nothing to outcomes:
   league-average profiles on the train-only priors (data/derived/priors_dev.json, fights before 2024-01-01), learned rates off,
   every other component at its params3.js default (durability in relative mode, as tests/test_engine3.js simAvg), common
   random numbers between the base run and each treated run.

     node tools/preufc_scale.js [sims per config, default 20000] [--write]   (writes data/derived/preufc_scale.json; --write also
                                                                          sets params.preufc.scale in src/params3.js) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const N = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 20000);
const WRITE = process.argv.includes("--write");
const PRI = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/priors_dev.json"), "utf8")).priors;
const DIVS = ["Bantamweight", "Lightweight", "Middleweight"];

function avgProfile(div, tag) {
  const P = PRI[div], S = {};
  for (const k of E.KEYS) S[k] = (P[k] || 0) * 400;   // 400 fight-minutes of league-average fighting (tests/test_engine3.js)
  return { name: tag + " " + div, division: div, S, age: 30, ko_losses: 0, pace: null, pace_w: null };
}
// per-fight outcome shares for A and B
function run(div, nR, preufc, expOver) {
  const params = { durability: { level: null }, components: { realism_sens: false, preufc: true }, preufc: { scale: { pow: 1, sub: 1, chin: 1 }, exp: expOver } };
  const m = E.matchup(avgProfile(div, "A"), avgProfile(div, "B"), { division: div, rounds: nR, title: false, params, priors: PRI, ml: false, preufc });
  const rng = E.makeRng(9173 + nR);
  const c = { aKO: 0, aSUB: 0, bKO: 0, bSUB: 0 };
  for (let i = 0; i < N; i++) {
    const s = E.simulate(m, rng, false);
    const dec = s.method === "UD" || s.method === "SD" || s.method === "MD" || s.method === "DRAW";
    if (dec || s.winner === "D") continue;
    const k = s.method === "SUB" ? "SUB" : "KO";
    c[(s.winner === "A" ? "a" : "b") + k]++;
  }
  for (const k in c) c[k] /= N;
  return { c, mult: m.preufc && m.preufc.mult };
}
const lo = (p) => Math.log(p / (1 - p));
// records that give one multiplier (the others neutralised through the exponents)
const REC_HI = { n: 10, ko_w: 8, sub_w: 6, ko_l: 5, n_ufc: 0 };
const REC_LO = { n: 10, ko_w: 1, sub_w: 0, ko_l: 0, n_ufc: 0 };
const out = { meta: { tool: "tools/preufc_scale.js", sims: N, divisions: DIVS, priors: "data/derived/priors_dev.json (fights before 2024-01-01)",
  note: "gamma = d log OR(per-fight odds) / d log(hazard multiplier); scale = 1 / gamma (mean over divisions, formats and both directions)" }, rows: [] };
const G = { pow: [], sub: [], chin: [] };
for (const div of DIVS) for (const nR of [3, 5]) {
  const base = run(div, nR, null, null).c;
  const X = E.params().preufc.exp;
  const cases = [
    ["pow", { pow: X.pow, sub: 0, chin: 0 }, "A", "aKO"],
    ["sub", { pow: 0, sub: X.sub, chin: 0 }, "A", "aSUB"],
    ["chin", { pow: 0, sub: 0, chin: X.chin }, "A", "bKO"]   // A's chin multiplier moves B's KO-win odds
  ];
  for (const [kn, ex, side, key] of cases) for (const rec of [REC_HI, REC_LO]) {
    const pre = side === "A" ? { A: rec, B: null } : { A: null, B: rec };
    const r = run(div, nR, pre, ex), M = r.mult[0][kn];
    const g = (lo(r.c[key]) - lo(base[key])) / Math.log(M);
    G[kn].push(g);
    out.rows.push({ div, rounds: nR, knob: kn, M: +M.toFixed(4), p0: +base[key].toFixed(4), p1: +r.c[key].toFixed(4), gamma: +g.toFixed(4) });
    console.log(`${div} ${nR} rds ${kn}: M ${M.toFixed(3)}  p ${base[key].toFixed(4)} -> ${r.c[key].toFixed(4)}  gamma ${g.toFixed(3)}`);
  }
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
out.gamma = { pow: mean(G.pow), sub: mean(G.sub), chin: mean(G.chin) };
out.scale = { pow: +(1 / out.gamma.pow).toFixed(3), sub: +(1 / out.gamma.sub).toFixed(3), chin: +(1 / out.gamma.chin).toFixed(3) };
console.log("gamma", JSON.stringify(out.gamma), "-> scale", JSON.stringify(out.scale));
fs.writeFileSync(path.join(ROOT, "data/derived/preufc_scale.json"), JSON.stringify(out, null, 1));
if (WRITE) {
  const f = path.join(ROOT, "src/params3.js"), src = fs.readFileSync(f, "utf8");
  const re = /(\n    preufc: \{[\s\S]*?\n      scale: )\{[^}]*\}/;
  if (!re.test(src)) throw new Error("params3.js preufc.scale not found");
  fs.writeFileSync(f, src.replace(re, `$1{ pow: ${out.scale.pow}, sub: ${out.scale.sub}, chin: ${out.scale.chin} }`));
  console.log("wrote params.preufc.scale to src/params3.js");
}
