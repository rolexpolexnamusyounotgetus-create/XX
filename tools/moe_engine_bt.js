// Engine expert for the MoE stacker (tools/moe.py): runs FightEngine.summarize on every backtest_dev fight
// in both corner orders and stores the symmetrised win / 7-bin probabilities.
//
//   node tools/moe_engine_bt.js [--sims 100] [--part 0 --parts 2] [--out path]
//   node tools/moe_engine_bt.js --merge          # merge part files into data/derived/moe_engine_bt.json
//
// Sims are per orientation (default 100, so 200 per fight). Profiles are the frozen walk-forward snapshots;
// priors are the walk-forward division rates from out/moe_cache/priors_asof.json (python3 tools/moe.py prep),
// so no fight on or after Jan 1 of the entry's year leaks in. Only backtest_dev.json (fights before
// 2026-01-01) is read.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SIMS = +opt("--sims", 100), PART = +opt("--part", 0), PARTS = +opt("--parts", 1);
const CACHE = process.env.MOE_CACHE || path.join(ROOT, "out/moe_cache");
const OUT = opt("--out", path.join(ROOT, "data/derived/moe_engine_bt.json"));

function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16); }

if (args.includes("--merge")) {
  const parts = fs.readdirSync(CACHE).filter((f) => /^engine_part\d+of\d+\.json$/.test(f)).sort();
  const out = { meta: null, fights: {} };
  for (const f of parts) {
    const j = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf8"));
    out.meta = out.meta || j.meta;
    Object.assign(out.fights, j.fights);
  }
  out.meta.n = Object.keys(out.fights).length;
  out.meta.parts = parts;
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("merged", parts.length, "parts,", out.meta.n, "fights ->", OUT);
  process.exit(0);
}

const bt = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/backtest_dev.json"), "utf8"));
const priorsAsof = JSON.parse(fs.readFileSync(path.join(CACHE, "priors_asof.json"), "utf8"));
const keys = bt.meta.keys;
const fights = bt.fights.filter((f, i) => f.date < "2026-01-01" && i % PARTS === PART);
const res = {};
const t0 = Date.now();
let k = 0;
for (const f of fights) {
  const div = f.prior_division || f.division;
  const priors = priorsAsof[f.date.slice(0, 4)];
  const A = Object.assign({ keys }, f.A), B = Object.assign({ keys }, f.B);
  const o = { division: div, rounds: f.rounds, title: f.title, date: f.date, priors };
  let s1, s2;
  try {
    s1 = E.summarize(E.matchup(A, B, o), SIMS, seedOf(f.id, 1));
    s2 = E.summarize(E.matchup(B, A, o), SIMS, seedOf(f.id, 2));
  } catch (err) {
    res[f.id] = { err: String(err.message || err) };
    continue;
  }
  // symmetrise: bins are [A KO, A SUB, A DEC, DRAW, B DEC, B SUB, B KO]; the swapped run's bins reverse
  const bins = s1.bins.map((x, i) => 0.5 * (x + s2.bins[6 - i]));
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  res[f.id] = {
    pA: r4(0.5 * (s1.pA + s2.pB)), pB: r4(0.5 * (s1.pB + s2.pA)), pD: r4(0.5 * (s1.pD + s2.pD)),
    pA_ab: r4(s1.pA), pA_ba: r4(s2.pB), bins: bins.map(r4), fin: r4(0.5 * (s1.fins + s2.fins)),
    avgMin: r4(0.5 * (s1.avgMin + s2.avgMin)),
    sigA: r4(0.5 * (s1.avg.A.sig_lnd + s2.avg.B.sig_lnd)), sigB: r4(0.5 * (s1.avg.B.sig_lnd + s2.avg.A.sig_lnd)),
  };
  if (++k % 100 === 0) console.log(`part ${PART}/${PARTS}: ${k}/${fights.length} (${((Date.now() - t0) / k).toFixed(0)} ms/fight)`);
}
const meta = {
  tool: "tools/moe_engine_bt.js", engine_version: E.VERSION || null, sims_per_orientation: SIMS,
  params3_sha256_16: sha(path.join(ROOT, "src/params3.js")), engine3_sha256_16: sha(path.join(ROOT, "src/engine3.js")),
  built: new Date().toISOString(), priors: "out/moe_cache/priors_asof.json (walk-forward, 5-year window)",
  orientation: "pA = P(first-named fighter wins), averaged over the A-B and B-A runs (symmetric)",
};
const file = PARTS > 1 ? path.join(CACHE, `engine_part${PART}of${PARTS}.json`) : OUT;
fs.writeFileSync(file, JSON.stringify({ meta, fights: res }));
console.log(`done ${k} fights in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${file}`);
