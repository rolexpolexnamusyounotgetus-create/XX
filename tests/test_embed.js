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

const vg = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5 });
console.log("embed.js: %d check matchups reproduce the Python outputs (max rel. error on rates %s)", n,
            maxRel.toExponential(1));
console.log("Volkanovski vs Gaethje (embedding head only): P(Volkanovski) = %s; per-minute sig. landed %s vs %s, "
            + "takedowns landed %s vs %s", vg.pA.toFixed(3), vg.ratesA.sig_lnd.toFixed(2), vg.ratesB.sig_lnd.toFixed(2),
            vg.ratesA.td_lnd.toFixed(3), vg.ratesB.td_lnd.toFixed(3));
console.log("nearest to Volkanovski: " + nb.map(x => x[0] + " (" + x[1].toFixed(2) + ")").join(", "));
console.log("OK");
