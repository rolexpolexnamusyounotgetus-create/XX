// Compare the JS port against the Python results (200,000 fights per scenario).
const M = require("./engine_v1.js");

const PY = {
  baseline: [57.4, 41.8, 0.8],
  tax: [46.4, 52.7, 0.9],
  mileage: [67.9, 31.3, 0.7],
  wrestle: [66.8, 32.4, 0.7],
  prime: [66.6, 32.8, 0.7],
  power: [46.8, 52.6, 0.6],
  volume: [62.8, 36.3, 0.9],
};

const N = 200000;
let worst = 0;
for (const p of M.PRESETS) {
  const P = M.deriveParams(M.presetKnobs(p.id));
  const rng = M.makeRng(12345 + p.id.length * 7919);
  const b = new Array(7).fill(0);
  let dist = 0, distV = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const r = M.simulateFight(P, rng, false);
    const k = M.bucket(r);
    b[k]++;
    if (k >= 2 && k <= 4) { dist++; if (k === 2) distV++; }
  }
  const ms = Date.now() - t0;
  const pct = (x) => (100 * x / N);
  const v = pct(b[0] + b[1] + b[2]), g = pct(b[4] + b[5] + b[6]), d = pct(b[3]);
  const py = PY[p.id];
  const diff = Math.max(Math.abs(v - py[0]), Math.abs(g - py[1]));
  worst = Math.max(worst, diff);
  console.log(`${p.label.padEnd(22)} JS V ${v.toFixed(1)} G ${g.toFixed(1)} D ${d.toFixed(1)} | PY V ${py[0]} G ${py[1]} D ${py[2]} | diff ${diff.toFixed(2)} | ` +
    `VKO ${pct(b[0]).toFixed(1)} VSUB ${pct(b[1]).toFixed(1)} VDEC ${pct(b[2]).toFixed(1)} GDEC ${pct(b[4]).toFixed(1)} GSUB ${pct(b[5]).toFixed(1)} GKO ${pct(b[6]).toFixed(1)} | dist ${pct(dist).toFixed(1)} volk-on-cards ${(100 * distV / dist).toFixed(1)} | ${ms}ms`);
}
console.log("worst win% gap vs Python:", worst.toFixed(2), "points");

// Trace sanity: one fight with trace, check counts are consistent
const rng = M.makeRng(99);
const P = M.deriveParams(M.presetKnobs("baseline"));
for (let i = 0; i < 3; i++) {
  const r = M.simulateFight(P, rng, true);
  console.log(JSON.stringify({ w: r.winner, m: r.method, rd: r.round, t: +r.t.toFixed(2), cards: r.cards, rounds: r.rounds.map(x => ({ tdV: x.tdV, tdG: x.tdG, strV: x.strV, strG: x.strG, kdnV: x.kdnV, kdnG: x.kdnG, fin: x.finish || null, stop: x.stoppage || null })) }));
}
