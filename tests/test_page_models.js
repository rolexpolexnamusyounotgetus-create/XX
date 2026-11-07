// Node test for the page's prediction stack (page pass 3, Nov 7, 2026): what build.py exports and src/ml/pagepredict.js
// does with it must be exactly the verified models.
//   node tests/test_page_models.js            (about 20 s; builds the blocks through build.py's own functions)
// 1. Winner: the page's ML v2 block carries forward_models.json ml2_static weights exactly, and PagePredict.winner reproduces
//    the Python vectors (tools/forward_models.py test_vectors) to 1e-9 in all three regimes: no line -> no-line stack,
//    pre-fight line -> open stack (multiplicative de-vig), closing line -> close stack (power de-vig). An opener never
//    reaches the close weights. Corner swap gives 1 - p. The page block equals ml2.json page_model + ml2_static on random
//    roster pairs (1e-12), and reproduces the committed Vegas 124 ledger file's ml2_stack_open / ml2_stack_noline (5 dp).
// 2. De-vig: EV / -110 (power 0.487963), multiplicative = proportional.
// 3. Method x round S2: the page block (vectors stripped) reproduces mr_s2.json's Python parity vectors to 1e-9.
// 4. Stat lines: the page block (prod tables, pruned embedding, compact oppadj) gives bit-identical lines to the full files,
//    and the prod fixtures of tests/fixtures/statdist_fixtures.json to the same tolerances as tests/test_statdist.js.
// 5. Debut method model: the page block equals the full debut.json model on the card desk's debutants.
// 6. Scorecard: every report-only number in data/derived/page_scorecard.json is quoted verbatim from its source; the
//    JSON-derived numbers equal their sources; the 2026 readout says "level with the market".
// 7. Forward ledger: the page's committed picks are byte-for-byte the committed file's (git show of the adding commit),
//    committed before the lock.
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const ROOT = path.join(__dirname, "..");
const ML2 = require(path.join(ROOT, "src/ml/ml2.js"));
const PP = require(path.join(ROOT, "src/ml/pagepredict.js"));
const MRL = require(path.join(ROOT, "tools/methodround_model.js"));
const SDm = require(path.join(ROOT, "src/ml/statdist.js"));
const FE = require(path.join(ROOT, "src/ml/embed.js"));
const DM = require(path.join(ROOT, "src/ml/debut.js"));
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
let fails = 0, checks = 0;
const check = (ok, msg, info) => { checks++; if (!ok) { fails++; console.error("FAIL: " + msg + (info !== undefined ? "  " + JSON.stringify(info) : "")); } };

// the blocks exactly as build.py writes them into the page (JSON round trip, NaN -> null as derived_gz does)
const py = "import sys, json; sys.path.insert(0, '.'); import build\n" +
  "out = {k: build.no_nan(f()) for k, f in [('ml2', build.ml2_block), ('s2', build.s2_block), ('sd', build.statdist_block), " +
  "('debut', build.debut_block), ('sc', build.scorecard_block), ('fwd', build.forward_block), ('mr', build.methodround_block)]}\n" +
  "sys.stdout.write(json.dumps(out, allow_nan=False))";
const B = JSON.parse(cp.execFileSync("python3", ["-c", py], { cwd: ROOT, maxBuffer: 1 << 29, stdio: ["ignore", "pipe", "inherit"] }).toString());

