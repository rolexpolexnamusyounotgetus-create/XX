#!/usr/bin/env node
/* VAULT AUDIT 1 (auditor only): the FightEngine.predict() package with v4 as its base, on the 2026 vault, close / open / none.

     node tools/vault_audit1/predict_vault.js [--vault <dir>]

   predict() lives only in the v5 engines (components.blend_anchor; v4 has no predict()). Its point outputs are a deterministic
   composition, rebuilt here with the frozen building blocks of versions/v5-rejected/ml/blend.js (FightBlend.rescale /
   poolCells) and the v5 params' blend block (mrWeight 0.3, linear pool, recalT 1), with engine v4 as the simulator:
     P(win)  = the production stack data/derived/blindtest_stack.json by lineKind (close: `model` fed the power-de-vig close;
               open: `model_open` fed the multiplicative opener; none: the absent block), engine expert = engine v4: exactly
               models_vault.json stack_close / stack_open / stack_noline (blend.js recalT 1 leaves them unchanged)
     cells   = 0.3 * rescale(engine v4 cells, P(win)) + 0.7 * rescale(method/round cells, P(win)); method/round cells =
               methodround.json SM_refit for close (fit through 2025-12-31 with the closing line), S_refit otherwise (the
               "fit through Dec 31 of the year before the fight" rule tools/predictrec.js applies)
   The interval, anchor mode and stat lines are not scored. Differences from a live predict() call: the engine cells are
   evalv's (300 sims per corner order, train-base smoothing) rather than predict's 1,000-sim Jeffreys smoothing.
   Output: <vault>/audit1/predict_vault.json {fights: {id: {close|open|none: {pA, cells}}}} */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const vi = args.indexOf("--vault");
const VAULT = vi >= 0 ? args[vi + 1] : "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
const AUD = path.join(VAULT, "audit1");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const FB = require(path.join(ROOT, "versions/v5-rejected/ml/blend.js"));
const CFG = require(path.join(ROOT, "versions/v5-rejected/engine3.js")).params().blend;
const MV = J(path.join(AUD, "models_vault.json")).fights;
const ENG = new Map(J(path.join(AUD, "evalv", "v4_vault.json")).fights.map((x) => [x.id, x]));
const MRJ = J(path.join(ROOT, "data/derived/methodround.json")).fights;
const BT = J(path.join(VAULT, "backtest_vault.json")).fights;
const w = CFG.mrWeight, pool = CFG.mrPool, T = CFG.recalT;
if (T !== 1) throw new Error("recalT " + T);
const out = {};
for (const f of BT) {
  const e = ENG.get(f.id), m = MV[f.id], r = MRJ[f.id];
  const R = f.rounds === 5 ? 5 : 3;
  const o = {};
  for (const [kind, pk, mk] of [["close", "stack_close", "SM_refit"], ["open", "stack_open", "S_refit"], ["none", "stack_noline", "S_refit"]]) {
    const p = m[pk];
    if (!(typeof p === "number") || !e) continue;
    const simR = FB.rescale(e.cells, R, p);
    const mc = r && Array.isArray(r[mk]) && r[mk].length === 4 * R + 3 ? r[mk] : null;
    const cells = mc ? FB.poolCells(simR, FB.rescale(mc, R, p), w, pool) : simR;
    o[kind] = { pA: p, cells: cells.map((v) => +v.toFixed(7)), mr: mc ? mk : null };
  }
  out[f.id] = o;
}
fs.writeFileSync(path.join(AUD, "predict_vault.json"), JSON.stringify({ meta: { tool: "tools/vault_audit1/predict_vault.js", mrWeight: w, mrPool: pool,
  blend_js: "versions/v5-rejected/ml/blend.js " + FB.VERSION, built: new Date().toISOString() }, fights: out }));
console.log("predict_vault: " + Object.keys(out).length + " fights, mrWeight " + w + ", pool " + pool);
