#!/usr/bin/env node
/* VAULT AUDIT 2 (auditor only): tools/evalv.js, unchanged except for its inputs and output paths.

     nice -n 5 node tools/vault_audit2/evalv_vault2.js --mode vault --version v4 [--engine-dir versions/v4] [--compare v4] [--sims 300]
     nice -n 5 node tools/vault_audit2/evalv_vault2.js --mode dev2425 --version v7cmp --engine-dir versions/v7 --split val

   It reads tools/evalv.js, applies the literal substitutions of the chosen mode (each must match exactly once, or nothing runs),
   writes <vault>/audit2/gen/evalv_<mode>_gen.js and runs it. Everything else (simulation, common random numbers seed 1, both
   corner orders, metrics, event-cluster bootstrap, paired differences, base-rate tables, methodround --score) is evalv.js's own code.
   Outputs go to <vault>/audit2/evalv/; version_history.json is never touched (forced DEV mode).

   mode dev2425: the 2024-2025 rows of an engine on its usual leak-free inputs (no vault input), for the comparator stacker's fit
     through 2025 (cmp4's MoE stacker needs the v4 simulator's fold-honest rows for 2024-2025; deployment fit, the rows' own
     2024-25 scores are not used). Only the output paths change.
   mode vault: the 2026 vault fights with inputs built by the frozen production procedures (no fit reads a 2026 result):
     backtest   <vault>/backtest_vault.json (walk-forward pre-fight sides)
     priors     <vault>/audit1/priors_asof_vault.json = backtest.json priors_asof["2026"] (fights 2021-2025)
     ML rates   <vault>/audit1/mlrates_vault.json (production mlrates.json, fit 2010-2025), for every engine major version
     durability <vault>/durability_vault.json records + the train-only NORM of data/derived/durability.json (as audit 1)
     SOS        <vault>/audit1/sos_wf_vault.json (as audit 1)
     step 4     tools/vault_audit2/mlpathrec_vault.js (embed etas from the 2026-01-01 production export; the frozen recipe rule)
     retarget   <vault>/audit2/statlines_targets_vault.json (statlines.json models.prod, fit 2019-2025; tools/vault_audit2/targets_vault.js)
     smoothing  baseDist from TRAIN fights 2019-2023 of data/derived/backtest_dev.json (as evalv on every split) */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