// ---------------------------------------------------------------- 1. winner
const FM = rd("data/derived/forward_models.json"), ML2J = rd("data/derived/ml2.json");
for (const reg of ["line", "open", "noline"]) {
  const a = B.ml2.stack[reg], b = FM.ml2_static[reg];
  check(JSON.stringify(a.inputs) === JSON.stringify(b.inputs) && a.weights.every((w, i) => w === b.weights[i]) && a.pclip === b.pclip, "page stack " + reg + " = forward_models.json ml2_static");
}
const H = ML2.load(B.ml2);
const HL = ML2.load(Object.assign({}, ML2J.page_model, { stack: FM.ml2_static }));     // the forward ledger's handle
const swapFight = (f) => { const g = Object.assign({}, f); if (f.fw) g.fw = { A: f.fw.B, B: f.fw.A }; return g; };
let d1 = 0, s1 = 0, nv = 0;
for (const v of FM.test_vectors) {
  if (v.fight.fw) continue;          // the page passes no fight-week block
  nv++;
  const no = PP.winner(H, v.a, v.b, v.fight, null);
  const op = PP.winner(H, v.a, v.b, v.fight, { kind: "open", pMult: v.p_open, pPow: 0.123 });
  const cl = PP.winner(H, v.a, v.b, v.fight, { kind: "close", pMult: 0.987, pPow: v.p_line });
  d1 = Math.max(d1, Math.abs(no.pML2 - v.pA), Math.abs(no.p - v.p_stack_noline), Math.abs(op.p - v.p_stack_open), Math.abs(cl.p - v.p_stack_line));
  check(no.kind === "none" && op.kind === "open" && cl.kind === "close", "regime routing " + v.a + " vs " + v.b);
  check(op.used.map((u) => u.key).join() === "open,ml2lr" && cl.used.map((u) => u.key).join() === "market,ml2lr" && no.used.map((u) => u.key).join() === "ml2lr,mkt_rating",
    "each regime reads its own inputs");
  check(Math.abs(op.p - cl.p) > 1e-6 || Math.abs(v.p_open - v.p_line) < 1e-9, "an opener does not reach the close weights");
  const w = PP.winner(H, v.b, v.a, swapFight(v.fight), { kind: "open", pMult: 1 - v.p_open });
  const wn = PP.winner(H, v.b, v.a, swapFight(v.fight), null);
  s1 = Math.max(s1, Math.abs(op.p + w.p - 1), Math.abs(no.p + wn.p - 1));
  check(no.zCheck < 1e-12 && op.zCheck < 1e-12, "contributions add up to the stack logit");
}
check(nv >= 20, "enough Python vectors without a fight-week block", nv);
let dfw = 0, nfw = 0;
for (const v of FM.test_vectors) {        // the fight-week vectors through the page block directly (the page itself passes none)
  if (!v.fight.fw) continue;
  const q = H.predict(v.a, v.b, v.fight, v.p_line, v.p_open); nfw++;
  dfw = Math.max(dfw, Math.abs(q.pA - v.pA), Math.abs(q.pStack - v.p_stack_noline), Math.abs(q.pStackOpen - v.p_stack_open), Math.abs(q.pStackLine - v.p_stack_line));
}
check(nfw > 0 && dfw <= 1e-9, "page block with fight-week inputs: max |js - python|", dfw);
check(d1 <= 1e-9, "winner: max |page - python| over " + nv + " vectors", d1);
check(s1 <= 1e-12, "winner: corner swap", s1);
// page block = ledger handle on random roster pairs
const slugs = Object.keys(B.ml2.roster);
let seed = 7, d2 = 0;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
for (let i = 0; i < 60; i++) {
  const a = slugs[Math.floor(rnd() * slugs.length)], b = slugs[Math.floor(rnd() * slugs.length)];
  if (a === b) continue;
  const f = { date: "2026-11-21", lbs: [125, 135, 145, 155, 170, 185, 205, 265][i % 8], five: i % 3 === 0 ? 1 : 0 }, po = 0.2 + 0.6 * rnd(), pl = 0.2 + 0.6 * rnd();
  const q = H.predict(a, b, f, pl, po), r = HL.predict(a, b, f, pl, po);
  d2 = Math.max(d2, Math.abs(q.pA - r.pA), Math.abs(q.pStack - r.pStack), Math.abs(q.pStackOpen - r.pStackOpen), Math.abs(q.pStackLine - r.pStackLine));
}
check(d2 <= 1e-12, "page block = ml2.json page_model + ml2_static on random pairs", d2);
// the committed Vegas 124 ledger: the page reproduces its ML v2 stacks from the same inputs
const LG = B.fwd && B.fwd.ledgers || [];
check(LG.length >= 1, "at least one committed ledger file in the page");
const LBS = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170, "Middleweight": 185,
  "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115, "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145 };
