#!/usr/bin/env node
/* tests/test_forward_v42.js: forward model v4.2 (data/predictions/README.md "Forward model v4.2 (Nov 6-7, 2026)").
     node tests/test_forward_v42.js          (about 20 s: a few evaluator runs and five dry runs of tools/forward_ledger.py)
   1. fwd-4.1 identity: tools/forward_ledger.js without --fwd, with --fwd 4.1, and with --debut-model reproduces, byte for
      byte, the output the tool gave before v4.2 existed (tests/fixtures/forward_v41_golden.json, captured at git 6011e6f).
      Skipped (and said so) when one of the fixture's input files has changed since.
   2. JS --fwd 4.2 only adds fields (models.debut_model, debut_method, per-round KO / SUB head arrays): stripping them
      gives the fwd-4.1 output with the debut hook, byte for byte; corner symmetry of every new field; the debut method is
      fed the line when there is one, else the seeded Elo.
   3. tools/forward_ledger.py predict --fwd 4.2 (dry runs on a synthetic card, a/b as given and swapped): method cells sum
      to 1 and agree with p_a; p_distance and p_finish_round agree with the cells; debut bouts with and without a line
      (one debutant, two debutants, a debutant without an entry); P(a) = 1 - P(b), method mirrored, stat lines swap
      sides; the winner fields equal fwd-4.1's on the same engine; the base-rate secondary equals fwd-4.1's method.
   4. Guards: writing under a version the README does not assign is refused and writes nothing; the README hash table
      equals the tool's pinned list and the files on disk.
   Since fwd-4.3 (README "Forward model v4.3", Nov 7) the README assigns fwd-4.3 to events from 2026-11-14, so --fwd auto
   and the refusal message name fwd-4.3; tests/test_forward_v43.js covers fwd-4.3 and the byte identity of fwd-4.2.
   Since fwd-4.4 (README "Forward model v4.4", Nov 7) they named fwd-4.4 (tests/test_forward_v44.js), and since fwd-4.5
   (README "Forward model v4.5", Nov 7) they name fwd-4.5 (tests/test_forward_v45.js). */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fails++; console.log("FAIL", msg); } };
const sha16 = (p) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex").slice(0, 16);
const near = (a, b, t) => a != null && b != null && Math.abs(a - b) <= t;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwd42-"));
const G = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v41_golden.json"), "utf8"));
for (const f in G.debutant_files) fs.writeFileSync(path.join(tmp, f), JSON.stringify(G.debutant_files[f]));
const writeJ = (name, o) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(o)); return f; };
const runJS = (inF, extra) => cp.execFileSync("node", [path.join(ROOT, "tools/forward_ledger.js"), inF, "--engine-dir", "versions/v4",
  "--moe", "data/derived/blindtest_stack.json", "--pred-dir", tmp, "--raw"].concat(extra || []), { cwd: ROOT, maxBuffer: 1 << 28 }).toString();
const flip = (p) => (p == null ? null : 1 - p);

// ---------------------------------------------------------------- 1. fwd-4.1 identity against the pre-v4.2 output
const inF = writeJ("in.json", G.input);
const drift = Object.entries(G.inputs_sha256_16).filter(([f, h]) => sha16(f) !== h).map(([f]) => f);
if (drift.length) console.log("SKIP 1-2 identity (inputs changed since the fixture: " + drift.join(", ") + ")");
else {
  ok(runJS(inF) === G.outputs.plain, "1. default (fwd-4.1) output is byte-identical to the pre-v4.2 tool");
  ok(runJS(inF, ["--fwd", "4.1"]) === G.outputs.plain, "1. --fwd 4.1 output is byte-identical to the pre-v4.2 tool");
  ok(runJS(inF, ["--debut-model", "data/derived/debut.json"]) === G.outputs.debut_model, "1. --debut-model hook output is byte-identical");
  console.log("1. fwd-4.1 identity: %d bouts, plain %d bytes, debut hook %d bytes", G.input.bouts.length, G.outputs.plain.length, G.outputs.debut_model.length);
}

