(function () {
  "use strict";
  var E = window.FightEngine, FD = window.FightDirector, FS = window.FightShow;
  if (!E || !FD) return;
  var $ = function (id) { return document.getElementById(id); };
  var reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var NAMES = { A: "Volkanovski", B: "Gaethje" }, SHORT = { A: "Volk", B: "Gaethje" };
  var nf = new Intl.NumberFormat("en-US");
  function pct(x, d) { return (100 * x).toFixed(d == null ? 1 : d) + "%"; }
  function mmss(sec) { var s = Math.max(0, Math.round(sec)); var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }
  function clockOf(t) { return mmss(Math.ceil(300 - t - 1e-9)); }
  function newSeed() { try { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; } catch (e) { return (Math.random() * 4294967296) >>> 0; } }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function svgEl(tag, attrs) { var e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function signed(x) { var v = Math.round((x - 1) * 100); return (v > 0 ? "+" : (v < 0 ? "−" : "±")) + Math.abs(v) + "%"; }

  var knobs = E.presetKnobs("baseline"), activePreset = "baseline";

  /* ================================================================ knobs */
  function powerRatio(g) { var m = E.volkGaethje(Object.assign({}, knobs, { judgePower: g })); return Math.pow(m.wB, g) / Math.pow(m.wA, g); }
  var SLIDERS = [
    { k: "volkChin", label: "Volk's chin at 155", min: 0.8, max: 1.6, step: 0.05, fmt: function (v) { return "×" + v.toFixed(2); }, hint: "How much easier he is to drop than his featherweight self. 1.00 means no change." },
    { k: "volkPow", label: "Volk's power at 155", min: 0.6, max: 1.1, step: 0.05, fmt: function (v) { return "×" + v.toFixed(2); }, hint: "His knockdown rate per landed head shot against a bigger man, relative to his career." },
    { k: "volkOut", label: "Volk's output at 155", min: 0.8, max: 1.1, step: 0.05, fmt: function (v) { return "×" + v.toFixed(2); }, hint: "How much of his career volume he keeps against a bigger man." },
    { k: "mileage", label: "Gaethje's mileage", min: 0, max: 2, step: 0.1, fmt: function (v) { return v.toFixed(1); }, hint: "Age 38 this month, the wrist and knee, the Topuria war. At 1.0 he throws 7% less, hits 5% softer, tires 15% faster and drops 20% more easily." },
    { k: "gaeLeg", label: "Gaethje's leg-kick share", min: 0.05, max: 0.4, step: 0.01, fmt: function (v) { return Math.round(v * 100) + "%"; }, hint: "Share of his strikes at distance aimed at the legs. Career 28%; 6% against Pimblett." },
    { k: "volkTd", label: "Volk's takedown attempts", min: 0, max: 9, step: 0.5, fmt: function (v) { return (v / 3).toFixed(1) + " a round"; }, hint: "Gaethje stops 73% of takedowns and stands up in about 40 seconds." },
    { k: "gaeTd", label: "Gaethje's takedown attempts", min: 0, max: 6, step: 0.5, fmt: function (v) { return (v / 3).toFixed(1) + " a round"; }, hint: "He rarely wrestles, but went 3 for 3 against Pimblett." },
    { k: "judgePower", label: "Judges' credit for power", min: 0, max: 0.8, step: 0.05, fmt: function (v) { return "Gaethje shot = " + powerRatio(v).toFixed(2) + "×"; }, hint: "What one landed Gaethje strike is worth on the cards next to one of Volk's, before knockdowns." }
  ];
  var sliderEls = {};
  (function buildKnobs() {
    var wrap = $("sliders");
    SLIDERS.forEach(function (s) {
      var d = el("div", "sl"), top = el("div", "sl-top"), lab = el("label", null, s.label), out = el("output");
      lab.htmlFor = "k-" + s.k; out.id = "o-" + s.k; out.htmlFor = "k-" + s.k;
      var inp = document.createElement("input"); inp.type = "range"; inp.id = "k-" + s.k; inp.min = s.min; inp.max = s.max; inp.step = s.step;
      top.appendChild(lab); top.appendChild(out); d.appendChild(top); d.appendChild(inp); d.appendChild(el("p", "hint", s.hint));
      wrap.appendChild(d);
      sliderEls[s.k] = { inp: inp, out: out, s: s };
      inp.addEventListener("input", function () { knobs[s.k] = +inp.value; activePreset = null; syncKnobs(); queueTally(); });
    });
    var chips = $("chips");
    E.PRESETS.forEach(function (p) {
      var b = el("button", "chip", p.label); b.type = "button"; b.dataset.id = p.id;
      b.addEventListener("click", function () { knobs = E.presetKnobs(p.id); activePreset = p.id; syncKnobs(); queueTally(true); });
      chips.appendChild(b);
    });
    $("btnReset").addEventListener("click", function () { knobs = E.presetKnobs("baseline"); activePreset = "baseline"; syncKnobs(); queueTally(true); });
  })();
  function syncKnobs() {
    for (var k in sliderEls) { var x = sliderEls[k]; x.inp.value = knobs[k]; x.out.textContent = x.s.fmt(+knobs[k]); }
    Array.prototype.forEach.call($("chips").children, function (b) { b.setAttribute("aria-pressed", b.dataset.id === activePreset ? "true" : "false"); });
  }

  /* ================================================================ tally */
  var N_TALLY = 20000, tallyId = 0, worker = null, tallyTimer = null, lastAgg = null;
  function workerMain() {
    var EN = self.FightEngine, cur = 0;
    self.onmessage = function (e) {
      var d = e.data; cur = d.id;
      var m = EN.volkGaethje(d.knobs), rng = EN.makeRng(d.seed), i = 0, N = d.n;
      var agg = { n: 0, bins: [0, 0, 0, 0, 0, 0, 0], finA: [0, 0, 0, 0, 0], finB: [0, 0, 0, 0, 0], dist: 0, distA: 0 };
      function chunk() {
        if (d.id !== cur) return;
        var end = Math.min(N, i + 1500);
        for (; i < end; i++) {
          var f = EN.simulate(m, rng, false), k = EN.bucket(f);
          agg.bins[k]++;
          var done = f.method === "UD" || f.method === "SD" || f.method === "MD" || f.method === "DRAW";
          if (done) { agg.dist++; if (f.winner === "A") agg.distA++; }
          else (f.winner === "A" ? agg.finA : agg.finB)[f.round - 1]++;
        }
        agg.n = i;
        self.postMessage({ id: d.id, agg: agg, done: i >= N });
        if (i < N) setTimeout(chunk, 0);
      }
      chunk();
    };
  }
  function makeWorker() {
    try {
      var src = $("engine-src").textContent + "\n;(" + workerMain.toString() + ")();";
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      var w = new Worker(url);
      w.onmessage = function (e) { if (e.data.id === tallyId) onTally(e.data.agg, e.data.done); };
      w.onerror = function () { worker = null; startTally(); };
      return w;
    } catch (e) { return null; }
  }
  function mainTally(id) {
    var m = E.volkGaethje(knobs), rng = E.makeRng(newSeed()), i = 0;
    var agg = { n: 0, bins: [0, 0, 0, 0, 0, 0, 0], finA: [0, 0, 0, 0, 0], finB: [0, 0, 0, 0, 0], dist: 0, distA: 0 };
    (function chunk() {
      if (id !== tallyId) return;
      var end = Math.min(N_TALLY, i + 700);
      for (; i < end; i++) {
        var f = E.simulate(m, rng, false), k = E.bucket(f);
        agg.bins[k]++;
        var done = f.method === "UD" || f.method === "SD" || f.method === "MD" || f.method === "DRAW";
        if (done) { agg.dist++; if (f.winner === "A") agg.distA++; }
        else (f.winner === "A" ? agg.finA : agg.finB)[f.round - 1]++;
      }
      agg.n = i; onTally(agg, i >= N_TALLY);
      if (i < N_TALLY) setTimeout(chunk, 16);
    })();
  }
  function startTally() {
    tallyId++;
    $("runStatus").textContent = "Simulating " + nf.format(N_TALLY) + " fights";
    if (worker === null && typeof Worker !== "undefined" && !startTally.failed) { worker = makeWorker(); if (!worker) startTally.failed = true; }
    if (worker) worker.postMessage({ id: tallyId, knobs: knobs, seed: newSeed(), n: N_TALLY });
    else mainTally(tallyId);
  }
  function queueTally(now) { clearTimeout(tallyTimer); tallyTimer = setTimeout(startTally, now ? 0 : 220); }
  $("btnRun").addEventListener("click", function () { startTally(); });

  var BIN_LABELS = ["Volk by KO/TKO", "Volk by submission", "Volk by decision", "Draw", "Gaethje by decision", "Gaethje by submission", "Gaethje by KO/TKO"];
  var BIN_SHORT = ["KO/TKO", "Sub", "Decision", "Draw", "Decision", "Sub", "KO/TKO"];
  var BIN_COL = ["var(--blue)", "var(--blue)", "var(--blue)", "var(--neutral)", "var(--red)", "var(--red)", "var(--red)"];

  function onTally(agg, done) {
    lastAgg = agg;
    var n = Math.max(1, agg.n), b = agg.bins;
    var pV = (b[0] + b[1] + b[2]) / n, pG = (b[4] + b[5] + b[6]) / n, pD = b[3] / n;
    $("pV").textContent = pct(pV); $("pG").textContent = pct(pG); $("pD").textContent = pct(pD);
    $("wV").textContent = pct(pV, 0); $("wG").textContent = pct(pG, 0);
    $("segV").style.width = (pV * 100) + "%"; $("segD").style.width = Math.max(0.4, pD * 100) + "%"; $("segG").style.width = (pG * 100) + "%";
    $("segVl").textContent = pV > 0.12 ? pct(pV, 0) : ""; $("segGl").textContent = pG > 0.12 ? pct(pG, 0) : "";
    $("segbar").setAttribute("aria-label", "Volkanovski " + pct(pV) + ", draw " + pct(pD) + ", Gaethje " + pct(pG));
    $("tDist").textContent = pct(agg.dist / n, 0);
    $("tCards").textContent = agg.dist ? pct(agg.distA / agg.dist, 0) : "–";
    $("tGfin").textContent = pct((b[5] + b[6]) / n, 0);
    $("runStatus").textContent = done ? nf.format(agg.n) + " fights · " + (activePreset ? (E.PRESETS.filter(function (p) { return p.id === activePreset; })[0] || {}).label + " settings" : "custom settings")
      : "Simulated " + nf.format(agg.n) + " of " + nf.format(N_TALLY) + " fights";
    drawBins(agg); drawRounds(agg);
    var tb = $("tbody"); tb.textContent = "";
    for (var i = 0; i < 7; i++) {
      var tr = el("tr"); tr.appendChild(el("td", null, BIN_LABELS[i])); tr.appendChild(el("td", null, pct(b[i] / n))); tr.appendChild(el("td", null, nf.format(b[i]))); tb.appendChild(tr);
    }
    stack.engine = pV / Math.max(1e-6, pV + pG); stack.engineRaw = pV;
    drawStack();
  }

  // ---- charts
  var tipEl = null;
  function tip(container, x, y, html) {
    if (!tipEl) { tipEl = el("div", "tip"); tipEl.hidden = true; }
    if (tipEl.parentNode !== container) container.appendChild(tipEl);
    if (html == null) { tipEl.hidden = true; return; }
    tipEl.textContent = html; tipEl.hidden = false;
    var w = container.clientWidth, tw = tipEl.offsetWidth;
    tipEl.style.left = Math.max(tw / 2, Math.min(w - tw / 2, x)) + "px"; tipEl.style.top = (y - 6) + "px";
  }
  function niceMax(v) { var steps = [10, 20, 25, 40, 50, 60, 80, 100]; for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i]; return 100; }

  function drawBins(agg) {
    var box = $("binsChart"), n = Math.max(1, agg.n), b = agg.bins;
    var W = Math.max(300, Math.round(box.clientWidth || 560)), H = 230, L = 34, R = 8, T = 18, B = 46;
    var vals = b.map(function (x) { return 100 * x / n; });
    var max = niceMax(Math.max.apply(null, vals) * 1.08);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Outcome shares: " + vals.map(function (v, i) { return BIN_LABELS[i] + " " + v.toFixed(1) + "%"; }).join(", ") });
    var plotW = W - L - R, plotH = H - T - B, band = plotW / 7, bw = Math.min(26, band * 0.52);
    var ticks = max <= 40 ? [0, 10, 20, 30, 40].filter(function (t) { return t <= max; }) : [0, 20, 40, 60, 80, 100].filter(function (t) { return t <= max; });
    ticks.forEach(function (t) {
      var y = T + plotH - plotH * t / max;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }));
      var tx = svgEl("text", { x: L - 6, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }); tx.textContent = t + "%"; svg.appendChild(tx);
    });
    vals.forEach(function (v, i) {
      var x = L + band * i + band / 2, h = plotH * v / max, y = T + plotH - h;
      var r = Math.min(4, h / 2);
      var path = "M" + (x - bw / 2) + "," + (T + plotH) + " V" + (y + r) + " Q" + (x - bw / 2) + "," + y + " " + (x - bw / 2 + r) + "," + y + " H" + (x + bw / 2 - r) + " Q" + (x + bw / 2) + "," + y + " " + (x + bw / 2) + "," + (y + r) + " V" + (T + plotH) + " Z";
      svg.appendChild(svgEl("path", { d: h > 0.5 ? path : "M0,0", fill: BIN_COL[i] }));
      var lab = svgEl("text", { x: x, y: y - 5, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "var(--ink)" }); lab.textContent = v >= 0.05 ? v.toFixed(1) : "0"; svg.appendChild(lab);
      var cl = svgEl("text", { x: x, y: T + plotH + 16, "text-anchor": "middle", "font-size": W < 420 ? 10 : 11, fill: "var(--ink-2)" }); cl.textContent = W < 420 && BIN_SHORT[i] === "Decision" ? "Dec" : BIN_SHORT[i]; svg.appendChild(cl);
      var hit = svgEl("rect", { x: L + band * i, y: T, width: band, height: plotH + 20, fill: "transparent" });
      hit.addEventListener("pointerenter", function () { var bb = box.getBoundingClientRect(), s = bb.width / W; tip(box, x * s, y * s, BIN_LABELS[i] + ": " + v.toFixed(1) + "% (" + nf.format(b[i]) + " fights)"); });
      hit.addEventListener("pointerleave", function () { tip(box, 0, 0, null); });
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: T + plotH, y2: T + plotH, stroke: "var(--axis)", "stroke-width": 1 }));
    var gy = H - 8;
    var g1 = svgEl("text", { x: L + band * 1.5, y: gy, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "var(--blue)" }); g1.textContent = "Volkanovski wins"; svg.appendChild(g1);
    var g2 = svgEl("text", { x: L + band * 5.5, y: gy, "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "var(--red)" }); g2.textContent = "Gaethje wins"; svg.appendChild(g2);
    box.textContent = ""; box.appendChild(svg); if (tipEl) tipEl.hidden = true;
  }

  function drawRounds(agg) {
    var box = $("roundChart"), n = Math.max(1, agg.n);
    var W = Math.max(300, Math.round(box.clientWidth || 560)), H = 170, L = 34, R = 8, T = 14, B = 40;
    var a = agg.finA.map(function (x) { return 100 * x / n; }), g = agg.finB.map(function (x) { return 100 * x / n; });
    var max = niceMax(Math.max(Math.max.apply(null, a), Math.max.apply(null, g)) * 1.15);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Finishes by round. Volkanovski: " + a.map(function (v, i) { return "R" + (i + 1) + " " + v.toFixed(1) + "%"; }).join(", ") + ". Gaethje: " + g.map(function (v, i) { return "R" + (i + 1) + " " + v.toFixed(1) + "%"; }).join(", ") });
    var plotW = W - L - R, plotH = H - T - B, band = plotW / 5, bw = Math.min(22, band * 0.28);
    var ticks = [0, max / 2, max];
    ticks.forEach(function (t) {
      var y = T + plotH - plotH * t / max;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }));
      var tx = svgEl("text", { x: L - 6, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }); tx.textContent = (t % 1 ? t.toFixed(1) : t) + "%"; svg.appendChild(tx);
    });
    for (var i = 0; i < 5; i++) {
      [[a[i], "var(--blue)", -1, "Volk"], [g[i], "var(--red)", 1, "Gaethje"]].forEach(function (s) {
        var cx = L + band * i + band / 2 + s[2] * (bw / 2 + 2), h = plotH * s[0] / max, y = T + plotH - h, r = Math.min(4, h / 2);
        var path = "M" + (cx - bw / 2) + "," + (T + plotH) + " V" + (y + r) + " Q" + (cx - bw / 2) + "," + y + " " + (cx - bw / 2 + r) + "," + y + " H" + (cx + bw / 2 - r) + " Q" + (cx + bw / 2) + "," + y + " " + (cx + bw / 2) + "," + (y + r) + " V" + (T + plotH) + " Z";
        svg.appendChild(svgEl("path", { d: h > 0.5 ? path : "M0,0", fill: s[1] }));
        var lab = svgEl("text", { x: cx, y: y - 4, "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: "var(--ink-2)" }); lab.textContent = s[0].toFixed(1); svg.appendChild(lab);
        var rnd = i + 1, who = s[3], val = s[0];
        var hit = svgEl("rect", { x: cx - bw / 2 - 2, y: T, width: bw + 4, height: plotH, fill: "transparent" });
        hit.addEventListener("pointerenter", function () { var bb = box.getBoundingClientRect(), sc = bb.width / W; tip(box, cx * sc, y * sc, who + " finishes in round " + rnd + ": " + val.toFixed(1) + "% of fights"); });
        hit.addEventListener("pointerleave", function () { tip(box, 0, 0, null); });
        svg.appendChild(hit);
      });
      var rl = svgEl("text", { x: L + band * i + band / 2, y: T + plotH + 16, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-2)" }); rl.textContent = (W < 420 ? "R" : "Round ") + (i + 1); svg.appendChild(rl);
    }
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: T + plotH, y2: T + plotH, stroke: "var(--axis)", "stroke-width": 1 }));
    var k1 = svgEl("circle", { cx: L + 6, cy: H - 9, r: 5, fill: "var(--blue)" }); svg.appendChild(k1);
    var k1t = svgEl("text", { x: L + 15, y: H - 5, "font-size": 11.5, fill: "var(--ink-2)" }); k1t.textContent = "Volkanovski finishes"; svg.appendChild(k1t);
    var k2 = svgEl("circle", { cx: L + 150, cy: H - 9, r: 5, fill: "var(--red)" }); svg.appendChild(k2);
    var k2t = svgEl("text", { x: L + 159, y: H - 5, "font-size": 11.5, fill: "var(--ink-2)" }); k2t.textContent = "Gaethje finishes"; svg.appendChild(k2t);
    box.textContent = ""; box.appendChild(svg);
  }

  /* ================================================================ model stack */
  var stack = { engine: 0.5, engineRaw: 0.49, v1: 0.574, elo: 1 / (1 + Math.pow(10, -(1879 - 1869) / 400)), market: 0.357, trust: 0.4 };
  function logit(p) { p = Math.min(0.999, Math.max(0.001, p)); return Math.log(p / (1 - p)); }
  function blend() {
    var wM = stack.trust, wE = (1 - wM) * 2 / 3, wL = (1 - wM) / 3;
    var z = wM * logit(stack.market) + wE * logit(stack.engine) + wL * logit(stack.elo);
    return 1 / (1 + Math.exp(-z));
  }
  function drawStack() {
    var box = $("stackChart"), b = blend();
    var rows = [
      { l: "Fight engine v2", s: "your knob settings, 20,000 fights", v: stack.engineRaw },
      { l: "Fight engine v1", s: "round-by-round model, earlier tonight", v: stack.v1 },
      { l: "Elo ratings", s: "Combat Edge, 1879 vs 1869", v: stack.elo },
      { l: "Betting market", s: "opening line, margin removed", v: stack.market },
      { l: "The blend", s: "my number", v: b, strong: true }
    ];
    var W = Math.max(300, Math.round(box.clientWidth || 560)), narrow = W < 500;
    var rowH = narrow ? 58 : 46, T = 10, H = T + rows.length * rowH + 26, L = 0, X0 = narrow ? 4 : 236, X1 = W - 50;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Volkanovski's chance by source: " + rows.map(function (r) { return r.l + " " + (100 * r.v).toFixed(0) + "%"; }).join(", ") });
    function xOf(v) { return X0 + (X1 - X0) * v; }
    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      var x = xOf(t);
      svg.appendChild(svgEl("line", { x1: x, x2: x, y1: T, y2: T + rows.length * rowH, stroke: t === 0.5 ? "var(--axis)" : "var(--line)", "stroke-width": 1, "stroke-dasharray": t === 0.5 ? "3 3" : "" }));
      var tx = svgEl("text", { x: x, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }); tx.textContent = Math.round(t * 100) + "%"; svg.appendChild(tx);
    });
    rows.forEach(function (r, i) {
      var y = narrow ? T + i * rowH + 40 : T + i * rowH + rowH / 2;
      var t1 = svgEl("text", { x: L, y: narrow ? y - 22 : y - 3, "font-size": 13, "font-weight": r.strong ? 800 : 700, fill: "var(--ink)" }); t1.textContent = r.l; svg.appendChild(t1);
      var t2 = svgEl("text", { x: narrow ? L + (r.l.length * 7.6 + 8) : L, y: narrow ? y - 22 : y + 12, "font-size": 10.5, fill: "var(--muted)" }); t2.textContent = r.s; svg.appendChild(t2);
      svg.appendChild(svgEl("line", { x1: xOf(0), x2: xOf(r.v), y1: y, y2: y, stroke: r.strong ? "var(--ink)" : "var(--axis)", "stroke-width": r.strong ? 3 : 2 }));
      svg.appendChild(svgEl("circle", { cx: xOf(r.v), cy: y, r: r.strong ? 7 : 5.5, fill: r.strong ? "var(--ink)" : "var(--blue)" }));
      var tv = svgEl("text", { x: X1 + 10, y: y + 4, "font-size": 13, "font-weight": 700, fill: "var(--ink)" }); tv.textContent = (100 * r.v).toFixed(0) + "%"; svg.appendChild(tv);
    });
    box.textContent = ""; box.appendChild(svg);
    $("o-trust").textContent = Math.round(stack.trust * 100) + "%";
    $("blendOut").textContent = "Volkanovski " + Math.round(100 * b) + "%, Gaethje " + (100 - Math.round(100 * b)) + "%";
    $("blendNote").textContent = "Weights: market " + Math.round(stack.trust * 100) + "%, fight engine " + Math.round((1 - stack.trust) * 200 / 3) + "%, Elo " + Math.round((1 - stack.trust) * 100 / 3) + "%. Draws set aside.";
  }
  $("k-trust").addEventListener("input", function () { stack.trust = +this.value; drawStack(); });
  var chartW = 0, redrawT = null;
  function redrawCharts() { if (lastAgg) { drawBins(lastAgg); drawRounds(lastAgg); } drawStack(); }
  if (window.ResizeObserver) new ResizeObserver(function (es) {
    var w = Math.round(es[0].contentRect.width);
    if (Math.abs(w - chartW) > 8) { chartW = w; clearTimeout(redrawT); redrawT = setTimeout(redrawCharts, 120); }
  }).observe($("binsChart"));

  /* ================================================================ backtest */
  var BT = [
    { f: "Volkanovski vs Lopes 2", ev: "UFC 325 · Jan 31, 2026", res: "Volkanovski, decision", w: "v", eng: 0.578, mkt: 0.572 },
    { f: "Gaethje vs Pimblett", ev: "UFC 324 · Jan 24, 2026", res: "Gaethje, decision", w: "g", eng: 0.412, mkt: 0.336 },
    { f: "Gaethje vs Topuria", ev: "UFC Freedom 250 · Jun 14, 2026", res: "Gaethje, corner TKO R4", w: "g", eng: 0.217, mkt: 0.175 },
    { f: "Gaethje vs Holloway", ev: "UFC 300 · Apr 13, 2024", res: "Holloway, KO R5", w: "o", eng: 0.501, mkt: 0.407 },
    { f: "Volkanovski vs Topuria", ev: "UFC 298 · Feb 17, 2024", res: "Topuria, KO R2", w: "o", eng: 0.731, mkt: 0.466 },
    { f: "Volkanovski vs Evloev", ev: "UFC 333 · Oct 24, 2026", res: "Volkanovski, TKO R2", w: "v", eng: 0.385, mkt: 0.5 },
    { f: "Volkanovski vs Lopes 1", ev: "UFC 314 · Apr 12, 2025", res: "Volkanovski, decision", w: "v", eng: 0.578, mkt: 0.564 }
  ];
  (function buildBacktest() {
    var tb = $("btBody"), be = 0, bm = 0, le = 0, lm = 0;
    BT.forEach(function (r) {
      var tr = el("tr");
      var td1 = el("td"); td1.appendChild(el("div", null, r.f)); td1.appendChild(el("div", "small", r.ev));
      var chip = el("div", "res-wrap"); chip.appendChild(el("span", "res " + r.w, r.res)); td1.appendChild(chip); tr.appendChild(td1);
      [[r.eng, ""], [r.mkt, " m"]].forEach(function (p) {
        var td = el("td", "p"), d = el("div", "pbar" + p[1]), i = el("i"); i.style.width = Math.round(p[0] * 56) + "px";
        d.appendChild(el("span", null, Math.round(p[0] * 100) + "%")); d.appendChild(i); td.appendChild(d); tr.appendChild(td);
      });
      tb.appendChild(tr);
      be += (1 - r.eng) * (1 - r.eng); bm += (1 - r.mkt) * (1 - r.mkt); le -= Math.log(r.eng); lm -= Math.log(r.mkt);
    });
    var n = BT.length;
    $("btSummary").textContent = "Average Brier score, lower is better: engine " + (be / n).toFixed(3) + ", market " + (bm / n).toFixed(3) + ". Log loss: " + (le / n).toFixed(2) + " vs " + (lm / n).toFixed(2) + ". The engine favored the eventual winner in 4 of 7 fights; the betting favorite won 2, with one pick'em.";
  })();

  /* ================================================================ scouting bars + diagram */
  function stackbar(id, parts) {
    var box = $(id); box.textContent = "";
    var cls = ["t-h", "t-b", "t-l", "t-g"];
    parts.forEach(function (p, i) {
      var s = el("span", cls[i], p[1] >= 40 ? p[0] + " " + p[1] + "%" : (p[1] >= 8 ? p[1] + "%" : ""));
      s.style.width = p[1] + "%"; s.title = p[0] + " " + p[1] + "%";
      s.style.color = i < 3 ? "var(--bg)" : "var(--ink)";
      box.appendChild(s);
    });
    box.setAttribute("role", "img"); box.setAttribute("aria-label", parts.map(function (p) { return p[0] + " " + p[1] + "%"; }).join(", "));
  }
  stackbar("vTgt", [["Head", 63], ["Body", 11], ["Legs", 26]]);
  stackbar("gTgt", [["Head", 63], ["Body", 9], ["Legs", 28]]);
  stackbar("vPos", [["Distance", 75], ["Clinch", 9], ["Ground", 16]]);
  stackbar("gPos", [["Distance", 86], ["Clinch", 12], ["Ground", 2]]);

  (function diagram() {
    var W = 680, H = 300, svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "State diagram: fighters move between distance and the clinch, takedowns take them to the ground, stand-ups bring them back, and knockdowns, ground strikes, leg kicks or submissions end the fight." });
    var defs = svgEl("defs", {}), mk = svgEl("marker", { id: "ah", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    mk.appendChild(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--ink-2)" })); defs.appendChild(mk); svg.appendChild(defs);
    function path(d) { svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: "var(--ink-2)", "stroke-width": 1.4, "marker-end": "url(#ah)" })); }
    function label(x, y, txt, anchor) { var t = svgEl("text", { x: x, y: y, "text-anchor": anchor || "middle", "font-size": 12, fill: "var(--muted)" }); t.textContent = txt; svg.appendChild(t); }
    function node(cx, cy, w, h, l1, l2, fill) {
      svg.appendChild(svgEl("rect", { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 6, fill: fill || "var(--surface)", stroke: "var(--ink)", "stroke-width": 1.2 }));
      var t = svgEl("text", { x: cx, y: cy + (l2 ? -2 : 5), "text-anchor": "middle", "font-size": 14, "font-weight": 700, fill: "var(--ink)" }); t.textContent = l1; svg.appendChild(t);
      if (l2) { var t2 = svgEl("text", { x: cx, y: cy + 14, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }); t2.textContent = l2; svg.appendChild(t2); }
    }
    // distance <-> clinch
    path("M96,102 L96,198"); path("M124,198 L124,102");
    label(140, 146, "clinch: about 0.45 a minute", "start"); label(140, 162, "break: about 15 seconds", "start");
    // takedowns and stand-ups
    path("M186,212 L276,170"); label(250, 214, "takedown");
    path("M186,96 L276,132"); label(214, 132, "takedown");
    path("M330,124 Q300,56 188,72"); label(300, 66, "stand-up");
    // finishes
    path("M110,60 Q330,-6 540,128"); label(330, 30, "knockdown finish, leg-kick TKO");
    path("M110,240 Q330,306 540,172"); label(330, 286, "knockdown finish");
    path("M446,150 L518,150"); label(482, 138, "strikes,"); label(482, 170, "submission");
    node(110, 80, 150, 40, "Distance"); node(110, 220, 150, 40, "Clinch");
    node(360, 150, 170, 52, "On the ground", "either man on top"); node(590, 150, 140, 40, "Fight over", null, "var(--sunk)");
    $("diagram").appendChild(svg);
  })();

  /* ================================================================ live HUD */
  var cur = null, hudPending = false;
  function resetHud(sc) {
    cur = { land: { A: [0, 0, 0, 0], B: [0, 0, 0, 0] }, kd: { A: 0, B: 0 }, hurt: { A: 0, B: 0 }, td: { A: 0, B: 0 }, tda: { A: 0, B: 0 }, ctrl: { A: 0, B: 0 }, lastClock: 0, round: 0, cards: [[], [], []], meters: { dA: 0, dB: 0, gA: 0, gB: 0, sA: 1, sB: 1 } };
    $("pbp").textContent = ""; $("banner").hidden = true; $("toast").hidden = true; $("roundCard").hidden = true; $("replayOv").hidden = true;
    renderCards(); renderStats(); setRound(0); $("bugClock").lastChild.nodeValue = "5:00";
    var f = sc.form, form = $("form"); form.textContent = "";
    [["A", "v", f.outA, f.powA, f.chinA], ["B", "g", f.outB, f.powB, f.chinB]].forEach(function (x) {
      var c = el("span", "fchip " + x[1]); var b = el("b", null, SHORT[x[0]]); c.appendChild(b);
      c.appendChild(document.createTextNode(" output " + signed(x[2]) + " · power " + signed(x[3]) + " · chin " + signed(x[4])));
      c.title = "This fight's draw of " + NAMES[x[0]] + "'s form, against his settings"; form.appendChild(c);
    });
  }
  function scheduleHud() { if (!hudPending) { hudPending = true; requestAnimationFrame(function () { hudPending = false; renderStats(); }); } }
  function renderStats() {
    ["A", "B"].forEach(function (w) {
      var L = cur.land[w], tot = L[0] + L[1] + L[2] + L[3];
      $("land" + w).firstChild.nodeValue = tot;
      $("bug" + w).textContent = tot;
      var spans = $("tgt" + w).children;
      for (var i = 0; i < 4; i++) spans[i].style.width = (tot ? 100 * L[i] / tot : (i === 0 ? 0 : 0)) + "%";
      var row = $("row" + w); row.textContent = "";
      [["KD", cur.kd[w]], ["Rocked", cur.hurt[w]], ["TD", cur.td[w] + "/" + cur.tda[w]], ["Control", mmss(cur.ctrl[w])]].forEach(function (p) {
        var s = el("span"); var b = el("b", null, String(p[1])); s.appendChild(b); s.appendChild(document.createTextNode(" " + p[0])); row.appendChild(s);
      });
      var dots = $("kdDots" + w); if (dots.children.length !== cur.kd[w]) { dots.textContent = ""; for (var k = 0; k < cur.kd[w]; k++) dots.appendChild(el("i")); }
    });
    var M = cur.meters;
    $("mHeadA").style.width = Math.min(100, M.dA / 1.4) + "%"; $("mHeadB").style.width = Math.min(100, M.dB / 1.4) + "%";
    $("mLegA").style.width = Math.min(100, M.gA * 2.2) + "%"; $("mLegB").style.width = Math.min(100, M.gB * 2.2) + "%";
    $("mGasA").style.width = Math.max(0, Math.min(100, M.sA * 100)) + "%"; $("mGasB").style.width = Math.max(0, Math.min(100, M.sB * 100)) + "%";
  }
  function setRound(r) {
    cur.round = r;
    $("bugRound").textContent = "R" + (r + 1);
    var pips = $("pips").children;
    for (var i = 0; i < 5; i++) pips[i].className = "pip" + (i < r ? " done" : (i === r ? " on" : ""));
  }
  function renderCards() {
    var box = $("cards"); box.textContent = "";
    for (var j = 0; j < 3; j++) {
      var t = el("table", "card"); var cap = el("caption", null, "Judge " + (j + 1)); t.appendChild(cap);
      var th = el("thead"), hr = el("tr"); hr.appendChild(el("th")); var a = el("th"); a.appendChild(el("span", "disc disc-v", "V")); var b = el("th"); b.appendChild(el("span", "disc disc-g", "G")); hr.appendChild(a); hr.appendChild(b); th.appendChild(hr); t.appendChild(th);
      var tb = el("tbody"), sa = 0, sb = 0;
      cur.cards[j].forEach(function (sc, i) {
        var tr = el("tr"); tr.appendChild(el("th", null, "R" + (i + 1)));
        var ca = el("td", sc[0] > sc[1] ? "won" : null, String(sc[0])), cb = el("td", sc[1] > sc[0] ? "won" : null, String(sc[1]));
        tr.appendChild(ca); tr.appendChild(cb); tb.appendChild(tr); sa += sc[0]; sb += sc[1];
      });
      if (!cur.cards[j].length) { var tr0 = el("tr"); var td0 = el("td", null, "–"); td0.colSpan = 3; tr0.appendChild(td0); tb.appendChild(tr0); }
      t.appendChild(tb);
      if (cur.cards[j].length) { var tf = el("tfoot"), fr = el("tr"); fr.appendChild(el("th", null, "Total")); fr.appendChild(el("td", null, String(sa))); fr.appendChild(el("td", null, String(sb))); tf.appendChild(fr); t.appendChild(tf); }
      box.appendChild(t);
    }
  }
  function addPbp(r, t, txt, cls) {
    var ol = $("pbp"), li = el("li", cls || null);
    li.appendChild(el("span", "ts", t == null ? "R" + (r + 1) : "R" + (r + 1) + " " + clockOf(t)));
    li.appendChild(el("span", null, txt));
    ol.insertBefore(li, ol.firstChild);
    while (ol.children.length > 40) ol.removeChild(ol.lastChild);
  }
  var toastTimer = null, cardTimer = null;
  function toast(txt, w, ms) {
    var t = $("toast"); t.textContent = txt; t.dataset.w = w; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 1600);
  }
  function roundCard(head, sub, ms) {
    $("rcHead").textContent = head; $("rcSub").textContent = sub || ""; $("roundCard").hidden = false;
    clearTimeout(cardTimer); cardTimer = setTimeout(function () { $("roundCard").hidden = true; }, ms || 1800);
  }
  var METHOD = { KO: "KO/TKO", GNP: "TKO, ground strikes", LEG: "TKO, leg kicks", CORNER: "TKO, corner stoppage", SUB: "Submission", UD: "Unanimous decision", SD: "Split decision", MD: "Majority decision" };
  function cardsText(cards) { return cards.map(function (c) { return Math.max(c[0], c[1]) + "–" + Math.min(c[0], c[1]); }).join(", "); }

  var autoNext = null;
  var hooks = {
    onBeat: function (b) {
      if (!cur) return;
      if (b.k === "strike" && b.landed) {
        var idx = b.st >= 2 ? 3 : b.tgt; cur.land[b.who][idx]++;
        if (b.kd) cur.kd[b.who]++; if (b.hurt) cur.hurt[b.who]++;
        if (b.ev && b.ev.dA != null) { var M = cur.meters; M.dA = b.ev.dA; M.dB = b.ev.dB; M.gA = b.ev.gA; M.gB = b.ev.gB; M.sA = b.ev.sA; M.sB = b.ev.sB; }
      } else if (b.k === "td") { cur.td[b.who]++; cur.tda[b.who]++; toast("Takedown · " + SHORT[b.who], b.who, 1300); }
      else if (b.k === "tdx") cur.tda[b.who]++;
      scheduleHud();
    },
    onImpact: function (b) {
      if (b.kd) toast("Knockdown · " + SHORT[b.who], b.who, 1800);
      else if (b.hurt) toast("Rocked · " + SHORT[b.who], b.who, 1300);
      else if (b.fin) toast("It's over", b.who, 2200);
    },
    onText: function (b, r, t) { addPbp(r, t, b.txt, b.kd || b.fin || b.k === "sub" ? "big" : null); },
    onClock: function (r, t, state, owner) {
      if (!cur) return;
      if (state === "ground" && owner) cur.ctrl[owner] += Math.max(0, t - cur.lastClock);
      cur.lastClock = t;
      var c = clockOf(t); var node = $("bugClock").lastChild; if (node.nodeValue !== c) node.nodeValue = c;
      if (state === "ground") scheduleHud();
    },
    onPhase: function (p, r) {
      if (!cur) return;
      if (p === "intro") { setRound(r); cur.lastClock = 0; $("bugClock").lastChild.nodeValue = "5:00"; roundCard(r === 4 ? "Final round" : "Round " + (r + 1), r === 0 ? "Five rounds · 155 lb" : "", 1700); }
    },
    onRoundEnd: function (r, rd) {
      var st = rd.st, la = st.hA + st.bA + st.lA + st.gA, lb = st.hB + st.bB + st.lB + st.gB;
      if (rd.judges) { for (var j = 0; j < 3; j++) cur.cards[j].push(rd.judges[j]); renderCards(); }
      var cards = rd.judges ? rd.judges.map(function (s) { return s[0] + "–" + s[1]; }).join(", ") : "";
      addPbp(r, null, "End of round " + (r + 1) + ". Landed: Volk " + la + ", Gaethje " + lb + ". Cards for Volk: " + cards + ".", "rnd");
      roundCard("End of round " + (r + 1), "Volk " + la + " – " + lb + " Gaethje landed · " + cards, 2600);
      if (rd.stoppage) addPbp(r, null, "The corner stops it. " + NAMES[rd.stoppage === "A" ? "B" : "A"] + " can't continue.", "big");
    },
    onFinish: function () {},
    onDecision: function (sc) { addPbp(4, null, "To the scorecards: " + sc.cards.map(function (c) { return c[0] + "–" + c[1]; }).join(", ") + " for Volkanovski.", "big"); },
    onReplay: function (on) { $("replayOv").hidden = !on; },
    onResult: function (res) {
      var sc = script, w = res.winner || sc.winner, m = res.method || sc.method;
      var bn = $("banner"); bn.dataset.w = w;
      if (w === "D") { $("bHead").textContent = "Draw"; $("bSub").textContent = (m === "UD" ? "Unanimous" : m === "MD" ? "Majority" : "Split") + " draw · " + cardsText(sc.cards); }
      else {
        $("bHead").textContent = NAMES[w] + " wins";
        var dec = m === "UD" || m === "SD" || m === "MD";
        $("bSub").textContent = (METHOD[m] || m) + (dec ? " · " + cardsText(sc.cards) : " · round " + res.round + (m === "CORNER" ? "" : ", " + mmss(res.t)));
      }
      bn.hidden = false;
      clearTimeout(autoNext);
      autoNext = setTimeout(function () { if (show && !show.paused && visible) newFight(); }, 11000);
    }
  };

  /* ================================================================ the show */
  var show = null, script = null, visible = true, textMode = false;
  function TextShow(h) { this.hooks = h; this.speed = 5; this.paused = false; this.replays = false; this.cam = { mode: "auto", label: "Play-by-play", user: {} }; }
  TextShow.prototype.load = function (sc) { this.sc = sc; this.r = 0; this.q = sc.rounds[0].beats.slice(); this.t = 0; this.done = false; this.wait = 0.8; this.hooks.onPhase("intro", 0); };
  TextShow.prototype.frame = function (dt) {
    if (this.paused || this.done) return;
    if (this.wait > 0) { this.wait -= dt; return; }
    var rd = this.sc.rounds[this.r]; this.t = Math.min(rd.endT, this.t + dt * this.speed);
    while (this.q.length && this.q[0].t <= this.t) {
      var b = this.q.shift(); this.hooks.onBeat(b, this.r); if (b.txt) this.hooks.onText(b, this.r, b.t);
      if (b.kd || b.hurt || b.fin) this.hooks.onImpact(b);
    }
    this.hooks.onClock(this.r, this.t, "stand", null);
    if (this.t >= rd.endT && !this.q.length) {
      if (rd.fin) { this.done = true; this.hooks.onResult({ winner: rd.fin.by, method: this.sc.method, round: this.r + 1, t: rd.fin.t }); return; }
      this.hooks.onRoundEnd(this.r, rd);
      if (rd.stoppage) { this.done = true; this.hooks.onResult({ winner: rd.stoppage, method: "CORNER", round: this.r + 1, t: 300 }); return; }
      if (this.r >= 4) { this.done = true; this.hooks.onDecision(this.sc); this.hooks.onResult({ winner: this.sc.winner, method: this.sc.method, round: 5, t: 300 }); return; }
      this.r++; this.q = this.sc.rounds[this.r].beats.slice(); this.t = 0; this.wait = 1.2; this.hooks.onPhase("intro", this.r);
    }
  };
  TextShow.prototype.resize = function () {}; TextShow.prototype.skip = function () { return false; };

  var stage = $("stage"), canvas = $("gl");
  try {
    if (!window.THREE || !FS) throw new Error("no three");
    var small = Math.min(window.innerWidth, window.innerHeight) < 600;
    show = new FS.Show(canvas, hooks, { maxDpr: 1.75, shadow: small ? 1024 : 2048 });
  } catch (e) {
    show = new TextShow(hooks); textMode = true; $("noGl").hidden = false; $("camLabel").hidden = true;
  }

  function newFight() {
    clearTimeout(autoNext);
    var sd = newSeed();
    var f = E.simulate(E.volkGaethje(knobs), E.makeRng(sd), true);
    script = FD.build(f, sd);
    resetHud(script);
    if (show.cam && show.cam.mode === "free" && !textMode) { /* keep user camera */ }
    show.load(script);
  }

  function sizeStage() {
    if (textMode) return;
    var r = stage.getBoundingClientRect();
    show.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
  }
  if (window.ResizeObserver) new ResizeObserver(sizeStage).observe(stage); else window.addEventListener("resize", sizeStage);
  sizeStage();
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(stage);

  var last = performance.now(), lastLabel = "";
  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (visible && !document.hidden) {
      show.frame(dt);
      if (!textMode && show.cam.label !== lastLabel) { lastLabel = show.cam.label; $("camLabel").textContent = lastLabel; }
    }
    requestAnimationFrame(loop);
  }

  // controls
  $("btnNew").addEventListener("click", newFight);
  $("btnAgain").addEventListener("click", newFight);
  $("btnPlay").addEventListener("click", function () {
    show.paused = !show.paused; this.textContent = show.paused ? "Play" : "Pause";
  });
  $("btnSkip").addEventListener("click", function () { show.skip(); });
  Array.prototype.forEach.call($("speedSeg").children, function (b) {
    b.addEventListener("click", function () {
      show.speed = +b.dataset.speed;
      Array.prototype.forEach.call($("speedSeg").children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    });
  });
  Array.prototype.forEach.call($("camSeg").children, function (b) {
    b.addEventListener("click", function () {
      if (textMode) return;
      show.cam.mode = b.dataset.cam;
      canvas.classList.toggle("free", show.cam.mode === "free");
      Array.prototype.forEach.call($("camSeg").children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    });
  });
  $("replayTog").addEventListener("change", function () { show.replays = this.checked; });

  // free camera: drag to orbit, wheel or pinch to zoom
  var ptrs = {}, pinch0 = 0;
  canvas.addEventListener("pointerdown", function (e) { if (textMode || show.cam.mode !== "free") return; ptrs[e.pointerId] = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", function (e) {
    if (!ptrs[e.pointerId]) return;
    var ids = Object.keys(ptrs), u = show.cam.user;
    if (ids.length === 1) {
      var p = ptrs[e.pointerId], dx = e.clientX - p[0], dy = e.clientY - p[1];
      u.az += dx * 0.008; u.el = Math.max(0.06, Math.min(1.4, u.el + dy * 0.006));
    } else if (ids.length === 2) {
      ptrs[e.pointerId] = [e.clientX, e.clientY];
      var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0) u.dist = Math.max(5, Math.min(18, u.dist * pinch0 / Math.max(1, d)));
      pinch0 = d; return;
    }
    ptrs[e.pointerId] = [e.clientX, e.clientY];
  });
  function up(e) { delete ptrs[e.pointerId]; pinch0 = 0; }
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", function (e) {
    if (textMode || show.cam.mode !== "free") return;
    e.preventDefault(); var u = show.cam.user; u.dist = Math.max(5, Math.min(18, u.dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  // repaint the canvas lettering once the display font is ready
  if (!textMode && document.fonts && document.fonts.load) {
    document.fonts.load('900 64px "Big Shoulders Display"').then(function () { try { show.arena.repaintMat(); } catch (e) {} }, function () {});
  }

  window.VGSim = { show: show, newFight: newFight };

  // boot
  syncKnobs();
  drawStack();
  startTally();
  newFight();
  if (reduce) { show.paused = true; $("btnPlay").textContent = "Play"; show.frame(0.016); }
  requestAnimationFrame(loop);
})();
