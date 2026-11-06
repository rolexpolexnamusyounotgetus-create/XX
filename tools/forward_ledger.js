#!/usr/bin/env node
/* forward_ledger.js: the page's forecast package for upcoming bouts, evaluated in Node (called by tools/forward_ledger.py).

     node tools/forward_ledger.js <input.json> [--engine-dir src] [--moe data/derived/blindtest_stack.json]   -> JSON on stdout
                                  [--pred-dir data/predictions] [--raw]   (debutants_*.json folder; no 5-decimal rounding)

   input.json = { date: "YYYY-MM-DD", sims: 2000, bouts: [{ bout_id, a, b, key_a, key_b, name_a, name_b, division, rounds,
                  title, p_line, p_open_in, p_novig }] }
   a / b are data/derived/fighters.json slugs (null or unknown = UFC debut); key_a / key_b the slug or, for a debutant, the
   slugified name (used to look up a pre-UFC seed); p_line the power de-vig of the consensus line at prediction time (the
   construction the close-trained stacks were fit on), p_open_in its multiplicative de-vig (the construction the
   open-trained stacks were fit on), p_novig the README benchmark (BestFightOdds mean, multiplicative); any may be null.

   Per bout, exactly what the page computes (src/app.js expertsFor + computeBlend):
   - experts: feat_lr (MoE.featLR on fighters.json profiles), elo, ml + elo_sig (MLPage on ml.json's page model and
     roster), mkt_rating (market.json ratings), engine (FightEngine.summarize with the learned stat-line rates, both
     corner orders averaged; draws removed);
   - the MoE stack (data/derived/moe_page.json, or --moe) without the line and, when p_line is given, with it as 'market';
   - the method-and-round model (tools/methodround_model.js; S without the line, SM with it), scaled to the stack's
     winner probability (head.bins7, finishing round, distance), as the page's headline does.

   Forward model v4.1 adds a per-bout "models" block (P(a wins | not a draw) per candidate model, null when the model
   cannot run; data/predictions/README.md pre-registers which one is p_a and how every one is scored):
     market_novig            the README benchmark line at prediction time (p_novig)
     stack_line              MoE stack, close-trained weights (--moe file's `model`), fed p_line  [= fwd-1's p_a]
     stack_open              MoE stack, open-trained weights (`model_open`), fed p_open_in
     stack_noline            MoE stack without a line                                             [= p_a_noline]
     ml2_lr                  ML v2 logistic page model (src/ml/ml2.js, data/derived/ml2.json page_model)
     ml2_stack_close         ML v2 page line stack, weights fit 2019-2023 on closing lines, fed p_line
     ml2_stack_open          ML v2 page open stack, weights fit 2019-2023 on opening lines, fed p_open_in
     ml2_stack_noline        ML v2 page no-line stack (ML v2 + market rating), weights fit 2019-2023
     ml2_stack_*_prod        the same three with the page's production weights (refit 2019-2025, ml2.json page_model.stack)
     whr_rounds              round-level WHR from data/derived/ratings.json's current roster ratings
     ratings_stack           ratings.json's rating stack (whr_rounds + glicko2 + dims, weights fit 2019-2023)
     elo                     fighters.json Elo; a debutant gets 1500 + his pre-UFC seed (data/predictions/debutants_*.json,
                             else preufc.json roster_priors elo_debut_shift), else 1500
     simulator               engine (src/engine3.js) summarize, both corner orders, learned stat-line rates
   The fit-2019-2023 ML v2 weights come from data/derived/forward_models.json (tools/forward_models.py export).
   Engine seeds depend on the unordered pair and the corner order of each run, so swapping a and b swaps the two runs
   and every model satisfies P(a | a, b) = 1 - P(b | b, a) (tests/test_forward_models.js).
   A bout with a debutant gets no stack (the stacks never saw a debut; the ledger falls back to its debut prior).
   --debut-model data/derived/debut.json (off by default) adds r.debut_path for such bouts: tools/debut.py's debut model
   (src/ml/debut.js) by regime plus P(method | winner); input bouts may carry flags_a / flags_b = { repl, short, miss,
   notice_days }. Nothing else in the output changes. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const engineDir = path.resolve(ROOT, opt("--engine-dir", "src"));
const E = require(path.join(engineDir, "engine3.js"));
const MLRates = require(path.join(engineDir, "ml", "mlrates.js"));
const MoE = require(path.join(ROOT, "src/ml/moe.js"));
const MLPage = require(path.join(ROOT, "src/ml/mlpage.js"));
const ML2 = require(path.join(ROOT, "src/ml/ml2.js"));
const MRm = require(path.join(ROOT, "tools/methodround_model.js"));
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const rdOpt = (p) => (fs.existsSync(path.join(ROOT, p)) ? rd(p) : null);
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
const shaOpt = (p) => (fs.existsSync(path.join(ROOT, p)) ? sha(path.join(ROOT, p)) : null);

const input = JSON.parse(fs.readFileSync(args[0], "utf8"));
const FJ = rd("data/derived/fighters.json");
const DB = E.loadDB(FJ);
let mlNative = false;
const mlr = rd("data/derived/mlrates.json");
if (typeof E.loadMLRates === "function") { E.loadMLRates(mlr); mlNative = true; } else MLRates.load(mlr);
const MOEJ = rd("data/derived/moe_page.json");                 // feat (the feature LR) always comes from here
const stackPath = opt("--moe", null);                            // e.g. data/derived/blindtest_stack.json
const STACKJ = stackPath ? JSON.parse(fs.readFileSync(path.resolve(ROOT, stackPath), "utf8")) : MOEJ;
const MOE = MoE.load(STACKJ);
const MOE_OPEN = STACKJ.model_open ? MoE.load(STACKJ, "model_open") : null;   // open-trained line weights (blindtest)
const mlj = rd("data/derived/ml.json");
const MLP = MLPage.load({ snapshot: mlj.page_model.snapshot, winner: mlj.page_model.winner, stack: mlj.page_model.stack,
  roster: mlj.roster });
const MKT = rd("data/derived/market.json");
const MKTR = {};
for (const s in MKT.ratings) { const r = MKT.ratings[s]; if (Array.isArray(r) && r.length >= 2) MKTR[s] = [r[0], r[1]]; }
const mrj = rd("data/derived/methodround.json").js_model;
const jm = Object.assign({}, mrj); delete jm.source;
const MR = MRm.create(jm);
const LBS = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170, "Middleweight": 185,
  "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115, "Women's Flyweight": 125, "Women's Bantamweight": 135,
  "Women's Featherweight": 145 };

// ---- forward model v4.1 inputs (each optional: a missing file leaves its models null and says so in meta)
const ML2J = rdOpt("data/derived/ml2.json");
const FMJ = rdOpt("data/derived/forward_models.json");
const ML2P = ML2J ? ML2.load(ML2J.page_model) : null;                                  // production stacks (2019-2025)
const ML2S = (ML2J && FMJ) ? ML2.load(Object.assign({}, ML2J.page_model, { stack: FMJ.ml2_static })) : null; // fit 2019-2023
const RTJ = rdOpt("data/derived/ratings.json");
const PUJ = rdOpt("data/derived/preufc.json");
const PRED_DIR = path.resolve(ROOT, opt("--pred-dir", path.join("data", "predictions")));   // where debutants_*.json live
const DEBUT_FILES = fs.existsSync(PRED_DIR) ? fs.readdirSync(PRED_DIR).filter((f) => /^debutants_.*\.json$/.test(f)).sort() : [];
const DEBUT = {};                                     // later files (sorted by name) override earlier ones
const DEBUT_DOCS = DEBUT_FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(PRED_DIR, f), "utf8"))]);
// a file's "also_upcoming" block (next card's debutants, same entry shape) is a fallback only: any "fighters" entry wins
for (const [f, d] of DEBUT_DOCS) for (const k in (d.also_upcoming || {})) DEBUT[k] = Object.assign({ _file: f + " also_upcoming" }, d.also_upcoming[k]);
for (const [f, d] of DEBUT_DOCS) for (const k in (d.fighters || {})) DEBUT[k] = Object.assign({ _file: f }, d.fighters[k]);
const SEED_LIVE = (() => {                            // preufc.json: production seeding betas (refit 2015-2025 debuts)
  const ms = ((PUJ || {}).eval || {}).models || {};
  for (const k in ms) if (/^seeded_elo_live/.test(k)) return Object.assign({ name: k }, ms[k]);
  return null;
})();
const DEBUT_ELO = 1500;                                // tools/build_db.py start rating
// ---- debut path (tools/debut.py, research/model_debut.md), OFF unless --debut-model <debut.json> is given. With it on,
// a bout with a debutant gets a separate r.debut_path block (winner by regime + method); the pre-registered models
// block, p_a and every other field are unchanged (tests/test_debut.js checks this).
const DEBUT_MODEL_PATH = opt("--debut-model", null);
const DMJ = DEBUT_MODEL_PATH ? JSON.parse(fs.readFileSync(path.resolve(ROOT, DEBUT_MODEL_PATH), "utf8")) : null;
const DebutJS = DMJ ? require(path.join(ROOT, "src/ml/debut.js")) : null;
const DMOD = DMJ ? DebutJS.load(DMJ.model) : null;
function debutPath(b, ctx, ka, kb) {
  const side = (slug, key, flags) => {
    if (slug && FJ.fighters[slug]) return { s: DebutJS.sideFromProfile(Object.assign({ slug }, FJ.fighters[slug]), ctx.date, ctx.division, DMJ, flags), src: "fighters.json + debut.json roster_gnet" };
    if (key && DEBUT[key]) return { s: DebutJS.sideFromDebutant(DEBUT[key], ctx.date, DMJ, flags), src: DEBUT[key]._file };
    return { s: { _n: 0, debut: 1, elo: 15, logn: 0, uwin: 0, ufin: 0.25, ufinl: 0.15, wcmove: 0 }, src: "debutant without an entry: unknown columns at the mean" };
  };
  const A = side(b.a, ka, b.flags_a), B = side(b.b, kb, b.flags_b);
  const pr = DMOD.predict(A.s, B.s, { division: ctx.division, rounds: ctx.rounds, p_close: fin(b.p_line) ? b.p_line : null,
    p_open: fin(b.p_open_in) ? b.p_open_in : null });
  const missing = (s) => DMJ.model.winner.cols.filter((k) => !fin(s[k]));
  return { p_a_debut: pr.p_debut, p_a_noline: pr.p_noline, p_a_open: fin(pr.p_open) ? pr.p_open : null, src_open: pr.src_open || null,
    p_a_close: fin(pr.p_close) ? pr.p_close : null, src_close: pr.src_close || null,
    method: { classes: pr.method.classes, given_a: pr.method.A, given_b: pr.method.B, marginal: pr.method.marginal, whohow_a: pr.method.whohow.A,
      whohow_b: pr.method.whohow.B, p_a_used: pr.method.pA },
    sides: { a: A.src, b: B.src }, unknown_columns: { a: missing(A.s), b: missing(B.s) },
    model: { built: DMJ.meta.built, decisions: DMJ.model.stack_decisions } };
}
const RAW = args.indexOf("--raw") >= 0;                // unrounded output (tests/test_forward_models.js)

function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }
const r5 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 1e5) / 1e5;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const sigm = (z) => 1 / (1 + Math.exp(-z));
const lgc = (p, c) => { p = Math.min(Math.max(p, c), 1 - c); return Math.log(p / (1 - p)); };
const fin = (x) => x != null && isFinite(x);
function slugify(s) {
  return String(s || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// seeds: one per (unordered pair, corner order of the run), so the swapped bout replays the same two simulations
function engineRun(pa, pb, ctx, N, pairId, ka, kb) {
  const one = (x, y, kx, ky) => {
    const o = { division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date };
    if (mlNative) {
      const M = E.mlModel ? E.mlModel() : MLRates.model();
      const p = MLRates.predict(M, x, y, { division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date, priors: DB.priors });
      o.ml = { pred: { A: p.A, B: p.B, base: p.base } };
    }
    return E.summarize(E.matchup(x, y, o), N, seedOf(pairId, kx + ">" + ky));
  };
  const s1 = one(pa, pb, ka, kb), s2 = one(pb, pa, kb, ka);
  const bins = s1.bins.map((v, i) => 0.5 * (v + s2.bins[6 - i]));
  const finA = s1.finA.map((v, i) => 0.5 * (v + s2.finB[i])), finB = s1.finB.map((v, i) => 0.5 * (v + s2.finA[i]));
  const pA = 0.5 * (s1.pA + s2.pB), pB = 0.5 * (s1.pB + s2.pA), pD = 0.5 * (s1.pD + s2.pD);
  return { pA, pB, pD, bins, finA, finB, dist: 0.5 * (s1.dist + s2.dist), pA_ab: s1.pA, pA_ba: s2.pB, n: 2 * N,
    mlApplied: mlNative };
}

function headFrom(p, mr, eng) {
  // src/app.js computeBlend: the stack's winner odds, the draw share and method/round cells of the method-and-round model
  if (p == null) return null;
  const pD = mr ? mr.pDraw : (eng ? eng.pD : 0.008);
  const qA = p * (1 - pD), qB = (1 - p) * (1 - pD);
  const h = { pA: qA, pB: qB, pD, src: null };
  if (mr) {
    const c = mr.cells, fA = qA / Math.max(1e-9, mr.pA), fB = qB / Math.max(1e-9, mr.pB);
    h.src = "methodround_" + mr.variant;
    h.bins7 = [sum(c.A.ko) * fA, sum(c.A.sub) * fA, c.A.dec * fA, pD, c.B.dec * fB, sum(c.B.sub) * fB, sum(c.B.ko) * fB];
    h.finA = c.A.ko.map((v, i) => (v + c.A.sub[i]) * fA);
    h.finB = c.B.ko.map((v, i) => (v + c.B.sub[i]) * fB);
  } else if (eng) {
    const f = MoE.winnerFactors(eng.pA, eng.pB, eng.pD, p);
    h.src = "engine";
    h.bins7 = eng.bins.map((v, i) => (i < 3 ? v * f.fA : (i > 3 ? v * f.fB : v)));
    h.finA = eng.finA.map((v) => v * f.fA); h.finB = eng.finB.map((v) => v * f.fB);
  }
  if (h.bins7) {
    h.p_distance = h.bins7[2] + h.bins7[3] + h.bins7[4];
    h.p_method = { a_ko: h.bins7[0], a_sub: h.bins7[1], a_dec: h.bins7[2], b_ko: h.bins7[6], b_sub: h.bins7[5], b_dec: h.bins7[4], draw: h.bins7[3] };
  }
  return h;
}

function roundObj(o) {
  if (Array.isArray(o)) return o.map(roundObj);
  if (o && typeof o === "object") { const q = {}; for (const k in o) q[k] = roundObj(o[k]); return q; }
  return typeof o === "number" ? r5(o) : o;
}

// ---- Elo with pre-UFC seeding for debutants (research/model_preufc.md, Recommendation 1)
function seedShift(rec) {
  // a debutants_*.json entry: elo_debut_shift (Elo points) as given, or computed from the standardized pre-UFC record
  // with preufc.json's live betas (missing features at the mean, i.e. z = 0, as preufc imputes them)
  if (fin(rec.elo_debut_shift)) return { shift: +rec.elo_debut_shift, how: "elo_debut_shift as given" };
  // the card desk's preufc.json-shaped entries nest the same values: derived.seeded_elo.elo_debut_shift (tools/preufc.py
  // seeded_elo with age at UFC debut), else derived.side_pre + derived.age_at_ufc_debut
  const dv = rec.derived || {};
  if (dv.seeded_elo && fin(dv.seeded_elo.elo_debut_shift)) return { shift: +dv.seeded_elo.elo_debut_shift,
    how: "derived.seeded_elo.elo_debut_shift as given" };
  const x = rec.pre || rec.features || (dv.side_pre ? Object.assign({ age_debut: dv.age_at_ufc_debut }, dv.side_pre) : null);
  if (x && SEED_LIVE) {
    let s = 0, used = 0;
    SEED_LIVE.keys.forEach((k, i) => { if (fin(x[k])) { s += SEED_LIVE.beta_elo_points_per_sd[i] * (x[k] - SEED_LIVE.mu[i]) / SEED_LIVE.sd[i]; used++; } });
    if (used) return { shift: s, how: "preufc.json " + SEED_LIVE.name + " betas on " + used + "/" + SEED_LIVE.keys.length + " features" };
  }
  return null;
}
function eloSide(slug, key) {
  if (slug && FJ.fighters[slug] && fin(FJ.fighters[slug].elo)) return { rating: FJ.fighters[slug].elo, source: "fighters.json elo" };
  const k = key || null;
  if (k && DEBUT[k]) {
    const s = seedShift(DEBUT[k]);
    if (s) return { rating: DEBUT_ELO + s.shift, shift: s.shift, source: DEBUT[k]._file + " (" + s.how + ")" };
  }
  const rp = k && PUJ && PUJ.roster_priors ? PUJ.roster_priors[k] : null;
  if (rp && fin(rp.elo_debut_shift)) return { rating: DEBUT_ELO + rp.elo_debut_shift, shift: rp.elo_debut_shift,
    source: "preufc.json roster_priors elo_debut_shift (at UFC debut)" };
  return { rating: DEBUT_ELO, shift: null, source: "debut 1500 (no pre-UFC seed found)" };
}

// ---- ratings.json current roster ratings: whr_rounds and the rating stack (tools/ratings.py matchup_probs)
function ratingsModels(sa, sb) {
  if (!RTJ || !sa || !sb) return null;
  const A = RTJ.roster[sa], B = RTJ.roster[sb], S = RTJ.systems;
  if (!A || !B) return null;
  const p = {};
  const sys = (name) => {
    const P = S[name], ra = A[name], rb = B[name];
    if (!P || !ra || !rb || !fin(ra.mu) || !fin(rb.mu)) return null;
    const kap = (P.params && fin(P.params.kappa)) ? P.params.kappa : 1.0;
    return ML2.ratingProb(P.kind, kap, { mu: ra.mu, sd: ra.sd || 0 }, { mu: rb.mu, sd: rb.sd || 0 });
  };
  const dims = () => {
    const m = (S.dims || {}).model;
    if (!m || !m.coef || !A.dims || !B.dims) return null;
    let z = 0;
    for (const feat in m.coef) {
      const i = feat.indexOf("_"), kind = feat.slice(0, i), dim = feat.slice(i + 1);
      const da = A.dims[dim], db = B.dims[dim];
      if (kind !== "adv" || !da || !db) return null;          // only the antisymmetric log-advantage form is used
      z += m.coef[feat] * ((da.off - db.def) - (db.off - da.def));
    }
    return sigm(z);
  };
  const want = new Set(["whr_rounds"].concat((S.stack || {}).members || []));
  for (const name of want) p[name] = name === "dims" ? dims() : sys(name);
  const out = { whr_rounds: p.whr_rounds };
  const st = S.stack;
  if (st && st.members.every((m) => fin(p[m]))) {
    let z = 0;
    st.members.forEach((m, i) => { z += st.weights[i] * lgc(p[m], 1e-6); });
    out.ratings_stack = sigm(z);
  } else out.ratings_stack = null;
  out.members = p;
  return out;
}

const MODEL_KEYS = ["market_novig", "stack_line", "stack_open", "stack_noline", "ml2_lr", "ml2_stack_close", "ml2_stack_open",
  "ml2_stack_noline", "ml2_stack_close_prod", "ml2_stack_open_prod", "ml2_stack_noline_prod", "whr_rounds", "ratings_stack",
  "elo", "simulator"];

const out = { meta: {
  engine_dir: path.relative(ROOT, engineDir) || ".", engine_version: E.VERSION,
  params_version: (() => { try { return require(path.join(engineDir, "params3.js")).version; } catch (e) { return null; } })(),
  engine_sha256_16: sha(path.join(engineDir, "engine3.js")), params_sha256_16: sha(path.join(engineDir, "params3.js")),
  mlrates_js_sha256_16: sha(path.join(engineDir, "ml", "mlrates.js")),
  moe_page_built: (MOEJ.meta || {}).built || null, moe_js: MoE.VERSION,
  stack_source: stackPath || "data/derived/moe_page.json", stack_built: (STACKJ.meta || {}).built || null,
  stack_sha256_16: sha(path.resolve(ROOT, stackPath || "data/derived/moe_page.json")), ml_page_snapshot: mlj.page_model.snapshot,
  ml_built: mlj.meta.built, market_built: MKT.meta.built, methodround_built: (rd("data/derived/methodround.json").meta || {}).built,
  roster_snapshot: (FJ.meta || {}).snapshot, mlrates_native: mlNative, sims_per_order: input.sims,
  model_keys: MODEL_KEYS, stack_open_available: !!MOE_OPEN,
  ml2_built: ML2J ? ML2J.meta.built : null, ml2_page_snapshot: ML2J ? ML2J.page_model.snapshot : null,
  ml2_sha256_16: shaOpt("data/derived/ml2.json"),
  forward_models_built: FMJ ? FMJ.meta.built : null, forward_models_sha256_16: shaOpt("data/derived/forward_models.json"),
  ml2_static_weights: FMJ ? Object.fromEntries(Object.entries(FMJ.ml2_static).map(([k, v]) => [k, { inputs: v.inputs, weights: v.weights }])) : null,
  ml2_prod_weights: ML2J ? Object.fromEntries(Object.entries(ML2J.page_model.stack || {}).map(([k, v]) => [k, { inputs: v.inputs, weights: v.weights }])) : null,
  ratings_built: RTJ ? RTJ.meta.built : null, ratings_snapshot: RTJ ? RTJ.meta.snapshot : null,
  ratings_sha256_16: shaOpt("data/derived/ratings.json"),
  ratings_stack: RTJ && RTJ.systems.stack ? { members: RTJ.systems.stack.members, weights: RTJ.systems.stack.weights } : null,
  preufc_built: PUJ ? PUJ.meta.built : null, preufc_sha256_16: shaOpt("data/derived/preufc.json"),
  seed_betas: SEED_LIVE ? SEED_LIVE.name : null,
  debutant_files: DEBUT_FILES.map((f) => ({ file: "data/predictions/" + f, sha256_16: sha(path.join(PRED_DIR, f)) }))
}, bouts: [] };
if (DMJ) out.meta.debut_model = { file: DEBUT_MODEL_PATH, built: DMJ.meta.built, sha256_16: sha(path.resolve(ROOT, DEBUT_MODEL_PATH)) };

for (const b of input.bouts) {
  const pa = b.a ? DB.fighters[b.a] : null, pb = b.b ? DB.fighters[b.b] : null;
  const ctx = { division: b.division, rounds: b.rounds === 5 ? 5 : 3, title: !!b.title, date: input.date };
  const r = { bout_id: b.bout_id, debut_a: !pa, debut_b: !pb, experts: {}, notes: [] };
  const ka = b.key_a || b.a || slugify(b.name_a), kb = b.key_b || b.b || slugify(b.name_b);
  const pairId = input.date + ":" + [ka, kb].sort().join("__");
  const hasLine = fin(b.p_line), hasOpen = fin(b.p_open_in);
  const M = {}; for (const k of MODEL_KEYS) M[k] = null;
  M.market_novig = fin(b.p_novig) ? b.p_novig : null;
  const ea = eloSide(pa ? b.a : null, ka), eb = eloSide(pb ? b.b : null, kb);
  M.elo = MoE.eloProb(ea.rating, eb.rating);
  r.elo_seed = { a: ea, b: eb };
  r.models = M;
  if (!pa || !pb) {
    r.notes.push("debut: not in fighters.json, no stack");
    if (DMOD) { try { r.debut_path = debutPath(b, ctx, ka, kb); } catch (e) { r.notes.push("debut path failed: " + (e.message || e)); } }
    out.bouts.push(RAW ? r : roundObj(r)); continue;
  }
  const o = { keys: FJ.meta.keys, snapshot: FJ.meta.snapshot, halfLife: FJ.meta.half_life_days || 730 };
  const A = MoE.sideFromProfile(pa, ctx.date, o), B = MoE.sideFromProfile(pb, ctx.date, o);
  const ex = r.experts;
  try { const fl = MoE.featLR(MOEJ.feat, A, B, { division: ctx.division, homeA: A.home, homeB: B.home }); if (isFinite(fl)) ex.feat_lr = fl; } catch (e) { r.notes.push("feat_lr failed"); }
  ex.elo = MoE.eloProb(A.elo, B.elo);
  const lbs = LBS[ctx.division] || 155;
  const ml = MLP.predict(b.a, b.b, { date: ctx.date, lbs, five: ctx.rounds === 5 ? 1 : 0, title: ctx.title ? 1 : 0,
    women: /^Women/.test(ctx.division || "") ? 1 : 0, "catch": LBS[ctx.division] ? 0 : 1 });
  if (ml && ml.pEloSig != null && isFinite(ml.pLR)) { ex.ml = ml.pLR; ex.elo_sig = ml.pEloSig; r.ml_platt = ml.pA; r.ml_stack = ml.pStack; }
  else r.notes.push("no ML page profile");
  const ra = MKTR[b.a], rb = MKTR[b.b];
  if (ra && rb) ex.mkt_rating = MoE.ratingProb(ra[0], ra[1], rb[0], rb[1]); else r.notes.push("no market rating");
  let eng = null;
  try { eng = engineRun(pa, pb, ctx, input.sims || 2000, pairId, ka, kb); ex.engine = eng.pA / Math.max(1e-9, eng.pA + eng.pB); }
  catch (e) { r.notes.push("engine failed: " + (e.message || e)); }
  const gate = MoE.gateFromSides(A, B, { division: ctx.division, rounds: ctx.rounds });
  let rNo = null, rLine = null, rOpen = null;
  try { rNo = MOE.predict({ experts: ex, gate }); } catch (e) { r.notes.push("stack (no line) failed: " + e.message); }
  if (hasLine) { try { rLine = MOE.predict({ experts: Object.assign({}, ex, { market: b.p_line }), gate }); } catch (e) { r.notes.push("stack (line) failed: " + e.message); } }
  if (hasOpen && MOE_OPEN) { try { rOpen = MOE_OPEN.predict({ experts: Object.assign({}, ex, { market: b.p_open_in }), gate }); } catch (e) { r.notes.push("stack (open weights) failed: " + e.message); } }
  let mrS = null, mrSM = null;
  try { mrS = MR.predict(pa, pb, { slugA: b.a, slugB: b.b, division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date }); } catch (e) { r.notes.push("methodround S failed"); }
  if (hasLine) { try { mrSM = MR.predict(pa, pb, { slugA: b.a, slugB: b.b, division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date, pMarketA: b.p_line }); } catch (e) { r.notes.push("methodround SM failed"); } }
  r.stack_noline = rNo ? { p: rNo.p, weights: rNo.weights, used: rNo.used, regime: rNo.regime } : null;
  r.stack_line = rLine ? { p: rLine.p, weights: rLine.weights, used: rLine.used, regime: rLine.regime } : null;
  r.stack_open = rOpen ? { p: rOpen.p, weights: rOpen.weights, used: rOpen.used, regime: rOpen.regime } : null;
  r.head_noline = headFrom(rNo ? rNo.p : null, mrS, eng);
  r.head_line = headFrom(rLine ? rLine.p : null, mrSM || mrS, eng);
  r.engine = eng ? { pA: eng.pA, pB: eng.pB, pD: eng.pD, bins7: eng.bins, finA: eng.finA, finB: eng.finB, dist: eng.dist,
    pA_ab: eng.pA_ab, pA_ba: eng.pA_ba, n: eng.n, ml_applied: eng.mlApplied } : null;
  r.methodround_S = mrS ? { pA: mrS.pA, pB: mrS.pB, pDraw: mrS.pDraw, bins7: mrS.bins7 } : null;
  r.mr_extras = { a: !!(MR.model.extras || {})[b.a], b: !!(MR.model.extras || {})[b.b] };
  // ---- models block (forward model v4.1)
  M.stack_line = rLine ? rLine.p : null;
  M.stack_open = rOpen ? rOpen.p : null;
  M.stack_noline = rNo ? rNo.p : null;
  M.simulator = fin(ex.engine) ? ex.engine : null;
  const fight2 = { date: ctx.date, lbs: LBS[ctx.division] || null, five: ctx.rounds === 5 ? 1 : 0 };
  const pl = hasLine ? b.p_line : undefined, po = hasOpen ? b.p_open_in : undefined;
  let q = null;
  try { q = ML2S ? ML2S.predict(b.a, b.b, fight2, pl, po) : (ML2P ? ML2P.predict(b.a, b.b, fight2, pl, po) : null); }
  catch (e) { r.notes.push("ml2 failed: " + (e.message || e)); }
  if (q) {
    M.ml2_lr = q.pA;
    if (ML2S) { M.ml2_stack_noline = q.pStack; M.ml2_stack_close = q.pStackLine; M.ml2_stack_open = q.pStackOpen; }
    const qp = ML2P ? ML2P.predict(b.a, b.b, fight2, pl, po) : null;
    if (qp) { M.ml2_stack_noline_prod = qp.pStack; M.ml2_stack_close_prod = qp.pStackLine; M.ml2_stack_open_prod = qp.pStackOpen; }
    r.ml2 = { pA: q.pA, pMR: q.pMR };
  } else r.notes.push(ML2J ? "no ML v2 roster row" : "ml2.json missing");
  if (ML2J && !FMJ) r.notes.push("forward_models.json missing: no fit-2019-2023 ML v2 stacks");
  const rt = ratingsModels(b.a, b.b);
  if (rt) { M.whr_rounds = rt.whr_rounds; M.ratings_stack = rt.ratings_stack; r.ratings_members = rt.members; }
  else r.notes.push(RTJ ? "no ratings.json roster row" : "ratings.json missing");
  out.bouts.push(RAW ? r : roundObj(r));
}
process.stdout.write(JSON.stringify(out));
