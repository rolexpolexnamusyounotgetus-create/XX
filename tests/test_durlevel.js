/* v5.0.1 (v5 review): the computed chin / power fallback (engine3.js durSide, params.durability.fallbackEB) must run at the level
   of the record path the knockdown levels were matched on. Checks, with the engine's own constants (tools/durlevel_fit.js):
   - S path (decayed sums, 2019-2023 backtest sides vs their walk-forward records): geometric means of chin x pow within 2%;
   - C path (career sums, live roster vs the roster records): within 2%;
   - the engine's durSide reproduces the tool's computed values (matchup with no record, roster unloaded);
   - a backtest-style record with a missing field is labelled "partial", and a full record "record". */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const { fit } = require(path.join(ROOT, "tools/durlevel_fit.js"));
let pass = 0, fail = 0;
function check(name, ok, info) { if (ok) pass++; else fail++; console.log((ok ? "PASS  " : "FAIL  ") + name + (info ? "  (" + info + ")" : "")); }
const dp = E.params().durability;
const r = fit(E);
const sAfter = r.S.geo_computed_chin_x_pow_raw * dp.normComputedChinS * dp.normComputedPowS;
const cAfter = r.C.geo_computed_chin_x_pow_raw * dp.normComputedChin * dp.normComputedPow;
check("S path: computed chin x pow within 2% of the records (2019-2023 backtest sides)", Math.abs(Math.log(sAfter / r.S.geo_record_chin_x_pow)) < 0.02,
  "raw " + r.S.geo_computed_chin_x_pow_raw + ", re-levelled " + sAfter.toFixed(4) + ", records " + r.S.geo_record_chin_x_pow);
check("C path: computed chin x pow within 2% of the roster records (live roster)", Math.abs(Math.log(cAfter / r.C.geo_record_chin_x_pow)) < 0.02,
  "raw " + r.C.geo_computed_chin_x_pow_raw + ", re-levelled " + cAfter.toFixed(4) + ", roster " + r.C.geo_record_chin_x_pow);
check("params constants = the tool's fit", Math.abs(dp.normComputedChin - r.C.normComputedChin) < 1e-3 && Math.abs(dp.normComputedPow - r.C.normComputedPow) < 1e-3 &&
  Math.abs(dp.normComputedChinS - r.S.normComputedChinS) < 1e-3 && Math.abs(dp.normComputedPowS - r.S.normComputedPowS) < 1e-3);
// engine path: a production profile (C sums) with no record, roster unloaded
const db = E.loadDB(JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8")));
E.loadDurability(null);
const m = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, title: false, date: "2026-11-14" });
check("no record: both sides computed", m.dur.A.src === "computed" && m.dur.B.src === "computed");
const m0 = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, title: false, date: "2026-11-14",
  params: { durability: { normComputedChin: 1, normComputedPow: 1 } } });
check("the C-path constants multiply chin_re / pow_re exactly", Math.abs(m.dur.A.chin_re / m0.dur.A.chin_re - dp.normComputedChin) < 1e-12 && Math.abs(m.dur.B.pow_re / m0.dur.B.pow_re - dp.normComputedPow) < 1e-12);
const rec = { chin_re: 1.1, chin_cov: 0.9, pow_re: 0.95, pow_cov: 1.02 };
const mf = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, date: "2026-11-14", dur: { A: rec, B: Object.assign({}, rec, { pow_re: null }) } });
check("full record -> 'record', a missing field -> 'partial'", mf.dur.A.src === "record" && mf.dur.B.src === "partial", mf.dur.A.src + " / " + mf.dur.B.src);
const mb = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, date: "2026-11-14", dur: { A: rec, B: Object.assign({}, rec, { chin_re: "x", pow_cov: -1 }) } });
check("invalid fields ('x', -1) are missing, not NaN", mb.dur.B.src === "partial" && isFinite(mb.kd[0]) && isFinite(mb.kd[1]) && mb.kd[0] > 0, mb.kd.join(", "));
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
