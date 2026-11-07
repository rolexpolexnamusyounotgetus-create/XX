#!/usr/bin/env node
/* tests/test_forward_v43.js: forward model v4.3 (data/predictions/README.md "Forward model v4.3 (Nov 7, 2026)").
     node tests/test_forward_v43.js          (about 30 s: evaluator runs and eight dry runs of tools/forward_ledger.py)
   1. Identity of the older versions.
      - fwd-4.1: tools/forward_ledger.js (default, --fwd 4.1, --debut-model) reproduces tests/fixtures/forward_v41_golden.json
        byte for byte. It runs when every fixture input has the fixture's hash or the hash fwd-4.3 pins for it (the README's
        re-pin of src/ml/ml2.js and tools/methodround_model.js, whose v6 additions change no output).
      - fwd-4.2: the JS --fwd 4.2 outputs and the tools/forward_ledger.py dry-run documents (fwd-4.1 and fwd-4.2, line and
        no-line headlines) reproduce tests/fixtures/forward_v42_golden.json, captured from the tools before fwd-4.3 existed,
        byte for byte after removing the run-specific fields the fixture lists. Skipped (and said so) when an input changed.
   2. fwd-4.3 against fwd-4.2. JS --fwd 4.3 = --fwd 4.2 plus models.moe_noline (= stack_noline); the ledger document differs
      from fwd-4.2's only where the README says: p_a_noline = models.ml2_stack_noline on bouts without a debutant (with
      p_a_noline_source), p_a = that value on a bout without a line (method cells and stat lines follow it), the models block
      gains moe_noline, and the model block names fwd-4.3. Debut bouts and bouts with a line are unchanged.
   3. Corner symmetry of every fwd-4.3 field (JS and ledger, a/b swapped).
   4. The no-line stack reproduces the Python export: models.ml2_stack_noline from tools/forward_ledger.js equals
      forward_models.json test_vectors p_stack_noline (tools/ml2.py page_stack_eval) to 1e-12, and the README's weights and
      sha256 are the file's.
   5. Fallback: with a fighter missing from the ML v2 roster (a temporary copy of the tree), p_a_noline = the MoE no-line
      stack, flagged noline_fallback.
   6. Guards: --fwd auto picks fwd-4.3 from 2026-11-14 (fwd-4.1 before); writing under another version is refused and
      writes nothing; the README fwd-4.3 hash table equals the tool's pins; the README addendum names the code on disk.
   Since fwd-4.4 (README "Forward model v4.4", Nov 7) the README assigns fwd-4.4 to events from 2026-11-14, so --fwd auto
   and the refusal messages name fwd-4.4 (tests/test_forward_v44.js covers fwd-4.4 and the byte identity of fwd-4.3). */
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
const near = (a, b, t) => a != null && b != null && Math.abs(a - b) <= t;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwd43-"));
const G41 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v41_golden.json"), "utf8"));
const G42 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v42_golden.json"), "utf8"));
for (const f in G41.debutant_files) fs.writeFileSync(path.join(tmp, f), JSON.stringify(G41.debutant_files[f]));
const writeJ = (name, o) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(o)); return f; };
const runJS = (inF, extra, root) => cp.execFileSync("node", [path.join(root || ROOT, "tools/forward_ledger.js"), inF, "--engine-dir",
  "versions/v4", "--moe", "data/derived/blindtest_stack.json", "--pred-dir", tmp, "--raw"].concat(extra || []),
{ cwd: root || ROOT, maxBuffer: 1 << 28 }).toString();
const flip = (p) => (p == null ? null : 1 - p);
const pyJSON = (code) => JSON.parse(cp.execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'tools'); import forward_ledger as F; " + code],
  { cwd: ROOT }).toString());