let nl = 0, d3 = 0;
for (const L of LG) {
  const raw = JSON.parse(cp.execFileSync("git", ["-C", ROOT, "show", L.commit + ":data/predictions/" + L.file]).toString());
  for (const b of raw.bouts) {
    if (!b.models || b.models.ml2_stack_open == null || !b.market) continue;
    const f = { date: raw.date, lbs: LBS[b.weight_class] || null, five: b.rounds === 5 ? 1 : 0 };
    const op = PP.winner(H, b.a.slug, b.b.slug, f, { kind: "open", pMult: b.market.p_a_open_stack_input });
    const no = PP.winner(H, b.a.slug, b.b.slug, f, null);
    d3 = Math.max(d3, Math.abs(op.p - b.models.ml2_stack_open), Math.abs(no.p - b.models.ml2_stack_noline), Math.abs(no.pML2 - b.models.ml2_lr));
    nl++;
  }
}
check(nl >= 10 && d3 <= 5.5e-6, "page reproduces the committed ledger's ML v2 open / no-line stacks and logistic (" + nl + " bouts, 5 dp)", d3);

// ---------------------------------------------------------------- 2. de-vig
const dv = PP.devig("EV", "-110");
check(Math.abs(dv.pPow - 0.487963) < 2e-4, "EV / -110 power de-vig", dv.pPow);
check(Math.abs(dv.pMult - 0.5 / (0.5 + 110 / 210)) < 1e-12, "EV / -110 multiplicative de-vig", dv.pMult);
const dv2 = PP.devig("+160", "-180"), dv3 = PP.devig("-180", "+160");
check(Math.abs(dv2.pMult + dv3.pMult - 1) < 1e-12 && Math.abs(dv2.pPow + dv3.pPow - 1) < 1e-9, "de-vig is symmetric");
check(PP.devig("abc", "-110").pMult === null, "bad odds give no line");

// ---------------------------------------------------------------- 3. S2
const S2full = rd("data/derived/mr_s2.json").js_model;
check(!("vectors" in B.s2), "the page's S2 block leaves the parity vectors out");
const S2 = MRL.createS2(B.s2, B.mr);
let d4 = 0;
for (const v of S2full.vectors) {
  const o = S2.fromFeatures(v.DA, v.DB, v.rounds);
  const want = v.joint23 || v.cells || v.out;
  if (Array.isArray(want)) for (let i = 0; i < want.length; i++) d4 = Math.max(d4, Math.abs((v.joint23 ? o.joint23 : o.cells)[i] - want[i]));
  else if (v.p6) for (let i = 0; i < 6; i++) d4 = Math.max(d4, Math.abs(o.p6[i] - v.p6[i]));
}
check(S2full.vectors.length >= 20 && d4 <= 1e-9, "S2 page block reproduces Python vectors", d4);
// S2 on a live pair through the page path: cells sum to 1, symmetric under a corner swap
{
  const FJ = rd("data/derived/fighters.json"), pa = FJ.fighters["alexander-volkanovski"], pb = FJ.fighters["justin-gaethje"];
  const f = { date: "2026-11-07", lbs: 155, five: 1 }, r = PP.winner(H, "alexander-volkanovski", "justin-gaethje", f, null);
  const inp = PP.s2Inputs(H, ML2.ratingProb, "alexander-volkanovski", "justin-gaethje", f, r);
  check(inp.src.join() === "z,zm,zw", "S2 inputs: ML v2 logit, market rating and round-level WHR", inp.src);
  const o = S2.predict(pa, pb, { slugA: "alexander-volkanovski", slugB: "justin-gaethje", division: "Lightweight", rounds: 5, title: true, date: "2026-11-07", s2: inp });
  const tot = o.cells.reduce((x, y) => x + y, 0);
  check(o.cells.length === 23 && Math.abs(tot - 1) < 1e-9, "S2 cells for Volkanovski vs Gaethje sum to 1", tot);
  const r2 = PP.winner(H, "justin-gaethje", "alexander-volkanovski", f, null);
  const inp2 = PP.s2Inputs(H, ML2.ratingProb, "justin-gaethje", "alexander-volkanovski", f, r2);
  const o2 = S2.predict(pb, pa, { slugA: "justin-gaethje", slugB: "alexander-volkanovski", division: "Lightweight", rounds: 5, title: true, date: "2026-11-07", s2: inp2 });
  check(Math.abs(o.bins7[0] - o2.bins7[6]) < 1e-12 && Math.abs(o.bins7[2] - o2.bins7[4]) < 1e-12, "S2 page path is corner-symmetric");
}

