// Node test: src/ml/embed.js reproduces tools/embed.py on the exported compact model.
//   node tests/test_embed.js            (reads data/derived/embed_model.json; EMBED_MODEL=path overrides)
// The model's `check` block holds Python outputs (tools/embed.py py_eval_compact on the rounded exported
// parameters) for named matchups and 25 random roster pairs; every number must match to 1e-9 (relative).
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const FightEmbed = require(path.join(__dirname, "..", "src", "ml", "embed.js"));

const file = process.env.EMBED_MODEL || path.join(__dirname, "..", "data", "derived", "embed_model.json");
const model = JSON.parse(fs.readFileSync(file, "utf8"));
const E = FightEmbed.load(model);
const ERA = (Date.UTC(2026, 0, 1) - Date.UTC(2015, 0, 1)) / 86400000 / 3652.5;

function close(a, b, what) {
  const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  assert.ok(Math.abs(a - b) <= tol, what + ": js " + a + " vs python " + b);
}

let n = 0, maxRel = 0;
for (const c of model.check) {
  const r = E.matchup(c.a, c.b, { division: c.division, rounds: c.rounds, era: ERA });
  const o = c.out;
  close(r.pA, o.pA, c.a + " v " + c.b + " pA");
  close(r.logit, o.logit, "logit");
  for (let t = 0; t < o.etaA.length; t++) {
    close(r.etaA[t], o.etaA[t], "etaA[" + model.tasks[t][0] + "]");
    close(r.etaB[t], o.etaB[t], "etaB[" + model.tasks[t][0] + "]");
  }
  for (const k of Object.keys(o.ratesA)) {
    close(r.ratesA[k], o.ratesA[k], "ratesA." + k);
    close(r.ratesB[k], o.ratesB[k], "ratesB." + k);
    maxRel = Math.max(maxRel, Math.abs(r.ratesA[k] - o.ratesA[k]) / Math.max(1e-12, Math.abs(o.ratesA[k])));
  }
  // antisymmetry of the win head: swapping corners gives 1 - p
  const s = E.matchup(c.b, c.a, { division: c.division, rounds: c.rounds, era: ERA });
  close(s.pA, 1 - r.pA, "swap symmetry");
  n++;
}
assert.ok(n >= 25, "expected at least 25 check cases, got " + n);

// unknown fighters fall back to the division-average zero vector; neighbours exclude the fighter himself
const z = E.matchup("no-such-fighter", "no-such-fighter-2", { division: "Lightweight", rounds: 3, era: ERA });
close(z.pA, 0.5, "zero vectors are a coin flip");
const nb = E.neighbours("alexander-volkanovski", 5);
assert.ok(nb.length === 5 && nb.every(x => x[0] !== "alexander-volkanovski"), "neighbours");
for (let i = 1; i < nb.length; i++) assert.ok(nb[i][1] >= nb[i - 1][1], "neighbours sorted");

// stat-line blend recipe: Python outputs on 12 real 2024-25 validation rows (mlrates side + embedding eta)
let nb2 = 0;
for (const c of model.blend_check || []) {
  const r = E.blendMLRates(c.ml, c.eta);
  for (const k of Object.keys(c.out)) close(r[k], c.out[k], "blend." + k);
  nb2++;
}
assert.ok(nb2 >= 10, "expected the blend check block");
// style neighbours match the Python twin (order and cosine)
for (const sl of Object.keys(model.nn_style_check || {})) {
  const want = model.nn_style_check[sl], got = E.styleNeighbours(sl, want.length);
  want.forEach((w, i) => { assert.strictEqual(got[i][0], w[0], sl + " style neighbour " + i); close(got[i][1], w[1], "cos"); });
}
assert.ok(Object.keys(model.nn_style_check || {}).length === 2, "style neighbour checks");

// real-pipeline tie (verification, Nov 6 2026): the exported 2019-2025 snapshot vectors and quarterly refits in
// embed.json, run through embed.js, reproduce the walk's own win logits (tools/embed.py build_table, unrounded) to
// the 4-decimal export rounding, and swapping corners negates them.
const full = path.join(__dirname, "..", "data", "derived", "embed.json");
let nSnap = 0, maxSnap = 0;
if (!process.env.EMBED_MODEL && fs.existsSync(full)) {
  const J = JSON.parse(fs.readFileSync(full, "utf8"));
  const byQ = {};
  for (const id of Object.keys(J.snapshots)) {
    const s = J.snapshots[id];
    if (s.win_logit == null) continue;
    let Eq = byQ[s.q];
    if (!Eq) {
      const q = J.quarters[s.q];
      Eq = byQ[s.q] = FightEmbed.load(Object.assign({}, model, { C: q.C, W: q.W, V: q.V, ua: q.ua, ud: q.ud, M: q.M }));
    }
    const z = Eq.winLogit(s.A, s.B);
    maxSnap = Math.max(maxSnap, Math.abs(z - s.win_logit));
    assert.ok(Math.abs(z + Eq.winLogit(s.B, s.A)) < 1e-12, "snapshot swap symmetry " + id);
    nSnap++;
  }
  assert.ok(nSnap >= 2800, "expected the 2019-2025 snapshots, got " + nSnap);
  assert.ok(maxSnap < 0.01, "snapshot win logits drift from the pipeline: max " + maxSnap);
}

const vg = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5 });
console.log("embed.js: %d check matchups reproduce the Python outputs (max rel. error on rates %s)", n,
            maxRel.toExponential(1));
console.log("Volkanovski vs Gaethje (embedding head only): P(Volkanovski) = %s; per-minute sig. landed %s vs %s, "
            + "takedowns landed %s vs %s", vg.pA.toFixed(3), vg.ratesA.sig_lnd.toFixed(2), vg.ratesB.sig_lnd.toFixed(2),
            vg.ratesA.td_lnd.toFixed(3), vg.ratesB.td_lnd.toFixed(3));
console.log("nearest to Volkanovski: " + nb.map(x => x[0] + " (" + x[1].toFixed(2) + ")").join(", "));
console.log("blendMLRates: %d validation rows reproduce the Python recipe", nb2);
if (nSnap) console.log("pipeline tie: %d backtest snapshots reproduce the walk's win logits (max abs diff %s, export rounding)",
                       nSnap, maxSnap.toExponential(1));
for (const sl of ["alexander-volkanovski", "justin-gaethje"])
  console.log("style twins of " + sl + ": " + E.styleNeighbours(sl, 5).map(x => x[0] + " (" + x[1].toFixed(2) + ")").join(", "));
console.log("OK");
