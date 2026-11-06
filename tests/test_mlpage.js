// Test for src/ml/mlpage.js: reproduces the Python answers stored in data/derived/ml.json page_model.test_vectors
// (stored to 4 decimals), with the full roster and with the compact columnar copy build.py inlines, and checks
// corner symmetry.   node tests/test_mlpage.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const MLPage = require(path.join(ROOT, "src/ml/mlpage.js"));
const ml = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/ml.json"), "utf8"));
const pm = ml.page_model;
let pass = 0, fail = 0;
function check(name, ok, info) { if (ok) pass++; else fail++; console.log((ok ? "PASS " : "FAIL ") + name + (info ? " (" + info + ")" : "")); }

// the same compact form build.py writes (mlpage_block)
const keys = new Set();
pm.winner.terms.forEach(t => ["key", "u", "v"].forEach(k => { if (t[k]) keys.add(t[k]); }));
["southpaw", "orthodox", "switch", "elo", "elo_sig", "years_ufc", "_dob", "_last_fight", "_prev_lbs", "_lbs_fought", "mr_mu", "mr_sd"].forEach(k => keys.add(k));
const K = [...keys].sort();
const compact = { snapshot: pm.snapshot, winner: { terms: pm.winner.terms, platt_slope: pm.winner.platt_slope }, stack: pm.stack, keys: K, roster: {} };
for (const s in ml.roster) compact.roster[s] = K.map(k => ml.roster[s][k] === undefined ? null : ml.roster[s][k]);

for (const [label, doc] of [["full roster", { snapshot: pm.snapshot, winner: pm.winner, stack: pm.stack, roster: ml.roster }], ["compact roster", compact]]) {
  const H = MLPage.load(doc);
  let worst = 0, sym = 0;
  for (const tv of pm.test_vectors) {
    const r = H.predict(tv.A, tv.B, tv.fight), s = H.predict(tv.B, tv.A, tv.fight);
    worst = Math.max(worst, Math.abs(r.pA - tv.pA), Math.abs(r.pLR - tv.p_lr_raw), Math.abs(r.pElo - tv.p_elo), Math.abs(r.pStack - tv.p_stack));
    sym = Math.max(sym, Math.abs(r.pA + s.pA - 1), Math.abs(r.pLR + s.pLR - 1));
  }
  check(label + ": matches the Python test vectors", worst < 6e-5, "max |diff| " + worst.toExponential(2) + " on " + pm.test_vectors.length + " vectors stored to 4 dp");
  check(label + ": corner symmetric", sym < 1e-12, "max |pA(A,B) + pA(B,A) - 1| " + sym.toExponential(2));
}
const H = MLPage.load(compact);
check("unknown fighter gives null", H.predict("alexander-volkanovski", "no-such-fighter", pm.test_vectors[0].fight) === null);
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