const PIN43 = pyJSON("print(json.dumps(F.FWD43_PINNED))");
const CL = ["a_ko", "a_sub", "a_dec", "draw", "b_dec", "b_sub", "b_ko"];
const mirror = { a_ko: "b_ko", a_sub: "b_sub", a_dec: "b_dec", b_ko: "a_ko", b_sub: "a_sub", b_dec: "a_dec", draw: "draw" };

// ---------------------------------------------------------------- 1. identity of fwd-4.1 and fwd-4.2
const inF = writeJ("in.json", G41.input);
const drift41 = Object.entries(G41.inputs_sha256_16).filter(([f, h]) => sha16(f) !== h && sha16(f) !== PIN43[f]).map(([f]) => f);
if (drift41.length) console.log("SKIP 1a fwd-4.1 identity (inputs changed beyond the fwd-4.3 re-pin: " + drift41.join(", ") + ")");
else {
  const repinned = Object.keys(G41.inputs_sha256_16).filter((f) => sha16(f) !== G41.inputs_sha256_16[f]);
  ok(runJS(inF) === G41.outputs.plain, "1a. default (fwd-4.1) JS output is byte-identical to the fwd-4.1 golden");
  ok(runJS(inF, ["--fwd", "4.1"]) === G41.outputs.plain, "1a. --fwd 4.1 JS output is byte-identical to the fwd-4.1 golden");
  ok(runJS(inF, ["--debut-model", "data/derived/debut.json"]) === G41.outputs.debut_model, "1a. --debut-model hook output is byte-identical");
  console.log("1a. fwd-4.1 identity (JS): golden reproduced%s", repinned.length ? " across the fwd-4.3 re-pin of " + repinned.join(", ") : "");
}
const drift42 = Object.entries(G42.inputs_sha256_16).filter(([f, h]) => sha16(f) !== h).map(([f]) => f);
const debNow = fs.readdirSync(path.join(ROOT, "data/predictions")).filter((f) => /^debutants_.*\.json$/.test(f)).sort()
  .map((f) => "data/predictions/" + f);
const debDrift = JSON.stringify(debNow) !== JSON.stringify(Object.keys(G42.pred_dir_debutants)) ||
  debNow.some((f) => sha16(f) !== G42.pred_dir_debutants[f]);
