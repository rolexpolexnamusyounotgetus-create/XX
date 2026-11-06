#!/usr/bin/env node
/* dynamics_engine.js: helper for tools/dynamics.py --engine-check.

   Runs the current engine (src/engine3.js with src/params3.js, read-only) on walk-forward backtest snapshots
   from data/derived/backtest_dev.json (the development file: no fight from 2026-01-01, per the hidden-data
   protocol in docs/BACKLOG.md), traced, and writes one CSV row per simulated fighter-round so that
   dynamics.py can measure the same round-level dynamics statistics on simulated fights as on real ones.

   Usage: node tools/dynamics_engine.js <out.csv> [--from 2024-01-01] [--to 2025-12-31] [--sims 30] [--max 0]
          [--engine-dir src]   (a directory holding engine3.js and params3.js; default src/)
*/
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const out = args[0];
function opt(k, d) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; }
const FROM = opt("--from", "2024-01-01"), TO = opt("--to", "2025-12-31");
const SIMS = +opt("--sims", "30"), MAX = +opt("--max", "0");
const EDIR = path.resolve(opt("--engine-dir", path.join(ROOT, "src")));
const P = require(path.join(EDIR, "params3.js"));
const E = require(path.join(EDIR, "engine3.js"));
const bt = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "backtest_dev.json"), "utf8"));
let priors = null;
try { priors = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "mlcal_priors_asof.json"), "utf8")); } catch (e) { priors = null; }
let fights = bt.fights.filter((f) => f.date >= FROM && f.date <= TO && f.date < "2026-01-01");
if (MAX > 0) fights = fights.slice(0, MAX);
const KEYS = ["sig_att", "sig_lnd", "h_att", "h_lnd", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "kd",
  "td_att", "td_lnd", "ctrl", "sub_att", "sh_lnd", "b_lnd", "l_lnd", "hurt"];
const lines = ["fid,sim,idx,rnd,R,rsec,winner,method,fin_round,division," + KEYS.join(",") + ",dmg_end"];
let nerr = 0, nf = 0;
const t0 = Date.now();
for (const f of fights) {
  let m;
  try {
    const pri = priors ? priors[f.date.slice(0, 4)] : null;
    const generic = f.division === "Catch Weight" || f.division === "Open Weight" || (pri && !pri[f.division]);
    const division = generic ? (f.prior_division || f.division) : f.division;
    const o = { division, rounds: f.rounds || (f.title ? 5 : 3), title: !!f.title, date: f.date };
    if (pri) o.priors = pri;
    const keys = bt.meta && bt.meta.keys;
    m = E.matchup(Object.assign({}, f.A, keys ? { keys } : {}), Object.assign({}, f.B, keys ? { keys } : {}), o);
  } catch (e) { nerr++; continue; }
  for (let s = 0; s < SIMS; s++) {
    let fight;
    try {
      const seed = (Math.imul(nf + 1, 2654435761) ^ (s * 40503)) >>> 0;
      const r = E.makeRng(seed);
      fight = E.simulate(m, r, true);
    } catch (e) { nerr++; if (nerr < 4) console.error(String(e && e.stack || e)); continue; }
    const R = f.rounds || (f.title ? 5 : 3);
    const nr = fight.rounds.length;
    for (const rec of fight.rounds) {
      const last = rec.r === nr - 1;
      const rsec = last && fight.fin && fight.round === rec.r + 1 ? fight.t : 300;
      for (const [idx, side] of [[0, "A"], [1, "B"]]) {
        const st = rec.st[side];
        const row = [f.id, s, idx, rec.r + 1, R, Math.round(rsec * 10) / 10, fight.winner, fight.method, fight.round,
          JSON.stringify(f.division)];
        for (const k of KEYS) row.push(st[k] != null ? st[k] : 0);
        row.push(idx === 0 ? rec.endState.dA : rec.endState.dB);
        lines.push(row.join(","));
      }
    }
  }
  nf++;
}
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(JSON.stringify({ fights: nf, sims: SIMS, errors: nerr, rows: lines.length - 1, secs: (Date.now() - t0) / 1000,
  params_version: P.version || null, engine_dir: EDIR }));