let VAULT = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
function take(flag) { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; }
VAULT = take("--vault") || VAULT;
const MODE = take("--mode") || "vault";
const AUD1 = path.join(VAULT, "audit1"), AUD = path.join(VAULT, "audit2");
const J = JSON.stringify;
const COMMON = [
  ['const DEV = !!args.dev;', 'const DEV = true;   // vault audit 2: never touches version_history.json'],
  ['const OUTDIR = path.join(ROOT, "data/derived/evalv");', `const OUTDIR = ${J(path.join(AUD, "evalv"))};`],
  ['const HIST = path.join(ROOT, "data/derived/version_history.json");', `const HIST = ${J(path.join(AUD, "evalv", "no_history.json"))};`],
  ['const dir = path.join(ROOT, "out", "evalv"); fs.mkdirSync(dir, { recursive: true });', `const dir = ${J(path.join(AUD, "evalv_mr"))}; fs.mkdirSync(dir, { recursive: true });`],
  ['const outFile = path.join(OUTDIR, `${VERSION}${DEV ? "_dev" : ""}_${SPLIT}.json`);', 'const outFile = path.join(OUTDIR, `${VERSION}_${SPLIT}.json`);'],
];
const VAULT_SUBS = [
  ['const ROOT = path.resolve(__dirname, "..");', `const ROOT = ${J(ROOT)}; const VAULT_DIR = ${J(VAULT)}; const AUD1 = ${J(AUD1)}; const AUD2 = ${J(AUD)};`],
  ['const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"] };',
   'const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"], vault: ["2026-01-01", "2026-11-01"] };\n' +
   'function loadDevTrain() { const btd = readJSON("data/derived/backtest_dev.json"); const keys = btd.meta.keys; const fs_ = btd.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01"); for (const f of fs_) { f.A.keys = keys; f.B.keys = keys; } return fs_; }'],
  ['const bt = readJSON("data/derived/backtest_dev.json");', 'const bt = readJSON(path.join(VAULT_DIR, "backtest_vault.json"));'],
  ['const fights = bt.fights.filter((f) => f.date < VAULT_FROM);', 'const fights = bt.fights.filter((f) => f.date >= VAULT_FROM && f.date < "2026-11-01");'],
  ['const priors = readJSON("data/derived/mlcal_priors_asof.json");', 'const priors = readJSON(path.join(AUD1, "priors_asof_vault.json"));'],
  ['const OOF = useML ? readJSON(+String(E.VERSION).split(".")[0] >= 6 ? "data/derived/mlrates_oof_fh.json" : "data/derived/mlrates_oof.json") : null;',
   'const OOF = useML ? readJSON(path.join(AUD1, "mlrates_vault.json")) : null;'],
  ['const DURJ = useDur ? readJSON("data/derived/durability.json") : null;',
   'const DURJ = useDur ? readJSON(path.join(VAULT_DIR, "durability_vault.json")) : null; const DURN = useDur ? readJSON("data/derived/durability.json") : null;'],
  ['const durNorm = useDur ? { durability: { normChin: DURJ.engine.norm_chin_backtest_2019_2023, normPow: DURJ.engine.norm_pow_backtest_2019_2023 } } : null;',
   'const durNorm = useDur ? { durability: { normChin: DURN.engine.norm_chin_backtest_2019_2023, normPow: DURN.engine.norm_pow_backtest_2019_2023 } } : null;'],
  ['const SOSJ = useSOS ? readJSON("data/derived/sos_wf.json") : null;', 'const SOSJ = useSOS ? readJSON(path.join(AUD1, "sos_wf_vault.json")) : null;'],
  ['const RTJ = useRT ? readJSON("data/derived/v8/statlines_targets.json") : null;', 'const RTJ = useRT ? readJSON(path.join(AUD2, "statlines_targets_vault.json")) : null;'],
  ['const MLP_FILE = fs.existsSync(path.join(ENGINE_DIR, "mlpathrec.js")) ? path.join(ENGINE_DIR, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js");',
   'const MLP_FILE = path.join(ROOT, "tools/vault_audit2/mlpathrec_vault.js"); process.env.VAUDIT_ENGINE_DIR = ENGINE_DIR;'],
  ['const trainFights = fightsAll.filter((f) => f.date >= SPLITS.train[0] && f.date < SPLITS.train[1]);', 'const trainFights = loadDevTrain();'],
  ['"--score-out", outp, "--backtest", path.join(ROOT, "data/derived/backtest_dev.json")]', '"--score-out", outp, "--backtest", path.join(VAULT_DIR, "backtest_vault.json")]'],
];
const DEV_SUBS = [['const ROOT = path.resolve(__dirname, "..");', `const ROOT = ${J(ROOT)};`]];
const SUBS = (MODE === "vault" ? VAULT_SUBS : DEV_SUBS).concat(COMMON);
let src = fs.readFileSync(path.join(ROOT, "tools/evalv.js"), "utf8");
for (const [a, b] of SUBS) {
  const n = src.split(a).length - 1;
  if (n !== 1) { console.error("evalv_vault2: substitution matched " + n + " times: " + a.slice(0, 100)); process.exit(2); }
  src = src.replace(a, () => b);
}
fs.mkdirSync(path.join(AUD, "gen"), { recursive: true });
fs.mkdirSync(path.join(AUD, "evalv"), { recursive: true });
const gen = path.join(AUD, "gen", `evalv_${MODE}_gen.js`);
fs.writeFileSync(gen, src);
const crypto = require("crypto");
console.log("evalv_vault2 (" + MODE + "): tools/evalv.js sha256 " + crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tools/evalv.js"))).digest("hex").slice(0, 16) +
  ", " + SUBS.length + " substitutions -> " + gen);
const extra = MODE === "vault" ? ["--split", "vault"] : [];
const r = spawnSync(process.execPath, [gen].concat(extra, args), { stdio: "inherit", cwd: ROOT, env: process.env });
process.exit(r.status == null ? 1 : r.status);
