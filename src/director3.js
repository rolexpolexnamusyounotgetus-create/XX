/* Director v3: turns one traced engine-v3 fight into an animation script for the 3D show.

   Entry point (same as src/director.js, so the show keeps working):
     FightDirector.build(fight, seed[, opts]) -> script
   fight = FightEngine.simulate(m, rng, true). opts (all optional):
     fighters  {A: {...}, B: {...}}  name, short, slug, nick, pronouns ("he" | "she" | "they" or {he, him, his, hes}),
                                     stance, height_in, reach_in, division, record, kd_absorbed, appearance, ...
                                     (every field is copied to script.fighters, which the 3D show reads)
     moves     {A: scoutingMoves, B}  data/scouting/<slug>.json "moves" weights
     scouting  {A: scoutingFile, B}   the whole scouting file (moves, style.tags, style.archetype)
     profiles  {A: prof, B}           fighters.json entries (for derived techniques and career context)
     matchup   m                      FightEngine.matchup(...) result (names, division, rates, power)
     rounds    scheduled rounds (else matchup.rounds; else unknown)
     title     true for a title fight
     showMoves array of move names the show can animate (else FightShow.MOVES / PUNCH / KICK, else the v2 list)
     thin      {cap: 4, iso: 0.55, clinch: 0.6, ground: 0.35, down: 0.5}: miss thinning (see below)

   Script (v2 fields kept, new fields marked +):
     { version: 3+, seed, winner, method, detail+, round, t, cards, form, fin+, totals+, nRounds+, title+,
       fighters+ {A, B}, names+ {A, B}, short+ {A, B}, moves+ {A, B} (technique weights used),
       intro+ (text), result+ (text), decision+ ({text, cards, winner, method} or null),
       lines+ [{r, t, txt, k, who, big}] (the whole play-by-play in order, intro and outro included),
       rounds: [{ r, beats, endT, judges, stoppage, fin, st (engine round stats), dHA, dHB, dLA, dLB, SA, SB,
                  base+ (fight stats before the round), end+ (fight stats after it), intro+, outro+,
                  timeline+ [[t0, t1, s, ctl, pos]], density+ {...}, cum+ (for statsAt) }] }

   Beat (every beat): t (exact engine time, s into the round), k (kind), who ("A" | "B" | null), st (engine state
     after the beat: 0 distance, 1 clinch, 2 A on top, 3 B on top; for a strike the state it was thrown in),
     pos (ground sub-position when st >= 2: guard | half | side | mount | back | down), ctl (clinch controller),
     pri (0 filler the show may drop when it lags, 1 normal strike, 2 key beat: never drop), stats (cumulative
     engine stats for the fight after this beat: {A: {...STAT_KEYS}, B: {...}}), ev (the raw engine event),
     i (index of the event in the round's ev list, -1 for derived beats), txt (play-by-play line, optional).
   Kinds:
     strike   move (a name the show animates), tech (technique id; equals move unless the show lacks it),
              tgt (0 head, 1 body, 2 leg), landed, miss, kd, hurt, fin, how (KO | TKO | GNP | LEG on fin),
              loc (dist | clinch | ground), top (ground: thrown by the top man), down (follow-up on a downed man),
              to (kd: state after: 0 = he is waved back up, 2/3 = the attacker pounces), side (lead | rear),
              power (0..1 visual impact from the engine's power estimate), chain (thrown <1.6 s after the same
              man's previous strike in the same position), combo (combination id), ci (index in it), counter
     clinch   who = controller; swap (he reversed the position); via ("tdx" | "up") when it follows a stuffed
              shot or a stand-up into the fence
     break    who = the man who broke away
     td / tdx who = shooter; tech (double-leg, body-lock takedown...); from (0 distance, 1 clinch); td: pos (landing)
     pass     who = top man; from, pos (new sub-position)
     esc      who = bottom man; from, pos (new, lesser sub-position)
     sweep    who = bottom man who comes up on top; st, pos
     up       who = the man who stands; st 0 (free) or 1 (stood into a clinch: a clinch beat follows at the same t)
     sub/subx who = attacker; name (engine name), sub (display name), pos, bottom (attacking from his back),
              standing (guillotine on a stuffed shot)
     pounce   who = attacker, after a knockdown (st 2/3, pos "down"); follow-up strikes have down: true
     recover  who = the downed man; st 0 (back to his feet) or 2/3 with pos "guard"
     reset    the referee restarts them standing
     note     text only (round intro at t 0, commentary in quiet stretches); pri 0, i -1
   The v2 show ignores pass / esc / sweep / pounce / recover / note (it only draws them as text), and nothing
   in this stream can stall it: standing strikes only follow beats that put the v2 show back on its feet.

   Misses are real engine events now. All landed strikes are kept; misses are thinned so the animation stays
   readable: misses inside a combination with a landed strike are kept, isolated misses are sampled, and no
   fighter shows more than `cap` strikes in any 10 s window (landed strikes are never dropped). Stats on every
   beat come from the full event stream, thinned misses included, so the HUD matches the engine exactly.

   Timing: beats keep their engine time. round.density gives 10 s bins (beats, strikes, engine events, activity,
   suggested clock warp) and the quiet stretches, so the show can run the clock faster through quiet spells
   without drifting from it; FightDirector.warpAt(round, t) interpolates the warp, statsAt(script, r, t) returns
   the exact engine stats (control included) at any clock time.

   RNG: a mulberry32 generator seeded from seed ^ 0x5bd1e995 (separate from the engine's generator, so the fight
   itself never depends on the director); technique choice and wording are deterministic for a seed. */
