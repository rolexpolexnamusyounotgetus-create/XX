#!/usr/bin/env node
/* statlines_matchup.js: distributional stat lines for a roster matchup through the production chain
   (MLRates prod model -> FightEmbed roster vectors -> oppadj roster factors -> StatDist prod tables).

     node tools/statlines_matchup.js alexander-volkanovski justin-gaethje [--rounds 5] [--division Lightweight]
                                     [--pdec 0.55] [--which prod|dev]

   Prints each man's P10 / P50 / P90 and mean for every stat, (a) if the fight goes the distance and (b) mixed over a
   simple fight-length grid (P(decision) --pdec, finishes spread over the rounds with a fixed declining profile).
   Descriptive only: live roster profiles include 2026 fights, so nothing here is ever scored. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));
const FE = require(path.join(ROOT, "src", "ml", "embed.js"));
const SDm = require(path.join(ROOT, "src", "ml", "statdist.js"));
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const [a, b] = argv.filter((x, i) => !x.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
if (!a || !b) { console.error("usage: node tools/statlines_matchup.js <slugA> <slugB> [--rounds 5]"); process.exit(2); }
const rounds = +opt("rounds", 5), division = opt("division", "Lightweight"), pdec = +opt("pdec", 0.55);
const which = opt("which", "prod");

const F = rd("data/derived/fighters.json");
const pa = F.fighters[a], pb = F.fighters[b];
if (!pa || !pb) { console.error("unknown slug"); process.exit(2); }
pa.keys = F.meta.keys; pb.keys = F.meta.keys;
const model = ML.load(rd(which === "dev" ? "data/derived/mlrates_dev.json" : "data/derived/mlrates.json"));
const ctx = { division, rounds, title: rounds === 5, year: 2026, priors: F.priors };
const pr = ML.predict(model, pa, pb, ctx);
const E = FE.load(rd("data/derived/embed_model.json"));
const em = E.matchup(a, b, { division, rounds });
const hasEmb = (E.embedding(a).expo || 0) > 0 && (E.embedding(b).expo || 0) > 0;
const OA = rd("data/derived/oppadj.json").roster;
const SD = SDm.load(rd("data/derived/statlines.json"), { which });
const P = SD.prepare({ mlA: pr.A, mlB: pr.B, etaA: em.etaA, etaB: em.etaB, hasEmb, winLogit: em.logit,
  oppA: OA[a] || null, oppB: OA[b] || null, rounds });
const prof = rounds === 5 ? [0.30, 0.24, 0.18, 0.15, 0.13] : [0.45, 0.33, 0.22];
const grid = SD.lengthGridSimple(pdec, prof.map((x) => x * (1 - pdec)));
const full = 5 * rounds;
const L = { A: { dist: P.line("A", full), mix: P.line("A", grid) }, B: { dist: P.line("B", full), mix: P.line("B", grid) } };
console.log(`${a} (A) vs ${b} (B), ${division}, ${rounds} rounds; statlines ${which} tables; embedding win logit ` +
  `${em.logit.toFixed(3)}; P(decision) ${pdec} for the mixture`);
const f = (v) => `${String(v.p10).padStart(4)} ${String(v.p50).padStart(4)} ${String(v.p90).padStart(4)} (${v.mean.toFixed(1).padStart(6)})`;
console.log("stat        | A goes the distance P10 P50 P90 (mean) | A mixed          | B goes the distance | B mixed");
for (const st of SD.stats) {
  console.log(`${st.padEnd(11)} | ${f(L.A.dist[st])} | ${f(L.A.mix[st])} | ${f(L.B.dist[st])} | ${f(L.B.mix[st])}`);
}
