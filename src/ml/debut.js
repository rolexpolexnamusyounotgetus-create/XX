/* debut.js: the debut-path model (tools/debut.py, research/model_debut.md) for bouts with a UFC debutant.

   const Debut = require("./src/ml/debut.js");
   const M = Debut.load(require("./data/derived/debut.json").model);
   M.winner(sideA, sideB)                          -> P(A wins | decisive), corner-symmetric by construction
   M.method(sideA, sideB, { division, rounds, pA }) -> { A: [ko, sub, dec] given A wins, B: [...], marginal: [...],
                                                        whohow: { A: [...], B: [...] } }  (P(winner, method))
   M.predict(sideA, sideB, bout)                   -> winner by regime + method, with the source of each number
     bout = { division, rounds, p_close, p_open }  (lines optional: no-line / open / close regimes)

   A side is a plain object in the model's side columns (data/derived/debut.json model.side_columns): elo (Elo / 100),
   debut, logn, uwin, ufin, ufinl, age, lay, wcmove, g4.0_th / _sos / _sd, am_n, am_wpct, pre_tuf, short, repl,
   miss, pre_* ...; _n = prior UFC bouts. A missing or null column is unknown and enters at the training mean (it
   contributes 0), exactly as in tools/debut.py DebutLR. Method columns: pre_ko, pre_sub, pre_kol, pre_subl (pre-UFC
   rates, used only when pav = 1, i.e. the pre-UFC page is known), uko_w, usub_w, uko_l, usub_l (UFC counts).

   Regimes (frozen by forward-chained CV 2019-2023, tools/debut.py cv): no line -> the debut model (or its CV-chosen
   stack); opening line -> stack [open, debut] only if CV admitted the debut model there; closing line -> the stack
   [close, debut] if CV admitted it, else the close alone (the debut model never overrides a close it did not beat). */