// ---------------------------------------------------------------- 2. JS --fwd 4.2: additions only, symmetry
const A = JSON.parse(runJS(inF, ["--fwd", "4.2"]));
const revIn = { date: G.input.date, sims: G.input.sims, bouts: G.input.bouts.map((b) => ({ bout_id: b.bout_id + "r", a: b.b, b: b.a,
  key_a: b.key_b, key_b: b.key_a, name_a: b.name_b, name_b: b.name_a, division: b.division, rounds: b.rounds, title: b.title,
  p_line: flip(b.p_line), p_open_in: flip(b.p_open_in), p_novig: flip(b.p_novig) })) };
const B = JSON.parse(runJS(writeJ("rev.json", revIn), ["--fwd", "4.2"]));
const strip = (o) => {
  const c = JSON.parse(JSON.stringify(o));
  delete c.meta.fwd; c.meta.model_keys = c.meta.model_keys.filter((k) => k !== "debut_model");
  for (const b of c.bouts) {
    delete b.models.debut_model; delete b.debut_method;
    for (const h of ["head_line", "head_noline"]) if (b[h]) { delete b[h].koA; delete b[h].subA; delete b[h].koB; delete b[h].subB; }
  }
  return c;
};
if (!drift.length) ok(JSON.stringify(strip(A)) === G.outputs.debut_model, "2. --fwd 4.2 minus its additions = the fwd-4.1 output with the debut hook");
ok(A.meta.fwd === "4.2" && A.meta.model_keys.indexOf("debut_model") >= 0, "2. meta marks fwd 4.2 and lists debut_model");
let sMax = 0, nDebut = 0;
A.bouts.forEach((x, i) => {
  const y = B.bouts[i], g = G.input.bouts[i];
  for (const k of A.meta.model_keys) {
    ok((x.models[k] == null) === (y.models[k] == null), "2. " + x.bout_id + " " + k + " null on one side only");
    if (x.models[k] != null) sMax = Math.max(sMax, Math.abs(x.models[k] + y.models[k] - 1));
  }
  for (const h of ["head_line", "head_noline"]) {
    if (!x[h]) continue;
    const p = x[h], q = y[h];
    ok(Array.isArray(p.koA) && p.koA.length === g.rounds && p.subB.length === g.rounds, "2. " + x.bout_id + " " + h + " has per-round KO / SUB arrays");
    for (let r = 0; r < g.rounds; r++) {
      sMax = Math.max(sMax, Math.abs(p.koA[r] - q.koB[r]), Math.abs(p.subA[r] - q.subB[r]), Math.abs(p.koB[r] - q.koA[r]), Math.abs(p.subB[r] - q.subA[r]));
      ok(near(p.koA[r] + p.subA[r], p.finA[r], 1e-12) && near(p.koB[r] + p.subB[r], p.finB[r], 1e-12), "2. " + x.bout_id + " " + h + " KO + SUB = finishes, round " + (r + 1));
    }
  }
  const debut = !g.a || !g.b;
  ok(debut === !!x.debut_method && debut === (x.models.debut_model != null), "2. " + x.bout_id + " debut_method / debut_model exactly on debut bouts");
  if (!debut) return;
  nDebut++;
  const dm = x.debut_method, dr = y.debut_method;
  for (let c = 0; c < 3; c++) sMax = Math.max(sMax, Math.abs(dm.given_a[c] - dr.given_b[c]), Math.abs(dm.given_b[c] - dr.given_a[c]));
  sMax = Math.max(sMax, Math.abs(dm.p_w_used + dr.p_w_used - 1));
  ok(near(dm.given_a.reduce((s, v) => s + v, 0), 1, 1e-12) && near(dm.given_b.reduce((s, v) => s + v, 0), 1, 1e-12), "2. " + x.bout_id + " P(method | winner) rows sum to 1");
  if (g.p_line != null) ok(dm.p_w_used === g.p_line && /^line/.test(dm.p_w_source), "2. " + x.bout_id + " method fed the line");
  else ok(dm.p_w_used === x.models.elo && /seeded Elo/.test(dm.p_w_source), "2. " + x.bout_id + " method fed the seeded Elo (no line)");
  ok(near(x.models.debut_model, x.debut_path.p_a_debut, 1e-15), "2. " + x.bout_id + " models.debut_model = the debut path's no-line debut model");
});
ok(sMax <= 1e-9, "2. corner symmetry of models, head arrays and debut method (max " + sMax.toExponential(2) + ")");
console.log("2. JS --fwd 4.2: %d bouts (%d with a debutant), max corner asymmetry %s", A.bouts.length, nDebut, sMax.toExponential(2));

