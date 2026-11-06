/* FightAudio: arena sound for the 3D show, on WebAudio, from the embedded audio pack (assets/embed/audio-*.mp3).
 *
 *   FightAudio.attach(show)      wrap the show's hooks (onBeat, onImpact, onPhase, onRoundEnd, onFinish, onDecision,
 *                                onClock, onReplay); the page's own handlers still run first, unchanged. Idempotent.
 *                                Also attaches itself to window.VGSim.show when that appears or changes.
 *   FightAudio.detach()          put the original hooks back
 *   FightAudio.setEnabled(bool)  sound on or off (off by default; remembered per viewer). The AudioContext is created
 *                                on the first user gesture after enabling, as browsers require.
 *   FightAudio.setVolume(x)      master volume 0..1
 *   FightAudio.unlock()          call from a click: resumes the audio context if sound is on (also done automatically)
 *   FightAudio.state()           { supported, enabled, context, loaded, attached, voices, plays, log }
 *
 * The mix: a stereo crowd bed (one mono loop played twice, half a loop apart, panned wide) whose level and brightness
 * follow the action and the arena's own crowd mood; a rising roar on flurries, a pop on knockdowns and finishes, oohs
 * on near things, boos for long stalls and split decisions; bells at the start and end of rounds and on stoppages;
 * the ten-second clapper; strike impacts by technique and target (glove to head, glove to body, kick to leg, kick
 * to body, knees), whooshes and blocks on misses, takedown thuds, the fence rattling when they clinch on it, and
 * generic referee calls. Strikes are panned and attenuated from the broadcast camera.
 *
 * Without WebAudio (or without the audio assets) every call is a silent no-op.
 *
 * Sound credits (full table with sources in assets/LICENSES.md; all clips cut, mixed and re-encoded for this page):
 *   Crowd bed, chant swell and rising roar: "Crowd Cheering Sounds" by Gregor Quendel (gregorquendel.com), CC BY 4.0,
 *     https://opengameart.org/content/free-crowd-cheering-sounds
 *   Bells, and parts of the knockdown pop and the boos: BBC Sound Effects, (c) BBC, used under the BBC RemArc licence
 *     (personal, educational or research use only), https://sound-effects.bbcrewind.co.uk
 *   Referee "stop": Piper TTS voice en_US ryan (rhasspy), trained on the RyanSpeech corpus, CC BY-NC-SA 4.0
 *   Referee "fight" and "go": Kenney voiceover packs, CC0. Clapper: rubberduck, CC0. Extra hit layers: Iwan Gabovitch
 *     (qubodup) and independent.nu, CC0.
 *   Impacts, whooshes, blocks, takedowns, fence and walkout boom: Sonniss #GameAudioGDC bundles 2015-2026 (Gamemaster
 *     Audio, The Chris Alan, PMSFX, Shapeforms, 344 Audio, Red Libraries, Borg Sound, Robert Cordova, Mechanical Wave,
 *     Airborne Sound, SoundBits, Soundholder, Sonic Bat, 2496SoundEffects), royalty-free, no attribution required.
 */
