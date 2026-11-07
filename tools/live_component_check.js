/* live_component_check.js (v10 review): does every component the engine's params switch on actually act on the LIVE path
   (production files, no backtest harness)? v10 shipped the retarget / tdIntent / ctrlSpread bundle ON, but live predict() and
   matchup() never received statlines targets, so the retarget recorded {applied:false, reason:'no targets'} and the live simulator
   was v4's; its frozen copy also dropped the S / S2 method-round pool silently. A version that ships a component must pass this.
     node tools/live_component_check.js [--engine-dir src] [--json out.json]
   Checks on Volkanovski vs Gaethje (5 x 5, opener +160 / -180, production data files):
     embed on      -> matchup().embed.src is not null
     retarget on   -> matchup().retarget.applied === true (and predict()'s simulator matchup too)
     tdIntent / ctrlSpread on -> matchup().spread is set
     blend_anchor on and S2 / S cells requested -> predict().methodRound.weight < 1 and no methodRound.mrLib.missing
   Exit 1 if any on-component does not act. Off components pass trivially (nothing to ship). Reads no outcome. */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(ROOT, opt("--engine-dir", "src"));
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const E = require(path.join(DIR, "engine3.js"));
const P = E.params(), C = P.components || {};
let pass = 0, fail = 0; const rows = [];
function check(name, ok, info) { rows.push({ name, ok: !!ok, info: info || null }); if (ok) pass++; else fail++; console.log((ok ? "PASS  " : "FAIL  ") + name + (info ? "  (" + info + ")" : "")); }
E.loadDB(readJSON("data/derived/fighters.json"));
try { if (E.loadMLRates) E.loadMLRates(readJSON("data/derived/mlrates.json")); } catch (e) { /* page path may run without learned rates */ }
const LIVE = { division: "Lightweight", rounds: 5, title: false, date: "2026-12-12", sims: 100, seed: 3, interval: false, lineKind: "open", line: { oddsA: 160, oddsB: -180 } };
const m = E.matchup("alexander-volkanovski", "justin-gaethje", LIVE);
console.log(`engine ${E.VERSION} (${path.relative(ROOT, DIR) || "."}), params ${P.version}`);
if (C.embed) check("embed is on: the live matchup has an embedding source", m.embed && m.embed.src != null, JSON.stringify(m.embed ? m.embed.src : null));
else check("embed: off (nothing to ship)", true);
if (C.retarget) check("retarget is on: the live matchup is retargeted", m.retarget && m.retarget.applied === true, JSON.stringify(m.retarget || null));
else check("retarget: off (nothing to ship)", true);
for (const k of ["tdIntent", "ctrlSpread"]) {
  if (C[k]) check(`${k} is on: the live matchup carries its spread (acts only on a retargeted matchup)`, m.spread != null, m.spread == null ? "spread " + m.spread : "set");
  else check(`${k}: off (nothing to ship)`, true);
}
if (C.blend_anchor && typeof E.loadBlend === "function" && typeof E.predict === "function") {
  E.loadBlend({ stack: readJSON("data/derived/blindtest_stack.json"), feat: readJSON("data/derived/moe_page.json"), ml2: readJSON("data/derived/ml2.json"),
    market: readJSON("data/derived/market.json"), methodRound: readJSON("data/derived/methodround.json"), winnerStacks: readJSON("data/derived/v6_stacks.json"),
    mrS2: readJSON("data/derived/mr_s2.json"), debut: readJSON("data/derived/debut.json"), statDist: readJSON("data/derived/statlines.json"),
    ml2Trees: readJSON("data/derived/ml2_trees.json"), lineStack: readJSON("data/derived/line_stack.json") });
  const pk = E.predict("alexander-volkanovski", "justin-gaethje", LIVE), mr = pk.methodRound || {};
  check("blend_anchor is on: live predict() pools S / S2 method-round cells (weight < 1, library found)", mr.weight < 1 && !(mr.mrLib && mr.mrLib.missing),
    "weight " + mr.weight + ", variant " + mr.variant + (mr.mrLib ? ", " + mr.mrLib.note : ""));
  if (C.retarget) {
    const sm = pk.sim && pk.sim.matchup ? pk.sim.matchup : null;
    check("retarget is on: predict()'s simulator ran a retargeted matchup", !!(sm && sm.retarget && sm.retarget.applied), sm ? JSON.stringify(sm.retarget || null) : "predict() does not expose the matchup; matchup() check above decides");
  }
} else check("blend_anchor: off (nothing to ship)", true);
console.log(pass + " passed, " + fail + " failed");
const out = opt("--json", null);
if (out) fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify({ engine: E.VERSION, dir: path.relative(ROOT, DIR), params: P.version, pass, fail, rows }, null, 1));
process.exit(fail ? 1 : 0);
