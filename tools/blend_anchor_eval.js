#!/usr/bin/env node
/* blend_anchor component: train-only ablation on 2019-2023 (flag on vs off), recalibration scheme choice, method/round
   pool weight, anchor-mode and interval checks.

   node tools/blend_anchor_eval.js targets            # out-of-fold blend P(A) per fight -> out/blend_anchor/targets.json
   node tools/blend_anchor_eval.js report [--boot 2000] [--noanchor]
        -> data/derived/blend_anchor.json (fitted settings + ablation numbers) and out/blend_anchor/report.md

   Inputs (all leak-free, 2019-01-01..2023-12-31 only; nothing from 2024 on is read into any fit or score):
     data/derived/blend_anchor_dev.json   feat_lr (expanding-window OOF), Elo, Glicko RD, per-year LR coefficients
     data/derived/ml.json fights          tools/ml.py `lr` (marked oof for 2019-2023) and strike-share Elo
     data/derived/market.json fights      closing line (p_power_close) and the walk-forward market rating
     data/derived/methodround.json        S / SM cells (2019-2023 out-of-fold: fit through Dec 31 of the previous year)
     data/derived/mlrates_oof.json        learned per-minute rates (each year from a model trained on earlier years)
     out/blend_anchor/plain.json, anchor.json   tools/blend_anchor_bt.js simulator runs (both corner orders, CRN)
     backtest_dev.json (BACKTEST_DEV)     outcomes, stats, events (event = bootstrap cluster)

   Protocol: every model is corner-symmetric (stackers have no intercept and act on logits; cells are averaged over both
   corner orders), so scores are the same in either orientation. Anything fitted is cross-fitted: leave-one-year-out
   (LOYO) inside 2019-2023 for the main table, forward-chained (train on years before the test year) for the
   recalibration choice and the forward table. CIs: paired event-cluster bootstrap. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FB = require(path.join(ROOT, "src/ml/blend.js"));
const MoE = require(path.join(ROOT, "src/ml/moe.js"));

const args = process.argv.slice(2), mode = args[0] || "report";
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUTDIR = process.env.BLEND_ANCHOR_OUT || path.join(ROOT, "out/blend_anchor");
const BT = process.env.BACKTEST_DEV || path.join(ROOT, "data/derived/backtest_dev.json");
const NBOOT = +opt("--boot", 2000);
const PCLIP = 0.01;
const YEARS = [2019, 2020, 2021, 2022, 2023];
const NOLINE = ["mkt_rating", "ml", "feat_lr", "engine", "elo_sig", "elo"];
const LINE = ["market"].concat(NOLINE);
function J(f) { return JSON.parse(fs.readFileSync(f, "utf8")); }
const D = (f) => path.join(ROOT, "data/derived", f);
const logit = (p) => Math.log(Math.min(Math.max(p, 1e-9), 1 - 1e-9) / (1 - Math.min(Math.max(p, 1e-9), 1 - 1e-9)));
const sigm = (z) => 1 / (1 + Math.exp(-z));
const lcl = (p) => logit(Math.min(Math.max(p, PCLIP), 1 - PCLIP));
const isNum = (x) => typeof x === "number" && isFinite(x);
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const f4 = (x) => (x == null || !isFinite(x)) ? "-" : x.toFixed(4);

// ------------------------------------------------------------------ data
const dev = J(D("blend_anchor_dev.json"));
const bt = J(BT);
const mlj = J(D("ml.json")).fights, mkt = J(D("market.json")).fights, mr = J(D("methodround.json")).fights;
const OOF = J(D("mlrates_oof.json")), TN = OOF.meta.targets;
const plainF = fs.existsSync(path.join(OUTDIR, "plain.json")) ? J(path.join(OUTDIR, "plain.json")) : null;
if (!plainF) { console.error("run tools/blend_anchor_bt.js sim --stage plain first"); process.exit(1); }
const ANAME = opt("--anchor", "anchor"), TAG = opt("--tag", "");     // --anchor anchor_v1 --tag v1: score a channel-mix variant
const anchorF = !args.includes("--noanchor") && fs.existsSync(path.join(OUTDIR, ANAME + ".json")) ? J(path.join(OUTDIR, ANAME + ".json")) : null;
const SKI = {}; FB.SK.forEach((k, i) => { SKI[k] = i; });

function cellObs(res, R) {
  const w = res.winner, m = res.method;
  if (m === "DRAW" || w === "D") return 4 * R + 2;
  if (w !== "A" && w !== "B") return -1;
  if (m === "UD" || m === "SD" || m === "MD") return w === "A" ? 4 * R : 4 * R + 1;
  const r = Math.min(Math.max(res.round || 1, 1), R) - 1;
  if (m === "SUB") return (w === "A" ? R : 3 * R) + r;
  if (m === "KO" || m === "TKO" || m === "DOC" || m === "CORNER") return (w === "A" ? 0 : 2 * R) + r;
  return -1;                                    // DQ, NC, overturned: excluded (methodround.py)
}
// Finite-sim cells get Jeffreys smoothing, (n_c + 0.5) / (N + 0.5 K), as FightEngine.predict does (params.blend.smooth):
// with 400 simulated fights an outcome the sims never produced (one 2019-2023 draw) would otherwise score -log(1e-9).
// The raw cells stay in cellsRaw ("off_raw" rows).
const SMOOTH = +opt("--smooth", 0.5);
function smoothRec(s) {
  if (!s || !s.cellN) return s;
  const o = Object.assign({}, s), N = s.cellN.reduce((a, b) => a + b, 0), K = s.cellN.length;
  o.cellsRaw = s.cells;
  o.cells = SMOOTH > 0 && N > 0 ? s.cellN.map((n) => (n + SMOOTH) / (N + SMOOTH * K)) : s.cells;
  return o;
}
const fights = [];
for (const f of bt.fights) {
  if (!(f.date >= "2019-01-01" && f.date <= "2023-12-31")) continue;
  const d = dev.fights[f.id], s = smoothRec(plainF.fights[f.id]);
  if (!d || !s || s.err) continue;
  const R = f.rounds, yr = +f.date.slice(0, 4), ml = mlj[f.id] || {}, mk = mkt[f.id] || {};
  const ex = {
    engine: s.p, feat_lr: d.feat_lr, elo: d.elo,
    ml: ml.set === "oof" && isNum(ml.lr) ? ml.lr : null, elo_sig: ml.set === "oof" && isNum(ml.elo_sig) ? ml.elo_sig : null,
    mkt_rating: isNum(mk.p_market_rating) ? mk.p_market_rating : null, market: isNum(mk.p_power_close) ? mk.p_power_close : null
  };
  if (!isNum(ex.ml) || !isNum(ex.elo_sig)) { ex.ml = null; ex.elo_sig = null; }      // the MoE optional group: both or none
  const obs = cellObs(f.result, R);
  const y = f.result.winner === "A" ? 1 : (f.result.winner === "B" ? 0 : null);
  const mrc = mr[f.id] || {};
  fights.push({ id: f.id, date: f.date, yr, ev: f.event, R, rounds: R, division: f.division, obs, y: obs >= 0 && obs !== 4 * R + 2 ? y : null,
    ex, plain: s, anchor: anchorF && anchorF.fights[f.id] && !anchorF.fights[f.id].err ? smoothRec(anchorF.fights[f.id]) : null,
    S: mrc.S && mrc.S.length === 4 * R + 3 ? mrc.S : null, SM: mrc.SM && mrc.SM.length === 4 * R + 3 ? mrc.SM : null,
    actual: f.actual, minutes: f.actual && f.actual.minutes, mlr: OOF.fights[f.id] || null, prof: { A: f.A, B: f.B }, rdA: d.rdA, rdB: d.rdB });
}
console.log("fights 2019-2023 with sims:", fights.length, "decisive:", fights.filter((f) => f.y != null).length,
  "scored (excl. DQ/NC):", fights.filter((f) => f.obs >= 0).length);

// ------------------------------------------------------------------ stacker fits (cross-fitted)
function avail(f, set) { return set.filter((k) => isNum(f.ex[k])); }
const fitCache = {};
function fitPattern(train, pat, wtFn, l2) {
  const X = [], y = [], w = [];
  for (const f of train) {
    if (f.y == null) continue;
    if (!pat.every((k) => isNum(f.ex[k]))) continue;
    X.push(pat.map((k) => lcl(f.ex[k]))); y.push(f.y); w.push(wtFn ? wtFn(f) : 1);
  }
  const b = FB.nnLogit(X, y, w, l2 == null ? 1e-3 : l2);
  const o = {}; pat.forEach((k, i) => { o[k] = b[i]; });
  return { w: o, n: X.length };
}
function stackZ(fit, f) { let z = 0; for (const k in fit.w) z += fit.w[k] * lcl(f.ex[k]); return z; }
/** z for fight f from a stacker trained on `train` (all experts of the regime available to f). */
function stackFor(key, train, f, set, wtFn) {
  const pat = avail(f, set), ck = key + "|" + pat.join("+");
  if (!fitCache[ck]) fitCache[ck] = fitPattern(train, pat, wtFn);
  return stackZ(fitCache[ck], f);
}
const byYear = {}; YEARS.forEach((Y) => { byYear[Y] = fights.filter((f) => f.yr === Y); });
function trainLOYO(Y) { return fights.filter((f) => f.yr !== Y); }
function trainFwd(Y) { return fights.filter((f) => f.yr < Y); }

