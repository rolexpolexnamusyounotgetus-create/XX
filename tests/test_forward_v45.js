#!/usr/bin/env node
/* tests/test_forward_v45.js: forward model v4.5 (data/predictions/README.md "Forward model v4.5 (Nov 7, 2026)").
     node tests/test_forward_v45.js          (about 40 s: evaluator runs and about fifteen dry runs of tools/forward_ledger.py)
   1. Identity of the older versions: JS --fwd 4.4 (line and no-line headline) and the tools/forward_ledger.py dry-run
      documents for fwd-4.4 (live set, both headlines; fallback) byte for byte against tests/fixtures/forward_v44_golden.json,
      captured from the tools before fwd-4.5 existed; JS --fwd 4.3 and the fwd-4.3 (x2) / fwd-4.2 / fwd-4.1 documents against
      tests/fixtures/forward_v43_golden.json. Skipped (and said so) when an input changed since a fixture.
   2. JS --fwd 4.5 = --fwd 4.4 apart from meta.fwd.
   3. Props absent -> identical to fwd-4.4: with no props snapshot (and with a snapshot that has nothing usable for the card)
      every bout field of the fwd-4.5 document equals fwd-4.4's; the one addition per bout is props_pool (applied false, with
      the reason); the model block names fwd-4.5, tool 1.5, the README section, the two added pins and the vault flag.
   4. A synthetic props snapshot (temporary folder) on the test card:
      - pooled bouts (no debutant, method props): the seven cells sum to 1, P(a | not a draw) = p_a, p_distance = a_dec +
        b_dec + draw, each side's p_finish_round sums to its KO + SUB; an independent re-implementation of the joint-linear
        pool from the fwd44_cells secondary and the props' m6 reproduces the cells; fwd44_cells equals fwd-4.4's method
        fields exactly; winner fields, models, stat lines and every other fwd-4.4 field are unchanged;
      - the rules of README v4.5 item 1: duplicate entries (most m6 books wins, not file order), a snapshot listed b / a
        (mirrored; the same result as the a / b listing), single-book props (flag props_single_book), no m6 family, a page
        fetched after the lock, no matching entry;
      - debut bouts: the primary is fwd-4.4's (debut method model); p_method_secondary.debut_props_pool equals an independent
        log-linear pool of given_a / given_b with the props (props.json debut production weights) and is composed as the
        primary (a cells sum to p_a (1 - dr)).
   5. Corner symmetry of the fwd-4.5 document with props (cards a / b reversed, the same snapshot).
   6. Scoring: compute_scores on a fwd-4.5 document with synthetic results adds scores.json "method_secondary" (primary minus
      fwd44_cells and minus debut_props_pool, the arithmetic checked independently); a fwd-4.4 document's scores have none.
   7. Guards: --fwd auto picks fwd-4.5 from 2026-11-14 (fwd-4.1 before); a fwd-4.4 write is refused; --props-dir and
      --live-dir are refused outside a dry run; the JS --props-pool mode refuses other parameters; a changed propspool.js or
      props.json hash is reported (pinned_mismatches_45) and refuses a write; the README fwd-4.5 table and full hashes equal
      the tool's pins and the files on disk; the README fwd-4.5 addendum names the code on disk. */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log("FAIL", msg); } };
