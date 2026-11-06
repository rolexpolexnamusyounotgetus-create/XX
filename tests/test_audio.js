/* Headless check of src/audio.js against a counting AudioContext stub.
 *   node tests/test_audio.js
 * Loads the module twice: once with the stub (hooks wrap, sounds schedule by kind, the page's handlers still run,
 * detach restores them) and once with no WebAudio at all (every call is a harmless no-op).
 */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
var SRC = fs.readFileSync(path.join(__dirname, "..", "src", "audio.js"), "utf8");

function makeStub(counts, clock) {
  function Param(v) { this.value = v; }
  Param.prototype.setTargetAtTime = function (v) { counts.automation++; this.value = v; };
  Param.prototype.setValueAtTime = function (v) { counts.automation++; this.value = v; };
  Param.prototype.linearRampToValueAtTime = function (v) { counts.automation++; this.value = v; };
  Param.prototype.cancelScheduledValues = function () {};
  function Node() { this.connections = 0; }
  Node.prototype.connect = function (n) { this.connections++; counts.connect++; return n; };
  Node.prototype.disconnect = function () {};
  function Ctx() { counts.contexts++; this.state = "running"; this.destination = new Node(); this.sampleRate = 48000; }
  Object.defineProperty(Ctx.prototype, "currentTime", { get: function () { return clock(); } });
  Ctx.prototype.createGain = function () { counts.gain++; var n = new Node(); n.gain = new Param(1); return n; };
  Ctx.prototype.createStereoPanner = function () { counts.panner++; var n = new Node(); n.pan = new Param(0); return n; };
  Ctx.prototype.createBiquadFilter = function () { counts.filter++; var n = new Node(); n.frequency = new Param(350); n.Q = new Param(1); n.type = "lowpass"; return n; };
  Ctx.prototype.createDynamicsCompressor = function () { var n = new Node(); ["threshold", "knee", "ratio", "attack", "release"].forEach(function (k) { n[k] = new Param(0); }); return n; };
  Ctx.prototype.createBufferSource = function () {
    counts.sources++;
    var n = new Node(), ctx = this;
    n.playbackRate = new Param(1);
    n.start = function (when, offset) {
      counts.starts++;
      if (when < ctx.currentTime - 1e-9) counts.late++;
      (counts.byBuffer[n.buffer && n.buffer.tag] = (counts.byBuffer[n.buffer && n.buffer.tag] || 0) + 1);
      if (n.loop) counts.loops++;
    };
    return n;
  };
  Ctx.prototype.decodeAudioData = function (ab, ok) {
    counts.decodes++;
    var tag = Buffer.from(new Uint8Array(ab)).toString("utf8");
    var b = { tag: tag, duration: /bed/.test(tag) ? 20.0 : 0.5, length: 24000, sampleRate: 48000, numberOfChannels: 1 };
    if (ok) setTimeout(function () { ok(b); }, 0);
    return Promise.resolve(b);
  };
  Ctx.prototype.resume = function () { this.state = "running"; return Promise.resolve(); };
  Ctx.prototype.suspend = function () { this.state = "suspended"; return Promise.resolve(); };
  return Ctx;
}

function sandbox(withAudio) {
  var counts = { contexts: 0, gain: 0, panner: 0, filter: 0, sources: 0, starts: 0, late: 0, loops: 0, decodes: 0, connect: 0, automation: 0, byBuffer: {} };
  var assets = {};
  // every audio asset is a tiny fake "mp3" whose bytes are its own name, so the stub knows which buffer plays
  ["crowd-bed", "crowd-roar", "crowd-pop", "crowd-ooh", "crowd-chant", "crowd-boo", "bell-x3", "bell-ring", "clapper", "ref-fight", "ref-go", "ref-stop",
    "punch-head-1", "punch-head-2", "punch-head-3", "punch-head-heavy", "punch-body-1", "punch-body-2", "punch-body-3", "kick-body-1", "kick-body-2",
    "kick-leg-1", "kick-leg-2", "blocked", "whoosh-punch-1", "whoosh-punch-2", "whoosh-punch-3", "whoosh-kick", "takedown-1", "takedown-2",
    "cage-rattle", "cage-slam", "walkout-boom"].forEach(function (n) {
    assets["audio-" + n + ".mp3"] = "data:audio/mpeg;base64," + Buffer.from(n).toString("base64");
  });
  var store = {};
  var win = {
    FightAssets: assets,
    atob: function (s) { return Buffer.from(s, "base64").toString("binary"); },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: function () { return 0; },
    requestAnimationFrame: function () { return 1; },
    performance: { now: function () { return win._now; } }, _now: 1000,
    localStorage: { getItem: function (k) { return store[k] == null ? null : store[k]; }, setItem: function (k, v) { store[k] = String(v); } },
    navigator: { userActivation: { hasBeenActive: true } },
    console: console, Promise: Promise, Uint8Array: Uint8Array, Math: Math, Date: Date
  };
  if (withAudio) win.AudioContext = makeStub(counts, function () { return (win._now - 1000) / 1000; });
  win.window = win; win.globalThis = win;
  vm.runInNewContext(SRC, win, { filename: "audio.js" });
  return { win: win, counts: counts };
}