function loyoZ(set, tag) {
  const z = new Map();
  for (const Y of YEARS) { const tr = trainLOYO(Y); for (const f of byYear[Y]) z.set(f.id, stackFor("loyo" + tag + Y, tr, f, set)); }
  return z;
}
// recency weights: 0.5^((last training year - year) / h)
function recW(h, lastY) { return h ? (f) => Math.pow(0.5, (lastY - f.yr) / h) : null; }
/** forward OOF logit for fight f in year Y from a stacker on years < Y with half-life h. */
function fwdZ(set, f, h) {
  const Y = f.yr; if (Y <= 2019) return null;
  return stackFor("fwd" + set.length + "h" + h + "Y" + Y, trainFwd(Y), f, set, recW(h, Y - 1));
}
function ll1(p, y) { p = Math.min(Math.max(p, 1e-12), 1 - 1e-12); return -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); }

// ------------------------------------------------------------------ recalibration schemes (rolling origin inside 2019-2023)
function recalScheme(set, sc, testY) {
  // stacker on years < testY (recency h), temperature from forward OOF logits of the training years (>= 2020)
  const out = new Map();
  let T = 1;
  if (sc.temp) {
    const z = [], y = [], w = [];
    for (const f of fights) {
      if (f.yr >= testY || f.yr < 2020 || f.y == null) continue;
      if (sc.temp === "last" && f.yr !== testY - 1) continue;
      const zz = fwdZ(set, f, sc.h); if (zz == null) continue;
      z.push(zz); y.push(f.y); w.push(sc.h && sc.tempRec ? Math.pow(0.5, (testY - 1 - f.yr) / sc.h) : 1);
    }
    T = FB.fitTemp(z, y, w);
  }
  for (const f of byYear[testY]) out.set(f.id, sigm(T * fwdZ(set, f, sc.h)));
  return { p: out, T };
}
const SCHEMES = [
  { name: "none", h: 0, temp: false },
  { name: "temperature", h: 0, temp: "all" },
  { name: "temperature (last year only)", h: 0, temp: "last" },
  { name: "recency h=1", h: 1, temp: false },
  { name: "recency h=1.5", h: 1.5, temp: false },
  { name: "recency h=3", h: 3, temp: false },
  { name: "recency h=1 + temperature", h: 1, temp: "all", tempRec: true },
  { name: "recency h=1.5 + temperature", h: 1.5, temp: "all", tempRec: true },
  { name: "recency h=3 + temperature", h: 3, temp: "all", tempRec: true }
];
const RECAL_TEST = [2021, 2022, 2023];
function runRecal(set) {
  const rows = [];
  for (const sc of SCHEMES) {
    const per = {}, all = []; const Ts = {};
    for (const Y of RECAL_TEST) {
      const r = recalScheme(set, sc, Y); Ts[Y] = r.T;
      const ls = byYear[Y].filter((f) => f.y != null && (set === NOLINE || isNum(f.ex.market))).map((f) => ll1(r.p.get(f.id), f.y));
      per[Y] = mean(ls); all.push(...ls);
    }
    rows.push({ scheme: sc.name, cv: mean(all), n: all.length, byYear: per, T: Ts, sc });
  }
  rows.sort((a, b) => a.cv - b.cv);
  return rows;
}

// ------------------------------------------------------------------ targets mode
const zNo = loyoZ(NOLINE, "N"), zLine = loyoZ(LINE, "L");
const pOn = new Map(), pOnLine = new Map();
for (const f of fights) { pOn.set(f.id, sigm(zNo.get(f.id))); pOnLine.set(f.id, sigm(zLine.get(f.id))); }
if (mode === "targets") {
  const t = {}; for (const f of fights) t[f.id] = +pOn.get(f.id).toFixed(6);
  fs.writeFileSync(path.join(OUTDIR, "targets.json"), JSON.stringify({ meta: { what: "LOYO (2019-2023) no-line stacked blend P(A), out of fold", n: fights.length }, fights: t }));
  console.log("targets:", fights.length, "->", path.join(OUTDIR, "targets.json"));
  process.exit(0);
}

