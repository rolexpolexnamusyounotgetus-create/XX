#!/usr/bin/env node
/* tests/test_forward_v44.js: forward model v4.4 (data/predictions/README.md "Forward model v4.4 (Nov 7, 2026)").
     node tests/test_forward_v44.js          (about 40 s: evaluator runs and ten dry runs of tools/forward_ledger.py)
   1. Identity of the older versions against tests/fixtures/forward_v43_golden.json, captured from the tools before fwd-4.4
      existed: JS --fwd 4.3 (line and no-line headline) byte for byte, and the tools/forward_ledger.py dry-run documents for
      fwd-4.3 (both headlines), fwd-4.2 and fwd-4.1, byte for byte after removing the run-specific fields the fixture lists.
      fwd-4.1 and fwd-4.2 JS identity stays in tests/test_forward_v43.js. Skipped (and said so) when an input changed.
   2. fwd-4.4 = fwd-4.3 on the same inputs: JS --fwd 4.4 = --fwd 4.3 apart from meta.fwd; with --live-dir pointing at live
      files whose bytes equal the pinned files (the zero-diff state), JS and tools/forward_statlines.js outputs equal the
      pinned-input runs apart from meta.live_*; the ledger fwd-4.4 document has every bout field of the fwd-4.3 document
      and a model block that names fwd-4.4, tool 1.4, the README section and the live inputs (manifest path and sha256).
   3. Fallback: a missing or tampered live folder gives live_inputs.fallback = true with the reason, the flag
      live_inputs_fallback on every bout, and otherwise fwd-4.3's numbers exactly.
   4. Live inputs are read: a live folder whose market rating for one fighter differs (manifest updated; a live part, so
      check_live passes) moves that fighter's bout (market-rating expert, ML v2 no-line stack, p_a_noline) and no other.
   5. Corner symmetry of the fwd-4.4 ledger document on live inputs (a/b swapped).
   6. Guards: --fwd auto picks fwd-4.4 from 2026-11-14 (fwd-4.1 before); a fwd-4.3 write is refused; --live-dir is refused
      outside a dry run; the README fwd-4.4 addendum names the code on disk. */
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwd44-"));
const G41 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v41_golden.json"), "utf8"));
const G42 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v42_golden.json"), "utf8"));
const G43 = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/forward_v43_golden.json"), "utf8"));
for (const f in G41.debutant_files) fs.writeFileSync(path.join(tmp, f), JSON.stringify(G41.debutant_files[f]));
const writeJ = (name, o) => { const f = path.join(tmp, name); fs.writeFileSync(f, JSON.stringify(o)); return f; };
const runJS = (inF, extra) => cp.execFileSync("node", [path.join(ROOT, "tools/forward_ledger.js"), inF, "--engine-dir",
  "versions/v4", "--moe", "data/derived/blindtest_stack.json", "--pred-dir", tmp, "--raw"].concat(extra || []),
{ cwd: ROOT, maxBuffer: 1 << 28 }).toString();
const LIVE = path.join(ROOT, "data/derived/live");
const LIVE_FILES = { fighters: "fighters_live.json", market: "market_live.json", ratings: "ratings_live.json", ml: "ml_live.json",
  ml2: "ml2_live.json", methodround: "methodround_live.json" };
const PINNED = { fighters: "fighters.json", market: "market.json", ratings: "ratings.json", ml: "ml.json", ml2: "ml2.json",
  methodround: "methodround.json" };

// ---------------------------------------------------------------- 1. identity against the pre-fwd-4.4 tools
const inF = writeJ("in.json", G41.input);
const inN = writeJ("in_noline.json", Object.assign({}, G41.input, { headline: "noline" }));
const drift = Object.entries(G43.inputs_sha256_16).filter(([f, h]) => sha16(f) !== h).map(([f]) => f);
const debNow = fs.readdirSync(path.join(ROOT, "data/predictions")).filter((f) => /^debutants_.*\.json$/.test(f)).sort()
  .map((f) => "data/predictions/" + f);