// ---------------------------------------------------------------- 4. stat lines
const SLfull = rd("data/derived/statlines.json"), EMfull = rd("data/derived/embed_model.json"), OAfull = rd("data/derived/oppadj.json").roster;
const SDp = SDm.load(B.sd.statlines, { which: "prod" }), SDf = SDm.load(SLfull, { which: "prod" });
const EMp = FE.load(B.sd.embed), EMf = FE.load(EMfull);
const OPP = {};
for (const s of Object.keys(B.sd.opp.roster)) { const row = B.sd.opp.roster[s], o = {}; B.sd.opp.keys.forEach((k, i) => { if (row[i] != null) o[k] = row[i]; }); OPP[s] = o; }
{
  const MLR = require(path.join(ROOT, "src/ml/mlrates.js")), FJ = rd("data/derived/fighters.json");
  const M = MLR.load(rd("data/derived/mlrates.json"));
  let same = true, nPair = 0;
  for (const [a, b, div, R] of [["alexander-volkanovski", "justin-gaethje", "Lightweight", 5], ["tom-aspinall", "ciryl-gane", "Heavyweight", 5], ["zhang-weili", "tatiana-suarez", "Women's Strawweight", 3]]) {
    const pa = Object.assign({ keys: FJ.meta.keys }, FJ.fighters[a]), pb = Object.assign({ keys: FJ.meta.keys }, FJ.fighters[b]);
    if (!FJ.fighters[a] || !FJ.fighters[b]) continue;
    const pr = MLR.predict(M, pa, pb, { division: div, rounds: R, title: R === 5, date: "2026-11-07", priors: FJ.priors });
    const run = (SD, EM, oa, ob) => {
      const em = EM.matchup(a, b, { division: div, rounds: R, date: "2026-11-07" }), has = (EM.embedding(a).expo || 0) > 0 && (EM.embedding(b).expo || 0) > 0;
      const P = SD.prepare({ mlA: pr.A, mlB: pr.B, etaA: em.etaA, etaB: em.etaB, hasEmb: has, winLogit: has ? em.logit : 0, oppA: oa, oppB: ob, rounds: R });
      const grid = SD.lengthGridSimple(0.5, (R === 5 ? [0.3, 0.24, 0.18, 0.15, 0.13] : [0.45, 0.33, 0.22]).map((x) => x * 0.5));
      return JSON.stringify([P.line("A", grid), P.line("B", grid), P.line("A", 5 * R)]);
    };
    const oaF = OAfull[a] ? Object.fromEntries(B.sd.opp.keys.map((k) => [k, OAfull[a][k]])) : null, obF = OAfull[b] ? Object.fromEntries(B.sd.opp.keys.map((k) => [k, OAfull[b][k]])) : null;
    same = same && run(SDp, EMp, OPP[a] || null, OPP[b] || null) === run(SDf, EMf, OAfull[a] || null, OAfull[b] || null) && run(SDf, EMf, oaF, obF) === run(SDf, EMf, OAfull[a] || null, OAfull[b] || null);
    nPair++;
  }
  check(nPair === 3 && same, "stat lines: page block (prod tables, pruned embedding, compact oppadj) = full files, bit for bit");
  // StatDist on the page block reproduces the Python fixtures (prod cases)
  const FX = rd("tests/fixtures/statdist_fixtures.json");
  let maxP = 0, nC = 0;
  for (const c of FX.cases) {
    if (c.which !== "prod") continue;
    const inp = c.input, P = SDp.prepare({ mlA: inp.ml, mlB: inp.mlo, etaA: inp.eta, etaB: inp.etao, hasEmb: inp.has_emb, winLogit: inp.win_logit, oppA: inp.opp, oppB: inp.oppo, rounds: inp.rounds });
    for (const st of Object.keys(c.out)) { const o = c.out[st], d = P.dist("A", st, c.t); maxP = Math.max(maxP, Math.abs(d.mean - o.mean) / Math.max(1e-9, Math.abs(o.mean))); }
    nC++;
  }
  check(nC >= 20 && maxP < 1e-7, "stat lines: page block reproduces the Python prod fixtures (" + nC + " cases)", maxP);
}

