// Calibration and backtest harness for engine v2.
const E = require("../src/engine2.js");

function summarize(m, N, seed) {
  const rng = E.makeRng(seed);
  const b = new Array(7).fill(0);
  const S = { secs: 0, hA: 0, bA: 0, lA: 0, gA: 0, hB: 0, bB: 0, lB: 0, gB: 0, kdA: 0, kdB: 0, tdA: 0, tdB: 0, tdaA: 0, tdaB: 0, ctrlA: 0, ctrlB: 0, subA: 0, subB: 0 };
  const finR = [0, 0, 0, 0, 0];
  const meth = {};
  let dist = 0, distA = 0, cornerN = 0;
  for (let i = 0; i < N; i++) {
    const f = E.simulate(m, rng, false);
    const k = E.bucket(f);
    b[k]++;
    const T = f.totals;
    for (const key in T) if (key in S) S[key] += T[key];
    const done = f.method === "UD" || f.method === "SD" || f.method === "MD" || f.method === "DRAW";
    S.secs += done ? 1500 : (f.round - 1) * 300 + f.t;
    if (!done) finR[f.round - 1]++;
    else { dist++; if (f.winner === "A") distA++; }
    const key = f.winner + ":" + f.method;
    meth[key] = (meth[key] || 0) + 1;
    if (f.method === "CORNER") cornerN++;
  }
  const mins = S.secs / 60;
  const pct = (x) => +(100 * x / N).toFixed(1);
  return {
    A: pct(b[0] + b[1] + b[2]), B: pct(b[4] + b[5] + b[6]), D: pct(b[3]),
    bins: b.map(pct), dist: pct(dist), distA: +(100 * distA / Math.max(1, dist)).toFixed(1),
    finR: finR.map(pct), corner: pct(cornerN),
    slpmA: +((S.hA + S.bA + S.lA + S.gA) / mins).toFixed(2), slpmB: +((S.hB + S.bB + S.lB + S.gB) / mins).toFixed(2),
    tgtA: [S.hA, S.bA, S.lA, S.gA].map((x) => +(100 * x / (S.hA + S.bA + S.lA + S.gA)).toFixed(0)),
    tgtB: [S.hB, S.bB, S.lB, S.gB].map((x) => +(100 * x / (S.hB + S.bB + S.lB + S.gB)).toFixed(0)),
    kd15A: +(S.kdA / mins * 15).toFixed(2), kd15B: +(S.kdB / mins * 15).toFixed(2),
    td15A: +(S.tdA / mins * 15).toFixed(2), td15B: +(S.tdB / mins * 15).toFixed(2),
    tdAccA: +(S.tdA / Math.max(1, S.tdaA)).toFixed(2), tdAccB: +(S.tdB / Math.max(1, S.tdaB)).toFixed(2),
    ctrlPer15A: +(S.ctrlA / mins * 15).toFixed(0), ctrlPer15B: +(S.ctrlB / mins * 15).toFixed(0),
    avgMin: +(mins / N).toFixed(1), meth
  };
}

const N = +(process.argv[2] || 40000);
const t0 = Date.now();
console.log("=== Volk (A) vs Gaethje (B), presets ===");
for (const p of E.PRESETS) {
  const r = summarize(E.volkGaethje(E.presetKnobs(p.id)), N, 777 + p.id.length);
  console.log(`${p.label.padEnd(22)} V ${r.A} G ${r.B} D ${r.D} | bins ${r.bins.join(" ")} | dist ${r.dist} (Volk ${r.distA}) | finR ${r.finR.join(" ")} | corner ${r.corner}`);
  if (p.id === "baseline") {
    console.log("   slpm V", r.slpmA, "G", r.slpmB, "| tgt V", r.tgtA.join("/"), "G", r.tgtB.join("/"), "| kd15 V", r.kd15A, "G", r.kd15B,
      "| td15 V", r.td15A, "acc", r.tdAccA, "G", r.td15B, "acc", r.tdAccB, "| ctrl s/15 V", r.ctrlPer15A, "G", r.ctrlPer15B, "| avg min", r.avgMin);
    console.log("   methods", JSON.stringify(r.meth));
  }
}