const shaFile = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sha16 = (p) => shaFile(path.join(ROOT, p)).slice(0, 16);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwd45-"));
const G41 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v41_golden.json"), "utf8"));
const G42 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v42_golden.json"), "utf8"));
const G43 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v43_golden.json"), "utf8"));
const G44 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v44_golden.json"), "utf8"));
const PJ = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/props.json"), "utf8"));
for (const f in G41.debutant_files) fs.writeFileSync(path.join(tmp, f), JSON.stringify(G41.debutant_files[f]));
const writeJ = (name, o) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(o)); return f; };
const runJS = (inF, extra) => cp.execFileSync("node", [path.join(ROOT, "tools/forward_ledger.js"), inF, "--engine-dir",
  "versions/v4", "--moe", "data/derived/blindtest_stack.json", "--pred-dir", tmp, "--raw"].concat(extra || []),
{ cwd: ROOT, maxBuffer: 1 << 28 }).toString();
const LIVE = path.join(ROOT, "data/derived/live");
const DATE = G42.cards.events[0].date;
fs.mkdirSync(path.join(tmp, "odds")); fs.mkdirSync(path.join(tmp, "ledger")); fs.mkdirSync(path.join(tmp, "no_props"));
fs.writeFileSync(path.join(tmp, "odds", "odds_snapshot_" + G42.odds_snapshot.meta.stamp + ".json"), JSON.stringify(G42.odds_snapshot));
const cF = writeJ("cards.json", G42.cards);
const swapCards = JSON.parse(JSON.stringify(G42.cards));
for (const b of swapCards.events[0].bouts) { const t = b.a; b.a = b.b; b.b = t; }
const cR = writeJ("cards_rev.json", swapCards);
const py = (cardsF, extra) => cp.spawnSync("python3", [path.join(ROOT, "tools/forward_ledger.py"), "predict", "--event", DATE,
  "--cards", cardsF, "--odds-dir", path.join(tmp, "odds"), "--dir", path.join(tmp, "ledger")].concat(G44.py_common, extra),
{ cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const dry = (cardsF, name, extra) => {
  const o = path.join(tmp, name), r = py(cardsF, ["--dry-run", "--dry-out", o].concat(extra || []));
  if (r.status !== 0) { console.log(r.stdout.slice(-2000), r.stderr.slice(-2000)); throw new Error("dry run failed: " + name); }
  return JSON.parse(fs.readFileSync(o, "utf8"));
};
const normalize = (doc) => {
  const d = JSON.parse(JSON.stringify(doc));
  delete d.created_utc;
  for (const k of ["code_commit", "uncommitted_changes", "code_sha256_16"]) delete d.model[k];
  if (d.odds_snapshot) d.odds_snapshot.file = path.basename(d.odds_snapshot.file);
  const L = d.model.live_inputs;
  if (L && /no_such_live/.test(L.dir || "")) L.dir = "<tmp>/no_such_live";
  if (L && /no_such_live/.test(L.manifest || "")) L.manifest = "<tmp>/no_such_live/manifest.json";
  return JSON.stringify(d);
};
const near = (a, b, t) => Math.abs(a - b) <= t;
const CL = ["a_ko", "a_sub", "a_dec", "draw", "b_dec", "b_sub", "b_ko"];

// ---------------------------------------------------------------- 1. identity against the pre-fwd-4.5 tools
const inF = writeJ("in.json", G41.input);
const inN = writeJ("in_noline.json", Object.assign({}, G41.input, { headline: "noline" }));
const driftOf = (G) => Object.entries(G.inputs_sha256_16).filter(([f, h]) => sha16(f) !== h).map(([f]) => f);
const debNow = fs.readdirSync(path.join(ROOT, "data/predictions")).filter((f) => /^debutants_.*\.json$/.test(f)).sort()
  .map((f) => "data/predictions/" + f);
const debDriftOf = (G) => JSON.stringify(debNow) !== JSON.stringify(Object.keys(G.pred_dir_debutants)) ||
  debNow.some((f) => sha16(f) !== G.pred_dir_debutants[f]);
const drift44 = driftOf(G44), drift43 = driftOf(G43);
const liveDrift = Object.entries(G44.live_sha256_16).filter(([f, h]) => !fs.existsSync(path.join(ROOT, f)) || sha16(f) !== h).map(([f]) => f);
if (drift44.length) console.log("SKIP 1a JS --fwd 4.4 identity (inputs changed since the fixture: " + drift44.join(", ") + ")");
else {
  ok(runJS(inF, ["--fwd", "4.4"]) === G44.outputs.js_fwd44, "1a. JS --fwd 4.4 output is byte-identical to the pre-fwd-4.5 tool");
  ok(runJS(inN, ["--fwd", "4.4"]) === G44.outputs.js_fwd44_noline, "1a. JS --fwd 4.4 (headline noline) output is byte-identical");
}
if (drift43.length) console.log("SKIP 1a JS --fwd 4.3 identity (inputs changed since the fixture)");
else {
  ok(runJS(inF, ["--fwd", "4.3"]) === G43.outputs.js_fwd43, "1a. JS --fwd 4.3 output is byte-identical to the pre-fwd-4.4 tool");
  ok(runJS(inN, ["--fwd", "4.3"]) === G43.outputs.js_fwd43_noline, "1a. JS --fwd 4.3 (headline noline) output is byte-identical");
}
const D = {};
for (const k in G44.py_runs) D[k] = dry(cF, k + ".json", G44.py_runs[k].map((x) => x.replace("<tmp>", tmp)));
for (const k in G43.py_runs) D[k] = dry(cF, k + ".json", G43.py_runs[k]);
let n1 = 0;
for (const k in G44.py_runs) {
  const needsLive = G44.py_runs[k].indexOf("data/derived/live") >= 0;
  if (drift44.length || debDriftOf(G44) || (needsLive && liveDrift.length)) { console.log("SKIP 1b " + k + " (inputs, debutants or the live set changed since the fixture)"); continue; }
  ok(normalize(D[k]) === G44.outputs[k], "1b. tools/forward_ledger.py " + G44.py_runs[k].join(" ") + " dry run = the pre-fwd-4.5 document"); n1++;
}
for (const k in G43.py_runs) {
  if (drift43.length || debDriftOf(G43)) { console.log("SKIP 1b " + k); continue; }
  ok(normalize(D[k]) === G43.outputs[k], "1b. tools/forward_ledger.py " + G43.py_runs[k].join(" ") + " dry run = the pre-fwd-4.4 document"); n1++;
}
console.log("1. identity: JS --fwd 4.4 / 4.3 (2 headlines each) and %d ledger documents (fwd-4.4 x3, fwd-4.3 x2, fwd-4.2, fwd-4.1) byte-identical", n1);

// ---------------------------------------------------------------- 2. JS --fwd 4.5 = --fwd 4.4
const J44 = JSON.parse(runJS(inF, ["--fwd", "4.4"])), J45 = JSON.parse(runJS(inF, ["--fwd", "4.5"]));
ok(J45.meta.fwd === "4.5", "2. JS meta.fwd 4.5");
J45.meta.fwd = "4.4";
ok(JSON.stringify(J45) === JSON.stringify(J44), "2. JS --fwd 4.5 = --fwd 4.4 apart from meta.fwd");

// ---------------------------------------------------------------- 3. props absent -> fwd-4.4
const P44 = D.py_fwd44;                                      // fwd-4.4 on the live set (the fixture's run)
const strip = (b) => { const o = Object.assign({}, b); delete o.props_pool; return o; };
const P45none = dry(cF, "p45_none.json", ["--fwd", "4.5", "--live-dir", LIVE, "--props-dir", path.join(tmp, "no_props")]);
ok(JSON.stringify(P45none.bouts.map(strip)) === JSON.stringify(P44.bouts), "3. no props snapshot: every bout field equals fwd-4.4's (apart from props_pool)");
ok(P45none.bouts.every((b) => Object.keys(b).slice(-1)[0] === "props_pool" && b.props_pool.applied === false &&
  b.props_pool.reason === "no props snapshot before the lock"), "3. each bout ends with props_pool: applied false, 'no props snapshot before the lock'");
const M = P45none.model;
ok(/^fwd-4\.5: primary ml2_stack_open, no-line primary ml2_stack_noline /.test(M.version) && /no props snapshot before the lock/.test(M.version) &&
  M.version.indexOf("props.json " + sha16("data/derived/props.json")) >= 0, "3. model.version: fwd-4.5, the props.json hash, 'no props snapshot before the lock'");
ok(M.tool === "tools/forward_ledger.py 1.5" && M.fwd === "4.5" && /Forward model v4\.5/.test(M.preregistration.readme_section) &&
  M.preregistration.pinned_inputs_ok === true && /not clean on the vault/.test(M.preregistration.vault_flag) &&
  M.preregistration.pinned_inputs_added_sha256["src/ml/propspool.js"] === shaFile(path.join(ROOT, "src/ml/propspool.js")) &&
  M.preregistration.pinned_inputs_added_sha256["data/derived/props.json"] === shaFile(path.join(ROOT, "data/derived/props.json")),
"3. model block: tool 1.5, fwd 4.5, README v4.5, pins ok (full sha256 of propspool.js and props.json), the vault flag");
ok(M.props_snapshot === null && M.props_pool.n_bouts_pooled === 0 && JSON.stringify(M.props_pool.w) === JSON.stringify(PJ.model.params_production.m.w) &&
  M.props_pool.beta.every((x) => x === 0) && M.props_pool.params === "production", "3. model.props_pool: production weights, beta 0, nothing pooled");
ok(M.live_inputs && M.live_inputs.used === P44.model.live_inputs.used && M.code_sha256_16["tools/live_refresh.py"] === sha16("tools/live_refresh.py"),
  "3. fwd-4.4's live-input record is kept");
// a snapshot with nothing usable for this card (the committed Nov 7 snapshot: other dates) changes nothing either
const P45other = dry(cF, "p45_other.json", ["--fwd", "4.5", "--live-dir", LIVE]);
ok(JSON.stringify(P45other.bouts.map(strip)) === JSON.stringify(P44.bouts) && P45other.bouts.every((b) => b.props_pool.applied === false),
  "3. a props snapshot without entries for the card: every bout field equals fwd-4.4's");
console.log("3. props absent: fwd-4.5 = fwd-4.4 on all %d bouts (no snapshot; snapshot %s without the card)", P44.bouts.length,
  P45other.model.props_snapshot ? P45other.model.props_snapshot.stamp : "none");

// ---------------------------------------------------------------- 4. synthetic props snapshot
const ev = G42.cards.events[0];
const bid = (b, rev) => { const s = (x) => x.slug || x.name.toLowerCase().replace(/ /g, "-"); return DATE + ":" + (rev ? s(b.b) + "__" + s(b.a) : s(b.a) + "__" + s(b.b)); };
const cons = (m6, nb, extra) => Object.assign({ m6, gd: m6[2] + m6[5], n_books: { m6: nb, gd: nb }, n_dropped: 0 }, extra || {});
const entry = (b, c, o) => Object.assign({ event_slug: "ufc-test-night-1", mu: 1, page_t1: b.a.name, page_t2: b.b.name,
  fetched_utc: "2026-11-07T12:00:05Z", rounds: b.rounds, swap: false, books: {}, consensus: c,
  families_present: Object.keys(c).filter((k) => ["m6", "gd", "er", "wr", "mr", "itd", "ou"].indexOf(k) >= 0).sort(),
  bout_id: bid(b), a: b.a.name, b: b.b.name, segment: "main", order: b.order, event: ev.name }, o || {});
const B = ev.bouts;                     // 0-2 no debutant, 3-6 with a debutant
const m6dober = [0.18, 0.06, 0.20, 0.22, 0.09, 0.25], m6dup = [0.30, 0.02, 0.10, 0.30, 0.03, 0.25];
const m6ganeHB = [0.10, 0.05, 0.08, 0.45, 0.07, 0.25];       // the snapshot's own (Hokit, Gane) orientation
const mir6 = (m) => m.slice(3, 6).concat(m.slice(0, 3));
const m6elder = [0.15, 0.12, 0.22, 0.20, 0.10, 0.21];
const snapBouts = [
  entry(B[0], cons(m6dup, 2), { event_slug: "ufc-test-night-2" }),                       // duplicate, fewer books, first in file
  entry(B[0], cons(m6dober, 4)),
  entry(B[1], cons(m6ganeHB, 1), { bout_id: bid(B[1], true), page_t1: B[1].b.name, page_t2: B[1].a.name, a: B[1].b.name, b: B[1].a.name }),
  entry(B[2], { gd: 0.45, n_books: { gd: 3 }, n_dropped: 0 }),                             // no m6
  entry(B[3], cons(m6elder, 3)),                                                            // debut bout with props
  entry(B[4], cons(m6dober, 3), { fetched_utc: "2100-01-01T00:00:00Z" }),                   // page fetched after the lock
  Object.assign(entry(B[0], cons(m6dober, 4)), { bout_id: null, a: "Somebody", b: "Else" }),
];
const snap = (bouts, stamp) => ({ meta: { snapshot_utc: "2026-11-07T12:00:00Z", stamp: stamp || "20261107-1200", tool: "tools/props.py capture",
  devig: "power per family per book (synthetic test snapshot)", events: [] }, bouts });
const pd = path.join(tmp, "props"); fs.mkdirSync(pd);
fs.writeFileSync(path.join(pd, "props_snapshot_20261107-1200.json"), JSON.stringify(snap(snapBouts)));
// an older snapshot (ignored: not the newest) and a replay without snapshot_utc (never used)
fs.writeFileSync(path.join(pd, "props_snapshot_20261107-0600.json"), JSON.stringify(Object.assign(snap([entry(B[2], cons(m6dober, 5))]), { meta: { snapshot_utc: "2026-11-07T06:00:00Z", stamp: "20261107-0600" } })));
fs.writeFileSync(path.join(pd, "props_snapshot_20261108-0000.json"), JSON.stringify(Object.assign(snap([entry(B[2], cons(m6dober, 5))]), { meta: { snapshot_utc: null, stamp: "20261108-0000" } })));
const P45 = dry(cF, "p45.json", ["--fwd", "4.5", "--live-dir", LIVE, "--props-dir", pd]);
ok(P45.model.props_snapshot && P45.model.props_snapshot.stamp === "20261107-1200" && P45.model.props_snapshot.sha256_16 === shaFile(path.join(pd, "props_snapshot_20261107-1200.json")).slice(0, 16),
  "4. the newest snapshot with snapshot_utc before the lock is used (not the older one, not the replay); its sha256 is recorded");
ok(/props snapshot 20261107-1200/.test(P45.model.version), "4. model.version names the props snapshot");
const w = PJ.model.params_production.m.w, drawC = PJ.model.draw_c;
// independent joint-linear pool (README v4.5 item 2) from the fwd44_cells secondary and the consensus m6
function poolIndep(pa, pm44, m6) {
  const Mc = [["a_ko", "a_sub", "a_dec"], ["b_ko", "b_sub", "b_dec"]].map((ks) => { const t = ks.reduce((s, k) => s + pm44[k], 0); return ks.map((k) => pm44[k] / t); });
  const s6 = m6.reduce((s, x) => s + x, 0), Wp = (m6[0] + m6[1] + m6[2]) / s6;
  const Mp = [m6.slice(0, 3), m6.slice(3, 6)].map((v) => { const t = v[0] + v[1] + v[2]; return v.map((x) => x / t); });
  const Wsrc = [[pa, Wp], [1 - pa, 1 - Wp]];
  const Mx = [0, 1].map((s) => { const c0 = w[0] * Wsrc[s][0], c1 = w[1] * Wsrc[s][1]; return [0, 1, 2].map((k) => (c0 * Mc[s][k] + c1 * Mp[s][k]) / (c0 + c1)); });
  const draw = drawC * (pa * Mx[0][2] + (1 - pa) * Mx[1][2]), nd = 1 - draw;
  return { a_ko: nd * pa * Mx[0][0], a_sub: nd * pa * Mx[0][1], a_dec: nd * pa * Mx[0][2], draw,
    b_dec: nd * (1 - pa) * Mx[1][2], b_sub: nd * (1 - pa) * Mx[1][1], b_ko: nd * (1 - pa) * Mx[1][0] };
}
const winnerKeys = ["bout_id", "a", "b", "p_a", "p_a_source", "p_a_noline", "p_a_line", "p_elo", "models", "elo_seed", "experts",
  "stack_weights", "engine", "methodround_S", "market", "notes", "statlines", "p_a_noline_source", "debut_method", "debut_path"];
let maxCell = 0, maxIndep = 0;
P45.bouts.forEach((b, i) => {
  const z = P44.bouts[i], rec = b.props_pool;
  for (const k of winnerKeys) if (k in z) ok(JSON.stringify(b[k]) === JSON.stringify(z[k]), "4. " + b.bout_id + ": " + k + " unchanged from fwd-4.4");
  if (rec.applied) {
    const pm = b.p_method, s = CL.reduce((t, k) => t + pm[k], 0);
    const pa = pm.a_ko + pm.a_sub + pm.a_dec, pb = pm.b_ko + pm.b_sub + pm.b_dec;
    maxCell = Math.max(maxCell, Math.abs(s - 1), Math.abs(pa / (pa + pb) - b.p_a));
    ok(near(s, 1, 4e-5) && near(pa / (pa + pb), b.p_a, 4e-5), "4. " + b.bout_id + ": cells sum to 1 and keep p_a (" + s.toFixed(6) + ")");
    ok(Math.abs(rec.check.sum - 1) <= 1e-9 && Math.abs(rec.check.p_a_not_draw - b.p_a) <= 1e-9, "4. " + b.bout_id + ": unrounded pool check within 1e-9");
    ok(near(b.p_distance, pm.a_dec + pm.b_dec + pm.draw, 2e-5), "4. " + b.bout_id + ": p_distance = a_dec + b_dec + draw");
    const fr = b.p_finish_round;
    ok(fr.a.length === b.rounds && near(fr.a.reduce((t, x) => t + x, 0), pm.a_ko + pm.a_sub, 6e-5) && near(fr.b.reduce((t, x) => t + x, 0), pm.b_ko + pm.b_sub, 6e-5),
      "4. " + b.bout_id + ": p_finish_round per side sums to its KO + SUB");
    const sec = b.p_method_secondary.fwd44_cells;
    ok(JSON.stringify(sec.p_method) === JSON.stringify(z.p_method) && sec.p_distance === z.p_distance &&
      JSON.stringify(sec.p_finish_round) === JSON.stringify(z.p_finish_round) && sec.source === z.p_method_source,
    "4. " + b.bout_id + ": p_method_secondary.fwd44_cells = fwd-4.4's p_method, p_distance, p_finish_round and source");
    ok(/^props pool \(props\.json, production weights\) on methodround_/.test(b.p_method_source), "4. " + b.bout_id + ": p_method_source names the pool and the cells");
    const m6used = snapBouts[rec.entry.index].consensus.m6;
    const ref = poolIndep(b.p_a, sec.p_method, rec.entry.flipped_from_snapshot ? mir6(m6used) : m6used);
    const d = Math.max(...CL.map((k) => Math.abs(ref[k] - pm[k])));
    maxIndep = Math.max(maxIndep, d);
    ok(d < 1.5e-4, "4. " + b.bout_id + ": an independent joint-linear pool reproduces the cells (max " + d.toExponential(2) + ")");
    ok(JSON.stringify(Object.keys(b).filter((k) => !(k in z))) === JSON.stringify(["p_method_secondary", "props_pool"]),
      "4. " + b.bout_id + ": the only added fields are p_method_secondary and props_pool");
  } else if (!(b.p_method_secondary || {}).debut_props_pool) {
    ok(JSON.stringify(strip(b)) === JSON.stringify(z) || JSON.stringify(Object.assign(strip(b), { flags: z.flags })) === JSON.stringify(z),
      "4. " + b.bout_id + ": not pooled (" + rec.reason + "): fwd-4.4's fields");
  }
});
const R = P45.bouts.map((b) => b.props_pool);
ok(R[0].applied && R[0].entry.index === 1 && R[0].entry.n_books.m6 === 4 && R[0].other_entries.length === 1 && R[0].other_entries[0].n_books_m6 === 2,
  "4. duplicate entries: the one with the most m6 books is used (entry 1, 4 books), the other is recorded");
ok(R[1].applied && R[1].entry.flipped_from_snapshot === true && P45.bouts[1].flags.indexOf("props_single_book") >= 0 &&
  P45.bouts[0].flags.indexOf("props_single_book") < 0, "4. a b / a listing is matched and mirrored; single-book props are flagged props_single_book");
ok(!R[2].applied && R[2].found && /no method props/.test(R[2].reason), "4. an entry without m6: not pooled (" + R[2].reason + ")");
ok(!R[4].applied && /fetched at or after the lock/.test(R[4].reason) && !(P45.bouts[4].p_method_secondary || {}).debut_props_pool,
  "4. a page fetched after the lock: not used (" + R[4].reason + ")");
ok(!R[5].found && !R[6].found && /no matching entry/.test(R[5].reason), "4. bouts without an entry: 'no matching entry in the props snapshot'");
ok(P45.model.props_pool.n_bouts_pooled === 2 && P45.model.props_pool.n_debut_secondary === 1, "4. model.props_pool counts 2 pooled bouts and 1 debut secondary");
// the same snapshot with the Gane bout listed a / b (mirrored m6): identical result
const sb2 = JSON.parse(JSON.stringify(snapBouts));
Object.assign(sb2[2], { bout_id: bid(B[1]), page_t1: B[1].a.name, page_t2: B[1].b.name, a: B[1].a.name, b: B[1].b.name });
sb2[2].consensus.m6 = mir6(m6ganeHB);
const pd2 = path.join(tmp, "props2"); fs.mkdirSync(pd2);
fs.writeFileSync(path.join(pd2, "props_snapshot_20261107-1200.json"), JSON.stringify(snap(sb2)));
const P45b = dry(cF, "p45b.json", ["--fwd", "4.5", "--live-dir", LIVE, "--props-dir", pd2]);
ok(JSON.stringify(P45b.bouts[1].p_method) === JSON.stringify(P45.bouts[1].p_method) && P45b.bouts[1].props_pool.entry.flipped_from_snapshot === false,
  "4. the b / a listing gives exactly the a / b listing's cells");
// debut bout: primary kept, debut-bout pool recorded
const db = P45.bouts[3], dz = P44.bouts[3], dsec = db.p_method_secondary.debut_props_pool;
ok(JSON.stringify(db.p_method) === JSON.stringify(dz.p_method) && db.p_distance === dz.p_distance && db.p_method_source === dz.p_method_source &&
  JSON.stringify(db.p_method_secondary.division_base_rates) === JSON.stringify(dz.p_method_secondary.division_base_rates),
"4. debut bout: the primary (debut method model) and the base-rate secondary are fwd-4.4's");
const al = PJ.model.debut.params_production.alpha, gA = db.debut_method.given_a, gB = db.debut_method.given_b;
const lp = (D, P) => { const z = [0, 1, 2].map((c) => al[0] * Math.log(Math.max(D[c], 1e-6)) + al[1] * Math.log(Math.max(P[c], 1e-6))); const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m)); const t = e[0] + e[1] + e[2]; return e.map((x) => x / t); };
const nrm = (v) => { const t = v[0] + v[1] + v[2]; return v.map((x) => x / t); };
const refA = lp(gA, nrm(m6elder.slice(0, 3))), refB = lp(gB, nrm(m6elder.slice(3, 6)));
const dd = Math.max(...[0, 1, 2].map((c) => Math.max(Math.abs(refA[c] - dsec.given_a[c]), Math.abs(refB[c] - dsec.given_b[c]))));
ok(dd < 1e-9, "4. debut_props_pool = an independent log-linear pool of the debut method model and the props (max " + dd.toExponential(2) + ")");
const dr = dz.p_method.draw, ds = CL.reduce((t, k) => t + dsec.p_method[k], 0);
ok(near(ds, 1, 4e-5) && near(dsec.p_method.a_ko + dsec.p_method.a_sub + dsec.p_method.a_dec, db.p_a * (1 - dr), 3e-5) && dsec.p_method.draw === dr &&
  near(dsec.p_distance, dsec.p_method.a_dec + dsec.p_method.b_dec + dr, 2e-5), "4. debut_props_pool is composed as the primary (sums to 1, a cells = p_a (1 - dr), draw = dr)");
