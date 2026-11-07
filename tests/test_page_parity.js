/* test_page_parity.js (v5.0.1; v5 review "the v5 page / worker build would run a different model from the Node production path"):
   the page's ENGINE script (the files build.py inlines for the __ENGINE__ placeholder, in that order) must run the same model as Node.
     node tests/test_page_parity.js [pairs, default 4] [sims, default 3000]
     ENGINE_DIR=versions/v5.0.1 node tests/test_page_parity.js    # the same bundle built from a frozen version's files
   1. Loads the bundle in a fresh vm context with no require (as the page and its blob Web Worker do) and the same files through
      Node's require; with the same loaders (fighters.json, mlrates.json), summarize() must match exactly for the pairs.
   2. Component coverage: every component the bundle's params switch on must be runnable from the page. A component that needs a
      module (embed -> FightEmbed, blend_anchor -> FightBlend, styles_sos -> StylesSOS, retarget -> StatDist) must find it in the bundle, one that
      needs a roster (durability, preufc, embed) must be loaded by src/app.js, and one that needs per-call inputs (retarget: statTargets /
      statdist; explainer: showFight) must get them from src/app.js, or the page silently runs another model (v10 review). */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const NP = +(process.argv[2] || 4), NS = +(process.argv[3] || 3000);
let pass = 0, fail = 0;
function check(name, ok, info) { if (ok) pass++; else fail++; console.log((ok ? "PASS  " : "FAIL  ") + name + (info ? "  (" + info + ")" : "")); }
const buildSrc = fs.readFileSync(path.join(ROOT, "build.py"), "utf8");
const m = /"\/\*__ENGINE__\*\/":\s*\[([^\]]*)\]/.exec(buildSrc);
if (!m) { console.log("FAIL  could not find the /*__ENGINE__*/ file list in build.py"); process.exit(1); }
const ED = process.env.ENGINE_DIR ? path.resolve(ROOT, process.env.ENGINE_DIR) : null;
const files = m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean)
  .map((f) => (ED && f.startsWith("src/") && fs.existsSync(path.join(ED, f.slice(4))) ? path.relative(ROOT, path.join(ED, f.slice(4))) : f));
const code = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
const ctx = { console, Math, JSON, Date, Float64Array, Int8Array, Uint32Array, ArrayBuffer, Object, Array, Number, String, Error, isFinite, isNaN, parseInt, parseFloat };
ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: "page-ENGINE-bundle.js" });
const EB = ctx.FightEngine;
check("the bundle defines FightEngine, FightParams and MLRates", !!EB && !!ctx.FightParams && !!ctx.MLRates, files.join(" + "));
const EN = require(path.join(ED || path.join(ROOT, "src"), "engine3.js"));
check("same engine and params versions", EB.VERSION === EN.VERSION && ctx.FightParams.version === EN.params().version, EB.VERSION + " / " + ctx.FightParams.version);
const db = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8"), mlr = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlrates.json"), "utf8"));
for (const E of [EB, EN]) { E.loadDB(JSON.parse(db)); if (E.loadMLRates) E.loadMLRates(mlr); }
const PAIRS = [["alexander-volkanovski", "justin-gaethje", "Lightweight", 5, false], ["tom-aspinall", "ciryl-gane", "Heavyweight", 5, true],
  ["zhang-weili", "tatiana-suarez", "Women's Strawweight", 5, true], ["islam-makhachev", "belal-muhammad", "Welterweight", 5, true]].slice(0, NP);
for (const [a, b, div, R, title] of PAIRS) {
  const pa = EN.profile(a), pb = EN.profile(b);
  if (!pa || !pb) { check(`pair ${a} vs ${b} in the roster`, false); continue; }
  const opts = { division: div, rounds: R, title, date: "2026-11-14" };
  const sb = EB.summarize(EB.matchup(a, b, opts), NS, 7), sn = EN.summarize(EN.matchup(a, b, opts), NS, 7);
  check(`${a} vs ${b}: page bundle = Node (summarize, ${NS} sims)`, JSON.stringify(sb) === JSON.stringify(sn), `pA ${sb.pA.toFixed(3)} / ${sn.pA.toFixed(3)}`);
}
// component coverage
const P = ctx.FightParams, comp = (P && P.components) || {}, app = fs.readFileSync(path.join(ROOT, "src/app.js"), "utf8");
const on = (k) => !!comp[k] && (k !== "styles_sos" || comp[k] === true || comp[k].sos !== false || comp[k].styles);
// v10 review: the v8 / v10 stat-line bundle (retarget, tdIntent, ctrlSpread) and the explainer were not covered; a page that switches them
// on without the statdist module and per-call targets runs the plain simulator (the retarget records 'no targets' and does nothing)
const NEEDS = { embed: { module: "FightEmbed", loader: "loadEmbed" }, blend_anchor: { module: "FightBlend", loader: "loadBlend" }, styles_sos: { module: "StylesSOS" },
  durability: { loader: "loadDurability" }, preufc: { loader: "loadPreUFC" },
  retarget: { module: "StatDist", app: [/statTargets\s*:/, /statdist\s*:\s*\{\s*SD\s*:/] }, tdIntent: { requires: "retarget" }, ctrlSpread: { requires: "retarget" },
  explainer: { api: "showFight", app: [/\.showFight\s*\(/] } };
for (const k of Object.keys(NEEDS)) {
  if (!on(k)) { check(`component ${k}: off in the page's params (nothing to ship)`, true); continue; }
  const nd = NEEDS[k];
  if (nd.module) check(`component ${k} is on: its module ${nd.module} is in the ENGINE bundle`, !!ctx[nd.module]);
  if (nd.loader) check(`component ${k} is on: src/app.js loads its data (${nd.loader})`, app.indexOf(nd.loader) >= 0);
  if (nd.app) check(`component ${k} is on: src/app.js passes its per-call input (${nd.app.map(String).join(" or ")})`, nd.app.some((re) => re.test(app)));
  if (nd.api) check(`component ${k} is on: the bundle's FightEngine has ${nd.api}()`, !!EB && typeof EB[nd.api] === "function");
  if (nd.requires) check(`component ${k} is on: it acts only with ${nd.requires} on and working`, on(nd.requires));
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