const debDrift = JSON.stringify(debNow) !== JSON.stringify(Object.keys(G43.pred_dir_debutants)) ||
  debNow.some((f) => sha16(f) !== G43.pred_dir_debutants[f]);
if (drift.length) console.log("SKIP 1a JS identity (inputs changed since the fixture: " + drift.join(", ") + ")");
else {
  ok(runJS(inF, ["--fwd", "4.3"]) === G43.outputs.js_fwd43, "1a. JS --fwd 4.3 output is byte-identical to the pre-fwd-4.4 tool");
  ok(runJS(inN, ["--fwd", "4.3"]) === G43.outputs.js_fwd43_noline, "1a. JS --fwd 4.3 (headline noline) output is byte-identical");
}
const DATE = G42.cards.events[0].date;
fs.mkdirSync(path.join(tmp, "odds")); fs.mkdirSync(path.join(tmp, "ledger"));
fs.writeFileSync(path.join(tmp, "odds", "odds_snapshot_" + G42.odds_snapshot.meta.stamp + ".json"), JSON.stringify(G42.odds_snapshot));
const cF = writeJ("cards.json", G42.cards);
const swapCards = JSON.parse(JSON.stringify(G42.cards));
for (const b of swapCards.events[0].bouts) { const t = b.a; b.a = b.b; b.b = t; }
const cR = writeJ("cards_rev.json", swapCards);
const py = (cardsF, extra) => cp.spawnSync("python3", [path.join(ROOT, "tools/forward_ledger.py"), "predict", "--event", DATE,
  "--cards", cardsF, "--odds-dir", path.join(tmp, "odds"), "--dir", path.join(tmp, "ledger")].concat(G43.py_common, extra),
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
  return JSON.stringify(d);
};
const D = {};
for (const k in G43.py_runs) D[k] = dry(cF, k + ".json", G43.py_runs[k]);
if (drift.length || debDrift) console.log("SKIP 1b ledger identity (inputs or data/predictions/debutants_*.json changed since the fixture)");
else {
  for (const k in G43.py_runs) ok(normalize(D[k]) === G43.outputs[k], "1b. tools/forward_ledger.py " + G43.py_runs[k].join(" ") + " dry run = the pre-fwd-4.4 document");
  console.log("1. identity: JS --fwd 4.3 (2 headlines) and %d ledger documents (fwd-4.3 x2, fwd-4.2, fwd-4.1) byte-identical to the pre-fwd-4.4 tools",
    Object.keys(G43.py_runs).length);
}

// ---------------------------------------------------------------- 2. fwd-4.4 = fwd-4.3 on equal inputs
const J43 = JSON.parse(runJS(inF, ["--fwd", "4.3"])), J44 = JSON.parse(runJS(inF, ["--fwd", "4.4"]));
ok(J44.meta.fwd === "4.4", "2. JS meta.fwd 4.4");
J44.meta.fwd = "4.3";
ok(JSON.stringify(J44) === JSON.stringify(J43), "2. JS --fwd 4.4 = --fwd 4.3 apart from meta.fwd");
// a live folder at the zero-diff state: the six live files are byte copies of the pinned files
const liveSame = path.join(tmp, "live_same");
fs.mkdirSync(liveSame);
for (const k in LIVE_FILES) fs.copyFileSync(path.join(ROOT, "data/derived", PINNED[k]), path.join(liveSame, LIVE_FILES[k]));
const haveLive = fs.existsSync(path.join(LIVE, "manifest.json"));
if (haveLive) fs.copyFileSync(path.join(LIVE, "manifest.json"), path.join(liveSame, "manifest.json"));
const J44L = JSON.parse(runJS(inF, ["--fwd", "4.4", "--live-dir", liveSame]));
ok(J44L.meta.live_dir && Object.keys(J44L.meta.live_files).length === 6, "2. JS --live-dir: meta.live_dir and six meta.live_files");
delete J44L.meta.live_dir; delete J44L.meta.live_files; J44L.meta.fwd = "4.3";
ok(JSON.stringify(J44L) === JSON.stringify(J43), "2. JS --fwd 4.4 --live-dir (zero-diff live files) = --fwd 4.3 on the pinned files");
const slIn = writeJ("sl_in.json", { date: DATE, bouts: G41.input.bouts.slice(0, 4).map((b) => Object.assign({}, b,
  { S: new Array(4 * (b.rounds === 5 ? 5 : 3)).fill(0.03).concat([0.3, 0.27, 0.01]) })) });