ok(!db.props_pool.applied && db.props_pool.secondary_recorded === true, "4. debut bout: props_pool says the primary is kept and the secondary recorded");
console.log("4. synthetic snapshot: 2 bouts pooled (cells vs an independent pool max %s; sum / p_a max %s), 1 debut secondary, 4 not used for the rules' reasons",
  maxIndep.toExponential(2), maxCell.toExponential(2));

// ---------------------------------------------------------------- 5. corner symmetry with props
const Q45 = dry(cR, "q45.json", ["--fwd", "4.5", "--live-dir", LIVE, "--props-dir", pd]);
let mx = 0;
const mirKey = { a_ko: "b_ko", a_sub: "b_sub", a_dec: "b_dec", b_ko: "a_ko", b_sub: "a_sub", b_dec: "a_dec", draw: "draw" };
P45.bouts.forEach((b, i) => {
  const q = Q45.bouts[i];
  ok(b.props_pool.applied === q.props_pool.applied && !!(b.p_method_secondary || {}).debut_props_pool === !!(q.p_method_secondary || {}).debut_props_pool,
    "5. " + b.bout_id + ": the same props decision under a / b swap");
  for (const k in b.p_method) mx = Math.max(mx, Math.abs(b.p_method[k] - q.p_method[mirKey[k]]));
  mx = Math.max(mx, Math.abs(b.p_distance - q.p_distance), Math.abs(b.p_a - (1 - q.p_a)));
  if (b.p_finish_round && b.p_finish_round.a) b.p_finish_round.a.forEach((x, r) => { mx = Math.max(mx, Math.abs(x - q.p_finish_round.b[r]), Math.abs(b.p_finish_round.b[r] - q.p_finish_round.a[r])); });
  for (const key of ["fwd44_cells", "debut_props_pool"]) {
    const s1 = (b.p_method_secondary || {})[key], s2 = (q.p_method_secondary || {})[key];
    ok(!!s1 === !!s2, "5. " + b.bout_id + ": secondary " + key + " present on both sides or neither");
    if (s1 && s2) for (const k in s1.p_method) mx = Math.max(mx, Math.abs(s1.p_method[k] - s2.p_method[mirKey[k]]));
  }
});
ok(mx <= 2.1e-5, "5. fwd-4.5 with props: p_a, p_method, p_distance, p_finish_round and the secondaries mirror under a / b swap (max " + mx.toExponential(2) + ")");

