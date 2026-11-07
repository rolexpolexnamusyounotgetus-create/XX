#!/usr/bin/env node
/* VAULT AUDIT 1 (auditor only): tools/evalv.js run on the sealed 2026 vault, unchanged except for its inputs.

     nice -n 5 node tools/vault_audit1/evalv_vault.js --version v4 [--sims 300] [--workers 3] [--compare v4] [--vault <dir>]

   tools/evalv.js refuses 2026 fights by design. This wrapper reads its source, applies the literal substitutions listed in
   SUBS below (each must match exactly once, or nothing runs), writes the result to <vault>/audit1/gen/evalv_vault_gen.js and
   runs it. Everything else (simulation, common random numbers, symmetric corner orders, metrics, event-cluster bootstrap,
   paired differences, base-rate table, methodround --score) is evalv.js's own code. The run never writes inside the repo:
   outputs go to <vault>/audit1/evalv/<version>_vault.json; version_history.json is never touched (forced DEV mode).

   Inputs for 2026 fights (all built by the frozen production procedure, no 2026 result in any fit):
     backtest   <vault>/backtest_vault.json (walk-forward pre-fight sides, tools/build_db.py)
     priors     <vault>/audit1/priors_asof_vault.json = data/derived/backtest.json priors_asof["2026"] (fights 2021-2025)
     ML rates   <vault>/audit1/mlrates_vault.json (tools/vault_audit1/mlrates_vault.py: production mlrates.json, fit 2010-2025)
     durability <vault>/durability_vault.json walk-forward records (fit_through 2023-12-31) + the train-only NORM of
                data/derived/durability.json (exactly as evalv uses on 2024-25)
     SOS        <vault>/audit1/sos_wf_vault.json (tools/vault_audit1/sos_vault.py: the same walk through 2026-10-31; meta.coef =
                the 2019-2023 fit, as on 2024-25)
     step 4     tools/vault_audit1/mlpathrec_vault.js (embed: the production embedding exported at 2026-01-01, embed_model.json;
                preufc: preufc.json pre-bout Sherdog records; recipe = embed_model.json, as on 2024-25)
     smoothing  baseDist from TRAIN fights 2019-2023 of data/derived/backtest_dev.json (as evalv on every split)
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
let VAULT = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
const vi = args.indexOf("--vault");
if (vi >= 0) { VAULT = args[vi + 1]; args.splice(vi, 2); }
const AUD = path.join(VAULT, "audit1");
const J = JSON.stringify;

const SUBS = [
  ['const ROOT = path.resolve(__dirname, "..");',
   `const ROOT = ${J(ROOT)}; const VAULT_DIR = ${J(VAULT)}; const AUD = ${J(AUD)};`],
  ['const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"] };',
   'const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"], vault: ["2026-01-01", "2026-11-01"] };\n' +
   'function loadDevTrain() { const bt = readJSON("data/derived/backtest_dev.json"); const keys = bt.meta.keys; const fs_ = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01"); for (const f of fs_) { f.A.keys = keys; f.B.keys = keys; } return fs_; }'],
  ['const bt = readJSON("data/derived/backtest_dev.json");', 'const bt = readJSON(path.join(VAULT_DIR, "backtest_vault.json"));'],
  ['const fights = bt.fights.filter((f) => f.date < VAULT_FROM);', 'const fights = bt.fights.filter((f) => f.date >= VAULT_FROM && f.date < "2026-11-01");'],
  ['const priors = readJSON("data/derived/mlcal_priors_asof.json");', 'const priors = readJSON(path.join(AUD, "priors_asof_vault.json"));'],
  ['const OOF = useML ? readJSON("data/derived/mlrates_oof.json") : null;', 'const OOF = useML ? readJSON(path.join(AUD, "mlrates_vault.json")) : null;'],
  ['const DURJ = useDur ? readJSON("data/derived/durability.json") : null;',
   'const DURJ = useDur ? readJSON(path.join(VAULT_DIR, "durability_vault.json")) : null; const DURN = useDur ? readJSON("data/derived/durability.json") : null;'],
  ['const durNorm = useDur ? { durability: { normChin: DURJ.engine.norm_chin_backtest_2019_2023, normPow: DURJ.engine.norm_pow_backtest_2019_2023 } } : null;',
   'const durNorm = useDur ? { durability: { normChin: DURN.engine.norm_chin_backtest_2019_2023, normPow: DURN.engine.norm_pow_backtest_2019_2023 } } : null;'],
  ['const SOSJ = useSOS ? readJSON("data/derived/sos_wf.json") : null;', 'const SOSJ = useSOS ? readJSON(path.join(AUD, "sos_wf_vault.json")) : null;'],
  ['const DEV = !!args.dev;', 'const DEV = true;   // vault audit: never touches version_history.json'],
  ['const OUTDIR = path.join(ROOT, "data/derived/evalv");', 'const OUTDIR = path.join(AUD, "evalv");'],
  ['const HIST = path.join(ROOT, "data/derived/version_history.json");', 'const HIST = path.join(AUD, "evalv", "no_history.json");'],
  ['const MLP_FILE = fs.existsSync(path.join(ENGINE_DIR, "mlpathrec.js")) ? path.join(ENGINE_DIR, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js");',
   'const MLP_FILE = path.join(ROOT, "tools/vault_audit1/mlpathrec_vault.js"); process.env.VAUDIT_ENGINE_DIR = ENGINE_DIR;'],
  ['const trainFights = fightsAll.filter((f) => f.date >= SPLITS.train[0] && f.date < SPLITS.train[1]);', 'const trainFights = loadDevTrain();'],
  ['const dir = path.join(ROOT, "out", "evalv"); fs.mkdirSync(dir, { recursive: true });', 'const dir = path.join(AUD, "evalv_mr"); fs.mkdirSync(dir, { recursive: true });'],
  ['"--score-out", outp, "--backtest", path.join(ROOT, "data/derived/backtest_dev.json")]', '"--score-out", outp, "--backtest", path.join(VAULT_DIR, "backtest_vault.json")]'],
  ['const outFile = path.join(OUTDIR, `${VERSION}${DEV ? "_dev" : ""}_${SPLIT}.json`);', 'const outFile = path.join(OUTDIR, `${VERSION}_${SPLIT}.json`);'],
];

let src = fs.readFileSync(path.join(ROOT, "tools/evalv.js"), "utf8");
for (const [a, b] of SUBS) {
  const n = src.split(a).length - 1;
  if (n !== 1) { console.error("evalv_vault: substitution matched " + n + " times: " + a.slice(0, 90)); process.exit(2); }
  src = src.replace(a, () => b);
}
fs.mkdirSync(path.join(AUD, "gen"), { recursive: true });
fs.mkdirSync(path.join(AUD, "evalv"), { recursive: true });
const gen = path.join(AUD, "gen", "evalv_vault_gen.js");
fs.writeFileSync(gen, src);
// priors for 2026: backtest.json priors_asof["2026"] (built by tools/build_db.py from fights dated 2021-01-01..2025-12-31)
const pf = path.join(AUD, "priors_asof_vault.json");
if (!fs.existsSync(pf)) {
  const bt = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/backtest.json"), "utf8"));
  fs.writeFileSync(pf, JSON.stringify({ "2026": bt.priors_asof["2026"] }));
}
const crypto = require("crypto");
console.log("evalv_vault: tools/evalv.js sha256 " + crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tools/evalv.js"))).digest("hex").slice(0, 16) +
  ", " + SUBS.length + " substitutions -> " + gen);
const r = spawnSync(process.execPath, [gen, "--split", "vault"].concat(args), { stdio: "inherit", cwd: ROOT, env: process.env });
process.exit(r.status == null ? 1 : r.status);
