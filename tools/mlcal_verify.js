#!/usr/bin/env node
/* mlcal_verify.js: independent re-simulation for the mlcal review (adversarial check of tools/mlcal.js).

   Written separately from tools/mlcal.js (no shared code): its own fight filter, outcome coding, corner
   handling, seeding and accumulation. For each parameter set it simulates every fight of a split in BOTH
   corner orders with its own seeds and writes the per-fight 7-bin counts in the data's orientation. The
   metrics (and the paired bootstrap against the baseline) are computed by tools/mlcal_verify.py.

     node tools/mlcal_verify.js --engine <dir/engine3.js> --params <params.js> [--hook <hook.js> --hookvals '{"w_acc":0.7}']
                                [--split val|train] [--sims 80] [--seed 777] --out <file.json>

   Hidden-data protocol: dates >= 2026-01-01 are skipped before anything else is read from the entry. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

const E = require(abs(a.engine));
const params = JSON.parse(JSON.stringify(require(abs(a.params))));
const hook = a.hook ? require(abs(a.hook)) : null;
const hookvals = a.hookvals ? JSON.parse(a.hookvals) : {};
const sims = +(a.sims || 80), seed = +(a.seed || 777);
const range = a.split === "train" ? ["2019-01-01", "2024-01-01"] : ["2024-01-01", "2026-01-01"];
const bt = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/backtest_dev.json"), "utf8"));
const PA = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlcal_priors_asof.json"), "utf8"));
const keys = bt.meta.keys;

// FNV-1a string hash, xorshift-multiply mixer: deliberately different from mlcal.js's seed scheme
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mixer(x) { x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; }

function outcome(r) {          // 0 A KO/TKO/DOC, 1 A SUB, 2 A DEC, 3 draw, 4 B DEC, 5 B SUB, 6 B KO/TKO/DOC; null = drop
  if (r.winner === "D") return 3;
  if (r.winner !== "A" && r.winner !== "B") return null;
  let k;
  if (r.method === "KO" || r.method === "TKO" || r.method === "DOC") k = 0;
  else if (r.method === "SUB") k = 1;
  else if (r.method === "UD" || r.method === "SD" || r.method === "MD") k = 2;
  else return null;               // DQ and anything unknown
  return r.winner === "A" ? k : 6 - k;
}

const out = [];
let skipped2026 = 0;
const t0 = process.cpuUsage();
for (const f of bt.fights) {
  if (f.date >= "2026-01-01") { skipped2026++; continue; }
  if (f.date < range[0] || f.date >= range[1]) continue;
  const y = outcome(f.result);
  if (y === null) continue;
  const pri = PA[f.date.slice(0, 4)];
  let div = f.division;
  if (!pri[div] || div === "Catch Weight" || div === "Open Weight") div = f.prior_division || div;
  const nR = f.rounds || (f.title ? 5 : 3);
  const sideA = Object.assign({ keys }, f.A), sideB = Object.assign({ keys }, f.B);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const flip of [0, 1]) {
    const X = flip ? sideB : sideA, Y = flip ? sideA : sideB;
    let opts = { division: div, rounds: nR, title: !!f.title, date: f.date, priors: pri, params };
    if (hook) opts = hook.matchupOpts(opts, { fight: f, swap: !!flip, A: X, B: Y, hookParams: hookvals, params }) || opts;
    const m = E.matchup(X, Y, opts);
    const s = E.summarize(m, sims, mixer(fnv(f.id + "|" + flip) ^ mixer(seed)));
    for (let k = 0; k < 7; k++) counts[flip ? 6 - k : k] += s.counts[k];
  }
  out.push({ id: f.id, date: f.date, y, n: 2 * sims, counts, eloA: f.A.elo, eloB: f.B.elo });
}
const cpu = process.cpuUsage(t0);
fs.writeFileSync(abs(a.out), JSON.stringify({ engine: a.engine, params: a.params, hook: a.hook || null, hookvals, sims, seed,
  split: a.split || "val", skipped2026, cpuSeconds: (cpu.user + cpu.system) / 1e6, fights: out }));
console.log(`${out.length} fights, ${skipped2026} entries dated 2026+ skipped, ${((cpu.user + cpu.system) / 1e6).toFixed(1)} s CPU -> ${a.out}`);