// ------------------------------------------------------------------ method x round pooling
function poolFor(f, p, w, kind, cellsSim) {
  const sim = FB.rescale(cellsSim || f.plain.cells, f.R, p);
  if (!f.S) return sim;
  return FB.poolCells(sim, FB.rescale(f.S, f.R, p), w, kind);
}
function cellLL(c, obs) { let s = 0; for (const x of c) s += Math.max(x, 1e-9); return -Math.log(Math.max(c[obs], 1e-9) / s); }
const WGRID = []; for (let w = 0; w <= 1.0001; w += 0.05) WGRID.push(+w.toFixed(2));
function bestW(train, kind, pMap, cellsKey) {
  let best = null;
  for (const w of WGRID) {
    const ls = train.filter((f) => f.obs >= 0 && f.S).map((f) => cellLL(poolFor(f, pMap.get(f.id), w, kind, cellsKey ? f[cellsKey].cells : null), f.obs));
    const v = mean(ls); if (!best || v < best.v) best = { w, v };
  }
  return best;
}
const mrFit = {};
for (const kind of ["linear", "log"]) {
  mrFit[kind] = {};
  for (const Y of YEARS) mrFit[kind][Y] = bestW(trainLOYO(Y), kind, pOn);
  mrFit[kind].all = bestW(fights, kind, pOn);
  // LOYO score of the kind
  const ls = fights.filter((f) => f.obs >= 0).map((f) => cellLL(poolFor(f, pOn.get(f.id), mrFit[kind][f.yr].w, kind), f.obs));
  mrFit[kind].loyo = mean(ls);
}
const POOL = mrFit.linear.loyo <= mrFit.log.loyo ? "linear" : "log";
console.log("method/round pool LOYO joint LL: linear", f4(mrFit.linear.loyo), "w(all)", mrFit.linear.all.w, "| log", f4(mrFit.log.loyo), "w(all)", mrFit.log.all.w, "->", POOL);

// ------------------------------------------------------------------ per-fight metrics
const R5 = (c, R) => FB.marginals(c, R);
function winnerOf(c, R) { const m = R5(c, R); return m.p; }
function lossRow(c, R, obs, y, q) {
  const m = R5(c, R), o = {};
  const s = c.reduce((a, b) => a + Math.max(b, 1e-9), 0);
  if (obs >= 0) {
    o.joint = -Math.log(Math.max(c[obs], 1e-9) / s);
    const isKO = (obs < R) || (obs >= 2 * R && obs < 3 * R), isSUB = (obs >= R && obs < 2 * R) || (obs >= 3 * R && obs < 4 * R);
    o.method3 = -Math.log(Math.max(isKO ? m.pKO : (isSUB ? m.pSUB : m.pDEC), 1e-9) / s);
    const b = obs < R ? 0 : obs < 2 * R ? 1 : obs < 3 * R ? 6 : obs < 4 * R ? 5 : obs === 4 * R ? 2 : obs === 4 * R + 1 ? 4 : 3;
    o.bin7 = -Math.log(Math.max(m.bins7[b], 1e-9) / s);
    o.finish = -Math.log(Math.max(isKO || isSUB ? m.pFinish : m.pDEC, 1e-9) / s);
  }
  if (y != null) { o.winner = ll1(m.p, y); o.brier = (m.p - y) * (m.p - y); o.acc = Math.abs(m.p - 0.5) < 1e-12 ? 0.5 : ((m.p > 0.5) === (y === 1) ? 1 : 0); }
  if (y != null && isNum(q)) o.soft = -(q * Math.log(Math.min(Math.max(m.p, 1e-12), 1)) + (1 - q) * Math.log(Math.min(Math.max(1 - m.p, 1e-12), 1)));
  return o;
}
function lossP(p, y, q) {      // winner-only rows for a bare probability
  const o = {};
  if (y != null) { o.winner = ll1(p, y); o.brier = (p - y) * (p - y); o.acc = Math.abs(p - 0.5) < 1e-12 ? 0.5 : ((p > 0.5) === (y === 1) ? 1 : 0); }
  if (y != null && isNum(q)) o.soft = -(q * Math.log(Math.max(p, 1e-12)) + (1 - q) * Math.log(Math.max(1 - p, 1e-12)));
  return o;
}
// stat lines: Poisson deviance per fight-side with actual minutes as exposure
const STATS = ["sig_att", "sig_lnd", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att"];
function pdev(y, mu) { mu = Math.max(mu, 1e-9); return 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu)); }
function simRates(r) {
  if (!r) return null;
  const o = { A: {}, B: {} };
  for (const k of STATS) { o.A[k] = r.sumA[SKI[k]] / r.minutes; o.B[k] = r.sumB[SKI[k]] / r.minutes; }
  return o;
}
function mlRates(f) {
  if (!f.mlr) return null;
  const obj = (a) => { const o = {}; TN.forEach((t, i) => { o[t] = a[i]; }); return o; };
  return { A: FB.mlStatRates(obj(f.mlr.A)), B: FB.mlStatRates(obj(f.mlr.B)) };
}
function statRow(f, rates) {
  if (!rates || !f.actual || !(f.minutes > 0)) return null;
  const o = {};
  for (const k of STATS) {
    let d = 0;
    for (const s of ["A", "B"]) { const y = f.actual[s][k]; if (!isNum(y)) return null; d += pdev(y, rates[s][k] * f.minutes); }
    o["dev_" + k] = d / 2;      // per fight-side
  }
  return o;
}

// ------------------------------------------------------------------ assemble predictions
const T_FWD = {};
const recalNo = runRecal(NOLINE), recalLine = runRecal(LINE);
const chosenNo = recalNo[0], chosenLine = recalLine[0];
console.log("recal (no line) best:", chosenNo.scheme, f4(chosenNo.cv), "| none", f4(recalNo.find((r) => r.scheme === "none").cv));
console.log("recal (line) best:", chosenLine.scheme, f4(chosenLine.cv), "| none", f4(recalLine.find((r) => r.scheme === "none").cv));
const pFwd = new Map(), pFwdLine = new Map(), pFwdNone = new Map();
for (const Y of RECAL_TEST) {
  const a = recalScheme(NOLINE, chosenNo.sc, Y), b = recalScheme(LINE, chosenLine.sc, Y), c = recalScheme(NOLINE, SCHEMES[0], Y);
  T_FWD[Y] = { noline: a.T, line: b.T };
  for (const [k, v] of a.p) pFwd.set(k, v);
  for (const [k, v] of b.p) pFwdLine.set(k, v);
  for (const [k, v] of c.p) pFwdNone.set(k, v);
}

