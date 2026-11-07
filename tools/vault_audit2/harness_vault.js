#!/usr/bin/env node
/* VAULT AUDIT 2 (auditor only): tools/predict_harness.js on the sealed 2026 vault, unchanged except for its inputs.

     nice -n 5 node tools/vault_audit2/harness_vault.js [--vault <dir>] --pkg v10=v10-rejected:v10 --pkg cmp4=v7-gate-failed:cmp4
          --pkg v6=v6-rejected:v6 --sims 300 --workers 3 --kinds close,open,none --out <vault>/audit2/harness_vault.json

   1. Package copies. Each --pkg names a frozen directory under versions/; it is copied to <vault>/audit2/pkgs/<name>/ and exactly two
      constants of its ml/blend.js are changed (asserted, once each): the backtest guard VAULT_FROM "2026-01-01" -> "2026-11-01" (the
      vault is open for this audit) and BACKTEST_STACK_MAX "2023-12-31" -> "2025-12-31" (the stacker is fit through 2025, as the
      pre-registration requires). Every other byte equals the frozen file (sha256 recorded).
   2. tools/predict_harness.js is read, the literal substitutions in SUBS are applied (each must match exactly once), the result is
      written to <vault>/audit2/gen/predict_harness_vault_gen.js and run. Simulation, common random numbers (seed = hash(fight id)),
      corner handling, the records and the cross-package simulator-identity assertion are the harness's own code.
   Inputs (2026 analogues of each 2024-25 source, all fit through 2025-12-31, no 2026 result in any fit): backtest_vault.json;
   priors_asof["2026"]; learned rates = production mlrates.json (fit 2010-2025) for every engine; durability_vault records + train NORM
   and sos_wf_vault (v6's components; as audit 1); step-4 inputs tools/vault_audit2/mlpathrec_vault.js; predict inputs
   tools/vault_audit2/predictrec_vault.js; retarget targets <vault>/audit2/statlines_targets_vault.json (statlines prod table). */
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
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
// ---------------- 1. package copies
const pk = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--pkg") pk.push(i);
const manifest = {};
for (const i of pk) {
  const [name, rest] = args[i + 1].split("="), k = rest.lastIndexOf(":"), src = path.join(ROOT, "versions", rest.slice(0, k)), mode = rest.slice(k + 1);
  const dst = path.join(AUD, "pkgs", name);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, dereference: true, filter: (s) => !/\/(logs|tests|tools)(\/|$)/.test(s.slice(src.length)) });
  const bj = path.join(dst, "ml", "blend.js");
  let b = fs.readFileSync(bj, "utf8");
  for (const [a, c] of [['var VAULT_FROM = "2026-01-01";', 'var VAULT_FROM = "2026-11-01";   // VAULT AUDIT 2 copy'],
                        ['var BACKTEST_STACK_MAX = "2023-12-31";', 'var BACKTEST_STACK_MAX = "2025-12-31";   // VAULT AUDIT 2 copy']]) {
    const n = b.split(a).length - 1;
    if (n !== 1) { console.error("harness_vault: blend.js constant matched " + n + " times in " + src + ": " + a); process.exit(2); }
    b = b.replace(a, c);
  }
  fs.writeFileSync(bj, b);
  manifest[name] = { frozen: path.relative(ROOT, src), mode, engine_sha256: sha(path.join(src, "engine3.js")), params_sha256: sha(path.join(src, "params3.js")),
    blend_sha256_frozen: sha(path.join(src, "ml", "blend.js")), blend_sha256_copy: sha(bj),
    copy_identical_except_blend: fs.readdirSync(path.join(dst, "ml")).every((f) => f === "blend.js" || sha(path.join(dst, "ml", f)) === sha(path.join(src, "ml", f))) &&
      sha(path.join(dst, "engine3.js")) === sha(path.join(src, "engine3.js")) && sha(path.join(dst, "params3.js")) === sha(path.join(src, "params3.js")) };
  args[i + 1] = name + "=" + dst + ":" + mode;
}
fs.writeFileSync(path.join(AUD, "pkgs", "manifest.json"), JSON.stringify(manifest, null, 1));
// ---------------- 2. the harness
const SUBS = [
  ['const ROOT = path.resolve(__dirname, "..");', `const ROOT = ${J(ROOT)}; const VAULT_DIR = ${J(VAULT)}; const AUD1 = ${J(AUD1)}; const AUD2 = ${J(AUD)};`],
  ['const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"] };',
   'const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"], vault: ["2026-01-01", "2026-11-01"] };'],
  ['const bt = readJSON("data/derived/backtest_dev.json");', 'const bt = readJSON(path.join(VAULT_DIR, "backtest_vault.json"));'],
  ['const fights = bt.fights.filter((f) => f.date < VAULT_FROM);', 'const fights = bt.fights.filter((f) => f.date >= VAULT_FROM && f.date < "2026-11-01");'],
  ['const CMP_STACKS = (dir, prefix) => { const P = prefix || (dir + "/cmp_stack_v501_fit"); return { "2019": P + "2020.json", "2020": P + "2020.json",\n  "2021": P + "2020.json", "2022": P + "2021.json", "2023": P + "2022.json", "2024": P + "2023.json", "2025": P + "2023.json" }; };',
   'const CMP_STACKS = (dir, prefix) => ({ "2026": path.join(AUD2, "cmp_stack_v4pkg_fit2025.json") });'],
  ['const priors = readJSON("data/derived/mlcal_priors_asof.json");', 'const priors = readJSON(path.join(AUD1, "priors_asof_vault.json"));'],
  ['const oofFor = (Ek) => readJSON(W.oof || (+String(Ek.VERSION).split(".")[0] >= 6 ? "data/derived/mlrates_oof_fh.json" : "data/derived/mlrates_oof.json"));',
   'const oofFor = (Ek) => readJSON(path.join(AUD1, "mlrates_vault.json"));'],
  ['const DURJ = useDur ? readJSON("data/derived/durability.json") : null;',
   'const DURJ = useDur ? readJSON(path.join(VAULT_DIR, "durability_vault.json")) : null; const DURN = useDur ? readJSON("data/derived/durability.json") : null;'],
  ['const durNorm = useDur ? { durability: { normChin: DURJ.engine.norm_chin_backtest_2019_2023, normPow: DURJ.engine.norm_pow_backtest_2019_2023 } } : null;',
   'const durNorm = useDur ? { durability: { normChin: DURN.engine.norm_chin_backtest_2019_2023, normPow: DURN.engine.norm_pow_backtest_2019_2023 } } : null;'],
  ['const SOSJ = useSOS ? readJSON("data/derived/sos_wf.json") : null;', 'const SOSJ = useSOS ? readJSON(path.join(AUD1, "sos_wf_vault.json")) : null;'],
  ['const XRS = PK.map((p, k) => (W.shared && k > 0) ? null : require(fs.existsSync(path.join(p.dir, "mlpathrec.js")) ? path.join(p.dir, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js"))(p.E, ROOT));',
   'const XRS = PK.map((p, k) => (W.shared && k > 0) ? null : require(path.join(ROOT, "tools/vault_audit2/mlpathrec_vault.js"))(p.E, ROOT));'],
  ['const PRs = PK.map((p) => require(path.join(ROOT, "tools/predictrec.js"))(p.E, ROOT, { stacks: CMP_STACKS(W.stackDir, W.cmpStacks), inSample: true,',
   'const PRs = PK.map((p) => require(path.join(ROOT, "tools/vault_audit2/predictrec_vault.js"))(p.E, ROOT, { vault: VAULT_DIR,'],
  ['const TGV10 = PK.some((p) => p.mode === "v10") ? readJSON("data/derived/v8/statlines_targets.json").fights : null;',
   'const TGV10 = PK.some((p) => p.mode === "v10") ? readJSON(path.join(AUD2, "statlines_targets_vault.json")).fights : null;'],
  ['if (d1 > VAULT_FROM) { console.error("predict_harness: the vault is sealed"); process.exit(2); }', '/* VAULT AUDIT 2: the vault is open for this audit */'],
  ['statlines_targets_sha256: PKGS.some((p) => p.mode === "v10") ? sha(path.join(ROOT, "data/derived/v8/statlines_targets.json")) : null,',
   'statlines_targets_sha256: PKGS.some((p) => p.mode === "v10") ? sha(path.join(AUD2, "statlines_targets_vault.json")) : null,'],
  ['market_sha256: sha(path.join(ROOT, "data/derived/market.json")),', 'market_sha256: sha(path.join(VAULT_DIR, "market_vault.json")),'],
];
let src = fs.readFileSync(path.join(ROOT, "tools/predict_harness.js"), "utf8");
for (const [a, b] of SUBS) {
  const n = src.split(a).length - 1;
  if (n !== 1) { console.error("harness_vault: substitution matched " + n + " times: " + a.slice(0, 110)); process.exit(2); }
  src = src.replace(a, () => b);
}
fs.mkdirSync(path.join(AUD, "gen"), { recursive: true });
const gen = path.join(AUD, "gen", "predict_harness_vault_gen.js");
fs.writeFileSync(gen, src);
console.log("harness_vault: tools/predict_harness.js sha256 " + sha(path.join(ROOT, "tools/predict_harness.js")).slice(0, 16) + ", " + SUBS.length +
  " substitutions -> " + gen + "; packages " + JSON.stringify(Object.fromEntries(Object.entries(manifest).map(([k, v]) => [k, v.frozen + " identical-except-blend " + v.copy_identical_except_blend]))));
const r = spawnSync(process.execPath, [gen, "--split", "vault"].concat(args), { stdio: "inherit", cwd: ROOT, env: process.env });
process.exit(r.status == null ? 1 : r.status);