// ---------------------------------------------------------------- 6. scoring
const ldir = path.join(tmp, "score"); fs.mkdirSync(ldir);
const res = { results: [
  { bout_id: P45.bouts[0].bout_id, outcome: "win", winner: "a", method: "KO/TKO", round: 1, verified: true },
  { bout_id: P45.bouts[1].bout_id, outcome: "win", winner: "b", method: "Decision - Unanimous", round: 5, verified: true },
  { bout_id: P45.bouts[2].bout_id, outcome: "win", winner: "a", method: "SUB", round: 2, verified: true },
  { bout_id: P45.bouts[3].bout_id, outcome: "win", winner: "b", method: "SUB", round: 1, verified: true }] };
fs.writeFileSync(path.join(ldir, "results.json"), JSON.stringify(res));
fs.writeFileSync(path.join(ldir, DATE + "_ufc-test-night-v42.json"), JSON.stringify(P45));
const ldir44 = path.join(tmp, "score44"); fs.mkdirSync(ldir44);
fs.writeFileSync(path.join(ldir44, "results.json"), JSON.stringify(res));
fs.writeFileSync(path.join(ldir44, DATE + "_ufc-test-night-v42.json"), JSON.stringify(P44));
const S = JSON.parse(cp.execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'tools'); import forward_ledger as F; " +
  "out = {}\nfor d in sys.argv[1:]:\n  R = F.jload(d + '/results.json')['results']\n  out[d] = F.compute_scores(F.scored_files(d), R, 200)\n" +
  "S = out[sys.argv[1]]; md = F.scores_md(S)\nprint(json.dumps({'s45': S, 's44': out[sys.argv[2]], 'md': md}))", ldir, ldir44], { cwd: ROOT }).toString());
