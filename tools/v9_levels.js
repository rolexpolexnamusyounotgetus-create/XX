#!/usr/bin/env node
/* v9_levels.js: walk-forward league levels for engine v9 components.levels (docs/V6_V10_PLAN.md cycle 4, work item 1) and the
   tracked 10-8 level for components.judgeWF.

   Why a residual tracker. In engine v4 the simulated league level of a fight with learned rates does not come from the
   lagged 5-year calendar window (the as-of priors P): the learned-rate adapter sets each target to eL(P) x ML / base(P), and
   eL (the engine's league-average expectation) and base (the priors' league rate) both scale with P, so P cancels. The level
   comes from the learned model's own prediction (window offset + year trend + fighter histories). Re-levelling P to a league
   tracker would therefore add the tracker's lead over the window on top of the learned model's year trend (a double count;
   on 2019-2023 the window sits ~10% under the actual sig landed level while the learned rates sit +2-4% over the backtest
   sample, so the plain re-level would overshoot by ~10%). The engine-level analogue of "follow the tracked league level" is
   to track the REALISED simulated level against the actual one: for each stat a trailing tracker of log(actual / reference
   engine's expectation) over fights strictly before the bout, and the bout's learned targets multiplied by exp(state).
   The reference engine is the comparator (engine v4 = every v9 flag off) on the same honest inputs; its train-pooled
   calibration makes the state ~0 on average, so the tracker only moves the level when the real level drifts away from it.

   Per fighter-side and fight (both corners pooled, league-pooled over divisions; actual exposure conditioned):
     att   y = sig attempts      mu = ref E[sig attempts] / ref E[minutes] x actual minutes
     acc   y = sig landed        mu = ref E[sig landed] / ref E[sig attempts] x actual sig attempts
     td    y = takedown attempts mu = ref E[TD attempts] / ref E[minutes] x actual minutes
     ctrl  y = control seconds   mu = ref E[control] / ref E[minutes] x actual minutes
     kd    y = knockdowns        mu = ref E[KD] / ref E[head landed] x actual head landed
   Trackers (research/model_eradrift.md verified settings, adapted to the residual; design constants fixed before any number):
     att   local-level Kalman on the per-card log ratio, q 0.002 per year, card event noise se 0.1 (eradrift sapm config)
     acc   Kalman q 0.002, se 0 (eradrift slpm config, plain Kalman without break bumps, as the verifier prefers for pace)
     ctrl  Kalman q 0.002, se 0.1 (eradrift ctrlpm config)
     td    exponentially weighted ratio of sums, half-life 0.5 y (eradrift tdpm: ew(h=0.5); no break bumps or division layer:
           the verifier asked for break bumps only as a pre-registered hypothesis, and the engine level is league-pooled),
           prior pseudo-exposure 100 expected attempts toward 1
     kd    trailing 730-day ratio of sums (durability's L730 league KD tracker, which the eradrift verifier says to keep for
           KD), prior pseudo-exposure 20 expected knockdowns toward 1
   Kalman observation variance per card = phi_k / sum(mu) + se_k^2, phi_k = the Pearson dispersion of y around mu per
   fighter-side on 2019-2020 (fixed in data/derived/v9/levels_phi.json before the binding gate). Initial state 0 with prior
   sd 0.05 at the first card; the state advances by q x (days / 365.25) between cards. The factor for a bout dated t is
   exp(state after every card dated strictly before t), clipped to [0.8, 1.25]; a bout on the first card date gets 1.
   r108: the eradrift verified 10-8 Kalman tracker (q 0.03), read from data/derived/eradrift.json levels.r108.league at the
   bout's month start (each value fit on fights strictly before that month; the export stops at 2026-01-01). lRef = the
   mean of those month values over 2021-01..2023-12 (the window engine v4's t108 was matched to; params.judgeWF.r108).

   API (require): { computeLevels(fights, refById, cfg) -> { byId: {id: {att, acc, td, ctrl, kd}}, trace }, r108At(date),
     r108Ref(), DEFAULT_CFG, residualUnits(f, ref) }.
   CLI: node tools/v9_levels.js phi <reference run json> [--years 2019,2020]   (prints / writes the dispersion estimates)
        node tools/v9_levels.js build <reference run json> --out <levels json>   (per-fight factors for the run's fights) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const readJSON = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
const STATS = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_lnd", "td_att", "ctrl", "sub_att"];
const NS = STATS.length;
const IX = {}; STATS.forEach((s, i) => { IX[s] = i; });
const KEYS = ["att", "acc", "td", "ctrl", "kd"];
const DEFAULT_CFG = {
  att: { kind: "kal", q: 0.002, se: 0.1 },
  acc: { kind: "kal", q: 0.002, se: 0 },
  ctrl: { kind: "kal", q: 0.002, se: 0.1 },
  td: { kind: "ew", h: 0.5, n0: 100 },
  kd: { kind: "trail", days: 730, n0: 20 },
  p0sd: 0.05, clip: [0.8, 1.25], phi: null
};
const DAY = 86400000;
function days(a, b) { return (Date.parse(b) - Date.parse(a)) / DAY; }

// per-side residual units for one fight: { att: [yA, muA, yB, muB], ... } or null (no actual totals / reference)
function residualUnits(f, ref) {
  if (!f.actual || !f.actual.A || !f.actual.B || !ref || !ref.st) return null;
  const mins = f.actual.minutes;
  if (!(mins > 0)) return null;
  const st = ref.st, rm = ref.mins;
  const out = {};
  for (const k of KEYS) out[k] = [];
  for (let s = 0; s < 2; s++) {
    const a = f.actual[s ? "B" : "A"], o = s * NS;
    const e = (stat) => st[o + IX[stat]];
    out.att.push(a.sig_att, rm > 0 ? e("sig_att") / rm * mins : 0);
    out.acc.push(a.sig_lnd, e("sig_att") > 0 ? e("sig_lnd") / e("sig_att") * a.sig_att : 0);
    out.td.push(a.td_att, rm > 0 ? e("td_att") / rm * mins : 0);
    out.ctrl.push(a.ctrl, rm > 0 ? e("ctrl") / rm * mins : 0);
    out.kd.push(a.kd, e("h_lnd") > 0 ? e("kd") / e("h_lnd") * a.h_lnd : 0);
  }
  return out;
}

// fights: backtest-style fights (date, id, actual); refById: Map or object id -> { st (2 x 10 per-side means), mins }
function computeLevels(fights, refById, cfg) {
  cfg = Object.assign({}, DEFAULT_CFG, cfg || {});
  const phi = cfg.phi || {};
  const get = (id) => (refById instanceof Map ? refById.get(id) : refById[id]);
  const sorted = fights.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // cards = distinct dates, in order
  const cards = [];
  for (const f of sorted) {
    if (!cards.length || cards[cards.length - 1].date !== f.date) cards.push({ date: f.date, fights: [] });
    cards[cards.length - 1].fights.push(f);
  }
  const st = {};
  for (const k of KEYS) {
    const c = cfg[k];
    if (c.kind === "kal") st[k] = { x: 0, P: cfg.p0sd * cfg.p0sd, last: null };
    else if (c.kind === "ew") st[k] = { sy: 0, sm: 0, last: null };
    else st[k] = { hist: [] };   // trail: [{date, y, mu}]
  }
  const byId = {}, trace = [];
  function factorsAt(date) {
    const g = {};
    for (const k of KEYS) {
      const c = cfg[k], s = st[k];
      let v = 1;
      if (c.kind === "kal") {
        v = Math.exp(s.x);
      } else if (c.kind === "ew") {
        const dec = s.last ? Math.pow(0.5, days(s.last, date) / 365.25 / c.h) : 1;
        v = (s.sy * dec + c.n0) / (s.sm * dec + c.n0);
      } else {
        let sy = 0, sm = 0;
        for (const r of s.hist) if (days(r.date, date) <= c.days) { sy += r.y; sm += r.mu; }
        v = (sy + c.n0) / (sm + c.n0);
      }
      g[k] = Math.min(cfg.clip[1], Math.max(cfg.clip[0], v));
    }
    return g;
  }
  for (const card of cards) {
    // 1) factors for every fight on this card: from cards strictly before it
    const g = factorsAt(card.date);
    for (const f of card.fights) byId[f.id] = g;
    trace.push(Object.assign({ date: card.date }, g));
    // 2) update the trackers with this card
    const Y = {}, M = {};
    for (const k of KEYS) { Y[k] = 0; M[k] = 0; }
    let used = 0;
    for (const f of card.fights) {
      const u = residualUnits(f, get(f.id));
      if (!u) continue;
      used++;
      for (const k of KEYS) { Y[k] += u[k][0] + u[k][2]; M[k] += u[k][1] + u[k][3]; }
    }
    if (!used) continue;
    for (const k of KEYS) {
      const c = cfg[k], s = st[k];
      if (!(M[k] > 0)) continue;
      if (c.kind === "kal") {
        if (s.last) s.P += c.q * days(s.last, card.date) / 365.25;
        const z = Math.log((Y[k] + 0.5) / (M[k] + 0.5));
        const R = (phi[k] != null ? phi[k] : 1) / M[k] + c.se * c.se;
        const K = s.P / (s.P + R);
        s.x += K * (z - s.x); s.P *= 1 - K; s.last = card.date;
      } else if (c.kind === "ew") {
        const dec = s.last ? Math.pow(0.5, days(s.last, card.date) / 365.25 / c.h) : 1;
        s.sy = s.sy * dec + Y[k]; s.sm = s.sm * dec + M[k]; s.last = card.date;
      } else {
        s.hist.push({ date: card.date, y: Y[k], mu: M[k] });
        while (s.hist.length && days(s.hist[0].date, card.date) > c.days + 1) s.hist.shift();
      }
    }
  }
  return { byId, trace, cfg };
}

// Pearson dispersion of y around mu per fighter-side (both corners), for the Kalman observation variance
function dispersion(fights, refById, years) {
  const get = (id) => (refById instanceof Map ? refById.get(id) : refById[id]);
  const out = {};
  for (const k of KEYS) out[k] = { num: 0, den: 0, n: 0 };
  for (const f of fights) {
    if (years && !years.includes(+f.date.slice(0, 4))) continue;
    const u = residualUnits(f, get(f.id));
    if (!u) continue;
    for (const k of KEYS) for (let s = 0; s < 2; s++) {
      const y = u[k][2 * s], mu = u[k][2 * s + 1];
      if (!(mu > 0)) continue;
      out[k].num += (y - mu) * (y - mu); out[k].den += mu; out[k].n++;
    }
  }
  const phi = {};
  for (const k of KEYS) phi[k] = out[k].den > 0 ? out[k].num / out[k].den : 1;
  return { phi, detail: out };
}

// eradrift verified 10-8 tracker at a date (month-start step function, fit on fights before that month)
let ER = null;
function eradrift() { if (!ER) ER = readJSON("data/derived/eradrift.json"); return ER; }
function r108At(date) {
  const E = eradrift(), months = E.meta.months, m = String(date).slice(0, 7) + "-01";
  let i = months.indexOf(m);
  if (i < 0) { if (m > months[months.length - 1]) i = months.length - 1; else throw new Error("v9_levels: no r108 level for " + date); }
  return E.levels.r108.league[i];
}
function r108Ref() {
  const E = eradrift(), months = E.meta.months;
  let s = 0, n = 0;
  months.forEach((m, i) => { if (m >= "2021-01-01" && m < "2024-01-01") { s += E.levels.r108.league[i]; n++; } });
  return s / n;
}

module.exports = { computeLevels, dispersion, residualUnits, r108At, r108Ref, DEFAULT_CFG, KEYS, STATS };

// ------------------------------------------------------------------ CLI
if (require.main === module) {
  const a = process.argv.slice(2), cmd = a[0], file = a[1];
  const opt = {}; for (let i = 2; i < a.length; i++) if (a[i].startsWith("--")) { opt[a[i].slice(2)] = a[i + 1]; i++; }
  if (!cmd || !file) { console.error("usage: v9_levels.js phi|build <reference run json> [--years ..] [--arm cmp4] [--out ..]"); process.exit(2); }
  const R = readJSON(file), arm = opt.arm || "cmp4";
  const bt = readJSON("data/derived/backtest_dev.json");
  const btById = new Map(bt.fights.filter((f) => f.date < "2026-01-01").map((f) => [f.id, f]));
  const ref = new Map(), fights = [];
  for (const r of R.fights) {
    if (r.err) continue;
    const x = r.arms ? r.arms[arm] : r;
    if (!x) continue;
    ref.set(r.id, { st: x.st, mins: x.mins });
    fights.push(btById.get(r.id));
  }
  if (cmd === "phi") {
    const years = opt.years ? opt.years.split(",").map(Number) : null;
    const d = dispersion(fights, ref, years);
    console.log(JSON.stringify(d, null, 1));
    if (opt.out) fs.writeFileSync(path.resolve(ROOT, opt.out), JSON.stringify({ meta: { tool: "tools/v9_levels.js phi", source: file, arm, years, built: new Date().toISOString() }, phi: d.phi, detail: d.detail }, null, 1));
  } else if (cmd === "build") {
    const phi = opt.phi ? readJSON(opt.phi).phi : null;
    const L = computeLevels(fights, ref, { phi });
    const out = { meta: { tool: "tools/v9_levels.js build", source: file, arm, cfg: L.cfg, built: new Date().toISOString() }, byId: L.byId, trace: L.trace };
    if (opt.out) fs.writeFileSync(path.resolve(ROOT, opt.out), JSON.stringify(out));
    else console.log(JSON.stringify(L.trace.slice(-5), null, 1));
  }
}
