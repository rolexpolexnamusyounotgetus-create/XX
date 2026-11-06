// Tests for the ML calibration harness (tools/mlcal.js): spec resolution, parameter trees, outcome bins,
// common-random-number determinism, rung accumulation, corner mirroring and the 2026 vault guard.
// Usage: node tests/test_mlcal.js      (about 20-40 CPU seconds; uses 12-24 train fights only)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const M = require("../tools/mlcal.js");

let pass = 0, fail = 0;
function check(name, ok, info) { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`); }
const close = (a, b, t = 1e-12) => Math.abs(a - b) <= t;

(async () => {
  // ---- spec resolution and trees on a synthetic parameter object
  const base = { version: "x", a: 2, b: { c: 0.5, d: [1, 2] }, div: { X: { ko: 1 }, Y: { ko: 2 } }, z: 0, neg: -1 };
  const dims = M.resolveSpec({ tune: [
    { path: "a", rel: 2 }, { path: "b.d.1", lo: 1, hi: 3 }, { path: "div.*.ko", rel: 1.5 },
    { name: "m", paths: ["b.c", "b.d.0"], lo: 0.5, hi: 2 }, { path: "neg" }, { path: "z", lo: -1, hi: 1 }
  ] }, base);
  const byName = Object.fromEntries(dims.map((d) => [d.name, d]));
  check("rel bounds are [v/rel, v*rel] on a log scale", close(byName.a.lo, 1) && close(byName.a.hi, 4) && byName.a.log);
  check("glob expands one dimension per match", byName["div.X.ko"] && byName["div.Y.ko"] && close(byName["div.Y.ko"].hi, 3));
  check("multiplier group", byName.m.kind === "mult" && byName.m.value === 1 && byName.m.paths.length === 2);
  check("negative value gets linear bounds around it", byName.neg.lo < -1 && byName.neg.hi > -1 && !byName.neg.log);
  check("zero needs explicit bounds and stays linear", byName.z.lo === -1 && !byName.z.log);
  let threw = false; try { M.resolveSpec({ tune: [{ path: "z" }] }, base); } catch (e) { threw = true; }
  check("zero without bounds is rejected", threw);
  threw = false; try { M.resolveSpec({ tune: [{ path: "nope" }] }, base); } catch (e) { threw = true; }
  check("unknown path is rejected", threw);
  const t = M.buildTree(base, dims, { a: 3, "div.Y.ko": 2.5, m: 2, neg: -1.5 });
  check("tree applies values, globs and multipliers", t.tree.a === 3 && t.tree.div.Y.ko === 2.5 && t.tree.b.c === 1 && t.tree.b.d[0] === 2 && t.tree.neg === -1.5);
  check("base object is not mutated", base.a === 2 && base.b.c === 0.5 && base.b.d[0] === 1);
  check("raw path overrides are accepted", M.buildTree(base, dims, { "b.d.1": 2.5 }).tree.b.d[1] === 2.5);

  // ---- outcome bins (data orientation)
  const rb = M.resultBin;
  check("bins: A KO, A sub, A dec, draw, B dec, B sub, B KO, DOC, NC/DQ excluded",
    rb({ winner: "A", method: "KO" }) === 0 && rb({ winner: "A", method: "SUB" }) === 1 && rb({ winner: "A", method: "SD" }) === 2 &&
    rb({ winner: "D", method: "DRAW" }) === 3 && rb({ winner: "B", method: "UD" }) === 4 && rb({ winner: "B", method: "SUB" }) === 5 &&
    rb({ winner: "B", method: "KO" }) === 6 && rb({ winner: "B", method: "DOC" }) === 6 && rb({ winner: "NC", method: "NC" }) === -1 &&
    rb({ winner: "A", method: "DQ" }) === -1);

  // ---- vault guard: a synthetic file with one fight moved to 2026 (copied from a 2019 dev fight)
  const dev = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/derived/backtest_dev.json"), "utf8"));
  const two = dev.fights.filter((f) => f.date < "2019-03-01" && M.resultBin(f.result) >= 0).slice(0, 2).map((f) => JSON.parse(JSON.stringify(f)));
  two[1].date = "2026-02-01"; two[1].id = "synthetic-2026";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mlcal-test-"));
  fs.writeFileSync(path.join(tmp, "bt.json"), JSON.stringify({ meta: dev.meta, fights: two }));
  const spec0 = M.loadSpec(path.join(__dirname, "../tools/mlcal_spec_engine3.json"));
  const L = M.loadFights(Object.assign({}, spec0, { backtest: path.join(tmp, "bt.json") }), { split: "dev" });
  check("fights dated 2026+ are dropped on load", L.vaultDropped === 1 && L.all.length === 1 && L.all[0].date < "2026-01-01");
  fs.rmSync(tmp, { recursive: true, force: true });
  const LT = M.loadFights(spec0, { split: "train", nFights: 50, offset: 0 }), LT2 = M.loadFights(spec0, { split: "train", nFights: 50, offset: 50 });
  const ids = new Set(LT.sample.map((f) => f.id));
  check("tuning and confirmation windows are disjoint", LT2.sample.every((f) => !ids.has(f.id)) && LT.sample.length === 50);
  check("train split stays in 2019-2023", LT.all.every((f) => f.date >= "2019-01-01" && f.date < "2024-01-01"));
  const LV = M.loadFights(spec0, { split: "val" });
  check("val split is 2024-01-01..2025-12-31", LV.all.every((f) => f.date >= "2024-01-01" && f.date < "2026-01-01") && LV.all.length > 800);
  check("7-bin smoothing prior is corner-symmetric and sums to 1", close(LT.pi7[0], LT.pi7[6]) && close(LT.pi7.reduce((s, x) => s + x, 0), 1, 1e-9));

  // ---- real engine: CRN determinism, accumulation, mirroring
  const S = new M.Session(spec0, 2);
  await S.setup({ split: "train", nFights: 12, offset: 0, seed: 7, mirror: "swap" });
  const x = { kdScale: 1.2, "form.out": 0.2 };
  const a = await S.evaluate({ key: "a", x, sims: 8, seedOff: 0 });
  const b = await S.evaluate({ key: "b", x, sims: 8, seedOff: 0 });
  check("same candidate, same seeds: identical objective (common random numbers)", a.objective === b.objective, a.objective.toFixed(6));
  const c = await S.evaluate({ key: "c", x: { kdScale: 1.6 }, sims: 8, seedOff: 0 });
  check("different candidate: different objective", c.objective !== a.objective);
  const a2 = await S.evaluate({ key: "a", x, sims: 8, seedOff: 1 });
  check("rungs accumulate sims (8 + 8 = 16 per fight)", a2.simsPerFight === 16 && a2.objective !== a.objective);
  const d1 = await S.evaluate({ key: "d", x, sims: 8, seedOff: 1, accumulate: false });
  check("seed offsets give fresh draws", d1.objective !== a.objective);
  check("no failed fights", a.nFailed === 0 && c.nFailed === 0);
  // mirroring: 'both' simulates each fight in both corner orders (2 tasks per fight)
  const info = await S.setup({ split: "train", nFights: 12, offset: 0, seed: 7, mirror: "both" });
  const m2 = await S.evaluate({ key: "m", x, sims: 8, seedOff: 0 });
  check("mirror both: two tasks per fight, sims add up", info.tasks === 24 && m2.simsPerFight === 16);
  check("winner log loss and 7-bin log loss are finite", isFinite(m2.winLL) && isFinite(m2.binLL) && m2.winLL > 0.3 && m2.winLL < 1.5);
  await S.close();

  // ---- fixed overrides, overrides relative to the pristine params file, hook plumbing
  const fx = M.resolveFixed({ kdScale: 1.5, "hook.w_acc": 0.2 });
  check("fixed splits engine values and hook values", fx.params.kdScale === 1.5 && fx.hook.w_acc === 0.2);
  const SF = new M.Session(Object.assign({}, spec0, { fixed: { kdScale: 1.5 } }), 1);
  const dk = SF.dims.find((d) => d.name === "kdScale");
  check("fixed value becomes the dimension's current value", dk.value === 1.5);
  check("overrides are reported against the pristine params file", SF.tree({}).overrides.kdScale === 1.5 && Object.keys(SF.tree({}).overrides).length === 1);
  const candFile = path.join(__dirname, "../data/derived/mlcal_candidates.json");
  if (fs.existsSync(candFile)) {
    const cand = JSON.parse(fs.readFileSync(candFile, "utf8"));
    const c1 = cand.candidates.find((c) => c.rank === 1);
    const SC = new M.Session(Object.assign({}, spec0, { fixed: "data/derived/mlcal_candidates.json#1" }), 1);
    const ov = SC.tree({}).overrides;
    check("fixed from candidates.json#rank reproduces that candidate's overrides",
      Object.keys(c1.overrides).every((k) => Math.abs(ov[k] - c1.overrides[k]) < 1e-12) && Object.keys(ov).length === Object.keys(c1.overrides).length);
  }
  const H = require("../tools/mlcal_hooks/elo_skill.js");
  const h1 = H.matchupOpts({}, { A: { elo: 1650 }, B: { elo: 1500 }, hookParams: { w_acc: 0.5, w_pow: 0.3, w_td: 0.2 } });
  const h2 = H.matchupOpts({}, { A: { elo: 1500 }, B: { elo: 1650 }, hookParams: { w_acc: 0.5, w_pow: 0.3, w_td: 0.2 } });
  check("elo hook is antisymmetric in the corners", ["acc", "pow", "chin", "tdDef"].every((k) => close(h1.adjA[k], h2.adjB[k]) && close(h1.adjB[k], h2.adjA[k])));
  const specH = M.loadSpec(path.join(__dirname, "../tools/mlcal_spec_engine3_elo.json"));
  const SH = new M.Session(specH, 2), SN = new M.Session(spec0, 2);
  await SH.setup({ split: "train", nFights: 12, offset: 0, seed: 7, mirror: "swap" });
  await SN.setup({ split: "train", nFights: 12, offset: 0, seed: 7, mirror: "swap" });
  const h0 = await SH.evaluate({ key: "h0", x: { "hook.w_acc": 0, "hook.w_pow": 0, "hook.w_td": 0 }, sims: 8 });
  const n0 = await SN.evaluate({ key: "n0", x: {}, sims: 8 });
  const hh = await SH.evaluate({ key: "hh", x: { "hook.w_acc": 1.0 }, sims: 8 });
  check("hook with zero weights reproduces the engine without the hook", h0.objective === n0.objective, h0.objective.toFixed(6));
  check("hook weights reach the engine", hh.objective !== h0.objective);
  await SH.close(); await SN.close();

  // review checks (Nov 6): unledgered validation scoring is refused; contaminated-baseline warning; fitted Elo slope
  const cp = require("child_process"), ROOTD = path.join(__dirname, "..");
  const ev = cp.spawnSync("node", [path.join(ROOTD, "tools/mlcal.js"), "eval", "--split", "val", "--n-fights", "5", "--sims", "2"], { cwd: ROOTD, encoding: "utf8" });
  check("eval --split val without --unledgered-val is refused (validation goes through the ledger)", ev.status !== 0 && /ledger/.test(ev.stderr));
  const tmpP = path.join(require("os").tmpdir(), "mlcal_selfcal_probe_" + process.pid + ".js");
  fs.writeFileSync(tmpP, "// x: 1, // [selfcal] probe\n");
  const py = cp.spawnSync("python3", ["-c", "import sys; sys.path.insert(0, 'tools'); import mlcal; " +
    "print(len(mlcal.baseline_warnings(sys.argv[1])), len(mlcal.baseline_warnings('data/derived/mlcal_params3_selfcal_pre2024.js')), round(mlcal.elo_slope_train(), 3))", tmpP],
    { cwd: ROOTD, encoding: "utf8" });
  fs.unlinkSync(tmpP);
  const pv = (py.stdout || "").trim().split(/\s+/).map(Number);
  check("baseline warning fires for all-years [selfcal] values and not for the pre-2024 rebuild", py.status === 0 && pv[0] === 1 && pv[1] === 0, (py.stderr || "").slice(-200));
  check("train-fitted Elo slope is finite and positive (no intercept, mirrored)", pv[2] > 0.5 && pv[2] < 5, String(pv[2]));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