const rows = [];       // per fight: { ev, yr, vals: { name: {metric: value} } }
for (const f of fights) {
  const q = f.ex.market, R = f.R, v = {};
  v.off = Object.assign(lossRow(f.plain.cells, R, f.obs, f.y, q), statRow(f, simRates(f.plain)) || {});
  v.off_raw = lossRow(f.plain.cellsRaw || f.plain.cells, R, f.obs, f.y, q);
  const p = pOn.get(f.id), wY = mrFit[POOL][f.yr].w;
  const onCells = poolFor(f, p, wY, POOL);
  v.on = Object.assign(lossRow(onCells, R, f.obs, f.y, q), statRow(f, mlRates(f)) || {});
  v.on_simonly = lossRow(FB.rescale(f.plain.cells, R, p), R, f.obs, f.y, q);
  v.on_S = f.S ? lossRow(FB.rescale(f.S, R, p), R, f.obs, f.y, q) : null;
  v.S_raw = f.S ? lossRow(f.S, R, f.obs, f.y, q) : null;
  const pl = pOnLine.get(f.id);
  v.on_line = isNum(f.ex.market) ? lossRow(poolFor(f, pl, wY, POOL), R, f.obs, f.y, q) : null;
  v.market = isNum(f.ex.market) ? lossP(f.ex.market, f.y, q) : null;
  for (const k of NOLINE) v["x_" + k] = isNum(f.ex[k]) ? lossP(f.ex[k], f.y, q) : null;
  if (pFwd.has(f.id)) {
    v.fwd_on = Object.assign(lossRow(poolFor(f, pFwd.get(f.id), wY, POOL), R, f.obs, f.y, q), statRow(f, mlRates(f)) || {});
    v.fwd_none = lossP(pFwdNone.get(f.id), f.y, q);
    v.fwd_off = v.off;
    if (isNum(f.ex.market)) v.fwd_line = lossP(pFwdLine.get(f.id), f.y, q);
  }
  if (f.anchor) {
    v.anc_raw = Object.assign(lossRow(f.anchor.cells, R, f.obs, f.y, q), statRow(f, simRates(f.anchor)) || {});
    v.anc_on = Object.assign(lossRow(poolFor(f, p, wY, POOL, f.anchor.cells), R, f.obs, f.y, q), statRow(f, simRates(f.anchor)) || {});
    v.anc_simonly = lossRow(FB.rescale(f.anchor.cells, R, p), R, f.obs, f.y, q);
    v.off_a = Object.assign({}, v.off);        // same fights as the anchored rows
  }
  rows.push({ f, ev: f.ev, yr: f.yr, v });
}

// ------------------------------------------------------------------ paired event-cluster bootstrap
const evIdx = {}; const evList = [];
rows.forEach((r, i) => { if (!(r.ev in evIdx)) { evIdx[r.ev] = evList.length; evList.push([]); } evList[evIdx[r.ev]].push(i); });
const rng = E.makeRng(20261106);
const DRAWS = [];
for (let b = 0; b < NBOOT; b++) { const c = new Int32Array(evList.length); for (let k = 0; k < evList.length; k++) c[Math.floor(rng.u() * evList.length)]++; DRAWS.push(c); }
function qtl(a, q) { const s = a.slice().sort((x, y) => x - y), t = q * (s.length - 1), lo = Math.floor(t), hi = Math.ceil(t); return s[lo] + (s[hi] - s[lo]) * (t - lo); }
/** mean of metric for models a and b over fights where both exist, with paired bootstrap CI of a - b. */
function cmp(a, b, metric, filt) {
  const ia = [], va = [], vb = [];
  rows.forEach((r, i) => {
    if (filt && !filt(r)) return;
    const x = r.v[a], y = b ? r.v[b] : null;
    if (!x || !isNum(x[metric])) return;
    if (b && (!y || !isNum(y[metric]))) return;
    ia.push(i); va.push(x[metric]); vb.push(b ? y[metric] : 0);
  });
  if (!ia.length) return null;
  const pos = new Map(); ia.forEach((i, k) => pos.set(i, k));
  const evS = evList.map((l) => { let sa = 0, sb = 0, n = 0; for (const i of l) { const k = pos.get(i); if (k == null) continue; sa += va[k]; sb += vb[k]; n++; } return [sa, sb, n]; });
  const ds = [], ma = [];
  for (const c of DRAWS) {
    let sa = 0, sb = 0, n = 0;
    for (let e = 0; e < c.length; e++) if (c[e]) { sa += c[e] * evS[e][0]; sb += c[e] * evS[e][1]; n += c[e] * evS[e][2]; }
    if (n) { ds.push((sa - sb) / n); ma.push(sa / n); }
  }
  const out = { n: ia.length, a: mean(va), ci_a: [qtl(ma, 0.025), qtl(ma, 0.975)] };
  if (b) { out.b = mean(vb); out.d = out.a - out.b; out.ci = [qtl(ds, 0.025), qtl(ds, 0.975)]; }
  return out;
}

// ------------------------------------------------------------------ tables
const MET = ["winner", "soft", "bin7", "method3", "joint", "finish", "brier", "acc"];
const DEVS = STATS.map((k) => "dev_" + k);
function tbl(a, b, mets, filt) { const o = {}; for (const m of mets) o[m] = cmp(a, b, m, filt); return o; }
const ablation = {
  main_loyo: tbl("on", "off", MET.concat(DEVS)),
  sim_only_rescaled: tbl("on_simonly", "off", ["winner", "soft", "bin7", "method3", "joint", "finish"]),
  off_smoothed_vs_raw: tbl("off", "off_raw", ["winner", "bin7", "method3", "joint", "finish"]),
  S_rescaled_vs_on: tbl("on_S", "on", ["bin7", "method3", "joint", "finish"]),
  S_raw_vs_on: tbl("S_raw", "on", ["winner", "bin7", "method3", "joint", "finish"]),
  line_vs_noline: tbl("on_line", "on", ["winner", "bin7", "method3", "joint"]),
  line_vs_market: tbl("on_line", "market", ["winner", "brier"]),
  noline_vs_market: tbl("on", "market", ["winner", "brier"]),
  forward: tbl("fwd_on", "fwd_off", MET.concat(DEVS)),
  forward_recal_vs_none: tbl("fwd_on", "fwd_none", ["winner", "soft", "brier"]),
  forward_line_vs_market: tbl("fwd_line", "market", ["winner"]),
  experts: {}
};
for (const k of NOLINE) ablation.experts[k] = cmp("x_" + k, "off", "winner");
ablation.experts.market = cmp("market", "off", "winner");
if (anchorF) {
  ablation.anchor_raw_vs_off = tbl("anc_raw", "off_a", ["winner", "soft", "bin7", "method3", "joint", "finish"].concat(DEVS));
  ablation.anchor_on_vs_on = tbl("anc_on", "on", ["bin7", "method3", "joint", "finish"].concat(DEVS), (r) => !!r.v.anc_on);
  ablation.anchor_dev_vs_ml = tbl("anc_raw", "on", DEVS, (r) => !!r.v.anc_raw);
  ablation.anchor_simonly_vs_simonly = tbl("anc_simonly", "on_simonly", ["bin7", "method3", "joint"], (r) => !!r.v.anc_simonly);
}
// by year (winner / bin7, main)
const byYearT = {};
for (const Y of YEARS) byYearT[Y] = { winner: cmp("on", "off", "winner", (r) => r.yr === Y), bin7: cmp("on", "off", "bin7", (r) => r.yr === Y) };

