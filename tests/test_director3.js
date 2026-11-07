/* Director v3 tests: build animation scripts for random roster matchups and check that every beat is valid
   for the 3D show, that the beat stream reproduces the engine's states and stats, and that no play-by-play
   line repeats within a fight. Prints two sample fights' play-by-play.

     node tests/test_director3.js            # 200 matchups (3 and 5 rounds), two samples
     node tests/test_director3.js 1000 7     # 1000 matchups, seed 7
     ENGINE_DIR=/path/to/dir node tests/test_director3.js   # engine3.js + params3.js from another folder
     NO_ML=1 node tests/test_director3.js     # plain base tables: skip the learned stat-line rates
   With an engine that has FightEngine.loadMLRates (v4+), the production learned-rate model (data/derived/mlrates.json)
   is loaded first, as the page does, so every matchup goes through the learned-rate path (v4.0.1 review: the test used
   to run the base tables only). Decisions also check that the per-round judges' scores add up to the fight's cards
   (point deductions included, engine v4.0.1).
     FUZZ=1 node tests/test_director3.js 600   # v5.0.1 (v5 review): every v5 path the stock run never reaches. Loads the
       durability, pre-UFC, embedding and officials rosters and builds each matchup from a random component configuration
       (every components flag and v401 sub-flag, styles_sos sos with walk-forward SOS pairs, officials on with named or unknown
       judges and referees, 2019 / 2026 dates, learned rates off now and then), so a component that changes the trace
       (officials' 10-10 rounds, deductions, dynamics momentum) is checked against the show's beat contract too. Engines
       without these loaders (v3, v4) run the stock matchups.
*/
"use strict";
var fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");
var ENG = process.env.ENGINE_DIR ? path.resolve(process.env.ENGINE_DIR) : path.join(ROOT, "src");
global.FightParams = require(path.join(ENG, "params3.js"));
var E = require(path.join(ENG, "engine3.js"));
var D = require(path.join(ROOT, "src/director3.js"));

