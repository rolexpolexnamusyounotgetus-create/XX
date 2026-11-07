#!/usr/bin/env node
/* forward_statlines.js: the stat-line forecast block of forward model v4.2 (data/predictions/README.md, "Forward model
   v4.2", "Stat-line forecast block"), evaluated in Node and called by tools/forward_ledger.py after it has fixed each
   bout's primary method cells.

     node tools/forward_statlines.js <input.json> [--engine-dir versions/v4] [--pred-dir data/predictions] [--raw]

   input.json = { date: "YYYY-MM-DD", bouts: [{ bout_id, a, b, key_a, key_b, division, rounds, title, S }] }
     a / b    fighters.json slugs (null = UFC debut); key_a / key_b the slug or the debutant's slugified name (his
              data/predictions/debutants_*.json entry, same lookup as tools/forward_ledger.js)
     S        the bout's primary method cells by round, [a KO r1..R, a SUB r1..R, b KO r1..R, b SUB r1..R, a DEC, b DEC,
              draw] (4R + 3 numbers; any scale): the fight-length distribution, through StatDist.lengthGrid
   Output (stdout): { meta, bouts: [{ bout_id, stats, length: { p_distance, mean_minutes }, a: { stat: { mean, p10, p50,
   p90, blend_mean } }, b: {...}, inputs: {...} }] }

   Chain per fighter (the production chain of tools/statlines_matchup.js, with the event date): MLRates.predict
   (<engine-dir>/ml/mlrates.js on data/derived/mlrates.json; fighters.json profiles with meta.keys; ctx division, rounds,
   title, date, priors = fighters.json priors) -> FightEmbed matchup (src/ml/embed.js, data/derived/embed_model.json;
   hasEmb = both embeddings with expo > 0; win logit 0 without, as in training) -> oppadj roster factors
   (data/derived/oppadj.json, 1 when missing) -> StatDist "prod" tables (src/ml/statdist.js, data/derived/statlines.json),
   mixed over the length grid. A debutant is a training debut side: no UFC sums, n 0, Elo 1500, no KO losses, no home
   division, unknown layoff; date of birth, height, reach and stance from his entry (ufcstats tott, else Sherdog).
   p<q> = smallest integer y with mixture CDF(y) >= q; blend_mean = StatDist base rate (the mlrates + embedding blend)
   x the grid's expected minutes. No corner input: swapping a and b (and the two sides' S cells) swaps the lines.
   --live-dir <dir> (forward model v4.4): fighters.json is read from <dir>/fighters_live.json (tools/live_refresh.py);
   meta.live_dir says so. Without it the output is byte-identical to the tool before v4.4 (tests/test_forward_v44.js). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const engineDir = path.resolve(ROOT, opt("--engine-dir", path.join("versions", "v4")));
const RAW = args.indexOf("--raw") >= 0;
const MLRates = require(path.join(engineDir, "ml", "mlrates.js"));
const FE = require(path.join(ROOT, "src/ml/embed.js"));
const SDm = require(path.join(ROOT, "src/ml/statdist.js"));
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
const fin = (x) => typeof x === "number" && isFinite(x);
const r5 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 1e5) / 1e5;

const STAT_KEYS = ["sig_lnd", "sig_att", "td_lnd", "td_att", "ctrl", "kd", "sub_att"];
const input = JSON.parse(fs.readFileSync(args[0], "utf8"));
const LIVE_DIR = opt("--live-dir", null);                 // fwd-4.4: live roster (tools/live_refresh.py)
const FJ_PATH = LIVE_DIR ? path.join(path.relative(ROOT, path.resolve(ROOT, LIVE_DIR)), "fighters_live.json") : "data/derived/fighters.json";
const FJ = rd(FJ_PATH);
const MLM = MLRates.load(rd("data/derived/mlrates.json"));
const EMB = FE.load(rd("data/derived/embed_model.json"));
const OA = rd("data/derived/oppadj.json").roster || {};
const SD = SDm.load(rd("data/derived/statlines.json"), { which: "prod" });
const PRED_DIR = path.resolve(ROOT, opt("--pred-dir", path.join("data", "predictions")));
const DEBUT = {};                      // same precedence as tools/forward_ledger.js: "fighters" entries win over also_upcoming
const DEBUT_FILES = fs.existsSync(PRED_DIR) ? fs.readdirSync(PRED_DIR).filter((f) => /^debutants_.*\.json$/.test(f)).sort() : [];
const DOCS = DEBUT_FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(PRED_DIR, f), "utf8"))]);
for (const [f, d] of DOCS) for (const k in (d.also_upcoming || {})) DEBUT[k] = Object.assign({ _file: f + " also_upcoming" }, d.also_upcoming[k]);
for (const [f, d] of DOCS) for (const k in (d.fighters || {})) DEBUT[k] = Object.assign({ _file: f }, d.fighters[k]);

function inches(h) {
  if (fin(h)) return h;
  const m = /(\d+)\s*'\s*(\d+)/.exec(String(h || ""));
  return m ? 12 * +m[1] + +m[2] : null;
}
// a training debut side for MLRates (tools/mlrates.py: zero sums, n 0, Elo 1500, home None, layoff None)
function debutProfile(entry) {
  const tt = (entry && entry.ufcstats_tott) || {}, sh = (entry && entry.sherdog) || {};
  const h = inches(tt.height_in) != null ? inches(tt.height_in) : (inches(tt.height) != null ? inches(tt.height) : inches(sh.height));
  return { S: [], n: 0, elo: 1500, ko_losses: 0, dob: tt.dob || sh.dob || null, height_in: h,
    reach_in: fin(tt.reach_in) ? tt.reach_in : null, stance: tt.stance || null, home: null, layoff: null };
}
function profileOf(slug, key) {
  if (slug && FJ.fighters[slug]) return { prof: Object.assign({ keys: FJ.meta.keys }, FJ.fighters[slug]), src: "fighters.json" };
  if (key && DEBUT[key]) return { prof: debutProfile(DEBUT[key]), src: "debut side from " + DEBUT[key]._file };
  return { prof: debutProfile(null), src: "debut side without an entry (no bio)" };
}

const out = { meta: {
  tool: "tools/forward_statlines.js", stats: STAT_KEYS, statdist_set: SD.which,
  engine_dir: path.relative(ROOT, engineDir) || ".",
  mlrates_js_sha256_16: sha(path.join(engineDir, "ml", "mlrates.js")),
  statdist_js_sha256_16: sha(path.join(ROOT, "src/ml/statdist.js")), embed_js_sha256_16: sha(path.join(ROOT, "src/ml/embed.js")),
  statlines_sha256_16: sha(path.join(ROOT, "data/derived/statlines.json")),
  mlrates_sha256_16: sha(path.join(ROOT, "data/derived/mlrates.json")),
  embed_model_sha256_16: sha(path.join(ROOT, "data/derived/embed_model.json")),
  oppadj_sha256_16: sha(path.join(ROOT, "data/derived/oppadj.json")),
  fighters_sha256_16: sha(path.join(ROOT, FJ_PATH)),
  statlines_built: (rd("data/derived/statlines.json").meta || {}).built || null,
  debutant_files: DEBUT_FILES.map((f) => "data/predictions/" + f) }, bouts: [] };
if (LIVE_DIR) out.meta.live_dir = path.relative(ROOT, path.resolve(ROOT, LIVE_DIR));

for (const b of input.bouts) {
  const R = b.rounds === 5 ? 5 : 3;
  const ka = b.key_a || b.a, kb = b.key_b || b.b;
  const A = profileOf(b.a, ka), B = profileOf(b.b, kb);
  const pr = MLRates.predict(MLM, A.prof, B.prof, { division: b.division, rounds: R, title: !!b.title, date: input.date,
    priors: FJ.priors });
  const ea = b.a ? EMB.embedding(b.a) : null, eb = b.b ? EMB.embedding(b.b) : null;
  const hasEmb = !!(ea && eb && ea.expo > 0 && eb.expo > 0);
  const em = hasEmb ? EMB.matchup(b.a, b.b, { division: b.division, rounds: R, date: input.date }) : null;
  const P = SD.prepare({ mlA: pr.A, mlB: pr.B, etaA: em ? em.etaA : null, etaB: em ? em.etaB : null, hasEmb,
    winLogit: em ? em.logit : 0, oppA: (b.a && OA[b.a]) || null, oppB: (b.b && OA[b.b]) || null, rounds: R });
  const grid = SD.lengthGrid(b.S, R);
  let W = 0, Tm = 0;
  grid.w.forEach((w, i) => { W += w; Tm += w * grid.t[i]; });
  const meanMin = Tm / W;
  const line = (side) => {
    const o = {};
    for (const st of STAT_KEYS) {
      const d = P.mixture(side, st, grid);
      o[st] = { mean: d.mean, p10: d.quantile(0.1), p50: d.quantile(0.5), p90: d.quantile(0.9),
        blend_mean: P.base[side][st] * meanMin };
    }
    return o;
  };
  const rec = { bout_id: b.bout_id, stats: STAT_KEYS,
    length: { p_distance: grid.w[grid.w.length - 1] / W, mean_minutes: meanMin, grid_points: grid.t.length },
    a: line("A"), b: line("B"),
    inputs: { a: A.src, b: B.src, embedding: hasEmb, win_logit: em ? em.logit : 0,
      oppadj: { a: !!(b.a && OA[b.a]), b: !!(b.b && OA[b.b]) } } };
  out.bouts.push(RAW ? rec : JSON.parse(JSON.stringify(rec, (k, v) => (typeof v === "number" ? r5(v) : v))));
}
process.stdout.write(JSON.stringify(out));