// ---------------------------------------------------------------- 3. tools/forward_ledger.py predict --fwd 4.2, dry runs
const DATE = "2026-12-30";
const card = [
  ["Drew Dober", "drew-dober", "Chris Duncan", "chris-duncan", "Lightweight", 3, false, [150, -180, 0.39, 0.385, 0.38, 0.388]],
  ["Ciryl Gane", "ciryl-gane", "Josh Hokit", "josh-hokit", "Heavyweight", 5, true, [-240, 200, 0.69, 0.695, 0.70, 0.69]],
  ["Jim Miller", "jim-miller", "Terrance McKinney", "terrance-mckinney", "Lightweight", 3, false, null],
  ["Evan Elder", "evan-elder", "Samuel Sanches", null, "Lightweight", 3, false, [-120, -105, 0.516, 0.5136, 0.5144, 0.5134]],
  ["Mitch Raposo", "mitch-raposo", "Marcos Degli", null, "Flyweight", 3, false, null],
  ["Marcos Degli", null, "Nobody Testman", null, "Flyweight", 3, false, [-300, 240, 0.74, 0.745, 0.75, 0.74]],
  ["Nobody Testmantwo", null, "Thomas Petersen", "thomas-petersen", "Heavyweight", 3, false, null]];
const slugify = (s) => String(s).normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const bid = (a, sa, b, sb) => DATE + ":" + (sa || slugify(a)) + "__" + (sb || slugify(b));
function cards(swap) {
  return { as_of: "test", events: [{ date: DATE, name: "UFC Test Night: v42", start_utc: { prelims: "2099-12-30T22:00Z" },
    bouts: card.map((c, i) => {
      const A = { name: c[0], slug: c[1] }, Bf = { name: c[2], slug: c[3] };
      return { order: i + 1, segment: "main", a: swap ? Bf : A, b: swap ? A : Bf, weight_class: c[4], rounds: c[5], title: c[6], status: "official" };
    }) }] };
}
const snap = { meta: { snapshot_utc: "2026-11-06T12:00:00Z", stamp: "20261106-1200" }, bouts: card.filter((c) => c[7]).map((c) => ({
  bout_id: bid(c[0], c[1], c[2], c[3]),
  market: { source: "test", captured_utc: "2026-11-06T12:00:00+00:00", odds_a: c[7][0], odds_b: c[7][1], p_a_novig: c[7][2], n_books: 3 },
  consensus: { p_consensus: c[7][3], p_meandec_power: c[7][4], p_meandec_mult: c[7][5], n_books: 9 } })) };