const runSL = (extra) => JSON.parse(cp.execFileSync("node", [path.join(ROOT, "tools/forward_statlines.js"), slIn, "--engine-dir",
  "versions/v4", "--pred-dir", tmp, "--raw"].concat(extra || []), { cwd: ROOT, maxBuffer: 1 << 28 }).toString());
const S0 = runSL(), S1 = runSL(["--live-dir", liveSame]);
ok(S1.meta.live_dir && !S0.meta.live_dir, "2. forward_statlines --live-dir: meta.live_dir");
delete S1.meta.live_dir;
ok(JSON.stringify(S1) === JSON.stringify(S0), "2. forward_statlines with zero-diff live files = pinned files");
// ledger documents
const P43 = D.py_fwd43;
if (!haveLive) console.log("SKIP 2c-5 (no data/derived/live/manifest.json: run python3 tools/live_refresh.py build)");
else {
  const P44 = dry(cF, "p44.json", ["--fwd", "4.4", "--live-dir", LIVE]);
  const M = P44.model;
  ok(/^fwd-4\.4: primary ml2_stack_open, no-line primary ml2_stack_noline /.test(M.version) && /live roster inputs as of \d{4}-\d\d-\d\d/.test(M.version),
    "2. model.version: fwd-4.4, both primaries, live inputs as_of");
  ok(M.tool === "tools/forward_ledger.py 1.4" && M.fwd === "4.4" && /Forward model v4\.4/.test(M.preregistration.readme_section),
    "2. model block: tool 1.4, fwd 4.4, README v4.4 section");
  const man = path.join(LIVE, "manifest.json");
  ok(M.live_inputs.used === true && M.live_inputs.fallback === false && M.live_inputs.manifest_sha256 === shaFile(man),
    "2. model.live_inputs: used, manifest sha256 = the file's");
  ok(Object.keys(M.live_inputs.files).length === 6 && M.code_sha256_16["tools/live_refresh.py"] === sha16("tools/live_refresh.py"),
    "2. model.live_inputs lists the six live files; code hashes include tools/live_refresh.py");
  const asOf = JSON.parse(fs.readFileSync(man, "utf8")).as_of;
  ok(M.roster_snapshot === asOf, "2. model.roster_snapshot = the manifest's as_of (" + asOf + ")");
  const zeroState = Object.keys(LIVE_FILES).every((k) => shaFile(path.join(LIVE, LIVE_FILES[k])) === shaFile(path.join(ROOT, "data/derived", PINNED[k])));
  if (zeroState) {
    ok(JSON.stringify(P44.bouts) === JSON.stringify(P43.bouts), "2. live set at the zero-diff state: every bout field equals fwd-4.3's");
    console.log("2. fwd-4.4 = fwd-4.3 on equal inputs (JS, stat lines, ledger: %d bouts identical; live as_of %s)", P44.bouts.length, asOf);
  } else console.log("2. live set as of %s differs from the pinned files: bout identity with fwd-4.3 not expected (checked in part 4 instead)", asOf);

  // ---------------------------------------------------------------- 3. fallback
  const Pf = dry(cF, "pf.json", ["--fwd", "4.4", "--live-dir", path.join(tmp, "no_such_live")]);
  ok(Pf.model.live_inputs.fallback === true && /manifest missing/.test(Pf.model.live_inputs.reason), "3. missing live folder: fallback with the reason");
  ok(/fallback: fwd-4\.3 pinned inputs/.test(Pf.model.version), "3. the version string says fallback");
  ok(Pf.bouts.every((b) => b.flags[b.flags.length - 1] === "live_inputs_fallback"), "3. every bout flagged live_inputs_fallback");
  const unflag = (bs) => JSON.stringify(bs.map((b) => Object.assign({}, b, { flags: b.flags.filter((f) => f !== "live_inputs_fallback") })));
  ok(unflag(Pf.bouts) === JSON.stringify(P43.bouts), "3. fallback numbers = fwd-4.3's exactly (apart from the flag)");
  const tam = path.join(tmp, "live_tampered");
  fs.mkdirSync(tam);
  for (const f of fs.readdirSync(LIVE)) fs.copyFileSync(path.join(LIVE, f), path.join(tam, f));
  const ml2 = JSON.parse(fs.readFileSync(path.join(tam, "ml2_live.json"), "utf8"));
  ml2.page_model.stack = {};                                  // a frozen key
  fs.writeFileSync(path.join(tam, "ml2_live.json"), JSON.stringify(ml2));
  const mt = JSON.parse(fs.readFileSync(path.join(tam, "manifest.json"), "utf8"));
  mt.files.ml2.sha256 = shaFile(path.join(tam, "ml2_live.json"));
  fs.writeFileSync(path.join(tam, "manifest.json"), JSON.stringify(mt));
  const Pt = dry(cF, "pt.json", ["--fwd", "4.4", "--live-dir", tam]);
  ok(Pt.model.live_inputs.fallback === true && /guard/.test(Pt.model.live_inputs.reason) && unflag(Pt.bouts) === JSON.stringify(P43.bouts),
    "3. a changed frozen key in a live file: fallback (" + Pt.model.live_inputs.reason + ")");
  console.log("3. fallback: missing folder and tampered frozen key both fall back to fwd-4.3's numbers, flagged");

  // ---------------------------------------------------------------- 4. live inputs are read
  const lv = path.join(tmp, "live_moved");
  fs.mkdirSync(lv);
  for (const f of fs.readdirSync(LIVE)) fs.copyFileSync(path.join(LIVE, f), path.join(lv, f));
  const bi = P43.bouts.findIndex((b) => b.a.slug && b.b.slug && b.models.ml2_stack_noline != null && b.experts && b.experts.mkt_rating != null);
  const target = P43.bouts[bi].a.slug;
  const mk = JSON.parse(fs.readFileSync(path.join(lv, "market_live.json"), "utf8"));
  mk.ratings[target][0] += 0.8;                                // a live part: the fighter's market rating
  fs.writeFileSync(path.join(lv, "market_live.json"), JSON.stringify(mk));
  const ml = JSON.parse(fs.readFileSync(path.join(lv, "ml2_live.json"), "utf8"));
  ml.page_model.roster[target].mr[0] += 0.8;                   // and its copy in the ML v2 roster
  fs.writeFileSync(path.join(lv, "ml2_live.json"), JSON.stringify(ml));
  const mm = JSON.parse(fs.readFileSync(path.join(lv, "manifest.json"), "utf8"));
  mm.files.market.sha256 = shaFile(path.join(lv, "market_live.json"));
  mm.files.ml2.sha256 = shaFile(path.join(lv, "ml2_live.json"));
  fs.writeFileSync(path.join(lv, "manifest.json"), JSON.stringify(mm));
  const Pm = dry(cF, "pm.json", ["--fwd", "4.4", "--live-dir", lv]);
  ok(Pm.model.live_inputs.used === true, "4. a changed live part with a matching manifest is used");
  const base = dry(cF, "p44b.json", ["--fwd", "4.4", "--live-dir", LIVE]);
  Pm.bouts.forEach((b, i) => {
    const z = base.bouts[i];
    if (i === bi) {
      ok(b.experts.mkt_rating > z.experts.mkt_rating && b.models.ml2_stack_noline > z.models.ml2_stack_noline && b.p_a_noline > z.p_a_noline,
        "4. " + b.bout_id + ": a higher market rating for " + target + " raises mkt_rating, ml2_stack_noline and p_a_noline");
    } else {
      const touches = [b.a.slug, b.b.slug].indexOf(target) >= 0;
      if (!touches) ok(JSON.stringify(b) === JSON.stringify(z), "4. " + b.bout_id + " unchanged");
    }
  });
  console.log("4. live inputs are read: %s's market rating moves only his bout (p_a_noline %.4f -> %.4f)", target,
    base.bouts[bi].p_a_noline, Pm.bouts[bi].p_a_noline);

  // ---------------------------------------------------------------- 5. corner symmetry on live inputs
  const Q44 = dry(cR, "q44.json", ["--fwd", "4.4", "--live-dir", LIVE]);
  let mx = 0;
  P44.bouts.forEach((b, i) => {
    const q = Q44.bouts[i];
    for (const k of ["p_a", "p_a_noline", "p_elo"]) if (b[k] != null) mx = Math.max(mx, Math.abs(b[k] - (1 - q[k])));
    for (const k in b.models) if (b.models[k] != null && q.models[k] != null) mx = Math.max(mx, Math.abs(b.models[k] - (1 - q.models[k])));
  });
  ok(mx <= 1.1e-5, "5. fwd-4.4 on live inputs: p_a, p_a_noline, p_elo and every models entry mirror under a/b swap (max " + mx.toExponential(2) + ")");
}