// ---- Backtests: real fights, both men's UFC career rates (note: in-sample, the careers include these fights) ----
const F = E.fighter;
const LOPES = F({ name: "Lopes", mins: 117, slpm: 3.94, sapm: 4.68, acc: 0.47, def: 0.47, kd15: 0.77, td15: 0.9, tdAcc: 0.47, tdDef: 0.74, sub15: 1.02 });
const PIMBLETT = F({ name: "Pimblett", mins: 88, slpm: 5.48, sapm: 3.86, acc: 0.53, def: 0.43, kd15: 0.34, td15: 0.68, tdAcc: 0.21, tdDef: 0.46, sub15: 1.36 });
const TOPURIA = F({ name: "Topuria", mins: 104, slpm: 4.82, sapm: 3.97, acc: 0.50, def: 0.62, kd15: 1.15, td15: 1.73, tdAcc: 0.57, tdDef: 0.95, sub15: 0.86 });
const HOLLOWAY = F({ name: "Holloway", mins: 534, slpm: 6.92, sapm: 4.60, acc: 0.48, def: 0.59, kd15: 0.34, td15: 0.22, tdAcc: 0.53, tdDef: 0.81, sub15: 0.28 });
const EVLOEV = F({ name: "Evloev", mins: 160, slpm: 3.91, sapm: 2.80, acc: 0.47, def: 0.61, kd15: 0.15, td15: 4.78, tdAcc: 0.52, tdDef: 0.70, sub15: 0.2 });
const V = E.VOLK, G = E.GAETHJE;
for (const x of [V, G, LOPES, PIMBLETT, TOPURIA, HOLLOWAY, EVLOEV]) console.log("kd/head", x.name, E.kdPerHead(x).toFixed(4));
const BT = [
  { name: "Volkanovski vs Lopes 2 (UFC 325)", A: V, B: LOPES, mins: 25, slA: 98, slB: 70, winner: "A", cat: "DEC" },
  { name: "Gaethje vs Pimblett (UFC 324)", A: G, B: PIMBLETT, mins: 25, slA: 144, slB: 156, winner: "A", cat: "DEC" },
  { name: "Gaethje vs Topuria (Freedom 250)", A: G, B: TOPURIA, mins: 20, slA: 91, slB: 97, winner: "A", cat: "KO" },
  { name: "Gaethje vs Holloway (UFC 300)", A: G, B: HOLLOWAY, mins: 24.98, slA: 103, slB: 181, winner: "B", cat: "KO" },
  { name: "Volkanovski vs Topuria (UFC 298)", A: V, B: TOPURIA, mins: 8.53, winner: "B", cat: "KO" },
  { name: "Volkanovski vs Evloev (UFC 333)", A: V, B: EVLOEV, mins: 9.9, winner: "A", cat: "KO" },
  { name: "Volkanovski vs Lopes 1 (UFC 314)", A: V, B: LOPES, mins: 25, winner: "A", cat: "DEC" }
];
console.log("\n=== Backtests (N per fight", N, ") ===");
let brier = 0, ll = 0, errs = [], hits = 0;
for (const bt of BT) {
  const m = E.matchup(bt.A, bt.B, {});
  const r = summarize(m, N, 4242);
  const pW = bt.winner === "A" ? r.A / 100 : r.B / 100;
  const binIdx = bt.winner === "A" ? { KO: 0, SUB: 1, DEC: 2 }[bt.cat] : { KO: 6, SUB: 5, DEC: 4 }[bt.cat];
  brier += (1 - pW) * (1 - pW); ll += -Math.log(Math.max(1e-6, pW)); if (pW > 0.5) hits++;
  let rateTxt = "";
  if (bt.slA != null) {
    const aA = bt.slA / bt.mins, aB = bt.slB / bt.mins;
    errs.push((r.slpmA - aA) / aA, (r.slpmB - aB) / aB);
    rateTxt = ` | landed/min model ${r.slpmA}-${r.slpmB} actual ${aA.toFixed(2)}-${aB.toFixed(2)}`;
  }
  console.log(`${bt.name.padEnd(36)} P(actual winner) ${(100 * pW).toFixed(1)} | P(actual result) ${r.bins[binIdx]} | A ${r.A} B ${r.B} | dist ${r.dist} | kd15 ${r.kd15A}-${r.kd15B}${rateTxt}`);
}
const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length), bias = errs.reduce((s, e) => s + e, 0) / errs.length;
console.log(`winner hits ${hits}/${BT.length} | Brier ${(brier / BT.length).toFixed(3)} | log loss ${(ll / BT.length).toFixed(3)} | landing-rate RMS err ${(100 * rms).toFixed(0)}% bias ${(100 * bias).toFixed(0)}%`);
console.log("elapsed", Date.now() - t0, "ms");

// Trace sanity
const rng = E.makeRng(5);
const f = E.simulate(E.volkGaethje(E.presetKnobs("baseline")), rng, true);
console.log("\ntrace:", f.winner, f.method, "R" + f.round, f.t.toFixed(1), "cards", JSON.stringify(f.cards));
for (const rd of f.rounds) {
  const kinds = {};
  rd.ev.forEach((e) => { kinds[e.k] = (kinds[e.k] || 0) + 1; });
  console.log(" R" + (rd.r + 1), JSON.stringify(kinds), "judges", JSON.stringify(rd.judges || null), "st", JSON.stringify(rd.st));
}
