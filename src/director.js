/* Turns one traced engine fight into an animation script: beats with moves, misses and play-by-play. */
(function (root) {
  "use strict";
  var NAMES = { A: "Volkanovski", B: "Gaethje" }, SHORT = { A: "Volk", B: "Gaethje" };
  var ACC = { A: 0.57, B: 0.576 };
  var MOVES = {
    A: {
      head: [["jab", 0.3], ["cross", 0.27], ["hook", 0.15], ["overhand", 0.14], ["upper", 0.1], ["headkick", 0.04]],
      body: [["bodykick", 0.5], ["bodyhook", 0.3], ["bodystraight", 0.2]],
      leg: [["calf", 0.55], ["inside", 0.45]],
      kd: [["cross", 0.35], ["overhand", 0.3], ["hook", 0.25], ["upper", 0.1]]
    },
    B: {
      head: [["jab", 0.2], ["cross", 0.22], ["hook", 0.24], ["overhand", 0.16], ["upper", 0.14], ["headkick", 0.04]],
      body: [["bodyhook", 0.55], ["bodykick", 0.3], ["bodystraight", 0.15]],
      leg: [["calf", 0.85], ["inside", 0.15]],
      kd: [["hook", 0.35], ["overhand", 0.28], ["upper", 0.22], ["cross", 0.15]]
    }
  };
  var CLINCH = { head: [["short", 0.45], ["elbow", 0.35], ["kneehead", 0.2]], body: [["knee", 0.7], ["shortbody", 0.3]], leg: [["knee", 1]] };
  var MOVE_TXT = {
    jab: "jab", cross: "right hand", hook: "left hook", overhand: "overhand right", upper: "uppercut", headkick: "head kick",
    bodykick: "body kick", bodyhook: "hook to the body", bodystraight: "straight to the body", calf: "calf kick", inside: "inside low kick",
    short: "short right", elbow: "elbow", kneehead: "knee", knee: "knee", shortbody: "body shot", gnp: "ground strike", gnpelbow: "elbow", upelbow: "elbow from the bottom"
  };
  var SUBS = ["arm-triangle", "kimura", "guillotine", "D'Arce choke"];

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function pick(list, r) { var u = r(), acc = 0; for (var i = 0; i < list.length; i++) { acc += list[i][1]; if (u < acc) return list[i][0]; } return list[list.length - 1][0]; }
  function pickTxt(arr, r) { return arr[Math.floor(r() * arr.length)]; }
  function fill(s, a, d, extra) {
    return s.replace(/\{A\}/g, NAMES[a]).replace(/\{a\}/g, SHORT[a]).replace(/\{D\}/g, NAMES[d]).replace(/\{d\}/g, SHORT[d])
      .replace(/\{move\}/g, extra && extra.move || "").replace(/\{sub\}/g, extra && extra.sub || "").replace(/\{n\}/g, extra && extra.n || "");
  }
  function other(w) { return w === "A" ? "B" : "A"; }

  function stateAtFn(ev) {
    var ch = [[0, 0]];
    for (var i = 0; i < ev.length; i++) if (ev[i].s != null) ch.push([ev[i].t, ev[i].s]);
    return function (t) { var s = 0; for (var i = 0; i < ch.length; i++) { if (ch[i][0] <= t) s = ch[i][1]; else break; } return s; };
  }

  function build(fight, seed) {
    var r = rng(seed ^ 0x5bd1e995);
    var script = { rounds: [], winner: fight.winner, method: fight.method, round: fight.round, t: fight.t, cards: fight.cards, form: fight.form, seed: seed };
    var legCount = { A: 0, B: 0 };
    for (var ri = 0; ri < fight.rounds.length; ri++) {
      var rd = fight.rounds[ri], ev = rd.ev, beats = [];
      var endT = rd.fin ? rd.fin.t : 300;
      var stateAt = stateAtFn(ev);
      var clinchTold = false, comboTold = 0, lastStrike = { A: [], B: [] };
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i], b = { t: e.t, ev: e };
        if (e.k === "hit" || e.k === "kd" || e.k === "fin" || e.k === "hurt") {
          var w = e.w, d = other(w), tg = e.tg, tgName = tg === 0 ? "head" : (tg === 1 ? "body" : "leg");
          var move;
          if (e.s === 0) move = (e.k === "kd" || e.k === "fin" || e.k === "hurt") && tg === 0 ? pick(MOVES[w].kd, r) : pick(MOVES[w][tgName], r);
          else if (e.s === 1) move = pick(CLINCH[tgName], r);
          else move = ((e.s === 2 && w === "A") || (e.s === 3 && w === "B")) ? (r() < 0.75 ? "gnp" : "gnpelbow") : "upelbow";
          if (e.k === "fin" && e.s === 0 && tg === 2) move = "calf";
          b.k = "strike"; b.who = w; b.move = move; b.tgt = tg; b.landed = true; b.st = e.s;
          b.kd = e.k === "kd"; b.fin = e.k === "fin"; b.hurt = e.k === "hurt";
          if (tg === 2 && e.s === 0) {
            legCount[w]++;
            if (legCount[w] === 5 || legCount[w] === 10 || legCount[w] === 15) b.txt = fill(pickTxt([
              "{A} has landed {n} leg kicks. {D}'s lead leg is starting to show it.",
              "Leg kick number {n} for {a}. {D} is planting less on that lead leg."], r), w, d, { n: legCount[w] });
          }
          if (b.kd) b.txt = fill(pickTxt(["DOWN! {A}'s {move} drops {D}.", "Knockdown! A {move} from {A} puts {D} on the canvas.", "{D} goes down off a {move} from {A}."], r), w, d, { move: MOVE_TXT[move] });
          else if (b.hurt) b.txt = fill(pickTxt(["{A} wobbles {D} with a {move}.", "{D} is hurt! Big {move} from {A}.", "A {move} from {A} buckles {D}'s knees."], r), w, d, { move: MOVE_TXT[move] });
          else if (b.fin) {
            if (e.s === 0 && tg === 2) b.txt = fill("{D}'s lead leg gives out. The calf kicks have finished it.", w, d);
            else if (e.s >= 2) b.txt = fill(pickTxt(["{A} pours on the ground strikes. The referee jumps in.", "{A} pounds {D} out from the top."], r), w, d);
            else b.txt = fill(pickTxt(["IT'S OVER! {A}'s {move} puts {D} away.", "{A} finishes it with a {move}. {D} is out.", "Lights out. {A}'s {move} ends it."], r), w, d, { move: MOVE_TXT[move] });
          } else {
            // combinations: three landed within 2.2 seconds
            var ls = lastStrike[w]; ls.push(e.t); while (ls.length && e.t - ls[0] > 2.2) ls.shift();
            if (ls.length >= 3 && comboTold < 2 && e.s === 0 && !b.txt && r() < 0.6) {
              comboTold++; ls.length = 0;
              b.txt = fill(pickTxt(["{A} lands a three-punch combination.", "{A} puts together a clean combination.", "Sharp combination from {A}, finished with a {move}."], r), w, d, { move: MOVE_TXT[move] });
            }
          }
        } else if (e.k === "clinch") {
          b.k = "clinch"; b.who = e.w || "B";
          if (!clinchTold || r() < 0.25) { clinchTold = true; b.txt = fill(pickTxt(["{A} ties {D} up against the fence.", "They clinch up along the cage.", "{A} grabs a collar tie and drives {D} to the fence."], r), b.who, other(b.who)); }
        } else if (e.k === "break") {
          b.k = "break";
        } else if (e.k === "td") {
          b.k = "td"; b.who = e.w;
          b.txt = fill(pickTxt(["{A} changes levels and finishes a double-leg.", "Takedown {a}! {D} is on his back.", "{A} chains a takedown and lands in {d}'s guard."], r), e.w, other(e.w));
        } else if (e.k === "tdx") {
          b.k = "tdx"; b.who = e.w;
          if (r() < 0.55) b.txt = fill(pickTxt(["{D} stuffs the takedown.", "{A} shoots. {D} sprawls and stays up.", "{D} reads the level change and defends."], r), e.w, other(e.w));
        } else if (e.k === "up") {
          b.k = "up"; b.who = e.w;
          b.txt = fill(pickTxt(["{A} wall-walks back to his feet.", "{A} scrambles up. We're standing again.", "{A} gets back up."], r), e.w, other(e.w));
        } else if (e.k === "sub" || e.k === "subx") {
          var sub = SUBS[Math.floor(r() * SUBS.length)];
          b.k = e.k; b.who = e.w; b.sub = sub;
          b.txt = e.k === "sub" ? fill("{D} taps! {A} finishes the {sub}.", e.w, other(e.w), { sub: sub })
            : fill(pickTxt(["{A} hunts a {sub}. {D} defends.", "{A} threatens a {sub}, but {D} survives."], r), e.w, other(e.w), { sub: sub });
        } else if (e.k === "reset") {
          b.k = "reset";
        } else continue;
        beats.push(b);
      }
      // misses (visual only): roughly matched to each man's accuracy
      var extra = [];
      for (i = 0; i < beats.length; i++) {
        var lb = beats[i];
        if (lb.k !== "strike" || lb.st !== 0) continue;
        var pm = (1 - ACC[lb.who]) / ACC[lb.who] * 0.6;
        if (r() < pm) {
          var tm = lb.t + (r() * 2 - 1) * 2.4;
          if (tm < 0.6 || tm > endT - 0.4 || stateAt(tm) !== 0) continue;
          var who = r() < 0.75 ? lb.who : other(lb.who);
          var u = r(), tgt = u < 0.7 ? 0 : (u < 0.82 ? 1 : 2);
          var mv = pick(MOVES[who][tgt === 0 ? "head" : (tgt === 1 ? "body" : "leg")], r);
          extra.push({ t: tm, k: "strike", who: who, move: mv, tgt: tgt, landed: false, st: 0, miss: true });
        }
      }
      beats = beats.concat(extra).sort(function (a, b2) { return a.t - b2.t; });
      // chain strikes thrown close together by the same man so combinations flow
      for (i = 1; i < beats.length; i++) {
        var p = beats[i - 1], c = beats[i];
        if (c.k === "strike" && p.k === "strike" && c.who === p.who && c.t - p.t < 1.6 && c.st === p.st) c.chain = true;
      }
      script.rounds.push({ r: ri, beats: beats, endT: endT, judges: rd.judges || null, stoppage: rd.stoppage || null, fin: rd.fin, st: rd.st,
        dHA: rd.dHA, dHB: rd.dHB, dLA: rd.dLA, dLB: rd.dLB, SA: rd.SA, SB: rd.SB });
    }
    return script;
  }

  root.FightDirector = { build: build, NAMES: NAMES, SHORT: SHORT, MOVE_TXT: MOVE_TXT };
})(typeof window !== "undefined" ? window : globalThis);