var N = +(process.argv[2] || 200), SEED = +(process.argv[3] || 1);
var ML_FILE = path.join(ROOT, "data/derived/mlrates.json");
var USE_ML = !process.env.NO_ML && typeof E.loadMLRates === "function" && fs.existsSync(ML_FILE);
if (USE_ML) E.loadMLRates(JSON.parse(fs.readFileSync(ML_FILE, "utf8")));
var db = E.loadDB(JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8")));
// FUZZ=1 (v5.0.1): rosters plus a random component configuration per matchup (the reviewer's fuzzpre.js preload, folded in)
var FUZZ = process.env.FUZZ === "1" && typeof E.loadDurability === "function" && typeof E.loadOfficials === "function";
var FUZZ_STATS = { n: 0, officials: 0, durability: 0, embed: 0, preufc: 0, sos: 0, dated2019: 0, noMl: 0, errors: 0 };
var fuzzMatchup = null;
if (FUZZ) (function () {
  var J = function (f) { return JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")); };
  E.loadDurability(J("data/derived/durability.json"));
  if (E.loadPreUFC) E.loadPreUFC(J("data/derived/preufc.json"));
  if (E.loadEmbed) E.loadEmbed(J("data/derived/embed_model.json"));
  var OFFJ = J("data/derived/officials_engine.json"); E.loadOfficials(OFFJ);
  var tab = E.officialsTableFor(OFFJ, null), jn = Object.keys(tab.judges).map(function (k) { return tab.judges[k][0]; }), rn = Object.keys(tab.referees);
  var SOSJ = J("data/derived/sos_wf.json"), sosIds = Object.keys(SOSJ.fights);
  fuzzMatchup = function (a, b, div, rounds, n) {
    var R0 = rng(0xABCDEF ^ Math.imul(n + 1, 2654435761)), B = function (q) { return R0() < q; };
    var comp = { v401: B(0.3) ? false : { emJudge: B(0.7), deductions: B(0.8), mlLevels: B(0.5), tdCap: B(0.7), koTargets: B(0.7) },
      durability: B(0.7), dynamics: B(0.7), embed: B(0.7), preufc: B(0.7), calB: B(0.7), realism_sens: B(0.4), officials: B(0.6),
      styles_sos: B(0.2) ? false : { styles: B(0.3), sos: B(0.8) }, oppadj: false };
    var o = { division: div, rounds: rounds, title: rounds === 5, params: { components: comp } };
    if (B(0.3)) { o.date = B(0.5) ? "2019-06-15" : "2026-11-14"; if (o.date < "2020") FUZZ_STATS.dated2019++; }
    if (B(0.1)) { o.ml = false; FUZZ_STATS.noMl++; }
    if (comp.styles_sos && comp.styles_sos.sos && B(0.6)) { var f = SOSJ.fights[sosIds[Math.floor(R0() * sosIds.length)]]; o.sos = { A: f.A, B: f.B }; FUZZ_STATS.sos++; }
    if (comp.officials) {
      if (B(0.5)) o.judges = [jn[Math.floor(R0() * jn.length)], "Unknown Judge", ""];
      if (B(0.5)) o.referee = B(0.5) ? rn[Math.floor(R0() * rn.length)] : "Unknown Ref";
      FUZZ_STATS.officials++;
    }
    if (comp.durability) FUZZ_STATS.durability++;
    if (comp.embed) FUZZ_STATS.embed++;
    if (comp.preufc) FUZZ_STATS.preufc++;
    FUZZ_STATS.n++;
    return E.matchup(a, b, o);
  };
})();
var overrides = {};
try { overrides = JSON.parse(fs.readFileSync(path.join(ROOT, "data/overrides.json"), "utf8")).fighters || {}; } catch (e) { overrides = {}; }
var scouting = {};
var scDir = path.join(ROOT, "data/scouting");
if (fs.existsSync(scDir)) fs.readdirSync(scDir).forEach(function (f) {
  if (!/\.json$/.test(f)) return;
  try { scouting[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(scDir, f), "utf8")); } catch (e) { /* skip unreadable */ }
});

// moves the current show draws (show3d.js PUNCH and KICK tables plus its ground strikes)
var SHOW_MOVES = {};
(function () {
  var src = fs.readFileSync(path.join(ROOT, "src/show3d.js"), "utf8"), m;
  ["PUNCH", "KICK"].forEach(function (tbl) {
    var a = src.indexOf("var " + tbl + " = {"); if (a < 0) return;
    var b = src.indexOf("\n  };", a), body = src.slice(a, b), re = /^\s+(\w+): \{/gm;
    while ((m = re.exec(body))) SHOW_MOVES[m[1]] = 1;
  });
  ["gnp", "gnpelbow", "upelbow"].forEach(function (k) { SHOW_MOVES[k] = 1; });
})();

var KINDS = {}; D.KINDS.forEach(function (k) { KINDS[k] = 1; });
var POS = { guard: 1, half: 1, side: 1, mount: 1, back: 1, down: 1 };
var NEEDS_WHO = { strike: 1, clinch: 1, break: 1, td: 1, tdx: 1, pass: 1, esc: 1, sweep: 1, up: 1, sub: 1, subx: 1, pounce: 1, recover: 1 };
var COUNT_KEYS = D.STAT_KEYS.filter(function (k) { return k !== "ctrl"; });

function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mmss(t) { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ":" + ("0" + (t % 60)).slice(-2); }

// roster by division (fighters with at least two UFC fights, so profiles carry data)
var byDiv = {};
db.list().forEach(function (s) {
  var p = db.fighters[s]; if (!p.division || (p.n_fights || 0) < 2) return;
  (byDiv[p.division] = byDiv[p.division] || []).push(s);
});
var divs = Object.keys(byDiv).filter(function (d) { return byDiv[d].length >= 2; });
var divW = divs.map(function (d) { return byDiv[d].length; }), divTot = divW.reduce(function (a, b) { return a + b; }, 0);

function fighterOpts(slug, side) {
  var p = db.fighters[slug], extra = { corner: side === "A" ? "blue" : "red" };
  if (overrides[slug] && overrides[slug].appearance) extra.appearance = overrides[slug].appearance;
  return D.describe(p, extra, scouting[slug]);
}

var fails = [], warns = [];

// the director can only be as valid as the trace it is given: stop early, and say so, if the engine is broken
(function () {
  var m = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, title: true });
  var bad = 0, n = 0;
  for (var s = 1; s <= 5; s++) {
    var f = E.simulate(m, E.makeRng(s), true);
    f.rounds.forEach(function (rd) { rd.ev.forEach(function (e) { n++; if (!isFinite(e.t) || e.t < 0 || e.t > 300.01) bad++; }); });
  }
  if (bad) {
    console.log("ENGINE TRACE INVALID: " + bad + " of " + n + " events have non-finite or out-of-range times (" + path.relative(ROOT, ENG) + "/engine3.js).");
    console.log("This is an engine problem, not a director one. Rerun when the engine is fixed, or point ENGINE_DIR at a working copy.");
    process.exit(2);
  }
})();
function fail(id, msg) { if (fails.length < 60) fails.push(id + ": " + msg); else if (fails.length === 60) fails.push("..."); }