(function (root) {
  "use strict";
  var VERSION = "3.0.0";

  // ------------------------------------------------------------------ small helpers
  function other(w) { return w === "A" ? "B" : "A"; }
  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function num(x, d) { return x != null && isFinite(x) ? +x : d; }
  function mulberry(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function pickW(w, u) {
    var tot = 0, k, last = null;
    for (k in w) if (w[k] > 0) { tot += w[k]; last = k; }
    if (!last) return null;
    var x = u * tot;
    for (k in w) if (w[k] > 0) { x -= w[k]; if (x < 0) return k; }
    return last;
  }
  function pick(arr, r) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function shuffled(n, r) { var a = [], i; for (i = 0; i < n; i++) a.push(i); for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var ORD = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  function ordinal(n) {
    if (n <= 10) return ORD[n];
    var s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
    return n + s;
  }
  var NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  function numWord(n) { return n <= 10 ? NUMW[n] : String(n); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function article(w) { return (/^[aeiou]/i.test(w) && !/^(one|uni|use)/i.test(w) ? "an " : "a ") + w; }
  function poss(name) { return /s$/.test(name) ? name + "'" : name + "'s"; }
  function capSent(s) { return s.replace(/(^|[.!?]\s+)([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); }); }
  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

  // ------------------------------------------------------------------ names and pronouns
  var PARTICLES = { da: 1, de: 1, "do": 1, dos: 1, das: 1, del: 1, della: 1, di: 1, du: 1, van: 1, von: 1, der: 1, den: 1, la: 1, le: 1, st: 1, "st.": 1, saint: 1, el: 1, al: 1, bin: 1, ibn: 1 };
  var SUFFIX = { jr: 1, "jr.": 1, sr: 1, "sr.": 1, ii: 1, iii: 1, iv: 1 };
  // two-token names the data writes family name first (ufcstats does this for these fighters)
  var SURNAME_FIRST = { Zhang: 1, Wang: 1, Li: 1, Song: 1, Yan: 1, Liu: 1, Chen: 1, Yang: 1, Huang: 1, Zhao: 1, Wu: 1, Zhou: 1, Xu: 1, Sun: 1, Zhu: 1, Hu: 1, Guo: 1, Lin: 1, Luo: 1, Gao: 1, Liang: 1, Zheng: 1, Xie: 1, Tang: 1, Feng: 1, Deng: 1, Cao: 1, Peng: 1, Zeng: 1, Xiao: 1, Tian: 1, Dong: 1, Pan: 1, Yuan: 1, Cai: 1, Jiang: 1, Wei: 1, Su: 1, Ding: 1, Ren: 1, Shen: 1, Yao: 1, Qin: 1, Aoriqileng: 1 };
  // how coverage shortens a few double surnames
  var SHORT_EXCEPT = { "Ian Machado Garry": "Machado Garry", "Mayra Bueno Silva": "Bueno Silva", "Waldo Cortes Acosta": "Cortes Acosta",
    "Antonio Carlos Junior": "Carlos Junior", "Elizeu Zaleski dos Santos": "Zaleski" };
  function shortName(name) {
    if (!name) return name;
    name = String(name).replace(/\s+/g, " ").trim();
    if (SHORT_EXCEPT[name]) return SHORT_EXCEPT[name];
    var t = name.split(" ");
    while (t.length > 1 && SUFFIX[t[t.length - 1].toLowerCase()]) t.pop();
    if (t.length === 1) return t[0];
    if (t.length === 2 && SURNAME_FIRST[t[0]]) return t[0];
    var i = t.length - 1;
    while (i > 1 && PARTICLES[t[i - 1].toLowerCase()]) i--;
    return t.slice(i).join(" ");
  }
  var PRON = {
    he: { key: "he", he: "he", him: "him", his: "his", hes: "he's" },
    she: { key: "she", he: "she", him: "her", his: "her", hes: "she's" },
    they: { key: "they", he: "they", him: "them", his: "their", hes: "they're" }
  };
  var MEN_DIV = { Flyweight: 1, Bantamweight: 1, Featherweight: 1, Lightweight: 1, Welterweight: 1, Middleweight: 1, "Light Heavyweight": 1, Heavyweight: 1 };
  // explicit pronouns win; otherwise the division the fighter competes in (UFC men's or women's divisions, as
  // their own coverage uses); otherwise they/them
  function pronounsFor(spec, division, fightDivision) {
    if (spec) {
      if (typeof spec === "object" && spec.he) return { key: spec.key || spec.he, he: spec.he, him: spec.him || spec.he, his: spec.his || spec.he, hes: spec.hes || (spec.he + "'s") };
      var s = String(spec).toLowerCase();
      if (/^she/.test(s)) return PRON.she;
      if (/^they/.test(s)) return PRON.they;
      if (/^he\b/.test(s) || /^him/.test(s)) return PRON.he;
    }
    var d = division && division !== "Catch Weight" && division !== "Open Weight" ? division : (fightDivision || "");
    if (/^women/i.test(d)) return PRON.she;
    if (MEN_DIV[d]) return PRON.he;
    return PRON.they;
  }
  function normStance(s) {
    s = String(s || "").toLowerCase();
    if (s.indexOf("south") === 0) return "Southpaw";
    if (s.indexOf("switch") === 0) return "Switch";
    if (s.indexOf("orth") === 0) return "Orthodox";
    return null;
  }

  // ------------------------------------------------------------------ moves the show knows
  var BASE_MOVES = ["jab", "cross", "hook", "overhand", "upper", "headkick", "bodykick", "bodyhook", "bodystraight", "calf", "inside",
    "short", "elbow", "kneehead", "knee", "shortbody", "gnp", "gnpelbow", "upelbow"];
  // extended techniques and the closest v2 move when the show can't draw them
  var EXT = { spinfist: "hook", spinback: "bodykick", wheel: "headkick", flyknee: "kneehead" };
  var EXT_ALIASES = { spinfist: ["spinfist", "backfist", "spinbackfist", "spinningbackfist"], spinback: ["spinback", "spinkick", "spinbackkick", "spinningbackkick"],
    wheel: ["wheel", "wheelkick", "spinheel", "spinningwheelkick"], flyknee: ["flyknee", "flyingknee"] };
  var CLASS = { jab: "punch", cross: "punch", hook: "punch", overhand: "punch", upper: "punch", bodyhook: "punch", bodystraight: "punch", short: "punch",
    shortbody: "punch", gnp: "punch", spinfist: "punch", headkick: "kick", bodykick: "kick", calf: "kick", inside: "kick", spinback: "kick", wheel: "kick",
    kneehead: "knee", knee: "knee", flyknee: "knee", elbow: "elbow", gnpelbow: "elbow", upelbow: "elbow" };
  var SIDE_OF = { jab: "lead", cross: "rear", hook: "lead", overhand: "rear", upper: "rear", bodyhook: "lead", bodystraight: "rear", short: "rear", elbow: "lead",
    shortbody: "rear", headkick: "rear", bodykick: "rear", calf: "rear", inside: "lead", knee: "rear", kneehead: "rear", spinfist: "rear", spinback: "rear",
    wheel: "rear", flyknee: "rear", gnp: "rear", gnpelbow: "lead", upelbow: "lead" };
  // how likely each technique is to be the one that drops or hurts a man, relative to how often it is thrown
  var KDP = { jab: 0.25, cross: 1.3, hook: 1.6, overhand: 1.6, upper: 1.25, headkick: 2.6, spinfist: 1.6, wheel: 2.6, flyknee: 3, elbow: 1.3, kneehead: 1.8,
    short: 0.9, bodykick: 1.6, bodyhook: 1.6, bodystraight: 0.7, knee: 1.5, shortbody: 0.8, spinback: 2, calf: 1, inside: 1, gnp: 1, gnpelbow: 1.3, upelbow: 1 };
  // combination flow: what tends to follow what (lead and rear hands alternate)
  var NEXT = {
    jab: { cross: 2.2, jab: 1.3, bodystraight: 1.4, hook: 1.1, overhand: 1.2 },
    cross: { hook: 2.0, bodyhook: 1.5, calf: 1.5, upper: 0.8, cross: 0.6, headkick: 1.2 },
    hook: { cross: 1.8, overhand: 1.4, upper: 1.3, hook: 0.7, bodykick: 1.2 },
    overhand: { hook: 1.7, calf: 1.3, overhand: 0.6 },
    upper: { hook: 2.0, cross: 1.2, upper: 0.6 },
    bodyhook: { hook: 1.8, cross: 1.3 },
    bodystraight: { hook: 1.4, cross: 1.2, headkick: 1.3 },
    calf: { jab: 1.2, cross: 1.2 },
    inside: { cross: 1.3, overhand: 1.2 },
    bodykick: { cross: 1.2 },
    short: { elbow: 1.4, short: 1.2, kneehead: 1.2 },
    elbow: { short: 1.3, knee: 1.2 },
    knee: { knee: 1.5, elbow: 1.2, short: 1.1 }
  };
  var FIRST = { jab: 1.45, calf: 1.25, inside: 1.2, bodykick: 1.1, overhand: 0.85, upper: 0.7, hook: 0.9 };

  function detectShowMoves(opts) {
    var list = null, FS = root.FightShow;
    if (opts.showMoves) list = opts.showMoves;
    else if (FS && FS.MOVES) list = Array.isArray(FS.MOVES) ? FS.MOVES : Object.keys(FS.MOVES);
    else if (FS && (FS.PUNCH || FS.KICK)) list = Object.keys(FS.PUNCH || {}).concat(Object.keys(FS.KICK || {})).concat(["gnp", "gnpelbow", "upelbow"]);
    var set = {}, i;
    for (i = 0; i < BASE_MOVES.length; i++) set[BASE_MOVES[i]] = BASE_MOVES[i];
    if (list) {
      var low = {};
      for (i = 0; i < list.length; i++) low[String(list[i]).toLowerCase().replace(/[^a-z]/g, "")] = list[i];
      for (var ext in EXT_ALIASES) for (var j = 0; j < EXT_ALIASES[ext].length; j++) if (low[EXT_ALIASES[ext][j]]) { set[ext] = low[EXT_ALIASES[ext][j]]; break; }
    }
    return set;   // technique id -> the show's move name
  }

  // ------------------------------------------------------------------ technique wording
  var POS_NAME = { guard: "full guard", half: "half guard", side: "side control", mount: "full mount", back: "back control", down: "the mat" };
  var POS_FROM = { guard: "from inside the guard", half: "from half guard", side: "from side control", mount: "from mount", back: "from the back", down: "on the mat" };
  var POS_BOT = { guard: "off the bottom", half: "from the bottom of half guard", side: "from the bottom", mount: "from the bottom", back: "from the bottom" };
  function posIn(pos, dname) {
    return { guard: "in " + poss(dname) + " guard", half: "in half guard", side: "in side control", mount: "in full mount", back: "on " + poss(dname) + " back", down: "on top" }[pos] || "on top";
  }
  var SUB_NAME = { "rear naked choke": "rear-naked choke", "arm triangle": "arm-triangle choke", "d'arce choke": "D'Arce choke", "guillotine choke": "guillotine",
    "triangle choke": "triangle choke", "anaconda choke": "anaconda choke", "neck crank": "neck crank", "heel hook": "heel hook", armbar: "armbar",
    kimura: "kimura", americana: "Americana" };
  function subName(n) { var k = String(n || "submission").toLowerCase(); return SUB_NAME[k] || k; }

  function moveTexts(mv, F, tg, pos) {
    var L = F.sided ? F.lead : null, R = F.sided ? F.rear : null;
    switch (mv) {
      case "jab": return L ? ["jab", "stiff jab", "sharp jab", L + " jab"] : ["jab", "stiff jab", "sharp jab"];
      case "cross": return R ? [R + " hand", "straight " + R, R + " straight", "cross"] : ["cross", "straight rear hand", "rear straight"];
      case "hook": return L ? [L + " hook", "lead hook", "hook"] : ["lead hook", "hook"];
      case "overhand": return R ? ["overhand " + R, "looping overhand", "overhand"] : ["looping overhand", "overhand"];
      case "upper": return R ? [R + " uppercut", "uppercut"] : ["uppercut", "rear uppercut"];
      case "headkick": return R ? ["head kick", R + " high kick", "high kick"] : ["head kick", "high kick"];
      case "bodykick": return F.liverKick ? ["body kick", R + " kick to the liver", "kick to the ribs"] : (R ? ["body kick", R + " kick to the body", "kick to the ribs"] : ["body kick", "kick to the ribs"]);
      case "bodyhook": return L === "left" ? ["left hook to the body", "left hook to the liver", "body hook"] : (L ? [L + " hook to the body", "hook to the body", "body hook"] : ["hook to the body", "body hook"]);
      case "bodystraight": return R ? ["straight " + R + " to the body", R + " hand to the body", "straight to the body"] : ["straight to the body", "rear hand to the body"];
      case "calf": return R ? ["calf kick", R + " calf kick", "low kick to the calf"] : ["calf kick", "low kick to the calf"];
      case "inside": return L ? ["inside leg kick", L + " inside low kick", "low kick to the inside of the leg"] : ["inside leg kick", "low kick to the inside of the leg"];
      case "short": return R ? ["short " + R, "short punch on the inside", R + " hand on the inside"] : ["short punch on the inside", "short punch"];
      case "elbow": return L ? [L + " elbow", "short elbow", "elbow"] : ["short elbow", "elbow"];
      case "kneehead": return ["knee to the head", "knee up the middle", "knee upstairs"];
      case "knee": return tg === 2 ? ["knee to the thigh", "knee to the leg"] : ["knee to the body", "knee to the midsection", "knee to the ribs"];
      case "shortbody": return ["short shot to the body", "body shot on the inside", "punch to the body on the inside"];
      case "gnp": return pos === "down" ? ["hammerfist", "punch on the ground", "shot on the ground"] : ["punch " + (POS_FROM[pos] || "from the top"), "short punch from the top", "hammerfist"];
      case "gnpelbow": return ["elbow " + (POS_FROM[pos] || "from the top"), "short elbow from the top", "elbow from the top"];
      case "upelbow": return ["elbow off the bottom", "up-elbow", "short shot from the bottom"];
      case "spinfist": return ["spinning back fist"];
      case "spinback": return ["spinning back kick"];
      case "wheel": return ["spinning wheel kick"];
      case "flyknee": return ["flying knee"];
    }
    return [mv];
  }
  var SEQ_TXT = { jab: "jab", cross: "cross", hook: "hook", overhand: "overhand", upper: "uppercut", headkick: "head kick", bodykick: "body kick",
    bodyhook: "body hook", bodystraight: "straight to the body", calf: "calf kick", inside: "inside low kick", short: "short punch", elbow: "elbow",
    kneehead: "knee", knee: "knee", shortbody: "body shot", spinfist: "spinning back fist", spinback: "spinning back kick", wheel: "wheel kick", flyknee: "flying knee" };
  function seqText(F, mv) {
    if (F.sided) { if (mv === "cross") return F.rear + " hand"; if (mv === "hook") return F.lead + " hook"; if (mv === "upper") return F.rear + " uppercut"; }
    return SEQ_TXT[mv] || mv;
  }

  // ------------------------------------------------------------------ technique weights per fighter
  var KEYS_DEFAULT = ["min", "n", "rds", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "h_att", "h_lnd", "b_att", "b_lnd",
    "l_att", "l_lnd", "t_att", "t_lnd", "od_att", "od_lnd", "oc_att", "oc_lnd", "og_att", "og_lnd", "oh_att", "oh_lnd",
    "ob_att", "ob_lnd", "ol_att", "ol_lnd", "ot_att", "ot_lnd", "kd", "okd", "td_att", "td_lnd", "otd_att", "otd_lnd",
    "ctrl", "octrl", "sub_att", "osub_att", "rev", "orev", "ko_w", "ko_l", "sub_w", "sub_l", "dec_w", "dec_l"];
  function sumsOf(prof) {
    if (!prof || !prof.S) return null;
    var S = prof.S, o = {}, i;
    if (Array.isArray(S)) {
      var FE = root.FightEngine, keys = prof.keys || (FE && FE.KEYS) || KEYS_DEFAULT;
      for (i = 0; i < keys.length && i < S.length; i++) o[keys[i]] = +S[i] || 0;
    } else for (var k in S) o[k] = +S[k] || 0;
    return o;
  }
  function priorsFor(division, opts) {
    if (opts.matchup && opts.matchup.P) return opts.matchup.P;
    if (opts.priors && (opts.priors[division] || opts.priors.ALL)) return opts.priors[division] || opts.priors.ALL;
    var FE = root.FightEngine;
    if (FE && FE.priorFor) { try { return FE.priorFor(division || "Lightweight"); } catch (e) { return null; } }
    return null;
  }
  function allPriors(opts) {
    if (opts.priors && opts.priors.ALL) return opts.priors.ALL;
    var FE = root.FightEngine;
    if (FE && FE.priorFor) { try { return FE.priorFor("ALL"); } catch (e) { return null; } }
    return null;
  }

  // style factors around 1 = league average for the fight division (judgment heuristics; ufcstats has no technique data)
  function styleOf(F, side, opts) {
    var st = { kick: 1, vol: 1, pow: 1, ape: 1, divKick: 1, clinchK: 1, gnp: 1, wrest: 1, known: false };
    var m = opts.matchup, i = side === "A" ? 0 : 1, s = null, P = null;
    if (m && m.R && m.R[i] && m.R[i].sums) { s = m.R[i].sums; P = m.P; }
    else if (F.profile) { s = sumsOf(F.profile); P = priorsFor(F.fightDivision || F.division, opts); }
    if (s && P && s.min > 0) {
      st.known = true;
      var sig = (s.h_att + s.b_att + s.l_att) || 0, lsh = P.l_att / (P.h_att + P.b_att + P.l_att);
      var leg = (s.l_att + 60 * lsh) / (sig + 60);
      st.kick = clip(Math.pow(leg / lsh, 0.7), 0.45, 2.2);
      st.vol = clip(Math.pow((s.d_att + 40 * P.d_att) / (s.min + 40) / P.d_att, 0.5), 0.6, 1.6);
      st.pow = clip(Math.pow((s.kd + 230 * P.kd_per_h) / (s.h_lnd + 230) / P.kd_per_h, 0.4), 0.6, 1.8);
      st.clinchK = clip(Math.pow((s.c_att + 40 * P.c_att) / (s.min + 40) / P.c_att, 0.5), 0.6, 1.8);
      var topMin = s.ctrl / 60 * 0.84, lgTop = P.ctrl / 60 * 0.84;
      st.gnp = clip(Math.pow((s.g_att + 20 * P.g_att) / (topMin + 20 * lgTop) / (P.g_att / lgTop), 0.5), 0.6, 1.8);
      st.wrest = clip(Math.pow((s.td_att + 45 * P.td_att) / (s.min + 45) / P.td_att, 0.5), 0.5, 2);
      var ALL = allPriors(opts);
      if (ALL && ALL.l_att) st.divKick = clip(Math.sqrt(lsh / (ALL.l_att / (ALL.h_att + ALL.b_att + ALL.l_att))), 0.7, 1.3);
    }
    if (F.height_in && F.reach_in) st.ape = clip(1 + (F.reach_in - F.height_in) / 20, 0.8, 1.25);
    return st;
  }

  function hasTag(F, t) { return F.tags && F.tags.indexOf(t) >= 0; }
  function buildMoves(F, opp, opts, SUP) {
    var S = F.style, sm = F.scoutMoves, W;
    var tagElbow = hasTag(F, "elbows") ? 1.8 : 1, tagKnee = hasTag(F, "knees") ? 1.7 : 1;
    if (sm && sumKeys(sm, ["jab", "cross", "hook", "overhand", "upper", "headkick"]) > 0) {
      var g = function (k) { return Math.max(0, num(sm[k], 0)); };
      var spin = g("spinning"), knee = g("knee"), elbow = g("elbow");
      W = {
        dh: { jab: g("jab"), cross: g("cross"), hook: g("hook"), overhand: g("overhand"), upper: g("upper"), headkick: g("headkick"),
          spinfist: 0.15 * spin, wheel: 0.06 * spin, flyknee: (hasTag(F, "flying-knee") ? 0.25 : 0.06) * knee, elbow: 0.12 * elbow },
        db: { bodykick: g("bodykick"), bodyhook: g("bodyhook"), bodystraight: g("bodystraight"), spinback: 0.25 * spin, knee: 0.2 * knee },
        dl: { calf: g("calf"), inside: g("inside") },
        ch: { short: 0.45, elbow: (0.22 + 1.4 * elbow) * tagElbow, kneehead: (0.2 + 1.2 * knee) * tagKnee },
        cb: { knee: (0.55 + 1.4 * knee) * tagKnee, shortbody: 0.45 },
        cl: { knee: 1 },
        gt: { gnp: 0.76, gnpelbow: (0.2 + 0.8 * elbow) * tagElbow * (hasTag(F, "ground-and-pound") ? 1.2 : 1) },
        gb: { upelbow: 1 }
      };
      if (sumKeys(W.db, ["bodykick", "bodyhook", "bodystraight"]) <= 0) W.db = { bodykick: 0.38, bodyhook: 0.34, bodystraight: 0.28 };
      if (W.dl.calf + W.dl.inside <= 0) W.dl = { calf: 0.58, inside: 0.42 };
      W.source = "scouting";
    } else {
      var k = Math.pow(S.kick * S.divKick, 0.7), v = S.vol, p = S.pow, ape = S.ape;
      W = {
        dh: { jab: 0.28 * v * ape, cross: 0.24, hook: 0.18 * Math.sqrt(p), overhand: 0.1 * p / ape, upper: 0.1 * Math.sqrt(p), headkick: 0.035 * k,
          spinfist: hasTag(F, "spinning") ? 0.01 : 0, wheel: hasTag(F, "spinning") ? 0.005 : 0, flyknee: hasTag(F, "flying-knee") ? 0.02 : 0.002, elbow: 0.004 },
        db: { bodykick: 0.38 * k, bodyhook: 0.34, bodystraight: 0.28 * ape, spinback: hasTag(F, "spinning") ? 0.03 : 0, knee: 0.03 * S.clinchK },
        dl: { calf: 0.58, inside: 0.42 },
        ch: { short: 0.45, elbow: 0.25 * tagElbow, kneehead: 0.25 * S.clinchK * tagKnee },
        cb: { knee: 0.6 * S.clinchK * tagKnee, shortbody: 0.4 },
        cl: { knee: 1 },
        gt: { gnp: 0.76, gnpelbow: 0.24 * Math.sqrt(S.gnp) * tagElbow },
        gb: { upelbow: 1 }
      };
      if (hasTag(F, "jab")) W.dh.jab *= 1.4;
      if (hasTag(F, "head-kicks")) W.dh.headkick *= 1.6;
      if (hasTag(F, "calf-kicks")) W.dl.calf *= 1.5;
      if (hasTag(F, "power")) { W.dh.overhand *= 1.2; W.dh.hook *= 1.15; }
      if (hasTag(F, "dirty-boxing")) W.ch.short *= 1.5;
      W.source = S.known ? "profile" : "default";
    }
    // open stance (orthodox vs southpaw): the rear straight and the rear kick to the open side get easier
    var open = F.stance && opp.stance && F.stance !== "Switch" && opp.stance !== "Switch" && F.stance !== opp.stance;
    if (open) { W.dh.cross *= 1.12; W.db.bodykick *= 1.25; W.dl.inside *= 0.7; }
    // techniques the show can't draw become the closest one it can
    var groups = ["dh", "db", "dl", "ch", "cb", "cl", "gt", "gb"];
    for (var gi = 0; gi < groups.length; gi++) {
      var grp = W[groups[gi]];
      for (var mv in grp) if (EXT[mv] && !SUP[mv]) { var fb = EXT[mv]; grp[fb] = (grp[fb] || 0) + grp[mv]; delete grp[mv]; }
    }
    return W;
  }
  function sumKeys(o, keys) { var s = 0; for (var i = 0; i < keys.length; i++) s += Math.max(0, num(o[keys[i]], 0)); return s; }

  // ------------------------------------------------------------------ takedown technique names
  function tdTechs(F, fromClinch, counter) {
    var dbl = hasTag(F, "double-leg") ? 1.8 : 1, sgl = hasTag(F, "single-leg") ? 1.8 : 1;
    var trips = hasTag(F, "trips") ? 2 : (/muay thai|judo|grappler/.test(F.archetype || "") ? 1.3 : 1);
    var wr = /wrestl/.test(F.archetype || "") ? 1.4 : clip(F.style.wrest, 0.7, 1.5);
    if (!fromClinch) return { "double-leg": 0.42 * dbl * wr, "single-leg": 0.34 * sgl, "blast double": 0.08 * wr * dbl, "low single": 0.07 * sgl,
      "ankle pick": 0.03, "reactive double-leg": counter ? 0.5 * dbl : 0 };
    return { "body-lock takedown": 0.3 * (hasTag(F, "cage-wrestling") ? 1.3 : 1), "single-leg against the fence": 0.22 * sgl, "double-leg against the fence": 0.13 * dbl,
      "outside trip": 0.14 * trips, "inside trip": 0.09 * trips, "hip toss": 0.03 * trips, "foot sweep": 0.04 * trips };
  }

  // ------------------------------------------------------------------ engine stats from the event stream
  var STAT_KEYS = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd",
    "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev", "pass", "up", "hurt"];
  var NK = STAT_KEYS.length, SI = {};
  for (var si = 0; si < NK; si++) SI[STAT_KEYS[si]] = si;
  var TGT_ATT = [SI.h_att, SI.b_att, SI.l_att], LOC_ATT = { dist: SI.d_att, clinch: SI.c_att, ground: SI.g_att };
  function applyEvent(v, e) {
    var o = e.w === "B" ? NK : 0;
    switch (e.k) {
      case "miss": case "hit": case "hurt": case "kd": case "fin":
        var land = e.k !== "miss", ta = TGT_ATT[e.tg != null ? e.tg : 0], la = LOC_ATT[e.loc] != null ? LOC_ATT[e.loc] : SI.d_att;
        v[o + SI.sig_att]++; v[o + ta]++; v[o + la]++;
        if (land) { v[o + SI.sig_lnd]++; v[o + ta + 1]++; v[o + la + 1]++; }
        if (e.k === "kd" || (e.k === "fin" && e.how === "KO")) v[o + SI.kd]++;
        if (e.k === "hurt") v[o + SI.hurt]++;
        break;
      case "td": v[o + SI.td_att]++; v[o + SI.td_lnd]++; break;
      case "tdx": v[o + SI.td_att]++; break;
      case "sub": case "subx": v[o + SI.sub_att]++; break;
      case "sweep": v[o + SI.rev]++; break;
      case "pass": v[o + SI.pass]++; break;
      case "up": v[o + SI.up]++; break;
    }
  }
  function statsObj(v) {
    var A = {}, B = {};
    for (var k = 0; k < NK; k++) { A[STAT_KEYS[k]] = v[k]; B[STAT_KEYS[k]] = v[NK + k]; }
    A.ctrl = Math.round(A.ctrl * 10) / 10; B.ctrl = Math.round(B.ctrl * 10) / 10;
    return { A: A, B: B };
  }

  // state machine over one round's events: who controls, where, and the position timeline
  function controllerOf(s, ctl) { return s === 1 ? ctl : (s === 2 ? "A" : (s === 3 ? "B" : null)); }

  // ------------------------------------------------------------------ text pools
  // tokens: {a} {A} attacker short / full, {d} {D} defender, {a_s} {d_s} possessives, {he} {him} {his} {hes} attacker
  // pronouns, {dhe} {dhim} {dhis} {dhes} defender pronouns, {move} {amove} technique, {pos}, {posfrom}, {sub} {asub},
  // {tech} {atech}, {n} ordinal, {N} {M} numbers, {clock}
  var T = {
    kd: ["Down goes {d}! A {move} from {a} puts {dhim} on the canvas.", "{a} drops {d} with a {move}!", "Knockdown! {a_s} {move} sends {d} to the mat.",
      "{d} is down! {a} landed that {move} flush.", "A {move} from {a}, and {d} hits the floor!", "Huge {move} from {a}. {d} goes down hard.",
      "{a} times the {move} perfectly, and {d} drops.", "{a} cracks {d} with a {move}, and {d} is down!", "Flush {move}! {d} crumples to the canvas.",
      "That {move} from {a} floors {d}!"],
    kdCounter: ["Counter {move}! {a} catches {d} coming in and drops {dhim}.", "{d} gets caught on the way in. A counter {move} from {a} drops {dhim}!",
      "{a} counters with a {move} and {d} goes down!"],
    kdBody: ["{a} folds {d} with a {move}! {d} goes down.", "A {move} drops {d}! {d} is curled up on the mat.", "{d} crumples from a {move} to the body!",
      "Body shot knockdown! {a_s} {move} puts {d} down."],
    kdClinch: ["{a} drops {d} with a {move} on the inside!", "Knockdown in the clinch! A {move} from {a} sends {d} down.", "{a} breaks off with a {move}, and {d} falls!"],
    waveUp: ["{a} waves {dhim} back up.", "{a} doesn't follow; {d} gets back up.", "{a} lets {dhim} back to {dhis} feet.", "{a} backs off and lets {d} up."],
    hurt: ["{a} wobbles {d} with a {move}!", "{d} is hurt! Big {move} from {a}.", "A {move} from {a} buckles {d_s} knees.", "{d_s} legs dip after a {move} from {a}.",
      "{a} rocks {d} with a {move}.", "That {move} hurt {d}. {a} senses it.", "{d} stumbles back off a {move} from {a}.", "Big {move} lands for {a}. {d} is shaken.",
      "{d} is in trouble after a {move} from {a}!", "{a} stuns {d} with a {move}."],
    hurtCounter: ["{a} counters with a {move} and {d} is wobbled!", "Counter {move} from {a}! {d} is hurt."],
    finKO: ["IT'S ALL OVER! {A_s} {move} knocks {D} out cold.", "Lights out! {a} lands the {move} and {d} is out before hitting the floor.",
      "{A} flattens {D} with a {move}! The referee waves it off.", "What a {move} from {a}! {d} is out, and it's over.", "{a} lands the {move} and {d} is out. It's over!"],
    finKOBody: ["{d} folds to {amove} and can't get up. It's over!", "{amove} ends it! {d} is down and done.", "{a} goes to the body with {amove}, and {d} can't beat the count. It's over!"],
    finTKO: ["{a} swarms with punches and the referee steps in!", "{a} unloads, {d} covers up, and the referee waves it off!",
      "{a} finishes the job with a {move}. The referee has seen enough.", "{d} is out on {dhis} feet. The referee stops it after a {move} from {a}.",
      "{a} pours it on and the referee jumps in to save {d}!"],
    finTKOClinch: ["{a} unloads {moves} in the clinch and the referee steps in!", "{d} wilts under {moves} from {a}, and it's stopped!"],
    finFollow: ["{a} pours on the hammerfists and the referee dives in!", "{d} can't recover. {a} finishes it with ground strikes.",
      "{a} follows up on the ground, and it's stopped!", "The referee pulls {a} off. {d} never recovered from the knockdown."],
    finGNP: ["{a} rains down {moves} {posfrom}, and the referee stops it!", "Ground and pound {posfrom}! {d} stops defending, and it's over.",
      "{a} postures up and lands {moves} {posfrom}. The referee waves it off!", "{d} can't escape. {a_s} {moves} end it {posfrom}."],
    finLEG: ["{d_s} leg gives out! The {moves} have finished it.", "{d} can't stand on that leg. The referee waves it off.",
      "One more {move}, and {d} collapses. It's stopped!"],
    sub: ["{d} taps! {a} finishes the {sub} {posfrom}.", "{a} locks up the {sub}, and {d} has to tap!", "It's over! {d} taps to {asub} from {a}.",
      "{a} sinks in the {sub} and gets the tap."],
    subStand: ["{a} catches {d_s} neck on the shot. {d} taps to the {sub}!", "Guillotine! {a} snatches it as {d} shoots, and {d} taps!"],
    subBottom: ["{a} catches {asub} off {his} back. {d} taps!", "{a} locks up the {sub} from the bottom, and {d} has to tap!"],
    subx: ["{a} hunts {asub} {posfrom}. {d} fights it off.", "{a} attacks with {asub}, but {d} defends.", "Big {sub} attempt from {a}! {d} survives.",
      "{a} looks for the {sub}. {d} hand-fights free.", "{d} escapes a tight {sub} from {a}.", "{a} threatens {asub}. {d} stays calm and gets out.",
      "{a} goes for {asub} {posfrom}. {d} slips out."],
    subxStand: ["{a} snatches a guillotine as {d} shoots. {d} pops {dhis} head out.", "{a} wraps up the neck on the shot. {d} escapes the {sub}."],
    subxBottom: ["{a} throws up {asub} off {his} back. {d} postures out.", "{a} attacks {asub} from the bottom. {d} defends.",
      "{a} threatens {asub} from guard. {d} pulls free."],
    td: ["{a} changes levels and finishes {atech}, landing {posin}.", "Takedown, {a}! {Atech} puts {d} on {dhis} back.",
      "{a} shoots {atech} and drags {d} down.", "{a} hits {atech}. {Hes} {posin}.", "{a} gets {d} down with {atech}.", "{a} times {atech} and takes {d} down.",
      "{Atech} from {a}, and {d} goes down."],
    tdClinch: ["{a} hits {atech} from the clinch. {d} is on {dhis} back.", "{a} drags {d} off the fence with {atech}.", "{Atech} from {a} in the clinch, and {d} goes down.",
      "{a} finishes {atech}."],
    tdLate: ["{a} sneaks in {atech} with {clock} left in the round."],
    tdxCount: ["{d} stops another shot. {a} is {N} for {M} on takedowns.", "Another takedown stuffed. {a} is {N} for {M}.", "{d} denies {a} again: {N} for {M} on takedowns."],
    tdx: ["{d} stuffs the {tech}.", "{a} shoots {atech}. {d} sprawls and stays up.", "{d} reads the level change and sprawls.", "{a} goes for {atech}, but {d} defends.",
      "{d} shakes off the {tech}.", "{d} defends the {tech} and circles off.", "Good takedown defense from {d}.", "{a} can't finish the {tech}.",
      "{d} sprawls on the {tech}.", "{d} keeps {dhis} feet on the {tech}."],
    passHalf: ["{a} passes to half guard.", "{a} works into half guard.", "{a} clears a leg. Half guard now.", "{a} gets past the guard to half."],
    passSide: ["{a} passes to side control.", "{a} slices through to side control.", "{a} clears the legs and settles in side control.", "{a} moves to side control."],
    passMount: ["{a} climbs to full mount!", "{a} takes the mount!", "Mount for {a}. {d} is in trouble.", "{a} slides a knee across and mounts {d}."],
    passBack: ["{a} takes the back!", "{a} takes {d_s} back and gets the hooks in.", "{d} gives up the back to {a}.", "{a} gets to the back. Danger for {d}."],
    passBackScramble: ["{a} takes the back in a scramble!", "{d} tries to get up and {a} takes the back!"],
    escGuard: ["{a} recovers full guard.", "{a} gets {his} guard back.", "Good hips from {a}. Back to guard.", "{a} replaces guard."],
    escHalf: ["{a} recovers half guard.", "{a} gets a leg back in. Half guard.", "{a} works back to half guard."],
    escMount: ["{a} bridges out of the mount to half guard.", "{a} escapes the mount.", "{a} shrimps out from under the mount."],
    escBack: ["{a} turns in and gets out from under the back.", "{a} shakes off the back and turns in.", "{a} escapes the back."],
    sweep: ["Sweep! {a} reverses {d} and comes up on top.", "{a} sweeps {posbot}. {Hes} on top now.", "{a} rolls through and ends up on top {posin}.",
      "Reversal for {a}!", "{a} scrambles out and takes top position.", "{a} hits a sweep and lands on top."],
    up: ["{a} wall-walks back to {his} feet.", "{a} gets back up.", "{a} scrambles up. We're standing again.", "{a} stands up and breaks away.",
      "{a} uses the cage to get up.", "Good get-up from {a}.", "{a} explodes up to {his} feet.", "{a} creates space and stands.", "{a} works back to {his} feet."],
    upClinch: ["{a} gets up, but {d} keeps {him} pinned on the fence.", "{a} stands into a clinch. {d} keeps hold.", "{a} works back up; {d} stays on {him} against the cage."],
    reset: ["The referee stands them up.", "Not enough action. The referee brings them back to the feet.", "Referee's restart. Back on the feet."],
    clinch: ["{a} ties {d} up against the fence.", "They clinch up along the cage.", "{a} grabs a collar tie.", "{a} clinches and pushes {d} to the fence.",
      "{a} locks up an underhook and pins {d} on the cage.", "{a} closes the distance and clinches.", "{a} wraps {d} up after the exchange.", "Into the clinch. {a} has the better position."],
    clinchSwap: ["{a} reverses the position on the fence.", "{a} spins {d} onto the cage.", "{a} turns {d}, and now {hes} the one pressing."],
    clinchTdx: ["{a} stays on {d} and settles for the clinch.", "{a} keeps hold after the shot and pins {d} on the fence."],
    brk: ["They separate.", "{a} breaks free.", "{a} frames off and gets out.", "Back to the center.", "{a} pushes off the fence."],
    pounce: ["{a} jumps on top of {d}!", "{a} pounces and looks to finish.", "{a} follows {d} to the mat.", "{a} dives in after {d}."],
    recoverUp: ["{a} survives! {Hes} back on {his} feet.", "{a} recovers and stands up.", "{a} clears the cobwebs and gets up.", "{a} weathers the storm and gets back up."],
    recoverGuard: ["{a} recovers to guard and ties {d} up.", "{a} survives the flurry and gets {his} legs back in front.", "{a} weathers it and gets to guard."],
    combo: ["{a} lands {aseq}.", "Crisp work from {a}: {aseq}.", "{a} puts together {aseq}.", "{a} strings together {aseq}. All of it lands."],
    counter: ["{a} counters with {amove}.", "{d} misses and eats a counter {move}.", "{a} makes {d} pay with {amove}.", "{a} slips and comes back with {amove}."],
    headkick: ["{a} lands {amove}!", "{a} finds the mark with {amove}.", "{amove} from {a} lands clean!", "{d} eats {amove} from {a}."],
    specialLand: ["{amove} from {a} lands!", "{a} lands {amove}! What a shot.", "{a} connects with {amove}."],
    bigMiss: ["{a} misses with a big {move}.", "{d} slips a big {move} from {a}.", "{a} swings and misses with the {move}.", "{d} makes {a} miss with the {move}."],
    bigMissKick: ["{d} leans away from {a_s} {move}.", "{a} whiffs on the {move}.", "{d} steps back from {amove}.", "{d} makes {a} miss with the {move}."],
    body: ["{a} digs {amove}.", "{a} goes to the body with {amove}.", "{a} sinks {amove}."],
    legN: ["{a} has landed {N} leg kicks.", "Leg kick number {N} for {a}.", "{N} leg kicks landed now for {a}.", "That's {N} kicks to the legs for {a}."],
    bodyN: ["{a} has landed {N} to the body.", "{N} body shots landed for {a}.", "{a} keeps investing downstairs: {N} to the body."],
    legHurt: ["{d} is feeling those leg kicks.", "{d_s} lead leg is starting to take damage.", "The leg kicks are adding up on {d}."],
    legBad: ["{d_s} lead leg is compromised.", "{d} is limping now.", "{d} can barely plant on that lead leg."],
    tired: ["{d} is breathing hard.", "{d_s} pace is dropping.", "{d} is slowing down."],
    damage: ["{d} has taken a lot of punishment.", "{d} is marked up.", "{d} is absorbing a lot of damage."]
  };
  var NOTES = {
    guard: ["{a} working from inside {d_s} guard.", "{d} is tying {a} up from guard.", "{a} has {ctrl} of control in the round, working from guard."],
    ground: ["{a} has {ctrl} of control in the round.", "{a} keeping {d} flat {posin}.", "{a} applying heavy pressure {posfrom}.",
      "{d} needs to get back up. {a} is controlling {posfrom}.", "{a} is grinding {posfrom}; {ctrl} of control so far this round."],
    back: ["{a} keeps {d_s} back; {ctrl} of control in the round.", "{a} still on {d_s} back. {d} is fighting the hands.", "{d} is stuck with {a} on {dhis} back."],
    clinch: ["{a} leaning on {d} against the fence.", "Grinding in the clinch. {a} has the better position.", "Hand-fighting along the fence. {a} is pressing.",
      "{a} keeps {d} pinned on the cage."],
    lull: ["Patient stretch at range.", "A lull. Both fighters resetting at range.", "Measured pace in the center of the cage.", "Not much committed in the last few exchanges."],
    busy: ["Busy exchanges in the center.", "Both fighters letting their hands go.", "Plenty of traffic at range."],
    dist: ["{a} {N}, {d} {M} in significant strikes landed this round.", "{a} has the edge so far this round, {N} landed to {M}.", "{a} is outlanding {d} {N} to {M} in this round."],
    even: ["Close round on the stat sheet: {N} landed apiece.", "Even on the strike count so far, {N} each.", "Nothing between them in landed strikes this round."]
  };

  // ------------------------------------------------------------------ voice: fills templates, never repeats a line in a fight
  function Voice(r) { this.r = r; this.used = {}; this.tu = {}; }
  Voice.prototype.fill = function (tpl, c) {
    var s = tpl.replace(/\{(\w+)\}/g, function (m0, k) { var v = c[k]; return v == null ? m0 : String(v); });
    if (s.indexOf("{") >= 0) return null;
    return capSent(s);
  };
  Voice.prototype.take = function (s) { if (!s || this.used[s]) return null; this.used[s] = 1; return s; };
  // pools: template list (or list of lists, tried in order); c.variants: alternative values for {move}
  Voice.prototype.say = function (pool, c, fallback) {
    var r = this.r, n = pool.length, order = shuffled(n, r), vars = c._mv || null, tu = this.tu;
    order.sort(function (x, y) { return (tu[pool[x]] || 0) - (tu[pool[y]] || 0); });   // stable: random among the least used
    for (var pass = 0; pass < (vars ? Math.min(3, vars.length) : 1); pass++) {
      for (var i = 0; i < n; i++) {
        if (vars) setMove(c, vars[(pass + Math.floor(r() * vars.length)) % vars.length]);
        var s = this.take(this.fill(pool[order[i]], c));
        if (s) { tu[pool[order[i]]] = (tu[pool[order[i]]] || 0) + 1; return s; }
      }
    }
    if (fallback) for (var j = 0; j < fallback.length; j++) { var f = this.take(this.fill(fallback[j], c)); if (f) return f; }
    return null;
  };
  function setMove(c, mv) { c.move = mv; c.amove = article(mv); c.Amove = article(mv); }

  // ------------------------------------------------------------------ fighter context
  function fighterCtx(side, fight, opts) {
    var of = (opts.fighters && opts.fighters[side]) || {};
    var m = opts.matchup || null, mi = (m && m[side]) || {};
    var prof = (opts.profiles && opts.profiles[side]) || null;
    var sc = (opts.scouting && opts.scouting[side]) || null;
    function f(k) { return of[k] != null ? of[k] : (mi[k] != null ? mi[k] : (prof && prof[k] != null ? prof[k] : null)); }
    var F = { side: side, out: {} };
    for (var k in of) F.out[k] = of[k];
    F.name = f("name") || (side === "A" ? "Blue corner" : "Red corner");
    F.short = of.short || (f("name") ? shortName(F.name) : (side === "A" ? "Blue" : "Red"));
    F.slug = f("slug");
    F.nick = f("nick");
    F.division = f("division");
    F.fightDivision = (m && m.division) || opts.division || null;
    F.stance = normStance(f("stance") || (sc && sc.style && sc.style.stance));
    F.sided = F.stance === "Orthodox" || F.stance === "Southpaw";
    F.lead = F.stance === "Southpaw" ? "right" : "left";
    F.rear = F.stance === "Southpaw" ? "left" : "right";
    F.height_in = f("height_in"); F.reach_in = f("reach_in");
    F.record = f("record");
    F.kd_absorbed = of.kd_absorbed != null ? of.kd_absorbed : (prof && prof.kd_absorbed != null ? prof.kd_absorbed : null);
    F.profile = prof;
    F.p = pronounsFor(of.pronouns || of.pronoun || (prof && prof.pronouns), F.division, F.fightDivision);
    var fsc = F.slug && root.FightScouting && root.FightScouting[F.slug] || null;
    F.tags = (sc && sc.style && sc.style.tags) || of.tags || (fsc && (fsc.tags || (fsc.style && fsc.style.tags))) || [];
    F.archetype = (sc && sc.style && sc.style.archetype) || of.archetype || (fsc && (fsc.archetype || (fsc.style && fsc.style.archetype))) || null;
    F.scoutMoves = (opts.moves && opts.moves[side]) || (sc && sc.moves) || null;
    F.style = styleOf(F, side, opts);
    return F;
  }

  // ------------------------------------------------------------------ build
  var POWER_BASE = { jab: 0.3, cross: 0.55, hook: 0.6, overhand: 0.65, upper: 0.55, headkick: 0.8, bodykick: 0.6, bodyhook: 0.5, bodystraight: 0.4, calf: 0.5,
    inside: 0.4, short: 0.35, elbow: 0.5, kneehead: 0.65, knee: 0.5, shortbody: 0.35, gnp: 0.45, gnpelbow: 0.55, upelbow: 0.3, spinfist: 0.7, spinback: 0.8,
    wheel: 0.85, flyknee: 0.85 };
  var STRIKE_K = { miss: 1, hit: 1, hurt: 1, kd: 1, fin: 1 };
  var POS_EVENT = { pass: 1, esc: 1, sweep: 1, td: 1, recover: 1, up: 1, reset: 1, kd: 1 };
  var METHOD_LONG = { KO: "knockout", TKO: "TKO", GNP: "TKO (ground strikes)", LEG: "TKO (leg kicks)", CORNER: "TKO (corner stoppage)",
    DOC: "TKO (doctor's stoppage)", UD: "unanimous decision", SD: "split decision", MD: "majority decision" };
  var KO_LIKE = { KO: 1, TKO: 1, GNP: 1, LEG: 1, CORNER: 1, DOC: 1 };

  function divText(d) {
    if (!d) return null;
    if (d === "Catch Weight") return "a catchweight";
    if (d === "Open Weight") return "openweight";
    return d.toLowerCase().replace("women's ", "women's ");
  }
  function recText(rec) { if (!rec || rec.w == null) return null; return rec.w + "-" + rec.l + (rec.d ? "-" + rec.d : ""); }
  function introLine(F, nR, division, title) {
    var a = F.A, b = F.B, dv = divText(division), rw = nR ? NUMW[nR] + "-round " : "";
    var s = a.name + " vs " + b.name;
    if (nR || title) s += ", " + article(rw + (title ? "title fight" : "fight")) + (dv ? " at " + dv : "") + ".";
    else s += dv ? " at " + dv + "." : ".";
    var ra = recText(a.record), rb = recText(b.record);
    if (ra && rb) s += " UFC records: " + a.short + " " + ra + ", " + b.short + " " + rb + ".";
    s += " " + a.short + " in the blue corner, " + b.short + " in the red.";
    return capSent(s);
  }
  function judgeTally(js) {
    var o = { A: 0, B: 0, e: 0, a8: 0, b8: 0 };
    if (!js) return o;
    for (var j = 0; j < js.length; j++) {
      var c = js[j];
      if (c[0] > c[1]) { o.A++; if (c[0] - c[1] >= 2) o.a8++; }
      else if (c[1] > c[0]) { o.B++; if (c[1] - c[0] >= 2) o.b8++; }
      else o.e++;
    }
    return o;
  }

  function parseDetail(d) {
    var m = /^(Punch|Punches|Kick|Kicks|Knee|Knees|Elbow|Elbows) to (Head|Body|Leg)/.exec(d || "");
    if (!m) return null;
    var tool = m[1].toLowerCase().replace(/e?s$/, "");
    if (tool === "punche") tool = "punch";
    return { tool: tool, plural: /s$/.test(m[1]), tgt: { Head: 0, Body: 1, Leg: 2 }[m[2]] };
  }
  var CANON = { "kick0": "headkick", "kick1": "bodykick", "kick2": "calf", "punch0": "cross", "punch1": "bodyhook", "knee0": "kneehead", "knee1": "knee",
    "knee2": "knee", "elbow0": "elbow", "elbow1": "elbow", "punch0c": "short", "punch1c": "shortbody" };

  function build(fight, seed, opts) {
    if (!fight || !fight.rounds) throw new Error("FightDirector.build: needs a traced fight (FightEngine.simulate(m, rng, true))");
    opts = opts || {};
    seed = seed == null ? 1 : seed;
    var r = mulberry((seed ^ 0x5bd1e995) >>> 0);
    var voice = new Voice(r);
    var SUP = detectShowMoves(opts);
    var cfg = { cap: 4, iso: 0.55, clinch: 0.6, ground: 0.35, down: 0.5 };
    if (opts.thin) for (var tk in opts.thin) cfg[tk] = opts.thin[tk];
    // scouting moves inlined by the page (window.FightScouting[slug].moves), if the build carries them
    var FSc = root.FightScouting;
    if (FSc && !opts.moves) {
      var mv = {};
      ["A", "B"].forEach(function (w) {
        var sl = (opts.fighters && opts.fighters[w] && opts.fighters[w].slug) || (opts.matchup && opts.matchup[w] && opts.matchup[w].slug);
        if (sl && FSc[sl] && FSc[sl].moves) mv[w] = FSc[sl].moves;
      });
      if (mv.A || mv.B) { opts = copy(opts); opts.moves = mv; }
    }
    var F = { A: fighterCtx("A", fight, opts), B: fighterCtx("B", fight, opts) };
    if (F.A.short === F.B.short) { F.A.short = F.A.name; F.B.short = F.B.name; }
    if (F.A.name === F.B.name) { F.A.short = F.A.name + " (blue)"; F.B.short = F.B.name + " (red)"; F.A.name = F.A.short; F.B.name = F.B.short; }
    F.A.liverKick = F.A.stance === "Southpaw" && F.B.stance === "Orthodox";
    F.B.liverKick = F.B.stance === "Southpaw" && F.A.stance === "Orthodox";
    F.A.W = buildMoves(F.A, F.B, opts, SUP); F.B.W = buildMoves(F.B, F.A, opts, SUP);
    F.A._u = F.B._u = r;
    var m = opts.matchup || null;
    var isDec = /^(UD|SD|MD|DRAW)$/.test(fight.method || "");
    var nR = opts.rounds || (m && m.rounds) || (isDec ? fight.rounds.length : null);
    var title = opts.title != null ? !!opts.title : !!(m && m.title);
    var division = (m && m.division) || opts.division || F.A.division || null;
    var pf = powerFactors(fight, m);

    var script = { version: 3, director: VERSION, seed: seed, winner: fight.winner, method: fight.method, detail: fight.detail || "", round: fight.round, t: fight.t,
      cards: fight.cards, form: fight.form, fin: fight.fin || null, totals: fight.totals || null, nRounds: nR, title: title, division: division,
      fighters: {}, names: { A: F.A.name, B: F.B.name }, short: { A: F.A.short, B: F.B.short }, moves: { A: F.A.W, B: F.B.W },
      rounds: [], lines: [], intro: null, result: null, decision: null };
    ["A", "B"].forEach(function (w) {
      var o = copy(F[w].out);
      o.name = F[w].name; o.short = F[w].short; o.slug = F[w].slug; o.nick = F[w].nick; o.division = F[w].division;
      o.stance = F[w].stance || o.stance || null; o.height_in = F[w].height_in; o.reach_in = F[w].reach_in;
      o.pronouns = F[w].p.key; o.power = +pf[w].toFixed(3); o.corner = w === "A" ? "blue" : "red";
      script.fighters[w] = o;
    });

    function ctx(w) {
      var a = F[w || "A"], d = F[other(w || "A")];
      return { a: a.short, A: a.name, d: d.short, D: d.name, a_s: poss(a.short), d_s: poss(d.short), A_s: poss(a.name), D_s: poss(d.name),
        he: a.p.he, him: a.p.him, his: a.p.his, hes: a.p.hes, He: cap1(a.p.he), His: cap1(a.p.his), Hes: cap1(a.p.hes),
        dhe: d.p.he, dhim: d.p.him, dhis: d.p.his, dhes: d.p.hes };
    }
    function addLine(rIdx, t, txt, k, who, big) { if (txt) script.lines.push({ r: rIdx, t: t, txt: txt, k: k, who: who || null, big: !!big }); }

    // fight-level counters
    function pair() { return { A: 0, B: 0 }; }
    var fc = { td: pair(), tda: pair(), kd: pair(), down: pair(), pass: pair(), esc: pair(), up: pair(), sub: pair(), hurt: pair(), leg: pair(), body: pair(),
      pounce: pair(), sweep: pair(), reset: 0, said: {} };
    var cum = []; for (var c0 = 0; c0 < 2 * NK; c0++) cum.push(0);

    script.intro = voice.take(introLine(F, nR, division, title));

    for (var ri = 0; ri < fight.rounds.length; ri++) {
      var rd = fight.rounds[ri], ev = rd.ev || [];
      var endT = roundEnd(rd);
      var base = cum.slice();
      var R = processRound(ri, rd, ev, endT, base);
      script.rounds.push(R);
    }

    // ---- result, decision
    var last = script.rounds[script.rounds.length - 1];
    var W = fight.winner, Lw = W === "A" || W === "B" ? other(W) : null;
    if (isDec) {
      script.decision = decisionText(fight, F, voice);
      script.result = voice.take(W === "D" ? capSent(F.A.name + " and " + F.B.name + " fight to a " + ({ DRAW: "" }[fight.method] || "") + "draw.") :
        capSent(F[W].name + " def. " + F[Lw].name + " by " + METHOD_LONG[fight.method] + " (" + cardsText(fight.cards, W) + ")."));
      addLine(last.r, 300, script.decision.text, "decision", W === "D" ? null : W, true);
    } else if (W === "A" || W === "B") {
      var how = fight.method === "SUB" ? "submission (" + subName(fight.fin && (fight.fin.name || fight.fin.detail)) + ")" : (METHOD_LONG[fight.method] || fight.method);
      var when = fight.method === "CORNER" || fight.method === "DOC" ? "after round " + fight.round : "at " + mmss(fight.t) + " of round " + fight.round;
      script.result = voice.take(capSent(F[W].name + " def. " + F[Lw].name + " by " + how + ", " + when + "."));
    }
    return script;

    // ================================================================ one round
    function processRound(ri, rd, ev, endT, base) {
      var i, e, b;
      // ---- pass 1: engine stats, state, timeline
      var s = 0, ctl = null, pos = null, downed = null, tPrev = 0;
      var timeline = [], segStart = 0, segKey = "0|null|null", segS = 0, segCtl = null, segPos = null;
      var cumT = [], cumV = [], info = [];
      for (i = 0; i < ev.length; i++) {
        e = ev[i];
        var te = Math.min(e.t, endT);
        var cw = controllerOf(s, ctl);
        if (cw) cum[(cw === "B" ? NK : 0) + SI.ctrl] += Math.max(0, te - tPrev);
        tPrev = Math.max(tPrev, te);
        var before = { s: s, ctl: ctl, pos: pos, downed: downed };
        applyEvent(cum, e);
        var sNew = e.k === "kd" ? (e.to != null ? e.to : inferKdTo(ev, i, s)) : (e.s != null ? e.s : s);
        if (sNew === 1) { if (e.k === "clinch") ctl = e.w; else if (e.k === "up") ctl = other(e.w); else if (s !== 1 || !ctl) ctl = ctl || e.w || null; }
        else ctl = null;
        if (sNew >= 2) {
          if (e.k === "kd") { downed = other(e.w); pos = "down"; }
          else if (e.k === "recover") { downed = null; pos = e.pos && e.pos !== "down" ? e.pos : "guard"; }
          else if (e.pos) pos = e.pos === "down" ? (downed ? "down" : pos || "guard") : e.pos;
          else if (!pos) pos = "guard";
          if (pos !== "down") downed = null;
        } else { pos = null; downed = null; }
        if (e.k === "subx" && sNew >= 2) {
          var nx = ev[i + 1];
          if (nx && nx.s === sNew && nx.pos && nx.pos !== "down" && nx.pos !== pos && !POS_EVENT[nx.k]) pos = nx.pos;
        } else if (sNew >= 2 && e.pos && e.pos !== "down" && e.pos !== pos && !POS_EVENT[e.k]) pos = e.pos;
        s = sNew;
        info.push({ before: before, s: s, ctl: ctl, pos: pos });
        cumT.push(e.t); cumV.push(cum.slice());
        var cwNew = controllerOf(s, ctl), key = s + "|" + cwNew + "|" + pos;
        if (key !== segKey) {
          if (te > segStart) timeline.push([segStart, +te.toFixed(2), segS, segCtl, segPos]);
          segStart = +te.toFixed(2); segKey = key; segS = s; segCtl = cwNew; segPos = pos;
        }
      }
      var cwEnd = controllerOf(s, ctl);
      if (cwEnd) cum[(cwEnd === "B" ? NK : 0) + SI.ctrl] += Math.max(0, endT - tPrev);
      if (endT > segStart || !timeline.length) timeline.push([segStart, endT, segS, segCtl, segPos]);

      // ---- pass 2: candidate beats from engine events
      var cand = [];
      for (i = 0; i < ev.length; i++) {
        e = ev[i]; var inf = info[i], w = e.w || null;
        b = { t: e.t, k: null, who: w, st: inf.s, pos: inf.pos, ctl: inf.s === 1 ? inf.ctl : null, i: i, ev: e };
        if (STRIKE_K[e.k]) {
          b.k = "strike"; b.st = e.s != null ? e.s : inf.before.s; b.pos = b.st >= 2 ? (e.pos || inf.before.pos || "guard") : null;
          b.ctl = b.st === 1 ? inf.before.ctl : null;
          b.tgt = e.tg != null ? e.tg : 0; b.loc = e.loc || (b.st === 0 ? "dist" : (b.st === 1 ? "clinch" : "ground"));
          b.landed = e.k !== "miss"; b.miss = e.k === "miss"; b.kd = e.k === "kd"; b.hurt = e.k === "hurt"; b.fin = e.k === "fin";
          if (b.fin) b.how = e.how || null;
          if (b.st >= 2) { b.top = (b.st === 2) === (w === "A"); b.down = b.pos === "down"; }
          if (b.kd) { b.to = inf.s; b.st = inf.before.s; b.ctl = b.st === 1 ? inf.before.ctl : null; b.pos = null; }
        } else if (e.k === "clinch") {
          b.k = "clinch"; b.st = 1; b.ctl = w;
          if (e.swap) b.swap = true;
          var pe = ev[i - 1];
          if (pe && pe.k === "tdx" && pe.w === w && Math.abs(pe.t - e.t) < 0.02) b.via = "tdx";
        } else if (e.k === "break") { b.k = "break"; b.st = 0; }
        else if (e.k === "td") { b.k = "td"; b.from = e.from != null ? (e.from === 1 ? 1 : 0) : (inf.before.s === 1 ? 1 : 0); b.pos = inf.pos; }
        else if (e.k === "tdx") { b.k = "tdx"; b.from = e.loc === "clinch" || inf.before.s === 1 ? 1 : 0; }
        else if (e.k === "pass") { b.k = "pass"; b.from = inf.before.pos; }
        else if (e.k === "esc") { b.k = "esc"; b.from = inf.before.pos; }
        else if (e.k === "sweep") { b.k = "sweep"; b.from = inf.before.pos; }
        else if (e.k === "up") { b.k = "up"; }
        else if (e.k === "sub" || e.k === "subx") {
          b.k = e.k; b.name = e.name || "Submission"; b.sub = subName(b.name); b.standing = inf.before.s < 2;
          b.pos = b.standing ? null : (e.pos || inf.before.pos); b.at = b.pos; b.bottom = !b.standing && ((inf.before.s === 2) !== (w === "A"));
          b.st = inf.before.s; b.ctl = b.st === 1 ? inf.before.ctl : null;
          if (e.k === "subx") { b.st = inf.s; b.pos = b.standing ? null : inf.pos; }
        } else if (e.k === "recover") { b.k = "recover"; }
        else if (e.k === "reset") {
          var pk = ev[i - 1];
          if (pk && pk.k === "kd" && Math.abs(pk.t - e.t) < 0.02) continue;   // the kd beat already carries to = 0
          b.k = "reset"; b.who = null; b.from = inf.before.s;
        } else continue;
        cand.push(b);
      }

      // ---- pass 3: thin misses (keep every landed strike; keep misses inside combinations with a landed strike)
      var runs = { A: { t: -99, id: -1, st: -1 }, B: { t: -99, id: -1, st: -1 } }, runLanded = {}, runId = 0;
      for (i = 0; i < cand.length; i++) {
        b = cand[i];
        if (b.k !== "strike") { runs.A.t = runs.B.t = -99; continue; }
        var ru = runs[b.who];
        if (b.t - ru.t >= 1.6 || ru.st !== b.st) { ru.id = ++runId; ru.st = b.st; }
        ru.t = b.t; b._run = ru.id;
        if (b.landed) runLanded[ru.id] = true;
      }
      var keep = [];
      for (i = 0; i < cand.length; i++) {
        b = cand[i];
        if (b.k !== "strike" || b.landed) { keep.push(b); continue; }
        var p = b.down ? cfg.down : (b.st >= 2 ? cfg.ground : (runLanded[b._run] ? 1 : (b.st === 1 ? cfg.clinch : cfg.iso)));
        if (r() >= p) continue;
        var n10 = 0;
        for (var j = 0; j < cand.length; j++) {
          var o = cand[j];
          if (o.k === "strike" && o.who === b.who && Math.abs(o.t - b.t) <= 5 && (o.landed || o._kept)) n10++;
        }
        if (n10 >= cfg.cap) continue;
        b._kept = true; keep.push(b);
      }

      // ---- pass 4: combinations (same man, same position, <1.6 s apart, no transition in between)
      var lastS = { A: null, B: null }, comboN = 0;
      for (i = 0; i < keep.length; i++) {
        b = keep[i];
        if (b.k !== "strike") { lastS.A = lastS.B = null; continue; }
        var ls = lastS[b.who];
        if (ls && b.t - ls.t < 1.6 && ls.st === b.st && !ls.kd && !b.down) { b.chain = true; b.combo = ls.combo; b.ci = ls.ci + 1; }
        else { b.combo = ++comboN; b.ci = 0; }
        if (b.kd) { lastS.A = lastS.B = null; } else lastS[b.who] = b;
      }

      // ---- pass 5: techniques
      var prevMove = {}, lastStrikeT = { A: -99, B: -99 }, lastStrikeMiss = { A: false, B: false };
      var finDetail = rd.fin && fight.fin ? parseDetail(fight.fin.detail) : null;
      for (i = 0; i < keep.length; i++) {
        b = keep[i];
        if (b.k !== "strike") continue;
        var opp = other(b.who);
        b.counter = b.st === 0 && b.t - lastStrikeT[opp] < 0.8 && b.t - lastStrikeT[opp] >= 0 && lastStrikeMiss[opp];
        var tech = chooseTech(F[b.who], b, b.ci > 0 ? prevMove[b.combo] : null, b.fin ? finDetail : null);
        b.tech = tech; b.move = SUP[tech] || EXT[tech] || tech;
        b.side = SIDE_OF[tech] || null;
        var pw = POWER_BASE[tech] != null ? POWER_BASE[tech] : 0.5;
        pw *= clip(pf[b.who], 0.6, 1.5);
        if (b.kd || b.fin) pw = 1; else if (b.hurt) pw = Math.max(0.85, pw); else if (b.miss) pw *= 0.8;
        b.power = +clip(pw, 0.1, 1).toFixed(2);
        prevMove[b.combo] = tech;
        lastStrikeT[b.who] = b.t; lastStrikeMiss[b.who] = b.miss;
        delete b._run; delete b._kept;
      }

      // ---- pass 6: derived beats (pounce after a knockdown; clinch after a stand-up into the fence)
      var beats = [];
      for (i = 0; i < keep.length; i++) {
        b = keep[i]; beats.push(b);
        if (b.k === "strike" && b.kd && b.to >= 2) beats.push({ t: b.t, k: "pounce", who: b.who, st: b.to, pos: "down", ctl: null, i: -1, ev: b.ev });
        else if (b.k === "up" && b.st === 1) beats.push({ t: b.t, k: "clinch", who: other(b.who), st: 1, pos: null, ctl: other(b.who), via: "up", i: -1, ev: b.ev });
      }

      // ---- pass 7: play-by-play
      var rc = { td: pair(), kd: pair(), hurt: pair(), tdxSaid: pair(), color: 0, combo: 0, counter: 0, special: 0, miss: 0, body: 0, clinchSaid: false, lastTxtT: -99 };
      for (i = 0; i < beats.length; i++) {
        b = beats[i];
        b.txt = narrate(b, i, beats, rc, ri, endT) || undefined;
        if (b.txt) rc.lastTxtT = b.t;
        if (!b.txt) delete b.txt;
      }

      // ---- round intro note at 0:00 (round 1: the fight intro)
      var introTxt = ri === 0 ? script.intro : roundIntro(ri);
      if (introTxt) beats.unshift({ t: 0, k: "note", who: null, st: 0, pos: null, ctl: null, i: -1, txt: introTxt, intro: true });

      // ---- pass 8: notes in long quiet stretches of play-by-play
      addNotes(beats, timeline, base, cumT, cumV, endT, ev);

      // ---- pass 9: stats on every beat, priority
      for (i = 0; i < beats.length; i++) {
        b = beats[i];
        var v = b.i >= 0 ? cumV[b.i] : statsVecAt(cumT, cumV, base, timeline, b.t);
        b.stats = statsObj(v);
        b.pri = b.k === "note" ? 0 : (b.k === "strike" ? (b.kd || b.fin || b.hurt ? 2 : (b.miss ? 0 : 1)) : 2);
      }

      var R = { r: ri, beats: beats, endT: endT, judges: rd.judges || null, stoppage: rd.stoppage || null, fin: rd.fin || null, st: rd.st || null,
        dHA: rd.dHA, dHB: rd.dHB, dLA: rd.dLA, dLB: rd.dLB, SA: rd.SA, SB: rd.SB, endState: rd.endState || null,
        base: statsObj(base), end: statsObj(cum), timeline: timeline, density: density(beats, ev, endT, timeline),
        cum: { t: cumT, v: cumV, base: base }, intro: introTxt || null, outro: null };
      R.outro = roundOutro(R, ri);
      for (i = 0; i < beats.length; i++) if (beats[i].txt) addLine(ri, beats[i].t, beats[i].txt, beats[i].k, beats[i].who, beats[i].kd || beats[i].fin || beats[i].k === "sub");
      if (R.outro) addLine(ri, endT, R.outro, "outro", null, !!(rd.fin || rd.stoppage));
      return R;

      // ------------------------------------------------------------ narration for one beat
      function narrate(b, bi, beats, rc, ri, endT) {
        var w = b.who, d = w ? other(w) : null, c = ctx(w), k = b.k, e = b.ev, txt = null, Fa = w ? F[w] : null;
        var free = b.t - rc.lastTxtT >= 3.5;
        if (k === "strike") {
          var mvT = moveTexts(b.tech, Fa, b.tgt, b.pos);
          c._mv = mvT; setMove(c, mvT[0]);
          if (b.landed && b.loc === "dist" && b.tgt === 2) fc.leg[w]++;
          if (b.landed && b.tgt === 1 && b.loc !== "ground") fc.body[w]++;
          if (b.kd) {
            rc.kd[w]++; fc.kd[w]++; fc.down[d]++;
            var poolK = b.tgt === 1 ? T.kdBody : (b.st === 1 ? T.kdClinch : (b.counter ? T.kdCounter.concat(T.kd) : T.kd));
            c.N = fc.kd[w];
            txt = voice.say(poolK, c, ["Knockdown number {N} for {a}!", "{a} scores knockdown number {N}!"]);
            var extra = [];
            if (b.to === 0) { var wu = voice.say(T.waveUp, ctx(w)); if (wu) extra.push(wu); }
            if (fc.down[d] >= 2) {
              var c2 = ctx(w); c2.n = ordinal(fc.down[d]);
              extra.push(voice.say(["That's the {n} time {d} has been down in this fight.", "{d} is down for the {n} time tonight."], c2));
            } else if (F[d].kd_absorbed != null && !fc.said["kdc" + d]) {
              fc.said["kdc" + d] = true;
              var nk = +F[d].kd_absorbed, c3 = ctx(w); c3.N = nk === 1 ? "once" : (nk === 2 ? "twice" : numWord(nk) + " times");
              extra.push(voice.take(voice.fill(nk === 0 ? "It's the first knockdown of {d_s} UFC career." : "{d} had been knocked down {N} before in the UFC.", c3)));
            }
            txt = join(txt, extra);
          } else if (b.fin) {
            var how = b.how, pool, dt = finDetail;
            c.moves = plural(b.tech, dt);
            c.posfrom = POS_FROM[b.pos] || "on the ground";
            if (how === "KO") pool = b.tgt === 1 ? T.finKOBody : T.finKO;
            else if (how === "GNP") pool = T.finGNP;
            else if (how === "LEG") pool = T.finLEG;
            else if (b.down) pool = T.finFollow;
            else if (b.st === 1) pool = T.finTKOClinch;
            else pool = T.finTKO;
            txt = voice.say(pool, c, ["It's over! {a} finishes {d}."]);
          } else if (b.hurt) {
            rc.hurt[w]++; fc.hurt[w]++;
            c.n = ordinal(fc.hurt[w]);
            txt = voice.say(b.counter ? T.hurtCounter.concat(T.hurt) : T.hurt, c, ["{a} hurts {d} for the {n} time in this fight."]);
            txt = join(txt, [meter(b, w, d)]);
          } else if (b.landed && !b.down) {
            txt = free ? color(b, bi, beats, rc, c, w, d) : null;
          } else if (free && b.miss && !b.down && b.st < 2 && rc.miss < 1 && (b.tech === "overhand" || b.tech === "headkick" || b.tech === "wheel" || b.tech === "spinback" || b.tech === "spinfist" || b.tech === "flyknee") && r() < 0.15) {
            txt = voice.say(CLASS[b.tech] === "kick" || CLASS[b.tech] === "knee" ? T.bigMissKick : T.bigMiss, c); if (txt) rc.miss++;
          }
        } else if (k === "clinch" && !free) {
          txt = null;
        } else if (k === "clinch") {
          if (b.via === "tdx") txt = r() < 0.7 ? voice.say(T.clinchTdx, c) : null;
          else if (b.via === "up") txt = null;
          else if (b.swap) txt = r() < 0.6 ? voice.say(T.clinchSwap, c) : null;
          else if (!rc.clinchSaid ? r() < 0.9 : r() < 0.3) txt = voice.say(T.clinch, c);
          if (txt) rc.clinchSaid = true;
        } else if (k === "break") {
          if (free && r() < 0.2) txt = voice.say(T.brk, c);
        } else if (k === "td") {
          rc.td[w]++; fc.td[w]++; fc.tda[w]++;
          var counterTd = lastOppStrike(beats, bi, w, 1.5);
          var tech = pickW(tdTechs(Fa, b.from === 1, counterTd), r()) || "double-leg";
          b.tech = tech;
          c.tech = tech; c.atech = article(tech); c.Atech = cap1(article(tech)); c.posin = posIn(b.pos, F[d].short); c.clock = mmss(endT - b.t);
          c.n = ordinal(fc.td[w]);
          var poolT = b.from === 1 ? T.tdClinch : T.td;
          if (b.t > 280 && endT >= 300) poolT = T.tdLate.concat(poolT);
          txt = voice.say(poolT, c, ["{a} lands {his} {n} takedown of the fight."]);
          if (rc.td[w] >= 2 && r() < 0.85) { var cr = ctx(w); cr.n = ordinal(rc.td[w]); cr.r = ri + 1; txt = join(txt, [voice.say(["That's {his} {n} takedown of the round.", "{n} takedown of round {r} for {a}."], cr)]); }
          else if (fc.td[w] >= 3 && r() < 0.6) { var cf = ctx(w); cf.N = numWord(fc.td[w]); txt = join(txt, [voice.say(["{N} takedowns now for {a}.", "{a} has {N} takedowns in the fight."], cf)]); }
        } else if (k === "tdx") {
          fc.tda[w]++;
          var tech2 = pickW(tdTechs(Fa, b.from === 1, lastOppStrike(beats, bi, w, 1.5)), r()) || "single-leg";
          b.tech = tech2; c.tech = tech2; c.atech = article(tech2);
          c.N = fc.td[w]; c.M = fc.tda[w];
          var tally = [3, 5, 8, 10, 15, 20, 25, 30, 40, 50].indexOf(fc.tda[w]) >= 0;
          if (free && rc.tdxSaid[w] < 3 && r() < 0.6) { txt = voice.say(T.tdx, c); if (txt) rc.tdxSaid[w]++; }
          if (tally && (free || txt)) txt = txt ? join(txt, [voice.say(fc.td[w] === 0 ? ["{a} is 0 for {M} on takedowns."] : ["{a} is {N} for {M} on takedowns.", "{a} has {N} of {M} takedowns."], c)]) : voice.say(T.tdxCount, c);
        } else if (k === "pass") {
          fc.pass[w]++;
          c.n = ordinal(fc.pass[w]); c.posname = POS_NAME[b.pos] || "a better position";
          var poolP = b.pos === "half" ? T.passHalf : (b.pos === "side" ? T.passSide : (b.pos === "mount" ? T.passMount : (b.pos === "back" ? (b.from === "guard" ? T.passBackScramble.concat(T.passBack) : T.passBack) : null)));
          if (poolP && (b.pos === "mount" || b.pos === "back" || (free && r() < 0.75))) txt = voice.say(poolP, c, ["{a} advances to {posname}, {his} {n} pass of the fight."]);
          if (txt) rc.posSaid = b.pos;
        } else if (k === "esc") {
          fc.esc[w]++;
          c.n = ordinal(fc.esc[w]); c.posname = POS_NAME[b.pos] || "guard";
          var poolE = b.from === "mount" ? T.escMount : (b.from === "back" ? T.escBack : (b.pos === "guard" ? T.escGuard : T.escHalf));
          if (b.from === "mount" || b.from === "back" || rc.posSaid === b.from || (free && r() < 0.5)) txt = voice.say(poolE, c, ["{a} works back to {posname}. That's {his} {n} escape of the fight."]);
          rc.posSaid = txt ? b.pos : null;
        } else if (k === "sweep") {
          fc.sweep[w]++;
          c.n = ordinal(fc.sweep[w]); c.posbot = POS_BOT[b.from] || "from the bottom"; c.posin = posIn(b.pos, F[d].short);
          txt = voice.say(T.sweep, c, ["{a} sweeps for the {n} time."]);
        } else if (k === "up") {
          fc.up[w]++;
          c.n = ordinal(fc.up[w]);
          if (r() < 0.85) txt = voice.say(b.st === 1 ? T.upClinch : T.up, c, ["{a} is back up for the {n} time."]);
        } else if (k === "reset") {
          fc.reset++; c.n = ordinal(fc.reset);
          txt = voice.say(T.reset, c, ["The referee's {n} restart of the fight."]);
        } else if (k === "sub" || k === "subx") {
          fc.sub[w]++;
          c.sub = b.sub; c.asub = article(b.sub); c.posfrom = b.at ? (b.bottom ? (POS_BOT[b.at] || "from the bottom") : (POS_FROM[b.at] || "")) : "";
          c.n = ordinal(fc.sub[w]);
          var poolS = k === "sub" ? (b.standing ? T.subStand : (b.bottom ? T.subBottom : T.sub)) : (b.standing ? T.subxStand : (b.bottom ? T.subxBottom : T.subx));
          if (b.standing && !/guillotine/i.test(b.sub)) poolS = poolS.filter(function (x) { return !/[Gg]uillotine/.test(x); });
          txt = voice.say(poolS, c, k === "sub" ? ["{d} taps to the {sub}!"] : ["{a} tries {asub}, {his} {n} submission attempt of the fight."]);
        } else if (k === "pounce") {
          fc.pounce[w]++; c.n = ordinal(fc.pounce[w]);
          txt = voice.say(T.pounce, c, ["{a} pounces for the {n} time."]);
        } else if (k === "recover") {
          c.N = fc.down[w];
          txt = voice.say(b.st === 0 ? T.recoverUp : T.recoverGuard, c, ["{a} survives knockdown number {N}."]);
        }
        return txt;
      }

      function color(b, bi, beats, rc, c, w, d) {
        var t = null, opt = rc.color < 7;
        // milestones and wear always get a line
        if (b.loc === "dist" && b.tgt === 2 && [5, 10, 15, 20, 25, 30, 40, 50].indexOf(fc.leg[w]) >= 0) { c.N = fc.leg[w]; t = voice.say(T.legN, c); }
        else if (b.tgt === 1 && b.loc !== "ground" && [10, 20, 30, 40].indexOf(fc.body[w]) >= 0) { c.N = fc.body[w]; t = voice.say(T.bodyN, c); }
        var mt = meter(b, w, d);
        if (t || mt) return join(t, [mt]);
        if (!opt) return null;
        var tech = b.tech;
        if ((tech === "headkick" || tech === "spinfist" || tech === "spinback" || tech === "wheel" || tech === "flyknee") && rc.special < 1 && r() < (tech === "headkick" ? 0.5 : 0.8)) {
          t = voice.say(tech === "headkick" ? T.headkick : T.specialLand, c); if (t) { rc.special++; rc.color++; } return t;
        }
        if (b.counter && rc.counter < 2 && r() < 0.35) { t = voice.say(CLASS[tech] === "punch" ? T.counter : T.counter.slice(0, 2), c); if (t) { rc.counter++; rc.color++; } return t; }
        // a landed combination of three or more: narrate it on its last landed strike
        if (b.combo && b.ci >= 2 && rc.combo < 2 && b.st < 2) {
          var nxt = nextInCombo(beats, bi, b.combo);
          if (!(nxt && nxt.landed)) {
            var seq = [], allLanded = true, kk;
            for (kk = bi; kk >= 0; kk--) { var o = beats[kk]; if (o.k !== "strike" || o.who !== w) { if (o.k === "strike") continue; break; } if (o.combo !== b.combo) break; seq.unshift(o); }
            for (kk = 0; kk < seq.length; kk++) if (!seq[kk].landed) allLanded = false;
            if (seq.length >= 3 && allLanded && r() < 0.6) {
              var parts = seqParts(seq.map(function (o) { return seqText(F[w], o.tech); }));
              c.seq = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
              c.aseq = /^(two|three|four|five) /.test(c.seq) ? c.seq : article(c.seq);
              t = voice.say(T.combo, c); if (t) { rc.combo++; rc.color++; } return t;
            }
          }
        }
        if (b.tgt === 1 && b.loc === "dist" && rc.body < 1 && r() < 0.05) { t = voice.say(T.body, c); if (t) { rc.body++; rc.color++; } return t; }
        return null;
      }

      // wear lines from the engine's own snapshots (leg damage, stamina, head damage)
      function meter(b, w, d) {
        var e = b.ev; if (!e || e.dA == null) return null;
        var g = d === "A" ? e.gA : e.gB, sv = d === "A" ? e.sA : e.sB, dm = d === "A" ? e.dA : e.dB, c = ctx(w);
        if (b.tgt === 2 && g >= 28 && !fc.said["leg2" + d]) { fc.said["leg2" + d] = fc.said["leg1" + d] = true; return voice.say(T.legBad, c); }
        if (b.tgt === 2 && g >= 15 && !fc.said["leg1" + d]) { fc.said["leg1" + d] = true; return voice.say(T.legHurt, c); }
        if (sv != null && sv < 0.42 && !fc.said["tired" + d]) { fc.said["tired" + d] = true; return voice.say(T.tired, c); }
        if (dm >= 45 && !fc.said["dmg" + d]) { fc.said["dmg" + d] = true; return voice.say(T.damage, c); }
        return null;
      }

      function nextInCombo(beats, bi, combo) { for (var q = bi + 1; q < beats.length; q++) { if (beats[q].k === "strike" && beats[q].combo === combo) return beats[q]; if (beats[q].k !== "strike") return null; } return null; }
      function lastOppStrike(beats, bi, w, win) {
        for (var q = bi - 1; q >= 0; q--) { var o = beats[q]; if (beats[bi].t - o.t > win) return false; if (o.k === "strike" && o.who === other(w)) return true; }
        return false;
      }

      function addNotes(beats, timeline, base, cumT, cumV, endT, ev) {
        var txtT = [];
        for (var q = 0; q < beats.length; q++) if (beats[q].txt) txtT.push(beats[q].t);
        txtT.push(endT);
        var gaps = [], prevT = 0;
        for (q = 0; q < txtT.length; q++) { if (txtT[q] - prevT > 28) gaps.push([prevT, txtT[q]]); prevT = txtT[q]; }
        gaps.sort(function (x, y) { return (y[1] - y[0]) - (x[1] - x[0]); });
        var made = 0;
        for (q = 0; q < gaps.length && made < 2; q++) {
          var tm = +((gaps[q][0] + gaps[q][1]) / 2).toFixed(2);
          if (endT - tm < 8 || tm < 6) continue;
          var seg = segAt(timeline, tm), st = seg ? seg[2] : 0, cw = seg ? seg[3] : null, ps = seg ? seg[4] : null;
          var v = statsVecAt(cumT, cumV, base, timeline, tm), c, pool, txt = null;
          if (st >= 2 && cw && ps !== "down") {
            c = ctx(cw); c.ctrl = mmss(v[(cw === "B" ? NK : 0) + SI.ctrl] - base[(cw === "B" ? NK : 0) + SI.ctrl]);
            c.posin = posIn(ps, F[other(cw)].short); c.posfrom = POS_FROM[ps] || "from the top";
            pool = ps === "back" ? NOTES.back : (ps === "guard" ? NOTES.guard : NOTES.ground);
          } else if (st === 1 && cw) { c = ctx(cw); pool = NOTES.clinch; }
          else if (st === 0) {
            // what the engine actually had them doing around this moment
            var nA = 0, nB = 0;
            for (var x = 0; x < ev.length; x++) { var ex = ev[x]; if (STRIKE_K[ex.k] && Math.abs(ex.t - tm) <= 12) { if (ex.w === "A") nA++; else nB++; } }
            var la = v[SI.sig_lnd] - base[SI.sig_lnd], lb = v[NK + SI.sig_lnd] - base[NK + SI.sig_lnd], lead = la >= lb ? "A" : "B";
            c = ctx(lead); c.N = Math.max(la, lb); c.M = Math.min(la, lb);
            if (nA + nB <= 2) pool = NOTES.lull;
            else if (nA >= 4 && nB >= 4) pool = NOTES.busy;
            else if (la === lb) pool = la > 0 ? NOTES.even : null;
            else if (Math.abs(la - lb) >= 4) pool = NOTES.dist;
            else pool = null;
          }
          if (pool) txt = voice.say(pool, c);
          if (!txt) continue;
          var nb = { t: tm, k: "note", who: cw || null, st: st, pos: st >= 2 ? ps : null, ctl: st === 1 ? cw : null, i: -1, txt: txt };
          var at = 0; while (at < beats.length && beats[at].t <= tm) at++;
          beats.splice(at, 0, nb); made++;
        }
      }
    }

    // ================================================================ round intro / outro text
    function roundIntro(ri) {
      var prev = script.rounds[ri - 1]; if (!prev) return null;
      var head = nR && ri === nR - 1 ? "Final round." : (nR === 5 && ri === 3 ? "Round 4, into the championship rounds." : "Round " + (ri + 1) + ".");
      var jt = judgeTally(prev.judges), parts = [head];
      if (prev.judges) {
        var X = jt.A > jt.B ? "A" : (jt.B > jt.A ? "B" : null);
        if (X) {
          var n8 = X === "A" ? jt.a8 : jt.b8, cx = ctx(X); cx.r = ri; cx.n8 = numWord(n8);
          if (n8 > 0) parts.push(voice.fill(n8 === 3 ? "{a} won round {r} 10-8 on all three cards." : "{a} took round {r}, with a 10-8 on {n8} " + (n8 === 1 ? "card." : "cards."), cx));
          else parts.push(voice.fill(jt[X] === 3 ? "{a} took round {r} on all three cards." : "Two of three judges gave round {r} to {a}.", cx));
        }
      }
      var e = prev.end, la = e.A.sig_lnd, lb = e.B.sig_lnd, ca = e.A.ctrl, cb = e.B.ctrl;
      if (Math.abs(ca - cb) >= 120) { var cw = ca > cb ? "A" : "B", c1 = ctx(cw); c1.ctrl = mmss(Math.max(ca, cb)); parts.push(voice.fill("{a} has {ctrl} of control time so far.", c1)); }
      else if (la !== lb) { var lw = la > lb ? "A" : "B", c2 = ctx(lw); c2.N = Math.max(la, lb); c2.M = Math.min(la, lb); parts.push(voice.fill("{a} leads {N}-{M} in significant strikes landed.", c2)); }
      else parts.push("Significant strikes landed are level at " + la + ".");
      return voice.take(parts.join(" "));
    }
    function roundOutro(R, ri) {
      var st = R.end, b0 = R.base, la = st.A.sig_lnd - b0.A.sig_lnd, lb = st.B.sig_lnd - b0.B.sig_lnd, txt;
      var W = fight.winner, L = W === "A" || W === "B" ? other(W) : null;
      if (R.fin) {
        var how = fight.method === "SUB" ? "submission" : (METHOD_LONG[fight.method] || fight.method);
        txt = F[W].name + " wins by " + how + " at " + mmss(R.fin.t) + " of round " + (ri + 1) + ".";
        var ctxL = careerLine(W, L);
        if (ctxL) txt += " " + ctxL;
        return voice.take(capSent(txt));
      }
      txt = "End of round " + (ri + 1) + ". Significant strikes landed: " + F.A.short + " " + la + ", " + F.B.short + " " + lb + ".";
      if (R.judges) {
        var jt = judgeTally(R.judges), X = jt.A > jt.B ? "A" : (jt.B > jt.A ? "B" : null);
        if (X) {
          var n8 = X === "A" ? jt.a8 : jt.b8;
          txt += " " + (jt[X] === 3 ? "All three judges score it for " : "Two judges score it for ") + F[X].short + (n8 ? " (" + numWord(n8) + " at 10-8)" : "") + ".";
        }
      }
      if (R.stoppage) {
        var loser = other(R.stoppage);
        txt += fight.method === "DOC" ? " The ringside doctor stops the fight. " + F[loser].short + " can't continue." : " " + poss(F[loser].short) + " corner stops the fight on the stool.";
        txt += " " + F[R.stoppage].name + " wins by TKO.";
      }
      return voice.take(capSent(txt));
    }
    function careerLine(W, L) {
      var rl = F[L].record, rw = F[W].record, c = ctx(W);
      if (KO_LIKE[fight.method]) {
        if (rl && rl.ko_l === 0) return voice.fill("{d} had never lost by KO or TKO in the UFC.", c);
        if (rw && rw.ko_w != null) { c.n = ordinal(rw.ko_w + 1); return voice.fill("It's the {n} KO or TKO win of {a_s} UFC career.", c); }
      } else if (fight.method === "SUB") {
        if (rl && rl.sub_l === 0) return voice.fill("{d} had never been submitted in the UFC.", c);
        if (rw && rw.sub_w != null) { c.n = ordinal(rw.sub_w + 1); return voice.fill(rw.sub_w === 0 ? "It's the first submission win of {a_s} UFC career." : "It's {a_s} {n} submission win in the UFC.", c); }
      }
      return null;
    }
  }

  // ------------------------------------------------------------------ helpers used by build
  function cap1(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function join(txt, extra) {
    var out = txt || "";
    for (var i = 0; i < extra.length; i++) if (extra[i]) out = out ? out + " " + extra[i] : extra[i];
    return out || null;
  }
  // ["right hand", "right hand", "jab"] -> ["two right hands", "a jab"] (articles added after the first item)
  function pluralWord(p) {
    var m = /^(.*?)( to the .*| on the inside)$/.exec(p), head = m ? m[1] : p, tail = m ? m[2] : "";
    head = /(ch|sh|s|x)$/.test(head) ? head + "es" : head + "s";
    return head + tail;
  }
  function seqParts(list) {
    var out = [], i = 0;
    while (i < list.length) {
      var j = i; while (j + 1 < list.length && list[j + 1] === list[i]) j++;
      var n = j - i + 1;
      out.push(n > 1 ? NUMW[Math.min(n, 10)] + " " + pluralWord(list[i]) : (out.length ? article(list[i]) : list[i]));
      i = j + 1;
    }
    return out;
  }
  function plural(tech, dt) {
    if (dt && dt.tool === "elbow") return "elbows";
    if (dt && dt.tool === "knee") return "knees";
    switch (tech) {
      case "gnpelbow": case "elbow": case "upelbow": return "elbows";
      case "knee": case "kneehead": case "flyknee": return "knees";
      case "calf": return "calf kicks";
      case "inside": return "leg kicks";
      case "gnp": return "punches";
    }
    return "punches";
  }
  // the engine rounds event times to 0.01 s but not fin.t: the round ends at whichever is later
  function roundEnd(rd) {
    if (!rd.fin) return 300;
    var ev = rd.ev || [], lt = ev.length ? ev[ev.length - 1].t : 0;
    return Math.max(rd.fin.t, lt);
  }
  function inferKdTo(ev, i, s) { var n = ev[i + 1]; if (n && n.k === "reset" && Math.abs(n.t - ev[i].t) < 0.02) return 0; if (n && n.s >= 2 && n.pos === "down") return n.s; return 0; }
  function segAt(tl, t) { for (var i = 0; i < tl.length; i++) if (t >= tl[i][0] && t < tl[i][1]) return tl[i]; return tl.length ? tl[tl.length - 1] : null; }
  function statsVecAt(cumT, cumV, base, timeline, t) {
    var lo = 0, hi = cumT.length - 1, k = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (cumT[mid] <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    var v = (k >= 0 ? cumV[k] : base).slice(), t0 = k >= 0 ? cumT[k] : 0;
    for (var i = 0; i < timeline.length; i++) {
      var sg = timeline[i], a = Math.max(sg[0], t0), b = Math.min(sg[1], t);
      if (b > a && sg[3]) v[(sg[3] === "B" ? NK : 0) + SI.ctrl] += b - a;
    }
    return v;
  }
  function powerFactors(fight, m) {
    if (m && m.dw) return { A: m.dw[0], B: m.dw[1] };
    // estimate from the trace: head damage the defender takes per landed distance head strike
    var sum = { A: 0, B: 0 }, n = { A: 0, B: 0 };
    for (var ri = 0; ri < fight.rounds.length; ri++) {
      var ev = fight.rounds[ri].ev || [], prev = null;
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i];
        if (prev && e.k === "hit" && e.tg === 0 && e.loc === "dist" && e.dA != null) {
          var dl = e.w === "A" ? e.dB - prev.dB : e.dA - prev.dA;
          if (dl > 0 && dl < 3) { sum[e.w] += dl; n[e.w]++; }
        }
        if (e.dA != null) prev = e;
      }
    }
    return { A: n.A >= 5 ? sum.A / n.A : 1, B: n.B >= 5 ? sum.B / n.B : 1 };
  }
  function cardsText(cards, W) {
    return (cards || []).map(function (c) { var a = c[0], b = c[1]; return W === "B" ? b + "-" + a : a + "-" + b; }).join(", ");
  }
  function decisionText(fight, F, voice) {
    var W = fight.winner, cards = fight.cards || [], method = fight.method, txt;
    function cardFor(c, side) { return side === "B" ? c[1] + "-" + c[0] : c[0] + "-" + c[1]; }
    function winnerOf(c) { return c[0] > c[1] ? "A" : (c[1] > c[0] ? "B" : null); }
    if (W === "D") {
      var kind = method === "DRAW" ? (cards.filter(function (c) { return c[0] === c[1]; }).length === 3 ? "unanimous" : (cards.filter(function (c) { return c[0] === c[1]; }).length === 2 ? "majority" : "split")) : "";
      var parts = cards.map(function (c) { var x = winnerOf(c); return x ? cardFor(c, x) + " " + F[x].short : c[0] + "-" + c[1] + " even"; });
      txt = "We go to the scorecards. " + parts.join(", ") + ". This one is a " + kind + " draw.";
    } else {
      var L = other(W), agree = [], dissent = [], even = [];
      cards.forEach(function (c) { var x = winnerOf(c); if (x === W) agree.push(cardFor(c, W)); else if (x === L) dissent.push(cardFor(c, L)); else even.push(c[0] + "-" + c[1]); });
      if (method === "UD") txt = "We go to the scorecards. " + agree.join(", ") + ", for the winner by unanimous decision, " + F[W].name + "!";
      else if (method === "SD") txt = "We go to the scorecards for a split decision. " + dissent.join(", ") + " " + F[L].short + ", then " + agree.join(" and ") + " for the winner, " + F[W].name + "!";
      else txt = "We go to the scorecards for a majority decision. " + even.join(", ") + " on one card, then " + agree.join(" and ") + " for the winner, " + F[W].name + "!";
    }
    return { text: voice.take(txt) || txt, cards: cards, winner: W, method: method };
  }

  // technique for one strike beat
  function chooseTech(Fa, b, prev, dt) {
    var W = Fa.W, tg = b.tgt, loc = b.loc;
    if (loc === "ground") {
      if (b.down) return dt && dt.tool === "elbow" ? "gnpelbow" : (Fa._u() < 0.85 ? "gnp" : "gnpelbow");
      if (b.fin && dt) return dt.tool === "elbow" ? "gnpelbow" : "gnp";
      return b.top ? (pickW(W.gt, Fa._u()) || "gnp") : "upelbow";
    }
    var clinch = loc === "clinch";
    var grp = clinch ? [W.ch, W.cb, W.cl][tg] : [W.dh, W.db, W.dl][tg];
    var w = {}, k;
    for (k in grp) w[k] = grp[k];
    if (prev && NEXT[prev]) for (k in NEXT[prev]) if (w[k] != null) w[k] *= NEXT[prev][k];
    if (!prev && b.ci === 0) for (k in FIRST) if (w[k] != null) w[k] *= FIRST[k];
    if (b.counter && tg === 0) { if (w.hook != null) w.hook *= 1.4; if (w.cross != null) w.cross *= 1.25; if (w.jab != null) w.jab *= 0.7; }
    if (b.kd || b.fin) for (k in w) w[k] *= KDP[k] != null ? KDP[k] : 1;
    else if (b.hurt) for (k in w) w[k] *= Math.sqrt(KDP[k] != null ? KDP[k] : 1);
    if (b.fin && b.how === "LEG" && w.calf != null) w.calf *= 1.5;
    if (b.fin && dt && dt.tgt === tg) {
      var f = {}, any = false;
      for (k in w) if (CLASS[k] === dt.tool && w[k] > 0) { f[k] = w[k]; any = true; }
      if (any) w = f;
      else return CANON[dt.tool + tg + (clinch && dt.tool === "punch" ? "c" : "")] || CANON[dt.tool + tg] || pickW(grp, Fa._u()) || "cross";
    }
    return pickW(w, Fa._u()) || (tg === 2 ? "calf" : (tg === 1 ? "bodyhook" : "cross"));
  }

  // ------------------------------------------------------------------ density: what the show may compress
  function density(beats, ev, endT, timeline) {
    var bin = 10, nb = Math.max(1, Math.ceil(endT / bin)), n = [], strikes = [], evs = [], act = [], warp = [], i;
    for (i = 0; i < nb; i++) { n.push(0); strikes.push(0); evs.push(0); act.push(0); }
    for (i = 0; i < ev.length; i++) evs[Math.min(nb - 1, Math.floor(ev[i].t / bin))]++;
    var vis = [];
    for (i = 0; i < beats.length; i++) {
      var b = beats[i]; if (b.k === "note") continue;
      vis.push(b.t);
      var k = Math.min(nb - 1, Math.floor(b.t / bin));
      n[k]++;
      if (b.k === "strike") { strikes[k]++; act[k] += b.kd || b.fin || b.hurt ? 4 : (b.miss ? 0.6 : 1); }
      else act[k] += 2;
    }
    for (i = 0; i < nb; i++) { act[i] = +act[i].toFixed(1); warp.push(+clip(4 / (act[i] + 1), 0.6, 3).toFixed(2)); }
    var quiet = [], prev = 0;
    vis.push(endT);
    for (i = 0; i < vis.length; i++) {
      if (vis[i] - prev >= 6) { var sg = segAt(timeline, (prev + vis[i]) / 2); quiet.push([+prev.toFixed(2), +vis[i].toFixed(2), sg ? sg[2] : 0, sg ? sg[3] : null]); }
      prev = vis[i];
    }
    var tq = 0; for (i = 0; i < quiet.length; i++) tq += quiet[i][1] - quiet[i][0];
    return { bin: bin, n: n, strikes: strikes, ev: evs, act: act, warp: warp, quiet: quiet, quietSecs: +tq.toFixed(1), beats: vis.length - 1 };
  }

  // ------------------------------------------------------------------ public helpers
  // exact engine stats (fight cumulative) at clock time t of round r, control included
  function statsAt(script, r, t) {
    var R = script.rounds[r]; if (!R) return null;
    return statsObj(statsVecAt(R.cum.t, R.cum.v, R.cum.base, R.timeline, Math.min(t, R.endT)));
  }
  function roundStatsAt(script, r, t) {
    var a = statsAt(script, r, t), b = script.rounds[r].base, out = { A: {}, B: {} };
    for (var k = 0; k < NK; k++) { var key = STAT_KEYS[k]; out.A[key] = +(a.A[key] - b.A[key]).toFixed(1); out.B[key] = +(a.B[key] - b.B[key]).toFixed(1); }
    return out;
  }
  // suggested clock warp at time t (smoothly interpolated between 10 s bin centers)
  function warpAt(round, t) {
    var d = round && round.density; if (!d) return 1;
    var x = t / d.bin - 0.5, i = Math.floor(x), f = x - i, w = d.warp;
    var a = w[clip(i, 0, w.length - 1)], b = w[clip(i + 1, 0, w.length - 1)];
    return a + (b - a) * clip(f, 0, 1);
  }
  // fighter description for opts.fighters from a fighters.json profile plus overrides and scouting
  function describe(prof, extra, scouting) {
    prof = prof || {}; extra = extra || {};
    var o = { name: prof.name, slug: prof.slug, nick: prof.nick, stance: prof.stance, height_in: prof.height_in, reach_in: prof.reach_in,
      division: prof.division, record: prof.record, kd_absorbed: prof.kd_absorbed, dob: prof.dob };
    if (scouting && scouting.appearance) o.appearance = scouting.appearance;
    for (var k in extra) o[k] = extra[k];
    if (!o.short && o.name) o.short = shortName(o.name);
    return o;
  }

  var API = {
    VERSION: VERSION, build: build, statsAt: statsAt, roundStatsAt: roundStatsAt, warpAt: warpAt, describe: describe,
    shortName: shortName, pronounsFor: pronounsFor, moveTexts: moveTexts,
    STAT_KEYS: STAT_KEYS, BASE_MOVES: BASE_MOVES, EXTENDED: EXT,
    KINDS: ["strike", "clinch", "break", "td", "tdx", "pass", "esc", "sweep", "up", "sub", "subx", "pounce", "recover", "reset", "note"],
    // v2 compatibility: generic names (the page passes real ones through opts.fighters)
    NAMES: { A: "Blue corner", B: "Red corner" }, SHORT: { A: "Blue", B: "Red" },
    MOVE_TXT: { jab: "jab", cross: "right hand", hook: "left hook", overhand: "overhand right", upper: "uppercut", headkick: "head kick", bodykick: "body kick",
      bodyhook: "hook to the body", bodystraight: "straight to the body", calf: "calf kick", inside: "inside low kick", short: "short punch", elbow: "elbow",
      kneehead: "knee", knee: "knee", shortbody: "body shot", gnp: "ground strike", gnpelbow: "elbow", upelbow: "elbow from the bottom" }
  };
  root.FightDirector = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : globalThis));