const ms = S.s45.method_secondary && S.s45.method_secondary[P45.model.version];
ok(ms && ms.fwd44_cells && ms.fwd44_cells.n === 2 && ms.debut_props_pool && ms.debut_props_pool.n === 1, "6. scores.json method_secondary: fwd44_cells on 2 bouts, debut_props_pool on 1");
const ll = (pm, wnr, k) => -Math.log(Math.max(pm[wnr + "_" + k], 1e-6));
const e1 = [[P45.bouts[0], "a", "ko"], [P45.bouts[1], "b", "dec"]];
const prim = e1.reduce((t, [b, wn, k]) => t + ll(b.p_method, wn, k), 0) / 2, sec = e1.reduce((t, [b, wn, k]) => t + ll(b.p_method_secondary.fwd44_cells.p_method, wn, k), 0) / 2;
ok(ms && near(ms.fwd44_cells.primary.log_loss_7way, prim, 1e-12) && near(ms.fwd44_cells.secondary.log_loss_7way, sec, 1e-12) &&
  near(ms.fwd44_cells.paired.log_loss_7way.est, prim - sec, 1e-12), "6. 7-way log loss of the pool and of fwd-4.4's cells, and their paired difference, by hand");
const brier = e1.reduce((t, [b, , k]) => t + Math.pow(b.p_distance - (k === "dec" ? 1 : 0), 2), 0) / 2;
ok(ms && near(ms.fwd44_cells.primary.distance_brier, brier, 1e-12), "6. goes-the-distance Brier of the primary by hand");
ok(!("method_secondary" in S.s44) && JSON.stringify(S.s44.method_debut) === JSON.stringify(S.s45.method_debut ? Object.fromEntries(Object.entries(S.s45.method_debut).map(([, v]) => [P44.model.version, v])) : undefined),
  "6. a fwd-4.4 document's scores have no method_secondary; the debut-vs-base-rates block is unchanged");