// ---------------------------------------------------------------- 5. debut method model
{
  const full = rd("data/derived/debut.json").model, Mp = DM.load(B.debut.model), Mf = DM.load(full), FJ = rd("data/derived/fighters.json");
  const keys = Object.keys(B.debut.debutants);
  check(keys.length >= 3, "debutant entries in the page", keys);
  let d5 = 0, n5 = 0;
  for (const k of keys) {
    const en = B.debut.debutants[k], opp = en.bout && en.bout.opponent ? en.bout.opponent : null;
    const vet = FJ.fighters["austin-bashi"] || FJ.fighters[Object.keys(FJ.fighters)[0]];
    const sd = DM.sideFromDebutant(en, "2026-11-07", B.debut.model), sv = DM.sideFromProfile(Object.assign({ slug: "x" }, vet), "2026-11-07", "Featherweight", B.debut.model);
    for (const pA of [0.3, 0.5, 0.8]) {
      const a = Mp.method(sv, sd, { division: "Featherweight", rounds: 3, pA }), b = Mf.method(sv, sd, { division: "Featherweight", rounds: 3, pA });
      for (let i = 0; i < 3; i++) d5 = Math.max(d5, Math.abs(a.A[i] - b.A[i]), Math.abs(a.B[i] - b.B[i]));
      check(Math.abs(a.A.reduce((x, y) => x + y, 0) - 1) < 1e-12, "debut method given the winner sums to 1");
      n5++;
    }
  }
  check(n5 > 0 && d5 === 0, "debut method: page block = full debut.json model", d5);
  // the page's debut cells keep each side's total and round shapes
  const c = { A: { ko: [0.1, 0.05, 0.02], sub: [0.03, 0.02, 0.01], dec: 0.27 }, B: { ko: [0.12, 0.06, 0.03], sub: [0.02, 0.01, 0.01], dec: 0.24 }, draw: 0.01 };
  const out = PP.debutCells(c, 3, { A: null, B: [0.5, 0.2, 0.3] });
  const tot = (s) => s.ko.reduce((x, y) => x + y, 0) + s.sub.reduce((x, y) => x + y, 0) + s.dec;
  check(Math.abs(tot(out.B) - tot(c.B)) < 1e-12 && JSON.stringify(out.A) === JSON.stringify(c.A) && Math.abs(out.B.dec / tot(out.B) - 0.3) < 1e-12, "debut cells keep totals and the other side");
}

