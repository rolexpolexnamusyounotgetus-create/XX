/* Fight Lab page controller: matchup pickers, tale of the tape, live 3D fight and HUD, the 20,000-fight
   tally (blob Web Worker built from the engine script's own text), knobs and scenarios, the engine's
   explanation, the model stack, the backtest panel and the shareable matchup link.
   Talks to the engine only through FightEngine (loadDB, matchup, simulate, explain, makeRng, manualProfile)
   and to the 3D show only through FightShow.Show (load, frame, resize, hooks, speed / cam / replays / paused). */
(function () {
  "use strict";
  var E = window.FightEngine, FS = window.FightShow;
  var $ = function (id) { return document.getElementById(id); };
  function fail(msg) {
    var app = $("app"); if (!app) return;
    var d = document.createElement("p"); d.className = "err"; d.setAttribute("role", "alert"); d.textContent = msg;
    app.insertBefore(d, app.children[1] || null);
  }
  if (!E || !E.matchup) { fail("The fight engine did not load, so the simulator can't run. Rebuild the page with python3 build.py."); return; }

  /* ================================================================ helpers */
  var reduce = false;
  try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* default */ }
  var nf = new Intl.NumberFormat("en-US");
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pct(x, d) { return x == null || !isFinite(x) ? "–" : (100 * x).toFixed(d == null ? 1 : d) + "%"; }
  function fx(x, d) { return x == null || !isFinite(x) ? "–" : (+x).toFixed(d == null ? 2 : d); }
  function mmss(sec) { var s = Math.max(0, Math.round(sec)); var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }
  function clockOf(t) { return mmss(Math.ceil(300 - t - 1e-9)); }
  function newSeed() { try { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0; } catch (e) { return (Math.random() * 4294967296) >>> 0; } }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function svgEl(tag, attrs) { var e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function svgText(svg, x, y, txt, attrs) { var a = { x: x, y: y }; for (var k in attrs) a[k] = attrs[k]; var t = svgEl("text", a); t.textContent = txt; svg.appendChild(t); return t; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function signedPct(x) { var v = Math.round((x - 1) * 100); return (v > 0 ? "+" : (v < 0 ? "−" : "±")) + Math.abs(v) + "%"; }
  function mult(v) { return "×" + (+v).toFixed(2); }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function fmtDate(iso, short) {
    if (!iso) return "–"; var p = String(iso).split("-"); if (p.length < 3) return iso;
    var m = MONTHS[+p[1] - 1] || p[1];
    return short ? m + " " + p[0] : m + " " + (+p[2]) + ", " + p[0];
  }
  function ageOn(dob, now) {
    if (!dob) return null; var a = Date.parse(dob), b = now ? Date.parse(now) : Date.now();
    if (!isFinite(a)) return null; return (b - a) / (365.2425 * 86400000);
  }
  function inches(v) { if (!v) return "–"; var ft = Math.floor(v / 12), i = Math.round(v - ft * 12); return ft + "′" + i + "″"; }
  function lastName(name) {
    var t = String(name || "").trim().split(/\s+/); if (!t.length) return "Fighter";
    var l = t[t.length - 1]; if (t.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(l)) l = t[t.length - 2];
    return l;
  }
  function initials(name) { var t = String(name || "").trim().split(/\s+/); return ((t[0] || "?")[0] + (t.length > 1 ? lastName(name)[0] : "")).toUpperCase(); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function slugify(s) { return norm(s).replace(/ /g, "-"); }
  function other(w) { return w === "A" ? "B" : "A"; }
  function readJSON(id, fallback) {
    var n = $(id); if (!n) return fallback;
    try { var d = JSON.parse(n.textContent); return d == null ? fallback : d; } catch (e) { return fallback; }
  }
  function linkList(box, sources, max) {
    var seen = {}, n = 0;
    (sources || []).forEach(function (s) {
      var url = typeof s === "string" ? s : s && s.url, label = typeof s === "string" ? null : s && s.label;
      if (!url && !label) return;
      var key = url || label; if (seen[key] || (max && n >= max)) return; seen[key] = 1; n++;
      if (url && /^https?:\/\//.test(url)) {
        var a = el("a", null, label || hostOf(url)); a.href = url; a.target = "_blank"; a.rel = "noopener"; box.appendChild(a);
      } else box.appendChild(el("span", null, label || url));
    });
    return n;
  }
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; } }

  /* ================================================================ data */
  var DBJ = readJSON("fighters-db", null);
  var CALIB = readJSON("calib-db", null);
  var SCEN = readJSON("scenarios-db", {}) || {};
  var OVR = readJSON("overrides-db", {}) || {};
  var SCOUTDB = readJSON("scouting-db", {}) || {};
  var SCOUT = SCOUTDB.scouting || {}, LIKE = SCOUTDB.likeness || {};
  var DB = null;
  try { DB = E.loadDB(DBJ); } catch (e) { fail("The fighter roster didn't load (" + e.message + "). Rebuild the page with python3 build.py."); return; }
  var P0 = E.params ? E.params() : window.FightParams;
  var JP0 = P0 && P0.judge && P0.judge.power != null ? P0.judge.power : 0.25;
  (function applyOverrides() {
    var fo = OVR.fighters || {}, k, f, s;
    for (s in fo) {
      f = DB.fighters[s]; if (!f) continue;
      for (k in fo[s]) if (k !== "appearance" && k !== "_note" && fo[s][k] != null) f[k] = fo[s][k];
    }
    var man = OVR.manual || {};
    for (s in man) {
      try {
        var r = man[s] || {}, prof = E.manualProfile(r.rates || r, { division: r.division, slug: s, name: r.name });
        prof.slug = s; DB.fighters[s] = prof;
      } catch (e) { /* skip a bad manual entry */ }
    }
  })();
  var PRI = DB.priors || {};
  var DIVS = Object.keys(PRI).filter(function (d) { return d !== "ALL" && d !== "Catch Weight" && d !== "Open Weight" && PRI[d] && PRI[d].lbs; });
  DIVS.sort(function (a, b) {
    var wa = /^Women/.test(a) ? 1 : 0, wb = /^Women/.test(b) ? 1 : 0;
    return wa - wb || PRI[a].lbs - PRI[b].lbs;
  });
  function divLbs(d) { return PRI[d] && PRI[d].lbs || null; }
  function divOrder(d) { var i = DIVS.indexOf(d); return i < 0 ? 99 : i; }
  function divShort(d) { return String(d || "").replace("Women's ", "W ").replace("Light Heavyweight", "Light Heavy"); }

  // roster index for the pickers
  var ROSTER = Object.keys(DB.fighters).map(function (slug) {
    var f = DB.fighters[slug], rec = f.record || {};
    var last = f.recent && f.recent[0];
    return { slug: slug, name: f.name || slug, nick: f.nick || "", div: f.division || "Unknown", elo: f.elo || 0,
      rec: rec.w != null ? rec.w + "-" + rec.l + (rec.d ? "-" + rec.d : "") : "",
      last: last ? last.res + " vs " + last.opp + ", " + fmtDate(last.date, true) : (f.last_fight ? fmtDate(f.last_fight, true) : ""),
      n: norm(f.name), ln: norm(lastName(f.name)), nk: norm(f.nick) };
  });

  /* ================================================================ state */
  var DEFAULT = { a: "alexander-volkanovski", b: "justin-gaethje" };
  if (!DB.fighters[DEFAULT.a] || !DB.fighters[DEFAULT.b]) {
    var top = ROSTER.slice().sort(function (x, y) { return y.elo - x.elo; });
    DEFAULT = { a: top[0].slug, b: top[1].slug };
  }
  var S = { a: DEFAULT.a, b: DEFAULT.b, div: "Lightweight", rounds: 5, title: true,
    adj: { A: {}, B: {} }, judgePower: JP0, scen: null, odds: { A: "", B: "" }, trust: null, tab: "A" };
  var cur = { m: null, x: null, err: null };

  function prof(side) { return DB.fighters[side === "A" ? S.a : S.b]; }
  function slugOf(side) { return side === "A" ? S.a : S.b; }
  function nameOf(side) { var p = prof(side); return p ? p.name : side; }
  function shortOf(side) { return lastName(nameOf(side)); }
  function pron(side) { var p = prof(side), d = S.div || (p && p.division) || ""; return /^Women/.test(d) || /^Women/.test(p && p.division || "") ? { he: "she", his: "her", him: "her" } : { he: "he", his: "his", him: "him" }; }

  function pairData(a, b) {
    var M = SCEN.matchups || {};
    return M[a + "|" + b] || M[b + "|" + a] || null;
  }
  function defaultDivision(a, b) {
    var pa = DB.fighters[a], pb = DB.fighters[b];
    var da = pa && pa.division, db = pb && pb.division;
    var la = divLbs(da) || 0, lb = divLbs(db) || 0;
    var d = la >= lb ? da : db;
    return DIVS.indexOf(d) >= 0 ? d : (DIVS.indexOf(da) >= 0 ? da : (DIVS.indexOf(db) >= 0 ? db : "Lightweight"));
  }
  function applyPairDefaults() {
    var pd = pairData(S.a, S.b);
    if (pd && pd.defaults) {
      S.div = pd.defaults.division && DIVS.indexOf(pd.defaults.division) >= 0 ? pd.defaults.division : defaultDivision(S.a, S.b);
      S.rounds = pd.defaults.rounds || 3; S.title = !!pd.defaults.title;
    } else {
      S.div = defaultDivision(S.a, S.b); S.rounds = 3; S.title = false;
    }
    S.adj = { A: {}, B: {} }; S.judgePower = JP0; S.scen = null; S.trust = null;
    var mk = pd && pd.market && pd.market.odds;
    S.odds = { A: mk && mk[S.a] || "", B: mk && mk[S.b] || "" };
    var defId = pd && pd.default_scenario;
    if (defId) { var sc = scenarioList().filter(function (x) { return x.id === defId; })[0]; if (sc) applyScenarioState(sc); }
  }

  /* ---- shareable link: a plain #name (the artifact host passes only letters, digits and hyphens) */
  function hashFor() {
    return "#" + S.a + "-vs-" + S.b + "-at-" + slugify(S.div) + "-" + S.rounds + "r" + (S.title ? "-title" : "");
  }
  function parseHash(h) {
    h = String(h || "").replace(/^#/, ""); if (!h) return null;
    var out = {};
    if (h.indexOf("=") >= 0) {
      h.split("&").forEach(function (kv) { var p = kv.split("="); out[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); });
      var r = { a: out.a, b: out.b, div: out.div, rounds: out.r ? +out.r : null, title: out.title != null ? out.title === "1" || out.title === "true" : null };
      return r.a && r.b ? r : null;
    }
    var m = /^(.+?)-vs-(.+)-at-([a-z0-9-]+?)-(3|5)r(-title)?$/.exec(h);
    if (!m) { var m2 = /^(.+?)-vs-(.+)$/.exec(h); return m2 ? { a: m2[1], b: m2[2] } : null; }
    var div = null; DIVS.forEach(function (d) { if (slugify(d) === m[3]) div = d; });
    return { a: m[1], b: m[2], div: div, rounds: +m[4], title: !!m[5] };
  }
  var hashWriting = false;
  function writeHash() {
    var h = hashFor(); if (location.hash === h) return;
    hashWriting = true;
    try { history.replaceState(null, "", h); } catch (e) { try { location.hash = h; } catch (e2) { /* ignore */ } }
    setTimeout(function () { hashWriting = false; }, 0);
  }
  function stateFromHash() {
    var h = parseHash(location.hash);
    if (!h || !DB.fighters[h.a] || !DB.fighters[h.b] || h.a === h.b) return false;
    S.a = h.a; S.b = h.b; applyPairDefaults();
    if (h.div && DIVS.indexOf(h.div) >= 0) S.div = h.div;
    if (h.rounds === 3 || h.rounds === 5) S.rounds = h.rounds;
    if (h.title != null) S.title = h.title;
    return true;
  }

  /* ================================================================ matchup */
  function cleanAdj(a) { var o = {}; for (var k in a) if (a[k] != null && isFinite(a[k])) o[k] = +a[k]; return o; }
  function buildMatchup() {
    var pa = prof("A"), pb = prof("B");
    cur.err = null;
    try {
      cur.m = E.matchup(pa, pb, { division: S.div, rounds: S.rounds, title: S.title, date: todayISO(),
        adjA: cleanAdj(S.adj.A), adjB: cleanAdj(S.adj.B), judges: { power: S.judgePower } });
    } catch (e) { cur.err = e; cur.m = null; }
    try { cur.x = cur.m ? E.explain(cur.m) : null; } catch (e) { cur.x = null; }
    // knob-neutral data values the slider labels quote (leg-kick share, takedown attempts)
    try {
      cur.m0 = (Object.keys(cleanAdj(S.adj.A)).length || Object.keys(cleanAdj(S.adj.B)).length) ?
        E.matchup(pa, pb, { division: S.div, rounds: S.rounds, title: S.title, date: todayISO(), judges: { power: S.judgePower } }) : cur.m;
    } catch (e) { cur.m0 = cur.m; }
    return cur.m;
  }

  /* ================================================================ pickers */
  var pickers = {};
  function Picker(side) {
    var input = $("pick" + side), list = $("list" + side), self = this;
    this.side = side; this.input = input; this.list = list; this.items = []; this.active = -1; this.open = false;
    input.addEventListener("focus", function () { input.select(); self.render(""); self.show(true); });
    input.addEventListener("click", function () { if (!self.open) { self.render(""); self.show(true); } });
    input.addEventListener("input", function () { self.render(input.value); self.show(true); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!self.open) { self.render(input.value === nameOf(side) ? "" : input.value); self.show(true); }
        if (!self.items.length) return;
        self.setActive(clamp(self.active + (e.key === "ArrowDown" ? 1 : -1), 0, self.items.length - 1));
      } else if (e.key === "Enter") {
        if (self.open && self.active >= 0) { e.preventDefault(); self.choose(self.items[self.active].slug); }
      } else if (e.key === "Escape") {
        if (self.open) { e.preventDefault(); self.show(false); self.reset(); }
      } else if (e.key === "Home" && self.open && self.items.length && !input.value) { self.setActive(0); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== input) { self.show(false); self.reset(); } }, 120); });
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });
    list.addEventListener("click", function (e) { var li = e.target.closest ? e.target.closest(".opt") : null; if (li) self.choose(li.dataset.slug); });
  }
  Picker.prototype.reset = function () { this.input.value = nameOf(this.side); };
  Picker.prototype.show = function (on) {
    this.open = on; this.list.hidden = !on; this.input.setAttribute("aria-expanded", on ? "true" : "false");
    if (!on) { this.input.removeAttribute("aria-activedescendant"); this.active = -1; }
  };
  Picker.prototype.setActive = function (i) {
    var prev = this.list.querySelector('[aria-selected="true"]'); if (prev) prev.setAttribute("aria-selected", "false");
    this.active = i; var it = this.items[i]; if (!it) return;
    var li = $(it.id); if (!li) return;
    li.setAttribute("aria-selected", "true"); this.input.setAttribute("aria-activedescendant", it.id);
    if (li.scrollIntoView) li.scrollIntoView({ block: "nearest" });
  };
  Picker.prototype.render = function (q) {
    var side = this.side, qn = norm(q), mine = slugOf(side), theirs = slugOf(other(side)), res = [];
    if (!qn || qn === norm(nameOf(side))) {
      // no query: the strongest names in each division, the current fight's division first
      var byDiv = {};
      ROSTER.forEach(function (r) { (byDiv[r.div] = byDiv[r.div] || []).push(r); });
      var order = DIVS.slice().sort(function (a, b) { return (a === S.div ? -1 : 0) - (b === S.div ? -1 : 0) || divOrder(a) - divOrder(b); });
      order.forEach(function (d) {
        var arr = (byDiv[d] || []).slice().sort(function (x, y) { return y.elo - x.elo; }).slice(0, d === S.div ? 12 : 5);
        arr.forEach(function (r) { res.push(r); });
      });
    } else {
      var words = qn.split(" ");
      ROSTER.forEach(function (r) {
        var sc = 0;
        if (r.n.indexOf(qn) === 0 || r.ln.indexOf(qn) === 0) sc = 5;
        else if ((" " + r.n).indexOf(" " + qn) >= 0) sc = 4;
        else if (r.nk && (r.nk.indexOf(qn) === 0 || (" " + r.nk).indexOf(" " + qn) >= 0)) sc = 3.5;
        else if (words.every(function (w) { return (" " + r.n + " " + r.nk).indexOf(" " + w) >= 0; })) sc = 3;
        else if (r.n.indexOf(qn) >= 0 || (r.nk && r.nk.indexOf(qn) >= 0)) sc = 1;
        if (sc) { r._s = sc; res.push(r); }
      });
      res.sort(function (x, y) { return y._s - x._s || y.elo - x.elo; });
      res = res.slice(0, 60);
      // grouped by division, keeping rank order inside each group; groups ordered by their best match
      var firstIdx = {}; res.forEach(function (r, i) { if (firstIdx[r.div] == null) firstIdx[r.div] = i; });
      res.sort(function (x, y) { return firstIdx[x.div] - firstIdx[y.div] || y._s - x._s || y.elo - x.elo; });
    }
    var list = this.list; list.textContent = ""; this.items = []; this.active = -1;
    if (!res.length) { list.appendChild(el("li", "o-empty", "No fighter matches “" + q + "”. Try a last name or nickname.")); return; }
    var lastDiv = null, self = this;
    res.forEach(function (r, i) {
      if (r.div !== lastDiv) { lastDiv = r.div; var g = el("li", "o-grp", r.div); g.setAttribute("role", "presentation"); list.appendChild(g); }
      var id = "opt" + side + "-" + i, li = el("li", "opt" + (r.slug === mine ? " cur" : ""));
      li.id = id; li.setAttribute("role", "option"); li.setAttribute("aria-selected", "false"); li.dataset.slug = r.slug;
      var nm = el("span", "o-name", r.name); if (r.nick) { nm.appendChild(document.createTextNode(" ")); nm.appendChild(el("span", "o-nick", "“" + r.nick + "”")); }
      li.appendChild(nm); li.appendChild(el("span", "o-elo", r.elo ? "Elo " + r.elo : ""));
      li.appendChild(el("span", "o-meta", [r.rec ? r.rec + " UFC" : null, r.last ? "last: " + r.last : null, r.slug === theirs ? "in the other corner" : null].filter(Boolean).join(" · ")));
      list.appendChild(li); self.items.push({ id: id, slug: r.slug });
    });
  };
  Picker.prototype.choose = function (slug) {
    var side = this.side;
    this.show(false);
    if (!DB.fighters[slug]) { this.reset(); return; }
    if (slug === slugOf(other(side))) { swapCorners(); this.reset(); return; }
    if (slug === slugOf(side)) { this.reset(); return; }
    if (side === "A") S.a = slug; else S.b = slug;
    applyPairDefaults();
    this.reset();
    matchupChanged(true);
    announce(nameOf("A") + " vs " + nameOf("B") + " at " + S.div.toLowerCase() + ".");
  };
  function announce(t) { var n = $("mbNote"); if (n) n.textContent = t; }

  function swapCorners() {
    var a = S.a; S.a = S.b; S.b = a;
    var ad = S.adj.A; S.adj.A = S.adj.B; S.adj.B = ad;
    var o = S.odds.A; S.odds.A = S.odds.B; S.odds.B = o;
    matchupChanged(true);
    announce("Corners swapped: " + nameOf("A") + " is in blue.");
  }

  function renderMatchbar() {
    ["A", "B"].forEach(function (side) {
      var p = prof(side), rec = p.record || {}, meta = $("meta" + side); meta.textContent = "";
      var age = ageOn(p.dob);
      var parts = [divShort(p.division), rec.w != null ? rec.w + "-" + rec.l + (rec.d ? "-" + rec.d : "") + " UFC" : null, p.elo ? "Elo " + p.elo : null, age ? "age " + Math.floor(age) : null];
      meta.textContent = parts.filter(Boolean).join(" · ");
      if (document.activeElement !== pickers[side].input) pickers[side].reset();
    });
    var sel = $("selDiv");
    if (!sel.options.length) DIVS.forEach(function (d) { var o = el("option", null, d + " (" + divLbs(d) + " lb)"); o.value = d; sel.appendChild(o); });
    sel.value = S.div;
    Array.prototype.forEach.call($("segRounds").children, function (b) { b.setAttribute("aria-pressed", +b.dataset.r === S.rounds ? "true" : "false"); });
    $("chkTitle").checked = S.title;
    $("h1A").textContent = shortOf("A"); $("h1B").textContent = shortOf("B");
    $("kicker").textContent = S.div + " · " + S.rounds + " × 5 min" + (S.title ? " · title fight" : "") + " · " + (divLbs(S.div) || "?") + " lb";
    document.title = "Fight Lab";
    // names everywhere
    ["A", "B"].forEach(function (s) {
      var sh = shortOf(s);
      ["bugN", "fsN", "spN", "ktN", "oddN"].forEach(function (pre) { var n = $(pre + s); if (n) n.textContent = pre === "fsN" || pre === "oddN" ? nameOf(s) : sh; });
      var dl = $("discL" + s); if (dl) dl.textContent = initials(nameOf(s));
    });
  }

  /* ================================================================ tale of the tape */
  function shrunk(i) {
    var m = cur.m, R = m.R[i], s = R.sums, P = m.P, p = m.p;
    function shr(ev, ex, prior, k) { return (ev + k * prior) / (Math.max(0, ex) + k); }
    var lnd = s.d_lnd + s.c_lnd + s.g_lnd, att = s.d_att + s.c_att + s.g_att;
    var olnd = s.od_lnd + s.oc_lnd + s.og_lnd, oatt = s.od_att + s.oc_att + s.og_att;
    var slpm0 = P.slpm || (P.d_lnd + P.c_lnd + P.g_lnd), acc0 = P.acc_sig || 0.47;
    return {
      slpm: shr(lnd, s.min, slpm0, p.kPM), sapm: shr(olnd, s.min, slpm0, p.kPM),
      acc: shr(lnd, att, acc0, p.kAcc), def: 1 - shr(olnd, oatt, acc0, p.kAcc),
      td15: shr(s.td_lnd, s.min, P.td_lnd, p.kTdPM) * 15, tdAcc: R.tdAcc, tdDef: 1 - R.tdAccAg,
      kdFor: 100 * R.pow, kdAg: 100 * R.chin, ctrl15: R.ctrl * 15, sub15: shr(s.sub_att, s.min, P.sub_att, p.kPM) * 15, min: R.min,
      league: { slpm: slpm0, acc: acc0, td15: P.td_lnd * 15, tdAcc: P.td_acc, kd: 100 * P.kd_per_h, ctrl15: P.ctrl * 15, sub15: P.sub_att * 15 }
    };
  }
  function renderTape() {
    var heads = $("tapeHeads"); heads.textContent = "";
    ["A", "B"].forEach(function (side) {
      var p = prof(side), sc = SCOUT[slugOf(side)], card = el("div", "th-card " + side);
      var ini = el("div", "initials " + side, initials(p.name)); ini.setAttribute("aria-hidden", "true");
      var box = el("div"); box.appendChild(el("div", "th-name", p.name));
      if (p.nick) box.appendChild(el("div", "th-nick", "“" + p.nick + "”"));
      var tags = el("div", "th-tags");
      tags.appendChild(el("span", "pill", side === "A" ? "Blue corner" : "Red corner"));
      if (sc && sc.status && sc.status.title) tags.appendChild(el("span", "pill gold", sc.status.title));
      if (sc && sc.status && sc.status.active === false) tags.appendChild(el("span", "pill warn", "Inactive"));
      if (p.manual) tags.appendChild(el("span", "pill", "Hand-entered"));
      box.appendChild(tags);
      card.appendChild(ini); card.appendChild(box); heads.appendChild(card);
    });
    var tb = $("tapeBody"); tb.textContent = "";
    if (!cur.m) { var tr0 = el("tr"), td0 = el("td", null, "The engine could not build this matchup" + (cur.err ? ": " + cur.err.message : ".")); td0.colSpan = 3; tr0.appendChild(td0); tb.appendChild(tr0); return; }
    var pa = prof("A"), pb = prof("B"), ra = pa.record || {}, rb = pb.record || {}, ka = shrunk(0), kb = shrunk(1), L = ka.league;
    var now = todayISO();
    function row(label, va, vb, opt) {
      opt = opt || {};
      var tr = el("tr"), a = el("td", "a"), b = el("td", "b"), th = el("th", "lab");
      th.scope = "row"; th.textContent = label; if (opt.small) th.appendChild(el("small", null, opt.small));
      [[a, va, opt.subA], [b, vb, opt.subB]].forEach(function (x) { x[0].textContent = x[1] == null ? "–" : x[1]; if (x[2]) x[0].appendChild(el("span", "split", x[2])); });
      if (opt.cmp != null && opt.na != null && opt.nb != null && isFinite(opt.na) && isFinite(opt.nb) && Math.abs(opt.na - opt.nb) > 1e-9) {
        var aBetter = opt.cmp > 0 ? opt.na > opt.nb : opt.na < opt.nb; (aBetter ? a : b).classList.add("win");
      }
      tr.appendChild(a); tr.appendChild(th); tr.appendChild(b); tb.appendChild(tr);
    }
    function sect(t) { var tr = el("tr", "sect"), th = el("th", null, t); th.colSpan = 3; th.scope = "colgroup"; tr.appendChild(th); tb.appendChild(tr); }
    function recStr(r) { return r.w != null ? r.w + "-" + r.l + (r.d ? "-" + r.d : "") + (r.nc ? " (" + r.nc + " NC)" : "") : "–"; }
    var ageA = ageOn(pa.dob, now), ageB = ageOn(pb.dob, now);
    sect("The fighters");
    row("Age", ageA ? Math.floor(ageA) : null, ageB ? Math.floor(ageB) : null, { small: "today" });
    row("Height", inches(pa.height_in), inches(pb.height_in));
    row("Reach", pa.reach_in ? pa.reach_in + "″" : null, pb.reach_in ? pb.reach_in + "″" : null);
    row("Stance", pa.stance || null, pb.stance || null);
    row("Home division", divShort(pa.division), divShort(pb.division));
    row("UFC record", recStr(ra), recStr(rb), { subA: ra.w != null ? "W " + (ra.ko_w || 0) + " KO · " + (ra.sub_w || 0) + " sub · " + (ra.dec_w || 0) + " dec" : null, subB: rb.w != null ? "W " + (rb.ko_w || 0) + " KO · " + (rb.sub_w || 0) + " sub · " + (rb.dec_w || 0) + " dec" : null });
    row("UFC losses by method", ra.l != null ? (ra.ko_l || 0) + " KO · " + (ra.sub_l || 0) + " sub · " + (ra.dec_l || 0) + " dec" : null, rb.l != null ? (rb.ko_l || 0) + " KO · " + (rb.sub_l || 0) + " sub · " + (rb.dec_l || 0) + " dec" : null);
    row("Elo", pa.elo || null, pb.elo || null, { small: "walk-forward, our data", cmp: 1, na: pa.elo, nb: pb.elo });
    row("Last fight", pa.last_fight ? fmtDate(pa.last_fight) : null, pb.last_fight ? fmtDate(pb.last_fight) : null);
    sect("Engine profile");
    row("Sig. strikes landed / min", fx(ka.slpm), fx(kb.slpm), { small: "avg " + fx(L.slpm), cmp: 1, na: ka.slpm, nb: kb.slpm });
    row("Sig. strikes absorbed / min", fx(ka.sapm), fx(kb.sapm), { small: "avg " + fx(L.slpm), cmp: -1, na: ka.sapm, nb: kb.sapm });
    row("Striking accuracy", pct(ka.acc, 0), pct(kb.acc, 0), { small: "avg " + pct(L.acc, 0), cmp: 1, na: ka.acc, nb: kb.acc });
    row("Striking defense", pct(ka.def, 0), pct(kb.def, 0), { small: "avg " + pct(1 - L.acc, 0), cmp: 1, na: ka.def, nb: kb.def });
    row("Takedowns / 15 min", fx(ka.td15), fx(kb.td15), { small: "avg " + fx(L.td15), cmp: 1, na: ka.td15, nb: kb.td15 });
    row("Takedown accuracy", pct(ka.tdAcc, 0), pct(kb.tdAcc, 0), { small: "avg " + pct(L.tdAcc, 0), cmp: 1, na: ka.tdAcc, nb: kb.tdAcc });
    row("Takedown defense", pct(ka.tdDef, 0), pct(kb.tdDef, 0), { small: "avg " + pct(1 - L.tdAcc, 0), cmp: 1, na: ka.tdDef, nb: kb.tdDef });
    row("Knockdowns per 100 head strikes landed", fx(ka.kdFor), fx(kb.kdFor), { small: "avg " + fx(L.kd), cmp: 1, na: ka.kdFor, nb: kb.kdFor });
    row("Knocked down per 100 head strikes absorbed", fx(ka.kdAg), fx(kb.kdAg), { small: "avg " + fx(L.kd), cmp: -1, na: ka.kdAg, nb: kb.kdAg });
    row("Control time / 15 min", mmss(ka.ctrl15), mmss(kb.ctrl15), { small: "avg " + mmss(L.ctrl15), cmp: 1, na: ka.ctrl15, nb: kb.ctrl15 });
    row("Submission attempts / 15 min", fx(ka.sub15), fx(kb.sub15), { small: "avg " + fx(L.sub15), cmp: 1, na: ka.sub15, nb: kb.sub15 });
    row("Recency-weighted UFC minutes", fx(ka.min, 0), fx(kb.min, 0), { small: "how much data" });
    $("tapeFoot").textContent = "Engine-profile rows are what the engine uses: UFC fights weighted toward the last two years, then pulled toward the " + S.div.toLowerCase() + " average (avg) in proportion to how little data there is. The bolder number in each row is the better one. Records cover UFC bouts only.";
    $("tapeSub").textContent = "Data through " + fmtDate(DB.meta && DB.meta.snapshot) + " · ages as of " + fmtDate(now);
    renderDossiers();
  }
  function renderDossiers() {
    var box = $("dossiers"); box.textContent = "";
    ["A", "B"].forEach(function (side) {
      var p = prof(side), sc = SCOUT[slugOf(side)], d = el("div", "dossier " + side);
      var h = el("h3"); var disc = el("span", "disc " + side, initials(p.name)); disc.setAttribute("aria-hidden", "true"); h.appendChild(disc); h.appendChild(document.createTextNode(p.name)); d.appendChild(h);
      var lab = el("h4", "mini", "Last " + Math.min(6, (p.recent || []).length) + " UFC fights"); d.appendChild(lab);
      var ul = el("ul", "fights");
      (p.recent || []).slice(0, 6).forEach(function (r) {
        var li = el("li");
        li.appendChild(el("span", "fd", fmtDate(r.date)));
        var res = el("span", "res " + (r.res === "W" ? "W" : r.res === "L" ? "L" : ""), r.res || "–"); res.setAttribute("aria-label", r.res === "W" ? "Win" : r.res === "L" ? "Loss" : (r.res || "")); li.appendChild(res);
        var fo = el("span", "fo"); fo.appendChild(el("b", null, r.opp));
        fo.appendChild(el("span", null, " · " + (r.method || "") + (r.rd ? ", R" + r.rd + " " + (r.time || "") : "") + (r.title ? " · title" : "") + (r.wc && r.wc !== p.division ? " · at " + divShort(r.wc) : "")));
        li.appendChild(fo); ul.appendChild(li);
      });
      if (!(p.recent || []).length) ul.appendChild(el("li", "noscout", "No UFC fights in the data."));
      d.appendChild(ul);
      if (sc) d.appendChild(scoutBlock(sc));
      else d.appendChild(el("p", "noscout", "No scouting file for " + p.name + " yet. The engine runs on the UFC numbers alone."));
      box.appendChild(d);
    });
  }
  function scoutBlock(sc) {
    var b = el("div", "scout"), st = sc.status || {}, sy = sc.style || {};
    b.appendChild(el("h4", "mini", "Scouting"));
    if (st.summary) b.appendChild(el("p", "sc-status", st.summary));
    var asof = [sc.as_of ? "Status as of " + fmtDate(sc.as_of) : null, st.ranking || null, sc.confidence ? "confidence " + sc.confidence : null].filter(Boolean).join(" · ");
    if (asof) b.appendChild(el("p", "sc-asof", asof));
    if (sy.archetype || (sy.tags && sy.tags.length)) {
      var tr = el("div", "tagrow");
      if (sy.archetype) tr.appendChild(el("span", "pill gold", sy.archetype));
      (sy.tags || []).forEach(function (t) { tr.appendChild(el("span", "pill", t)); });
      b.appendChild(tr);
    }
    if (sy.summary) b.appendChild(el("p", null, sy.summary));
    function list(title, arr) {
      if (!arr || !arr.length) return;
      b.appendChild(el("h4", "mini", title)); var ul = el("ul"); arr.slice(0, 5).forEach(function (x) { ul.appendChild(el("li", null, x)); }); b.appendChild(ul);
    }
    list("Signature", sy.signature); list("Weaknesses", sy.weaknesses);
    if (st.injuries && st.injuries.length) list("Injuries", st.injuries.map(function (i) { return (i.what || "") + (i.when ? " (" + i.when + ")" : ""); }));
    var srcs = el("div", "srcs"); var n = linkList(srcs, [].concat(st.sources || [], sy.sources || []), 10);
    if (n) { b.appendChild(el("h4", "mini", "Sources")); b.appendChild(srcs); }
    return b;
  }

  /* ================================================================ knobs and scenarios */
  var KNOBS = [
    { k: "out", label: "Output", min: 0.7, max: 1.3, step: 0.01, hint: "Strike attempts per minute. ×1.10 throws 10% more than the data says." },
    { k: "acc", label: "Accuracy", min: 0.7, max: 1.4, step: 0.01, hint: "Multiplies the odds that each strike lands. ×1.20 turns a 45% shot into about 50%." },
    { k: "pow", label: "Power", min: 0.5, max: 1.8, step: 0.01, hint: "Knockdown chance per clean head shot, and the damage each one does." },
    { k: "chin", label: "Chin", min: 0.5, max: 2, step: 0.01, hint: "How easily a clean head shot drops this fighter. Above 1 is easier to drop. Age, weight class and past KO losses are already counted." },
    { k: "cardio", label: "Gas tank drain", min: 0.6, max: 1.6, step: 0.01, hint: "How fast the tank empties. Above 1 tires faster, and fatigue cuts output, accuracy and power." },
    { k: "tdAtt", label: "Takedown attempts", min: 0, max: 4, step: 0.05, hint: "How often this fighter shoots, at distance and in the clinch." },
    { k: "tdDef", label: "Takedown defense", min: 0.5, max: 2.5, step: 0.05, hint: "Divides the opponent's odds of finishing a shot. ×2.00 means the opponent's takedowns land about half as often." },
    { k: "leg", label: "Leg-kick share", min: 0, max: 0.45, step: 0.01, hint: "Share of strikes at distance aimed at the legs. Leg damage slows a fighter and costs output and power." },
    { k: "sub", label: "Submission threat", min: 0.3, max: 3, step: 0.05, hint: "Submission attempts on the ground and how often they finish." }
  ];
  function knobVal(side, k) { var v = S.adj[side][k]; return v == null ? (k === "leg" ? null : 1) : v; }
  function knobFmt(side, kd) {
    var i = side === "A" ? 0 : 1, v = knobVal(side, kd.k), m0 = cur.m0 || cur.m;
    if (kd.k === "leg") {
      var data = m0 && m0.R ? m0.R[i].mixD[2] : null;
      return v == null ? "data " + pct(data, 0) : pct(v, 0) + " (data " + pct(data, 0) + ")";
    }
    if (kd.k === "chin") return Math.abs(v - 1) < 0.005 ? "×1.00 data" : mult(v) + (v > 1 ? " easier to drop" : " harder to drop");
    if (kd.k === "cardio") return Math.abs(v - 1) < 0.005 ? "×1.00 data" : mult(v) + (v > 1 ? " tires faster" : " tires slower");
    if (kd.k === "tdAtt") {
      var base = m0 && m0.tdS ? m0.tdS[i] * 900 : null;
      return mult(v) + (base != null ? " · " + fx(base * v, 1) + " per 15 min" : "");
    }
    return Math.abs(v - 1) < 0.005 ? "×1.00 data" : mult(v);
  }
  function renderKnobPanel() {
    var side = S.tab, wrap = $("kpanel"); wrap.textContent = "";
    wrap.setAttribute("aria-labelledby", "ktab" + side);
    $("ktabA").setAttribute("aria-selected", side === "A" ? "true" : "false"); $("ktabB").setAttribute("aria-selected", side === "B" ? "true" : "false");
    $("ktabA").tabIndex = side === "A" ? 0 : -1; $("ktabB").tabIndex = side === "B" ? 0 : -1;
    var i = side === "A" ? 0 : 1, m0 = cur.m0 || cur.m;
    KNOBS.forEach(function (kd) {
      var d = el("div", "sl " + side), top = el("div", "sl-top"), lab = el("label", null, kd.label), out = el("output");
      var id = "k-" + kd.k; lab.htmlFor = id; out.id = "o-" + kd.k; out.htmlFor = id;
      var inp = document.createElement("input"); inp.type = "range"; inp.id = id; inp.min = kd.min; inp.max = kd.max; inp.step = kd.step;
      var v = knobVal(side, kd.k);
      inp.value = v == null ? (m0 && m0.R ? m0.R[i].mixD[2] : 0.1) : v;
      inp.setAttribute("aria-describedby", "h-" + kd.k);
      top.appendChild(lab); top.appendChild(out); d.appendChild(top); d.appendChild(inp);
      var h = el("p", "hint", kd.hint); h.id = "h-" + kd.k; d.appendChild(h);
      wrap.appendChild(d);
      function sync() { out.textContent = knobFmt(side, kd); var vv = knobVal(side, kd.k); out.classList.toggle("moved", vv != null && Math.abs(vv - 1) > 0.005 && kd.k !== "leg" || (kd.k === "leg" && vv != null)); inp.setAttribute("aria-valuetext", out.textContent); }
      sync();
      inp.addEventListener("input", function () { S.adj[side][kd.k] = +inp.value; S.scen = null; sync(); knobsChanged(); });
    });
    renderJudgeKnob();
  }
  function judgeRatio() {
    var m = cur.m; if (!m || !m.dw) return null; var g = S.judgePower;
    return (1 + g * (m.dw[1] - 1)) / Math.max(1e-6, 1 + g * (m.dw[0] - 1));
  }
  function renderJudgeKnob() {
    var wrap = $("judgeKnob");
    if (!wrap.firstChild) {
      var d = el("div", "sl"), top = el("div", "sl-top"), lab = el("label", null, "Judges' credit for power"), out = el("output");
      lab.htmlFor = "k-jpow"; out.id = "o-jpow"; out.htmlFor = "k-jpow";
      var inp = document.createElement("input"); inp.type = "range"; inp.id = "k-jpow"; inp.min = 0; inp.max = 0.8; inp.step = 0.05;
      inp.setAttribute("aria-describedby", "h-jpow");
      top.appendChild(lab); top.appendChild(out); d.appendChild(top); d.appendChild(inp);
      var h = el("p", "hint"); h.id = "h-jpow"; d.appendChild(h);
      wrap.appendChild(d);
      inp.addEventListener("input", function () { S.judgePower = +inp.value; S.scen = null; syncJudge(); knobsChanged(); });
    }
    syncJudge();
  }
  function syncJudge() {
    var inp = $("k-jpow"), out = $("o-jpow"), h = $("h-jpow"); if (!inp) return;
    inp.value = S.judgePower; out.textContent = fx(S.judgePower) + (Math.abs(S.judgePower - JP0) < 0.001 ? " default" : "");
    var r = judgeRatio();
    h.textContent = "Extra credit judges give for how hard a shot lands, beyond the count. 0 counts strikes only; the default is " + fx(JP0) + "." +
      (r != null ? " Right now one landed " + shortOf("B") + " head strike is worth " + fx(r) + "× one of " + shortOf("A") + "'s on the cards, before knockdowns." : "");
    inp.setAttribute("aria-valuetext", out.textContent);
  }
  function syncKnobOutputs() {
    // after a rebuild, refresh labels that quote data (leg share, takedown rate) without rebuilding the panel
    KNOBS.forEach(function (kd) { var o = $("o-" + kd.k); if (o) o.textContent = knobFmt(S.tab, kd); });
    syncJudge();
  }

  function scenarioList() {
    var pd = pairData(S.a, S.b), out = [];
    if (pd && pd.scenarios) pd.scenarios.forEach(function (s) { out.push(Object.assign({ pair: true }, s)); });
    (SCEN.generic || []).forEach(function (s) { out.push(Object.assign({ pair: false }, s)); });
    return out;
  }
  function layoffSide() {
    var a = Date.parse(prof("A").last_fight || ""), b = Date.parse(prof("B").last_fight || "");
    if (!isFinite(a) && !isFinite(b)) return null; if (!isFinite(a)) return "A"; if (!isFinite(b)) return "B";
    return a < b ? "A" : (b < a ? "B" : null);
  }
  function applyScenarioState(sc) {
    S.adj = { A: {}, B: {} }; S.judgePower = JP0;
    var adj = sc.adj || {}, k;
    for (var key in adj) {
      var sides = [];
      if (key === S.a) sides = ["A"]; else if (key === S.b) sides = ["B"];
      else if (key === "each" || key === "both") sides = ["A", "B"];
      else if (key === "layoff") { var ls = layoffSide(); if (ls) sides = [ls]; }
      else if (key === "A" || key === "B") sides = [key];
      sides.forEach(function (s) { for (k in adj[key]) S.adj[s][k] = adj[key][k]; });
    }
    if (sc.judges && sc.judges.power != null) S.judgePower = +sc.judges.power;
    if (sc.rounds === 3 || sc.rounds === 5) S.rounds = sc.rounds;
    S.scen = sc.id;
  }
  function renderChips() {
    var box = $("chips"); box.textContent = "";
    scenarioList().forEach(function (sc) {
      var b = el("button", "chip" + (sc.pair ? "" : " gen"), sc.label); b.type = "button"; b.dataset.id = sc.id;
      b.setAttribute("aria-pressed", sc.id === S.scen ? "true" : "false");
      if (!sc.pair) b.title = "Works for any matchup";
      b.addEventListener("click", function () {
        var roundsBefore = S.rounds;
        applyScenarioState(sc);
        if (S.rounds !== roundsBefore) { matchupChanged(true); return; }
        renderChips(); renderKnobPanel(); knobsChanged(true);
      });
      box.appendChild(b);
    });
    renderScenNote();
  }
  function modelTerms() {
    var m = cur.m; if (!m || !m.fac) return null;
    var parts = [];
    ["A", "B"].forEach(function (s, i) {
      var f = m.fac[i], bits = [];
      if (Math.abs(f.ageChin - 1) > 0.005) bits.push("chin ×" + fx(f.ageChin) + " for age");
      if (Math.abs(f.koChin - 1) > 0.005) bits.push("×" + fx(f.koChin) + " for " + f.koLosses + " KO loss" + (f.koLosses === 1 ? "" : "es"));
      if (Math.abs(f.sizeChin - 1) > 0.005) bits.push("×" + fx(f.sizeChin) + " for moving up " + Math.round(f.lbsUp) + " lb");
      if (Math.abs(f.agePow - 1) > 0.005) bits.push("power ×" + fx(f.agePow) + " for age");
      if (Math.abs(f.sizePow - 1) > 0.005) bits.push("power ×" + fx(f.sizePow) + " for moving up");
      if (bits.length) parts.push(shortOf(s) + " " + bits.join(", "));
    });
    return parts.length ? parts.join("; ") + "." : null;
  }
  function renderScenNote() {
    var box = $("scenNote"); box.textContent = "";
    var terms = modelTerms();
    function termsLine() { if (!terms) return; var p = el("p", "small"); p.appendChild(el("b", null, "Already in the model from data: ")); p.appendChild(document.createTextNode(terms + " Chin above 1 means easier to drop; the knobs multiply on top.")); box.appendChild(p); }
    var sc = scenarioList().filter(function (x) { return x.id === S.scen; })[0];
    if (!sc) {
      var custom = Object.keys(cleanAdj(S.adj.A)).length + Object.keys(cleanAdj(S.adj.B)).length > 0 || Math.abs(S.judgePower - JP0) > 0.001;
      var p = el("p"); p.appendChild(el("b", null, custom ? "Custom settings. " : "Data only. "));
      p.appendChild(document.createTextNode(custom ? "You've moved the knobs by hand. Reset to data puts every knob back to 1.00." :
        "Every knob sits at 1.00, so the engine runs on the UFC numbers, its age, weight-class and KO-loss terms, and the default judging."));
      box.appendChild(p);
      if (!pairData(S.a, S.b)) box.appendChild(el("p", null, "There are no hand-written scenarios for this pair yet; the dashed chips work for any matchup."));
      termsLine();
      return;
    }
    var h = el("p"); h.appendChild(el("b", null, sc.label + ". ")); h.appendChild(document.createTextNode(sc.note || "")); box.appendChild(h);
    if (sc.id === "rust") { var ls = layoffSide(); if (ls) box.appendChild(el("p", null, "Applied to " + nameOf(ls) + ", whose last fight was " + fmtDate(prof(ls).last_fight) + ".")); }
    if (sc.research) { var r = el("p"); r.appendChild(el("b", null, "The research: ")); r.appendChild(document.createTextNode(sc.research)); box.appendChild(r); }
    var srcs = el("div", "srcs"); if (linkList(srcs, sc.sources)) box.appendChild(srcs);
    termsLine();
  }

  var knobTimer = null;
  function knobsChanged(now) {
    clearTimeout(knobTimer);
    var run = function () {
      buildMatchup(); syncKnobOutputs(); renderScenNote(); renderWhy(); renderStack();
      Array.prototype.forEach.call($("chips").children, function (b) { b.setAttribute("aria-pressed", b.dataset.id === S.scen ? "true" : "false"); });
      queueTally(true);
    };
    if (now) run(); else knobTimer = setTimeout(run, 160);
  }

  /* ================================================================ tally */
  var N_TALLY = 20000, tallyId = 0, worker = null, workerFailed = false, lastAgg = null, tallyTimer = null, tallyRAF = 0, pendingAgg = null;
  // aggregation helpers: plain functions with no outside references, so the worker can take their source text
  function aggInit(nR, ns) {
    function z(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
    return { n: 0, nR: nR, bins: z(7), methods: {}, finA: z(nR), finB: z(nR), koA: z(nR), koB: z(nR), subA: z(nR), subB: z(nR),
      dist: 0, distA: 0, distB: 0, dec: { UD: 0, SD: 0, MD: 0, DRAW: 0 }, sumA: z(ns), sumB: z(ns), secs: 0, n108: 0 };
  }
  function aggAdd(agg, f, STATS) {
    var dec = f.method === "UD" || f.method === "SD" || f.method === "MD" || f.method === "DRAW";
    var k = f.winner === "D" ? 3 : (f.method === "SUB" ? 1 : (dec ? 2 : 0));
    if (f.winner === "B") k = 6 - k;
    agg.bins[k]++;
    var key = f.winner + ":" + f.method; agg.methods[key] = (agg.methods[key] || 0) + 1;
    if (dec) {
      agg.dist++; agg.dec[f.method]++; agg.secs += agg.nR * 300;
      if (f.winner === "A") agg.distA++; else if (f.winner === "B") agg.distB++;
    } else {
      var r = Math.max(0, Math.min(agg.nR - 1, f.round - 1)), A = f.winner === "A";
      (A ? agg.finA : agg.finB)[r]++;
      if (f.method === "SUB") (A ? agg.subA : agg.subB)[r]++; else (A ? agg.koA : agg.koB)[r]++;
      agg.secs += r * 300 + (f.t || 0);
    }
    agg.n108 += f.n108 || 0;
    var TA = f.totals && f.totals.A, TB = f.totals && f.totals.B;
    if (TA && TB) for (var i = 0; i < STATS.length; i++) { agg.sumA[i] += TA[STATS[i]] || 0; agg.sumB[i] += TB[STATS[i]] || 0; }
  }
  function workerMain() {
    var EN = self.FightEngine, current = 0;
    self.onmessage = function (e) {
      var d = e.data; current = d.id;
      var m = d.m, rng = EN.makeRng(d.seed), N = d.n, i = 0, agg = aggInit(m.rounds, EN.STATS.length);
      function chunk() {
        if (d.id !== current) return;
        var end = Math.min(N, i + 1000);
        try { for (; i < end; i++) aggAdd(agg, EN.simulate(m, rng, false), EN.STATS); }
        catch (err) { self.postMessage({ id: d.id, error: String(err && err.message || err) }); return; }
        agg.n = i;
        self.postMessage({ id: d.id, agg: agg, done: i >= N });
        if (i < N) setTimeout(chunk, 0);
      }
      chunk();
    };
  }
  function makeWorker() {
    try {
      var src = $("engine-src").textContent + "\n;" + aggInit.toString() + "\n" + aggAdd.toString() + "\n;(" + workerMain.toString() + ")();";
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      var w = new Worker(url);
      w.onmessage = function (e) {
        var d = e.data; if (d.id !== tallyId) return;
        if (d.error) { workerFailed = true; worker = null; try { w.terminate(); } catch (x) { /* gone */ } startTally(); return; }
        onTally(d.agg, d.done);
      };
      w.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); workerFailed = true; worker = null; startTally(); };
      return w;
    } catch (e) { return null; }
  }
  function mainTally(id, m) {
    var rng = E.makeRng(newSeed()), i = 0, agg = aggInit(m.rounds, E.STATS.length);
    (function chunk() {
      if (id !== tallyId) return;
      var t0 = performance.now();
      while (i < N_TALLY && performance.now() - t0 < 12) { var end = Math.min(N_TALLY, i + 50); for (; i < end; i++) aggAdd(agg, E.simulate(m, rng, false), E.STATS); }
      agg.n = i; onTally(agg, i >= N_TALLY);
      if (i < N_TALLY) setTimeout(chunk, 4);
    })();
  }
  function startTally() {
    tallyId++;
    var m = cur.m; if (!m) { $("runStatus").textContent = "This matchup can't be simulated" + (cur.err ? ": " + cur.err.message : "."); return; }
    $("runStatus").textContent = "Simulating " + nf.format(N_TALLY) + " fights";
    setProgress(0);
    if (!worker && !workerFailed && typeof Worker !== "undefined") { worker = makeWorker(); if (!worker) workerFailed = true; }
    if (worker) {
      try { worker.postMessage({ id: tallyId, m: m, seed: newSeed(), n: N_TALLY }); return; }
      catch (e) { workerFailed = true; worker = null; }
    }
    mainTally(tallyId, m);
  }
  function queueTally(now) { clearTimeout(tallyTimer); tallyTimer = setTimeout(startTally, now ? 0 : 200); }
  function setProgress(fr) { $("progBar").style.width = (100 * fr) + "%"; $("prog").setAttribute("aria-valuenow", Math.round(100 * fr)); }
  function onTally(agg, done) {
    pendingAgg = { agg: agg, done: done };
    if (tallyRAF) return;
    tallyRAF = requestAnimationFrame(function () { tallyRAF = 0; var p = pendingAgg; pendingAgg = null; if (p) renderTally(p.agg, p.done); });
    if (done) { cancelAnimationFrame(tallyRAF); tallyRAF = 0; pendingAgg = null; renderTally(agg, true); }
  }

  function binLabels() {
    var a = shortOf("A"), b = shortOf("B");
    return [a + " by KO/TKO", a + " by submission", a + " by decision", "Draw", b + " by decision", b + " by submission", b + " by KO/TKO"];
  }
  var BIN_SHORT = ["KO/TKO", "Sub", "Decision", "Draw", "Decision", "Sub", "KO/TKO"];
  var BIN_COL = ["var(--blue)", "var(--blue)", "var(--blue)", "var(--neutral)", "var(--red)", "var(--red)", "var(--red)"];

  function renderTally(agg, done) {
    lastAgg = agg;
    var n = Math.max(1, agg.n), b = agg.bins;
    var pA = (b[0] + b[1] + b[2]) / n, pB = (b[4] + b[5] + b[6]) / n, pD = b[3] / n;
    $("pA").textContent = pct(pA); $("pB").textContent = pct(pB); $("pD").textContent = pct(pD);
    $("winA").firstChild.nodeValue = pct(pA, 0); $("winB").firstChild.nodeValue = pct(pB, 0);
    $("segA").style.width = (pA * 100) + "%"; $("segD").style.width = Math.max(0.4, pD * 100) + "%"; $("segB").style.width = (pB * 100) + "%";
    $("segAl").textContent = pA > 0.12 ? pct(pA, 0) : ""; $("segBl").textContent = pB > 0.12 ? pct(pB, 0) : "";
    $("segbar").setAttribute("aria-label", nameOf("A") + " " + pct(pA) + ", draw " + pct(pD) + ", " + nameOf("B") + " " + pct(pB));
    var mins = S.rounds * 5;
    $("tDistL").textContent = "Goes the full " + mins + " minutes";
    $("tDist").textContent = pct(agg.dist / n, 0);
    $("tCardsL").textContent = shortOf("A") + " wins when it goes to the cards";
    $("tCards").textContent = agg.dist ? pct(agg.distA / agg.dist, 0) : "–";
    var decs = agg.dec.UD + agg.dec.SD + agg.dec.MD;
    $("tSplit").textContent = decs ? pct((agg.dec.SD + agg.dec.MD) / decs, 0) : "–";
    $("runStatus").textContent = done ? nf.format(agg.n) + " fights · " + scenarioName() + " · " + (worker ? "background thread" : "main thread")
      : "Simulated " + nf.format(agg.n) + " of " + nf.format(N_TALLY) + " fights";
    setProgress(agg.n / N_TALLY);
    drawBins(agg); drawRounds(agg); renderMethodTable(agg); renderAvgTable(agg);
    stack.engine = pA / Math.max(1e-9, pA + pB); stack.engineN = agg.n;
    renderStack();
  }
  function scenarioName() {
    var sc = scenarioList().filter(function (x) { return x.id === S.scen; })[0];
    return sc ? sc.label + " settings" : "custom settings";
  }

  // ---- charts
  var tipEl = null;
  function tip(container, x, y, txt) {
    if (!tipEl) { tipEl = el("div", "tip"); tipEl.hidden = true; }
    if (tipEl.parentNode !== container) container.appendChild(tipEl);
    if (txt == null) { tipEl.hidden = true; return; }
    tipEl.textContent = txt; tipEl.hidden = false;
    var w = container.clientWidth, tw = tipEl.offsetWidth;
    tipEl.style.left = Math.max(tw / 2, Math.min(w - tw / 2, x)) + "px"; tipEl.style.top = (y - 6) + "px";
  }
  function niceMax(v) { var steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100]; for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i]; return 100; }
  function barPath(x0, x1, yTop, yBase) {
    var h = yBase - yTop; if (h < 0.5) return "M0,0";
    var r = Math.min(4, h / 2, (x1 - x0) / 2);
    return "M" + x0 + "," + yBase + " V" + (yTop + r) + " Q" + x0 + "," + yTop + " " + (x0 + r) + "," + yTop + " H" + (x1 - r) + " Q" + x1 + "," + yTop + " " + x1 + "," + (yTop + r) + " V" + yBase + " Z";
  }
  function drawBins(agg) {
    var box = $("binsChart"), n = Math.max(1, agg.n), b = agg.bins, labels = binLabels();
    var W = Math.max(300, Math.round(box.clientWidth || 560)), H = 232, L = 34, R = 8, T = 20, B = 48;
    var vals = b.map(function (x) { return 100 * x / n; });
    var max = niceMax(Math.max.apply(null, vals) * 1.1);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Outcome shares: " + vals.map(function (v, i) { return labels[i] + " " + v.toFixed(1) + "%"; }).join(", ") });
    var plotW = W - L - R, plotH = H - T - B, band = plotW / 7, bw = Math.min(28, band * 0.56);
    var step = max <= 20 ? 5 : (max <= 50 ? 10 : 20);
    for (var t = 0; t <= max + 1e-9; t += step) {
      var y = T + plotH - plotH * t / max;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }));
      svgText(svg, L - 6, y + 4, t + "%", { "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
    }
    vals.forEach(function (v, i) {
      var x = L + band * i + band / 2, h = plotH * v / max, y = T + plotH - h;
      svg.appendChild(svgEl("path", { d: barPath(x - bw / 2, x + bw / 2, y, T + plotH), fill: BIN_COL[i] }));
      svgText(svg, x, y - 5, v >= 0.05 ? v.toFixed(1) : "0", { "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "var(--ink)" });
      svgText(svg, x, T + plotH + 16, W < 430 && BIN_SHORT[i] === "Decision" ? "Dec" : BIN_SHORT[i], { "text-anchor": "middle", "font-size": W < 430 ? 10 : 11, fill: "var(--ink-2)" });
      var hit = svgEl("rect", { x: L + band * i, y: T, width: band, height: plotH + 20, fill: "transparent" });
      hit.addEventListener("pointerenter", function () { var bb = box.getBoundingClientRect(), s = bb.width / W; tip(box, x * s, y * s, labels[i] + ": " + v.toFixed(1) + "% (" + nf.format(b[i]) + " fights)"); });
      hit.addEventListener("pointerleave", function () { tip(box, 0, 0, null); });
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: T + plotH, y2: T + plotH, stroke: "var(--axis)", "stroke-width": 1 }));
    var gy = H - 8;
    svgText(svg, L + band * 1.5, gy, shortOf("A") + " wins", { "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "var(--blue)" });
    svgText(svg, L + band * 5.5, gy, shortOf("B") + " wins", { "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "var(--red)" });
    box.textContent = ""; box.appendChild(svg); if (tipEl) tipEl.hidden = true;
  }
  function drawRounds(agg) {
    var box = $("roundChart"), n = Math.max(1, agg.n), nR = agg.nR;
    var W = Math.max(300, Math.round(box.clientWidth || 560)), H = 178, L = 34, R = 8, T = 16, B = 42;
    var a = agg.finA.map(function (x) { return 100 * x / n; }), g = agg.finB.map(function (x) { return 100 * x / n; });
    var max = niceMax(Math.max(Math.max.apply(null, a), Math.max.apply(null, g), 1) * 1.18);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Finishes by round. " + nameOf("A") + ": " + a.map(function (v, i) { return "round " + (i + 1) + " " + v.toFixed(1) + "%"; }).join(", ") + ". " + nameOf("B") + ": " + g.map(function (v, i) { return "round " + (i + 1) + " " + v.toFixed(1) + "%"; }).join(", ") });
    var plotW = W - L - R, plotH = H - T - B, band = plotW / nR, bw = Math.min(24, band * 0.28);
    [0, max / 2, max].forEach(function (t) {
      var y = T + plotH - plotH * t / max;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }));
      svgText(svg, L - 6, y + 4, (t % 1 ? t.toFixed(1) : t) + "%", { "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
    });
    for (var i = 0; i < nR; i++) {
      [[a[i], "var(--blue)", -1, shortOf("A")], [g[i], "var(--red)", 1, shortOf("B")]].forEach(function (s) {
        var cx = L + band * i + band / 2 + s[2] * (bw / 2 + 2), h = plotH * s[0] / max, y = T + plotH - h;
        svg.appendChild(svgEl("path", { d: barPath(cx - bw / 2, cx + bw / 2, y, T + plotH), fill: s[1] }));
        svgText(svg, cx, y - 4, s[0].toFixed(1), { "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: "var(--ink-2)" });
        var rnd = i + 1, who = s[3], val = s[0];
        var hit = svgEl("rect", { x: cx - bw / 2 - 2, y: T, width: bw + 4, height: plotH, fill: "transparent" });
        hit.addEventListener("pointerenter", function () { var bb = box.getBoundingClientRect(), sc = bb.width / W; tip(box, cx * sc, y * sc, who + " finishes in round " + rnd + ": " + val.toFixed(1) + "% of fights"); });
        hit.addEventListener("pointerleave", function () { tip(box, 0, 0, null); });
        svg.appendChild(hit);
      });
      svgText(svg, L + band * i + band / 2, T + plotH + 16, (W < 430 ? "R" : "Round ") + (i + 1), { "text-anchor": "middle", "font-size": 11, fill: "var(--ink-2)" });
    }
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: T + plotH, y2: T + plotH, stroke: "var(--axis)", "stroke-width": 1 }));
    svg.appendChild(svgEl("circle", { cx: L + 6, cy: H - 9, r: 5, fill: "var(--blue)" }));
    var t1 = svgText(svg, L + 15, H - 5, shortOf("A") + " finishes", { "font-size": 11.5, fill: "var(--ink-2)" });
    var off = L + 15 + Math.max(110, (shortOf("A").length + 9) * 7);
    svg.appendChild(svgEl("circle", { cx: off, cy: H - 9, r: 5, fill: "var(--red)" }));
    svgText(svg, off + 9, H - 5, shortOf("B") + " finishes", { "font-size": 11.5, fill: "var(--ink-2)" });
    void t1;
    box.textContent = ""; box.appendChild(svg);
  }
  function renderMethodTable(agg) {
    var t = $("methodTbl"), n = Math.max(1, agg.n), M = agg.methods; t.textContent = "";
    function c(side, keys) { var s = 0; keys.forEach(function (k) { s += M[side + ":" + k] || 0; }); return s; }
    var rows = [["Knockout, one shot", ["KO"]], ["TKO, strikes", ["TKO"]], ["TKO, ground strikes", ["GNP"]], ["TKO, leg kicks", ["LEG"]], ["Corner or doctor stoppage", ["CORNER", "DOC"]],
      ["Submission", ["SUB"]], ["Unanimous decision", ["UD"]], ["Split decision", ["SD"]], ["Majority decision", ["MD"]]];
    var th = el("thead"), hr = el("tr");
    hr.appendChild(el("th", null, "Method")); var ha = el("th", "hA", shortOf("A")), hb = el("th", "hB", shortOf("B")); hr.appendChild(ha); hr.appendChild(hb); hr.appendChild(el("th", null, "Either"));
    Array.prototype.forEach.call(hr.children, function (x) { x.scope = "col"; }); th.appendChild(hr); t.appendChild(th);
    var tb = el("tbody"), totA = 0, totB = 0;
    rows.forEach(function (r) {
      var a = c("A", r[1]), b = c("B", r[1]); totA += a; totB += b;
      if (!a && !b && (r[1][0] === "LEG")) return;
      var tr = el("tr"); tr.appendChild(el("td", null, r[0])); tr.appendChild(el("td", null, pct(a / n))); tr.appendChild(el("td", null, pct(b / n))); tr.appendChild(el("td", null, pct((a + b) / n))); tb.appendChild(tr);
    });
    var dr = el("tr"); dr.appendChild(el("td", null, "Draw")); dr.appendChild(el("td", null, "")); dr.appendChild(el("td", null, "")); dr.appendChild(el("td", null, pct((M["D:DRAW"] || 0) / n))); tb.appendChild(dr);
    var tr2 = el("tr"); tr2.appendChild(el("td", "strong", "Total")); tr2.appendChild(el("td", "strong", pct(totA / n))); tr2.appendChild(el("td", "strong", pct(totB / n))); tr2.appendChild(el("td", "strong", pct(1))); tb.appendChild(tr2);
    t.appendChild(tb);
  }
  function renderAvgTable(agg) {
    var t = $("avgTbl"), n = Math.max(1, agg.n), ST = E.STATS; t.textContent = "";
    function g(arr, k) { var i = ST.indexOf(k); return i < 0 ? 0 : arr[i] / n; }
    var A = agg.sumA, B = agg.sumB;
    function accStr(arr) { var att = g(arr, "sig_att"); return att ? pct(g(arr, "sig_lnd") / att, 0) : "–"; }
    var rows = [
      ["Sig. strikes landed / thrown", function (x) { return fx(g(x, "sig_lnd"), 1) + " / " + fx(g(x, "sig_att"), 1); }],
      ["Accuracy", accStr],
      ["Head · body · legs landed", function (x) { return fx(g(x, "h_lnd"), 0) + " · " + fx(g(x, "b_lnd"), 0) + " · " + fx(g(x, "l_lnd"), 0); }],
      ["Distance · clinch · ground landed", function (x) { return fx(g(x, "d_lnd"), 0) + " · " + fx(g(x, "c_lnd"), 0) + " · " + fx(g(x, "g_lnd"), 0); }],
      ["Knockdowns scored", function (x) { return fx(g(x, "kd"), 2); }],
      ["Rocked opponent (no knockdown)", function (x) { return fx(g(x, "hurt"), 2); }],
      ["Takedowns landed / tried", function (x) { return fx(g(x, "td_lnd"), 2) + " / " + fx(g(x, "td_att"), 2); }],
      ["Control time", function (x) { return mmss(g(x, "ctrl")); }],
      ["Submission attempts", function (x) { return fx(g(x, "sub_att"), 2); }]
    ];
    var th = el("thead"), hr = el("tr"); hr.appendChild(el("th", null, "Per fight")); hr.appendChild(el("th", "hA", shortOf("A"))); hr.appendChild(el("th", "hB", shortOf("B")));
    Array.prototype.forEach.call(hr.children, function (x) { x.scope = "col"; }); th.appendChild(hr); t.appendChild(th);
    var tb = el("tbody");
    rows.forEach(function (r) { var tr = el("tr"); tr.appendChild(el("td", null, r[0])); tr.appendChild(el("td", null, r[1](A))); tr.appendChild(el("td", null, r[1](B))); tb.appendChild(tr); });
    var tr = el("tr"); tr.appendChild(el("td", null, "Average fight length")); var td = el("td", null, mmss(agg.secs / n) + " of " + S.rounds * 5 + ":00"); td.colSpan = 2; tr.appendChild(td); tb.appendChild(tr);
    t.appendChild(tb);
  }

  /* ================================================================ why the model says this */
  function renderWhy() {
    var x = cur.x, m = cur.m, reads = $("reads"), mir = $("mirror"), chain = $("kdChain");
    reads.textContent = ""; mir.textContent = ""; chain.textContent = "";
    if (!x || !m) { $("whyLede").textContent = "The engine could not explain this matchup."; return; }
    var A = x.A, B = x.B, nA = shortOf("A"), nB = shortOf("B"), L = m.L, P = m.P, divl = S.div.toLowerCase();
    $("whySub").textContent = S.div + " priors (" + (P.lbs || "?") + " lb) · " + S.rounds + " rounds";
    $("whyLede").textContent = "These are the rates the engine derived for this pair before any fight is played: each fighter's data combined with the opponent's, adjusted for age, size and your knob settings. Every simulated fight then adds fight-night form, fatigue and damage on top.";
    function rel(v, base) { var r = v / base - 1; return Math.abs(r) < 0.03 ? "about the " + divl + " average" : Math.round(Math.abs(r) * 100) + "% " + (r > 0 ? "above" : "below") + " the " + divl + " average"; }
    var items = [];
    var dA = A.attPerMin.dist, dB = B.attPerMin.dist;
    items.push(["Volume", nA + " throws " + fx(dA, 1) + " strikes a minute at distance, " + rel(dA, L.dAtt) + "; " + nB + " throws " + fx(dB, 1) + ", " + rel(dB, L.dAtt) + ". Those rates already account for how much each one's opponents usually throw at them."]);
    var hA = A.accuracy.dist[0], hB = B.accuracy.dist[0];
    items.push(["Accuracy", "At distance " + nA + " lands " + pct(hA, 0) + " of head strikes on " + nB + " and " + nB + " lands " + pct(hB, 0) + " on " + nA + ". Per 15 minutes that comes to about " + fx(A.expectedPer15.sigLnd, 0) + " significant strikes landed for " + nA + " and " + fx(B.expectedPer15.sigLnd, 0) + " for " + nB + ", before pace and fatigue."]);
    var kA = A.kd.perHeadLanded, kB = B.kd.perHeadLanded, p0 = A.kd.p0;
    items.push(["Power", "A clean standing head shot from " + nA + " drops " + nB + " " + pct(kA, 2) + " of the time; one from " + nB + " drops " + nA + " " + pct(kB, 2) + " of the time. The " + divl + " baseline is " + pct(p0, 2) + ". " + (kB > kA * 1.3 ? nB + " needs far fewer clean shots to change the fight." : (kA > kB * 1.3 ? nA + " needs far fewer clean shots to change the fight." : "Neither has a big edge per shot."))]);
    var tA = A.grappling.tdAttPer15Stand, tB = B.grappling.tdAttPer15Stand;
    items.push(["Wrestling", nA + " shoots about " + fx(tA, 1) + " times per 15 standing minutes and finishes " + pct(A.grappling.tdSuccess, 0) + "; " + nB + " shoots " + fx(tB, 1) + " and finishes " + pct(B.grappling.tdSuccess, 0) + " (league " + pct(P.td_acc, 0) + "). Once down, " + nB + " gets back up in about " + fx(B.grappling.standUpMeanSecWhenUnder, 0) + " seconds on average and " + nA + " in about " + fx(A.grappling.standUpMeanSecWhenUnder, 0) + "."]);
    var cA = A.cardio, cB = B.cardio;
    items.push(["Cardio", nA + "'s output by round runs " + cA.paceByRound.map(function (v) { return fx(v); }).join(", ") + " and " + nB + "'s " + cB.paceByRound.map(function (v) { return fx(v); }).join(", ") + " (1.00 is the average early pace). " + (cA.drainVsLeague < cB.drainVsLeague ? nA : nB) + " tires more slowly."]);
    if (A.subs.attemptsPerGroundMin > 0 || B.subs.attemptsPerGroundMin > 0) {
      items.push(["Submissions", nA + " attempts " + fx(A.subs.attemptsPerGroundMin * 10, 2) + " submissions per 10 ground minutes and converts " + pct(A.subs.conversion, 0) + "; " + nB + " " + fx(B.subs.attemptsPerGroundMin * 10, 2) + " at " + pct(B.subs.conversion, 0) + " (league " + fx(L.sub * 10, 2) + " at " + pct(P.sub_conv, 0) + ")."]);
    }
    items.forEach(function (it, i) { var li = el("li"); li.appendChild(el("i", null, String(i + 1))); var p = el("span"); p.appendChild(el("b", null, it[0] + ". ")); p.appendChild(document.createTextNode(it[1])); li.appendChild(p); reads.appendChild(li); });

    // occupancy bar
    var occ = x.pair.occupancy, occBox = $("occBar"), key = $("occKey"); occBox.textContent = ""; key.textContent = "";
    var parts = [["Distance", occ[0], "var(--axis)", "var(--ink)"], ["Clinch", occ[1] + occ[2], "var(--muted)", "var(--on-fill)"], [nA + " on top", occ[3], "var(--blue)", "var(--on-fill)"], [nB + " on top", occ[4], "var(--red)", "var(--on-fill)"]];
    parts.forEach(function (p) {
      var s = el("span", null, p[1] > 0.09 ? pct(p[1], 0) : ""); s.style.width = Math.max(0.5, p[1] * 100) + "%"; s.style.background = p[2]; s.style.color = p[3]; occBox.appendChild(s);
      var k = el("span"); var i = el("i"); i.style.background = p[2]; k.appendChild(i); k.appendChild(document.createTextNode(p[0] + " " + pct(p[1], 0))); key.appendChild(k);
    });
    occBox.setAttribute("aria-label", "Expected share of fight time: " + parts.map(function (p) { return p[0] + " " + pct(p[1], 0); }).join(", "));

    // knockdown chains
    chain.appendChild(el("h3", "mini", "Knockdown chance per clean head shot"));
    [["A", A, 0], ["B", B, 1]].forEach(function (s) {
      var side = s[0], o = s[1].kd, row = el("div", "chain");
      row.setAttribute("aria-label", shortOf(side) + " drops " + shortOf(other(side)) + " " + pct(o.perHeadLanded, 2) + " of the time per clean standing head shot");
      function f(label, v, inv, always) {
        if (v == null || !isFinite(v)) return;
        if (!always && label !== "base" && Math.abs(v - 1) < 0.005) return;
        var span = el("span", "f" + (label === "base" || Math.abs(v - 1) < 0.02 ? "" : ((v > 1) !== !!inv ? " up" : " dn")));
        span.appendChild(el("b", null, (label === "base" ? pct(v, 2) : "×" + fx(v)))); span.appendChild(document.createTextNode(" " + (label === "base" ? divl + " base" : label)));
        if (row.children.length) row.appendChild(el("span", "op", "·"));
        row.appendChild(span);
      }
      var opp = shortOf(other(side));
      f("base", o.p0);
      f(shortOf(side) + "'s power", o.powerRatio, false, true);
      f(opp + "'s chin", o.oppChinRatio, false, true);
      f(opp + "'s age", o.ageChinOpp);
      f("own age", o.agePow);
      f(opp + "'s " + o.oppKoLosses + " KO losses", o.koLossChinOpp);
      f(opp + " moving up", o.sizeChinOpp);
      f("own move up", o.sizePow);
      if (Math.abs(o.knobPow - 1) > 0.005) f("power knob", o.knobPow);
      if (Math.abs(o.knobChinOpp - 1) > 0.005) f("chin knob", o.knobChinOpp);
      row.appendChild(el("span", "op", "="));
      row.appendChild(el("span", "res-f " + side, pct(o.perHeadLanded, 2)));
      chain.appendChild(row);
    });
    chain.appendChild(el("p", "small", "Each factor multiplies the base rate. Red borders raise the chance of a knockdown, green borders lower it. A knockdown is not a finish: the engine then plays out the follow-up, and the referee may stop it or the downed fighter may recover."));

    // mirrored bars
    var hd = el("div", "mir-h"); hd.appendChild(el("span", "A", nA)); hd.appendChild(el("span", "B", nB)); mir.appendChild(hd);
    function mrow(label, va, vb, ref, fmt, note) {
      var max = Math.max(va || 0, vb || 0, ref || 0) * 1.12 || 1;
      var r = el("div", "mrow"), l = el("div", "mrow-l"); l.appendChild(el("span", null, label)); if (note) l.appendChild(el("small", null, note)); r.appendChild(l);
      var b = el("div", "mrow-b");
      b.appendChild(el("span", "v A", fmt(va)));
      [["A", va], ["B", vb]].forEach(function (s) {
        var h = el("div", "half " + s[0]), i = el("i"); i.style.width = clamp(100 * (s[1] || 0) / max, 0, 100) + "%"; h.appendChild(i);
        if (ref != null) { var u = el("u"); u.style[s[0] === "A" ? "right" : "left"] = clamp(100 * ref / max, 0, 100) + "%"; h.appendChild(u); }
        b.appendChild(h);
      });
      b.appendChild(el("span", "v B", fmt(vb)));
      b.setAttribute("role", "img"); b.setAttribute("aria-label", label + ": " + nA + " " + fmt(va) + ", " + nB + " " + fmt(vb) + (ref != null ? ", league " + fmt(ref) : ""));
      r.appendChild(b); mir.appendChild(r);
    }
    var f1 = function (v) { return fx(v, 1); }, f2 = function (v) { return fx(v, 2); }, fp = function (v) { return pct(v, 0); }, fp2 = function (v) { return pct(v, 2); };
    mrow("Strike attempts / min at distance", A.attPerMin.dist, B.attPerMin.dist, L.dAtt, f1);
    mrow("Strike attempts / min in the clinch", A.attPerMin.clinch, B.attPerMin.clinch, null, f1);
    mrow("Ground strikes / min on top", A.attPerMin.groundTop, B.attPerMin.groundTop, L.gAtt, f1);
    mrow("Head accuracy at distance", A.accuracy.dist[0], B.accuracy.dist[0], null, fp);
    mrow("Body accuracy at distance", A.accuracy.dist[1], B.accuracy.dist[1], null, fp);
    mrow("Leg accuracy at distance", A.accuracy.dist[2], B.accuracy.dist[2], null, fp);
    mrow("Leg-kick share at distance", A.targetMixDist[2], B.targetMixDist[2], L.mixD[2], fp);
    mrow("KD chance per clean head shot", A.kd.perHeadLanded, B.kd.perHeadLanded, A.kd.p0, fp2);
    mrow("Takedown attempts / 15 standing min", A.grappling.tdAttPer15Stand, B.grappling.tdAttPer15Stand, L.tdAtt * 15, f1);
    mrow("Takedown success", A.grappling.tdSuccess, B.grappling.tdSuccess, P.td_acc, fp);
    mrow("Control target, seconds / 15 min", A.grappling.ctrlTargetPer15, B.grappling.ctrlTargetPer15, P.ctrl * 15, function (v) { return fx(v, 0); });
    mrow("Submission attempts / 10 ground min", A.subs.attemptsPerGroundMin * 10, B.subs.attemptsPerGroundMin * 10, L.sub * 10, f2);
    mrow("Submission conversion", A.subs.conversion, B.subs.conversion, P.sub_conv, fp);
    mrow("Cardio index (late-round output)", A.cardio.cardioIndex, B.cardio.cardioIndex, 1, f2, "higher holds pace");
    var k = el("p", "mir-key"); k.appendChild(el("u")); k.appendChild(document.createTextNode(S.div + " average, where one applies")); mir.appendChild(k);
  }

  /* ================================================================ model stack */
  var stack = { engine: null, engineN: 0 };
  function calibGet(paths) {
    if (!CALIB) return null;
    for (var i = 0; i < paths.length; i++) {
      var o = CALIB, ok = true, ps = paths[i].split(".");
      for (var j = 0; j < ps.length; j++) { if (o && typeof o === "object" && ps[j] in o) o = o[ps[j]]; else { ok = false; break; } }
      if (ok && o != null) return o;
    }
    return null;
  }
  function eloScale() {
    var s = calibGet(["elo.scale", "elo_scale", "elo.calibrated_scale", "baselines.elo.scale", "stack.elo_scale", "blend.elo_scale"]);
    return s && isFinite(s) && s > 50 ? +s : 400;
  }
  function blendWeights() {
    var w = calibGet(["blend.weights", "stack.weights", "stacked_blend.weights", "stacked_blend", "blend_weights", "stack"]);
    if (w && typeof w === "object") {
      var e = +(w.engine != null ? w.engine : w.w_engine), l = +(w.elo != null ? w.elo : w.w_elo), mk = +(w.market != null ? w.market : w.w_market);
      if (isFinite(e) && isFinite(l)) { if (!isFinite(mk)) mk = 0; var s = e + l + mk; if (s > 0) return { engine: e / s, elo: l / s, market: mk / s, src: "calibration" }; }
    }
    return { engine: 0.4, elo: 0.2, market: 0.4, src: "default" };
  }
  function parseOdds(s) {
    s = String(s == null ? "" : s).trim().toLowerCase().replace(/[−–]/g, "-");
    if (!s) return null;
    if (s === "ev" || s === "even" || s === "evens") return 0.5;
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return NaN;
    var v = parseFloat(s);
    if (Math.abs(v) < 100) return NaN;
    return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
  }
  function logit(p) { p = clamp(p, 0.001, 0.999); return Math.log(p / (1 - p)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  function marketProb() {
    var ia = parseOdds(S.odds.A), ib = parseOdds(S.odds.B);
    if (ia == null || ib == null || !isFinite(ia) || !isFinite(ib)) return { p: null, ia: ia, ib: ib };
    return { p: ia / (ia + ib), ia: ia, ib: ib, over: ia + ib - 1 };
  }
  function renderStack() {
    var box = $("stackChart"); if (!box) return;
    var pa = prof("A"), pb = prof("B"), sc = eloScale();
    var pElo = pa.elo && pb.elo ? 1 / (1 + Math.pow(10, -(pa.elo - pb.elo) / sc)) : null;
    var mk = marketProb(), W = blendWeights();
    if (S.trust == null) S.trust = W.market;
    var hasM = mk.p != null, t = hasM ? S.trust : 0;
    var rest = W.engine + W.elo || 1, we = (1 - t) * W.engine / rest, wl = (1 - t) * W.elo / rest;
    var pE = stack.engine;
    var comps = [];
    if (pE != null) comps.push([we, pE]);
    if (pElo != null) comps.push([wl, pElo]);
    if (hasM) comps.push([t, mk.p]);
    var ws = 0, z = 0; comps.forEach(function (c) { ws += c[0]; z += c[0] * logit(c[1]); });
    var pBl = ws > 0 ? sigm(z / ws) : null;
    var nA = shortOf("A");
    var rows = [
      { l: "Fight engine v3", s: pE != null ? nf.format(stack.engineN) + " fights, your settings" : "running…", v: pE },
      { l: "Elo", s: pa.elo && pb.elo ? pa.elo + " vs " + pb.elo + ", scale " + Math.round(sc) : "no rating", v: pElo },
      { l: "Betting market", s: hasM ? "no-vig, from the odds below" : "enter odds below", v: hasM ? mk.p : null },
      { l: "The blend", s: "log-odds average", v: pBl, strong: true }
    ];
    var Wd = Math.max(300, Math.round(box.clientWidth || 520)), narrow = Wd < 500;
    var rowH = narrow ? 56 : 44, T = 8, H = T + rows.length * rowH + 24, X0 = narrow ? 4 : 210, X1 = Wd - 48;
    var svg = svgEl("svg", { viewBox: "0 0 " + Wd + " " + H, role: "img", "aria-label": nameOf("A") + "'s chance by source: " + rows.map(function (r) { return r.l + " " + (r.v == null ? "not available" : pct(r.v, 0)); }).join(", ") });
    function xOf(v) { return X0 + (X1 - X0) * v; }
    [0, 0.25, 0.5, 0.75, 1].forEach(function (tk) {
      var xx = xOf(tk);
      svg.appendChild(svgEl("line", { x1: xx, x2: xx, y1: T, y2: T + rows.length * rowH, stroke: tk === 0.5 ? "var(--axis)" : "var(--line)", "stroke-width": 1, "stroke-dasharray": tk === 0.5 ? "3 3" : "none" }));
      svgText(svg, xx, H - 6, Math.round(tk * 100) + "%", { "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" });
    });
    rows.forEach(function (r, i) {
      var y = narrow ? T + i * rowH + 38 : T + i * rowH + rowH / 2;
      var t1 = svgText(svg, 0, narrow ? y - 20 : y - 3, r.l, { "font-size": 13, "font-weight": r.strong ? 800 : 700, fill: "var(--ink)" });
      svgText(svg, narrow ? Math.min(Wd - 120, r.l.length * 7.4 + 10) : 0, narrow ? y - 20 : y + 12, r.s, { "font-size": 10.5, fill: "var(--muted)" });
      void t1;
      if (r.v == null) { svgText(svg, xOf(0.5), y + 4, "–", { "text-anchor": "middle", "font-size": 13, fill: "var(--muted)" }); return; }
      svg.appendChild(svgEl("line", { x1: xOf(0), x2: xOf(r.v), y1: y, y2: y, stroke: r.strong ? "var(--ink)" : "var(--axis)", "stroke-width": r.strong ? 3 : 2 }));
      svg.appendChild(svgEl("circle", { cx: xOf(r.v), cy: y, r: r.strong ? 7 : 5.5, fill: r.strong ? "var(--ink)" : "var(--blue)" }));
      svgText(svg, X1 + 10, y + 4, pct(r.v, 0), { "font-size": 13, "font-weight": 700, fill: "var(--ink)" });
    });
    box.textContent = ""; box.appendChild(svg);
    // odds inputs and notes
    ["A", "B"].forEach(function (s) {
      var inp = $("odd" + s); if (document.activeElement !== inp) inp.value = S.odds[s] || "";
      var v = parseOdds(S.odds[s]); inp.setAttribute("aria-invalid", v != null && !isFinite(v) ? "true" : "false");
    });
    var pd = pairData(S.a, S.b), note = $("oddNote"); note.textContent = "";
    if (hasM) note.appendChild(document.createTextNode("Implied " + pct(mk.ia, 1) + " and " + pct(mk.ib, 1) + " (margin " + pct(mk.over, 1) + "); with the margin removed, " + nA + " " + pct(mk.p, 1) + ". "));
    else if (isNaN(mk.ia) || isNaN(mk.ib)) note.appendChild(document.createTextNode("Use American odds such as +160 or -180. "));
    else note.appendChild(document.createTextNode("No price for this pair. Enter both sides' American odds to add the market to the blend. "));
    if (pd && pd.market && pd.market.odds && (S.odds.A === pd.market.odds[S.a] && S.odds.B === pd.market.odds[S.b])) {
      note.appendChild(document.createTextNode("Prefilled: " + pd.market.label + ". " + (pd.market.range || "") + " "));
      var srcs = el("span", "srcs"); srcs.style.display = "inline-flex"; linkList(srcs, pd.market.sources); note.appendChild(srcs);
    }
    var slider = $("k-trust"); slider.disabled = !hasM; slider.value = t;
    $("o-trust").textContent = hasM ? Math.round(t * 100) + "%" : "off";
    $("trustHint").textContent = (W.src === "calibration" ? "Starting weights come from the stacked blend fit in the walk-forward backtest" : "Starting weights are 40% market, 40% engine and 20% Elo until the backtest's stacked blend is available") +
      ". The rest splits between the engine and Elo in the same ratio. The market price here is an opening line, which is less sharp than a closing one.";
    $("blendOut").textContent = pBl == null ? "–" : nA + " " + Math.round(100 * pBl) + "%, " + shortOf("B") + " " + (100 - Math.round(100 * pBl)) + "%";
    $("blendNote").textContent = "Weights: " + (hasM ? "market " + Math.round(t * 100) + "%, " : "") + "engine " + Math.round(we / Math.max(1e-9, ws) * 100) + "%, Elo " + Math.round(wl / Math.max(1e-9, ws) * 100) + "%. The engine and Elo share information, so this is a pooled opinion, not three independent votes.";
    // market marker on the tally bar
    var mkM = $("mktMark"), mkN = $("mktNote");
    if (hasM) {
      mkM.hidden = false; mkN.hidden = false; mkM.style.left = (100 * mk.p) + "%";
      $("mktNoteT").textContent = "Market: " + nA + " " + pct(mk.p, 0) + " with the margin removed (" + (S.odds.A || "") + " / " + (S.odds.B || "") + ").";
    } else { mkM.hidden = true; mkN.hidden = true; }
  }

  /* ================================================================ backtest */
  function findModels() {
    var test = calibGet(["test", "holdout", "held_out", "test_2024_plus", "metrics.test", "metrics.holdout", "metrics.held_out", "metrics.test_2024_plus", "report.test", "winner.test"]);
    if (!test || typeof test !== "object") return null;
    var names = { engine: ["engine", "sim", "engine_v3", "model"], elo: ["elo"], blend: ["blend", "stack", "stacked", "engine_elo_blend", "engine+elo"], coin: ["coin", "coin_flip", "baseline", "naive_coin"], naive: ["naive", "more_wins", "more_ufc_wins"] };
    var out = {};
    for (var k in names) names[k].forEach(function (nm) { if (!out[k] && test[nm] && typeof test[nm] === "object") out[k] = test[nm]; });
    if (!out.coin) out.coin = { log_loss: Math.log(2), brier: 0.25, accuracy: 0.5 };
    return out.engine || out.elo ? { models: out, n: test.n || (out.engine && out.engine.n) || (out.elo && out.elo.n) } : null;
  }
  function metric(o, keys) { if (!o) return null; for (var i = 0; i < keys.length; i++) if (o[keys[i]] != null && isFinite(o[keys[i]])) return +o[keys[i]]; return null; }
  function renderBacktest() {
    var box = $("btBody"); box.textContent = "";
    var intro = el("p", "lede", "Every fight in the backtest is predicted with each fighter's profile frozen as it stood the day before, so the model never sees the result. Settings were tuned on 2019-2023 and scored on 2024 onward. This replaces v2's seven-fight backtest, which used career numbers that already included those fights.");
    box.appendChild(intro);
    var mods = CALIB ? findModels() : null;
    if (!CALIB || !mods) {
      var st = el("div", "status");
      var p1 = el("p"); p1.appendChild(el("b", null, CALIB ? "The calibration report is in an unexpected format. " : "Calibration is still running. "));
      p1.appendChild(document.createTextNode("When the walk-forward run finishes, this panel shows held-out log loss, Brier score and accuracy for the engine, Elo, the blend and a coin flip, a reliability chart and the base-rate table."));
      st.appendChild(p1);
      st.appendChild(el("p", null, "For scale while it runs: the data pipeline's Elo baseline scored a log loss of 0.680 and picked 54.9% of winners on 1,223 held-out fights from 2024 on, against 0.693 and 50% for a coin flip (data/derived/elo_report.json, Nov 6, 2026). Lower log loss is better."));
      box.appendChild(st);
      box.appendChild(caveats());
      return;
    }
    var M = mods.models, rows = [["Fight engine", M.engine], ["Elo", M.elo], ["Blend", M.blend], ["More UFC wins", M.naive], ["Coin flip", M.coin]].filter(function (r) { return r[1]; });
    var wrap = el("div", "tbl-wrap"), t = el("table", "data"), th = el("thead"), hr = el("tr");
    ["Held-out, 2024 on", "Log loss", "Brier", "Accuracy", "Fights"].forEach(function (h) { var x = el("th", null, h); x.scope = "col"; hr.appendChild(x); }); th.appendChild(hr); t.appendChild(th);
    var tb = el("tbody"), bestLL = Infinity;
    rows.forEach(function (r) { var v = metric(r[1], ["log_loss", "logloss", "ll"]); if (v != null && v < bestLL) bestLL = v; });
    rows.forEach(function (r) {
      var o = r[1], ll = metric(o, ["log_loss", "logloss", "ll"]), br = metric(o, ["brier"]), ac = metric(o, ["accuracy", "acc"]), n = metric(o, ["n"]) || mods.n;
      var tr = el("tr"); tr.appendChild(el("td", ll === bestLL ? "strong" : null, r[0]));
      tr.appendChild(el("td", ll === bestLL ? "strong" : null, fx(ll, 4))); tr.appendChild(el("td", null, fx(br, 4))); tr.appendChild(el("td", null, pct(ac, 1))); tr.appendChild(el("td", null, n ? nf.format(n) : "–"));
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); box.appendChild(wrap);
    box.appendChild(el("p", "small", "Log loss and Brier score: lower is better. Draws and no-contests are left out. Accuracy counts how often the model's favorite won."));
    // reliability chart
    var bins = calibGet(["calibration_bins", "calibration", "reliability", "test_calibration", "bins"]);
    var series = [];
    if (Array.isArray(bins)) series.push(["Fight engine", bins, "var(--ink)"]);
    else if (bins && typeof bins === "object") [["engine", "Fight engine", "var(--ink)"], ["elo", "Elo", "var(--neutral)"], ["blend", "Blend", "var(--gold)"]].forEach(function (k) { if (Array.isArray(bins[k[0]])) series.push([k[1], bins[k[0]], k[2]]); });
    if (series.length) {
      box.appendChild(el("h3", "mini", "Reliability: predicted vs actual win rate"));
      var cb = el("div", "chart"); box.appendChild(cb); drawReliability(cb, series);
      var lg = el("div", "bt-legend"); series.forEach(function (s) { var x = el("span"), i = el("i"); i.style.background = s[2]; x.appendChild(i); x.appendChild(document.createTextNode(s[0])); lg.appendChild(x); });
      var dg = el("span"); dg.appendChild(document.createTextNode("Dashed line: perfect calibration. Dot size: number of fights.")); lg.appendChild(dg); box.appendChild(lg);
    }
    // base rates
    var br = calibGet(["baserates", "base_rates", "base_rate_table", "baserate_table", "league"]);
    var brRows = [];
    if (Array.isArray(br)) br.forEach(function (r) { if (r && typeof r === "object") brRows.push([r.label || r.name || r.stat || r.key, r.sim != null ? r.sim : r.model, r.actual != null ? r.actual : (r.data != null ? r.data : r.obs), r.unit || r.fmt]); });
    else if (br && typeof br === "object") for (var k in br) { var v = br[k]; if (v && typeof v === "object" && (v.sim != null || v.model != null)) brRows.push([v.label || k, v.sim != null ? v.sim : v.model, v.actual != null ? v.actual : (v.data != null ? v.data : v.obs), v.unit || v.fmt]); }
    if (brRows.length) {
      box.appendChild(el("h3", "mini", "League base rates: simulated vs actual"));
      var w2 = el("div", "tbl-wrap"), t2 = el("table", "data"), h2 = el("thead"), r2 = el("tr");
      ["Statistic", "Simulated", "Actual"].forEach(function (h) { var x = el("th", null, h); x.scope = "col"; r2.appendChild(x); }); h2.appendChild(r2); t2.appendChild(h2);
      var b2 = el("tbody");
      brRows.slice(0, 18).forEach(function (r) {
        function f(v) { if (v == null || !isFinite(v)) return v == null ? "–" : String(v); return (r[3] === "pct" || (Math.abs(v) <= 1 && r[3] !== "num")) ? pct(v, 1) : fx(v, 2); }
        var tr = el("tr"); tr.appendChild(el("td", null, String(r[0]).replace(/_/g, " "))); tr.appendChild(el("td", null, f(r[1]))); tr.appendChild(el("td", null, f(r[2]))); b2.appendChild(tr);
      });
      t2.appendChild(b2); w2.appendChild(t2); box.appendChild(w2);
    }
    box.appendChild(caveats());
  }
  function drawReliability(box, series) {
    var W = Math.max(280, Math.min(460, Math.round(box.clientWidth || 360))), H = W * 0.86, L = 40, R = 10, T = 10, B = 34;
    var pw = W - L - R, ph = H - T - B;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Reliability chart: " + series.map(function (s) { return s[0] + " " + s[1].map(function (b) { return "predicted " + pct(b.pred != null ? b.pred : b.p, 0) + " actual " + pct(b.obs != null ? b.obs : b.o, 0); }).join("; "); }).join(". ") });
    function X(v) { return L + pw * v; } function Y(v) { return T + ph - ph * v; }
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      svg.appendChild(svgEl("line", { x1: X(0), x2: X(1), y1: Y(v), y2: Y(v), stroke: "var(--line)", "stroke-width": 1 }));
      svgText(svg, L - 6, Y(v) + 4, Math.round(v * 100) + "%", { "text-anchor": "end", "font-size": 10.5, fill: "var(--muted)" });
      svgText(svg, X(v), H - 16, Math.round(v * 100) + "%", { "text-anchor": "middle", "font-size": 10.5, fill: "var(--muted)" });
    });
    svgText(svg, L + pw / 2, H - 2, "Predicted chance", { "text-anchor": "middle", "font-size": 11, fill: "var(--ink-2)" });
    svg.appendChild(svgEl("line", { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), stroke: "var(--axis)", "stroke-width": 1.5, "stroke-dasharray": "4 4" }));
    var maxN = 1; series.forEach(function (s) { s[1].forEach(function (b) { maxN = Math.max(maxN, b.n || 1); }); });
    series.forEach(function (s) {
      var pts = s[1].filter(function (b) { return (b.pred != null || b.p != null) && (b.obs != null || b.o != null); }).map(function (b) { return [b.pred != null ? b.pred : b.p, b.obs != null ? b.obs : b.o, b.n || 1]; });
      if (pts.length > 1) svg.appendChild(svgEl("polyline", { points: pts.map(function (p) { return X(p[0]) + "," + Y(p[1]); }).join(" "), fill: "none", stroke: s[2], "stroke-width": 1.5, opacity: 0.7 }));
      pts.forEach(function (p) { svg.appendChild(svgEl("circle", { cx: X(p[0]), cy: Y(p[1]), r: 2.5 + 6 * Math.sqrt(p[2] / maxN), fill: s[2], "fill-opacity": 0.85 })); });
    });
    box.textContent = ""; box.appendChild(svg);
  }
  function caveats() {
    var d = el("div"); d.appendChild(el("h3", "mini", "Read with care"));
    var ul = el("ul", "caveats");
    ["Rating systems and models like this one top out in the high 50s to 60s percent for picking winners; a few points of log loss is a real gain.",
      "The backtest scores the engine with neutral knobs. Scenario presets are judgment calls the backtest can't check.",
      "Fighters with little UFC data are pulled hard toward their division average, so debut and early-career predictions are close to coin flips by design.",
      "Featherweight champions moving up are rare in the data, so the backtest says little about Volkanovski at 155 specifically."].forEach(function (t) { ul.appendChild(el("li", null, t)); });
    d.appendChild(ul); return d;
  }

  /* ================================================================ research section visibility */
  function renderResearch() {
    var isDefault = (S.a === "alexander-volkanovski" && S.b === "justin-gaethje") || (S.b === "alexander-volkanovski" && S.a === "justin-gaethje");
    $("researchNote").textContent = isDefault ? "Headline facts for the default matchup, from fact-checked research files. Fighters are described by their own coverage." :
      "This section covers the default matchup, Volkanovski vs Gaethje at lightweight. For " + nameOf("A") + " and " + nameOf("B") + ", see the scouting notes in the tale of the tape.";
  }

  /* ================================================================ diagram */
  (function diagram() {
    var W = 760, H = 310, svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "State diagram: fighters move between distance and the clinch, takedowns take them to the ground where passes, sweeps and submissions happen, stand-ups bring them back, and knockouts, ground strikes, leg kicks or submissions end the fight." });
    var defs = svgEl("defs", {}), mk = svgEl("marker", { id: "ah", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    mk.appendChild(svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--ink-2)" })); defs.appendChild(mk); svg.appendChild(defs);
    function path(d) { svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: "var(--ink-2)", "stroke-width": 1.4, "marker-end": "url(#ah)" })); }
    function label(x, y, txt, anchor) { svgText(svg, x, y, txt, { "text-anchor": anchor || "middle", "font-size": 12, fill: "var(--muted)" }); }
    function node(cx, cy, w, h, l1, l2, fill) {
      svg.appendChild(svgEl("rect", { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 7, fill: fill || "var(--raised)", stroke: "var(--ink)", "stroke-width": 1.2 }));
      svgText(svg, cx, cy + (l2 ? -3 : 5), l1, { "text-anchor": "middle", "font-size": 14, "font-weight": 700, fill: "var(--ink)" });
      if (l2) svgText(svg, cx, cy + 14, l2, { "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" });
    }
    path("M108,94 L108,206"); path("M132,206 L132,94");
    label(144, 146, "clinch entry", "start"); label(144, 162, "break", "start");
    path("M204,74 L298,126"); label(266, 90, "takedown");
    path("M204,226 L298,174"); label(266, 222, "takedown");
    path("M360,108 Q330,52 206,60"); label(318, 50, "stand-up");
    path("M520,150 L606,150"); label(563, 140, "GNP, sub");
    path("M140,44 C330,-6 560,40 640,124"); label(400, 22, "KO, TKO, leg kicks");
    path("M140,256 C330,306 560,262 640,176"); label(400, 296, "knees, punches");
    node(120, 70, 168, 44, "Distance", "strikes by target"); node(120, 230, 168, 44, "Clinch", "one man controls");
    node(410, 150, 220, 64, "On the ground", "guard · half · side · mount · back"); node(676, 150, 132, 44, "Fight over", null, "var(--sunk)");
    $("diagram").appendChild(svg);
  })();

  /* ================================================================ live show: director adapter */
  var MOVES_DEF = {
    head: [["jab", 0.3], ["cross", 0.26], ["hook", 0.18], ["overhand", 0.12], ["upper", 0.1], ["headkick", 0.04]],
    body: [["bodykick", 0.4], ["bodyhook", 0.35], ["bodystraight", 0.25]],
    leg: [["calf", 0.6], ["inside", 0.4]],
    kd: [["cross", 0.3], ["hook", 0.3], ["overhand", 0.25], ["upper", 0.12], ["headkick", 0.03]]
  };
  var CLINCH_MV = { head: [["short", 0.45], ["elbow", 0.35], ["kneehead", 0.2]], body: [["knee", 0.7], ["shortbody", 0.3]], leg: [["knee", 1]] };
  var MOVE_TXT = { jab: "jab", cross: "right hand", hook: "left hook", overhand: "overhand", upper: "uppercut", headkick: "head kick",
    bodykick: "body kick", bodyhook: "hook to the body", bodystraight: "straight to the body", calf: "calf kick", inside: "inside low kick",
    short: "short punch", elbow: "elbow", kneehead: "knee", knee: "knee", shortbody: "body shot", gnp: "ground strike", gnpelbow: "elbow", upelbow: "elbow from the bottom" };
  function movesFor(slug) {
    var sc = SCOUT[slug], mv = sc && sc.moves, out = { head: MOVES_DEF.head, body: MOVES_DEF.body, leg: MOVES_DEF.leg, kd: MOVES_DEF.kd };
    if (!mv) return out;
    function tbl(keys) { var arr = [], s = 0; keys.forEach(function (k) { var v = +mv[k]; if (v > 0) { arr.push([k, v]); s += v; } }); if (!s) return null; return arr.map(function (x) { return [x[0], x[1] / s]; }); }
    out.head = tbl(["jab", "cross", "hook", "overhand", "upper", "headkick"]) || out.head;
    out.body = tbl(["bodykick", "bodyhook", "bodystraight"]) || out.body;
    out.leg = tbl(["calf", "inside"]) || out.leg;
    out.kd = tbl(["cross", "hook", "overhand", "upper", "headkick"]) || out.kd;
    return out;
  }
  function drng(seed) {
    var s = seed >>> 0;
    return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function pick(list, r) { var u = r(), acc = 0; for (var i = 0; i < list.length; i++) { acc += list[i][1]; if (u < acc) return list[i][0]; } return list[list.length - 1][0]; }
  function pickT(arr, r) { return arr[Math.floor(r() * arr.length)]; }
  function showSrc() { try { return FS && FS.Show ? FS.Show.prototype.dispatch.toString() + FS.Show.prototype.endRound.toString() : ""; } catch (e) { return ""; } }
  var SHOW_SRC = null;
  function showKnows(word) { if (SHOW_SRC == null) SHOW_SRC = showSrc(); return SHOW_SRC.indexOf(word) >= 0; }

  // Thin director: v3 trace events -> the show's beat format (strike / clinch / break / td / tdx / up / sub / subx / reset).
  // Used when no FightDirector script is present in the build.
  function localDirector(fight, seed, fighters) {
    var r = drng(seed ^ 0x5bd1e995);
    var NM = { A: fighters.A.name, B: fighters.B.name }, SH = { A: fighters.A.short, B: fighters.B.short };
    var PR = { A: fighters.A.pron, B: fighters.B.pron };
    var MV = { A: movesFor(fighters.A.slug), B: movesFor(fighters.B.slug) };
    var nativeSweep = showKnows('"sweep"'), nativeFollow = showKnows('"recover"');
    function fill(s, a, extra) {
      var d = other(a);
      return s.replace(/\{A\}/g, NM[a]).replace(/\{a\}/g, SH[a]).replace(/\{D\}/g, NM[d]).replace(/\{d\}/g, SH[d])
        .replace(/\{his\}/g, PR[a].his).replace(/\{dhis\}/g, PR[d].his).replace(/\{he\}/g, PR[a].he)
        .replace(/\{move\}/g, extra && extra.move || "").replace(/\{sub\}/g, extra && extra.sub || "").replace(/\{n\}/g, extra && extra.n || "");
    }
    var script = { rounds: [], winner: fight.winner, method: fight.method, detail: fight.detail, round: fight.round, t: fight.t, cards: fight.cards, form: fight.form, seed: seed };
    var legCount = { A: 0, B: 0 };
    for (var ri = 0; ri < fight.rounds.length; ri++) {
      var rd = fight.rounds[ri], ev = rd.ev, beats = [];
      var endT = rd.fin ? rd.fin.t : 300;
      var clinchTold = 0, comboTold = 0, lastStrike = { A: [], B: [] }, following = null;
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i], b = { t: e.t, ev: e }, w = e.w;
        if (e.k === "miss" || e.k === "hit" || e.k === "kd" || e.k === "fin" || e.k === "hurt") {
          var d = other(w), tg = e.tg || 0, tgName = tg === 0 ? "head" : (tg === 1 ? "body" : "leg"), st = e.s, landed = e.k !== "miss";
          var follow = e.pos === "down";
          if (follow && !nativeFollow && e.k !== "fin") continue;   // the show plays its own knockdown follow-up
          var move;
          if (e.loc === "ground" || st >= 2) move = ((st === 2 && w === "A") || (st === 3 && w === "B")) ? (r() < 0.75 ? "gnp" : "gnpelbow") : "upelbow";
          else if (st === 1 || e.loc === "clinch") move = pick(CLINCH_MV[tgName], r);
          else move = (e.k === "kd" || e.k === "fin" || e.k === "hurt") && tg === 0 ? pick(MV[w].kd, r) : pick(MV[w][tgName], r);
          if (e.k === "fin" && e.how === "LEG") move = "calf";
          b.k = "strike"; b.who = w; b.move = move; b.tgt = tg; b.landed = landed; b.st = st;
          b.kd = e.k === "kd"; b.fin = e.k === "fin"; b.hurt = e.k === "hurt"; if (!landed) b.miss = true;
          if (landed && tg === 2 && st === 0) {
            legCount[w]++;
            if (legCount[w] === 5 || legCount[w] === 10 || legCount[w] === 15) b.txt = fill(pickT(["{A} has landed {n} leg kicks. {D}'s lead leg is starting to show it.", "Leg kick number {n} for {a}. {D} is planting less on that lead leg."], r), w, { n: legCount[w] });
          }
          if (b.kd) {
            b.txt = fill(pickT(["DOWN! {A}'s {move} drops {D}.", "Knockdown! A {move} from {A} puts {D} on the canvas.", "{D} goes down off a {move} from {A}."], r), w, { move: MOVE_TXT[move] || "shot" });
            if (e.to >= 2) following = w;
          } else if (b.hurt) b.txt = fill(pickT(["{A} wobbles {D} with a {move}.", "{D} is hurt! Big {move} from {A}.", "A {move} from {A} buckles {D}'s knees."], r), w, { move: MOVE_TXT[move] || "shot" });
          else if (b.fin) {
            if (e.how === "LEG") b.txt = fill("{D}'s lead leg gives out. The leg kicks have finished it.", w);
            else if (follow) b.txt = fill(pickT(["{A} follows {D} to the mat and the referee waves it off.", "{A} jumps on the downed {D}. It's stopped."], r), w);
            else if (st >= 2 || e.how === "GNP") b.txt = fill(pickT(["{A} pours on the ground strikes. The referee jumps in.", "{A} pounds {D} out from the top."], r), w);
            else if (e.how === "TKO") b.txt = fill(pickT(["{A} swarms a hurt {D} and the referee steps in.", "{D} can't defend {dhis}self and the referee stops it."], r), w);
            else b.txt = fill(pickT(["IT'S OVER! {A}'s {move} puts {D} away.", "{A} finishes it with a {move}. {D} is out.", "Lights out. {A}'s {move} ends it."], r), w, { move: MOVE_TXT[move] || "shot" });
          } else if (landed && st === 0) {
            var ls = lastStrike[w]; ls.push(e.t); while (ls.length && e.t - ls[0] > 2.2) ls.shift();
            if (ls.length >= 3 && comboTold < 2 && !b.txt && r() < 0.6) {
              comboTold++; ls.length = 0;
              b.txt = fill(pickT(["{A} lands a three-strike combination.", "{A} puts together a clean combination.", "Sharp combination from {A}, finished with a {move}."], r), w, { move: MOVE_TXT[move] || "shot" });
            }
          }
        } else if (e.k === "clinch") {
          if (e.swap) continue;
          b.k = "clinch"; b.who = w || "A";
          if (!clinchTold || r() < 0.2) { clinchTold++; b.txt = fill(pickT(["{A} ties {D} up against the fence.", "They clinch up along the cage.", "{A} grabs a collar tie and drives {D} to the fence."], r), b.who); }
        } else if (e.k === "break") {
          b.k = "break";
        } else if (e.k === "td") {
          b.k = "td"; b.who = w;
          b.txt = fill(pickT(["{A} changes levels and finishes a double-leg.", "Takedown {a}! {D} is on {dhis} back.", "{A} chains a takedown and lands in {d}'s guard."], r), w);
        } else if (e.k === "tdx") {
          b.k = "tdx"; b.who = w;
          if (r() < 0.55) b.txt = fill(pickT(["{D} stuffs the takedown.", "{A} shoots. {D} sprawls and stays up.", "{D} reads the level change and defends."], r), w);
        } else if (e.k === "up") {
          b.k = "up"; b.who = w;
          b.txt = fill(pickT(["{A} wall-walks back to {his} feet.", "{A} scrambles up. We're standing again.", "{A} gets back up."], r), w);
        } else if (e.k === "sub" || e.k === "subx") {
          var sub = String(e.name || "submission").toLowerCase().replace("d'arce", "D'Arce");
          b.k = e.k; b.who = w; b.sub = sub;
          b.txt = e.k === "sub" ? fill("{D} taps! {A} finishes the {sub}.", w, { sub: sub }) : fill(pickT(["{A} hunts a {sub}. {D} defends.", "{A} threatens a {sub}, but {D} survives."], r), w, { sub: sub });
        } else if (e.k === "pass") {
          if (e.pos !== "mount" && e.pos !== "back") continue;
          b.k = "pass"; b.who = w; b.pos = e.pos;
          b.txt = fill(e.pos === "mount" ? "{A} passes to full mount." : "{A} takes {d}'s back.", w);
        } else if (e.k === "sweep") {
          if (nativeSweep) { b.k = "sweep"; b.who = w; b.txt = fill("{A} sweeps and comes up on top.", w); }
          else {
            beats.push({ t: e.t, k: "up", who: w, ev: e, txt: fill("{A} reverses and scrambles on top of {D}.", w), synthetic: true });
            b = { t: Math.min(endT - 0.2, e.t + 0.4), k: "td", who: w, ev: e, synthetic: true };
          }
        } else if (e.k === "recover") {
          var wasFollowing = following; following = null;
          if (nativeFollow) { b.k = "recover"; b.who = w; }
          else if (wasFollowing && e.s >= 2) { b = { t: e.t, k: "td", who: wasFollowing, ev: e, synthetic: true }; }
          else continue;
          b.txt = fill(e.s === 0 ? "{A} survives and gets back to {his} feet." : "{A} survives and recovers guard.", w);
        } else if (e.k === "reset") {
          b.k = "reset"; following = null;
        } else continue;
        beats.push(b);
      }
      beats.sort(function (x, y) { return x.t - y.t; });
      for (i = 1; i < beats.length; i++) {
        var p = beats[i - 1], c = beats[i];
        if (c.k === "strike" && p.k === "strike" && c.who === p.who && c.t - p.t < 1.6 && c.st === p.st) c.chain = true;
      }
      script.rounds.push({ r: ri, beats: beats, endT: endT, judges: rd.judges || null, stoppage: rd.stoppage || null, fin: rd.fin, st: rd.st,
        dHA: rd.dHA, dHB: rd.dHB, dLA: rd.dLA, dLB: rd.dLB, SA: rd.SA, SB: rd.SB });
    }
    return script;
  }
  function fighterInfo(side) {
    var p = prof(side), slug = slugOf(side), app = {}, k;
    var ov = OVR.fighters && OVR.fighters[slug] && OVR.fighters[slug].appearance, sc = SCOUT[slug] && SCOUT[slug].appearance, lk = LIKE[slug];
    if (sc) for (k in sc) if (k !== "sources" && k !== "notes") app[k] = sc[k];
    if (lk && typeof lk === "object") app.likeness = lk;
    if (ov) for (k in ov) app[k] = ov[k];
    // the corner colour wins for the kit
    app.shorts = side === "A" ? "#2563c9" : "#c9312f";
    return { name: p.name, short: lastName(p.name), slug: slug, nick: p.nick || null, corner: side === "A" ? "blue" : "red", appearance: app,
      stance: p.stance || (SCOUT[slug] && SCOUT[slug].style && SCOUT[slug].style.stance) || "Orthodox", height_in: p.height_in || null, reach_in: p.reach_in || null,
      division: p.division || null, pron: pron(side), pronouns: pron(side).he, record: p.record || null, kd_absorbed: p.kd_absorbed != null ? p.kd_absorbed : null, scouting: SCOUT[slug] ? { archetype: SCOUT[slug].style && SCOUT[slug].style.archetype, tags: SCOUT[slug].style && SCOUT[slug].style.tags, moves: SCOUT[slug].moves } : null };
  }
  function buildScript(fight, seed) {
    var fighters = { A: fighterInfo("A"), B: fighterInfo("B") }, sc = null, FD = window.FightDirector;
    if (FD && typeof FD.build === "function") {
      try {
        sc = FD.build(fight, seed, { fighters: fighters, matchup: cur.m, rounds: S.rounds, title: S.title,
          scouting: { A: SCOUT[S.a] || null, B: SCOUT[S.b] || null }, profiles: { A: prof("A"), B: prof("B") } });
      } catch (e) { sc = null; if (window.console) console.warn("FightDirector.build failed; using the page's own director", e); }
      if (sc && (!sc.rounds || sc.rounds.length !== fight.rounds.length)) sc = null;
    }
    if (!sc) sc = localDirector(fight, seed, fighters);
    // keep whatever the director added to script.fighters; fill in anything it left out
    if (!sc.fighters) sc.fighters = fighters;
    else ["A", "B"].forEach(function (s) { var t = sc.fighters[s] || (sc.fighters[s] = {}); for (var k in fighters[s]) if (t[k] == null) t[k] = fighters[s][k]; });
    sc.meta = { division: S.div, lbs: divLbs(S.div), rounds: S.rounds, title: S.title, scheduled: S.rounds };
    if (sc.winner == null) sc.winner = fight.winner;
    if (sc.method == null) sc.method = fight.method;
    if (!sc.cards) sc.cards = fight.cards;
    return sc;
  }

  /* ================================================================ live HUD (engine-driven) */
  var H = null, hudPending = false;
  function zc() { return { land: [0, 0, 0, 0], att: 0, lnd: 0, kd: 0, hurt: 0, td: 0, tda: 0, ctrl: 0, sub: 0 }; }
  function resetHud(fight, sc) {
    H = { f: fight, sc: sc, r: 0, idx: 0, lastT: 0, owner: null, clinchOwner: null, base: { A: zc(), B: zc() }, cur: { A: zc(), B: zc() },
      meters: { dA: 0, dB: 0, gA: 0, gB: 0, sA: 1, sB: 1 }, cards: [[], [], []], roundsDone: -1 };
    $("pbp").textContent = ""; $("banner").hidden = true; $("toast").hidden = true; $("roundCard").hidden = true; $("replayOv").hidden = true;
    var pips = $("pips"); pips.textContent = ""; for (var i = 0; i < S.rounds; i++) pips.appendChild(el("span", "pip"));
    renderCards(); renderStats(); setRound(0); setClock("5:00");
    var form = $("form"); form.textContent = "";
    ["A", "B"].forEach(function (s) {
      var fm = fight.form && fight.form[s]; if (!fm) return;
      var c = el("span", "fchip " + s); c.appendChild(el("b", null, shortOf(s)));
      c.appendChild(document.createTextNode(" output " + signedPct(fm.out) + " · accuracy " + signedPct(fm.acc) + " · power " + signedPct(fm.pow) + " · chin " + signedPct(fm.chin) + " · cardio " + signedPct(fm.cardio)));
      c.title = "Tonight's draw of " + nameOf(s) + "'s form against the settings. Chin and cardio above zero mean sturdier and fresher.";
      form.appendChild(c);
    });
  }
  function hudApply(e) {
    var w = e.w, c = H.cur[w];
    if (e.t > H.lastT && H.owner) H.cur[H.owner].ctrl += e.t - H.lastT;
    H.lastT = Math.max(H.lastT, e.t);
    var k = e.k;
    if (k === "miss" || k === "hit" || k === "hurt" || k === "kd" || k === "fin") {
      c.att++;
      if (k !== "miss") { c.lnd++; c.land[e.loc === "ground" ? 3 : (e.tg || 0)]++; }
      if (k === "kd") c.kd++; if (k === "hurt") c.hurt++;
    } else if (k === "td") { c.td++; c.tda++; }
    else if (k === "tdx") c.tda++;
    else if (k === "sub" || k === "subx") c.sub++;
    var ns = e.to != null ? e.to : e.s;
    if (k === "clinch") H.clinchOwner = w;
    else if (k === "up" && ns === 1) H.clinchOwner = other(w);
    H.owner = ns === 2 ? "A" : (ns === 3 ? "B" : (ns === 1 ? H.clinchOwner : null));
    if (e.dA != null) { var M = H.meters; M.dA = e.dA; M.dB = e.dB; M.gA = e.gA; M.gB = e.gB; M.sA = e.sA; M.sB = e.sB; }
  }
  function hudSync(r, t) {
    if (!H || !H.f.rounds[r]) return;
    if (r !== H.r) {
      // a new round: fold every finished round's exact engine totals into the base
      H.base = { A: zc(), B: zc() };
      for (var rr = 0; rr < r; rr++) addRoundTotals(H.base, H.f.rounds[rr].st);
      H.r = r; H.idx = 0; H.lastT = 0; H.owner = null; H.clinchOwner = null; H.cur = { A: zc(), B: zc() };
    }
    var ev = H.f.rounds[r].ev;
    while (H.idx < ev.length && ev[H.idx].t <= t + 1e-9) hudApply(ev[H.idx++]);
    if (t > H.lastT) { if (H.owner) H.cur[H.owner].ctrl += t - H.lastT; H.lastT = t; }
    scheduleHud();
  }
  function addRoundTotals(base, st) {
    // exact engine totals for a finished round: standing head / body / legs, plus everything landed on the ground
    if (!st) return;
    ["A", "B"].forEach(function (s) {
      var o = st[s], b = base[s]; if (!o) return;
      b.land[0] += o.sh_lnd || 0; b.land[1] += o.sb_lnd || 0; b.land[2] += o.sl_lnd || 0; b.land[3] += o.g_lnd || 0;
      b.att += o.sig_att; b.lnd += o.sig_lnd; b.kd += o.kd; b.hurt += o.hurt; b.td += o.td_lnd; b.tda += o.td_att; b.ctrl += o.ctrl; b.sub += o.sub_att;
    });
  }
  function totals(s) {
    var b = H.base[s], c = H.cur[s];
    return { land: [b.land[0] + c.land[0], b.land[1] + c.land[1], b.land[2] + c.land[2], b.land[3] + c.land[3]], att: b.att + c.att, lnd: b.lnd + c.lnd,
      kd: b.kd + c.kd, hurt: b.hurt + c.hurt, td: b.td + c.td, tda: b.tda + c.tda, ctrl: b.ctrl + c.ctrl, sub: b.sub + c.sub };
  }
  function scheduleHud() { if (!hudPending) { hudPending = true; requestAnimationFrame(function () { hudPending = false; renderStats(); }); } }
  function renderStats() {
    if (!H) return;
    ["A", "B"].forEach(function (w) {
      var T = totals(w), Lsum = T.land[0] + T.land[1] + T.land[2] + T.land[3];
      $("land" + w).firstChild.nodeValue = T.lnd;
      $("bug" + w).textContent = T.lnd;
      var spans = $("tgt" + w).children;
      for (var i = 0; i < 4; i++) spans[i].style.width = (Lsum ? 100 * Math.max(0, T.land[i]) / Lsum : 0) + "%";
      var row = $("row" + w); row.textContent = "";
      [["KD", T.kd], ["Rocked", T.hurt], ["TD", T.td + "/" + T.tda], ["Control", mmss(T.ctrl)], ["Acc", T.att ? pct(T.lnd / T.att, 0) : "–"]].forEach(function (p) {
        var s = el("span"); s.appendChild(el("b", null, String(p[1]))); s.appendChild(document.createTextNode(" " + p[0])); row.appendChild(s);
      });
      var dots = $("kdDots" + w); if (dots.children.length !== T.kd) { dots.textContent = ""; for (var k = 0; k < T.kd; k++) dots.appendChild(el("i")); }
    });
    var M = H.meters;
    $("mHeadA").style.width = Math.min(100, M.dA / 1.5) + "%"; $("mHeadB").style.width = Math.min(100, M.dB / 1.5) + "%";
    $("mLegA").style.width = Math.min(100, M.gA / 0.6) + "%"; $("mLegB").style.width = Math.min(100, M.gB / 0.6) + "%";
    $("mGasA").style.width = clamp(M.sA * 100, 0, 100) + "%"; $("mGasB").style.width = clamp(M.sB * 100, 0, 100) + "%";
  }
  function setClock(txt) { var node = $("bugClock").lastChild; if (node.nodeValue !== txt) node.nodeValue = txt; }
  function setRound(r) {
    $("bugRound").textContent = "R" + (r + 1);
    var pips = $("pips").children;
    for (var i = 0; i < pips.length; i++) pips[i].className = "pip" + (i < r ? " done" : (i === r ? " on" : ""));
  }
  function renderCards() {
    var box = $("cards"); box.textContent = "";
    for (var j = 0; j < 3; j++) {
      var t = el("table", "card"); t.appendChild(el("caption", null, "Judge " + (j + 1)));
      var th = el("thead"), hr = el("tr"); hr.appendChild(el("th"));
      ["A", "B"].forEach(function (s) { var c = el("th"); var d = el("span", "disc " + s, initials(nameOf(s))); d.title = nameOf(s); c.appendChild(d); c.scope = "col"; hr.appendChild(c); });
      th.appendChild(hr); t.appendChild(th);
      var tb = el("tbody"), sa = 0, sb = 0, rows = H ? H.cards[j] : [];
      rows.forEach(function (sc, i) {
        var tr = el("tr"), rh = el("th", null, "R" + (i + 1)); rh.scope = "row"; tr.appendChild(rh);
        tr.appendChild(el("td", sc[0] > sc[1] ? "won" : null, String(sc[0]))); tr.appendChild(el("td", sc[1] > sc[0] ? "won" : null, String(sc[1])));
        tb.appendChild(tr); sa += sc[0]; sb += sc[1];
      });
      if (!rows.length) { var tr0 = el("tr"), td0 = el("td", null, "–"); td0.colSpan = 3; tr0.appendChild(td0); tb.appendChild(tr0); }
      t.appendChild(tb);
      if (rows.length) { var tf = el("tfoot"), fr = el("tr"); fr.appendChild(el("th", null, "Total")); fr.appendChild(el("td", null, String(sa))); fr.appendChild(el("td", null, String(sb))); tf.appendChild(fr); t.appendChild(tf); }
      box.appendChild(t);
    }
  }
  var liveTimer = null;
  function addPbp(r, t, txt, cls) {
    var ol = $("pbp"), li = el("li", cls || null);
    li.appendChild(el("span", "ts", t == null ? "R" + (r + 1) : "R" + (r + 1) + " " + clockOf(t)));
    li.appendChild(el("span", null, txt));
    ol.insertBefore(li, ol.firstChild);
    while (ol.children.length > 50) ol.removeChild(ol.lastChild);
    // screen readers hear only the big moments, so fast playback doesn't flood them
    if (cls === "big" || cls === "rnd") { clearTimeout(liveTimer); liveTimer = setTimeout(function () { $("pbpLive").textContent = txt; }, 200); }
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
  var METHOD = { KO: "KO", TKO: "TKO", GNP: "TKO, ground strikes", LEG: "TKO, leg kicks", CORNER: "TKO, corner stoppage", DOC: "TKO, doctor stoppage", SUB: "Submission", UD: "Unanimous decision", SD: "Split decision", MD: "Majority decision", DRAW: "Draw" };
  function cardsFor(cards, w) { return cards.map(function (c) { return w === "B" ? c[1] + "–" + c[0] : c[0] + "–" + c[1]; }).join(", "); }

  var autoNext = null;
  var hooks = {
    onBeat: function (b) {
      if (b.k === "td" && !b.synthetic) toast("Takedown · " + shortOf(b.who), b.who, 1300);
    },
    onImpact: function (b) {
      if (b.kd) toast("Knockdown · " + shortOf(b.who), b.who, 1800);
      else if (b.hurt) toast("Rocked · " + shortOf(b.who), b.who, 1300);
      else if (b.fin) toast("It's over", b.who, 2200);
    },
    onText: function (b, r, t) { addPbp(r, t, b.txt, b.kd || b.fin || b.k === "sub" ? "big" : null); },
    onClock: function (r, t) {
      hudSync(r, t);
      setClock(clockOf(t));
    },
    onPhase: function (p, r) {
      if (p === "intro") {
        setRound(r); setClock("5:00"); if (H) hudSync(r, 0);
        roundCard(r === S.rounds - 1 && r > 0 ? "Final round" : "Round " + (r + 1), r === 0 ? S.rounds + " rounds · " + (divLbs(S.div) || "") + " lb" + (S.title ? " · title" : "") : "", 1700);
      }
    },
    onRoundEnd: function (r, rd) {
      if (H) { hudSync(r, 300); H.base = { A: zc(), B: zc() }; for (var rr = 0; rr <= r; rr++) addRoundTotals(H.base, H.f.rounds[rr].st); H.cur = { A: zc(), B: zc() }; H.idx = 1e9; H.owner = null; H.lastT = 300; scheduleHud(); }
      var st = rd.st || {}, la = st.A ? st.A.sig_lnd : 0, lb = st.B ? st.B.sig_lnd : 0;
      if (rd.judges && H) { for (var j = 0; j < 3; j++) H.cards[j].push(rd.judges[j]); renderCards(); }
      var cards = rd.judges ? rd.judges.map(function (s) { return s[0] + "–" + s[1]; }).join(", ") : "";
      addPbp(r, null, "End of round " + (r + 1) + ". Landed: " + shortOf("A") + " " + la + ", " + shortOf("B") + " " + lb + "." + (cards ? " Judges (" + shortOf("A") + " first): " + cards + "." : ""), "rnd");
      roundCard("End of round " + (r + 1), shortOf("A") + " " + la + " – " + lb + " " + shortOf("B") + " landed" + (cards ? " · " + cards : ""), 2600);
      if (rd.stoppage) addPbp(r, null, "The corner stops it. " + nameOf(other(rd.stoppage)) + " can't continue.", "big");
      // the older show ends the fight only after round 5; tell it this was the last round
      if (show && !textMode && r === script.rounds.length - 1 && script.rounds.length < 5 && !rd.fin && !rd.stoppage && showKnows("rIdx >= 4")) show.rIdx = 4;
    },
    onFinish: function () {},
    onDecision: function (sc) {
      var w = sc.winner || script.winner;
      if (w === "D") addPbp(S.rounds - 1, null, "To the scorecards: " + cardsFor(sc.cards || script.cards, "A") + ". It's a draw.", "big");
      else addPbp(S.rounds - 1, null, "To the scorecards: " + cardsFor(sc.cards || script.cards, w) + " for " + nameOf(w) + ".", "big");
    },
    onReplay: function (on) { $("replayOv").hidden = !on; },
    onResult: function (res) {
      var sc = script, w = (res && res.winner) || sc.winner, m = sc.method || (res && res.method);
      var bn = $("banner"); bn.dataset.w = w;
      var dec = m === "UD" || m === "SD" || m === "MD";
      if (w === "D") { $("bHead").textContent = "Draw"; $("bSub").textContent = cardsFor(sc.cards, "A"); }
      else {
        $("bHead").textContent = nameOf(w) + " wins";
        var detail = m === "SUB" && sc.detail ? "Submission (" + sc.detail.toLowerCase().replace("d'arce", "D'Arce") + ")" : (METHOD[m] || m);
        $("bSub").textContent = detail + (dec ? " · " + cardsFor(sc.cards, w) : " · round " + sc.round + (m === "CORNER" || m === "DOC" ? "" : ", " + mmss(sc.t)));
      }
      bn.hidden = false;
      if (H) { var f = H.f; for (var rr = H.r; rr < f.rounds.length; rr++) hudSync(rr, f.rounds[rr].fin ? f.rounds[rr].fin.t : 300); renderStats(); }
      clearTimeout(autoNext);
      autoNext = setTimeout(function () { if (show && !show.paused && visible && !document.hidden) newFight(); }, 11000);
    }
  };

  /* ================================================================ the show */
  var show = null, script = null, visible = true, textMode = false, loopOn = false;
  function TextShow(h) { this.hooks = h; this.speed = 5; this.paused = false; this.replays = false; this.cam = { mode: "auto", label: "Play-by-play", user: {} }; }
  TextShow.prototype.load = function (sc) { this.sc = sc; this.r = 0; this.q = sc.rounds[0].beats.slice(); this.t = 0; this.done = false; this.wait = 0.8; this.hooks.onPhase("intro", 0); };
  TextShow.prototype.frame = function (dt) {
    if (!this.sc || this.paused || this.done) return;
    if (this.wait > 0) { this.wait -= dt; return; }
    var rd = this.sc.rounds[this.r]; this.t = Math.min(rd.endT, this.t + dt * this.speed);
    while (this.q.length && (this.q[0].t <= this.t || this.t >= rd.endT)) {
      var b = this.q.shift(); this.hooks.onBeat(b, this.r); if (b.txt) this.hooks.onText(b, this.r, b.t);
      if (b.kd || b.hurt || b.fin) this.hooks.onImpact(b);
    }
    this.hooks.onClock(this.r, this.t, "stand", null);
    if (this.t >= rd.endT && !this.q.length) {
      if (rd.fin) { this.done = true; this.hooks.onResult({ winner: rd.fin.by, method: this.sc.method, round: this.r + 1, t: rd.fin.t }); return; }
      this.hooks.onRoundEnd(this.r, rd);
      if (rd.stoppage) { this.done = true; this.hooks.onResult({ winner: rd.stoppage, method: this.sc.method, round: this.r + 1, t: 300 }); return; }
      if (this.r >= this.sc.rounds.length - 1) { this.done = true; this.hooks.onDecision(this.sc); this.hooks.onResult({ winner: this.sc.winner, method: this.sc.method, round: this.r + 1, t: 300 }); return; }
      this.r++; this.q = this.sc.rounds[this.r].beats.slice(); this.t = 0; this.wait = 1.2; this.hooks.onPhase("intro", this.r);
    }
  };
  TextShow.prototype.resize = function () {}; TextShow.prototype.skip = function () { return false; };

  var stage = $("stage"), canvas = $("gl");
  function initShow() {
    try {
      if (!window.THREE || !FS || !FS.Show) throw new Error("no three");
      var small = Math.min(window.innerWidth, window.innerHeight) < 600;
      show = new FS.Show(canvas, hooks, { maxDpr: 1.75, shadow: small ? 1024 : 2048 });
      $("camLabel").hidden = false;
    } catch (e) {
      show = new TextShow(hooks); textMode = true; $("noGl").hidden = false; $("camLabel").hidden = true;
    }
    $("poster").hidden = true;
    sizeStage();
    if (window.ResizeObserver) new ResizeObserver(sizeStage).observe(stage); else window.addEventListener("resize", sizeStage);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(stage);
    if (!textMode && document.fonts && document.fonts.load) {
      document.fonts.load('900 64px "Big Shoulders Display"').then(function () { try { show.arena.repaintMat(); } catch (e) { /* older arena */ } }, function () {});
    }
    var spd = $("speedSeg").querySelector('[aria-pressed="true"]'); if (spd) show.speed = +spd.dataset.speed;
    show.replays = $("replayTog").checked;
    window.VGSim = { show: show, newFight: newFight };
  }
  function newFight() {
    clearTimeout(autoNext);
    if (!show || !cur.m) return;
    var sd = newSeed(), f;
    try { f = E.simulate(cur.m, E.makeRng(sd), true); } catch (e) { addPbp(0, null, "The engine couldn't play this fight: " + e.message, "big"); return; }
    script = buildScript(f, sd);
    resetHud(f, script);
    try { show.load(script); } catch (e) {
      // a show that can't take this script: fall back to the play-by-play
      show = new TextShow(hooks); textMode = true; $("noGl").hidden = false; $("camLabel").hidden = true; show.load(script);
    }
    if (window.VGSim) window.VGSim.show = show;
  }
  function sizeStage() {
    if (textMode || !show) return;
    var r = stage.getBoundingClientRect();
    try { show.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height))); } catch (e) { /* ignore */ }
  }
  var last = 0, lastLabel = "";
  function loop(now) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
    if (show && visible && !document.hidden) {
      try { show.frame(dt); } catch (e) { if (!textMode) { show = new TextShow(hooks); textMode = true; $("noGl").hidden = false; $("camLabel").hidden = true; if (script) show.load(script); } }
      if (!textMode && show.cam && show.cam.label !== lastLabel) { lastLabel = show.cam.label; $("camLabel").textContent = lastLabel; }
    }
    requestAnimationFrame(loop);
  }

  /* ================================================================ wiring */
  function matchupChanged(fightNow) {
    buildMatchup();
    renderMatchbar(); renderTape(); renderChips(); renderKnobPanel(); renderWhy(); renderStack(); renderResearch();
    renderCards();
    writeHash();
    queueTally(true);
    if (fightNow && show) newFight();
  }
  function wire() {
    pickers.A = new Picker("A"); pickers.B = new Picker("B");
    $("btnSwap").addEventListener("click", swapCorners);
    $("selDiv").addEventListener("change", function () { S.div = this.value; matchupChanged(true); });
    Array.prototype.forEach.call($("segRounds").children, function (b) {
      b.addEventListener("click", function () { var r = +b.dataset.r; if (r === S.rounds) return; S.rounds = r; matchupChanged(true); });
    });
    $("chkTitle").addEventListener("change", function () { S.title = this.checked; if (S.title) S.rounds = 5; matchupChanged(true); });
    $("btnLink").addEventListener("click", function () {
      writeHash();
      var url = location.href, btn = this;
      function done(ok) { btn.textContent = ok ? "Link copied" : "Copy failed: " + url; setTimeout(function () { btn.textContent = "Copy link to this matchup"; }, ok ? 1800 : 6000); }
      try { navigator.clipboard.writeText(url).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    });
    window.addEventListener("hashchange", function () { if (hashWriting) return; if (stateFromHash()) matchupChanged(true); });
    $("btnRun").addEventListener("click", function () { startTally(); });
    $("btnReset").addEventListener("click", function () {
      var pd = pairData(S.a, S.b), defId = pd && pd.default_scenario, sc = defId && scenarioList().filter(function (x) { return x.id === defId; })[0];
      if (sc) applyScenarioState(sc); else { S.adj = { A: {}, B: {} }; S.judgePower = JP0; S.scen = null; }
      renderChips(); renderKnobPanel(); knobsChanged(true);
    });
    ["A", "B"].forEach(function (s) {
      $("ktab" + s).addEventListener("click", function () { S.tab = s; renderKnobPanel(); });
      $("ktab" + s).addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); S.tab = other(S.tab); renderKnobPanel(); $("ktab" + S.tab).focus(); }
      });
      $("odd" + s).addEventListener("input", function () { S.odds[s] = this.value.trim(); renderStack(); });
    });
    $("k-trust").addEventListener("input", function () { S.trust = +this.value; renderStack(); });
    // live show controls
    $("btnNew").addEventListener("click", newFight);
    $("btnAgain").addEventListener("click", newFight);
    $("btnPlay").addEventListener("click", function () { if (!show) return; show.paused = !show.paused; this.textContent = show.paused ? "Play" : "Pause"; });
    $("btnSkip").addEventListener("click", function () { if (show && show.skip) show.skip(); });
    Array.prototype.forEach.call($("speedSeg").children, function (b) {
      b.addEventListener("click", function () {
        if (show) show.speed = +b.dataset.speed;
        Array.prototype.forEach.call($("speedSeg").children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      });
    });
    Array.prototype.forEach.call($("camSeg").children, function (b) {
      b.addEventListener("click", function () {
        if (textMode || !show || !show.cam) return;
        show.cam.mode = b.dataset.cam;
        canvas.classList.toggle("free", show.cam.mode === "free");
        Array.prototype.forEach.call($("camSeg").children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      });
    });
    $("replayTog").addEventListener("change", function () { if (show) show.replays = this.checked; });
    // free camera: drag to orbit, wheel or pinch to zoom
    var ptrs = {}, pinch0 = 0;
    canvas.addEventListener("pointerdown", function (e) { if (textMode || !show || !show.cam || show.cam.mode !== "free") return; ptrs[e.pointerId] = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
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
      if (textMode || !show || !show.cam || show.cam.mode !== "free") return;
      e.preventDefault(); var u = show.cam.user; u.dist = Math.max(5, Math.min(18, u.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });
    var chartW = 0, redrawT = null;
    if (window.ResizeObserver) new ResizeObserver(function (es) {
      var w = Math.round(es[0].contentRect.width);
      if (Math.abs(w - chartW) > 8) { chartW = w; clearTimeout(redrawT); redrawT = setTimeout(function () { if (lastAgg) { drawBins(lastAgg); drawRounds(lastAgg); } renderStack(); }, 120); }
    }).observe($("binsChart"));
  }

  /* ================================================================ boot */
  if (!stateFromHash()) applyPairDefaults();
  wire();
  buildMatchup();
  renderMatchbar(); renderTape(); renderChips(); renderKnobPanel(); renderWhy(); renderStack(); renderBacktest(); renderResearch();
  resetHud({ rounds: [], form: null }, null);
  writeHash();
  $("runStatus").textContent = "Starting the tally";
  window.FightLab = { state: S, matchup: function () { return cur.m; }, tally: function () { return lastAgg; }, newFight: function () { newFight(); }, script: function () { return script; } };
  // heavy work after the first frame: the tally, then the 3D cage
  requestAnimationFrame(function () {
    setTimeout(function () {
      startTally();
      setTimeout(function () {
        initShow(); newFight();
        if (reduce && show) { show.paused = true; $("btnPlay").textContent = "Play"; try { show.frame(0.016); } catch (e) { /* ignore */ } }
        if (!loopOn) { loopOn = true; requestAnimationFrame(loop); }
      }, 30);
    }, 0);
  });
})();
