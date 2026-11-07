/* EraDrift: walk-forward league levels and level adjustments (tools/eradrift.py -> data/derived/eradrift.json).
 *
 *   const ED = EraDrift.load(doc);                      // doc = data/derived/eradrift.json
 *   EraDrift.level(ED, "kd100", "2025-06-01", "Lightweight")   // walk-forward level (month-start snapshot)
 *   EraDrift.current(ED, "slpm")                         // level after the last 2025 card (deployment)
 *   EraDrift.adjustCells(ED, cells, date, { candidate, division, rounds })
 *       cells: 7 bins [A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO] or the 23-cell methodround joint
 *       (XKO r1..5, XSUB r1..5, YKO r1..5, YSUB r1..5, XDEC, YDEC, DRAW).
 *       PRODUCTION: the identity (no candidate passed the forward-chained 2021-2023 gate). candidate names a
 *       monitored candidate: "M1_cv_final" (round-1 shape by format), "M2_fast_dec" (decision-vs-finish by
 *       division), "M3_both". P(A wins) is never changed; corner symmetric by construction.
 *   EraDrift.adjustStatMeans(ED, means, date, { all })    // statlines NB means x exp(offset) for the enabled
 *       stats (l_att, l_lnd: adopted by CV and confirmed on 2024-25); { all: true } applies every exported offset.
 *
 * Dates are ISO strings. Values are step functions over month starts (meta.months); on or after 2026-01-01 the
 * offsets switch to prod_2026 (what a model refit through 2025 starts with). No DOM, no network: Node and browser.
 */