var agg = { fights: 0, rounds: 0, beats: 0, strikes: 0, landed: 0, missShown: 0, missEngine: 0, lines: 0, notes: 0, scoutFights: 0, methods: {}, mlApplied: 0, deducted: 0,
  maxPer10: 0, warpMin: 9, warpMax: 0, quietSecs: 0, sec: 0, texted: {}, keyMissing: {}, v2stall: 0, posJumps: 0, moveUse: {} };
var samples = { fin: null, dec: null };
var R = rng(SEED * 7919 + 13);

for (var n = 0; n < N; n++) {
  var u = R() * divTot, di = 0; while (u >= divW[di]) { u -= divW[di]; di++; }
  var div = divs[di], L = byDiv[div];
  var a = L[Math.floor(R() * L.length)], b = a; while (b === a) b = L[Math.floor(R() * L.length)];
  var rounds = n % 2 === 0 ? 3 : 5, seed = (SEED * 100003 + n * 7 + 1) >>> 0;
  var m = fuzzMatchup ? fuzzMatchup(a, b, div, rounds, n) : E.matchup(a, b, { division: div, rounds: rounds, title: rounds === 5 });
  var fight = E.simulate(m, E.makeRng(seed), true);
  if (m.mlApplied) agg.mlApplied++;
  if (fight.nDed) agg.deducted++;
  var opts = { fighters: { A: fighterOpts(a, "A"), B: fighterOpts(b, "B") }, matchup: m, rounds: rounds, title: rounds === 5,
    profiles: { A: db.fighters[a], B: db.fighters[b] }, scouting: { A: scouting[a] || null, B: scouting[b] || null } };
  if (scouting[a] || scouting[b]) agg.scoutFights++;
  var id = "#" + n + " " + a + " vs " + b + " (" + div + ", " + rounds + " rd, seed " + seed + ")";
  var sc;
  try { sc = D.build(fight, seed, opts); } catch (e) { fail(id, "build threw: " + (e.stack || e)); continue; }
  check(sc, fight, m, id, opts);
  agg.fights++; agg.methods[fight.method] = (agg.methods[fight.method] || 0) + 1;
  if (!samples.fin && !/^(UD|SD|MD|DRAW)$/.test(fight.method) && fight.round >= 2 && (scouting[a] || scouting[b])) samples.fin = { sc: sc, id: id };
  if (!samples.dec && /^(UD|SD)$/.test(fight.method) && rounds === 5 && (scouting[a] || scouting[b])) samples.dec = { sc: sc, id: id };
}

