#!/usr/bin/env node
/* Train-only ablation of the styles_sos component (src/styles_sos.js) on backtest_dev fights 2019-01-01..2023-12-31.

     node tools/styles_sos_ablate.js <priors_asof.json> <out.json> [--sims 400] [--part 0 --parts 1]
                                     [--ml oof|off] [--configs off,styles,sos,both,styles_fit]

   For every fight and configuration: FightEngine.summarize in both corner orders (A-B and B-A) with the same seeds in
   every configuration (common random numbers: the seed depends only on the fight id and the orientation), symmetrised
   back to the A-first orientation. Inputs are leak-free: profiles are the frozen pre-fight snapshots of
   backtest_dev.json with priors_asof of the fight year (years <= 2023 only); learned rates (--ml oof) are the
   out-of-fold rates of data/derived/mlrates_oof.json (time-ordered CV folds, never trained on the fight's year);
   style vectors are computed in-engine from the snapshot sums; strength of schedule comes from the walk-forward
   data/derived/sos_wf.json with leave-one-year-out coefficients (meta.coef_loyo[path][year]). Fights dated 2024-01-01
   or later are refused (validation years and the vault are never scored here).

   Output: { meta, rows: { id: { cfg: { pA, pB, pD, bins[7], finR[nR], koR[nR], subR[nR], dist, dec{UD,SD,MD,DRAW},
            avgMin, rA{...per minute}, rB{...} } } } } */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const E = require(path.join(ROOT, "src", "engine3.js"));

function arg(name, dflt) { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : dflt; }
function devPath(name) {
  const p = path.join(ROOT, "data", "derived", name);
  return fs.existsSync(p) ? p : path.join("/home/user/XX/data/derived", name);
}
const PA = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const OUT = process.argv[3];
const SIMS = +arg("sims", 400), PART = +arg("part", 0), PARTS = +arg("parts", 1), MLMODE = arg("ml", "oof");
const CONFIGS = arg("configs", "off,styles,sos,both,styles_fit").split(",");
const FROM = arg("from", "2019-01-01"), TO = arg("to", "2024-01-01");
if (TO > "2024-01-01") throw new Error("styles_sos_ablate: train-only tool, --to must be <= 2024-01-01");

const BT = JSON.parse(fs.readFileSync(devPath("backtest_dev.json"), "utf8"));
const OOF = JSON.parse(fs.readFileSync(devPath("mlrates_oof.json"), "utf8"));
const SOS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "sos_wf.json"), "utf8"));
const keys = BT.meta.keys, names = OOF.meta.targets;
const OA = CONFIGS.indexOf("oppadj") >= 0 ? JSON.parse(fs.readFileSync(devPath("oppadj.json"), "utf8")).snapshots : null;
const ob = (a) => { const x = {}; names.forEach((n, i) => { x[n] = a[i]; }); return x; };

function cfgParams(cfg, year) {
  const loyo = SOS.meta.coef_loyo;
  const sosCoef = { ml: loyo.ml[year], base: loyo.base[year] };
  switch (cfg) {
    case "off": return { components: { styles_sos: false } };
    case "styles": return { components: { styles_sos: { styles: true, sos: false } }, stylesSOS: { styleBlocks: "all", styleSet: "ab1" } };
    case "styles_fit": return { components: { styles_sos: { styles: true, sos: false } }, stylesSOS: { styleBlocks: "all", styleSet: "fit" } };
    case "sos": return { components: { styles_sos: { styles: false, sos: true } }, stylesSOS: { sosCoef } };
    case "both": return { components: { styles_sos: { styles: true, sos: true } }, stylesSOS: { sosCoef, styleBlocks: "all", styleSet: "ab1" } };
    case "both_fit": return { components: { styles_sos: { styles: true, sos: true } }, stylesSOS: { sosCoef, styleBlocks: "all", styleSet: "fit" } };
    // blocks kept by the 2019-2023 rate-level check (tools/styles_sos_ratecheck.py): learned rates gnp_att only; base tables
    // dist_att, td_att, gnp_att (ctrl_per_td worsens control deviance on both paths)
    case "oppadj": return { components: { styles_sos: { styles: false, sos: true } }, stylesSOS: { sosSource: "oppadj" } };
    case "styles_sel": return { components: { styles_sos: { styles: true, sos: false } }, stylesSOS: { styleBlocks: SEL, styleSet: "ab1" } };
    case "both_sel": return { components: { styles_sos: { styles: true, sos: true } }, stylesSOS: { sosCoef, styleBlocks: SEL, styleSet: "ab1" } };
    default: throw new Error("unknown config " + cfg);
  }
}
const SEL = { ml: ["gnp_att"], base: ["dist_att", "td_att", "gnp_att"] };
function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }
const STATS = ["sig_att", "sig_lnd", "h_lnd", "b_lnd", "l_lnd", "d_att", "kd", "td_att", "td_lnd", "ctrl", "sub_att"];
const r5 = (x) => Math.round(x * 1e5) / 1e5;