ok(/Method secondary, fwd-4\.5.*props pool \(primary\) vs fwd-4\.4's cells/.test(S.md) && /debut-bout props pool/.test(S.md), "6. scores.md lists both method secondaries");

// ---------------------------------------------------------------- 7. guards, README
const fv = JSON.parse(cp.execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'tools'); import forward_ledger as F; " +
  "print(json.dumps([F.fwd_for_date(d) for d in ('2026-11-07', '2026-11-13', '2026-11-14', '2026-11-21', '2026-12-30', '2027-06-01')]))"], { cwd: ROOT }).toString());
ok(fv.join() === "4.1,4.1,4.5,4.5,4.5,4.5", "7. --fwd auto: fwd-4.1 before 2026-11-14, fwd-4.5 from it (" + fv.join() + ")");
const Pa = dry(cF, "pauto.json", ["--props-dir", path.join(tmp, "no_props")]);
ok(/^fwd-4\.5:/.test(Pa.model.version), "7. --fwd auto writes fwd-4.5 for an event dated " + DATE);
const r44 = py(cF, ["--fwd", "4.4"]);
ok(r44.status !== 0 && /refused: data\/predictions\/README\.md assigns fwd-4\.5/.test(r44.stderr + r44.stdout), "7. writing fwd-4.4 for a fwd-4.5 event is refused");
const rp = py(cF, ["--fwd", "4.5", "--props-dir", pd]);
ok(rp.status !== 0 && /--props-dir is for dry runs/.test(rp.stderr + rp.stdout), "7. --props-dir outside a dry run is refused");
const rl = py(cF, ["--fwd", "4.5", "--live-dir", LIVE]);
ok(rl.status !== 0 && /--live-dir is for dry runs/.test(rl.stderr + rl.stdout), "7. --live-dir outside a dry run is refused");
ok(fs.readdirSync(path.join(tmp, "ledger")).length === 0, "7. refused runs wrote nothing");
const jobs = writeJ("jobs.json", { params: "fit_2021_2023", bouts: [] });
const rj = cp.spawnSync("node", [path.join(ROOT, "tools/forward_ledger.js"), "--props-pool", jobs], { cwd: ROOT, encoding: "utf8" });
ok(rj.status !== 0 && /pre-registers params 'production'/.test(rj.stderr), "7. JS --props-pool refuses parameters other than 'production'");
const pm45 = JSON.parse(cp.execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'tools'); import forward_ledger as F; " +
  "a = F.pinned_mismatches_45(); F.FWD45_PINNED_FULL = dict(F.FWD45_PINNED_FULL, **{'data/derived/props.json': '0' * 64}); " +
  "print(json.dumps([a, F.pinned_mismatches_45()]))"], { cwd: ROOT }).toString());