// ---------------------------------------------------------------- 6. guards, README
const fv = JSON.parse(cp.execFileSync("python3", ["-c", "import sys, json; sys.path.insert(0, 'tools'); import forward_ledger as F; " +
  "print(json.dumps([F.fwd_for_date(d) for d in ('2026-11-07', '2026-11-13', '2026-11-14', '2026-11-21', '2026-12-12')]))"], { cwd: ROOT }).toString());
ok(fv.join() === "4.1,4.1,4.4,4.4,4.4", "6. --fwd auto: fwd-4.1 before 2026-11-14, fwd-4.4 from it (" + fv.join() + ")");
const Pa = dry(cF, "pauto.json", []);
ok(/^fwd-4\.4:/.test(Pa.model.version), "6. --fwd auto writes fwd-4.4 for an event dated " + DATE);
const r43 = py(cF, ["--fwd", "4.3"]);
ok(r43.status !== 0 && /refused: data\/predictions\/README\.md assigns fwd-4\.4/.test(r43.stderr + r43.stdout), "6. writing fwd-4.3 for a fwd-4.4 event is refused");
const rl = py(cF, ["--fwd", "4.4", "--live-dir", LIVE]);
ok(rl.status !== 0 && /--live-dir is for dry runs/.test(rl.stderr + rl.stdout), "6. --live-dir outside a dry run is refused");
ok(fs.readdirSync(path.join(tmp, "ledger")).length === 0, "6. refused runs wrote nothing");
const readme = fs.readFileSync(path.join(ROOT, "data/predictions/README.md"), "utf8");
const i44 = readme.indexOf("## Forward model v4.4");
const sec44 = i44 >= 0 ? readme.slice(i44, readme.indexOf("\n## ", i44 + 5)) : "";
ok(sec44.length > 0, "6. README has the fwd-4.4 section");
for (const f of ["tools/forward_ledger.py", "tools/forward_ledger.js", "tools/forward_statlines.js", "tools/live_refresh.py"]) {
  const re = new RegExp("`" + f.replace(/[./]/g, (c) => "\\" + c) + "`[^:\\n]*:\\s*([0-9a-f]{16})", "g");
  const hs = [];
  let m;
  while ((m = re.exec(sec44))) hs.push(m[1]);
  ok(hs.length > 0 && hs[hs.length - 1] === sha16(f), "6. README fwd-4.4 addendum code hash of " + f + " (" + hs[hs.length - 1] + ") = the file on disk (" + sha16(f) + ")");
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log("%d checks, %d failures", checks, fails);
process.exit(fails ? 1 : 0);