// ------------------------------------------------------------------ base rates
function brate(name, predFn, obsFn, filt) {
  // mean predicted vs observed with bootstrap CIs on (pred - obs) for off / on and on-off |bias| difference
  const rs = rows.filter((r) => (!filt || filt(r.f)));
  const out = {};
  for (const mdl of ["off", "on", "anc"]) {
    const P = [], O = [], I = [];
    rs.forEach((r) => { const pv = predFn(r, mdl), ov = obsFn(r.f); if (isNum(pv) && isNum(ov)) { P.push(pv); O.push(ov); I.push(rows.indexOf(r)); } });
    if (!P.length) continue;
    const pos = new Map(); I.forEach((i, k) => pos.set(i, k));
    const evS = evList.map((l) => { let sp = 0, so = 0, n = 0; for (const i of l) { const k = pos.get(i); if (k == null) continue; sp += P[k]; so += O[k]; n++; } return [sp, so, n]; });
    const bs = [];
    for (const c of DRAWS) { let sp = 0, so = 0, n = 0; for (let e = 0; e < c.length; e++) if (c[e]) { sp += c[e] * evS[e][0]; so += c[e] * evS[e][1]; n += c[e] * evS[e][2]; } if (n) bs.push((sp - so) / n); }
    out[mdl] = { n: P.length, pred: mean(P), obs: mean(O), bias: mean(P) - mean(O), ci: [qtl(bs, 0.025), qtl(bs, 0.975)], _bs: bs };
  }
  if (out.on && out.off) {
    const d = out.on._bs.map((x, i) => Math.abs(x) - Math.abs(out.off._bs[i]));
    out.absBiasOnMinusOff = { d: Math.abs(out.on.bias) - Math.abs(out.off.bias), ci: [qtl(d, 0.025), qtl(d, 0.975)] };
  }
  for (const k in out) if (out[k]._bs) delete out[k]._bs;
  return Object.assign({ name }, out);
}
function cellsOf(r, mdl) {
  const f = r.f, p = pOn.get(f.id), w = mrFit[POOL][f.yr].w;
  if (mdl === "off") return f.plain.cells;
  if (mdl === "on") return poolFor(f, p, w, POOL);
  if (mdl === "anc") return f.anchor ? poolFor(f, p, w, POOL, f.anchor.cells) : null;
}
const scored = (f) => f.obs >= 0;
const isKO = (f) => { const R = f.R, o = f.obs; return (o < R) || (o >= 2 * R && o < 3 * R) ? 1 : 0; };
const isSUB = (f) => { const R = f.R, o = f.obs; return (o >= R && o < 2 * R) || (o >= 3 * R && o < 4 * R) ? 1 : 0; };
const finRound = (f) => { const R = f.R, o = f.obs; return o < 4 * R ? (o % R) + 1 : 0; };
const mg = (r, mdl) => { const c = cellsOf(r, mdl); return c ? FB.marginals(c, r.f.R) : null; };
function favPred(r, mdl) { const m = mg(r, mdl); return m ? Math.max(m.p, 1 - m.p) : null; }
function favObs(r) { const m = mg(r, "on"); const f = r.f; if (f.y == null) return null; return (m.p >= 0.5) === (f.y === 1) ? 1 : 0; }
const stRate = (r, mdl, k) => {
  const f = r.f; if (!(f.minutes > 0) || !f.actual) return null;
  const rt = mdl === "off" ? simRates(f.plain) : mdl === "on" ? mlRates(f) : simRates(f.anchor);
  return rt ? (rt.A[k] + rt.B[k]) / 2 * f.minutes : null;      // expected count per fighter at the actual fight length
};
const stObs = (f, k) => (f.minutes > 0 && f.actual && isNum(f.actual.A[k])) ? (f.actual.A[k] + f.actual.B[k]) / 2 : null;
const baseRates = [
  brate("P(KO/TKO)", (r, m) => { const x = mg(r, m); return x && x.pKO; }, (f) => scored(f) ? isKO(f) : null),
  brate("P(submission)", (r, m) => { const x = mg(r, m); return x && x.pSUB; }, (f) => scored(f) ? isSUB(f) : null),
  brate("P(decision incl. draw)", (r, m) => { const x = mg(r, m); return x && x.pDEC; }, (f) => scored(f) ? (finRound(f) === 0 ? 1 : 0) : null),
  brate("P(draw)", (r, m) => { const x = mg(r, m); return x && x.pD; }, (f) => scored(f) ? (f.obs === 4 * f.R + 2 ? 1 : 0) : null),
  brate("P(finish in R1)", (r, m) => { const x = mg(r, m); return x && x.finRound[0]; }, (f) => scored(f) ? (finRound(f) === 1 ? 1 : 0) : null),
  brate("P(finish in R2)", (r, m) => { const x = mg(r, m); return x && x.finRound[1]; }, (f) => scored(f) ? (finRound(f) === 2 ? 1 : 0) : null),
  brate("P(finish in R3)", (r, m) => { const x = mg(r, m); return x && x.finRound[2]; }, (f) => scored(f) ? (finRound(f) === 3 ? 1 : 0) : null),
  brate("5-round fights: P(finish)", (r, m) => { const x = mg(r, m); return x && x.pFinish; }, (f) => scored(f) ? (finRound(f) > 0 ? 1 : 0) : null, (f) => f.R === 5),
  brate("favourite (by the blend) win prob vs rate", favPred, (f) => null, null),
  brate("sig. landed per fighter per fight (at actual minutes)", (r, m) => stRate(r, m, "sig_lnd"), (f) => stObs(f, "sig_lnd")),
  brate("sig. attempted per fighter per fight", (r, m) => stRate(r, m, "sig_att"), (f) => stObs(f, "sig_att")),
  brate("takedowns landed per fighter per fight", (r, m) => stRate(r, m, "td_lnd"), (f) => stObs(f, "td_lnd")),
  brate("knockdowns per fighter per fight", (r, m) => stRate(r, m, "kd"), (f) => stObs(f, "kd")),
  brate("control seconds per fighter per fight", (r, m) => stRate(r, m, "ctrl"), (f) => stObs(f, "ctrl")),
  brate("sub attempts per fighter per fight", (r, m) => stRate(r, m, "sub_att"), (f) => stObs(f, "sub_att"))
];
// favourite row needs per-fight obs from the blend's own favourite: redo with a custom obs per model
baseRates[8] = (function () {
  const o = { name: "favourite win prob (pred) vs favourite win rate (obs), each model's own favourite" };
  for (const mdl of ["off", "on", "anc"]) {
    const P = [], O = [], I = [];
    rows.forEach((r, i) => { const m = mg(r, mdl); if (!m || r.f.y == null) return; const fav = m.p >= 0.5; P.push(Math.max(m.p, 1 - m.p)); O.push(fav === (r.f.y === 1) ? 1 : 0); I.push(i); });
    if (!P.length) continue;
    const pos = new Map(); I.forEach((i, k) => pos.set(i, k));
    const evS = evList.map((l) => { let sp = 0, so = 0, n = 0; for (const i of l) { const k = pos.get(i); if (k == null) continue; sp += P[k]; so += O[k]; n++; } return [sp, so, n]; });
    const bs = []; for (const c of DRAWS) { let sp = 0, so = 0, n = 0; for (let e = 0; e < c.length; e++) if (c[e]) { sp += c[e] * evS[e][0]; so += c[e] * evS[e][1]; n += c[e] * evS[e][2]; } if (n) bs.push((sp - so) / n); }
    o[mdl] = { n: P.length, pred: mean(P), obs: mean(O), bias: mean(P) - mean(O), ci: [qtl(bs, 0.025), qtl(bs, 0.975)] };
  }
  return o;
})();