// determinism: same fight and seed give the same script text
(function () {
  var m = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, title: true });
  var f = E.simulate(m, E.makeRng(4242), true);
  var o = { fighters: { A: fighterOpts("alexander-volkanovski", "A"), B: fighterOpts("justin-gaethje", "B") }, matchup: m, rounds: 5, title: true,
    profiles: { A: db.fighters["alexander-volkanovski"], B: db.fighters["justin-gaethje"] } };
  var s1 = D.build(f, 4242, o), s2 = D.build(f, 4242, o);
  var j1 = JSON.stringify(s1.lines), j2 = JSON.stringify(s2.lines);
  if (j1 !== j2) fail("determinism", "two builds of the same fight differ");
  check(s1, f, m, "Volkanovski vs Gaethje (seed 4242)", o);
  // the v2 call shape (no opts) still works and stays generic
  var s3 = D.build(f, 4242);
  if (!s3.rounds.length || s3.names.A !== "Blue corner") fail("v2 call", "build(fight, seed) without opts should give a generic script");
  if (!samples.vg) samples.vg = { sc: s1, id: "Volkanovski vs Gaethje, 5 rounds at lightweight (seed 4242)" };
})();

function check(sc, fight, m, id, opts) {
  if (sc.rounds.length !== fight.rounds.length) fail(id, "round count " + sc.rounds.length + " vs engine " + fight.rounds.length);
  ["A", "B"].forEach(function (w) {
    var f = sc.fighters[w];
    if (!f || !f.name || !f.short) fail(id, "script.fighters." + w + " missing name/short");
    if (opts && opts.fighters && f.name !== opts.fighters[w].name) fail(id, "fighter name not taken from opts");
    if (opts && opts.fighters && opts.fighters[w].appearance && !f.appearance) fail(id, "appearance not passed through");
  });
  var seen = {}, women = /^Women/.test(m.division);
  sc.lines.forEach(function (l) {
    agg.lines++;
    if (seen[l.txt]) fail(id, "duplicate line: " + l.txt);
    seen[l.txt] = 1;
    if (/[{}]|undefined|null|NaN/.test(l.txt)) fail(id, "bad text: " + l.txt);
    if (women && /\b(he|him|his|he's)\b/i.test(l.txt.replace(sc.names.A, "").replace(sc.names.B, ""))) fail(id, "male pronoun in a women's fight: " + l.txt);
  });
  var tot = null;
  sc.rounds.forEach(function (rd, ri) {
    var er = fight.rounds[ri], endT = er.fin ? Math.max(er.fin.t, er.ev.length ? er.ev[er.ev.length - 1].t : 0) : 300, beats = rd.beats;
    agg.rounds++; agg.sec += endT;
    if (Math.abs(rd.endT - endT) > 1e-9) fail(id, "R" + (ri + 1) + " endT " + rd.endT + " vs " + endT);
    var prevT = -1, st = 0, pos = null, downed = false, v2 = "stand", landedSeen = 0, missSeen = 0, lastStrike = {};
    var engLanded = er.ev.filter(function (e) { return e.k === "hit" || e.k === "hurt" || e.k === "kd" || e.k === "fin"; }).length;
    var engMiss = er.ev.filter(function (e) { return e.k === "miss"; }).length;
    var nonNote = 0;
    beats.forEach(function (b, bi) {
      var tag = id + " R" + (ri + 1) + " beat " + bi + " (" + b.k + " t=" + b.t + ")";
      if (!KINDS[b.k]) fail(tag, "unknown kind");
      if (!(b.t >= prevT - 1e-9)) fail(tag, "time goes backwards from " + prevT);
      prevT = b.t;
      if (b.t < 0 || b.t > endT + 1e-9) fail(tag, "time outside the round");
      if (NEEDS_WHO[b.k] && b.who !== "A" && b.who !== "B") fail(tag, "missing who");
      if (!(b.st >= 0 && b.st <= 3)) fail(tag, "bad st " + b.st);
      if (b.st >= 2 && b.k !== "note" && !POS[b.pos]) fail(tag, "ground beat without a valid pos: " + b.pos);
      if (!b.stats || !b.stats.A || b.stats.A.sig_att == null) fail(tag, "missing stats");
      if (b.pri == null) fail(tag, "missing pri");
      if (b.i >= 0) { if (b.ev !== er.ev[b.i]) fail(tag, "ev does not match index"); else if (Math.abs(b.t - b.ev.t) > 1e-9) fail(tag, "beat time differs from engine time"); }
      if (b.k !== "note") nonNote++;
      if (b.txt) agg.texted[b.k] = (agg.texted[b.k] || 0) + 1;
      // ---- state machine from the beats alone
      switch (b.k) {
        case "strike":
          agg.strikes++; agg.moveUse[b.move] = (agg.moveUse[b.move] || 0) + 1;
          if (!SHOW_MOVES[b.move]) fail(tag, "move the show can't draw: " + b.move);
          if (!(b.tgt === 0 || b.tgt === 1 || b.tgt === 2)) fail(tag, "bad tgt");
          if (b.landed === b.miss) fail(tag, "landed/miss inconsistent");
          if (b.miss) { missSeen++; if (b.i < 0 || b.ev.k !== "miss") fail(tag, "invented miss"); }
          else landedSeen++;
          if (b.st !== st) fail(tag, "strike thrown in state " + b.st + " but the stream is in " + st);
          if (b.st >= 2) {
            if (b.pos !== pos && !(b.down && downed)) { agg.posJumps++; pos = b.pos; }
            if (b.down && !downed) fail(tag, "follow-up strike without a knockdown");
          }
          if (b.chain) {
            var ls = lastStrike[b.who];
            if (!ls || b.t - ls.t >= 1.6 + 1e-9 || ls.combo !== b.combo) fail(tag, "bad chain");
          }
          lastStrike[b.who] = b;
          if (b.kd) {
            if (b.to == null) fail(tag, "kd without to");
            st = b.to; downed = b.to >= 2; pos = downed ? "down" : null;
          }
          // v2 show: a standing or clinch strike waits until the show is in that state; a landed one would stall
          if (!b.miss && ((b.st === 0 && v2 !== "stand") || (b.st === 1 && v2 !== "clinch"))) { agg.v2stall++; fail(tag, "v2 show would stall: state " + v2); }
          if (b.kd && v2 !== "ground") v2 = "stand";
          break;
        case "clinch": if (st >= 2) fail(tag, "clinch from the ground"); st = 1; pos = null; v2 = "clinch"; break;
        case "break": if (st !== 1) fail(tag, "break outside a clinch"); st = 0; v2 = "stand"; break;
        case "td": if (st > 1) fail(tag, "takedown from the ground"); if (b.st < 2) fail(tag, "td must end on the ground"); st = b.st; pos = b.pos; v2 = "ground"; break;
        case "tdx": if (st > 1) fail(tag, "stuffed takedown from the ground"); if (b.st !== st) fail(tag, "tdx changed state"); break;
        case "pass": case "esc": if (st < 2) fail(tag, b.k + " off the ground"); if (b.st !== st) fail(tag, b.k + " changed top man"); if (b.from !== pos) fail(tag, b.k + " from " + b.from + " but stream at " + pos); pos = b.pos; break;
        case "sweep": if (st < 2) fail(tag, "sweep off the ground"); if (b.st === st || b.st < 2) fail(tag, "sweep must reverse"); st = b.st; pos = b.pos; break;
        case "up": if (st < 2) fail(tag, "stand-up while standing"); st = b.st; pos = null; downed = false; if (v2 === "ground" || v2 === "clinch") v2 = "stand"; break;
        case "reset": st = 0; pos = null; downed = false; if (v2 === "ground" || v2 === "clinch") v2 = "stand"; break;
        case "sub": case "subx":
          if (b.standing ? st > 1 : st < 2) fail(tag, "submission position mismatch");
          if (!b.name) fail(tag, "submission without a name");
          if (b.k === "subx" && b.st !== st) fail(tag, "subx changed state");
          if (b.k === "subx" && b.st >= 2) pos = b.pos;
          break;
        case "pounce": if (!downed || b.st !== st) fail(tag, "pounce without a knockdown"); break;
        case "recover": if (!downed) fail(tag, "recover without a knockdown"); st = b.st; pos = b.st >= 2 ? b.pos : null; downed = false; break;
        case "note": agg.notes++; break;
      }
      if (b.k !== "note" && b.k !== "strike" && b.st !== st && b.k !== "sub") fail(tag, "beat st " + b.st + " vs stream " + st);
      if ((b.k === "td" || b.kd || b.fin || b.k === "sub" || b.k === "sweep" || b.k === "pounce" || b.k === "recover") && !b.txt) agg.keyMissing[b.k + (b.kd ? ":kd" : (b.fin ? ":fin" : ""))] = (agg.keyMissing[b.k + (b.kd ? ":kd" : (b.fin ? ":fin" : ""))] || 0) + 1;
    });
    if (landedSeen !== engLanded) fail(id + " R" + (ri + 1), "landed strikes shown " + landedSeen + " vs engine " + engLanded);
    if (missSeen > engMiss) fail(id + " R" + (ri + 1), "more misses than the engine threw");
    agg.beats += beats.length; agg.landed += landedSeen; agg.missShown += missSeen; agg.missEngine += engMiss;
    // ---- stats: round stats from the director's stream equal the engine's round totals
    var est = er.st;
    ["A", "B"].forEach(function (w) {
      COUNT_KEYS.forEach(function (k) {
        var got = rd.end[w][k] - rd.base[w][k], want = est[w][k];
        if (got !== want) fail(id + " R" + (ri + 1), w + "." + k + " director " + got + " vs engine " + want);
      });
      var dc = rd.end[w].ctrl - rd.base[w].ctrl;
      if (Math.abs(dc - est[w].ctrl) > 0.25) fail(id + " R" + (ri + 1), w + ".ctrl director " + dc.toFixed(2) + " vs engine " + est[w].ctrl);
    });
    var at = D.statsAt(sc, ri, endT);
    if (JSON.stringify(at) !== JSON.stringify(rd.end)) fail(id + " R" + (ri + 1), "statsAt(endT) differs from round end stats");
    var lastB = beats.filter(function (x) { return x.i >= 0; }).pop();
    if (lastB) {
      var sAt = D.statsAt(sc, ri, lastB.t);
      COUNT_KEYS.forEach(function (k) { if (sAt.A[k] < lastB.stats.A[k] || sAt.B[k] < lastB.stats.B[k]) fail(id, "statsAt below a beat snapshot for " + k); });
    }
    // ---- density
    var dd = rd.density, nb = Math.max(1, Math.ceil(endT / 10));
    if (!dd || dd.n.length !== nb || dd.warp.length !== nb) fail(id + " R" + (ri + 1), "density bins");
    else {
      var sum = dd.n.reduce(function (x, y) { return x + y; }, 0);
      if (sum !== nonNote) fail(id + " R" + (ri + 1), "density counts " + sum + " vs beats " + nonNote);
      dd.warp.forEach(function (w) { agg.warpMin = Math.min(agg.warpMin, w); agg.warpMax = Math.max(agg.warpMax, w); });
      agg.quietSecs += dd.quietSecs;
      var wm = D.warpAt(rd, endT / 2); if (!(wm >= 0.6 && wm <= 3)) fail(id, "warpAt out of range");
    }
    // ---- readability: visible strikes per fighter in any 10 s window
    ["A", "B"].forEach(function (w) {
      var ts = beats.filter(function (x) { return x.k === "strike" && x.who === w; }).map(function (x) { return x.t; }), j0 = 0;
      for (var j = 0; j < ts.length; j++) { while (ts[j] - ts[j0] > 10) j0++; agg.maxPer10 = Math.max(agg.maxPer10, j - j0 + 1); }
    });
    tot = rd.end;
  });
  if (fight.totals && tot) ["A", "B"].forEach(function (w) {
    COUNT_KEYS.forEach(function (k) { if (tot[w][k] !== fight.totals[w][k]) fail(id, "fight total " + w + "." + k + " " + tot[w][k] + " vs engine " + fight.totals[w][k]); });
  });
  if (!sc.result) fail(id, "no result line");
  if (/^(UD|SD|MD|DRAW)$/.test(fight.method) && (!sc.decision || !sc.decision.text)) fail(id, "decision without scorecards text");
  if (/^(UD|SD|MD|DRAW)$/.test(fight.method)) {
    // per-round judges' scores (after point deductions) add up to the fight's cards
    for (var jj = 0; jj < 3; jj++) {
      var ca = 0, cb = 0;
      fight.rounds.forEach(function (rd) { if (rd.judges) { ca += rd.judges[jj][0]; cb += rd.judges[jj][1]; } });
      if (ca !== fight.cards[jj][0] || cb !== fight.cards[jj][1]) fail(id, "judge " + jj + " round scores " + ca + "-" + cb + " vs card " + fight.cards[jj].join("-"));
    }
  }
}

function printFight(s, title) {
  console.log("\n==== " + title);
  console.log(s.sc.result);
  s.sc.lines.forEach(function (l) {
    var clock = l.t == null ? "     " : mmss(300 - l.t);
    console.log("  R" + (l.r + 1) + " " + (l.t == null ? "pre " : clock) + "  " + l.txt);
  });
}

console.log("director v3: " + agg.fights + " fights, " + agg.rounds + " rounds (" + agg.scoutFights + " with a scouting file); engine " + E.VERSION +
  ", learned stat-line rates " + (USE_ML ? "on (" + agg.mlApplied + " of " + agg.fights + " matchups applied)" : "off") + ", fights with a point deduction " + agg.deducted);
if (USE_ML && !FUZZ && agg.mlApplied < agg.fights) fail("learned rates", "model loaded but only " + agg.mlApplied + " of " + agg.fights + " matchups used it");
if (FUZZ) {
  console.log("  FUZZ: " + JSON.stringify(FUZZ_STATS));
  if (FUZZ_STATS.officials === 0 || FUZZ_STATS.sos === 0 || FUZZ_STATS.durability === 0) fail("fuzz", "a component path was never exercised: " + JSON.stringify(FUZZ_STATS));
}
console.log("  methods " + JSON.stringify(agg.methods));
console.log("  beats/round " + (agg.beats / agg.rounds).toFixed(1) + ", strikes/round " + (agg.strikes / agg.rounds).toFixed(1) +
  ", misses shown " + agg.missShown + " of " + agg.missEngine + " (" + (100 * agg.missShown / Math.max(1, agg.missEngine)).toFixed(0) + "%), landed " + agg.landed +
  "; max strikes by one fighter in 10 s " + agg.maxPer10);
console.log("  play-by-play lines/round " + (agg.lines / agg.rounds).toFixed(1) + ", notes " + agg.notes + "; texted beats by kind " + JSON.stringify(agg.texted));
console.log("  key beats without text " + JSON.stringify(agg.keyMissing) + "; silent position changes on strikes " + agg.posJumps);
console.log("  warp range " + agg.warpMin + "-" + agg.warpMax + ", quiet stretches " + (100 * agg.quietSecs / agg.sec).toFixed(0) + "% of fight time");
console.log("  moves used " + JSON.stringify(agg.moveUse));
// two sample fights: the page's default matchup, and a roster fight that ended the other way (decision vs finish)
if (samples.vg) printFight(samples.vg, "sample 1: " + samples.vg.id);
var vgDec = samples.vg && /^(UD|SD|MD|DRAW)$/.test(samples.vg.sc.method), second = vgDec ? (samples.fin || samples.dec) : (samples.dec || samples.fin);
if (second) printFight(second, "sample 2: " + second.id);
if (fails.length) { console.log("\nFAIL (" + fails.length + ")\n  " + fails.join("\n  ")); process.exit(1); }
console.log("\nOK: every beat valid for the show, states and stats match the engine, no repeated lines.");