const F = BT.fights.filter((f) => f.date >= FROM && f.date < TO);
const rows = {};
const t0 = Date.now();
let k = 0, noML = 0;
F.forEach(function (f, idx) {
  if (idx % PARTS !== PART) return;
  if (f.date >= "2024-01-01") throw new Error("refusing a 2024+ fight: " + f.id);
  const year = f.date.slice(0, 4);
  const pr = OOF.fights[f.id], so = SOS.fights[f.id];
  if (MLMODE === "oof" && !pr) noML++;
  const base = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: PA[year] };
  const out = {};
  for (const cfg of CONFIGS) {
    const params = cfgParams(cfg, year);
    const res = [];
    for (let o = 0; o < 2; o++) {
      const X = o === 0 ? f.A : f.B, Y = o === 0 ? f.B : f.A;
      const pX = Object.assign({ keys }, X), pY = Object.assign({ keys }, Y);
      if (OA && OA[f.id]) { pX.oppadj = OA[f.id][o === 0 ? "A" : "B"]; pY.oppadj = OA[f.id][o === 0 ? "B" : "A"]; }   // pre-fight factors
      const opts = Object.assign({}, base, { params: params });
      opts.ml = MLMODE === "oof" && pr ? (o === 0 ? { A: ob(pr.A), B: ob(pr.B) } : { A: ob(pr.B), B: ob(pr.A) }) : false;
      if (so) opts.sos = o === 0 ? { A: so.A, B: so.B } : { A: so.B, B: so.A };
      const m = E.matchup(pX, pY, opts);
      res.push(E.summarize(m, SIMS, seedOf(f.id, o)));
    }
    const s1 = res[0], s2 = res[1], nR = f.rounds;
    const rate = (a, b) => { const o2 = {}; for (const st of STATS) o2[st] = r5(0.5 * (a.per15[st] + b.per15[st]) / 15); return o2; };
    const fin = (a1, b2) => { const o2 = []; for (let r = 0; r < nR; r++) o2.push(r5(0.5 * (a1[r] + b2[r]))); return o2; };
    out[cfg] = {
      pA: r5(0.5 * (s1.pA + s2.pB)), pB: r5(0.5 * (s1.pB + s2.pA)), pD: r5(0.5 * (s1.pD + s2.pD)),
      bins: s1.bins.map((x, i) => r5(0.5 * (x + s2.bins[6 - i]))),
      finA: fin(s1.finA, s2.finB), finB: fin(s1.finB, s2.finA),
      finKO: fin(s1.finKO, s2.finKO), finSUB: fin(s1.finSUB, s2.finSUB),
      dist: r5(0.5 * (s1.dist + s2.dist)),
      dec: { UD: r5(0.5 * (s1.dec.UD + s2.dec.UD)), SD: r5(0.5 * (s1.dec.SD + s2.dec.SD)), MD: r5(0.5 * (s1.dec.MD + s2.dec.MD)) },
      avgMin: r5(0.5 * (s1.avgMin + s2.avgMin)),
      rA: rate(s1.avg.A, s2.avg.B), rB: rate(s1.avg.B, s2.avg.A),
      accA: r5(0.5 * (s1.avg.A.acc + s2.avg.B.acc)), accB: r5(0.5 * (s1.avg.B.acc + s2.avg.A.acc)),
      tdAccA: r5(0.5 * (s1.avg.A.tdAcc + s2.avg.B.tdAcc)), tdAccB: r5(0.5 * (s1.avg.B.tdAcc + s2.avg.A.tdAcc))
    };
  }
  rows[f.id] = out;
  if (++k % 100 === 0) console.error("part " + PART + "/" + PARTS + ": " + k + " fights, " + ((Date.now() - t0) / k).toFixed(0) + " ms/fight");
});
fs.writeFileSync(OUT, JSON.stringify({
  meta: { engine: E.VERSION, sims_per_orientation: SIMS, ml: MLMODE, configs: CONFIGS, from: FROM, to: TO, part: PART,
    parts: PARTS, n: k, fights_without_oof: noML, built: new Date().toISOString() },
  rows: rows
}));
console.log("styles_sos ablation part " + PART + "/" + PARTS + ": " + k + " fights x " + CONFIGS.length + " configs x 2 orientations x " +
  SIMS + " sims in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