(function (root) {
  "use strict";
  var AC = root.AudioContext || root.webkitAudioContext || null;
  var doc = root.document || null;

  // name -> [asset key, base gain]; arrays of names are picked at random
  var SND = {
    bed: ["audio-crowd-bed.mp3", 1.0], roar: ["audio-crowd-roar.mp3", 0.9], pop: ["audio-crowd-pop.mp3", 1.0],
    ooh: ["audio-crowd-ooh.mp3", 0.85], chant: ["audio-crowd-chant.mp3", 0.75], boo: ["audio-crowd-boo.mp3", 0.6],
    bell3: ["audio-bell-x3.mp3", 0.8], bellRing: ["audio-bell-ring.mp3", 0.8], clapper: ["audio-clapper.mp3", 0.7],
    refFight: ["audio-ref-fight.mp3", 0.75], refGo: ["audio-ref-go.mp3", 0.7], refStop: ["audio-ref-stop.mp3", 0.8],
    head1: ["audio-punch-head-1.mp3", 0.8], head2: ["audio-punch-head-2.mp3", 0.85], head3: ["audio-punch-head-3.mp3", 0.7],
    headHeavy: ["audio-punch-head-heavy.mp3", 1.0], body1: ["audio-punch-body-1.mp3", 0.8], body2: ["audio-punch-body-2.mp3", 0.8],
    body3: ["audio-punch-body-3.mp3", 0.8], kickBody1: ["audio-kick-body-1.mp3", 0.9], kickBody2: ["audio-kick-body-2.mp3", 0.9],
    kickLeg1: ["audio-kick-leg-1.mp3", 0.85], kickLeg2: ["audio-kick-leg-2.mp3", 0.9], blocked: ["audio-blocked.mp3", 0.6],
    whoosh1: ["audio-whoosh-punch-1.mp3", 0.45], whoosh2: ["audio-whoosh-punch-2.mp3", 0.45], whoosh3: ["audio-whoosh-punch-3.mp3", 0.4],
    whooshKick: ["audio-whoosh-kick.mp3", 0.5], td1: ["audio-takedown-1.mp3", 0.9], td2: ["audio-takedown-2.mp3", 1.0],
    rattle: ["audio-cage-rattle.mp3", 0.55], slam: ["audio-cage-slam.mp3", 0.75], boom: ["audio-walkout-boom.mp3", 0.7]
  };
  var HEAD = ["head1", "head2"], HEAD_LIGHT = ["head3", "head1"], BODY = ["body1", "body2", "body3"], KBODY = ["kickBody1", "kickBody2"], KLEG = ["kickLeg1", "kickLeg2"], WHOOSH = ["whoosh1", "whoosh2", "whoosh3"];
  var KICKS = { calf: 1, inside: 1, bodykick: 1, headkick: 1, knee: 1, kneehead: 1, spinback: 1, wheel: 1, flyknee: 1 };
  var LIGHT = { jab: 1, short: 1, shortbody: 1, gnp: 1, upelbow: 1 };
  // how hard each technique lands when the beat carries no power of its own (the show's beats do not)
  var MOVE_POWER = { jab: 0.35, short: 0.4, shortbody: 0.45, gnp: 0.45, upelbow: 0.4, cross: 0.6, hook: 0.65, overhand: 0.75, upper: 0.62,
    bodyhook: 0.62, bodystraight: 0.55, elbow: 0.62, spinfist: 0.62, calf: 0.62, inside: 0.5, bodykick: 0.75, headkick: 0.9, knee: 0.7,
    kneehead: 0.8, spinback: 0.8, wheel: 0.9, flyknee: 0.85 };
  var BED_LOOP = 20.0, BED_SKIP = 1105 / 44100;   // the bed is exactly 20 s; LAME priming if a decoder keeps it
  var MAX_VOICES = 28;

  var S = {
    enabled: false, wanted: false, volume: 0.8, ctx: null, buf: {}, loaded: false, loading: null, show: null, hooks: null,
    master: null, comp: null, replayLP: null, crowd: null, sfx: null, voice: null, bedGain: null, bedLP: null, bedOn: false,
    voices: 0, ends: [], plays: 0, log: [], excite: 0, level: 0.4, roarT: -99, booT: -99, hits: [], lastShowT: null, lastShowAt: 0,
    frozen: false, clapR: -1, lastClock: 0, lastStrikeClock: 0, groundSince: null, clinchRattleT: -99, raf: 0, ui: null, rng: Math.random
  };

  function now() { return S.ctx ? S.ctx.currentTime : 0; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function pick(list) { return list[Math.floor(S.rng() * list.length) % list.length]; }
  function store(k, v) { try { if (v === undefined) return root.localStorage.getItem(k); root.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } return null; }

  /* ------------------------------------------------------------ assets */
  function assetUrl(name) { var A = root.FightAssets; return A && A[name] ? A[name] : null; }
  function bytesOf(name) {
    var u = assetUrl(name);
    if (!u) return Promise.reject(new Error("no asset " + name));
    if (u.slice(0, 5) === "data:") {
      var bin = root.atob(u.slice(u.indexOf(",") + 1)), n = bin.length, out = new Uint8Array(n);
      for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
      return Promise.resolve(out.buffer);
    }
    if (!root.fetch) return Promise.reject(new Error("no fetch for " + name));
    return root.fetch(u).then(function (r) { if (!r.ok) throw new Error(name + " " + r.status); return r.arrayBuffer(); });
  }
  function decode(ab) {
    return new Promise(function (res, rej) {
      try {
        var p = S.ctx.decodeAudioData(ab, res, rej);   // callback form for older Safari; newer ones also return a promise
        if (p && p.then) p.then(res, rej);
      } catch (e) { rej(e); }
    });
  }
  function loadAll() {
    if (S.loading) return S.loading;
    var names = Object.keys(SND);
    S.loading = Promise.all(names.map(function (n) {
      return bytesOf(SND[n][0]).then(decode).then(function (b) { S.buf[n] = b; }, function () { /* that one stays silent */ });
    })).then(function () {
      S.loaded = true;
      if (S.enabled) startBed();
    });
    return S.loading;
  }

  /* ------------------------------------------------------------ graph */
  function makeContext() {
    if (S.ctx || !AC) return S.ctx;
    try { S.ctx = new AC({ latencyHint: "interactive" }); } catch (e) { try { S.ctx = new AC(); } catch (e2) { S.ctx = null; return null; } }
    var c = S.ctx;
    S.master = c.createGain(); S.master.gain.value = 0;
    S.comp = c.createDynamicsCompressor ? c.createDynamicsCompressor() : null;
    if (S.comp) { S.comp.threshold.value = -10; S.comp.knee.value = 8; S.comp.ratio.value = 4; S.comp.attack.value = 0.004; S.comp.release.value = 0.2; }
    S.replayLP = c.createBiquadFilter(); S.replayLP.type = "lowpass"; S.replayLP.frequency.value = 20000; S.replayLP.Q.value = 0.5;
    S.crowd = c.createGain(); S.crowd.gain.value = 0.62;
    S.sfx = c.createGain(); S.sfx.gain.value = 0.95;
    S.voice = c.createGain(); S.voice.gain.value = 0.85;
    S.crowd.connect(S.replayLP); S.sfx.connect(S.replayLP); S.voice.connect(S.replayLP);
    S.replayLP.connect(S.master);
    if (S.comp) { S.master.connect(S.comp); S.comp.connect(c.destination); } else S.master.connect(c.destination);
    S.bedGain = c.createGain(); S.bedGain.gain.value = 0;
    S.bedLP = c.createBiquadFilter(); S.bedLP.type = "lowpass"; S.bedLP.frequency.value = 4000; S.bedLP.Q.value = 0.3;
    S.bedGain.connect(S.bedLP); S.bedLP.connect(S.crowd);
    return c;
  }
  function panner(pan) {
    var c = S.ctx;
    if (pan == null || !c.createStereoPanner) return null;
    var p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    return p;
  }

  // play a named sound: o = { gain, rate, pan, when (seconds from now), bus: "sfx" | "crowd" | "voice", prio }
  function play(name, o) {
    o = o || {};
    if (!S.enabled || !S.ctx || S.ctx.state !== "running" || S.frozen) return null;
    var b = S.buf[name];
    if (!b) return null;
    var tn = now();
    if (S.ends.length && S.ends[0] <= tn) S.ends = S.ends.filter(function (e) { return e > tn; });
    S.voices = S.ends.length;
    if (S.voices >= MAX_VOICES && !o.prio) return null;
    var c = S.ctx, src = c.createBufferSource(), g = c.createGain(), p = panner(o.pan);
    src.buffer = b;
    if (o.rate) src.playbackRate.value = o.rate;
    g.gain.value = (o.gain == null ? 1 : o.gain) * SND[name][1];
    src.connect(g);
    var out = o.bus === "crowd" ? S.crowd : (o.bus === "voice" ? S.voice : S.sfx);
    if (p) { g.connect(p); p.connect(out); } else g.connect(out);
    var t = tn + Math.max(0, o.when || 0);
    src.onended = function () { try { src.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch (e) { /* gone */ } };
    try { src.start(t); } catch (e) { return null; }
    // voices are counted by when they end, so a missed onended can never leak one
    S.ends.push(t + b.duration / (o.rate || 1)); S.ends.sort(function (x, y) { return x - y; });
    S.voices = S.ends.length; S.plays++;
    S.log.push({ name: name, t: +t.toFixed(3), gain: +g.gain.value.toFixed(3), pan: p ? +p.pan.value.toFixed(2) : null });
    if (S.log.length > 80) S.log.shift();
    return src;
  }

  function startBed() {
    if (S.bedOn || !S.ctx || !S.buf.bed) return;
    var b = S.buf.bed, c = S.ctx, skip = b.duration > BED_LOOP + 0.01 ? BED_SKIP : 0;
    [[-0.75, 0], [0.75, BED_LOOP / 2]].forEach(function (side) {
      var src = c.createBufferSource(), p = panner(side[0]);
      src.buffer = b; src.loop = true;
      if (skip) { src.loopStart = skip; src.loopEnd = skip + BED_LOOP; }
      if (p) { src.connect(p); p.connect(S.bedGain); } else src.connect(S.bedGain);
      try { src.start(now() + 0.02, skip + side[1]); } catch (e) { /* ignore */ }
    });
    S.bedOn = true;
  }

  /* ------------------------------------------------------------ where things happen, from the camera */
  function spatial(pos) {
    var sh = S.show, cam = sh && (sh.arena && sh.arena.camera || (sh.cam && sh.cam.cam));
    if (!cam || !pos || !cam.matrixWorld) return { pan: 0, gain: 1 };
    var m = cam.matrixWorld.elements, dx = pos.x - m[12], dy = (pos.y || 1.2) - m[13], dz = pos.z - m[14];
    var x = dx * m[0] + dy * m[1] + dz * m[2], f = -(dx * m[8] + dy * m[9] + dz * m[10]);
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return { pan: clamp(x / (Math.abs(f) * 0.9 + 0.6), -1, 1) * 0.7, gain: clamp(4.2 / Math.max(0.5, dist), 0.4, 1.15) };
  }
  function fighter(id) { var sh = S.show; return sh && sh[id] && sh[id].pos ? sh[id].pos : null; }
  function other(id) { return id === "A" ? "B" : "A"; }
  function nearFence() {
    var a = fighter("A"), b = fighter("B");
    if (!a || !b) return false;
    return Math.max(Math.hypot(a.x, a.z), Math.hypot(b.x, b.z)) > 3.05;
  }
  function is3D() { return !!(S.show && S.show.arena); }

  /* ------------------------------------------------------------ the fight's sounds */
  function strikeSound(b) {
    var mv = b.move || "jab", sp = spatial(fighter(other(b.who)) || fighter(b.who));
    var power = clamp(b.power != null ? b.power : (MOVE_POWER[mv] != null ? MOVE_POWER[mv] : 0.5) + (b.hurt ? 0.15 : 0), 0, 1);
    var kick = !!KICKS[mv], tgt = b.tgt != null ? b.tgt : (/body|shortbody/.test(mv) ? 1 : (mv === "calf" || mv === "inside" ? 2 : 0));
    var fast = S.show && S.show.speed >= 10;
    if (!b.landed) {
      if (fast && S.rng() < 0.6) return;                                       // at 10x and 30x most misses go quiet
      var blocked = (!kick && tgt === 1) || ((mv === "calf" || mv === "inside") && S.rng() < 0.5) || S.rng() < 0.12;
      if (blocked) play("blocked", { gain: sp.gain * 0.8, pan: sp.pan, rate: 0.95 + S.rng() * 0.1 });
      else play(kick ? "whooshKick" : pick(WHOOSH), { gain: sp.gain * (kick ? 0.9 : 0.75), pan: sp.pan, rate: 0.92 + S.rng() * 0.16 });
      return;
    }
    var big = b.kd || b.fin, g = sp.gain * (0.65 + 0.5 * power) * (big ? 1.25 : 1), rate = (1.06 - 0.12 * power) * (0.96 + S.rng() * 0.08);
    var o = { gain: g, pan: sp.pan, rate: rate, prio: big };
    if (big) play("headHeavy", o);
    if (mv === "headkick") { play("kickBody1", o); if (!big) play("head2", { gain: g * 0.6, pan: sp.pan, rate: rate }); }
    else if (mv === "kneehead") { play("kickBody2", o); if (!big) play("head1", { gain: g * 0.5, pan: sp.pan, rate: rate }); }
    else if (mv === "knee" || mv === "flyknee") play("kickBody2", o);
    else if (kick) play(tgt === 2 ? pick(KLEG) : pick(KBODY), o);
    else if (tgt === 1) play(pick(BODY), o);
    else if (!big) play(LIGHT[mv] ? pick(HEAD_LIGHT) : pick(HEAD), { gain: LIGHT[mv] ? g * 0.8 : g, pan: sp.pan, rate: rate });
    // the crowd answers clean power shots and runs of them
    S.excite = Math.min(1.2, S.excite + 0.05 + 0.12 * power + (big ? 0.6 : 0));
    var t = now();
    S.hits.push([t, b.who]);
    while (S.hits.length && t - S.hits[0][0] > 3) S.hits.shift();
    var mine = 0; for (var i = 0; i < S.hits.length; i++) if (S.hits[i][1] === b.who) mine++;
    if (!big && (mine >= 4 || S.hits.length >= 6) && t - S.roarT > 7) {
      S.roarT = t; S.excite = Math.min(1.2, S.excite + 0.35);
      play("roar", { bus: "crowd", gain: 0.55 + 0.08 * Math.min(4, mine), prio: true });
    }
  }

  var H = {
    onBeat: function (b) {
      if (!b) return;
      if (b.k === "strike" && !is3D()) { strikeSound(b); return; }   // the text show calls onImpact itself for the big ones
      var sp = spatial(fighter(b.who));
      if (b.k === "td") {
        var fence = nearFence();
        play(S.rng() < 0.5 ? "td1" : "td2", { when: is3D() ? 0.55 : 0, gain: sp.gain, pan: sp.pan, prio: true });
        if (fence) play("slam", { when: 0.5, gain: sp.gain * 0.7, pan: sp.pan });
        S.excite = Math.min(1.2, S.excite + 0.3);
      } else if (b.k === "tdx") {
        play("td1", { when: is3D() ? 0.45 : 0, gain: sp.gain * 0.45, pan: sp.pan, rate: 1.15 });
        if (nearFence()) play("rattle", { when: 0.4, gain: sp.gain * 0.8, pan: sp.pan });
        S.excite = Math.min(1.2, S.excite + 0.1);
      } else if (b.k === "clinch") {
        if (nearFence() && now() - S.clinchRattleT > 3) { S.clinchRattleT = now(); play("rattle", { when: 0.25, gain: sp.gain, pan: sp.pan }); }
      } else if (b.k === "reset") {
        play("refGo", { bus: "voice", when: 0.2 });
      } else if (b.k === "sub") {
        play("roar", { bus: "crowd", gain: 0.8, prio: true }); S.excite = 1.1;
      } else if (b.k === "subx") {
        play("ooh", { bus: "crowd", gain: 0.75 }); S.excite = Math.min(1.2, S.excite + 0.35);
      } else if (b.k === "up") {
        S.excite = Math.min(1.2, S.excite + 0.12);
      }
    },
    // the 3D show calls this at the moment of contact for every strike (landed or not); text mode only for big ones
    onImpact: function (b) {
      if (!b) return;
      if (is3D()) strikeSound(b);
      if (b.kd || b.fin) { play("pop", { bus: "crowd", gain: 1.0, prio: true }); S.excite = 1.2; }
      else if (b.hurt) { play(S.rng() < 0.5 ? "ooh" : "roar", { bus: "crowd", gain: 0.75, prio: true }); S.excite = Math.min(1.2, S.excite + 0.5); }
    },
    onPhase: function (p, r) {
      if (p === "intro" && !r) { play("boom", { gain: 0.9, prio: true }); play("chant", { bus: "crowd", when: 0.6, gain: 0.8 }); S.excite = 0.9; }
      else if (p === "intro") { if (S.rng() < 0.5) play("chant", { bus: "crowd", gain: 0.5 }); }
      else if (p === "live") {
        play("bell3", { gain: 0.9, prio: true });
        play(S.rng() < 0.6 ? "refFight" : "refGo", { bus: "voice", when: 0.9 });
        S.clapR = -1; S.groundSince = null; S.lastStrikeClock = 0; S.excite = Math.max(S.excite, 0.6);
      }
    },
    onRoundEnd: function () {
      play("bell3", { gain: 0.9, prio: true });
      S.excite = Math.min(1.2, S.excite + 0.35);
    },
    onFinish: function (res) {
      play("refStop", { bus: "voice", gain: 1.0, prio: true });
      play("bellRing", { when: 0.35, gain: 0.95, prio: true });
      if (res && (res.method === "SUB" || res.method === "CORNER" || res.method === "DOC")) play("pop", { bus: "crowd", gain: res.method === "SUB" ? 1.0 : 0.6, prio: true });
      S.excite = 1.2;
    },
    onDecision: function (sc) {
      var m = sc && sc.method, close = m === "SD" || m === "MD" || (sc && sc.winner === "D");
      play("chant", { bus: "crowd", gain: 0.6 });
      play(close ? "boo" : "pop", { bus: "crowd", when: 0.25, gain: close ? 0.8 : 0.85, prio: true });
      if (close) play("roar", { bus: "crowd", when: 0.4, gain: 0.45 });
      S.excite = close ? 0.8 : 1.1;
    },
    onClock: function (r, t, state) {
      if (t >= 290 && S.lastClock < 290 && S.clapR !== r) { S.clapR = r; play("clapper", { gain: 0.85, prio: true }); play("clapper", { gain: 0.6, when: 0.75 }); }
      // a long spell on the floor with nothing landing draws boos
      if (state === "ground") {
        if (S.groundSince == null) S.groundSince = t;
        var quiet = t - Math.max(S.groundSince, S.lastStrikeClock);
        if (quiet > 40 && now() - S.booT > 25) { S.booT = now(); play("boo", { bus: "crowd", gain: 0.55 }); }
      } else S.groundSince = null;
      S.lastClock = t;
    },
    onReplay: function (on) {
      if (!S.ctx) return;
      var t = now(), f = S.replayLP.frequency;
      f.cancelScheduledValues(t); f.setValueAtTime(f.value, t);
      f.linearRampToValueAtTime(on ? 1600 : 20000, t + (on ? 0.35 : 0.6));
      if (on) play("whooshKick", { gain: 0.8, rate: 0.55, prio: true });
    }
  };
  // strikes also mark the clock (for the stall boos)
  var onBeatInner = H.onBeat;
  H.onBeat = function (b) { if (b && b.k === "strike" && b.landed && typeof b.t === "number") S.lastStrikeClock = b.t; return onBeatInner(b); };

  /* ------------------------------------------------------------ crowd level, every frame */
  var PHASE_LEVEL = { idle: 0.32, intro: 0.62, live: 0.42, "break": 0.5, finish: 0.95, result: 0.85, decision: 0.7, replay: 0.55 };
  function tick(dt) {
    if (!S.ctx || !S.enabled) return;
    var sh = S.show, t = now(), real = (root.performance && performance.now) ? performance.now() / 1000 : Date.now() / 1000;
    // frames stopped (paused, scrolled away, hidden tab): fade out; pick up again when the show moves
    if (sh && typeof sh.time === "number") {
      if (S.lastShowT !== sh.time || sh.phase === "replay") { S.lastShowT = sh.time; S.lastShowAt = real; }
    } else S.lastShowAt = real;
    var frozen = !!(sh && sh.paused) || real - S.lastShowAt > 0.6 || !!(doc && doc.hidden);
    S.frozen = frozen;
    S.excite *= Math.exp(-dt / 2.8);
    var ph = sh && sh.phase || "idle", lvl = PHASE_LEVEL[ph] != null ? PHASE_LEVEL[ph] : 0.4;
    if (ph === "intro" && sh && !sh.rIdx) lvl = 0.72;
    if (ph === "live" && sh && sh.state === "ground") lvl = 0.36;
    var mood = sh && sh.arena && sh.arena.U && sh.arena.U.uExcite ? sh.arena.U.uExcite.value : null;   // the visual crowd
    if (mood != null) lvl = Math.max(lvl, 0.25 + 0.55 * mood);
    lvl = clamp(lvl + 0.45 * S.excite, 0, 1.25);
    S.level += (lvl - S.level) * Math.min(1, dt * 1.6);
    var bedTarget = frozen ? 0 : 0.22 + 0.62 * Math.min(1, S.level);
    S.bedGain.gain.setTargetAtTime(bedTarget, t, frozen ? 0.25 : 0.35);
    S.bedLP.frequency.setTargetAtTime(1800 + 9000 * Math.min(1, S.level), t, 0.4);
    S.master.gain.setTargetAtTime(frozen ? 0 : S.volume, t, frozen ? 0.15 : 0.3);
  }
  var lastFrame = 0;
  function loop(ts) {
    S.raf = 0;
    if (!S.enabled) return;
    var dt = lastFrame ? Math.min(0.25, (ts - lastFrame) / 1000) : 1 / 60; lastFrame = ts;
    tick(dt);
    S.raf = (root.requestAnimationFrame || function (f) { return root.setTimeout(function () { f(Date.now()); }, 50); })(loop);
  }

  /* ------------------------------------------------------------ attaching to a show */
  var HOOKS = ["onBeat", "onImpact", "onPhase", "onRoundEnd", "onFinish", "onDecision", "onClock", "onReplay"];
  function attach(show) {
    if (!show) return false;
    var h = show.hooks || (show.hooks = {});
    S.show = show;
    if (S.hooks === h && h.onBeat && h.onBeat._fightAudio) return true;
    HOOKS.forEach(function (k) {
      var prev = h[k];
      if (prev && prev._fightAudio) return;
      var w = function () {
        var r = prev ? prev.apply(this, arguments) : undefined;
        if (S.enabled && S.ctx) { try { H[k].apply(null, arguments); } catch (e) { if (root.console) console.warn("[audio]", k, e && e.message); } }
        return r;
      };
      w._fightAudio = true; w._prev = prev || null;
      h[k] = w;
    });
    S.hooks = h;
    return true;
  }
  function detach() {
    var h = S.hooks;
    if (h) HOOKS.forEach(function (k) { if (h[k] && h[k]._fightAudio) { if (h[k]._prev) h[k] = h[k]._prev; else delete h[k]; } });
    S.hooks = null; S.show = null;
  }

  /* ------------------------------------------------------------ on / off */
  function activated() {
    var ua = root.navigator && root.navigator.userActivation;
    return ua ? !!ua.hasBeenActive : true;
  }
  function wake() {
    if (!S.wanted || !AC) return;
    var c = makeContext();
    if (!c) return;
    if (c.state === "suspended" && c.resume) { try { var p = c.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* needs a gesture */ } }
    S.enabled = true;
    loadAll();
    if (S.loaded) startBed();
    if (!S.raf) { lastFrame = 0; S.raf = (root.requestAnimationFrame || function (f) { return root.setTimeout(function () { f(Date.now()); }, 50); })(loop); }
    if (S.master) S.master.gain.setTargetAtTime(S.volume, now(), 0.3);
  }
  function setEnabled(on) {
    on = !!on;
    S.wanted = on;
    store("fightlab.sound", on ? "1" : "0");
    if (S.ui && S.ui.checked !== on) S.ui.checked = on;
    if (!AC) return false;
    if (on) { if (activated() || S.ctx) wake(); }
    else {
      S.enabled = false;
      if (S.ctx && S.master) { S.master.gain.setTargetAtTime(0, now(), 0.1); }
      if (S.ctx && S.ctx.suspend) root.setTimeout(function () { if (!S.enabled && S.ctx && S.ctx.state === "running") { try { var p = S.ctx.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } } }, 400);
    }
    return on;
  }
  function setVolume(x) {
    S.volume = clamp(+x || 0, 0, 1);
    store("fightlab.volume", String(S.volume));
    if (S.ctx && S.master && S.enabled) S.master.gain.setTargetAtTime(S.volume, now(), 0.1);
    return S.volume;
  }

  /* ------------------------------------------------------------ page glue: a Sound toggle beside Replays */
  function injectToggle() {
    if (!doc || !AC || root.FIGHT_AUDIO_NO_UI || doc.getElementById("soundTog")) return;
    var rep = doc.getElementById("replayTog"), lab = rep && rep.parentNode;
    if (!lab || !lab.parentNode) return;
    var l = doc.createElement("label"), cb = doc.createElement("input");
    l.className = lab.className || "dtog";
    cb.type = "checkbox"; cb.id = "soundTog"; cb.checked = S.wanted;
    l.appendChild(cb); l.appendChild(doc.createTextNode(" Sound"));
    lab.parentNode.insertBefore(l, lab.nextSibling);
    cb.addEventListener("change", function () { setEnabled(cb.checked); });
    S.ui = cb;
  }
  function onGesture() { if (S.wanted && (!S.ctx || S.ctx.state !== "running")) wake(); }
  function poll() {
    var v = root.VGSim;
    if (v && v.show && v.show !== S.show) attach(v.show);
    if (!S.ui) injectToggle();
  }

  if (AC) {
    var savedVol = parseFloat(store("fightlab.volume"));
    if (savedVol >= 0 && savedVol <= 1) S.volume = savedVol;
    S.wanted = store("fightlab.sound") === "1";
    if (doc && doc.addEventListener) {
      ["pointerdown", "keydown", "touchend"].forEach(function (ev) { doc.addEventListener(ev, onGesture, true); });
      if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", poll); else root.setTimeout(poll, 0);
    }
    if (root.setInterval) root.setInterval(poll, 800);
  }

  root.FightAudio = {
    supported: !!AC,
    attach: function (show) { return AC ? attach(show) : false; },
    detach: function () { if (AC) detach(); },
    setEnabled: setEnabled,
    isEnabled: function () { return !!(AC && S.wanted); },
    setVolume: setVolume,
    getVolume: function () { return S.volume; },
    // the page may call this from its first click; it only wakes sound the viewer has turned on
    unlock: function () { if (AC) onGesture(); return !!(S.ctx && S.ctx.state === "running"); },
    state: function () {
      return { supported: !!AC, enabled: S.enabled, wanted: S.wanted, context: S.ctx ? S.ctx.state : null, loaded: S.loaded, buffers: Object.keys(S.buf).length,
        attached: !!S.hooks, voices: S.voices, plays: S.plays, level: +S.level.toFixed(3), frozen: S.frozen, log: S.log.slice() };
    },
    ready: function () { return S.loading || Promise.resolve(); },
    SOUNDS: SND,
    _tick: function (dt) { tick(dt || 1 / 60); },
    _rng: function (f) { S.rng = f || Math.random; }
  };
})(typeof window !== "undefined" ? window : globalThis);