// ---------------------------------------------------------------- 6. scorecard
{
  const N = B.sc.notes, src = {};
  const text = (f) => (src[f] = src[f] || fs.readFileSync(path.join(ROOT, f), "utf8"));
  const fmt = (x) => (x > 0 ? "+" : (x < 0 ? "-" : "")) + Math.abs(x).toFixed(4);
  for (const x of N.vault_2026_paired) {
    check(text(x.source).indexOf(x.quote) >= 0, "quote in " + x.source + ": " + x.quote);
    check(x.quote.indexOf(fmt(x.diff) + " [" + fmt(x.ci[0]) + ", " + fmt(x.ci[1]) + "]") >= 0, "numbers match their quote: " + x.key);
  }
  check(text(N.vault_2026_readout.source).indexOf(N.vault_2026_readout.quote) >= 0 && N.vault_2026_readout.text === "level with the market", "2026 readout quoted");
  check(text(N.valid_2021_2023_line_vs_close.source).indexOf(N.valid_2021_2023_line_vs_close.quote) >= 0, "2021-23 quote");
  const VH = rd("data/derived/version_history.json");
  for (const v of VH.versions) {
    const nt = N.engine_versions[v.version]; if (!nt || v.version === "v3") continue;
    const basis = (v.decision && v.decision.basis) || "";
    check(basis.indexOf(nt.quote) >= 0 && (!nt.quote2 || basis.indexOf(nt.quote2) >= 0), "engine " + v.version + " reason quotes its decision basis");
    check((nt.verdict === "kept") === (v.decision && v.decision.kept === true), "engine " + v.version + " verdict matches the history");
  }
  check(text("data/derived/version_history.json").indexOf(N.engine_versions.v3.quote) >= 0, "v3 reason quoted");
  const V = B.sc.valid, ML2R = ML2J.results.valid_2024_2025.static;
  check(V.ml2_lr.ll === 0.58865 && V.close.ll === 0.58537 && ML2R.ml2_lr.log_loss === V.ml2_lr.ll, "2024-25: ML v2 logistic 0.5887 vs close 0.5854");
  check(V.paired.line_stack_minus_close.diff === -0.00873 && V.paired.line_stack_minus_close_2021_2023.diff === -0.0015, "2024-25 with-line stack -0.0087; 2021-23 -0.0015");
  check(V.stack_noline.ll === FM.ml2_static.noline.valid_2024_2025_static.log_loss && V.stack_open.ll === FM.ml2_static.open.valid_2024_2025_static.log_loss, "page stacks' 2024-25 scores from forward_models.json");
  const VA = B.sc.vault;
  check(VA && VA.bench.close.log_loss === 0.6003 && VA.bench.ml2_stack_open_static.log_loss === 0.615 && VA.bench.open.log_loss === 0.6199, "2026: close 0.6003, ML v2 open stack 0.6150 vs open 0.6199");
  check(VA.bench.ml2_stack_close_static.log_loss >= 0.603 && VA.bench.ml2_stack_close_static.log_loss <= 0.608, "2026: ML v2 close stack within 0.603-0.608");
  check(VA.bench.stack_noline.log_loss === 0.6602 && VA.bench.stack_noline.slope < 0.6, "2026: old production no-line stack 0.6602, over-confident");
  const ce = VA.close_edge["ml2_stack_close_static-close"];
  check(ce.ci[0] < 0 && ce.ci[1] > 0 && /level with the market/.test(VA.close_edge.readout), "2026 close edge interval includes 0: level with the market");
}

// ---------------------------------------------------------------- 7. committed forward ledger
for (const L of LG) {
  check(/^[0-9a-f]{40}$/.test(L.commit || "") && L.committed_before_lock === true, L.file + ": commit hash and committed before the lock", [L.commit, L.commit_utc, L.lock_utc]);
  const raw = JSON.parse(cp.execFileSync("git", ["-C", ROOT, "show", L.commit + ":data/predictions/" + L.file]).toString());
  const byId = Object.fromEntries(raw.bouts.map((b) => [b.bout_id, b]));
  let same = L.bouts.length === raw.bouts.length;
  for (const b of L.bouts) {
    const r = byId[b.id];
    same = same && !!r && r.p_a === b.p_a && r.p_a_noline === b.p_noline && (r.models || {}).ml2_stack_noline === b.p_ml2_noline && (r.market || {}).p_a_novig === b.p_market && r.p_a_source === b.src;
  }
  check(same, L.file + ": page picks are the committed values, unchanged");
  check(L.lock_utc === raw.lock_utc && L.version === String(raw.model.version).split(":")[0], L.file + ": lock time and model version");
}

console.log("test_page_models: " + (checks - fails) + "/" + checks + " checks passed (winner " + d1.toExponential(1) + " over " + nv + " vectors, ledger " + d3.toExponential(1) +
  " over " + nl + " bouts, S2 " + d4.toExponential(1) + ")");
process.exit(fails ? 1 : 0);