fs.mkdirSync(path.join(tmp, "odds")); fs.mkdirSync(path.join(tmp, "ledger"));
fs.writeFileSync(path.join(tmp, "odds", "odds_snapshot_20261106-1200.json"), JSON.stringify(snap));
const cF = writeJ("cards.json", cards(false)), cR = writeJ("cards_rev.json", cards(true));
const py = (cardsF, extra) => cp.spawnSync("python3", [path.join(ROOT, "tools/forward_ledger.py"), "predict", "--event", DATE,
  "--cards", cardsF, "--odds-dir", path.join(tmp, "odds"), "--dir", path.join(tmp, "ledger"), "--sims", "30"].concat(extra),
  { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const dry = (cardsF, name, extra) => {
  const o = path.join(tmp, name), r = py(cardsF, ["--dry-run", "--dry-out", o].concat(extra || []));
  if (r.status !== 0) { console.log(r.stdout.slice(-2000), r.stderr.slice(-2000)); throw new Error("dry run failed: " + name); }
  return JSON.parse(fs.readFileSync(o, "utf8"));
};
const P = dry(cF, "p42.json", ["--fwd", "4.2"]), Q = dry(cR, "q42.json", ["--fwd", "4.2"]);
const P41 = dry(cF, "p41.json", ["--fwd", "4.1", "--engine-dir", "versions/v4"]);
const Pauto = dry(cF, "pauto.json", []);
const CL = ["a_ko", "a_sub", "a_dec", "draw", "b_dec", "b_sub", "b_ko"];
const mirror = { a_ko: "b_ko", a_sub: "b_sub", a_dec: "b_dec", b_ko: "a_ko", b_sub: "a_sub", b_dec: "a_dec", draw: "draw" };
ok(/^fwd-4\.2:/.test(P.model.version) && P.model.tool === "tools/forward_ledger.py 1.2" && P.model.fwd === "4.2", "3. model block: fwd-4.2 version string and tool 1.2");
// fwd-4.3 (README "Forward model v4.3", Nov 7) supersedes fwd-4.2 from 2026-11-14: auto now picks fwd-4.3 there
ok(/^fwd-4\.5:/.test(Pauto.model.version), "3. --fwd auto picks fwd-4.5 (which superseded fwd-4.4, fwd-4.3 and fwd-4.2) for an event dated " + DATE);
ok(P.model.engine.engine_dir === "versions/v4" && P.model.engine.engine_version === "4.0.0", "3. fwd-4.2 runs the frozen engine 4.0.0 in versions/v4");
ok(/^fwd-4\.1:/.test(P41.model.version) && P41.model.tool === "tools/forward_ledger.py 1.1", "3. --fwd 4.1 dry run writes a fwd-4.1 document");
let symMax = 0, slMis = 0, slN = 0, debutLine = 0, debutNoLine = 0;
P.bouts.forEach((x, i) => {
  const y = Q.bouts[i], z = P41.bouts[i], tag = "3. " + x.bout_id;
  const pm = x.p_method, s7 = CL.reduce((s, k) => s + pm[k], 0);
  ok(near(s7, 1, 4e-5), tag + " method cells sum to 1 (" + s7 + ")");
  ok(near(pm.a_ko + pm.a_sub + pm.a_dec, x.p_a * (1 - pm.draw), 4e-5) && near(pm.b_ko + pm.b_sub + pm.b_dec, (1 - x.p_a) * (1 - pm.draw), 4e-5),
    tag + " a / b cells agree with p_a");
  ok(near(x.p_distance, pm.a_dec + pm.b_dec + pm.draw, 2e-5), tag + " p_distance = a_dec + b_dec + draw");
  ok(x.p_finish_round && near(x.p_finish_round.a.reduce((s, v) => s + v, 0), pm.a_ko + pm.a_sub, 6e-5) &&
    near(x.p_finish_round.b.reduce((s, v) => s + v, 0), pm.b_ko + pm.b_sub, 6e-5), tag + " p_finish_round sums to the finish cells");
  // symmetry: a/b swapped card
  symMax = Math.max(symMax, Math.abs(x.p_a + y.p_a - 1), Math.abs(x.p_elo + y.p_elo - 1), Math.abs(x.p_distance - y.p_distance));
  if (x.p_a_noline != null) symMax = Math.max(symMax, Math.abs(x.p_a_noline + y.p_a_noline - 1));
  for (const k of CL) symMax = Math.max(symMax, Math.abs(pm[k] - y.p_method[mirror[k]]));
  for (const k in x.models) if (x.models[k] != null) symMax = Math.max(symMax, Math.abs(x.models[k] + y.models[k] - 1));
  for (let r = 0; r < x.rounds; r++) symMax = Math.max(symMax, Math.abs(x.p_finish_round.a[r] - y.p_finish_round.b[r]));
  const sa = x.statlines, sb = y.statlines;
  ok(sa && sa.a && sa.b && sa.stats.join() === "sig_lnd,sig_att,td_lnd,td_att,ctrl,kd,sub_att", tag + " stat-line block with the seven stats");
  ok(near(sa.length.p_distance, x.p_distance, 1e-4), tag + " stat-line length grid matches p_distance (" + sa.length.p_distance + " vs " + x.p_distance + ")");
  for (const st of sa.stats) for (const [s, t] of [["a", "b"], ["b", "a"]]) {
    const u = sa[s][st], v = sb[t][st];
    ok(u.p10 <= u.p50 && u.p50 <= u.p90 && u.mean >= 0 && u.blend_mean >= 0, tag + " " + s + " " + st + " quantiles ordered");
    slN++;
    if (u.p10 !== v.p10 || u.p50 !== v.p50 || u.p90 !== v.p90 || !near(u.mean, v.mean, 2e-5) || !near(u.blend_mean, v.blend_mean, 2e-5)) slMis++;
  }
  // winner fields: unchanged from fwd-4.1 (same engine)
  for (const k of ["p_a", "p_a_source", "p_a_line", "p_a_noline", "p_elo", "flags", "market", "elo_seed", "engine", "experts"])
    ok(JSON.stringify(x[k]) === JSON.stringify(z[k]), tag + " " + k + " equals fwd-4.1");
  const m42 = Object.assign({}, x.models); delete m42.debut_model;
  ok(JSON.stringify(m42) === JSON.stringify(z.models), tag + " models block equals fwd-4.1 (debut_model aside)");
  const debut = x.flags.some((f) => /^debut_[ab]$/.test(f));
  if (!debut) {
    ok(JSON.stringify(pm) === JSON.stringify(z.p_method) && x.p_distance === z.p_distance && JSON.stringify(x.p_finish_round) === JSON.stringify(z.p_finish_round)
      && x.p_method_source === z.p_method_source && !x.p_method_secondary && x.models.debut_model === null, tag + " no debutant: method exactly as fwd-4.1");
    return;
  }
  ok(x.p_method_source === "debut method model (debut.json)", tag + " debut method is the primary");
  const sec = x.p_method_secondary && x.p_method_secondary.division_base_rates;
  ok(sec && JSON.stringify(sec.p_method) === JSON.stringify(z.p_method) && sec.p_distance === z.p_distance, tag + " secondary = fwd-4.1's base-rate cells");
  ok(sec && near(CL.reduce((s, k) => s + sec.p_method[k], 0), 1, 4e-5) && near(sec.p_method.draw, pm.draw, 1e-12), tag + " secondary sums to 1, same draw share");
  for (const k of CL) symMax = Math.max(symMax, Math.abs(sec.p_method[k] - y.p_method_secondary.division_base_rates.p_method[mirror[k]]));
  ok(x.debut_method.p_w_used === x.p_a, tag + " debut method fed p_a");
  ok(x.models.debut_model != null && x.debut_path && x.debut_path.adopted, tag + " debut_model and debut_path recorded");
  if (x.market) { debutLine++; ok(x.p_a === x.market.p_a_stack_input && /^line/.test(x.debut_method.p_w_source), tag + " with a line: p_a = the power de-vig line"); }
  else { debutNoLine++; ok(x.p_a === x.p_elo && x.flags.indexOf("no_line") >= 0 && /seeded Elo/.test(x.debut_method.p_w_source), tag + " without a line: p_a = seeded Elo"); }
  const gw = x.debut_method.given_a;
  ok(near(pm.a_ko / (pm.a_ko + pm.a_sub + pm.a_dec), gw[0], 1e-4), tag + " a cells follow P(method | a wins)");
});
ok(symMax <= 1.1e-5, "3. corner symmetry of p_a, p_elo, models, p_method (primary and secondary), p_finish_round (max " + symMax.toExponential(2) + ", 5-decimal rounding)");
ok(slMis === 0, "3. stat lines swap sides exactly (" + slMis + " of " + slN + " differ)");
ok(debutLine === 2 && debutNoLine === 2, "3. debut bouts: 2 with a line, 2 without (" + debutLine + ", " + debutNoLine + ")");
console.log("3. ledger dry runs: %d bouts, max asymmetry %s, %d stat-line entries swap exactly", P.bouts.length, symMax.toExponential(2), slN);
const deb = P.bouts.find((b) => b.bout_id === bid("Evan Elder", "evan-elder", "Samuel Sanches", null));
console.log("   Elder vs Sanches: p_a %s; debut method a_ko/a_sub/a_dec/b_dec/b_sub/b_ko %s; base rates %s", deb.p_a,
  ["a_ko", "a_sub", "a_dec", "b_dec", "b_sub", "b_ko"].map((k) => deb.p_method[k].toFixed(3)).join("/"),
  ["a_ko", "a_sub", "a_dec", "b_dec", "b_sub", "b_ko"].map((k) => deb.p_method_secondary.division_base_rates.p_method[k].toFixed(3)).join("/"));

// ---------------------------------------------------------------- 4. guards
const r41 = py(cF, ["--fwd", "4.1"]);
ok(r41.status !== 0 && /refused: data\/predictions\/README\.md assigns fwd-4\.5/.test(r41.stderr + r41.stdout), "4. writing fwd-4.1 for an event the README assigns to fwd-4.5 (formerly fwd-4.2, fwd-4.3, fwd-4.4) is refused");
const vegas = cp.spawnSync("python3", [path.join(ROOT, "tools/forward_ledger.py"), "predict", "--event", "2026-11-07", "--fwd", "4.2",
  "--dir", path.join(tmp, "ledger")], { cwd: ROOT, encoding: "utf8" });
ok(vegas.status !== 0 && /refused/.test(vegas.stderr + vegas.stdout), "4. writing fwd-4.2 for the Vegas 124 card (fwd-4.1) is refused");
ok(fs.readdirSync(path.join(tmp, "ledger")).length === 0, "4. refused runs wrote nothing");
const readme = fs.readFileSync(path.join(ROOT, "data/predictions/README.md"), "utf8");
const sec = readme.slice(readme.indexOf("### Files and hashes fwd-4.2 reads"), readme.indexOf("- **Per-event inputs**"));
const rows = {};
for (const m of sec.matchAll(/^\| ([a-z0-9_/.]+) \| ([0-9a-f]{16}) \|/gm)) rows[m[1]] = m[2];
ok(JSON.stringify(rows) === JSON.stringify(P.model.preregistration.pinned_inputs), "4. README hash table = the tool's pinned list");
const onDisk = Object.entries(rows).filter(([f, h]) => sha16(f) !== h).map(([f]) => f);
ok(Object.keys(rows).length === 25, "4. README pins 25 files");
if (onDisk.length) console.log("NOTE: pinned files changed on disk (a fwd-4.2 write would be refused): " + onDisk.join(", "));
ok(P.model.preregistration.pinned_inputs_ok === (onDisk.length === 0), "4. pinned_inputs_ok reflects the files on disk");
// the README addendum names the three tool-code hashes every fwd-4.2 file records; an edit to the code needs a dated
// addendum line first (README "Addendum: implementation"), so the latest hash listed for each file must be the one on disk
const add = readme.slice(readme.indexOf("### Addendum: implementation"), readme.indexOf("## Card snapshot notes"));
for (const f of ["tools/forward_ledger.py", "tools/forward_ledger.js", "tools/forward_statlines.js"]) {
  const hs = [...add.matchAll(new RegExp("`" + f.replace(/[.]/g, "\\.") + "`[^:\\n]*: ([0-9a-f]{16})", "g"))].map((m) => m[1]);
  ok(hs.length > 0 && hs[hs.length - 1] === sha16(f), "4. README addendum code hash of " + f + " (" + hs[hs.length - 1] + ") = the file on disk (" + sha16(f) + ")");
  ok(P.model.code_sha256_16[f] === sha16(f), "4. the fwd-4.2 file records the code hash of " + f);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log((fails ? "FAILED " : "ok ") + (checks - fails) + "/" + checks + " checks");
process.exit(fails ? 1 : 0);