(function (root) {
  "use strict";
  const R5 = 5, I_XKO = 0, I_XSUB = 5, I_YKO = 10, I_YSUB = 15, I_XDEC = 20, I_YDEC = 21, I_DRAW = 22;
  const C = 1e-6;

  function clip(p, lo, hi) { return p < lo ? lo : (p > hi ? hi : p); }
  function logit(p) { p = clip(p, C, 1 - C); return Math.log(p / (1 - p)); }
  function sig(z) { return 1 / (1 + Math.exp(-z)); }

  function load(doc) {
    if (!doc || !doc.meta || !doc.levels) throw new Error("EraDrift.load: not an eradrift.json document");
    return { meta: doc.meta, levels: doc.levels, method: doc.method, stat: doc.stat || {} };
  }

  function monthIndex(months, iso) {
    let lo = 0, hi = months.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (months[mid] <= iso) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function isoOf(date) { return typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10); }

  function level(m, target, date, division) {
    const L = m.levels[target];
    if (!L) throw new Error("EraDrift.level: unknown target " + target);
    const i = monthIndex(m.meta.months, isoOf(date));
    if (i < 0) return null;
    if (division && L.div[division]) return L.div[division][i];
    return L.league[i];
  }

  function current(m, target, division) {
    const L = m.levels[target];
    if (!L) throw new Error("EraDrift.current: unknown target " + target);
    return (division && L.current[division] != null) ? L.current[division] : L.current.ALL;
  }

  function candidateOffsets(m, cand, date, division, rounds) {
    const out = { fin: 0, ko: 0, r1: 0 };
    if (!cand) return out;
    const cd = m.method && m.method.candidates && m.method.candidates[cand];
    if (!cd) throw new Error("EraDrift: unknown candidate " + cand);
    const iso = isoOf(date);
    const i = monthIndex(m.meta.months, iso);
    const prod = iso >= "2026-01-01";
    for (const split of ["fin", "ko", "r1"]) {
      const c = cd.splits[split];
      if (!c || i < 0) continue;
      let g = "ALL";
      if (c.group === "format") g = rounds === 5 ? "5" : "3";
      else if (c.group === "division") g = (division && c.values[division]) ? division : "ALL";
      const v = prod ? c.prod_2026[g] : c.values[g][i];
      out[split] = v == null ? 0 : v;
    }
    return out;
  }

  // six-class [XKO, XSUB, XDEC, YDEC, YSUB, YKO] with the decision-vs-finish and KO-vs-SUB offsets; side totals kept
  function sideAdjust(pko, psb, pde, aFin, aKo) {
    const pw = pko + psb + pde;
    const tot = Math.max(pw, 1e-12);
    const f = clip((pko + psb) / tot, C, 1 - C);
    const k = clip(pko / Math.max(pko + psb, 1e-12), C, 1 - C);
    const f2 = sig(logit(f) + aFin), k2 = sig(logit(k) + aKo);
    return [pw * f2 * k2, pw * f2 * (1 - k2), pw * (1 - f2)];
  }

  function adjustBins7(b, aFin, aKo) {
    const [AKO, ASUB, ADEC, DR, BDEC, BSUB, BKO] = b;
    const ds = ADEC + BDEC;
    const dc = ds + DR > 0 ? DR / Math.max(ds + DR, 1e-300) : 0;
    const shA = ds > 0 ? ADEC / Math.max(ds, 1e-300) : 0.5;
    const A = sideAdjust(AKO, ASUB, ADEC + DR * shA, aFin, aKo);
    const B = sideAdjust(BKO, BSUB, BDEC + DR * (1 - shA), aFin, aKo);
    return [A[0], A[1], A[2] * (1 - dc), (A[2] + B[2]) * dc, B[2] * (1 - dc), B[1], B[0]];
  }

  function adjustJoint(J, aFin, aKo, aR1) {
    const sum = (a, s) => { let t = 0; for (let r = 0; r < R5; r++) t += a[s + r]; return t; };
    const xko = sum(J, I_XKO), xsb = sum(J, I_XSUB), yko = sum(J, I_YKO), ysb = sum(J, I_YSUB);
    const d = J[I_XDEC] + J[I_YDEC] + J[I_DRAW];
    const xs = J[I_XDEC] / Math.max(J[I_XDEC] + J[I_YDEC], 1e-12);
    const dc = d > 0 ? J[I_DRAW] / d : 0;
    const out = new Array(23).fill(0);
    const sides = [[xko, xsb, d * xs, I_XKO, I_XSUB, I_XDEC], [yko, ysb, d * (1 - xs), I_YKO, I_YSUB, I_YDEC]];
    for (const [ko, sb, de, iko, isb, ide] of sides) {
      const [pko, psb, pde] = sideAdjust(ko, sb, de, aFin, aKo);
      for (const [mass, base] of [[pko, iko], [psb, isb]]) {
        const tot = Math.max(sum(J, base), 1e-12);
        const sh = []; for (let r = 0; r < R5; r++) sh.push(J[base + r] / tot);
        const s1 = clip(sh[0], C, 1 - C);
        const s1n = sig(logit(s1) + aR1);
        const scale = (1 - s1n) / Math.max(1 - s1, 1e-12);
        out[base] = mass * s1n;
        for (let r = 1; r < R5; r++) out[base + r] = mass * sh[r] * scale;
      }
      out[ide] = pde * (1 - dc);
      out[I_DRAW] += pde * dc;
    }
    return out;
  }

  function adjustCells(m, cells, date, opts) {
    opts = opts || {};
    if (!opts.candidate) return cells.slice();          // production: identity
    const a = candidateOffsets(m, opts.candidate, date, opts.division, opts.rounds);
    if (cells.length === 7) return adjustBins7(cells, a.fin, a.ko);
    if (cells.length === 23) return adjustJoint(cells, a.fin, a.ko, a.r1);
    throw new Error("EraDrift.adjustCells: expected 7 bins or 23 joint cells");
  }

  function statOffset(m, st, date, opts) {
    const S = m.stat[st];
    opts = opts || {};
    if (!S || S.kind !== "nb" || !(S.enabled || opts.all)) return 0;
    const iso = isoOf(date);
    if (iso >= "2026-01-01") return S.prod_2026 || 0;
    const i = monthIndex(m.meta.stat_months, iso);
    return i < 0 ? 0 : (S.values[i] || 0);
  }

  function adjustStatMeans(m, means, date, opts) {
    const out = {};
    for (const st of Object.keys(means)) out[st] = means[st] * Math.exp(statOffset(m, st, date, opts));
    return out;
  }

  const api = { load, level, current, candidateOffsets, adjustBins7, adjustJoint, adjustCells, adjustStatMeans,
                statOffset, monthIndex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EraDrift = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