// ------------------------------------------------------------------ interval (d): profile-noise bootstrap of the no-line blend
const moeDoc = J(D("moe.json")), feat = moeDoc.feat, KEYS = bt.meta.keys;
const PRI = J(D("mlcal_priors_asof.json"));
const BOOTB = +opt("--ivB", 200);
function sideRec(s) { return { S: s.S, age: s.age, height_in: s.height_in, reach_in: s.reach_in, stance: s.stance, n: s.n, ko_losses: s.ko_losses, kd_absorbed: s.kd_absorbed, elo: s.elo }; }
function featZ(coef, sa, sb, P) {
  const fa = MoE.sideFeatures(feat, sa, P), fb = MoE.sideFeatures(feat, sb, P); let z = 0;
  for (let i = 0; i < coef.length; i++) { const d = fa[i] - fb[i]; if (isFinite(d)) z += coef[i] * d; }
  return z;
}
function intervalFor(f, bcfg, ivRng) {
  const coef = dev.coef_page[String(f.yr)], pri = PRI[String(f.yr)], P = pri[f.division] || pri[f.prof.A.home] || pri.ALL;
  const sa = sideRec(f.prof.A), sb = sideRec(f.prof.B), z0 = featZ(coef, sa, sb, P);
  const shifts = [];
  for (let b = 0; b < bcfg.B; b++) {
    const qa = Object.assign({}, sa, { S: FB.perturbS(sa.S, KEYS, ivRng, bcfg) }), qb = Object.assign({}, sb, { S: FB.perturbS(sb.S, KEYS, ivRng, bcfg) });
    shifts.push(featZ(coef, qa, qb, P) - z0);
  }
  const pat = avail(f, NOLINE), fit = fitCache["loyoN" + f.yr + "|" + pat.join("+")];
  const blendFn = (e) => { let z = 0; for (const k in fit.w) z += fit.w[k] * lcl(e[k]); return sigm(z); };
  const ex = {}; for (const k of pat) ex[k] = f.ex[k];
  return FB.interval(blendFn, ex, (i) => shifts[i], { rng: ivRng, rdA: f.rdA, rdB: f.rdB, engineN: f.plain.n * f.plain.runs }, bcfg);
}
const IVVARIANTS = [
  { name: "profile noise + engine MC (default)", boot: {} },
  { name: "profile noise x0.5", boot: { cvOut: 0.225, cvGrap: 0.5, cvSub: 0.75, cvKd: 0.5, cvAcc: 0.125, count: false } },
  { name: "profile noise + Glicko RD on Elo experts", boot: { eloRdScale: 1 } }
];
const ivRes = [];
for (const vv of (BOOTB > 0 ? IVVARIANTS : [])) {
  const bcfg = Object.assign({}, FB.DEFAULTS.boot, vv.boot, { B: BOOTB });
  const ivRng = E.makeRng(77);
  const per = [];
  for (const r of rows) {
    const f = r.f; if (f.y == null) continue;
    const iv = intervalFor(f, bcfg, ivRng);
    per.push({ f, p: iv.p, mean: iv.mean, sd: iv.sdLogit, lv80: iv.levels["0.8"], lv95: iv.levels["0.95"], q: f.ex.market });
  }
  // checks
  const llP = mean(per.map((x) => ll1(x.p, x.f.y))), llM = mean(per.map((x) => ll1(x.mean, x.f.y)));
  const wq = per.filter((x) => isNum(x.q));
  const cov80 = mean(wq.map((x) => (x.q >= x.lv80[0] && x.q <= x.lv80[1]) ? 1 : 0)), cov95 = mean(wq.map((x) => (x.q >= x.lv95[0] && x.q <= x.lv95[1]) ? 1 : 0));
  // calibration slope by width tercile (no-intercept logistic refit of y on logit p)
  const sds = per.map((x) => x.sd).sort((a, b) => a - b), t1 = sds[Math.floor(sds.length / 3)], t2 = sds[Math.floor(2 * sds.length / 3)];
  const terc = [[], [], []]; per.forEach((x) => terc[x.sd <= t1 ? 0 : x.sd <= t2 ? 1 : 2].push(x));
  const slopes = terc.map((g) => ({ n: g.length, sdMean: mean(g.map((x) => x.sd)), slope: FB.fitTemp(g.map((x) => logit(x.p)), g.map((x) => x.f.y)),
    ll: mean(g.map((x) => ll1(x.p, x.f.y))), absGapToClose: mean(g.filter((x) => isNum(x.q)).map((x) => Math.abs(logit(x.p) - logit(x.q)))) }));
  // Spearman-free: Pearson of sd with |logit p - logit q|
  const a = wq.map((x) => x.sd), b = wq.map((x) => Math.abs(logit(x.p) - logit(x.q)));
  const ma = mean(a), mb = mean(b); let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  // calibrated interval: logit-normal p in sigm(z0 +- zq kappa sd) with the inflation kappa set so the 80% interval covers
  // the closing line 80% of the time (the close as a less noisy stand-in for the true probability); checked out of fold
  // (kappa from the other four years) at 80% and at 95%
  const tAbs = (g) => g.map((x) => Math.abs(logit(x.q) - logit(x.p)) / Math.max(1e-6, x.sd));
  const kap = (g) => qtl(tAbs(g), 0.8) / 1.2815516;
  const kappa80 = kap(wq), kappa95 = qtl(tAbs(wq), 0.95) / 1.959964;
  const oof = { c80: 0, c95: 0, n: 0, byYear: {} };
  for (const Y of YEARS) {
    const k = kap(wq.filter((x) => x.f.yr !== Y)), te = wq.filter((x) => x.f.yr === Y);
    const c80 = mean(te.map((x) => Math.abs(logit(x.q) - logit(x.p)) <= 1.2815516 * k * x.sd ? 1 : 0));
    const c95 = mean(te.map((x) => Math.abs(logit(x.q) - logit(x.p)) <= 1.959964 * k * x.sd ? 1 : 0));
    oof.byYear[Y] = { kappa: k, cover80: c80, cover95: c95, n: te.length };
    oof.c80 += c80 * te.length; oof.c95 += c95 * te.length; oof.n += te.length;
  }
  oof.c80 /= oof.n; oof.c95 /= oof.n;
  const w80cal = qtl(per.map((x) => sigm(logit(x.p) + 1.2815516 * kappa80 * x.sd) - sigm(logit(x.p) - 1.2815516 * kappa80 * x.sd)), 0.5);
  ivRes.push({ variant: vv.name, boot: vv.boot, n: per.length, medianSdLogit: qtl(per.map((x) => x.sd), 0.5), medianWidth80: qtl(per.map((x) => x.lv80[1] - x.lv80[0]), 0.5),
    medianWidth95: qtl(per.map((x) => x.lv95[1] - x.lv95[0]), 0.5), llPoint: llP, llBootMean: llM, coverClose80: cov80, coverClose95: cov95, nClose: wq.length,
    corrSdGap: sab / Math.sqrt(saa * sbb), terciles: slopes, kappa80, kappa95, calibratedOOF: oof, medianWidth80Calibrated: w80cal });
  console.log("  kappa80", f4(kappa80), "kappa95", f4(kappa95), "OOF cover80/95", f4(oof.c80), f4(oof.c95), "median calibrated 80% width", f4(w80cal));
  console.log("interval:", vv.name, "median sd", f4(qtl(per.map((x) => x.sd), 0.5)), "cover80", f4(cov80), "cover95", f4(cov95), "ll point/mean", f4(llP), f4(llM));
}

