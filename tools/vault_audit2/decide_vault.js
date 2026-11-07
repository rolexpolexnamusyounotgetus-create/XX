#!/usr/bin/env node
/* VAULT AUDIT 2 (auditor only): tools/evalv_decide.js applied DESCRIPTIVELY to two audit-2 vault evalv runs (no decision is taken on
   the vault). Reported blocks: the paired base-rate test (sensitivity) and, as pre-registered in the v10 review's prewarnings, the
   fixed_actual block (actual held fixed: drift_6_3 and drift_outside), plus the Holm secondary family.

     node tools/vault_audit2/decide_vault.js --new v10 --old v4 [--vault <dir>]

   Three literal substitutions in evalv_decide.js's source (ROOT, the backtest it joins is the vault's, the vault filter inverted);
   output <vault>/audit2/decide_<new>_vs_<old>_vault.json. */
"use strict";
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const a = process.argv.slice(2), get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const VAULT = get("--vault", "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault"), AUD = path.join(VAULT, "audit2");
const NEWV = get("--new"), OLDV = get("--old", "v4");
let src = fs.readFileSync(path.join(ROOT, "tools/evalv_decide.js"), "utf8");
const SUBS = [
  ['const bt = J("data/derived/backtest_dev.json");', "const bt = J(" + JSON.stringify(path.join(VAULT, "backtest_vault.json")) + ");"],
  ['bt.fights.filter((f) => f.date < "2026-01-01")', 'bt.fights.filter((f) => f.date >= "2026-01-01")'],
  ['const ROOT = path.resolve(__dirname, "..");', "const ROOT = " + JSON.stringify(ROOT) + ";"],
];
for (const [x, y] of SUBS) { const n = src.split(x).length - 1; if (n !== 1) { console.error("decide_vault: substitution matched " + n + " times: " + x); process.exit(2); } src = src.replace(x, () => y); }
fs.mkdirSync(path.join(AUD, "gen"), { recursive: true });
const gen = path.join(AUD, "gen", "evalv_decide_vault_gen.js");
fs.writeFileSync(gen, src);
const r = spawnSync(process.execPath, [gen, "--new", path.join(AUD, "evalv", NEWV + "_vault.json"), "--old", path.join(AUD, "evalv", OLDV + "_vault.json"),
  "--boot", "2000", "--out", path.join(AUD, "decide_" + NEWV + "_vs_" + OLDV + "_vault.json")], { stdio: "inherit", cwd: ROOT });
process.exit(r.status == null ? 1 : r.status);
