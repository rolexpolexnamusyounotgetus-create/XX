#!/usr/bin/env node
/* VAULT AUDIT 2 (auditor only): tools/v10_stat_gate.js (the v8 / v10 stat-line harness: arms of one engine file with common random
   numbers, 10 per-fighter stats, PIT) on the sealed 2026 vault, unchanged except for its inputs.

     nice -n 5 node tools/vault_audit2/stat_vault.js --engine-dir versions/v10-rejected --arms cmp4,all --sims 300 --workers 3 --seed 10
          --out <vault>/audit2/stat_v10_vault.json

   Arms: cmp4 = every v8 flag off = engine 4.0.0 bit for bit (tests/test_v8.js, tests/test_v10.js); all = the engine's v8 bundle.
   Inputs: backtest_vault.json (actual stat lines), priors_asof["2026"], production learned rates (mlrates_vault, fit 2010-2025),
   tools/vault_audit2/mlpathrec_vault.js (fold-honest recipe coef_fh["2024"], 2026-01-01 embedding export), retarget targets
   <vault>/audit2/statlines_targets_vault.json (statlines prod table, fit 2019-2025). Seed 10 as the v10 look's stat harness. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
function take(flag) { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; }
const VAULT = take("--vault") || "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
const AUD1 = path.join(VAULT, "audit1"), AUD = path.join(VAULT, "audit2");
const J = JSON.stringify;
const SUBS = [
  ['const ROOT = path.resolve(__dirname, "..");', `const ROOT = ${J(ROOT)}; const VAULT_DIR = ${J(VAULT)}; const AUD1 = ${J(AUD1)}; const AUD2 = ${J(AUD)};`],
  ['const bt = readJSON("data/derived/backtest_dev.json");', 'const bt = readJSON(path.join(VAULT_DIR, "backtest_vault.json"));'],
  ['let out = bt.fights.filter((f) => f.date >= WINDOW[0] && f.date < WINDOW[1] && f.date < "2026-01-01");',
   'let out = bt.fights.filter((f) => f.date >= "2026-01-01" && f.date < "2026-11-01");'],
  ['const priors = readJSON("data/derived/mlcal_priors_asof.json");', 'const priors = readJSON(path.join(AUD1, "priors_asof_vault.json"));'],
  ['const OOF = readJSON("data/derived/mlrates_oof_fh.json"), names = OOF.meta.targets;', 'const OOF = readJSON(path.join(AUD1, "mlrates_vault.json")), names = OOF.meta.targets;'],
  ['const TG = readJSON("data/derived/v8/statlines_targets.json").fights;', 'const TG = readJSON(path.join(AUD2, "statlines_targets_vault.json")).fights;'],
  ['const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);', 'const XR = require(path.join(ROOT, "tools/vault_audit2/mlpathrec_vault.js"))(E, ROOT);'],
  ['if (SPLIT !== "train" && SPLIT !== "val") { console.error("v10_stat_gate: --split train | val"); process.exit(2); }',
   'if (SPLIT !== "vault") { console.error("stat_vault: --split vault only"); process.exit(2); }'],
  ['targets: path.join(ROOT, "data/derived/v8/statlines_targets.json"),', 'targets: path.join(AUD2, "statlines_targets_vault.json"),'],
  ['backtest: path.join(ROOT, "data/derived/backtest_dev.json"), harness: __filename };', 'backtest: path.join(VAULT_DIR, "backtest_vault.json"), harness: __filename };'],
];
let src = fs.readFileSync(path.join(ROOT, "tools/v10_stat_gate.js"), "utf8");
for (const [a, b] of SUBS) {
  const n = src.split(a).length - 1;
  if (n !== 1) { console.error("stat_vault: substitution matched " + n + " times: " + a.slice(0, 110)); process.exit(2); }
  src = src.replace(a, () => b);
}
fs.mkdirSync(path.join(AUD, "gen"), { recursive: true });
const gen = path.join(AUD, "gen", "v10_stat_gate_vault_gen.js");
fs.writeFileSync(gen, src);
console.log("stat_vault: tools/v10_stat_gate.js sha256 " + crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tools/v10_stat_gate.js"))).digest("hex").slice(0, 16) +
  ", " + SUBS.length + " substitutions -> " + gen);
const r = spawnSync(process.execPath, [gen, "--split", "vault"].concat(args), { stdio: "inherit", cwd: ROOT, env: process.env });
process.exit(r.status == null ? 1 : r.status);