// ------------------------------------------------------------------ production fits (all 2019-2023, train-only)
const prodNo = {}, prodLine = {};
const patsNo = [NOLINE, NOLINE.filter((k) => k !== "mkt_rating"), NOLINE.filter((k) => k !== "ml" && k !== "elo_sig"), ["feat_lr", "engine", "elo"]];
const lastWt = (sc) => recW(sc.h, 2023);
for (const pat of patsNo) prodNo[pat.join("+")] = fitPattern(fights, pat, lastWt(chosenNo.sc)).w;
for (const pat of patsNo) { const pl = ["market"].concat(pat); prodLine[pl.join("+")] = fitPattern(fights, pl, lastWt(chosenLine.sc)).w; }
// temperature for the chosen scheme when fit through 2023 (forward OOF logits 2020-2023)
function prodT(set, sc) {
  if (!sc.temp) return 1;
  const z = [], y = [], w = [];
  for (const f of fights) { if (f.yr < 2020 || f.y == null) continue; if (sc.temp === "last" && f.yr !== 2023) continue; const zz = fwdZ(set, f, sc.h); if (zz == null) continue; z.push(zz); y.push(f.y); w.push(sc.h && sc.tempRec ? Math.pow(0.5, (2023 - f.yr) / sc.h) : 1); }
  return FB.fitTemp(z, y, w);
}
// MoE's validated (<= 2023) weights on these 2019-2023 fights, in-sample for reference only
const moeVal = MoE.load(moeDoc, "model_validated");
const moeInSample = { noline: mean(rows.filter((r) => r.f.y != null).map((r) => { const e = {}; for (const k of NOLINE) if (isNum(r.f.ex[k])) e[k] = r.f.ex[k]; e.engine = undefined; return ll1(moeVal.predict({ experts: e, gate: {} }).p, r.f.y); })) };
const pilot = {};       // anchor slope pilots (pilot.json: acc/td/pow 1/1/0; pilot_v1..v3.json: the channel-mix variants)
for (const fn of fs.readdirSync(OUTDIR).filter((x) => /^pilot(_v\d+)?\.json$/.test(x))) pilot[fn.replace(".json", "")] = J(path.join(OUTDIR, fn));
const anchorStats = anchorF ? (function () {
  const a = fights.filter((f) => f.anchor), ss = a.map((f) => f.anchor.s), gap = a.map((f) => Math.abs(f.anchor.p - f.anchor.target));
  return { n: a.length, sMedianAbs: qtl(ss.map(Math.abs), 0.5), sP90Abs: qtl(ss.map(Math.abs), 0.9), sMean: mean(ss), gapMedian: qtl(gap, 0.5), gapP90: qtl(gap, 0.9),
    itersMean: mean(a.map((f) => f.anchor.iters)), corrS_vs_logitGap: (function () {
      const x = a.map((f) => f.anchor.s), y = a.map((f) => logit(f.anchor.target) - logit(f.plain.p)); const mx = mean(x), my = mean(y);
      let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); })() };
})() : null;

const out = {
  meta: { tool: "tools/blend_anchor_eval.js", built: new Date().toISOString(), window: "2019-01-01..2023-12-31 (train years only; nothing later read)",
    n_fights: fights.length, n_decisive: fights.filter((f) => f.y != null).length, n_scored: fights.filter((f) => f.obs >= 0).length, boot: NBOOT,
    sims: { plain: plainF.meta, anchor: anchorF ? anchorF.meta : null }, cluster: "event", orientation: "A = first-named; every model symmetric" },
  settings: {
    mrWeight: mrFit[POOL].all.w, mrPool: POOL, mrWeightByFold: Object.fromEntries(YEARS.map((Y) => [Y, mrFit[POOL][Y].w])),
    mrLOYO: { linear: mrFit.linear.loyo, log: mrFit.log.loyo, wLinear: mrFit.linear.all.w, wLog: mrFit.log.all.w },
    recal: { noline: { scheme: chosenNo.scheme, T_through_2023: prodT(NOLINE, chosenNo.sc), table: recalNo.map((r) => ({ scheme: r.scheme, cv: r.cv, n: r.n, byYear: r.byYear, T: r.T })) },
      line: { scheme: chosenLine.scheme, T_through_2023: prodT(LINE, chosenLine.sc), table: recalLine.map((r) => ({ scheme: r.scheme, cv: r.cv, n: r.n, byYear: r.byYear, T: r.T })) },
      forwardT: T_FWD },
    stacker_2019_2023: { noline: prodNo, line: prodLine, note: "train-only refit (chosen recency), reference: FightEngine.predict uses the verified MoE (moe_page.json)" },
    anchorPilot: pilot, anchorStats: anchorStats, interval: ivRes
  },
  ablation, byYear: byYearT, baseRates, moeValidatedInSample: moeInSample,
  loyoWeights: Object.fromEntries(YEARS.map((Y) => [Y, fitCache["loyoN" + Y + "|" + NOLINE.join("+")] && fitCache["loyoN" + Y + "|" + NOLINE.join("+")].w]))
};
const OUTJSON = TAG ? path.join(OUTDIR, "eval_" + TAG + ".json") : D("blend_anchor.json");
fs.writeFileSync(OUTJSON, JSON.stringify(out, null, 1));