ok(pm45[0].length === 0 && pm45[1].length === 1 && pm45[1][0].file === "data/derived/props.json" && pm45[1][0].found === shaFile(path.join(ROOT, "data/derived/props.json")),
  "7. pinned_mismatches_45: none on disk; a changed props.json hash is reported");
// a write with a pin mismatch is refused: predict in-process with the props.json pin changed (nothing is written to the repo)
const rw = cp.spawnSync("python3", ["-c", "import sys; sys.path.insert(0, 'tools'); import forward_ledger as F; " +
  "F.FWD45_PINNED_FULL = dict(F.FWD45_PINNED_FULL, **{'data/derived/props.json': '0' * 64}); sys.argv = ['forward_ledger.py'] + sys.argv[1:]; F.main()",
  "predict", "--event", DATE, "--cards", cF, "--odds-dir", path.join(tmp, "odds"), "--dir", path.join(tmp, "ledger"), "--sims", "30", "--fwd", "4.5"],
{ cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
ok(rw.status !== 0 && /refused: fwd-4\.5 reads only the files pre-registered/.test(rw.stderr + rw.stdout) && /data\/derived\/props\.json/.test(rw.stderr + rw.stdout) &&
  fs.readdirSync(path.join(tmp, "ledger")).length === 0, "7. a props.json hash that differs from the pin refuses a fwd-4.5 write and writes nothing");
const readme = fs.readFileSync(path.join(ROOT, "data/predictions/README.md"), "utf8");
const i45 = readme.indexOf("## Forward model v4.5");
const sec45 = i45 >= 0 ? readme.slice(i45, readme.indexOf("## Card snapshot notes")) : "";
ok(sec45.length > 0 && readme.indexOf("## Forward model v4.5") > readme.indexOf("## Forward model v4.4"), "7. README has the fwd-4.5 section after fwd-4.4's");
const pins = JSON.parse(cp.execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'tools'); import forward_ledger as F; print(json.dumps(F.FWD45_PINNED_FULL))"], { cwd: ROOT }).toString());
for (const f in pins) {
  ok(pins[f] === shaFile(path.join(ROOT, f)), "7. tool pin of " + f + " = the file on disk");
  ok(new RegExp("\\| " + f.replace(/[./]/g, (c) => "\\" + c) + " \\| " + pins[f].slice(0, 16) + " \\|").test(sec45) && sec45.indexOf("`" + pins[f] + "`") >= 0,
    "7. README fwd-4.5 table and full sha256 of " + f + " = the tool's pin");
}
ok(sec45.indexOf("`" + PJ.model.params_production.m.w[0] + "`") >= 0 && sec45.indexOf("`" + PJ.model.params_production.m.w[1] + "`") >= 0,
  "7. README fwd-4.5 names props.json's full-precision production weights");
ok(/### Addendum: fwd-4\.5 implementation/.test(sec45), "7. the fwd-4.5 implementation addendum exists");
for (const f of ["tools/forward_ledger.py", "tools/forward_ledger.js", "tools/forward_statlines.js", "tools/live_refresh.py"]) {
  const re = new RegExp("`" + f.replace(/[./]/g, (c) => "\\" + c) + "`[^:\\n]*:\\s*([0-9a-f]{16})", "g");
  const hs = [];
  let m;
  while ((m = re.exec(sec45))) hs.push(m[1]);
  ok(hs.length > 0 && hs[hs.length - 1] === sha16(f), "7. README fwd-4.5 addendum code hash of " + f + " (" + hs[hs.length - 1] + ") = the file on disk (" + sha16(f) + ")");
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log("%d checks, %d failures", checks, fails);
process.exit(fails ? 1 : 0);