"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DebutModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DIV_LBS = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
    "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
    "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145 };
  const fin = (x) => typeof x === "number" && isFinite(x);
  const clip = (p, c) => Math.min(Math.max(p, c), 1 - c);
  const logit = (p, c) => { const q = clip(p, c); return Math.log(q / (1 - q)); };
  const sig = (z) => 1 / (1 + Math.exp(-z));

  function load(model) {
    const W = model.winner, Mm = model.method;
    const faded = new Set(W.faded || []);
    function sideVec(s) {
      const n = fin(s._n) ? s._n : 0, f = Math.exp(-n / W.tau);
      return W.cols.map((k, j) => {
        const v = s[k];
        let x = fin(v) ? v - W.mu[j] : 0;
        if (faded.has(k)) x *= f;
        return x;
      });
    }
    function winner(a, b) {
      const xa = sideVec(a), xb = sideVec(b);
      let z = 0;
      for (let j = 0; j < W.cols.length; j++) z += ((xa[j] - xb[j]) / W.sd[j]) * W.coef[j];
      return sig(z);
    }
    function methodSide(s) {
      const n = fin(s._n) ? s._n : 0, pav = fin(s.pav) ? s.pav : (s.debut ? 1 : 0);
      const fade = Math.exp(-n / 4) * pav;
      const nz = (v, d) => (fin(v) ? v : d);
      return { ko: nz(s.pre_ko, 0.3) * fade, sub: nz(s.pre_sub, 0.15) * fade, kol: nz(s.pre_kol, 0.15) * fade,
        subl: nz(s.pre_subl, 0.08) * fade, uko: (nz(s.uko_w, 0) + 0.3) / (n + 2), usub: (nz(s.usub_w, 0) + 0.2) / (n + 2),
        ukol: (nz(s.uko_l, 0) + 0.2) / (n + 2), usubl: (nz(s.usub_l, 0) + 0.1) / (n + 2), debut: s.debut ? 1 : 0 };
    }
    function condMethod(w, l, bout, pW) {
      const lbs = (DIV_LBS[bout.division] || 160) / 100;
      const x = [w.ko, w.sub, w.uko, w.usub, l.kol, l.subl, l.ukol, l.usubl, Math.abs(logit(pW, 0.01)),
        (bout.rounds || 3) >= 5 ? 1 : 0, lbs, String(bout.division || "").startsWith("Women") ? 1 : 0, w.debut, l.debut];
      const base = (model.live_division_base[bout.division] || model.live_division_base._all);
      const eta = [0, 0, 0].map((_, c) => Math.log(base[c]));
      for (let c = 0; c < 2; c++) {
        let e = Mm.W[c][0];
        for (let j = 0; j < x.length; j++) e += ((x[j] - Mm.mu[j]) / Mm.sd[j]) * Mm.W[c][j + 1];
        eta[c] += e;
      }
      const mx = Math.max(...eta), ex = eta.map((e) => Math.exp(e - mx)), S = ex[0] + ex[1] + ex[2];
      return ex.map((e) => e / S);
    }
    function method(a, b, bout) {
      const pA = fin(bout.pA) ? bout.pA : winner(a, b);
      const sa = methodSide(a), sb = methodSide(b);
      // the Python fit feeds |logit p(A)| to both rows (the mismatch is symmetric)
      const A = condMethod(sa, sb, bout, pA), B = condMethod(sb, sa, bout, pA);
      const marginal = A.map((v, c) => pA * v + (1 - pA) * B[c]);
      return { A, B, marginal, whohow: { A: A.map((v) => pA * v), B: B.map((v) => (1 - pA) * v) }, pA,
        classes: Mm.classes };
    }
    function stack(reg, ps) {
      const st = model.stacks[reg];
      let z = 0;
      for (let j = 0; j < st.experts.length; j++) z += st.weights[j] * logit(ps[st.experts[j]], st.pclip);
      return sig(z);
    }
    function predict(a, b, bout) {
      bout = bout || {};
      const sd = model.stack_decisions;
      const pd = winner(a, b);
      const out = { p_debut: pd, p_noline: pd, src_noline: "debut model" };
      if (sd.noline && sd.noline !== "raw debut" && fin(bout.p_seeded)) {
        out.p_noline = stack("noline", { debut: pd, seeded_elo: bout.p_seeded });
        out.src_noline = "debut stack (" + sd.noline + ")";
      }
      if (fin(bout.p_open)) {
        if (sd.open && sd.open.debut_enters) { out.p_open = stack("open", { open: bout.p_open, debut: pd }); out.src_open = "stack [open, debut]"; }
        else { out.p_open = bout.p_open; out.src_open = "opening line alone (CV kept the debut model out)"; }
      }
      if (fin(bout.p_close)) {
        if (sd.close && sd.close.debut_enters) { out.p_close = stack("close", { close: bout.p_close, debut: pd }); out.src_close = "stack [close, debut]"; }
        else { out.p_close = bout.p_close; out.src_close = "closing line alone (CV kept the debut model out)"; }
      }
      const pBest = fin(out.p_close) ? out.p_close : fin(out.p_open) ? out.p_open : out.p_noline;
      out.method = method(a, b, { division: bout.division, rounds: bout.rounds, pA: pBest });
      // adopted path (model.adoption: the decision rule applied to the 2024-25 look). A "fallback"/"line" entry means
      // the ledger keeps its own number (bout.p_seeded = its seeded-Elo P(a); the line as given); method follows it.
      const ad = model.adoption;
      if (ad) {
        const A = {};
        A.p_noline = ad.winner_noline === "debut" ? out.p_noline : (fin(bout.p_seeded) ? bout.p_seeded : null);
        A.src_noline = ad.winner_noline === "debut" ? out.src_noline : "ledger fallback (seeded Elo)";
        if (fin(bout.p_open)) { A.p_open = ad.winner_open === "stack_open" ? out.p_open : bout.p_open; A.src_open = ad.winner_open; }
        if (fin(bout.p_close)) { A.p_close = ad.winner_close === "stack_close" ? out.p_close : bout.p_close; A.src_close = ad.winner_close; }
        const pw = fin(A.p_close) ? A.p_close : fin(A.p_open) ? A.p_open : (fin(A.p_noline) ? A.p_noline : pd);
        A.method = ad.method === "debut" ? method(a, b, { division: bout.division, rounds: bout.rounds, pA: pw }) : null;
        A.method_src = ad.method === "debut" ? "debut method model, P(a) = " + (fin(A.p_close) ? "close" : fin(A.p_open) ? "open" : fin(A.p_noline) ? "adopted no-line" : "debut model") : "division base rates";
        out.adopted = A;
      }
      return out;
    }
    return { winner, method, predict, stack, sideVec };
  }
  // ---- side builders for the forward ledger (tools/forward_ledger.js --debut-model)
  const yearsBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
  const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  // bout flags: { repl, short, miss } given explicitly, else read from a debutant entry's bout.notice text
  function flagsFrom(entry, given) {
    const g = given || {};
    const notice = String(((entry || {}).bout || {}).notice || "");
    const days = fin(g.notice_days) ? g.notice_days : (fin(((entry || {}).bout || {}).notice_days) ? entry.bout.notice_days : null);
    const repl = fin(g.repl) ? g.repl : (/replac|stepp?ed in|short[- ]notice/i.test(notice) ? 1 : 0);
    const short = fin(g.short) ? g.short : (repl && fin(days) && days <= 21 ? 1 : (/short[- ]notice/i.test(notice) ? 1 : 0));
    const miss = fin(g.miss) ? g.miss : 0;
    return { repl, short, miss };
  }
  // a UFC veteran from data/derived/fighters.json (live record and Elo) + debut.json roster_gnet (network as of 2026-01-01)
  function sideFromProfile(prof, date, division, model, flags) {
    const rec = prof.record || {}, n = fin(prof.n_fights) ? prof.n_fights : (rec.w || 0) + (rec.l || 0) + (rec.d || 0) + (rec.nc || 0);
    const s = { _n: n, debut: 0, elo: fin(prof.elo) ? prof.elo / 100 : null, logn: Math.log1p(n),
      uwin: Math.log(((rec.w || 0) + 1.5) / ((rec.l || 0) + 1.5)),
      ufin: ((rec.ko_w || 0) + (rec.sub_w || 0) + 0.5) / (n + 2), ufinl: ((rec.ko_l || 0) + (rec.sub_l || 0) + 0.3) / (n + 2),
      age: prof.dob ? yearsBetween(prof.dob, date) : null,
      lay: prof.last_fight ? Math.log1p(Math.max(0, daysBetween(prof.last_fight, date))) : null,
      wcmove: (DIV_LBS[division] && DIV_LBS[prof.division]) ? Math.sign(DIV_LBS[division] - DIV_LBS[prof.division]) : 0,
      uko_w: rec.ko_w || 0, usub_w: rec.sub_w || 0, uko_l: rec.ko_l || 0, usub_l: rec.sub_l || 0, pav: 0 };
    const rg = (model.roster_gnet || {});
    const row = rg.fighters && prof.slug ? rg.fighters[prof.slug] : null;
    if (row) for (const h in row) {                 // { "<half-life>": [th, sd, sos, m] } as of 2026-01-01
      const v = row[h];
      s["g" + h + "_th"] = v[0]; s["g" + h + "_sd"] = v[1]; s["g" + h + "_sos"] = v[2]; s["g" + h + "_m"] = v[3];
    }
    return Object.assign(s, flagsFrom(null, flags));
  }
  // a debutant from a data/predictions/debutants_*.json entry (preufc.json-shaped; optional debut_model block written
  // by `python3 tools/debut.py features`)
  function sideFromDebutant(entry, date, model, flags) {
    const dv = entry.derived || {}, sp = dv.side_pre || {}, deb = entry.debut || {}, sh = entry.sherdog || {};
    const rec = entry.record || {}, dm = entry.debut_model || {};
    const dob = (entry.ufcstats_tott || {}).dob || sh.dob;
    const s = { _n: 0, debut: 1, elo: 15, logn: 0, uwin: 0, ufin: 0.25, ufinl: 0.15,
      age: dob ? yearsBetween(dob, date) : null,
      lay: fin(rec.layoff_days) ? Math.log1p(rec.layoff_days) : (fin(sp.pre_layoff) ? sp.pre_layoff : null), wcmove: 0,
      am_n: fin(dm.am_n) ? dm.am_n : (fin(sh.amateur_n) ? Math.log1p(sh.amateur_n) : null),
      am_wpct: fin(dm.am_wpct) ? dm.am_wpct : null,
      pre_tuf: fin(dm.pre_tuf) ? dm.pre_tuf : (fin(deb.exh_n) ? (deb.exh_n > 0 ? 1 : 0) : (fin(sp.pre_tuf) ? sp.pre_tuf : null)),
      uko_w: 0, usub_w: 0, uko_l: 0, usub_l: 0, pav: 1 };
    for (const k in sp) if (/^pre_/.test(k) && !(k in s)) s[k] = sp[k];
    for (const k in dm) if (/^g[0-9.]+_(th|sd|sos|m)$/.test(k)) s[k] = dm[k];
    return Object.assign(s, flagsFrom(entry, flags));
  }
  return { load, DIV_LBS, sideFromProfile, sideFromDebutant, flagsFrom };
});