const inN = writeJ("in_noline.json", Object.assign({}, G41.input, { headline: "noline" }));
if (drift42.length) console.log("SKIP 1b fwd-4.2 identity (inputs changed since the fixture: " + drift42.join(", ") + ")");
else {
  ok(runJS(inF, ["--fwd", "4.2"]) === G42.outputs.js_fwd42, "1b. JS --fwd 4.2 output is byte-identical to the pre-fwd-4.3 tool");
  ok(runJS(inN, ["--fwd", "4.2"]) === G42.outputs.js_fwd42_noline, "1b. JS --fwd 4.2 (headline noline) output is byte-identical");
}
// ledger dry runs on the fixture's synthetic card
const DATE = G42.cards.events[0].date;
fs.mkdirSync(path.join(tmp, "odds")); fs.mkdirSync(path.join(tmp, "ledger"));
fs.writeFileSync(path.join(tmp, "odds", "odds_snapshot_" + G42.odds_snapshot.meta.stamp + ".json"), JSON.stringify(G42.odds_snapshot));
const cF = writeJ("cards.json", G42.cards);
const swapCards = JSON.parse(JSON.stringify(G42.cards));
for (const b of swapCards.events[0].bouts) { const t = b.a; b.a = b.b; b.b = t; }
const cR = writeJ("cards_rev.json", swapCards);
const py = (cardsF, extra, root) => cp.spawnSync("python3", [path.join(root || ROOT, "tools/forward_ledger.py"), "predict", "--event", DATE,
  "--cards", cardsF, "--odds-dir", path.join(tmp, "odds"), "--dir", path.join(tmp, "ledger")].concat(G42.py_common, extra),
{ cwd: root || ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const dry = (cardsF, name, extra, root) => {
  const o = path.join(tmp, name), r = py(cardsF, ["--dry-run", "--dry-out", o].concat(extra || []), root);
  if (r.status !== 0) { console.log(r.stdout.slice(-2000), r.stderr.slice(-2000)); throw new Error("dry run failed: " + name); }
  return { doc: JSON.parse(fs.readFileSync(o, "utf8")), stdout: r.stdout };
};
const normalize = (doc) => {
  const d = JSON.parse(JSON.stringify(doc));
  delete d.created_utc;
  for (const k of ["code_commit", "uncommitted_changes", "code_sha256_16"]) delete d.model[k];
  if (d.odds_snapshot) d.odds_snapshot.file = path.basename(d.odds_snapshot.file);
  return JSON.stringify(d);
};
const D = {};
for (const k in G42.py_runs) D[k] = dry(cF, k + ".json", G42.py_runs[k]).doc;
if (drift42.length || debDrift) console.log("SKIP 1c ledger identity (inputs or data/predictions/debutants_*.json changed since the fixture)");
else for (const k in G42.py_runs) ok(normalize(D[k]) === G42.outputs[k], "1c. tools/forward_ledger.py " + G42.py_runs[k].join(" ") + " dry run = the pre-fwd-4.3 document");
if (!drift42.length && !debDrift) console.log("1b-c. fwd-4.2 identity: JS (line, no-line headline) and %d ledger documents byte-identical", Object.keys(G42.py_runs).length);

// ---------------------------------------------------------------- 2. fwd-4.3 against fwd-4.2
const J42 = JSON.parse(runJS(inF, ["--fwd", "4.2"])), J43 = JSON.parse(runJS(inF, ["--fwd", "4.3"]));
ok(J43.meta.fwd === "4.3" && J43.meta.model_keys.slice(-2).join() === "debut_model,moe_noline", "2. JS meta: fwd 4.3, model_keys end with debut_model, moe_noline");
const strip43 = (o) => {
  const c = JSON.parse(JSON.stringify(o));
  c.meta.fwd = "4.2"; c.meta.model_keys = c.meta.model_keys.filter((k) => k !== "moe_noline");
  for (const b of c.bouts) delete b.models.moe_noline;
  return JSON.stringify(c);
};
ok(strip43(J43) === JSON.stringify(J42), "2. JS --fwd 4.3 minus models.moe_noline = JS --fwd 4.2, byte for byte");
J43.bouts.forEach((b) => ok(b.models.moe_noline === b.models.stack_noline && ((b.debut_a || b.debut_b) === (b.models.moe_noline === null)),
  "2. " + b.bout_id + " moe_noline = stack_noline (null exactly on debut bouts)"));
const P42 = D.py_fwd42, P42n = D.py_fwd42_noline;
const P43 = dry(cF, "p43.json", ["--fwd", "4.3"]);
const Q43 = dry(cR, "q43.json", ["--fwd", "4.3"]).doc;
const P43n = dry(cF, "p43n.json", ["--fwd", "4.3", "--headline", "noline"]).doc;
const Pa = dry(cF, "pauto.json", []).doc;
const A = P43.doc;
ok(/^fwd-4\.3: primary ml2_stack_open, no-line primary ml2_stack_noline /.test(A.model.version) && A.model.tool === "tools/forward_ledger.py 1.3" &&
  A.model.fwd === "4.3", "2. model block: fwd-4.3 version string, tool 1.3");
// fwd-4.4 (README "Forward model v4.4", Nov 7) supersedes fwd-4.3 from 2026-11-14: auto now picks fwd-4.4 there
ok(/^fwd-4\.4:/.test(Pa.model.version), "2. --fwd auto writes fwd-4.4 (which superseded fwd-4.3) for an event dated " + DATE);
ok(A.model.noline_primary === "ml2_stack_noline" && A.model.noline_fallback === "moe_noline" && /6\.5\.1\(b\) reads p_a_noline/.test(A.model.drift_rule_b) &&
  /Forward model v4\.3/.test(A.model.preregistration.readme_section) && /not clean on the vault/.test(A.model.preregistration.audit1_flag),
"2. model block names the no-line primary, its fallback, the rule (b) column, the README section and the audit-1 flag");
ok(A.model.models.moe_noline && /NO-LINE PRIMARY/.test(A.model.models.ml2_stack_noline) && A.model.engine.engine_dir === "versions/v4",
  "2. model definitions list moe_noline and mark ml2_stack_noline as the no-line primary; engine versions/v4");
const SAME = ["bout_id", "order", "a", "b", "weight_class", "rounds", "title", "status", "p_a_line", "p_elo", "elo_seed", "experts",
  "stack_weights", "engine", "methodround_S", "market", "notes", "debut_method", "debut_path", "p_method_secondary"];
let nNoLineVet = 0, nLineVet = 0, nDebut = 0;
A.bouts.forEach((x, i) => {
  const z = P42.bouts[i], tag = "2. " + x.bout_id;
  for (const k of SAME) ok(JSON.stringify(x[k]) === JSON.stringify(z[k]), tag + " " + k + " equals fwd-4.2");
  const m = Object.assign({}, x.models); delete m.moe_noline;
  ok(JSON.stringify(m) === JSON.stringify(z.models), tag + " models block = fwd-4.2's plus moe_noline");
  ok(x.models.moe_noline === x.models.stack_noline, tag + " models.moe_noline = models.stack_noline");
  const debut = x.flags.some((f) => /^debut_[ab]$/.test(f));
  if (debut) {
    nDebut++;
    for (const k of ["p_a", "p_a_source", "p_a_noline", "p_method", "p_method_source", "p_distance", "p_finish_round", "statlines", "flags"])
      ok(JSON.stringify(x[k]) === JSON.stringify(z[k]), tag + " debut bout: " + k + " unchanged from fwd-4.2");
    ok(x.p_a_noline === x.p_elo && /^elo_debut_(seeded|prior)$/.test(x.p_a_noline_source) && x.models.moe_noline === null, tag + " debut bout: p_a_noline = seeded Elo");
    return;
  }
  ok(x.p_a_noline === x.models.ml2_stack_noline && x.p_a_noline_source === "ml2_stack_noline", tag + " p_a_noline = models.ml2_stack_noline");
  ok(z.p_a_noline === z.models.stack_noline, tag + " (fwd-4.2's p_a_noline was the MoE stack)");
  ok(x.flags.indexOf("noline_fallback") < 0 && JSON.stringify(x.flags) === JSON.stringify(z.flags), tag + " flags unchanged (no fallback)");
  if (x.market) {
    nLineVet++;
    for (const k of ["p_a", "p_a_source", "p_method", "p_method_source", "p_distance", "p_finish_round", "statlines"])
      ok(JSON.stringify(x[k]) === JSON.stringify(z[k]), tag + " bout with a line: " + k + " unchanged from fwd-4.2");
  } else {
    nNoLineVet++;
    ok(x.p_a === x.p_a_noline && x.p_a_source === "ml2_stack_noline", tag + " no line: p_a = the ML v2 no-line stack");
    ok(z.p_a === z.p_a_noline && z.p_a_source === "moe_stack", tag + " (fwd-4.2: p_a = the MoE no-line stack)");
    const pm = x.p_method;
    ok(near(CL.reduce((s, k) => s + pm[k], 0), 1, 4e-5) && near(pm.a_ko + pm.a_sub + pm.a_dec, x.p_a * (1 - pm.draw), 4e-5),
      tag + " no line: method cells sum to 1 and follow the new p_a");
    ok(pm.draw === z.p_method.draw && near(pm.a_ko / (pm.a_ko + pm.a_sub + pm.a_dec), z.p_method.a_ko / (z.p_method.a_ko + z.p_method.a_sub + z.p_method.a_dec), 2e-4),
      tag + " no line: same method-and-round head (draw share, P(method | a wins)), rescaled");
    ok(near(x.statlines.length.p_distance, x.p_distance, 1e-4), tag + " no line: stat-line length grid matches the new p_distance");
  }
});
ok(nNoLineVet >= 1 && nLineVet >= 2 && nDebut === 4, "2. card covers veterans with and without a line and four debut bouts (" + [nNoLineVet, nLineVet, nDebut] + ")");
// headline noline: p_a = p_a_noline everywhere (the new column on veterans, seeded Elo on debut bouts)
P43n.bouts.forEach((x, i) => {
  const z = P42n.bouts[i], debut = x.flags.some((f) => /^debut_[ab]$/.test(f));
  ok(x.p_a === x.p_a_noline && x.p_a_noline === A.bouts[i].p_a_noline, "2. headline noline " + x.bout_id + ": p_a = p_a_noline");
  if (debut) ok(JSON.stringify(x.p_method) === JSON.stringify(z.p_method), "2. headline noline " + x.bout_id + ": debut method unchanged");
});
ok(P43n.model.primary === "ml2_stack_noline" && /ML v2 no-line stack/.test(P43n.model.p_a), "2. headline noline: model.primary = ml2_stack_noline");
ok(/no-line \(fwd-4\.3\): p_a_noline/.test(P43.stdout), "2. the dry run prints the no-line table (ML v2 vs MoE)");
console.log("2. fwd-4.3 vs fwd-4.2: %d veterans without a line, %d with, %d debut bouts; only the pre-registered fields differ", nNoLineVet, nLineVet, nDebut);

// ---------------------------------------------------------------- 3. corner symmetry
const revIn = { date: G41.input.date, sims: G41.input.sims, bouts: G41.input.bouts.map((b) => ({ bout_id: b.bout_id + "r", a: b.b, b: b.a,
  key_a: b.key_b, key_b: b.key_a, name_a: b.name_b, name_b: b.name_a, division: b.division, rounds: b.rounds, title: b.title,
  p_line: flip(b.p_line), p_open_in: flip(b.p_open_in), p_novig: flip(b.p_novig) })) };
const R43 = JSON.parse(runJS(writeJ("rev.json", revIn), ["--fwd", "4.3"]));
let sJS = 0;
J43.bouts.forEach((x, i) => {
  const y = R43.bouts[i];
  for (const k of J43.meta.model_keys) {
    ok((x.models[k] == null) === (y.models[k] == null), "3. JS " + x.bout_id + " " + k + " null on one side only");
    if (x.models[k] != null) sJS = Math.max(sJS, Math.abs(x.models[k] + y.models[k] - 1));
  }
});
ok(sJS <= 1e-9, "3. JS --fwd 4.3: every models entry (moe_noline included) satisfies P(a | a, b) = 1 - P(b | b, a) (max " + sJS.toExponential(2) + ")");
let sPy = 0, slMis = 0, slN = 0;
A.bouts.forEach((x, i) => {
  const y = Q43.bouts[i], tag = "3. " + x.bout_id;
  sPy = Math.max(sPy, Math.abs(x.p_a + y.p_a - 1), Math.abs(x.p_a_noline + y.p_a_noline - 1), Math.abs(x.p_elo + y.p_elo - 1), Math.abs(x.p_distance - y.p_distance));
  ok(x.p_a_noline_source === y.p_a_noline_source && x.p_a_source === y.p_a_source && JSON.stringify(x.flags.map((f) => f.replace(/_[ab]$/, "")).sort()) ===
    JSON.stringify(y.flags.map((f) => f.replace(/_[ab]$/, "")).sort()), tag + " sources and flags mirror");
  for (const k in x.models) if (x.models[k] != null) sPy = Math.max(sPy, Math.abs(x.models[k] + y.models[k] - 1));
  for (const k of CL) sPy = Math.max(sPy, Math.abs(x.p_method[k] - y.p_method[mirror[k]]));
  for (let r = 0; r < x.rounds; r++) sPy = Math.max(sPy, Math.abs(x.p_finish_round.a[r] - y.p_finish_round.b[r]));
  for (const st of x.statlines.stats) for (const [s, t] of [["a", "b"], ["b", "a"]]) {
    const u = x.statlines[s][st], v = y.statlines[t][st];
    slN++;
    if (u.p10 !== v.p10 || u.p50 !== v.p50 || u.p90 !== v.p90 || !near(u.mean, v.mean, 2e-5)) slMis++;
  }
});
ok(sPy <= 1.1e-5, "3. ledger fwd-4.3: p_a, p_a_noline, p_elo, models, p_method, p_finish_round mirror under a/b swap (max " + sPy.toExponential(2) + ", 5-decimal rounding)");
ok(slMis === 0, "3. ledger fwd-4.3: stat lines swap sides exactly (" + slMis + " of " + slN + " differ)");
console.log("3. symmetry: JS max %s, ledger max %s, %d stat-line entries swap exactly", sJS.toExponential(2), sPy.toExponential(2), slN);

// ---------------------------------------------------------------- 4. the no-line stack vs the Python export
const FM = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/forward_models.json"), "utf8"));
const NL = FM.ml2_static.noline;
const readme = fs.readFileSync(path.join(ROOT, "data/predictions/README.md"), "utf8");
const sec43 = readme.slice(readme.indexOf("## Forward model v4.3"), readme.indexOf("## Card snapshot notes"));
ok(sec43.indexOf(shaFile(path.join(ROOT, "data/derived/forward_models.json"))) >= 0, "4. README fwd-4.3 names forward_models.json's full sha256");
ok(NL.inputs.join() === "ml2lr,mkt_rating" && sec43.indexOf("`[" + NL.weights.join(", ") + "]`") >= 0 && NL.recency_half_life_years === 1.5,
  "4. README fwd-4.3 names the block's inputs and full-precision weights (" + NL.weights.join(", ") + ")");
const LBSDIV = { 115: "Women's Strawweight", 125: "Flyweight", 135: "Bantamweight", 145: "Featherweight", 155: "Lightweight", 170: "Welterweight",
  185: "Middleweight", 205: "Light Heavyweight", 265: "Heavyweight" };
const vecs = FM.test_vectors.filter((v) => !v.fight.fw && LBSDIV[v.fight.lbs]);
const byDate = {};
vecs.forEach((v, i) => { (byDate[v.fight.date] = byDate[v.fight.date] || []).push([i, v]); });
const lg = (p) => { p = Math.min(Math.max(p, NL.pclip), 1 - NL.pclip); return Math.log(p / (1 - p)); };
let dPy = 0, dForm = 0, dLR = 0, nV = 0;
for (const date in byDate) {
  const inp = { date, sims: 10, bouts: byDate[date].map(([i, v]) => ({ bout_id: date + ":tv" + i + ":" + v.a + "__" + v.b, a: v.a, b: v.b, key_a: v.a, key_b: v.b,
    name_a: v.a, name_b: v.b, division: LBSDIV[v.fight.lbs], rounds: v.fight.five ? 5 : 3, title: false, p_line: null, p_open_in: null, p_novig: null })) };
  const out = JSON.parse(runJS(writeJ("tv_" + date + ".json", inp), ["--fwd", "4.3"]));
  out.bouts.forEach((r, j) => {
    const v = byDate[date][j][1];
    nV++;
    dPy = Math.max(dPy, Math.abs(r.models.ml2_stack_noline - v.p_stack_noline));
    dLR = Math.max(dLR, Math.abs(r.models.ml2_lr - v.pA));
    const zf = NL.weights[0] * lg(r.ml2.pA) + NL.weights[1] * (r.ml2.pMR == null ? 0 : lg(r.ml2.pMR));
    dForm = Math.max(dForm, Math.abs(r.models.ml2_stack_noline - 1 / (1 + Math.exp(-zf))));
  });
}
ok(nV >= 20, "4. " + nV + " Python test vectors without fight-week flags evaluated through tools/forward_ledger.js");
ok(dPy <= 1e-12, "4. models.ml2_stack_noline = forward_models.json p_stack_noline (tools/ml2.py page_stack_eval) to 1e-12 (max " + dPy.toExponential(2) + ")");
ok(dLR <= 1e-12, "4. models.ml2_lr = the Python ML v2 logistic to 1e-12 (max " + dLR.toExponential(2) + ")");
ok(dForm <= 1e-12, "4. models.ml2_stack_noline = the README formula on the block's weights to 1e-12 (max " + dForm.toExponential(2) + ")");
let dLed = 0;
A.bouts.forEach((x) => { if (x.p_a_noline_source === "ml2_stack_noline") dLed = Math.max(dLed, Math.abs(x.p_a_noline - Math.round(x.models.ml2_stack_noline * 1e5) / 1e5)); });
ok(dLed === 0, "4. the ledger's p_a_noline is models.ml2_stack_noline at the file's 5 decimals");
console.log("4. no-line stack vs Python export: %d vectors, max |diff| %s (formula %s)", nV, dPy.toExponential(2), dForm.toExponential(2));

// ---------------------------------------------------------------- 5. fallback when the ML v2 roster lacks a fighter
const FB = path.join(tmp, "fbroot");
for (const d of ["tools", "data/derived"]) fs.mkdirSync(path.join(FB, d), { recursive: true });
for (const f of ["forward_ledger.py", "forward_ledger.js", "forward_statlines.js", "methodround_model.js"]) fs.copyFileSync(path.join(ROOT, "tools", f), path.join(FB, "tools", f));
for (const d of ["src", "versions"]) fs.symlinkSync(path.join(ROOT, d), path.join(FB, d));
fs.symlinkSync(path.join(ROOT, "data/predictions"), path.join(FB, "data/predictions"));
for (const f of fs.readdirSync(path.join(ROOT, "data/derived"))) if (f !== "ml2.json") fs.symlinkSync(path.join(ROOT, "data/derived", f), path.join(FB, "data/derived", f));
const ML2J = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/ml2.json"), "utf8"));
const GONE = "chris-duncan";                          // a veteran on the synthetic card (Dober vs Duncan, with a line)
delete ML2J.page_model.roster[GONE];
fs.writeFileSync(path.join(FB, "data/derived/ml2.json"), JSON.stringify(ML2J));
const F5 = dry(cF, "fb43.json", ["--fwd", "4.3"], FB);
ok(/WARNING \(dry run\): fwd-4\.3 pinned input differs: data\/derived\/ml2\.json/.test(F5.stdout) && F5.doc.model.preregistration.pinned_inputs_ok === false,
  "5. the modified ml2.json is reported as a pinned-input mismatch (dry run only)");
F5.doc.bouts.forEach((x, i) => {
  const a = A.bouts[i], tag = "5. " + x.bout_id;
  if ([x.a.slug, x.b.slug].indexOf(GONE) >= 0) {
    ok(x.models.ml2_stack_noline === null && x.models.moe_noline != null && x.p_a_noline === x.models.moe_noline &&
      x.p_a_noline_source === "moe_stack (noline_fallback)" && x.flags.indexOf("noline_fallback") >= 0, tag + " no ML v2 row: p_a_noline = the MoE stack, flagged noline_fallback");
    ok(x.p_a_source !== "ml2_stack_open" && x.flags.indexOf("primary_fallback") >= 0, tag + " no ML v2 row: p_a falls back as in fwd-4.1 (primary_fallback)");
  } else ok(x.p_a_noline === a.p_a_noline && x.p_a_noline_source === a.p_a_noline_source && x.flags.indexOf("noline_fallback") < 0, tag + " other bouts unchanged");
});
console.log("5. fallback: %s missing from the ML v2 roster -> p_a_noline from the MoE stack, flagged", GONE);

// ---------------------------------------------------------------- 6. guards, README tables
const fv = pyJSON("print(json.dumps([F.fwd_for_date(d) for d in ['2026-11-07', '2026-11-13', '2026-11-14', '2026-12-30', '2027-06-01']]))");
ok(fv.join() === "4.1,4.1,4.4,4.4,4.4", "6. --fwd auto: fwd-4.1 before 2026-11-14, fwd-4.4 (superseding fwd-4.3) from it (" + fv.join() + ")");
const r42 = py(cF, ["--fwd", "4.2"]);
ok(r42.status !== 0 && /refused: data\/predictions\/README\.md assigns fwd-4\.4/.test(r42.stderr + r42.stdout), "6. writing fwd-4.2 for an event the README assigns to fwd-4.4 (formerly fwd-4.3) is refused");
const r41 = py(cF, ["--fwd", "4.1"]);
ok(r41.status !== 0 && /assigns fwd-4\.4/.test(r41.stderr + r41.stdout), "6. writing fwd-4.1 for a fwd-4.4 event is refused");
const vegas = cp.spawnSync("python3", [path.join(ROOT, "tools/forward_ledger.py"), "predict", "--event", "2026-11-07", "--fwd", "4.3",
  "--dir", path.join(tmp, "ledger")], { cwd: ROOT, encoding: "utf8" });
ok(vegas.status !== 0 && /refused/.test(vegas.stderr + vegas.stdout), "6. writing fwd-4.3 for the Vegas 124 card (fwd-4.1) is refused");
ok(fs.readdirSync(path.join(tmp, "ledger")).length === 0, "6. refused runs wrote nothing");
const tsec = readme.slice(readme.indexOf("### Files and hashes fwd-4.3 reads"), readme.indexOf("- **Re-pin of two evaluators.**"));
const rows = {};
for (const m of tsec.matchAll(/^\| ([a-z0-9_/.]+) \| ([0-9a-f]{16}) \|/gm)) rows[m[1]] = m[2];
ok(Object.keys(rows).length === 25 && JSON.stringify(rows) === JSON.stringify(PIN43) && JSON.stringify(A.model.preregistration.pinned_inputs) === JSON.stringify(PIN43),
  "6. README fwd-4.3 hash table (25 files) = the tool's FWD43_PINNED = the file's preregistration.pinned_inputs");
const onDisk = Object.entries(rows).filter(([f, h]) => sha16(f) !== h).map(([f]) => f);
if (onDisk.length) console.log("NOTE: fwd-4.3 pinned files changed on disk (a fwd-4.3 write would be refused): " + onDisk.join(", "));
ok(A.model.preregistration.pinned_inputs_ok === (onDisk.length === 0), "6. pinned_inputs_ok reflects the files on disk");
const add = readme.slice(readme.indexOf("### Addendum: fwd-4.3 implementation"), readme.indexOf("## Card snapshot notes"));
ok(readme.indexOf("### Addendum: fwd-4.3 implementation") > readme.indexOf("## Forward model v4.3"), "6. the fwd-4.3 implementation addendum exists");
for (const f of ["tools/forward_ledger.py", "tools/forward_ledger.js", "tools/forward_statlines.js"]) {
  const hs = [...add.matchAll(new RegExp("`" + f.replace(/[.]/g, "\\.") + "`[^:\\n]*: ([0-9a-f]{16})", "g"))].map((m) => m[1]);
  ok(hs.length > 0 && hs[hs.length - 1] === sha16(f), "6. README fwd-4.3 addendum code hash of " + f + " (" + hs[hs.length - 1] + ") = the file on disk (" + sha16(f) + ")");
  ok(A.model.code_sha256_16[f] === sha16(f), "6. the fwd-4.3 file records the code hash of " + f);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log((fails ? "FAILED " : "ok ") + (checks - fails) + "/" + checks + " checks");
process.exit(fails ? 1 : 0);