// ------------------------------------------------------------------ markdown report
const L = [];
const ci = (c) => c ? `[${c[0] >= 0 ? "+" : ""}${c[0].toFixed(4)}, ${c[1] >= 0 ? "+" : ""}${c[1].toFixed(4)}]` : "";
const sg = (x) => (x >= 0 ? "+" : "") + x.toFixed(4);
function mdTable(title, t, la, lb) {
  L.push(`\n### ${title}\n`, `| metric | n | ${la} | ${lb} | ${la} - ${lb} [95% CI] |`, "|---|---|---|---|---|");
  for (const k in t) { const r = t[k]; if (!r) continue; L.push(`| ${k} | ${r.n} | ${f4(r.a)} | ${f4(r.b)} | ${sg(r.d)} ${ci(r.ci)} |`); }
}
L.push("# blend_anchor ablation (2019-2023, train years only)", "", `Fights: ${out.meta.n_fights} (decisive ${out.meta.n_decisive}, scored ${out.meta.n_scored}); bootstrap ${NBOOT} event-cluster draws.`);
mdTable("Main: flag on (LOYO-fitted package) vs flag off (simulator alone)", ablation.main_loyo, "on", "off");
mdTable("Forward-chained 2021-2023: on (chosen recalibration) vs off", ablation.forward, "on", "off");
mdTable("Simulator cells rescaled to the blend (no S pool) vs off", ablation.sim_only_rescaled, "on_sim", "off");
mdTable("Flag off: Jeffreys-smoothed cells (used everywhere) vs raw cells", ablation.off_smoothed_vs_raw, "smoothed", "raw");
mdTable("S cells rescaled vs full on", ablation.S_rescaled_vs_on, "S_resc", "on");
mdTable("Blend with the closing line vs no-line blend", ablation.line_vs_noline, "line", "noline");
mdTable("Blend with line vs market close", ablation.line_vs_market, "line", "market");
mdTable("No-line blend vs market close", ablation.noline_vs_market, "noline", "market");
mdTable("Forward: chosen recalibration vs none", ablation.forward_recal_vs_none, "recal", "none");
if (anchorF) {
  mdTable("Anchored simulator (raw) vs plain simulator", ablation.anchor_raw_vs_off, "anchored", "plain");
  mdTable("On with anchored sim cells vs on", ablation.anchor_on_vs_on, "on_anch", "on");
  mdTable("Stat lines: anchored sim vs ML", ablation.anchor_dev_vs_ml, "anchored", "ML");
}
L.push("\n### Experts vs the simulator (winner log loss)\n", "| expert | n | expert | sim | diff [CI] |", "|---|---|---|---|---|");
for (const k in ablation.experts) { const r = ablation.experts[k]; if (r) L.push(`| ${k} | ${r.n} | ${f4(r.a)} | ${f4(r.b)} | ${sg(r.d)} ${ci(r.ci)} |`); }
L.push("\n### By year (winner, bin7: on - off)\n", "| year | n | winner on | off | diff [CI] | bin7 diff [CI] |", "|---|---|---|---|---|---|");
for (const Y of YEARS) { const a = byYearT[Y].winner, b = byYearT[Y].bin7; L.push(`| ${Y} | ${a.n} | ${f4(a.a)} | ${f4(a.b)} | ${sg(a.d)} ${ci(a.ci)} | ${sg(b.d)} ${ci(b.ci)} |`); }
L.push("\n### Recalibration schemes (rolling origin: fit on years < Y, test Y = 2021, 2022, 2023)\n");
for (const [lab, tb] of [["no line", recalNo], ["with line", recalLine]]) {
  L.push(`\n${lab}:\n`, "| scheme | CV log loss | 2021 | 2022 | 2023 | T by test year |", "|---|---|---|---|---|---|");
  for (const r of tb) L.push(`| ${r.scheme} | ${f4(r.cv)} | ${f4(r.byYear[2021])} | ${f4(r.byYear[2022])} | ${f4(r.byYear[2023])} | ${RECAL_TEST.map((Y) => r.T[Y].toFixed(3)).join(" / ")} |`);
}
L.push("\n### Base rates (mean predicted vs observed; bias CI; on-off |bias| CI)\n", "| rate | obs | off pred | off bias [CI] | on pred | on bias [CI] | |on|-|off| [CI] | anchored pred |", "|---|---|---|---|---|---|---|---|");
for (const b of baseRates) {
  if (!b.off) continue;
  L.push(`| ${b.name} | ${f4(b.off.obs)} | ${f4(b.off.pred)} | ${sg(b.off.bias)} ${ci(b.off.ci)} | ${b.on ? f4(b.on.pred) : "-"} | ${b.on ? sg(b.on.bias) + " " + ci(b.on.ci) : "-"} | ${b.absBiasOnMinusOff ? sg(b.absBiasOnMinusOff.d) + " " + ci(b.absBiasOnMinusOff.ci) : "-"} | ${b.anc ? f4(b.anc.pred) : "-"} |`);
}
L.push("\n### Interval checks (no-line LOYO blend)\n", "| variant | median sd (logit) | median 80% width | cover close 80% | cover close 95% | LL point | LL bootstrap mean | corr(sd, |gap to close|) | calib. slope by sd tercile |", "|---|---|---|---|---|---|---|---|---|");
for (const v of ivRes) L.push(`| ${v.variant} | ${f4(v.medianSdLogit)} | ${f4(v.medianWidth80)} | ${f4(v.coverClose80)} | ${f4(v.coverClose95)} | ${f4(v.llPoint)} | ${f4(v.llBootMean)} | ${f4(v.corrSdGap)} | ${v.terciles.map((t) => t.slope.toFixed(2)).join(" / ")} |`);
L.push("\nCalibrated (inflated) interval: kappa set so the 80% interval covers the close 80% of the time; out-of-fold check (kappa from the other years):\n",
  "| variant | kappa80 (all years) | kappa95 | OOF cover 80% | OOF cover 95% | median calibrated 80% width | kappa by held-out year |", "|---|---|---|---|---|---|---|");
for (const v of ivRes) L.push(`| ${v.variant} | ${f4(v.kappa80)} | ${f4(v.kappa95)} | ${f4(v.calibratedOOF.c80)} | ${f4(v.calibratedOOF.c95)} | ${f4(v.medianWidth80Calibrated)} | ${YEARS.map((Y) => v.calibratedOOF.byYear[Y].kappa.toFixed(2) + " (" + v.calibratedOOF.byYear[Y].cover80.toFixed(2) + ")").join(", ")} |`);
L.push("\n### Settings\n", "```", JSON.stringify({ mrWeight: out.settings.mrWeight, mrPool: POOL, mrLOYO: out.settings.mrLOYO, recalNo: out.settings.recal.noline.scheme,
  T_no: out.settings.recal.noline.T_through_2023, recalLine: out.settings.recal.line.scheme, T_line: out.settings.recal.line.T_through_2023, anchorStats, pilot, loyoWeights: out.loyoWeights }, null, 1), "```");
const OUTMD = path.join(OUTDIR, TAG ? "report_" + TAG + ".md" : "report.md");
fs.writeFileSync(OUTMD, L.join("\n") + "\n");
console.log("wrote", OUTJSON, "and", OUTMD);