// a minimal show: hooks object, phase, fighters, a camera with a world matrix (identity at the origin looking -Z)
function fakeShow(appCalls) {
  var hooks = {
    onBeat: function (b) { appCalls.push("beat:" + b.k); },
    onImpact: function (b) { appCalls.push("impact:" + (b.move || b.k)); },
    onPhase: function (p, r) { appCalls.push("phase:" + p + ":" + r); },
    onRoundEnd: function (r) { appCalls.push("roundEnd:" + r); },
    onDecision: function () { appCalls.push("decision"); },
    onClock: function () {}
  };
  var cam = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 8, 1] } };
  return {
    hooks: hooks, phase: "intro", state: "stand", rIdx: 0, time: 0, speed: 5, paused: false,
    A: { pos: { x: -0.9, y: 0, z: 0 } }, B: { pos: { x: 0.9, y: 0, z: 0 } },
    arena: { camera: cam, U: { uExcite: { value: 0.3 } } }
  };
}

(async function main() {
  /* ---- 1. with the stub ---- */
  var sb = sandbox(true), FA = sb.win.FightAudio, C = sb.counts;
  assert.ok(FA && FA.supported, "FightAudio is defined and supported");
  var calls = [], show = fakeShow(calls), orig = show.hooks.onBeat;
  assert.ok(FA.attach(show), "attach");
  assert.notStrictEqual(show.hooks.onBeat, orig, "onBeat is wrapped");
  FA.attach(show);   // idempotent
  assert.strictEqual(show.hooks.onBeat._prev, orig, "wrapping twice does not double-wrap");
  // disabled: hooks pass through, nothing is created
  show.hooks.onBeat({ k: "clinch", who: "A" });
  assert.deepStrictEqual(calls, ["beat:clinch"], "the page handler still runs");
  assert.strictEqual(C.contexts, 0, "no AudioContext before sound is enabled");

  FA._rng(function () { return 0.3; });
  FA.setEnabled(true);
  await FA.ready();
  await new Promise(function (r) { setTimeout(r, 5); });
  var st = FA.state();
  assert.strictEqual(C.contexts, 1, "one AudioContext");
  assert.strictEqual(st.buffers, Object.keys(FA.SOUNDS).length, "every sound decoded (" + st.buffers + ")");
  assert.strictEqual(C.loops, 2, "the crowd bed runs as two offset loops");
  var ctxStarts = C.starts;

  function tickShow(n, sh) { sh = sh || show; for (var i = 0; i < n; i++) { sh.time += 1 / 60; sb.win._now += 1000 / 60; FA._tick(1 / 60); } }
  tickShow(5);
  // what played since a mark (marks count plays; the module keeps the last 80 in its log)
  var mark = function () { return FA.state().plays; };
  function since(from) { var st = FA.state(), n = st.plays - (from || 0); return n > 0 ? st.log.slice(-n) : []; }
  function log() { return since(0).map(function (e) { return e.name; }); }
  function played(name, from) { return since(from).some(function (e) { return e.name === name; }); }

  var m = mark(); show.hooks.onPhase("intro", 0);
  assert.ok(played("boom", m) && played("chant", m), "walkout: boom and chant");
  m = mark(); show.phase = "live"; show.hooks.onPhase("live", 0);
  assert.ok(played("bell3", m), "round start: bell");
  assert.ok(played("refFight", m) || played("refGo", m), "round start: referee call");
  var refEntry = FA.state().log.filter(function (e) { return /^ref/.test(e.name); }).pop();
  assert.ok(refEntry.t > 0.5, "the referee call is scheduled after the bell");

  m = mark(); show.hooks.onImpact({ k: "strike", who: "A", move: "cross", tgt: 0, landed: true, power: 0.6 });
  assert.ok(played("head1", m) || played("head2", m), "landed cross: glove on head");
  m = mark(); show.hooks.onImpact({ k: "strike", who: "B", move: "bodyhook", tgt: 1, landed: true, power: 0.5 });
  assert.ok(/body[123]/.test(since(m).map(function (e) { return e.name; }).join(" ")), "landed body hook: glove on body");
  m = mark(); show.hooks.onImpact({ k: "strike", who: "A", move: "calf", tgt: 2, landed: true, power: 0.7 });
  assert.ok(/kickLeg/.test(since(m).map(function (e) { return e.name; }).join(" ")), "calf kick: kick on leg");
  m = mark(); show.hooks.onImpact({ k: "strike", who: "B", move: "bodykick", tgt: 1, landed: true, power: 0.7 });
  assert.ok(/kickBody/.test(since(m).map(function (e) { return e.name; }).join(" ")), "body kick: kick on body");
  m = mark(); show.hooks.onImpact({ k: "strike", who: "A", move: "jab", tgt: 0, landed: false });
  assert.ok(/whoosh|blocked/.test(since(m).map(function (e) { return e.name; }).join(" ")), "missed jab: whoosh or block");
  m = mark(); show.hooks.onImpact({ k: "strike", who: "B", move: "headkick", tgt: 0, landed: false });
  assert.ok(played("whooshKick", m) || played("blocked", m), "missed head kick: kick whoosh");

  // panning from the camera: the camera sits at z = 8 looking down -Z with +X to its right
  var hitOnB = FA.state().log.filter(function (e) { return e.name === "head1" || e.name === "head2"; }).pop();
  assert.ok(hitOnB.pan > 0.05, "a strike landing on B (on the camera's right) pans right: " + hitOnB.pan);

  // a flurry raises the roar
  m = mark();
  for (var i = 0; i < 5; i++) { show.hooks.onImpact({ k: "strike", who: "A", move: i % 2 ? "hook" : "cross", tgt: 0, landed: true, power: 0.5 }); tickShow(12); }
  assert.ok(played("roar", m), "flurry: rising roar");

  m = mark(); show.hooks.onImpact({ k: "strike", who: "A", move: "hook", tgt: 0, landed: true, kd: true, power: 0.9 });
  assert.ok(played("pop", m) && played("headHeavy", m), "knockdown: heavy impact and crowd pop");

  // technique sets the weight: an overhand lands louder than a jab
  tickShow(480);
  m = mark(); show.hooks.onImpact({ k: "strike", who: "A", move: "jab", tgt: 0, landed: true }); var gJab = since(m)[0].gain;
  m = mark(); show.hooks.onImpact({ k: "strike", who: "A", move: "overhand", tgt: 0, landed: true }); var gOver = since(m)[0].gain;
  assert.ok(gOver > gJab * 1.2, "overhand louder than jab (" + gOver + " vs " + gJab + ")");

  m = mark(); show.hooks.onBeat({ k: "td", who: "B" });
  var td = since(m).filter(function (e) { return /^td/.test(e.name); })[0];
  assert.ok(td && td.t >= 0.5, "takedown: thud scheduled for when he lands (" + (td && td.t) + ")");
  show.A.pos.x = -3.4; m = mark(); sb.win.AudioContext && show.hooks.onBeat({ k: "clinch", who: "A" });
  assert.ok(played("rattle", m), "clinch on the fence: rattle");
  show.A.pos.x = -0.9;

  m = mark(); show.hooks.onClock(0, 289.5, "stand"); show.hooks.onClock(0, 290.4, "stand"); show.hooks.onClock(0, 291, "stand");
  assert.strictEqual(since(m).map(function (e) { return e.name; }).filter(function (n) { return n === "clapper"; }).length, 2, "ten-second clapper once (two claps)");
  m = mark(); show.hooks.onRoundEnd(0, {});
  assert.ok(played("bell3", m), "round end: bell");
  assert.ok(calls.indexOf("roundEnd:0") >= 0, "the page's onRoundEnd still ran");

  m = mark(); show.hooks.onReplay(true);
  assert.ok(played("whooshKick", m), "replay: transition swoosh");
  show.hooks.onReplay(false);

  m = mark(); show.hooks.onFinish({ winner: "A", method: "KO" });
  assert.ok(played("refStop", m) && played("bellRing", m), "finish: referee stop and the bell");
  m = mark(); show.hooks.onDecision({ winner: "B", method: "SD" });
  assert.ok(played("boo", m), "split decision: boos");
  assert.ok(calls.indexOf("decision") >= 0, "the page's onDecision still ran");

  assert.strictEqual(C.late, 0, "nothing is scheduled in the past");
  assert.ok(C.starts - ctxStarts >= 25, "sounds scheduled: " + (C.starts - ctxStarts));
  assert.ok(C.panner >= 10, "strikes go through stereo panners");

  // the crowd bed follows the action: a hot moment raises its level above a quiet one
  FA._tick(0.5); var lvlHot = FA.state().level;
  for (i = 0; i < 400; i++) tickShow(1);
  var lvlQuiet = FA.state().level;
  assert.ok(lvlHot > lvlQuiet, "crowd level decays after the big moment (" + lvlHot + " > " + lvlQuiet + ")");

  // frames stop (pause / off screen): sound fades and new sounds are dropped
  show.paused = true; FA._tick(0.1);
  assert.ok(FA.state().frozen, "paused show freezes the audio");
  var before = C.starts; show.hooks.onImpact({ k: "strike", who: "A", move: "cross", tgt: 0, landed: true, power: 0.5 });
  assert.strictEqual(C.starts, before, "no new sounds while paused");
  show.paused = false; tickShow(3);
  assert.ok(!FA.state().frozen, "resumes with the show");

  // volume and off switch
  assert.strictEqual(FA.setVolume(0.5), 0.5);
  FA.setEnabled(false);
  before = C.starts; show.hooks.onImpact({ k: "strike", who: "A", move: "cross", tgt: 0, landed: true, power: 0.5 });
  assert.strictEqual(C.starts, before, "disabled: silent");
  FA.detach();
  assert.strictEqual(show.hooks.onBeat, orig, "detach restores the page's hooks");
  assert.ok(!show.hooks.onFinish, "hooks the page never had are removed again");

  // the text-only show (no arena): strikes come through onBeat
  var calls2 = [], ts = fakeShow(calls2); delete ts.arena;
  FA.attach(ts); FA.setEnabled(true); tickShow(2, ts);
  m = mark(); ts.hooks.onBeat({ k: "strike", who: "A", move: "cross", tgt: 0, landed: true, power: 0.5 });
  assert.ok(played("head1", m) || played("head2", m), "text show: strikes sound from onBeat");
  m = mark(); ts.hooks.onImpact({ k: "strike", who: "A", move: "cross", tgt: 0, landed: true, kd: true, power: 0.9 });
  assert.ok(played("pop", m) && !played("head1", m) && !played("head2", m), "text show: onImpact adds only the crowd " + JSON.stringify(since(m).map(function (e) { return e.name; })));
  console.log("with WebAudio stub: ok -", C.contexts, "context,", C.decodes, "decodes,", C.starts, "starts,", C.panner, "panners,", C.automation, "automation calls");
  console.log("  sample:", FA.state().log.slice(-8).map(function (e) { return e.name + "@" + e.t + (e.pan != null ? " pan " + e.pan : ""); }).join(", "));

  /* ---- 2. no WebAudio ---- */
  var sb2 = sandbox(false), FB = sb2.win.FightAudio, calls3 = [], s3 = fakeShow(calls3), o3 = s3.hooks.onBeat;
  assert.ok(FB && FB.supported === false, "defined, unsupported");
  assert.strictEqual(FB.attach(s3), false, "attach is a no-op");
  assert.strictEqual(s3.hooks.onBeat, o3, "hooks untouched");
  assert.strictEqual(FB.setEnabled(true), false, "cannot enable");
  FB.setVolume(0.3); FB.detach(); FB._tick(0.1);
  assert.strictEqual(FB.state().context, null, "no context");
  console.log("without WebAudio: ok - silent no-op");
  console.log("PASS test_audio");
})().catch(function (e) { console.error("FAIL", e && e.stack || e); process.exit(1); });
