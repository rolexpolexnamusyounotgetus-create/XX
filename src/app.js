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
  // headline spots: whole percents; a draw (or any share) under 1% reads "<1%"
  function pctW(x) { return x == null || !isFinite(x) ? "–" : (x > 0 && x < 0.005 ? "<1%" : Math.round(100 * x) + "%"); }
  function pctD(x) { return x == null || !isFinite(x) ? "–" : (x > 0 && x < 0.01 ? "<1%" : Math.round(100 * x) + "%"); }
  function pts(dp) { var v = Math.round(100 * dp); return (v > 0 ? "+" : (v < 0 ? "−" : "")) + Math.abs(v) + " pt" + (Math.abs(v) === 1 ? "" : "s"); }
  function hashStr(s) { var h = 2166136261; s = String(s || ""); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
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
  // short names as coverage uses them (same rules as the director: suffixes, particles, family-name-first names)
  var PARTICLES = { da: 1, de: 1, "do": 1, dos: 1, das: 1, del: 1, della: 1, di: 1, du: 1, van: 1, von: 1, der: 1, den: 1, la: 1, le: 1, st: 1, "st.": 1, saint: 1, el: 1, al: 1, bin: 1, ibn: 1 };
  var SURNAME_FIRST = { Zhang: 1, Wang: 1, Li: 1, Song: 1, Yan: 1, Liu: 1, Chen: 1, Yang: 1, Huang: 1, Zhao: 1, Wu: 1, Zhou: 1, Xu: 1, Sun: 1, Zhu: 1, Hu: 1, Guo: 1, Lin: 1, Luo: 1, Gao: 1, Liang: 1, Zheng: 1, Xie: 1, Tang: 1, Feng: 1, Deng: 1, Cao: 1, Peng: 1, Zeng: 1, Xiao: 1, Tian: 1, Dong: 1, Pan: 1, Yuan: 1, Cai: 1, Jiang: 1, Wei: 1, Su: 1, Ding: 1, Ren: 1, Shen: 1, Yao: 1, Qin: 1, Aoriqileng: 1 };
  var SHORT_EXCEPT = { "Ian Machado Garry": "Machado Garry", "Mayra Bueno Silva": "Bueno Silva", "Waldo Cortes Acosta": "Cortes Acosta", "Antonio Carlos Junior": "Carlos Junior", "Elizeu Zaleski dos Santos": "Zaleski" };
  function lastName(name) {
    name = String(name || "").replace(/\s+/g, " ").trim(); if (!name) return "Fighter";
    if (SHORT_EXCEPT[name]) return SHORT_EXCEPT[name];
    var t = name.split(" ");
    while (t.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(t[t.length - 1])) t.pop();
    if (t.length === 1) return t[0];
    if (t.length === 2 && SURNAME_FIRST[t[0]]) return t[0];
    var i = t.length - 1;
    while (i > 1 && PARTICLES[t[i - 1].toLowerCase()]) i--;
    return t.slice(i).join(" ");
  }
  function initials(name) { var t = String(name || "").trim().split(/\s+/); return ((t[0] || "?")[0] + (t.length > 1 ? lastName(name)[0] : "")).toUpperCase(); }
  // letters NFD does not decompose (Polish l with stroke, Nordic o, ...) are folded first
  var FOLD = { "ł": "l", "ø": "o", "đ": "d", "ð": "d", "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th", "ı": "i", "ħ": "h" };
  function norm(s) { return String(s || "").toLowerCase().replace(/[łøđðßæœþıħ]/g, function (c) { return FOLD[c]; }).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  // the same with apostrophes, hyphens and spaces gone: "omalley" finds O'Malley, "duplessis" Du Plessis
  function squash(s) { return norm(s).replace(/ /g, ""); }
  function slugify(s) { return norm(s).replace(/ /g, "-"); }
  function other(w) { return w === "A" ? "B" : "A"; }
  function readJSON(id, fallback) {
    var n = $(id); if (!n) return fallback;
    try { var d = JSON.parse(n.textContent); return d == null ? fallback : d; } catch (e) { return fallback; }
  }
  function linkList(box, sources, max) {
    var seen = {}, used = {}, n = 0;
    (sources || []).forEach(function (s) {
      var url = typeof s === "string" ? s : s && s.url, label = typeof s === "string" ? null : s && s.label;
      if (!url && !label) return;
      var key = url || label; if (seen[key] || (max && n >= max)) return; seen[key] = 1; n++;
      if (url && /^https?:\/\//.test(url)) {
        // link text names the outlet and the date or headline, so a list of links reads unambiguously
        var t = label || srcLabel(url), base = t, k = 2;
        while (used[t]) t = base + " (" + (k++) + ")";
        used[t] = 1;
        var a = el("a", null, t); a.href = url; a.target = "_blank"; a.rel = "noopener"; box.appendChild(a);
      } else box.appendChild(el("span", null, label || url));
    });
    return n;
  }
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; } }
  var OUTLETS = { "espn.com": "ESPN", "cbssports.com": "CBS Sports", "ufcalendar.com": "UFCalendar", "sherdog.com": "Sherdog", "bloodyelbow.com": "Bloody Elbow",
    "heavy.com": "Heavy", "skysports.com": "Sky Sports", "mmamania.com": "MMA Mania", "mmafighting.com": "MMA Fighting", "mmajunkie.usatoday.com": "MMA Junkie",
    "ufc.com": "UFC.com", "ufcstats.com": "UFC Stats", "en.wikipedia.org": "Wikipedia", "tapology.com": "Tapology", "sportskeeda.com": "Sportskeeda",
    "f4wonline.com": "F4W", "middleeasy.com": "MiddleEasy", "agentmma.com": "AgentMMA", "thescore.com": "theScore", "cagesidepress.com": "Cageside Press",
    "talksport.com": "talkSPORT", "essentiallysports.com": "EssentiallySports", "bjpenn.com": "BJPenn.com", "mmanews.com": "MMA News", "yahoo.com": "Yahoo Sports",
    "sports.yahoo.com": "Yahoo Sports", "si.com": "Sports Illustrated", "bleacherreport.com": "Bleacher Report", "foxsports.com": "Fox Sports", "fightmatrix.com": "FightMatrix",
    "mmasucka.com": "MMA Sucka", "news4jax.com": "News4JAX", "dazn.com": "DAZN", "theguardian.com": "The Guardian", "bbc.com": "BBC", "bbc.co.uk": "BBC",
    "mmaweekly.com": "MMA Weekly", "lowkickmma.com": "LowKick MMA", "fightbookmma.com": "FightBook", "nypost.com": "New York Post", "fightful.com": "Fightful",
    "mmaoddsbreaker.com": "MMA Odds Breaker", "ufcespanol.com": "UFC Español", "instagram.com": "Instagram", "x.com": "X", "twitter.com": "X", "youtube.com": "YouTube" };
  function srcLabel(url) {
    var u; try { u = new URL(url); } catch (e) { return url; }
    var h = u.hostname.replace(/^www\./, ""), out = OUTLETS[h];
    if (!out) { var hp = h.split("."); out = hp.length > 1 ? hp[hp.length - 2] : h; out = out.charAt(0).toUpperCase() + out.slice(1); }
    var path = u.pathname, m = /\/(20\d\d)[\/-](\d{1,2})(?:[\/-]\d{1,2})?(?:\/|-|$)/.exec(path);
    if (m && +m[2] >= 1 && +m[2] <= 12) return out + ", " + MONTHS[+m[2] - 1] + " " + m[1];
    if (h === "ufcstats.com") return out + (/fighter-details/.test(path) ? ": fighter page" : (/event-details/.test(path) ? ": event page" : ": fight page"));
    var segs = path.split("/").filter(function (x) { return x && !/^\d+$/.test(x) && !/^(news|story|mma|_|id|sports|ufc|article|latest-news)$/i.test(x); });
    var slug = segs.length ? decodeURIComponent(segs[segs.length - 1]).replace(/\.[a-z]+$/i, "").replace(/-\d{3,}$/, "") : "";
    var words = slug.split(/[-_]+/).filter(function (w) { return w && !/^\d{5,}$/.test(w); }).slice(0, 5);
    if (!words.length) return out;
    var hl = words.join(" "); hl = hl.charAt(0).toUpperCase() + hl.slice(1);
    return out + ": " + hl + (slug.split(/[-_]+/).length > 5 ? "…" : "");
  }

  /* ================================================================ boot
     The roster and the scouting files ship gzip + base64 (build.py). They are inflated into their JSON blocks (the 3D
     avatars read them from there too) before the page starts. */
  function readGzText(id) {
    var n = $(id), txt = n ? n.textContent.trim() : "";
    if (!txt || txt === "null" || txt.indexOf("/*__") === 0) return Promise.resolve(null);
    if (!window.DecompressionStream || !window.Response || !window.atob) return Promise.reject(new Error("DecompressionStream is not available"));
    try {
      var bin = atob(txt), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      n.textContent = "";
      return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    } catch (e) { return Promise.reject(e); }
  }
  Promise.all([readGzText("fighters-gz"), readGzText("scouting-gz")]).then(function (t) {
    if (t[0] != null) $("fighters-db").textContent = t[0];
    if (t[1] != null) $("scouting-db").textContent = t[1];
    start();
  }, function (e) {
    fail("This browser can't unpack the fighter roster (" + (e && e.message || e) + "). A current Chrome, Edge, Firefox or Safari can.");
  });

  // everything below runs once the roster is in (kept at the outer indentation)
  function start() {

  /* ================================================================ data */
  var DBJ = readJSON("fighters-db", null);
  var CALIB = readJSON("calib-db", null);
  var SCEN = readJSON("scenarios-db", {}) || {};
  var OVR = readJSON("overrides-db", {}) || {};
  var SCOUTDB = readJSON("scouting-db", {}) || {};
  var SCOUT = SCOUTDB.scouting || {}, LIKE = SCOUTDB.likeness || {};
  // verified models (research/model_moe.md, model_methodround.md, model_mlrates.md, model_ml.md)
  var MOEJ = readJSON("moe-db", null);
  var MKTJ = readJSON("mkt-db", null), BENCH = readJSON("bench-db", null), VERS = readJSON("versions-db", null), FWD = readJSON("forward-db", null);
  var DB = null;
  try { DB = E.loadDB(DBJ); } catch (e) { fail("The fighter roster didn't load (" + e.message + "). Rebuild the page with python3 build.py."); return; }
  var MOE = null, MLP = null, MR = null, MLR = { ok: false, native: false, pending: true };
  try { if (window.MoE && MOEJ && MOEJ.model) MOE = window.MoE.load(MOEJ); } catch (e) { MOE = null; }
  // the stat-line, ML page and method-and-round models ship gzip-compressed (build.py); inflate them off the first paint
  function readGz(id) {
    var n = $(id), txt = n ? n.textContent.trim() : "";
    if (!txt || txt === "null" || !window.DecompressionStream || !window.Response || !window.atob) return Promise.resolve(null);
    try {
      var bin = atob(txt), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      n.textContent = "";
      return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
        .then(function (t) { return JSON.parse(t); }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function installModels(arr) {
    var mlr = arr[0], mlp = arr[1], mr = arr[2];
    try { if (window.MLPage && mlp) MLP = window.MLPage.load(mlp); } catch (e) { MLP = null; }
    try { if (window.MethodRound && mr) MR = window.MethodRound.create(mr); } catch (e) { MR = null; }
    if (mlr && window.MLRates) {
      // engine v4 applies the learned rates itself (opts.ml === false turns them off); v3 takes them through the adapter
      if (typeof E.loadMLRates === "function") { try { E.loadMLRates(mlr); MLR.native = true; MLR.ok = true; MLJSON = mlr; postModel(worker); } catch (e) { MLR.native = false; } }
      if (!MLR.native) { try { window.MLRates.load(mlr); MLR.ok = true; } catch (e) { MLR.ok = false; } }
    }
    MLR.pending = false; mlCache.key = null; mrCache = {};
  }
  var modelsReady = Promise.all([readGz("mlrates-gz"), readGz("mlpage-gz"), readGz("mr-gz")])
    .then(installModels, function () { MLR.pending = false; });
  var MKTR = (MKTJ && MKTJ.ratings) || {};
  var ENGV = "v" + String(E.VERSION || "3");          // the one engine label the page shows (FightEngine.VERSION)
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
      n: norm(f.name), ln: norm(lastName(f.name)), nk: norm(f.nick), sq: squash(f.name), lsq: squash(lastName(f.name)), nsq: squash(f.nick) };
  });

  /* ================================================================ state */
  var DEFAULT = { a: "alexander-volkanovski", b: "justin-gaethje" };
  if (!DB.fighters[DEFAULT.a] || !DB.fighters[DEFAULT.b]) {
    var top = ROSTER.slice().sort(function (x, y) { return y.elo - x.elo; });
    DEFAULT = { a: top[0].slug, b: top[1].slug };
  }
  var S = { a: DEFAULT.a, b: DEFAULT.b, div: "Lightweight", rounds: 5, title: true,
    adj: { A: {}, B: {} }, judgePower: JP0, scen: null, odds: { A: "", B: "" }, oddsSrc: null, line: true, ml: true, tab: "A" };
  var cur = { m: null, x: null, err: null };

  function prof(side) { return DB.fighters[side === "A" ? S.a : S.b]; }
  function slugOf(side) { return side === "A" ? S.a : S.b; }
  function nameOf(side) { var p = prof(side); return p ? p.name : side; }
  function shortOf(side) { return lastName(nameOf(side)); }
  // pronouns by the divisions a fighter competes in (as their own coverage uses); they/them when that says nothing
  var MEN_DIV = { Flyweight: 1, Bantamweight: 1, Featherweight: 1, Lightweight: 1, Welterweight: 1, Middleweight: 1, "Light Heavyweight": 1, Heavyweight: 1 };
  function pron(side) {
    var p = prof(side), home = p && p.division || "", d = home || S.div || "";
    if (/^Women/.test(d)) return { he: "she", his: "her", him: "her" };
    if (MEN_DIV[d]) return { he: "he", his: "his", him: "him" };
    return { he: "they", his: "their", him: "them" };
  }

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
    S.adj = { A: {}, B: {} }; S.judgePower = JP0; S.scen = null; S.oddsSrc = null; S.line = true;
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
  // ML stat-line prediction for the current pair (independent of the knobs, so cached per pair and bout settings)
  var mlCache = { key: null, pred: null, err: null };
  function mlPredict(pa, pb) {
    if (!MLR.ok || !window.MLRates) return null;
    var key = [slugOf("A"), slugOf("B"), S.div, S.rounds, S.title, todayISO()].join("|");
    if (mlCache.key === key) return mlCache.pred;
    mlCache.key = key; mlCache.pred = null; mlCache.err = null;
    try {
      var M = (E.mlModel && E.mlModel()) || window.MLRates.model();
      var p = window.MLRates.predict(M, pa, pb, { division: S.div, rounds: S.rounds, title: S.title, date: todayISO(), priors: DB.priors });
      mlCache.pred = { A: p.A, B: p.B, base: p.base };
    } catch (e) { mlCache.err = e; }
    return mlCache.pred;
  }
  // one matchup through whichever path this build has: engine v4 applies the learned rates itself (opts.ml), v3 through
  // the MLRates adapter; with the toggle off both give the plain data-only tables
  function makeMatchup(pa, pb, o) {
    var pred = S.ml ? mlPredict(pa, pb) : null, m;
    if (MLR.native) {
      o.ml = S.ml ? (pred ? { pred: pred } : undefined) : false;
      m = E.matchup(pa, pb, o);
      if (!S.ml && m.mlApplied) m.mlStuck = true;
      return m;
    }
    m = E.matchup(pa, pb, o);
    if (pred) {
      try { window.MLRates.applyToMatchup(m, pred, { engine: E }); m.mlPred = pred; m.mlApplied = true; }
      catch (e) { m = E.matchup(pa, pb, o); m.mlApplied = false; m.mlError = e; }
    } else m.mlApplied = false;
    return m;
  }
  function buildMatchup() {
    var pa = prof("A"), pb = prof("B");
    cur.err = null;
    try {
      cur.m = makeMatchup(pa, pb, { division: S.div, rounds: S.rounds, title: S.title, date: todayISO(),
        adjA: cleanAdj(S.adj.A), adjB: cleanAdj(S.adj.B), judges: { power: S.judgePower } });
    } catch (e) { cur.err = e; cur.m = null; }
    try { cur.x = cur.m ? E.explain(cur.m) : null; } catch (e) { cur.x = null; }
    // knob-neutral data values the slider labels quote (leg-kick share, takedown attempts)
    try {
      cur.m0 = (Object.keys(cleanAdj(S.adj.A)).length || Object.keys(cleanAdj(S.adj.B)).length) ?
        makeMatchup(pa, pb, { division: S.div, rounds: S.rounds, title: S.title, date: todayISO(), judges: { power: S.judgePower } }) : cur.m;
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
        e.preventDefault(); if (!self.open) { self.render(input.value === nameOf(side) || input.value === shortOf(side) ? "" : input.value); self.show(true); }
        if (!self.items.length) return;
        self.setActive(clamp(self.active + (e.key === "ArrowDown" ? 1 : -1), 0, self.items.length - 1));
      } else if (e.key === "Enter") {
        if (self.open && self.items.length) { e.preventDefault(); self.choose(self.items[Math.max(0, self.active)].slug); }
      } else if (e.key === "Escape") {
        if (self.open) { e.preventDefault(); self.show(false); self.reset(); }
      } else if (e.key === "Home" && self.open && self.items.length && !input.value) { self.setActive(0); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { if (document.activeElement !== input) { self.show(false); self.reset(); } }, 120); });
    list.addEventListener("mousedown", function (e) { e.preventDefault(); });
    list.addEventListener("click", function (e) { var li = e.target.closest ? e.target.closest(".opt") : null; if (li) self.choose(li.dataset.slug); });
  }
  // phones show the last name in the narrow two-column strip (the list and the tale of the tape carry the full name)
  var narrowMQ = null; try { narrowMQ = window.matchMedia("(max-width: 640px)"); } catch (e) { narrowMQ = null; }
  Picker.prototype.reset = function () { this.input.value = narrowMQ && narrowMQ.matches ? shortOf(this.side) : nameOf(this.side); this.input.title = nameOf(this.side); };
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
    if (!qn || qn === norm(nameOf(side)) || qn === norm(shortOf(side))) {
      // no query: the strongest names in each division, the current fight's division first
      var byDiv = {};
      ROSTER.forEach(function (r) { (byDiv[r.div] = byDiv[r.div] || []).push(r); });
      var order = DIVS.slice().sort(function (a, b) { return (a === S.div ? -1 : 0) - (b === S.div ? -1 : 0) || divOrder(a) - divOrder(b); });
      order.forEach(function (d) {
        var arr = (byDiv[d] || []).slice().sort(function (x, y) { return y.elo - x.elo; }).slice(0, d === S.div ? 12 : 5);
        arr.forEach(function (r) { res.push(r); });
      });
    } else {
      var words = qn.split(" "), qs = squash(q);
      ROSTER.forEach(function (r) {
        var sc = 0;
        if (r.n.indexOf(qn) === 0 || r.ln.indexOf(qn) === 0) sc = 5;
        else if ((" " + r.n).indexOf(" " + qn) >= 0) sc = 4;
        else if (qs.length >= 3 && (r.sq.indexOf(qs) === 0 || r.lsq.indexOf(qs) === 0)) sc = 4;
        else if (r.nk && (r.nk.indexOf(qn) === 0 || (" " + r.nk).indexOf(" " + qn) >= 0)) sc = 3.5;
        else if (words.every(function (w) { return (" " + r.n + " " + r.nk).indexOf(" " + w) >= 0; })) sc = 3;
        else if (qs.length >= 4 && (r.sq.indexOf(qs) >= 0 || (r.nsq && r.nsq.indexOf(qs) >= 0))) sc = 2;
        else if (words.length > 1 && words.every(function (w) { return r.sq.indexOf(w) >= 0; })) sc = 1.5;
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
      nm.appendChild(el("span", "vh", ", " + r.div));
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
  function announce(t) { var n = $("mbNote"); if (n && !n.textContent) { n.textContent = t; setTimeout(function () { if (n.textContent === t) n.textContent = ""; }, 4000); } }

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
    // an honest flag when the pair is outside what the size data covers
    var hA = prof("A").division, hB = prof("B").division, la = divLbs(hA), lb = divLbs(hB), warn = "";
    if (/^Women/.test(hA || "") !== /^Women/.test(hB || "")) warn = "These fighters compete in men's and women's divisions. The simulator will run it, but nothing in the data speaks to this matchup.";
    else if (la && lb && Math.abs(la - lb) > 20) warn = "Their home divisions are " + Math.abs(la - lb) + " lb apart. The simulator's size term was fit on fighters moving up one weight class, so it understates a gap this large; read the numbers as a curiosity.";
    $("mbNote").textContent = warn;
    $("h1A").textContent = shortOf("A"); $("h1B").textContent = shortOf("B");
    $("kicker").textContent = S.div + " · " + S.rounds + " × 5 min" + (S.title ? " · title fight" : "") + " · " + (divLbs(S.div) || "?") + " lb";
    $("asOf").title = "Fight data through " + fmtDate(DB.meta && DB.meta.snapshot) + "; simulator " + ENGV;
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
  // a champion pill: the full title, and on phones a short "UFC 155-lb champion" (CSS swaps them)
  function titlePill(title) {
    var pl = el("span", "pill gold"), t = String(title), lo = t.toLowerCase(), best = null;
    DIVS.forEach(function (d) { var dn = d.toLowerCase().replace("women's ", ""); if (lo.indexOf(dn) >= 0 && (!best || dn.length > best.n.length)) best = { d: d, n: dn }; });
    pl.appendChild(el("span", "pl", t));
    var short = best ? "UFC " + (/women/.test(lo) || /^Women/.test(best.d) ? "women's " : "") + divLbs(best.d) + "-lb " + (/interim/.test(lo) ? "interim " : "") + "champion" : t;
    pl.appendChild(el("span", "ps", short)); pl.title = t;
    return pl;
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
      if (sc && sc.status && sc.status.title) tags.appendChild(titlePill(sc.status.title));
      if (sc && sc.status && sc.status.active === false) tags.appendChild(el("span", "pill warn", "Inactive"));
      if (p.manual) tags.appendChild(el("span", "pill", "Hand-entered"));
      box.appendChild(tags);
      box.appendChild(el("div", "th-note", LIKE[slugOf(side)] ? "3D figure follows likeness notes from public photos" : "Generic 3D figure: no likeness notes yet"));
      card.appendChild(ini); card.appendChild(box); heads.appendChild(card);
    });
    var tb = $("tapeBody"); tb.textContent = "";
    if (!cur.m) { var tr0 = el("tr"), td0 = el("td", null, "The simulator could not build this matchup" + (cur.err ? ": " + cur.err.message : ".")); td0.colSpan = 3; tr0.appendChild(td0); tb.appendChild(tr0); return; }
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
    function stanceSrc(side) { var lk = LIKE[slugOf(side)]; return lk && lk.stance ? "3D stance: likeness notes" : "3D stance: estimated"; }
    row("Stance", pa.stance || null, pb.stance || null, { subA: stanceSrc("A"), subB: stanceSrc("B") });
    row("Home division", divShort(pa.division), divShort(pb.division));
    row("UFC record", recStr(ra), recStr(rb), { subA: ra.w != null ? "W " + (ra.ko_w || 0) + " KO · " + (ra.sub_w || 0) + " sub · " + (ra.dec_w || 0) + " dec" : null, subB: rb.w != null ? "W " + (rb.ko_w || 0) + " KO · " + (rb.sub_w || 0) + " sub · " + (rb.dec_w || 0) + " dec" : null });
    row("UFC losses by method", ra.l != null ? (ra.ko_l || 0) + " KO · " + (ra.sub_l || 0) + " sub · " + (ra.dec_l || 0) + " dec" : null, rb.l != null ? (rb.ko_l || 0) + " KO · " + (rb.sub_l || 0) + " sub · " + (rb.dec_l || 0) + " dec" : null);
    row("Elo", pa.elo || null, pb.elo || null, { small: "rating from past UFC results", cmp: 1, na: pa.elo, nb: pb.elo });
    row("Last fight", pa.last_fight ? fmtDate(pa.last_fight) : null, pb.last_fight ? fmtDate(pb.last_fight) : null);
    sect("What the simulator uses");
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
    $("tapeFoot").textContent = "The rows under “What the simulator uses” are its starting numbers: UFC fights weighted toward the last two years, then pulled toward the " + S.div.toLowerCase() + " average (avg) in proportion to how little data there is. The bolder number in each row is the better one. Records cover UFC bouts only. “3D stance: estimated” means the figure's posture comes from the fighter's style and numbers, not from photos.";
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
      else d.appendChild(el("p", "noscout", "No scouting file for " + p.name + " yet. The simulator runs on the UFC numbers alone."));
      box.appendChild(d);
    });
  }
  // research files are cited by project path inside some scouting and scenario text; visitors can't open those, so the
  // page says "our research notes" instead (the paths stay in the files and in HANDOFF.md)
  var PATH_RE = /\b(?:research|data|docs|tools|src)\/[\w.\/-]+\.(?:md|json|js|py)\b(?:,? sections? [\d, and]+\d)?/g;
  function scrubPaths(node) {
    if (!node || !document.createTreeWalker) return node;
    var w = document.createTreeWalker(node, 4), t;
    while ((t = w.nextNode())) if (PATH_RE.test(t.nodeValue)) { PATH_RE.lastIndex = 0; t.nodeValue = t.nodeValue.replace(PATH_RE, "our research notes"); }
    return node;
  }
  function scoutBlock(sc) { return scrubPaths(scoutBlock0(sc)); }
  function scoutBlock0(sc) {
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
    { k: "chin", label: "Easier to drop", min: 0.5, max: 2, step: 0.01, hint: "How easily a clean head shot drops this fighter. Above ×1.00 drops more easily, below is sturdier. Age, weight class and past KO losses are already counted." },
    { k: "cardio", label: "Gas tank drain", min: 0.6, max: 1.6, step: 0.01, hint: "How fast the tank empties. Above 1 tires faster, and fatigue cuts output, accuracy and power." },
    { k: "tdAtt", label: "Takedown attempts", min: 0, max: 4, step: 0.05, hint: "How often this fighter shoots, at distance and in the clinch." },
    { k: "tdDef", label: "Takedown defense", min: 0.5, max: 2.5, step: 0.05, hint: "Divides the opponent's odds of finishing a shot. ×2.00 means the opponent's takedowns land about half as often." },
    { k: "leg", label: "Leg-kick share", min: 0, max: 0.45, step: 0.01, hint: "Share of strikes at distance aimed at the legs. Leg damage slows a fighter and costs output and power." },
    { k: "sub", label: "Submission threat", min: 0.3, max: 3, step: 0.05, hint: "Submission attempts on the ground and how often they finish." }
  ];
  // the leg-kick share the simulator would use with the knob at data: the same number the mirror chart quotes
  function legData(i) { var m0 = cur.m0 || cur.m; return m0 && m0.mixD && m0.mixD[i] ? m0.mixD[i][2] : (m0 && m0.R ? m0.R[i].mixD[2] : null); }
  function knobDefault(side, kd) { return kd.k === "leg" ? legData(side === "A" ? 0 : 1) : 1; }
  function movedKnobs(side) {
    var a = cleanAdj(S.adj[side]), out = [];
    KNOBS.forEach(function (kd) { var v = a[kd.k]; if (v == null) return; if (kd.k === "leg" || Math.abs(v - 1) > 0.005) out.push(kd.label.toLowerCase()); });
    return out;
  }
  function knobVal(side, k) { var v = S.adj[side][k]; return v == null ? (k === "leg" ? null : 1) : v; }
  function knobFmt(side, kd) {
    var i = side === "A" ? 0 : 1, v = knobVal(side, kd.k), m0 = cur.m0 || cur.m;
    if (kd.k === "leg") {
      var data = legData(i);
      return v == null ? "data " + pct(data, 0) : pct(v, 0) + " (data " + pct(data, 0) + ")";
    }
    if (kd.k === "chin") return Math.abs(v - 1) < 0.005 ? "×1.00 data" : mult(v) + (v > 1 ? " drops more easily" : " sturdier");
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
    var i = side === "A" ? 0 : 1;
    syncTabDots();
    KNOBS.forEach(function (kd) {
      var d = el("div", "sl " + side), top = el("div", "sl-top"), lab = el("label", null, kd.label), out = el("output");
      var id = "k-" + kd.k; lab.htmlFor = id; out.id = "o-" + kd.k; out.htmlFor = id;
      var inp = document.createElement("input"); inp.type = "range"; inp.id = id; inp.min = kd.min; inp.max = kd.max; inp.step = kd.step;
      var v = knobVal(side, kd.k), dv = knobDefault(side, kd);
      inp.value = v == null ? (dv != null ? dv : 0.1) : v;
      inp.setAttribute("aria-describedby", "h-" + kd.k);
      // a tick under the track at the data value (the thumb is about 16px wide, so the track runs 8px in from each end)
      var rng = el("div", "rng"); rng.appendChild(inp);
      if (dv != null && isFinite(dv)) { var tk = el("i", "dtick"), fr = clamp((dv - kd.min) / (kd.max - kd.min), 0, 1); tk.style.left = "calc(8px + (100% - 16px) * " + fr.toFixed(4) + ")"; tk.title = "Data: " + (kd.k === "leg" ? pct(dv, 0) : "×1.00"); rng.appendChild(tk); }
      top.appendChild(lab); top.appendChild(out); d.appendChild(top); d.appendChild(rng);
      var h = el("p", "hint", kd.hint); h.id = "h-" + kd.k; d.appendChild(h);
      wrap.appendChild(d);
      function sync() { out.textContent = knobFmt(side, kd); var vv = knobVal(side, kd.k); out.classList.toggle("moved", vv != null && Math.abs(vv - 1) > 0.005 && kd.k !== "leg" || (kd.k === "leg" && vv != null)); inp.setAttribute("aria-valuetext", out.textContent); }
      sync();
      inp.addEventListener("input", function () { S.adj[side][kd.k] = +inp.value; S.scen = null; sync(); syncTabDots(); knobsChanged(); });
    });
    renderJudgeKnob();
  }
  // a dot on a corner's tab when that corner has knobs off the data
  function syncTabDots() {
    ["A", "B"].forEach(function (s) {
      var t = $("ktab" + s); if (!t) return;
      var dot = t.querySelector(".kdot"); if (!dot) { dot = el("span", "kdot"); dot.setAttribute("aria-hidden", "true"); t.appendChild(dot); }
      var mv = movedKnobs(s); dot.hidden = !mv.length;
      t.title = mv.length ? nameOf(s) + ": " + mv.join(", ") + " moved off the data" : "";
      t.setAttribute("aria-label", shortOf(s) + (mv.length ? ", knobs moved" : ""));
    });
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
    syncJudge(); syncTabDots();
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
      if (Math.abs(f.ageChin - 1) > 0.005) bits.push("easier to drop ×" + fx(f.ageChin) + " for age");
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
    function termsLine() { if (!terms) return; var p = el("p", "small"); p.appendChild(el("b", null, "Already in the model from data: ")); p.appendChild(document.createTextNode(terms + " Above ×1.00 means easier to drop; the knobs multiply on top.")); box.appendChild(p); }
    function movedLine() {
      var parts = []; ["A", "B"].forEach(function (s) { var mv = movedKnobs(s); if (mv.length) parts.push(nameOf(s) + " (" + mv.join(", ") + ")"); });
      if (Math.abs(S.judgePower - JP0) > 0.001) parts.push("the judges (credit for power " + fx(S.judgePower) + ")");
      if (!parts.length) return;
      var p = el("p"); p.appendChild(el("b", null, "Knobs moved: ")); p.appendChild(document.createTextNode(parts.join("; ") + ".")); box.appendChild(p);
    }
    var sc = scenarioList().filter(function (x) { return x.id === S.scen; })[0];
    if (!sc) {
      var custom = Object.keys(cleanAdj(S.adj.A)).length + Object.keys(cleanAdj(S.adj.B)).length > 0 || Math.abs(S.judgePower - JP0) > 0.001;
      var p = el("p"); p.appendChild(el("b", null, custom ? "Custom settings. " : "Data only. "));
      p.appendChild(document.createTextNode(custom ? "You've moved the knobs by hand. Reset to data puts every knob back to 1.00." :
        "Every knob sits at 1.00, so the simulator runs on the UFC numbers, its age, weight-class and KO-loss terms, and the default judging."));
      box.appendChild(p);
      if (custom) movedLine();
      if (!pairData(S.a, S.b)) box.appendChild(el("p", null, "There are no hand-written scenarios for this pair yet; the dashed chips work for any matchup."));
      termsLine();
      return;
    }
    var h = el("p"); h.appendChild(el("b", null, sc.label + ". ")); h.appendChild(document.createTextNode(sc.note || "")); box.appendChild(h);
    if (sc.id === "rust") { var ls = layoffSide(); if (ls) box.appendChild(el("p", null, "Applied to " + nameOf(ls) + ", whose last fight was " + fmtDate(prof(ls).last_fight) + ".")); }
    movedLine();
    if (sc.research) { var r = el("p"); r.appendChild(el("b", null, "The research: ")); r.appendChild(document.createTextNode(sc.research)); box.appendChild(r); }
    var srcs = el("div", "srcs"); if (linkList(srcs, sc.sources)) box.appendChild(srcs);
    termsLine();
    scrubPaths(box);
  }

  var knobTimer = null;
  function knobsChanged(now) {
    clearTimeout(knobTimer);
    var run = function () {
      buildMatchup(); dropEngine(); syncKnobOutputs(); renderScenNote(); renderWhy(); renderForecast();
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
      var d = e.data;
      // the learned stat-line model (engine v4): the worker's own FightEngine can then build learned-rate matchups too
      if (d && d.mlModel) { try { if (EN.loadMLRates) EN.loadMLRates(d.mlModel); } catch (x) { /* keeps the base tables */ } return; }
      current = d.id;
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
      postModel(w);
      w.onmessage = function (e) {
        var d = e.data; if (d.id !== tallyId) return;
        if (d.error) { workerFailed = true; worker = null; try { w.terminate(); } catch (x) { /* gone */ } startTally(); return; }
        onTally(d.agg, d.done);
      };
      w.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); workerFailed = true; worker = null; startTally(); };
      return w;
    } catch (e) { return null; }
  }
  var MLJSON = null;   // the learned stat-line model JSON once installed (engine v4); posted to the tally worker
  function postModel(w) { if (w && MLJSON) { try { w.postMessage({ mlModel: MLJSON }); } catch (e) { /* the posted matchups already carry the learned tables */ } } }
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
  // the simulator's numbers belong to one matchup and knob setting: drop them as soon as either changes, so the forecast
  // drawn before the new tally's first chunk never quotes the old simulator
  function dropEngine() { stack.engine = null; stack.engineN = 0; ENG = null; lastAgg = null; }
  function startTally() {
    tallyId++;
    dropEngine();
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

  var ENG = null, ENGINE_MIN = 2000;   // the simulator's running tally: { pA, pB, pD, n, done }
  function renderTally(agg, done) {
    lastAgg = agg;
    var n = Math.max(1, agg.n), b = agg.bins;
    var pA = (b[0] + b[1] + b[2]) / n, pB = (b[4] + b[5] + b[6]) / n, pD = b[3] / n;
    ENG = { pA: pA, pB: pB, pD: pD, n: agg.n, done: done };
    stack.engine = agg.n >= ENGINE_MIN ? pA / Math.max(1e-9, pA + pB) : null; stack.engineN = agg.n;
    var mlOn = cur.m && cur.m.mlApplied;
    $("runStatus").textContent = done ? nf.format(agg.n) + " simulated fights · " + scenarioName() + " · " + (mlOn ? "learned stat lines" : "raw UFC rates")
      : "Simulating " + nf.format(agg.n) + " of " + nf.format(N_TALLY) + " fights";
    setProgress(agg.n / N_TALLY);
    renderForecast();
    if (done && BL && BL.head) $("tallyLive").textContent = "Headline odds: " + nameOf("A") + " " + pctW(BL.head.pA) + ", " + nameOf("B") + " " + pctW(BL.head.pB) + ", draw " + pctD(BL.head.pD) + ".";
  }

  /* ================================================================ the blend (MoE) and the method-and-round model */
  var BL = null;
  function fightCtx() { return { division: S.div, rounds: S.rounds, title: S.title, date: todayISO() }; }
  function mlFight(ctx) {
    return { date: ctx.date, lbs: divLbs(ctx.division) || 155, five: ctx.rounds === 5 ? 1 : 0, title: ctx.title ? 1 : 0, women: /^Women/.test(ctx.division || "") ? 1 : 0, "catch": 0 };
  }
  // every expert the page can compute without the simulator, for any two roster fighters
  function expertsFor(slugA, slugB, pa, pb, ctx) {
    var out = { experts: {}, notes: {}, A: null, B: null };
    if (!MOE || !pa || !pb) return out;
    var MoE = window.MoE, o = { keys: DB.meta && DB.meta.keys, snapshot: DB.meta && DB.meta.snapshot, halfLife: (DB.meta && DB.meta.half_life_days) || 730 };
    try { out.A = MoE.sideFromProfile(pa, ctx.date, o); out.B = MoE.sideFromProfile(pb, ctx.date, o); } catch (e) { return out; }
    try {
      var fl = MoE.featLR(MOEJ.feat, out.A, out.B, { division: ctx.division, homeA: out.A.home, homeB: out.B.home });
      if (isFinite(fl)) out.experts.feat_lr = fl;
    } catch (e) { out.notes.feat_lr = "could not be computed"; }
    out.experts.elo = MoE.eloProb(out.A.elo, out.B.elo);
    var missing = function (has) { var w = []; if (!has(slugA)) w.push(lastName(pa.name)); if (!has(slugB)) w.push(lastName(pb.name)); return w.join(" and "); };
    if (MLP) {
      var r = null; try { r = MLP.predict(slugA, slugB, mlFight(ctx)); } catch (e) { r = null; }
      if (r && r.pEloSig != null && isFinite(r.pLR)) { out.experts.ml = r.pLR; out.experts.elo_sig = r.pEloSig; out.mlPlatt = r.pA; }
      else out.notes.ml = out.notes.elo_sig = "no ML profile for " + (missing(MLP.has) || "this pair");
    } else out.notes.ml = out.notes.elo_sig = "not in this build";
    var ra = MKTR[slugA], rb = MKTR[slugB];
    if (ra && rb) out.experts.mkt_rating = MoE.ratingProb(ra[0], ra[1], rb[0], rb[1]);
    else out.notes.mkt_rating = "no closing-line history for " + missing(function (s) { return !!MKTR[s]; });
    return out;
  }
  // American odds as a number; "EV" / "even" / "evens" is +100, so every line goes through the same (power) de-vig
  function oddsNum(s) {
    s = String(s == null ? "" : s).trim().toLowerCase().replace(/[−–]/g, "-");
    if (s === "ev" || s === "even" || s === "evens") return 100;
    return /^[+-]?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }
  var OVER_LO = -0.01, OVER_HI = 0.25;   // a two-way line whose margin falls outside this is a typo, not a price
  function marketLine() {
    var ia = parseOdds(S.odds.A), ib = parseOdds(S.odds.B);
    if (ia == null || ib == null || !isFinite(ia) || !isFinite(ib)) return { p: null, ia: ia, ib: ib };
    var over = ia + ib - 1;
    if (over < OVER_LO || over > OVER_HI) return { p: null, ia: ia, ib: ib, over: over, bad: true };
    var p = ia / (ia + ib), oa = oddsNum(S.odds.A), ob = oddsNum(S.odds.B);
    try { if (window.MoE && isFinite(oa) && isFinite(ob)) p = window.MoE.devig(oa, ob); } catch (e) { /* proportional */ }
    return { p: p, ia: ia, ib: ib, over: over };
  }
  var mrCache = {};
  function mrFor(pMkt) {
    if (!MR) return null;
    var ctx = fightCtx(), key = [S.a, S.b, ctx.division, ctx.rounds, ctx.title, ctx.date, pMkt == null ? "S" : pMkt.toFixed(4)].join("|");
    if (key in mrCache) return mrCache[key];
    var o = null;
    try {
      o = MR.predict(prof("A"), prof("B"), { slugA: S.a, slugB: S.b, division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date,
        pMarketA: pMkt == null ? undefined : pMkt });
      if (!o || !o.cells || !isFinite(o.pA) || o.cells.A.ko.length !== S.rounds) o = null;
    } catch (e) { o = null; }
    var ks = Object.keys(mrCache); if (ks.length > 60) mrCache = {};
    mrCache[key] = o; return o;
  }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  // the simulator's tally with every A-win quantity scaled by f.fA and every B-win quantity by f.fB (MoE.winnerFactors)
  function scaledAgg(agg, f) {
    var fa = f.fA, fb = f.fB, k;
    var s = { n: agg.n, nR: agg.nR, bins: agg.bins.map(function (x, i) { return i < 3 ? x * fa : (i > 3 ? x * fb : x); }),
      finA: agg.finA.map(function (x) { return x * fa; }), finB: agg.finB.map(function (x) { return x * fb; }),
      distA: agg.distA * fa, distB: agg.distB * fb, dec: agg.dec, methods: {}, secs: agg.secs, sumA: agg.sumA, sumB: agg.sumB };
    s.dist = s.distA + s.distB + (agg.dec.DRAW || 0);
    for (k in agg.methods) s.methods[k] = agg.methods[k] * (k.charAt(0) === "A" ? fa : (k.charAt(0) === "B" ? fb : 1));
    return s;
  }
  function computeBlend() {
    var pa = prof("A"), pb = prof("B"), ctx = fightCtx();
    var X = expertsFor(S.a, S.b, pa, pb, ctx), ex = {}, k;
    for (k in X.experts) ex[k] = X.experts[k];
    var engStale = !ENG || !lastAgg || lastAgg.nR !== S.rounds;
    if (stack.engine != null && !engStale) ex.engine = stack.engine;
    var mk = marketLine(), hasLine = mk.p != null, useLine = hasLine && S.line;
    var gate = X.A ? window.MoE.gateFromSides(X.A, X.B, { division: S.div, rounds: S.rounds }) : {};
    var rNo = null, rLine = null;
    if (MOE && Object.keys(ex).length) {
      try { rNo = MOE.predict({ experts: ex, gate: gate }); } catch (e) { rNo = null; }
      if (hasLine) {
        var ex2 = {}; for (k in ex) ex2[k] = ex[k]; ex2.market = mk.p;
        try { rLine = MOE.predict({ experts: ex2, gate: gate }); } catch (e) { rLine = null; }
      }
    }
    var r = useLine ? rLine : rNo;
    var p = r ? r.p : (ENG && !engStale ? ENG.pA / Math.max(1e-9, ENG.pA + ENG.pB) : null);
    var mr = mrFor(useLine ? mk.p : null);
    var pD = mr ? mr.pDraw : (ENG && !engStale ? ENG.pD : 0.008);
    var f = (ENG && !engStale && p != null && window.MoE) ? window.MoE.winnerFactors(ENG.pA, ENG.pB, ENG.pD, p) : { fA: 1, fB: 1 };
    var sc = (!engStale && lastAgg) ? scaledAgg(lastAgg, f) : null;
    var head = null;
    if (p != null) {
      var qA = p * (1 - pD), qB = (1 - p) * (1 - pD);
      head = { pA: qA, pB: qB, pD: pD, src: null, bins7: null, finA: null, finB: null, variant: mr ? mr.variant : null };
      if (mr) {
        var c = mr.cells, fA = qA / Math.max(1e-9, mr.pA), fB = qB / Math.max(1e-9, mr.pB);
        head.src = "mr";
        head.bins7 = [sum(c.A.ko) * fA, sum(c.A.sub) * fA, c.A.dec * fA, pD, c.B.dec * fB, sum(c.B.sub) * fB, sum(c.B.ko) * fB];
        head.finA = c.A.ko.map(function (v, i) { return (v + c.A.sub[i]) * fA; });
        head.finB = c.B.ko.map(function (v, i) { return (v + c.B.sub[i]) * fB; });
      } else if (sc) {
        var n = Math.max(1, sc.n);
        head.src = "engine"; head.pD = sc.bins[3] / n;
        head.bins7 = sc.bins.map(function (x) { return x / n; });
        head.finA = sc.finA.map(function (x) { return x / n; }); head.finB = sc.finB.map(function (x) { return x / n; });
      }
    }
    BL = { X: X, ex: ex, r: r, rNo: rNo, rLine: rLine, mk: mk, hasLine: hasLine, useLine: useLine, p: p, mr: mr, head: head, f: f, sc: sc, engStale: engStale };
    return BL;
  }

  function renderForecast() {
    computeBlend();
    var H = BL.head, sc = BL.sc;
    if (H) {
      $("pA").textContent = pctW(H.pA); $("pB").textContent = pctW(H.pB); $("pD").textContent = pctD(H.pD);
      $("winA").firstChild.nodeValue = pctW(H.pA); $("winB").firstChild.nodeValue = pctW(H.pB);
      $("segA").style.width = (H.pA * 100) + "%"; $("segD").style.width = Math.max(0.4, H.pD * 100) + "%"; $("segB").style.width = (H.pB * 100) + "%";
      $("segAl").textContent = H.pA > 0.12 ? pctW(H.pA) : ""; $("segBl").textContent = H.pB > 0.12 ? pctW(H.pB) : "";
      $("segbar").setAttribute("aria-label", "Headline odds: " + nameOf("A") + " " + pctW(H.pA) + ", draw " + pctD(H.pD) + ", " + nameOf("B") + " " + pctW(H.pB));
    }
    // what the headline is made of, in one place
    var fc = $("fcNote"); fc.textContent = "";
    var l1 = el("span");
    if (BL.r) {
      var nUsed = BL.r.used.length;
      l1.appendChild(el("b", null, "Who wins: " + numWord(nUsed) + " models combined" + (BL.useLine ? ", the betting line included" : (BL.hasLine ? ", the betting line switched off" : ", no betting line")) + ". "));
    } else l1.appendChild(el("b", null, "Who wins: the simulator alone (the combined model did not load). "));
    if (ENG && !BL.engStale) l1.appendChild(document.createTextNode("The simulator by itself: " + shortOf("A") + " " + pctW(ENG.pA) + ", " + shortOf("B") + " " + pctW(ENG.pB) + ", draw " + pctD(ENG.pD) + " over " + nf.format(ENG.n) + " fights. The cage's winners follow the headline, not the simulator alone."));
    else l1.appendChild(document.createTextNode("The simulator is running."));
    fc.appendChild(l1);
    var l2 = el("span");
    if (H && H.src === "mr") l2.textContent = "How it ends: the finish model" + (H.variant === "SM" ? " (it also reads the betting line)" : "") + ", scaled to the headline odds.";
    else if (H && H.src === "engine") l2.textContent = "How it ends: the simulator, scaled to the headline odds (the finish model is not available for this pair).";
    if (l2.textContent) fc.appendChild(l2);
    if (cur.m && cur.m.mlStuck) fc.appendChild(el("span", null, "This simulator build keeps its learned stat lines even with the switch off."));
    // legend for both charts
    var key = $("howKey"); key.textContent = "";
    if (H) { var k1 = el("span"); k1.appendChild(el("i", "k-bar")); k1.appendChild(document.createTextNode(H.src === "mr" ? "Finish model, scaled to the headline odds" : "Simulator, scaled to the headline odds")); key.appendChild(k1); }
    if (H && H.bins7) {
      drawBins(H, null); drawRounds(H, null);
      var dist = H.bins7[2] + H.bins7[3] + H.bins7[4];
      $("tDistL").textContent = "Goes the full " + S.rounds * 5 + " minutes";
      $("tDist").textContent = pctW(dist);
      $("tCardsL").textContent = shortOf("A") + " wins when it goes to the cards";
      $("tCards").textContent = H.bins7[2] + H.bins7[4] > 0 ? pctW(H.bins7[2] / (H.bins7[2] + H.bins7[4])) : "–";
      $("tKoL").textContent = "Ends by KO or TKO, either fighter";
      $("tKo").textContent = pctW(H.bins7[0] + H.bins7[6]);
    }
    var mnote = $("methodNote");
    if (lastAgg && !BL.engStale) {
      var decs = lastAgg.dec.UD + lastAgg.dec.SD + lastAgg.dec.MD;
      if (sc) renderMethodTable(sc);
      renderAvgTable(lastAgg);
      if (mnote) mnote.textContent = "The simulator's finer methods, rescaled so its winner odds match the headline (its draw share and its mix of methods for each winner are kept)." +
        (decs ? " Of its decisions, " + pct((lastAgg.dec.SD + lastAgg.dec.MD) / decs, 0) + " are split or majority." : "");
    } else {
      ["methodTbl", "avgTbl"].forEach(function (id) { $(id).textContent = ""; });
      if (mnote) mnote.textContent = "The simulator is running.";
    }
    renderHowTable(H, sc, BL.engStale ? null : lastAgg);
    renderStack();
  }

  function numWord(n) { return ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] || String(n); }
  function scenarioName() {
    var sc = scenarioList().filter(function (x) { return x.id === S.scen; })[0];
    if (sc) return sc.label + " settings";
    var custom = Object.keys(cleanAdj(S.adj.A)).length + Object.keys(cleanAdj(S.adj.B)).length > 0 || Math.abs(S.judgePower - JP0) > 0.001;
    return custom ? "custom settings" : "data only";
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
  // a tick for the simulator's value, drawn over the bar with a surface ring so it stays readable on any fill
  function tickMark(svg, x0, x1, y) {
    svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: y, y2: y, stroke: "var(--surface)", "stroke-width": 5, "stroke-linecap": "round" }));
    svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: y, y2: y, stroke: "var(--ink)", "stroke-width": 2.5, "stroke-linecap": "round" }));
  }
  function drawBins(H, sc) {
    var box = $("binsChart"), labels = binLabels();
    var W = Math.max(300, Math.round(box.clientWidth || 560)), H0 = 232, L = 34, R = 8, T = 20, B = 48;
    var vals = H.bins7.map(function (x) { return 100 * x; });
    var ticks = (H.src === "mr" && sc) ? sc.bins.map(function (x) { return 100 * x / Math.max(1, sc.n); }) : null;
    var max = niceMax(Math.max(Math.max.apply(null, vals), ticks ? Math.max.apply(null, ticks) : 0) * 1.12);
    var aria = "How the fights end. " + labels.map(function (l, i) { return l + " " + vals[i].toFixed(1) + "%" + (ticks ? " (simulator " + ticks[i].toFixed(1) + "%)" : ""); }).join(", ");
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H0, role: "img", "aria-label": aria });
    var plotW = W - L - R, plotH = H0 - T - B, band = plotW / 7, bw = Math.min(24, band * 0.5);
    var step = max <= 20 ? 5 : (max <= 50 ? 10 : 20);
    for (var t = 0; t <= max + 1e-9; t += step) {
      var y = T + plotH - plotH * t / max;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }));
      svgText(svg, L - 6, y + 4, t + "%", { "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
    }
    vals.forEach(function (v, i) {
      var x = L + band * i + band / 2, h = plotH * v / max, y = T + plotH - h;
      svg.appendChild(svgEl("path", { d: barPath(x - bw / 2, x + bw / 2, y, T + plotH), fill: BIN_COL[i] }));
      var top = y;
      if (ticks) { var ty = T + plotH - plotH * ticks[i] / max; tickMark(svg, x - bw / 2 - 4, x + bw / 2 + 4, ty); top = Math.min(top, ty - 2); }
      svgText(svg, x, top - 5, v >= 0.05 ? v.toFixed(1) : "0", { "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "var(--ink)" });
      svgText(svg, x, T + plotH + 16, W < 430 && BIN_SHORT[i] === "Decision" ? "Dec" : BIN_SHORT[i], { "text-anchor": "middle", "font-size": W < 430 ? 10 : 11, fill: "var(--ink-2)" });
      var hit = svgEl("rect", { x: L + band * i, y: T, width: band, height: plotH + 20, fill: "transparent" });
      var txt = labels[i] + ": " + v.toFixed(1) + "%" + (ticks ? " · simulator, rescaled " + ticks[i].toFixed(1) + "%" : "");
      hit.addEventListener("pointerenter", function () { var bb = box.getBoundingClientRect(), s = bb.width / W; tip(box, x * s, top * s, txt); });
      hit.addEventListener("pointerleave", function () { tip(box, 0, 0, null); });
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: T + plotH, y2: T + plotH, stroke: "var(--axis)", "stroke-width": 1 }));
    var gy = H0 - 8;
    svgText(svg, L + band * 1.5, gy, shortOf("A") + " wins", { "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "var(--ink)" });
    svgText(svg, L + band * 5.5, gy, shortOf("B") + " wins", { "text-anchor": "middle", "font-size": 11.5, "font-weight": 700, fill: "var(--ink)" });
    box.textContent = ""; box.appendChild(svg); if (tipEl) tipEl.hidden = true;
  }
  function drawRounds(H, sc) {
    var box = $("roundChart"), nR = H.finA.length;
    var W = Math.max(300, Math.round(box.clientWidth || 560)), H0 = 182, L = 34, R = 8, T = 18, B = 42;
    var a = H.finA.map(function (x) { return 100 * x; }), g = H.finB.map(function (x) { return 100 * x; });
    var useT = H.src === "mr" && sc && sc.finA.length === nR;
    var ta = useT ? sc.finA.map(function (x) { return 100 * x / Math.max(1, sc.n); }) : null, tg = useT ? sc.finB.map(function (x) { return 100 * x / Math.max(1, sc.n); }) : null;
    var hi = Math.max(Math.max.apply(null, a), Math.max.apply(null, g), 1);
    if (useT) hi = Math.max(hi, Math.max.apply(null, ta), Math.max.apply(null, tg));
    var max = niceMax(hi * 1.18);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H0, role: "img", "aria-label": "Finishes by round. " + nameOf("A") + ": " + a.map(function (v, i) { return "round " + (i + 1) + " " + v.toFixed(1) + "%"; }).join(", ") + ". " + nameOf("B") + ": " + g.map(function (v, i) { return "round " + (i + 1) + " " + v.toFixed(1) + "%"; }).join(", ") });
    var plotW = W - L - R, plotH = H0 - T - B, band = plotW / nR, bw = Math.min(24, band * 0.28);
    [0, max / 2, max].forEach(function (t) {
      var y = T + plotH - plotH * t / max;
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }));
      svgText(svg, L - 6, y + 4, (t % 1 ? t.toFixed(1) : t) + "%", { "text-anchor": "end", "font-size": 11, fill: "var(--muted)" });
    });
    for (var i = 0; i < nR; i++) {
      [[a[i], "var(--blue)", -1, shortOf("A"), ta && ta[i]], [g[i], "var(--red)", 1, shortOf("B"), tg && tg[i]]].forEach(function (s) {
        var cx = L + band * i + band / 2 + s[2] * (bw / 2 + 2), h = plotH * s[0] / max, y = T + plotH - h, top = y;
        svg.appendChild(svgEl("path", { d: barPath(cx - bw / 2, cx + bw / 2, y, T + plotH), fill: s[1] }));
        if (s[4] != null) { var ty = T + plotH - plotH * s[4] / max; tickMark(svg, cx - bw / 2 - 3, cx + bw / 2 + 3, ty); top = Math.min(top, ty - 2); }
        svgText(svg, cx, top - 4, s[0].toFixed(1), { "text-anchor": "middle", "font-size": 10.5, "font-weight": 700, fill: "var(--ink-2)" });
        var rnd = i + 1, who = s[3], val = s[0], tv = s[4];
        var hit = svgEl("rect", { x: cx - bw / 2 - 2, y: T, width: bw + 4, height: plotH, fill: "transparent" });
        hit.addEventListener("pointerenter", function () { var bb = box.getBoundingClientRect(), k = bb.width / W; tip(box, cx * k, top * k, who + " finishes in round " + rnd + ": " + val.toFixed(1) + "%" + (tv != null ? " · simulator " + tv.toFixed(1) + "%" : "")); });
        hit.addEventListener("pointerleave", function () { tip(box, 0, 0, null); });
        svg.appendChild(hit);
      });
      svgText(svg, L + band * i + band / 2, T + plotH + 16, (W < 430 ? "R" : "Round ") + (i + 1), { "text-anchor": "middle", "font-size": 11, fill: "var(--ink-2)" });
    }
    svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: T + plotH, y2: T + plotH, stroke: "var(--axis)", "stroke-width": 1 }));
    svg.appendChild(svgEl("circle", { cx: L + 6, cy: H0 - 9, r: 5, fill: "var(--blue)" }));
    svgText(svg, L + 15, H0 - 5, shortOf("A") + " finishes", { "font-size": 11.5, fill: "var(--ink-2)" });
    var off = L + 15 + Math.max(110, (shortOf("A").length + 9) * 7);
    svg.appendChild(svgEl("circle", { cx: off, cy: H0 - 9, r: 5, fill: "var(--red)" }));
    svgText(svg, off + 9, H0 - 5, shortOf("B") + " finishes", { "font-size": 11.5, fill: "var(--ink-2)" });
    box.textContent = ""; box.appendChild(svg);
  }
  // the three views side by side: the forecast (method model x blend), the simulator rescaled to the blend, the simulator alone
  function renderHowTable(H, sc, agg) {
    var t = $("howTbl"); t.textContent = "";
    var note = $("howNote");
    if (!H || !H.bins7) { note.textContent = "Waiting for the models."; return; }
    var cols = [];
    if (H.src === "mr") cols.push({ h: "Headline", sub: "finish model, scaled", v: H.bins7 });
    if (sc) cols.push({ h: "Simulator", sub: "scaled to headline", v: sc.bins.map(function (x) { return x / Math.max(1, sc.n); }) });
    if (agg) cols.push({ h: "Simulator", sub: "as played", v: agg.bins.map(function (x) { return x / Math.max(1, agg.n); }) });
    var th = el("thead"), hr = el("tr"); hr.appendChild(el("th", null, "Outcome"));
    cols.forEach(function (c, i) { var x = el("th", i === 0 && H.src === "mr" ? "strong" : null); x.appendChild(document.createTextNode(c.h)); x.appendChild(el("br")); x.appendChild(el("small", null, c.sub)); hr.appendChild(x); });
    Array.prototype.forEach.call(hr.children, function (x) { x.scope = "col"; }); th.appendChild(hr); t.appendChild(th);
    var tb = el("tbody"), labels = binLabels();
    function row(label, f, strong) {
      var tr = el("tr"); tr.appendChild(el("td", strong ? "strong" : null, label));
      cols.forEach(function (c, i) { tr.appendChild(el("td", i === 0 && H.src === "mr" ? "strong" : null, pct(f(c.v), 1))); });
      tb.appendChild(tr);
    }
    labels.forEach(function (l, i) { row(l, function (v) { return v[i]; }); });
    row(shortOf("A") + " wins", function (v) { return v[0] + v[1] + v[2]; }, true);
    row(shortOf("B") + " wins", function (v) { return v[4] + v[5] + v[6]; }, true);
    row("Goes the distance", function (v) { return v[2] + v[3] + v[4]; }, true);
    t.appendChild(tb);
    note.textContent = (H.src === "mr" ? "The headline column is what the page leads with: the winner odds come from the combined models, and how the fight ends comes from the finish model" + (H.variant === "SM" ? " (which also reads the betting line)" : "") + ", which beat division base rates on held-out fights from 2024 on. " : "") +
      (agg ? "The simulator columns show the same outcomes from " + nf.format(agg.n) + " simulated fights, once scaled so its winner odds match the headline (its draw share and its mix of methods for each winner kept) and once as played." : "The simulator is still running.");
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
      if (a < 0.5 && b < 0.5 && (r[1][0] === "LEG")) return;
      var tr = el("tr"); tr.appendChild(el("td", null, r[0])); tr.appendChild(el("td", null, pct(a / n))); tr.appendChild(el("td", null, pct(b / n))); tr.appendChild(el("td", null, pct((a + b) / n))); tb.appendChild(tr);
    });
    var dr = el("tr"); dr.appendChild(el("td", null, "Draw")); dr.appendChild(el("td", null, "")); dr.appendChild(el("td", null, "")); dr.appendChild(el("td", null, pct((M["D:DRAW"] || 0) / n))); tb.appendChild(dr);
    var tr2 = el("tr"); tr2.appendChild(el("td", "strong", "Total")); tr2.appendChild(el("td", "strong", pct(totA / n))); tr2.appendChild(el("td", "strong", pct(totB / n))); tr2.appendChild(el("td", "strong", pct((totA + totB + (M["D:DRAW"] || 0)) / n))); tb.appendChild(tr2);
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
    if (!x || !m) { $("whyLede").textContent = "The simulator could not explain this matchup."; return; }
    var A = x.A, B = x.B, nA = shortOf("A"), nB = shortOf("B"), L = m.L, P = m.P, divl = S.div.toLowerCase();
    $("whySub").textContent = S.div + " averages (" + (P.lbs || "?") + " lb) · " + S.rounds + " rounds";
    $("whyLede").textContent = "These are the rates the simulator plays from for this pair, before any fight: each fighter's numbers combined with the opponent's, then the learned stat lines" + (m.mlApplied ? "" : " (switched off now)") + ", age, size and your knobs. Strike rates here count per minute spent in each position (at distance, in the clinch, on top). Every simulated fight then adds fight-night form, fatigue and damage on top.";
    function rel(v, base) { var r = v / base - 1; return Math.abs(r) < 0.03 ? "about the " + divl + " average" : Math.round(Math.abs(r) * 100) + "% " + (r > 0 ? "above" : "below") + " the " + divl + " average"; }
    // the knockdown chance split into factors that multiply out exactly: one division base for both fighters, the learned
    // stat lines' read of this pairing, then the puncher's power and the other fighter's resistance as the simulator uses them
    function kdParts(i) {
      var o = (i ? B : A).kd, j = 1 - i, fc = m.fac && m.fac[i], fo = m.fac && m.fac[j], aj = m.adj || [{}, {}];
      var ml = m.ml && m.ml.ratios && m.ml.ratios[i] && isFinite(m.ml.ratios[i].kd) ? m.ml.ratios[i].kd : null;
      var pw = fc ? fc.pow / Math.max(1e-9, fc.agePow * fc.sizePow * (aj[i].pow || 1)) : o.powerRatio;
      var ch = fo ? fo.chin / Math.max(1e-9, fo.ageChin * fo.koChin * fo.sizeChin * (aj[j].chin || 1)) : o.oppChinRatio;
      return { base: o.p0 / (ml || 1), ml: ml, pow: pw, chin: ch };
    }
    var items = [];
    var dA = A.attPerMin.dist, dB = B.attPerMin.dist;
    items.push(["Volume", nA + " throws " + fx(dA, 1) + " strikes per minute spent at distance, " + rel(dA, L.dAtt) + "; " + nB + " throws " + fx(dB, 1) + ", " + rel(dB, L.dAtt) + ". Those rates already account for how much each one's opponents usually throw at them."]);
    var hA = A.accuracy.dist[0], hB = B.accuracy.dist[0];
    items.push(["Accuracy", "At distance " + nA + " lands " + pct(hA, 0) + " of head strikes on " + nB + " and " + nB + " lands " + pct(hB, 0) + " on " + nA + ". Per 15 minutes that comes to about " + fx(A.expectedPer15.sigLnd, 0) + " significant strikes landed for " + nA + " and " + fx(B.expectedPer15.sigLnd, 0) + " for " + nB + ", before pace and fatigue."]);
    var kA = A.kd.perHeadLanded, kB = B.kd.perHeadLanded, kdb = [kdParts(0), kdParts(1)], p0 = kdb[0].base;
    items.push(["Power", "A clean standing head shot from " + nA + " drops " + nB + " " + pct(kA, 2) + " of the time; one from " + nB + " drops " + nA + " " + pct(kB, 2) + " of the time. Both start from the " + divl + " base of " + pct(p0, 2) + " per clean head shot; the chains below show what moves each one. " + (kB > kA * 1.3 ? nB + " needs far fewer clean shots to change the fight." : (kA > kB * 1.3 ? nA + " needs far fewer clean shots to change the fight." : "Neither has a big edge per shot."))]);
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
    var parts = [["Distance", occ[0], "var(--axis)", "var(--ink)"], ["Clinch", occ[1] + occ[2], "var(--neutral-fill)", "var(--on-fill)"], [nA + " on top", occ[3], "var(--blue-fill)", "var(--on-fill)"], [nB + " on top", occ[4], "var(--red-fill)", "var(--on-fill)"]];
    parts.forEach(function (p) {
      var s = el("span", null, p[1] > 0.09 ? pct(p[1], 0) : ""); s.style.width = Math.max(0.5, p[1] * 100) + "%"; s.style.background = p[2]; s.style.color = p[3]; occBox.appendChild(s);
      var k = el("span"); var i = el("i"); i.style.background = p[2]; k.appendChild(i); k.appendChild(document.createTextNode(p[0] + " " + pct(p[1], 0))); key.appendChild(k);
    });
    occBox.setAttribute("aria-label", "Expected share of fight time: " + parts.map(function (p) { return p[0] + " " + pct(p[1], 0); }).join(", "));

    // knockdown chains
    chain.appendChild(el("h3", "mini", "Knockdown chance per clean head shot"));
    [["A", A, 0], ["B", B, 1]].forEach(function (s) {
      var side = s[0], o = s[1].kd, q = kdb[s[2]], row = el("div", "chain");
      row.setAttribute("aria-label", shortOf(side) + " drops " + shortOf(other(side)) + " " + pct(o.perHeadLanded, 2) + " of the time per clean standing head shot");
      function f(label, v, always) {
        if (v == null || !isFinite(v)) return;
        if (!always && label !== "base" && Math.abs(v - 1) < 0.005) return;
        var dir = label === "base" || Math.abs(v - 1) < 0.02 ? 0 : (v > 1 ? 1 : -1);
        var span = el("span", "f" + (dir > 0 ? " up" : (dir < 0 ? " dn" : "")));
        if (dir) { var g = el("span", "g", dir > 0 ? "+" : "−"); g.setAttribute("aria-hidden", "true"); span.appendChild(g); }
        span.appendChild(el("b", null, (label === "base" ? pct(v, 2) : "×" + fx(v)))); span.appendChild(document.createTextNode(" " + (label === "base" ? divl + " base" : label)));
        if (dir) span.appendChild(el("span", "vh", dir > 0 ? " (raises the chance)" : " (lowers the chance)"));
        if (row.children.length) row.appendChild(el("span", "op", "·"));
        row.appendChild(span);
      }
      var me = shortOf(side), opp = shortOf(other(side));
      f("base", q.base);
      f("learned stat lines for this pairing", q.ml);
      f(me + "'s power", q.pow, true);
      f("how easily " + opp + " drops", q.chin, true);
      f(opp + "'s age (easier to drop)", o.ageChinOpp);
      f(me + "'s age (power)", o.agePow);
      f(opp + "'s " + o.oppKoLosses + " KO loss" + (o.oppKoLosses === 1 ? "" : "es"), o.koLossChinOpp);
      f(opp + " moving up (easier to drop)", o.sizeChinOpp);
      f(me + " moving up (power)", o.sizePow);
      if (Math.abs(o.knobPow - 1) > 0.005) f(me + "'s power knob", o.knobPow);
      if (Math.abs(o.knobChinOpp - 1) > 0.005) f(opp + "'s easier-to-drop knob", o.knobChinOpp);
      row.appendChild(el("span", "op", "="));
      row.appendChild(el("span", "res-f " + side, pct(o.perHeadLanded, 2)));
      chain.appendChild(row);
    });
    chain.appendChild(el("p", "small", "Each factor multiplies the " + divl + " base. A + (red border) raises the chance of a knockdown, a − (green border) lowers it. A knockdown is not a finish: the simulator then plays out the follow-up, and the referee may stop it or the downed fighter may recover."));

    // mirrored bars
    mir.appendChild(el("p", "small", "What the simulator plays: each fighter's numbers after the opponent adjustment, the learned stat lines and your knobs. Strike rates count per minute spent in that position."));
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
    mrow("Strike attempts per minute spent at distance", A.attPerMin.dist, B.attPerMin.dist, L.dAtt, f1);
    mrow("Strike attempts per minute spent in the clinch", A.attPerMin.clinch, B.attPerMin.clinch, null, f1);
    mrow("Ground strikes per minute spent on top", A.attPerMin.groundTop, B.attPerMin.groundTop, L.gAtt, f1);
    mrow("Head accuracy at distance", A.accuracy.dist[0], B.accuracy.dist[0], null, fp);
    mrow("Body accuracy at distance", A.accuracy.dist[1], B.accuracy.dist[1], null, fp);
    mrow("Leg accuracy at distance", A.accuracy.dist[2], B.accuracy.dist[2], null, fp);
    mrow("Leg-kick share at distance", A.targetMixDist[2], B.targetMixDist[2], L.mixD[2], fp);
    mrow("KD chance per clean head shot", A.kd.perHeadLanded, B.kd.perHeadLanded, p0, fp2);
    mrow("Takedown attempts / 15 standing min", A.grappling.tdAttPer15Stand, B.grappling.tdAttPer15Stand, L.tdAtt * 15, f1);
    mrow("Takedown success", A.grappling.tdSuccess, B.grappling.tdSuccess, P.td_acc, fp);
    mrow("Expected control time, seconds / 15 min", A.grappling.ctrlTargetPer15, B.grappling.ctrlTargetPer15, P.ctrl * 15, function (v) { return fx(v, 0); });
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
  var EXPERTS = [
    ["market", "Market line"], ["mkt_rating", "Market rating"], ["ml", "ML model"], ["feat_lr", "Feature model"],
    ["engine", "Simulator"], ["elo_sig", "Strike-share Elo"], ["elo", "Elo"]
  ];
  function expertSub(k) {
    var pa = prof("A"), pb = prof("B"), mk = BL.mk;
    switch (k) {
      case "market": return mk.p != null ? (S.line ? (S.odds.A + " / " + S.odds.B + ", bookmaker's cut removed") : "switched off below") : (mk.bad ? "that line doesn't add up; check the odds" : "enter odds below");
      case "mkt_rating": return BL.ex.mkt_rating != null ? "rating built from past closing lines" : BL.X.notes.mkt_rating || "not available";
      case "ml": return BL.ex.ml != null ? "learned from stats, record, age and layoff" : BL.X.notes.ml || "not available";
      case "feat_lr": return BL.ex.feat_lr != null ? "learned from 60 stat differences" : BL.X.notes.feat_lr || "not available";
      case "engine": return BL.ex.engine != null ? "simulator " + ENGV + ", " + nf.format(stack.engineN) + " fights" + (cur.m && cur.m.mlApplied ? ", learned stat lines" : "") : "tally running";
      case "elo_sig": return BL.ex.elo_sig != null ? "Elo moved by strike margins" : BL.X.notes.elo_sig || "not available";
      case "elo": return (pa.elo || 1500) + " vs " + (pb.elo || 1500);
    }
    return "";
  }
  function expertName(k) { for (var i = 0; i < EXPERTS.length; i++) if (EXPERTS[i][0] === k) return EXPERTS[i][1]; return k; }
  function verdictText() {
    var p = BL.p; if (p == null) return "";
    var A = shortOf("A"), B = shortOf("B"), fav = p >= 0.5 ? A : B, dog = p >= 0.5 ? B : A, pf = Math.max(p, 1 - p);
    var s = pf < 0.53 ? "Too close to call: " + fav + " " + pct(pf, 0) + ", " + dog + " " + pct(1 - pf, 0) + "."
      : fav + " is " + (pf < 0.6 ? "a slight" : (pf < 0.7 ? "a clear" : (pf < 0.8 ? "a strong" : "a heavy"))) + " favorite at " + pct(pf, 0) + ".";
    if (!BL.r) return s + " The combined model did not load, so this is the simulator alone.";
    if (BL.useLine) {
      var pm = BL.mk.p, favA = p >= 0.5, pmf = favA ? pm : 1 - pm, d = pf - pmf;
      s += Math.abs(d) < 0.01 ? " The betting line carries most of the weight and the other models barely move it." :
        " The betting line alone gives " + fav + " " + pct(pmf, 0) + "; the other models move that " + (d > 0 ? "up" : "down") + " to " + pct(pf, 0) + ".";
      if (BL.rNo && Math.abs(BL.rNo.p - pm) > 0.15) s += " On stats alone the blend has " + A + " at " + pct(BL.rNo.p, 0) + ". A gap that size is a warning, not an edge: on past fights the market usually won those arguments.";
    } else {
      var top = null, c = BL.r.contrib || {};
      for (var k in c) if (!top || Math.abs(c[k]) > Math.abs(c[top])) top = k;
      s += " With no betting line the stats models decide" + (top ? "; the " + expertName(top).toLowerCase().replace("ml model", "ML model").replace("elo", "Elo") + " pulls hardest" : "") + ".";
      if (BL.hasLine && BL.rLine) s += " With the line switched on it would be " + A + " " + pct(BL.rLine.p, 0) + ".";
    }
    var bf = blendFacts(BL.r, BL.useLine);
    if (bf && bf.beyond) s += " That is " + (bf.beyond > 0 ? "higher" : "lower") + " than any single model (their simple average is " + A + " " + pct(bf.avg, 0) + "): they carry partly independent evidence, and on 2024-25 fights every model was too cautious.";
    if (pf > 0.9) s += " Very lopsided picks are rarer in the test data; treat the last few points loosely.";
    return s;
  }
  // the inputs a blend used: their simple average and range, and whether the blend lands outside that range
  function blendFacts(r, withLine) {
    if (!r || !r.used || !r.used.length) return null;
    var ps = [];
    r.used.forEach(function (k) { var v = k === "market" ? (withLine ? BL.mk.p : null) : BL.ex[k]; if (v != null && isFinite(v)) ps.push(v); });
    if (!ps.length) return null;
    var avg = sum(ps) / ps.length, lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    return { avg: avg, lo: lo, hi: hi, n: ps.length, beyond: r.p > hi + 0.005 ? 1 : (r.p < lo - 0.005 ? -1 : 0) };
  }
  // each model's pull on the blend in percentage points: the blend's lead over 50-50, shared out in proportion to each
  // model's part of the combined score (so the pulls add up to the lead)
  function pullPts(r) {
    var out = {}, z = 0, k;
    if (!r || !r.contrib) return out;
    for (k in r.contrib) z += r.contrib[k];
    for (k in r.contrib) out[k] = Math.abs(z) > 1e-6 ? (r.p - 0.5) * r.contrib[k] / z : 0.25 * r.contrib[k];
    return out;
  }
  function renderStack() {
    var box = $("xrows"); if (!box || !BL) return;
    var r = BL.r, A = shortOf("A"), rows = [];
    box.textContent = "";
    var hd = el("div", "xrow xh"); hd.setAttribute("role", "row");
    ["Model", "Chance for " + A + ", 0 to 100%", "Chance", "Weight", "Moves the blend (pts toward " + A + ")"].forEach(function (h) { var x = el("span", null, h); x.setAttribute("role", "columnheader"); hd.appendChild(x); });
    box.appendChild(hd);
    var pull = pullPts(r), maxAbs = 0.05, k;
    if (r) { for (k in pull) maxAbs = Math.max(maxAbs, Math.abs(pull[k])); maxAbs = Math.max(maxAbs, Math.abs(r.p - 0.5)); }
    function track(p, big) {
      var t = el("div", "xt"); t.appendChild(el("i", "mid"));
      if (p != null) {
        var seg = el("i", "seg"); seg.style.left = Math.min(50, p * 100) + "%"; seg.style.width = Math.abs(p * 100 - 50) + "%"; t.appendChild(seg);
        var d = el("i", "dot"); d.style.left = (p * 100) + "%"; t.appendChild(d);
      }
      t.setAttribute("aria-hidden", "true"); return t;
    }
    function push(v) {
      var w = el("div", "xc");
      var bar = el("div", "xbar");
      if (v != null && isFinite(v) && Math.abs(v) > 1e-9) {
        var i = el("i", v > 0 ? "A" : "B"), wd = 50 * Math.min(1, Math.abs(v) / maxAbs);
        i.style.width = wd + "%"; i.style.left = v > 0 ? (50 - wd) + "%" : "50%"; bar.appendChild(i);
      }
      w.appendChild(bar); w.appendChild(el("span", null, v == null ? "–" : pts(v)));
      return w;
    }
    EXPERTS.forEach(function (e) {
      var key = e[0], p = key === "market" ? (BL.mk.p != null && S.line ? BL.mk.p : null) : (BL.ex[key] != null ? BL.ex[key] : null);
      var used = r && r.used.indexOf(key) >= 0;
      var row = el("div", "xrow" + (p == null ? " off" : "")); row.setAttribute("role", "row");
      var l = el("div", "xl"); l.appendChild(el("b", null, e[1])); l.appendChild(el("small", null, expertSub(key))); row.appendChild(l);
      row.appendChild(track(p));
      row.appendChild(el("span", "xp", p == null ? "–" : pct(p, 0)));
      var wt = used ? r.weights[key] : null;
      row.appendChild(el("span", "xw", p == null ? "" : (wt == null ? (r && r.ignored && r.ignored.indexOf(key) >= 0 ? "unused" : "–") : (wt < 0.005 ? "0%" : pct(wt, 0)) + (window.innerWidth <= 680 ? " weight" : ""))));
      row.appendChild(p == null ? el("span") : push(used ? pull[key] : null));
      row.setAttribute("aria-label", e[1] + ": " + (p == null ? expertSub(key) : pct(p, 0) + " for " + A + (used ? ", weight " + pct(r.weights[key], 0) + ", moves the blend " + pts(pull[key]) + " toward " + A : "")));
      box.appendChild(row); rows.push(row);
    });
    var fin = el("div", "xrow fin"); fin.setAttribute("role", "row");
    var fl = el("div", "xl"); fl.appendChild(el("b", null, "The blend")); fl.appendChild(el("small", null, r ? (BL.useLine ? "learned weights, betting line included" : "learned weights, no betting line") : "not available"));
    fin.appendChild(fl); fin.appendChild(track(BL.p));
    fin.appendChild(el("span", "xp", BL.p == null ? "–" : pct(BL.p, 0)));
    var tw = el("span", "xw tw"); if (r) { tw.appendChild(el("small", null, "Total weight")); tw.appendChild(document.createTextNode(" " + fx(r.scale, 2))); } fin.appendChild(tw);
    fin.appendChild(r ? push(r.p - 0.5) : el("span"));
    fin.setAttribute("aria-label", "The blend: " + (BL.p == null ? "not available" : pct(BL.p, 0) + " for " + A + (r ? ", total weight " + fx(r.scale, 2) : "")));
    box.appendChild(fin);
    // in plain words, next to the blend row: why it can sit outside its inputs, and the simple average for contrast
    var bf = blendFacts(r, BL.useLine), xe = el("p", "xexp");
    if (bf) {
      xe.appendChild(el("b", null, "Simple average of the " + numWord(bf.n) + " models: " + A + " " + pct(bf.avg, 0) + ". "));
      if (bf.beyond) xe.appendChild(document.createTextNode("The blend is " + (bf.beyond > 0 ? "higher" : "lower") + " than any single model (they range " + pct(bf.lo, 0) + " to " + pct(bf.hi, 0) + "): they carry partly independent evidence, and on 2024-25 fights every model was too cautious. "));
      if (Math.max(r.p, 1 - r.p) > 0.9) xe.appendChild(document.createTextNode("Very lopsided picks are rarer in the test data; treat the last few points loosely."));
      box.appendChild(xe);
    }
    // notes
    var stretch = r && Math.abs(r.z) > 1e-6 ? logit(r.p) / r.z : 1;
    $("xNote").textContent = r ? "Weight is each model's share of the blend. “Moves the blend” is how many percentage points each model pulls the blend away from 50-50 toward " + A + " (a minus pulls toward " + shortOf("B") + "); the pulls add up to the blend's lead. " +
      "Before they are shared out, the weights add up to " + fx(r.scale, 2) + " (Total weight): the models carry partly independent evidence, so together they can be more confident than any one of them." +
      (!BL.useLine && Math.abs(stretch - 1) > 0.01 ? " With no betting line the blend is then pushed a little further from 50-50 (×" + fx(stretch, 2) + "), because on recent fights every model, the market included, turned out too cautious." : "") +
      " Draws are set aside: every chance here is for a decisive result." : "The combined model's file did not load, so the headline falls back to the simulator.";
    $("stackSub").textContent = r ? r.used.length + " models · " + (BL.useLine ? "with the line" : "no line") : "";
    $("blendOut").textContent = BL.p == null ? "–" : A + " " + Math.round(100 * BL.p) + "%, " + shortOf("B") + " " + (100 - Math.round(100 * BL.p)) + "%";
    $("verdict").textContent = verdictText();
    // odds inputs and notes
    var mk = BL.mk, hasM = mk.p != null;
    ["A", "B"].forEach(function (s) {
      var inp = $("odd" + s); if (document.activeElement !== inp) inp.value = S.odds[s] || "";
      var v = parseOdds(S.odds[s]); inp.setAttribute("aria-invalid", (v != null && !isFinite(v)) || mk.bad ? "true" : "false");
    });
    $("lineTog").checked = S.line; $("lineTog").disabled = !hasM;
    var pd = pairData(S.a, S.b), note = $("oddNote"); note.textContent = "";
    if (hasM) note.appendChild(document.createTextNode("Implied " + pct(mk.ia, 1) + " and " + pct(mk.ib, 1) + " (bookmaker's margin " + pct(mk.over, 1) + "); with the margin removed, " + A + " " + pct(mk.p, 1) + ". "));
    else if (mk.bad) note.appendChild(document.createTextNode("Those two prices imply a bookmaker's margin of " + pct(mk.over, 1) + ". A real two-way line runs about 2% to 10%, so check the odds; this line is left out of the blend. "));
    else if (isNaN(mk.ia) || isNaN(mk.ib)) note.appendChild(document.createTextNode("Use American odds such as +160 or -180. "));
    else note.appendChild(document.createTextNode("No price for this pair. Enter both sides' American odds to add the market line to the blend. "));
    if (pd && pd.market && pd.market.odds && (S.odds.A === pd.market.odds[S.a] && S.odds.B === pd.market.odds[S.b])) {
      note.appendChild(document.createTextNode("Prefilled: " + pd.market.label + ". " + (pd.market.range || "") + " An opening line is less sharp than the closing line the blend was tested with. "));
      var srcs = el("span", "srcs"); srcs.style.display = "inline-flex"; linkList(srcs, pd.market.sources); note.appendChild(srcs);
    } else if (S.oddsSrc && hasM) note.appendChild(document.createTextNode("Prefilled: " + S.oddsSrc + ". "));
    // the two regimes side by side
    var rg = $("regimes"); rg.textContent = "";
    function tile(label, v, sub) { var t = el("div", "tile"); t.appendChild(el("span", "tl", label)); t.appendChild(el("b", null, v)); if (sub) t.appendChild(el("span", "tl", sub)); rg.appendChild(t); }
    var bfNo = blendFacts(BL.rNo, false), bfLine = blendFacts(BL.rLine, true);
    if (BL.rNo) tile("Blend without a line", A + " " + pct(BL.rNo.p, 0), "stats and ratings only" + (bfNo ? "; simple average " + pct(bfNo.avg, 0) : ""));
    if (BL.rLine) tile("Blend with the line", A + " " + pct(BL.rLine.p, 0), "market alone " + pct(mk.p, 0) + (bfLine ? "; simple average " + pct(bfLine.avg, 0) : ""));
    else if (BL.rNo) tile("Market line", "–", "enter odds to compare");
    var bn = "";
    if (bfNo && bfNo.beyond) bn += "Without a line the blend sits " + (bfNo.beyond > 0 ? "above" : "below") + " every single model (they range " + pct(bfNo.lo, 0) + " to " + pct(bfNo.hi, 0) + " for " + A + "): they carry partly independent evidence, and on 2024-25 fights every model was too cautious. ";
    if (BL.rNo && Math.max(BL.rNo.p, 1 - BL.rNo.p) > 0.9) bn += "Very lopsided picks are rarer in the test data; treat the last few points loosely. ";
    $("blendNote").textContent = bn + "Tested on 2024-25 fights: with a closing line the blend was level with the market to slightly better; without one it beat every single model. The backtest below has the numbers.";
    // market marker on the forecast bar
    var mkM = $("mktMark"), mkN = $("mktNote");
    if (hasM) {
      mkM.hidden = false; mkN.hidden = false; mkM.style.left = (100 * mk.p) + "%";
      $("mktNoteT").textContent = "Market: " + A + " " + pct(mk.p, 0) + " with the bookmaker's cut removed (" + (S.odds.A || "") + " / " + (S.odds.B || "") + ")" + (S.line ? "." : ", left out of the blend.");
    } else { mkM.hidden = true; mkN.hidden = true; }
  }

  /* ================================================================ ML stat-line card */
  function renderMLCard() {
    var box = $("mlCards"), lede = $("mlLede"); if (!box) return;
    box.textContent = "";
    var pred = mlPredict(prof("A"), prof("B"));
    if (!pred) { lede.textContent = MLR.pending ? "Loading the stat-line model." : (MLR.ok ? "The stat-line model could not score this pair." : "The stat-line model is not in this build (or this browser can't unpack it)."); return; }
    lede.textContent = "Per minute of fight time (all positions together), each fighter against this opponent, from a learned model trained on 2010-2025 UFC fights. On 2024-25 fights it beat the simulator's own rates on 12 of 18 stats, and feeding it to the simulator improved its winner calls. " +
      "The simulator spreads these lines over the time it expects in each position, so its rates above, counted per minute spent at distance or on top, read higher. " +
      (cur.m && cur.m.mlApplied ? "The simulator is using these lines now." : "The “Simulator uses learned stat lines” switch in the knobs panel is off, so the simulator plays from the raw UFC numbers.") + " Avg is the " + S.div.toLowerCase() + " average.";
    var base = {}; (pred.base || []).forEach(function (v, i) { base[(window.MLRates && window.MLRates.TNAMES[i]) || i] = v; });
    ["A", "B"].forEach(function (side) {
      var q = pred[side], card = el("div", "mlcard " + side);
      card.appendChild(el("h4", null, nameOf(side)));
      var t = el("table", "data"), tb = el("tbody");
      function row(label, v, avg) { var tr = el("tr"); tr.appendChild(el("td", null, label)); var td = el("td", "strong", v); tr.appendChild(td); var ta = el("td"); if (avg != null) ta.appendChild(el("small", null, "avg " + avg)); tr.appendChild(ta); tb.appendChild(tr); }
      function f1(x) { return fx(x, 1); } function f2(x) { return fx(x, 2); }
      var tot = q.d_att + q.c_att + q.g_att;
      row("Significant strikes thrown / min of fight time", f1(tot), base.d_att != null ? f1(base.d_att + base.c_att + base.g_att) : null);
      row("Head · body · legs thrown / min", f1(q.h_att) + " · " + f1(q.b_att) + " · " + f1(q.l_att), base.h_att != null ? f1(base.h_att) + " · " + f1(base.b_att) + " · " + f1(base.l_att) : null);
      row("Head · body · legs landed / min", f1(q.h_att * q.acc_h) + " · " + f1(q.b_att * q.acc_b) + " · " + f1(q.l_att * q.acc_l), base.h_att != null ? f1(base.h_att * base.acc_h) + " · " + f1(base.b_att * base.acc_b) + " · " + f1(base.l_att * base.acc_l) : null);
      row("Accuracy: head · body · legs", pct(q.acc_h, 0) + " · " + pct(q.acc_b, 0) + " · " + pct(q.acc_l, 0), base.acc_h != null ? pct(base.acc_h, 0) + " · " + pct(base.acc_b, 0) + " · " + pct(base.acc_l, 0) : null);
      row("Distance · clinch · ground thrown / min", f1(q.d_att) + " · " + f2(q.c_att) + " · " + f2(q.g_att), base.d_att != null ? f1(base.d_att) + " · " + f2(base.c_att) + " · " + f2(base.g_att) : null);
      row("Takedown attempts / 15 min", f1(q.td_att * 15), base.td_att != null ? f1(base.td_att * 15) : null);
      row("Takedown success", pct(q.td_acc, 0), base.td_acc != null ? pct(base.td_acc, 0) : null);
      row("Control time / 15 min", mmss(q.ctrl * 15), base.ctrl != null ? mmss(base.ctrl * 15) : null);
      row("Submission attempts / 15 min", f2(q.sub_att * 15), base.sub_att != null ? f2(base.sub_att * 15) : null);
      row("Knockdown chance per head strike landed, all positions", pct(q.kd_h, 2), base.kd_h != null ? pct(base.kd_h, 2) : null);
      row("Expected knockdowns / 15 min", f2(q.h_att * q.acc_h * q.kd_h * 15), base.kd_h != null ? f2(base.h_att * base.acc_h * base.kd_h * 15) : null);
      t.appendChild(tb); var w = el("div", "tbl-wrap"); w.appendChild(t); card.appendChild(w); box.appendChild(card);
    });
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
  function ci(o) { return o && o.lo != null ? "[" + sgn(o.lo) + ", " + sgn(o.hi) + "]" : ""; }
  function sgn(v) { return (v > 0 ? "+" : (v < 0 ? "−" : "")) + Math.abs(v).toFixed(4); }
  function table(head, rows, opts) {
    opts = opts || {};
    var w = el("div", "tbl-wrap"), t = el("table", "data"), th = el("thead"), hr = el("tr");
    head.forEach(function (h) { var x = el("th", null, h); x.scope = "col"; hr.appendChild(x); }); th.appendChild(hr); t.appendChild(th);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var tr = el("tr", r.cls || null);
      r.cells.forEach(function (c, i) {
        var td = el("td", r.strong ? "strong" : null);
        if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null ? "–" : c;
        if (r.span && i === 0) td.colSpan = r.span;
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb); w.appendChild(t); if (opts.caption) { var cp = el("caption", "vh", opts.caption); t.insertBefore(cp, t.firstChild); }
    return w;
  }
  function llCell(ll, best, worst) {
    var s = el("span"); var b = el("i", "llb" + (ll <= best + 1e-9 ? " hi" : ""));
    b.style.width = Math.max(2, 46 * clamp((worst - ll) / Math.max(1e-9, worst - best), 0, 1)) + "px"; s.appendChild(b);
    s.appendChild(document.createTextNode(fx(ll, 4))); return s;
  }
  // "3.0.0" -> "v3", "4.0.1" -> "v4.0.1"
  function verLabel(v) { if (!v) return null; var p = String(v).replace(/^v/, "").split("."); while (p.length > 1 && p[p.length - 1] === "0") p.pop(); return "v" + p.join("."); }
  var VERSION_WHAT = { v3: "raw UFC rates", v4: "learned stat lines inside the simulator", "v4.0.1": "v4 with refit judging and grappling levels" };
  function versionTable() {
    var d = el("div"); d.appendChild(el("h3", "mini", "Every simulator version, scored once on 2024-25 fights"));
    var list = VERS && Array.isArray(VERS.versions) ? VERS.versions : (Array.isArray(VERS) ? VERS : null);
    var sm0 = BENCH && BENCH.sim, onPage = verLabel(E.VERSION);
    if (list && list.length && list.some(function (v) { return v && (v.train || v.validation); })) {
      var est = function (M, k) { var x = M && M[k]; return x == null ? null : (typeof x === "number" ? x : (x.est != null ? +x.est : null)); };
      var anyTrain = false, nDec = 0;
      var vr = list.map(function (v) {
        var val = v.validation && v.validation.metrics ? v.validation : null, tr = v.train && v.train.metrics ? v.train : null, src = val || tr, M = src ? src.metrics : null;
        if (!val) anyTrain = true;
        if (val && val.n_decisive) nDec = val.n_decisive;
        var bl = v.blend || {}, wl = bl.market && bl.market.engine_weight, wn = bl.nomarket && bl.nomarket.engine_weight;
        var lab = verLabel(v.version) || v.version, what = VERSION_WHAT[lab], rej = !!(v.decision && v.decision.kept === false);
        return { cells: [lab + (val ? "" : " *") + (lab === onPage ? " (this page)" : "") + (rej ? " (rejected)" : "") + (what ? ": " + what : ""), pct(est(M, "acc"), 1), fx(est(M, "winLL"), 4), fx(est(M, "bin7"), 4),
          (wl == null ? "–" : pct(wl, 0)) + " / " + (wn == null ? "–" : pct(wn, 0))] };
      });
      d.appendChild(table(["Version", "Picks right", "Winner log loss", "Winner and method log loss", "Weight in the blend, with / without a line"], vr));
      d.appendChild(el("p", "small", "Lower log loss is better. Each version gets a single look at 2024-25" + (nDec ? " (" + nf.format(nDec) + " decisive fights)" : "") + "; to replace the version before it, it also has to earn weight in the blend and beat the finish model at how fights end." +
        (anyTrain ? " * marks tuning-period numbers (2019-23), shown until the version's single look is recorded." : "")));
      if (sm0 && sm0.val_plain && sm0.val_ml) d.appendChild(el("p", "small", "From the stat-line model's own report, 2024-25 (" + nf.format(sm0.n || 0) + " fights, " + (sm0.nsim || 400) + " simulations each): the v3 simulator scored " + fx(sm0.val_plain.winner_log_loss, 4) + " on raw UFC rates and " + fx(sm0.val_ml.winner_log_loss, 4) + " with the learned stat lines; pooled over 2019-2025 the lines lower its log loss by " + (sm0.pooled ? fx(-sm0.pooled.ml_minus_plain.mean, 4) : "–") + ", in all seven years."));
      return d;
    }
    var rows = [];
    if (sm0 && sm0.val_plain) rows.push({ cells: ["v3 simulator, raw UFC rates", pct(sm0.val_plain.accuracy, 1), fx(sm0.val_plain.winner_log_loss, 4)] });
    if (sm0 && sm0.val_ml) rows.push({ cells: ["v3 with the learned stat lines", pct(sm0.val_ml.accuracy, 1), fx(sm0.val_ml.winner_log_loss, 4)] });
    if (rows.length) d.appendChild(table(["Version, 2024-25 (" + nf.format(sm0.n || 0) + " fights)", "Picks right", "Winner log loss"], rows));
    else d.appendChild(el("p", "small", "The version history has not been written yet."));
    return d;
  }
  function drawReliability(box, series) {
    var W = Math.max(280, Math.min(460, Math.round(box.clientWidth || 360))), H = W * 0.86, L = 40, R = 10, T = 10, B = 34;
    var pw = W - L - R, ph = H - T - B, lo = 0.5;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Reliability chart: " + series.map(function (s) { return s[0] + " " + s[1].map(function (b) { return "predicted " + pct(b.pred, 0) + " actual " + pct(b.obs, 0); }).join("; "); }).join(". ") });
    function X(v) { return L + pw * (v - lo) / (1 - lo); } function Y(v) { return T + ph - ph * (v - lo) / (1 - lo); }
    [0.5, 0.6, 0.7, 0.8, 0.9, 1].forEach(function (v) {
      svg.appendChild(svgEl("line", { x1: X(lo), x2: X(1), y1: Y(v), y2: Y(v), stroke: "var(--line)", "stroke-width": 1 }));
      svgText(svg, L - 6, Y(v) + 4, Math.round(v * 100) + "%", { "text-anchor": "end", "font-size": 10.5, fill: "var(--muted)" });
      svgText(svg, X(v), H - 16, Math.round(v * 100) + "%", { "text-anchor": "middle", "font-size": 10.5, fill: "var(--muted)" });
    });
    svgText(svg, L + pw / 2, H - 2, "Predicted chance for the favorite", { "text-anchor": "middle", "font-size": 11, fill: "var(--ink-2)" });
    svg.appendChild(svgEl("line", { x1: X(lo), y1: Y(lo), x2: X(1), y2: Y(1), stroke: "var(--axis)", "stroke-width": 1.5 }));
    var maxN = 1; series.forEach(function (s) { s[1].forEach(function (b) { maxN = Math.max(maxN, b.n || 1); }); });
    series.forEach(function (s) {
      var pts2 = s[1].filter(function (b) { return b.pred != null && b.obs != null && (b.n || 0) >= 10; }).map(function (b) { return [b.pred, b.obs, b.n || 1]; });
      if (pts2.length > 1) svg.appendChild(svgEl("polyline", { points: pts2.map(function (p) { return X(p[0]) + "," + Y(Math.max(lo, p[1])); }).join(" "), fill: "none", stroke: s[2], "stroke-width": 2, "stroke-linejoin": "round" }));
      pts2.forEach(function (p) { svg.appendChild(svgEl("circle", { cx: X(p[0]), cy: Y(Math.max(lo, p[1])), r: 3 + 5 * Math.sqrt(p[2] / maxN), fill: s[2], stroke: "var(--surface)", "stroke-width": 2 })); });
    });
    box.textContent = ""; box.appendChild(svg);
  }
  function simulatorAlone() {
    var d = el("div");
    var mods = CALIB ? findModels() : null;
    if (!mods) return d;
    var cv = verLabel(BENCH && BENCH.calib_version || calibGet(["version", "meta.engine_version", "engine_version"])) || "v3";
    d.appendChild(el("h3", "mini", "Older check: the " + cv + " simulator's calibration run"));
    var M = mods.models, rows = [["Simulator " + cv, M.engine], ["Elo", M.elo], ["Simulator + Elo, an early blend", M.blend], ["More UFC wins", M.naive], ["Coin flip", M.coin]].filter(function (r) { return r[1]; });
    d.appendChild(table(["Fights from 2024 on", "Picks right", "Log loss", "Fights"], rows.map(function (r) {
      var o = r[1], ll = metric(o, ["log_loss", "logloss", "ll"]), n = metric(o, ["n"]) || mods.n;
      return { cells: [r[0], pct(metric(o, ["accuracy", "acc"]), 1), fx(ll, 4), n ? nf.format(n) : "–"] };
    })));
    d.appendChild(el("p", "small", "Older check, includes 2026 fights; not used for any choice. It scored the " + cv + " simulator on fights from Jan 2024 to Oct 2026, with neutral knobs, before the 2026 fights were sealed away. The scoreboard above covers 2024-25 only."));
    return d;
  }
  function renderBacktest() {
    var box = $("btBody"); box.textContent = "";
    box.appendChild(el("p", "lede", "Every number here is out of sample: each fight is predicted from what was known the day before, by models that never saw it. Picks right is the share of fights where the model's favorite won. Log loss also rewards confidence when it is right and punishes it when it is wrong; lower is better, a coin flip scores 0.693, and a few thousandths is a real difference at this level."));
    var grid = el("div", "bt-grid"), c1 = el("div", "bt-col"), c2 = el("div", "bt-col");
    grid.appendChild(c1); grid.appendChild(c2); box.appendChild(grid);
    // the protocol, plainly
    c1.appendChild(el("h3", "mini", "How the testing works"));
    var ol = el("ol", "proto");
    [["Tuning years, 2019-2023.", " Every model, weight and setting was fit or tuned on these fights only."],
      ["Test years, 2024-2025.", " Used only to choose between versions. The scoreboard below comes from here."],
      ["A sealed vault, 2026.", " Every fight from Jan 1, 2026 on (about 370) is kept apart from the project. Nothing is tuned or scored on it; an independent auditor opens it once at milestones."],
      ["The forward test.", " Before each upcoming card the current picks are committed with a timestamp, so they provably came first. They are scored after the fights (see the next panel)."]
    ].forEach(function (x) { var li = el("li"), sp = el("span"); sp.appendChild(el("b", null, x[0])); sp.appendChild(document.createTextNode(x[1])); li.appendChild(sp); ol.appendChild(li); });
    c1.appendChild(ol);
    // one scoreboard: 2024-25 test fights
    if (BENCH && BENCH.singles) {
      c1.appendChild(el("h3", "mini", "Scoreboard, 2024-25 test fights"));
      var sg = BENCH.singles, rowsB = [], ev = verLabel(BENCH.engine_version) || "v3";
      if (BENCH.line && BENCH.line.moe) rowsB.push(["The blend, with the closing line", BENCH.line.moe.est, BENCH.line.n, true, BENCH.line.acc]);
      if (sg.market) rowsB.push(["Market closing line alone", sg.market.ll, sg.market.n, false, sg.market.acc]);
      if (BENCH.noline) rowsB.push(["The blend, no line", BENCH.noline.ll, BENCH.noline.n, true, BENCH.noline.acc]);
      [["ml", "ML model"], ["feat_lr", "Feature model"], ["mkt_rating", "Market rating"], ["engine", "Simulator " + ev + " (the version the blend's weights were fit with)"], ["elo_sig", "Strike-share Elo"], ["elo", "Elo"]].forEach(function (k) { if (sg[k[0]]) rowsB.push([k[1], sg[k[0]].ll, sg[k[0]].n, false, sg[k[0]].acc]); });
      rowsB.push(["Coin flip", Math.log(2), null, false, 0.5]);
      var best = Math.min.apply(null, rowsB.map(function (r) { return r[1]; })), worst = Math.log(2);
      c1.appendChild(table(["Model", "Picks right", "Log loss", "Fights"], rowsB.map(function (r) { return { strong: r[3], cells: [r[0], r[4] != null ? pct(r[4], 1) : "–", llCell(r[1], best, worst), r[2] ? nf.format(r[2]) : "–"] }; }), { caption: "Picks right and log loss on 2024-25 test fights" }));
      var ul = el("ul", "caveats"), L = BENCH.line || {}, NL = BENCH.noline || {}, CV = BENCH.noline_cv || {};
      if (L.diff) ul.appendChild(el("li", null, "With a line, the blend's log loss beat the closing line's on 2024-25 by " + fx(-L.diff.est, 4) + " (95% interval " + ci(L.diff) + "), but it was level in the 2021-23 checks" + (L.cv_2021_2023 ? " (" + sgn(L.cv_2021_2023.est) + " " + ci(L.cv_2021_2023) + ")" : "") + ". Pooled over every out-of-sample year, 2021-2025" + (L.pooled_n ? " (" + nf.format(L.pooled_n) + " fights)" : "") + ", it is " + (L.pooled_2021_2025 ? sgn(L.pooled_2021_2025.est) + " " + ci(L.pooled_2021_2025) : "–") + ": level with the market to slightly better, not a reliable edge."));
      if (NL.vs_best) ul.appendChild(el("li", null, "Without a line it beats every single model: " + fx(-NL.vs_best.est, 4) + " lower log loss than the best one (the ML model) on 2024-25 " + ci(NL.vs_best) + (CV.moe_minus_ml ? ", and " + fx(-CV.moe_minus_ml.est, 4) + " lower in the 2021-23 checks " + ci(CV.moe_minus_ml) : "") + "."));
      ul.appendChild(el("li", null, "The simulator gets little weight because on its own it trails the learned models; for the winner it added nothing beyond them. Its job is the how: methods, rounds, the story of a fight."));
      if (BENCH.line && BENCH.line.acc == null) ul.appendChild(el("li", null, "Picks right for the blend with a line is not shown: the reports scored it only on a slightly different set of fights."));
      c1.appendChild(ul);
    }
    // everything else in one place, collapsed: the source reports, every version, the older calibration run
    var more = el("details", "more"), msum = el("summary", null, "More checks: the source reports, every simulator version, an older calibration run");
    more.appendChild(msum); var mb = el("div", "dbody"); more.appendChild(mb);
    if (BENCH && BENCH.since2024 && BENCH.since2024.length) {
      var per = BENCH.since_periods || {}, both25 = /2025-12-31/.test(String(per.market || "")) && /2025-12-31/.test(String(per.ml || ""));
      var sd = el("div"); sd.appendChild(el("h3", "mini", both25 ? "From the source reports, 2024-25" : "Benchmarks on fights from 2024 on"));
      var R2 = BENCH.since2024, b2 = Math.min.apply(null, R2.map(function (r) { return r.ll; }));
      sd.appendChild(table(["Model", "Picks right", "Log loss", "Fights"], R2.map(function (r) { return { cells: [r.label, pct(r.acc, 1), llCell(r.ll, b2, Math.log(2)), r.n ? nf.format(r.n) : "–"] }; })));
      sd.appendChild(el("p", "small", both25 ? "As the market and ML reports score them (test fights Jan 2024 to Dec 2025; both reports leave the 2026 vault out). The numbers differ slightly from the scoreboard because each report keeps the fights it can price or rate (843 rather than 844 for the closing line, for example)." :
        "As the market and ML reports score them. Test periods: market " + (per.market || "?") + "; ML " + (per.ml || "?") + "."));
      mb.appendChild(sd);
    }
    mb.appendChild(versionTable());
    mb.appendChild(simulatorAlone());
    c1.appendChild(more);
    // reliability
    var cal = BENCH && BENCH.calibration;
    if (cal && (cal.moe_market || cal.moe_nomarket)) {
      c2.appendChild(el("h3", "mini", "Reliability, 2024-25: when it says 70%, does the favorite win 70%?"));
      var series = [];
      if (cal.moe_market) series.push(["Blend, with the line", cal.moe_market, "var(--s1)"]);
      if (cal.moe_nomarket) series.push(["Blend, no line", cal.moe_nomarket, "var(--s2)"]);
      if (cal.market) series.push(["Market closing line", cal.market, "var(--s3)"]);
      var cb = el("div", "chart relchart"); c2.appendChild(cb); drawReliability(cb, series);
      var lg = el("div", "bt-legend"); series.forEach(function (s) { var x = el("span"), i = el("i"); i.style.background = s[2]; x.appendChild(i); x.appendChild(document.createTextNode(s[0])); lg.appendChild(x); });
      lg.appendChild(el("span", null, "Diagonal: perfect calibration. Dot size: number of fights.")); c2.appendChild(lg);
      var det = el("details", "more"), sm = el("summary", null, "Reliability as a table"); det.appendChild(sm);
      var rr = [];
      series.forEach(function (s) { s[1].forEach(function (b) { rr.push({ cells: [s[0], Math.round(b.lo * 100) + "-" + Math.round(b.hi * 100) + "%", pct(b.pred, 1), pct(b.obs, 1), nf.format(b.n)] }); }); });
      det.appendChild(table(["Model", "Bin", "Predicted", "Actual", "Fights"], rr)); c2.appendChild(det);
      c2.appendChild(el("p", "small", "Points above the diagonal mean the favorite won more often than predicted. In 2024-25 every input, the market included, was too cautious; the blend on this page is refit with recent fights weighted up to correct for it."));
    }
    var cvt = el("div"); cvt.id = "btCaveats"; c2.appendChild(cvt); renderCaveats();
  }
  // pair-specific cautions: moving up a weight class, little UFC data
  function pairCaveats() {
    var out = [], m = cur.m; if (!m || !m.fac) return out;
    ["A", "B"].forEach(function (s, i) {
      var f = m.fac[i], R = m.R && m.R[i];
      if (f && f.lbsUp >= 5) out.push(nameOf(s) + " moves up " + Math.round(f.lbsUp) + " lb from " + pron(s).his + " home division here. Fighters moving up are rarer in the data, and champions moving up rarer still, so none of these models says much about " + shortOf(s) + " at " + (divLbs(S.div) || "this weight") + " lb specifically.");
      if (R && R.min != null && R.min < 45) out.push(nameOf(s) + " has little UFC data (about " + Math.round(R.min) + " recency-weighted minutes), so the models lean on division averages and, when you enter one, the betting line.");
    });
    return out;
  }
  function renderCaveats() {
    var d = $("btCaveats"); if (!d) return; d.textContent = "";
    d.appendChild(el("h3", "mini", "Read with care"));
    var ul = el("ul", "caveats");
    ["The blend on this page is refit on 2019-2025 with recent fights weighted up, so it is sharper than the tested one. If 2026 fights look more like 2019-2023 than 2024-25, that costs it some accuracy; the forward test will tell.",
      "Scenario presets and knobs change the simulator, not the blend. They are judgment calls the backtest can't check.",
      "Fighters with little UFC data are pulled hard toward their division average, so debut and early-career predictions lean on the market."].concat(pairCaveats()).forEach(function (t) { ul.appendChild(el("li", null, t)); });
    d.appendChild(ul);
  }
  /* ================================================================ forward test */
  function divFor(wc, sa, sb) { return DIVS.indexOf(wc) >= 0 ? wc : defaultDivision(sa, sb); }
  function liveForward(b, date) {
    var sa = b.a && b.a.slug, sb = b.b && b.b.slug;
    if (!MOE || !sa || !sb || !DB.fighters[sa] || !DB.fighters[sb]) return null;
    var ctx = { division: divFor(b.wc, sa, sb), rounds: b.rounds || 3, title: !!b.title, date: date };
    var X = expertsFor(sa, sb, DB.fighters[sa], DB.fighters[sb], ctx);
    if (!Object.keys(X.experts).length) return null;
    try { var r = MOE.predict({ experts: X.experts, gate: window.MoE.gateFromSides(X.A, X.B, { division: ctx.division, rounds: ctx.rounds }) }); return { p: r.p, n: r.used.length, ctx: ctx }; }
    catch (e) { return null; }
  }
  function fmtOdds(v) { return v == null ? "" : (v > 0 ? "+" + v : String(v)); }
  function loadBout(b, ev) {
    var sa = b.a.slug, sb = b.b.slug; if (!DB.fighters[sa] || !DB.fighters[sb]) return;
    S.a = sa; S.b = sb; applyPairDefaults();
    S.div = divFor(b.wc, sa, sb); S.rounds = b.rounds === 5 ? 5 : 3; S.title = !!b.title;
    if (b.mkt && b.mkt.oa != null && b.mkt.ob != null) { S.odds = { A: fmtOdds(b.mkt.oa), B: fmtOdds(b.mkt.ob) }; S.oddsSrc = "consensus odds snapshot" + (FWD && FWD.odds && FWD.odds.utc ? " of " + fmtDate(FWD.odds.utc.slice(0, 10)) : "") + " for " + ev.name; }
    matchupChanged(true);
    var mb = document.querySelector(".matchbar"); if (mb && mb.scrollIntoView) mb.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  function renderForward() {
    var box = $("fwBody"); if (!box) return; box.textContent = "";
    if (!FWD || !FWD.events || !FWD.events.length) { box.appendChild(el("p", "small", "No upcoming cards in this build.")); return; }
    var nB = 0, nPick = 0, nAgree = 0, nBoth = 0, scored = [], rowsOut = [];
    FWD.events.forEach(function (ev) {
      ev.bouts.forEach(function (b) {
        nB++;
        var live = liveForward(b, ev.date); b._live = live;
        if (live) nPick++;
        if (live && b.mkt && b.mkt.p != null) { nBoth++; if ((live.p > 0.5) === (b.mkt.p > 0.5)) nAgree++; }
        var res = b.result, led = b.ledger;
        if (res && res.outcome === "win" && led && led.p_a != null) {
          var pw = res.winner === "a" ? led.p_a : 1 - led.p_a, mk = b.mkt ? (res.winner === "a" ? b.mkt.p : 1 - b.mkt.p) : null;
          scored.push({ ll: -Math.log(clamp(pw, 1e-6, 1)), mll: mk != null ? -Math.log(clamp(mk, 1e-6, 1)) : null, hit: pw > 0.5 ? 1 : (pw === 0.5 ? 0.5 : 0) });
        }
      });
    });
    $("fwSub").textContent = "Cards as of " + fmtDate(String(FWD.as_of || "").slice(0, 10)) + (FWD.odds && FWD.odds.utc ? " · odds " + fmtDate(FWD.odds.utc.slice(0, 10)) : "");
    var evs = FWD.events, d0 = evs[0].date, d1 = evs[evs.length - 1].date;
    function md(iso) { var p = String(iso).split("-"); return (MONTHS[+p[1] - 1] || p[1]) + " " + (+p[2]); }
    var lede = el("p", "lede", "The model's pick for every announced bout on the next " + numWord(evs.length) + " cards (" + md(d0) + " to " + md(d1) + "), next to the betting market. These picks are computed live in your browser from the blend without a betting line, so the two can be compared (the simulator is left out to keep the page quick). The record that counts is the ledger: before each card the current picks are committed with a timestamp, and once results land this panel scores those picks against the market.");
    box.appendChild(lede);
    var sumBox = el("div", "fw-sum");
    function tile(l, v) { var t = el("div", "tile"); t.appendChild(el("span", "tl", l)); t.appendChild(el("span", "tv", v)); sumBox.appendChild(t); }
    tile("Bouts on " + evs.length + " cards", String(nB));
    tile("With a model pick", String(nPick));
    tile("Same favorite as the market", nBoth ? nAgree + " of " + nBoth : "–");
    if (scored.length) {
      var ll = 0, mll = 0, nm = 0, hit = 0; scored.forEach(function (s) { ll += s.ll; hit += s.hit; if (s.mll != null) { mll += s.mll; nm++; } });
      tile("Scored: picks right, and log loss model vs market", pct(hit / scored.length, 0) + " · " + fx(ll / scored.length, 3) + (nm ? " vs " + fx(mll / nm, 3) : ""));
    } else tile("Scored so far", "None yet");
    box.appendChild(sumBox);
    if (!scored.length) box.appendChild(el("p", "small", FWD.n_ledger ? "Picks are in the ledger; the first scores come once those fights are done." :
      "Ledger starts with the " + md(d0) + " card; first scores after it."));
    var key = el("div", "fw-key");
    var k1 = el("span"); k1.appendChild(el("i", "md")); k1.appendChild(document.createTextNode("Model's chance for the first-named fighter")); key.appendChild(k1);
    var k2 = el("span"); k2.appendChild(el("i", "mt")); k2.appendChild(document.createTextNode("Market, with the bookmaker's cut removed")); key.appendChild(k2);
    key.appendChild(el("span", null, "Strip runs 0 to 100%; the middle line is 50-50."));
    box.appendChild(key);
    FWD.events.forEach(function (ev) {
      var wrap = el("div", "fw-ev"), hd = el("div", "fw-eh");
      hd.appendChild(el("h3", null, ev.name)); hd.appendChild(el("span", null, fmtDate(ev.date) + (ev.loc ? " · " + String(ev.loc).split(",")[0] : "") + (ev.status && ev.status !== "official" ? " · not yet official" : "")));
      wrap.appendChild(hd);
      ev.bouts.forEach(function (b) {
        var row = el("div", "fw-row"), live = b._live, pA = live ? live.p : null;
        var nm = el("div", "fw-names");
        var an = el("span", pA != null && pA >= 0.5 ? "pick" : null, b.a.name), bn = el("span", pA != null && pA < 0.5 ? "pick" : null, b.b.name);
        nm.appendChild(an); nm.appendChild(el("span", "vs", "vs")); nm.appendChild(bn);
        var meta = [b.wc, (b.rounds || 3) + " rds", b.title ? "title" : null, b.order === 1 ? "main event" : null].filter(Boolean).join(" · ");
        var mt = el("span", "fw-meta", meta); nm.appendChild(mt);
        if (b.status && b.status !== "official") mt.appendChild(el("span", "fw-flag", String(b.status).replace(/rumoured/i, "rumored")));
        if (!b.a.slug || !b.b.slug) mt.appendChild(el("span", "fw-flag", "UFC debut"));
        else if (!live) mt.appendChild(el("span", "fw-flag", "no profile"));
        row.appendChild(nm);
        var bar = el("div", "fw-bar");
        if (pA != null) {
          // a 0-100 strip for the first-named fighter: the model's dot and the market's gold tick
          var tr = el("div", "fw-strip"); tr.appendChild(el("i", "mid"));
          if (b.mkt && b.mkt.p != null) { var u = el("i", "mt"); u.style.left = (b.mkt.p * 100) + "%"; tr.appendChild(u); }
          var dt = el("i", "md"); dt.style.left = (pA * 100) + "%"; tr.appendChild(dt);
          tr.setAttribute("role", "img"); tr.setAttribute("aria-label", "Model: " + b.a.name + " " + pct(pA, 0) + (b.mkt && b.mkt.p != null ? "; market " + pct(b.mkt.p, 0) : ""));
          bar.appendChild(tr);
          var nums = el("div", "fw-nums"), fav = pA >= 0.5 ? lastName(b.a.name) : lastName(b.b.name);
          nums.appendChild(el("span", null, "Model: " + fav + " " + pct(Math.max(pA, 1 - pA), 0)));
          nums.appendChild(el("span", null, b.mkt && b.mkt.p != null ? "Market " + (b.mkt.p >= 0.5 ? lastName(b.a.name) : lastName(b.b.name)) + " " + pct(Math.max(b.mkt.p, 1 - b.mkt.p), 0) : "No odds yet"));
          bar.appendChild(nums);
        } else {
          bar.appendChild(el("span", "fw-res", b.mkt && b.mkt.p != null ? "Market: " + (b.mkt.p >= 0.5 ? lastName(b.a.name) : lastName(b.b.name)) + " " + pct(Math.max(b.mkt.p, 1 - b.mkt.p), 0) + " · no model pick" : "No model pick and no odds yet"));
        }
        row.appendChild(bar);
        var rs = el("div", "fw-res");
        if (!b.result && !b.ledger) { /* nothing to show until the ledger or a result exists */ }
        else if (b.result && b.result.outcome) {
          var w = b.result.winner === "a" ? b.a.name : (b.result.winner === "b" ? b.b.name : null);
          rs.appendChild(el("b", null, b.result.outcome === "win" && w ? lastName(w) + " won" : b.result.outcome));
          if (b.result.method) rs.appendChild(document.createTextNode(" · " + b.result.method + (b.result.round ? " R" + b.result.round : "")));
          if (!b.ledger) rs.appendChild(el("span", "fw-meta", "not in the ledger, so not scored"));
        } else rs.appendChild(document.createTextNode("Pick committed (" + (b.ledger.model || "ledger") + ")"));
        row.appendChild(rs);
        var go = el("div", "fw-go");
        if (live) {
          var btn = el("button", "btn ghost", "Simulate this"); btn.type = "button"; btn.setAttribute("aria-label", "Simulate " + b.a.name + " vs " + b.b.name);
          btn.addEventListener("click", function () { loadBout(b, ev); }); go.appendChild(btn);
        }
        row.appendChild(go);
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    });
    box.appendChild(el("p", "small", "Model: the blend without a betting line; the bold name is its pick. Market: the consensus price across bookmakers in the latest odds snapshot, with the bookmaker's cut removed. Bouts with a UFC debutant or a fighter outside the roster get no model pick."));
  }

  /* ================================================================ research section visibility */
  var researchWasDefault = null;
  function renderResearch() {
    var isDefault = (S.a === "alexander-volkanovski" && S.b === "justin-gaethje") || (S.b === "alexander-volkanovski" && S.a === "justin-gaethje");
    $("researchNote").textContent = isDefault ? "Headline facts for this matchup, checked against the sources linked under each card. Fighters are described as their own coverage describes them." :
      "These notes cover the default matchup, Volkanovski vs Gaethje at lightweight, so they are folded away. For " + nameOf("A") + " and " + nameOf("B") + ", see the scouting notes in the tale of the tape.";
    // collapse the default pair's research when another pair is on; open it again when the default pair comes back
    var det = $("researchDet");
    if (det && researchWasDefault !== isDefault) det.open = isDefault;
    researchWasDefault = isDefault;
    renderCaveats();
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
    node(120, 70, 168, 44, "Distance", "strikes by target"); node(120, 230, 168, 44, "Clinch", "one fighter controls");
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
      script.rounds.push({ r: ri, beats: beats, endT: endT, judges: rd.judges || null, ded: rd.ded || null, stoppage: rd.stoppage || null, fin: rd.fin, st: rd.st,
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
    // no likeness sheet and no written hair notes: a generic figure, so vary hair length and colour by a hash of the slug
    // (stable for each fighter) instead of giving every such fighter the same head; nothing else is guessed
    if (!lk && !app.hair && !app.hair_color) {
      var h = hashStr(slug), fem = /^Women/.test(p.division || S.div || "");
      var styles = fem ? ["hair tied back in a ponytail", "braided hair tied back", "hair in a bun", "short crop"] :
        ["short hair, short on the sides", "buzz cut", "short crop", "medium-length hair, swept back", "shaved head", "high and tight fade"];
      var cols = ["#1b1410", "#2a1d14", "#3b2a1e", "#4a3426", "#6b4a33", "#141110"];
      app.hair = styles[h % styles.length]; app.hair_color = cols[(h >>> 8) % cols.length];
      app.generic = true;
    }
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
      var parts = formWords(fm);
      parts.forEach(function (q) {
        var w = el("span", "fm"); w.title = q.tip;
        var ar = el("i", null, (q.up ? "▲" : "▼").repeat(q.lv)); ar.setAttribute("aria-hidden", "true"); w.appendChild(ar);
        w.appendChild(document.createTextNode(q.word)); w.appendChild(el("span", "vh", " (" + q.tip + ")"));
        c.appendChild(w);
      });
      if (!parts.length) c.appendChild(el("span", "fm", "about as usual"));
      c.title = "Tonight's draw of " + nameOf(s) + "'s form, against the numbers the simulator plays from. ▲ is a better night than usual, ▼ a worse one; more arrows, a bigger swing. Hover a word for the number.";
      form.appendChild(c);
    });
  }
  // fight-night form in words: up to three arrows for the size of the swing, the multiplier in the tooltip
  // (the engine reports chin and cardio so that above 1 is sturdier and fresher)
  var FORM_WORDS = [["out", "busier", "quieter", "output"], ["acc", "sharper", "less accurate", "accuracy"], ["pow", "hits harder", "hits lighter", "power"],
    ["chin", "harder to drop", "easier to drop", "knockdown resistance"], ["cardio", "fresher", "tires sooner", "cardio"]];
  function formWords(fm) {
    var out = [];
    FORM_WORDS.forEach(function (d) {
      var v = fm[d[0]]; if (v == null || !isFinite(v) || v <= 0) return;
      var a = Math.abs(Math.log(v)); if (a < Math.log(1.08)) return;
      out.push({ up: v > 1, lv: a < Math.log(1.25) ? 1 : (a < Math.log(1.6) ? 2 : 3), word: v > 1 ? d[1] : d[2], tip: d[3] + " ×" + fx(v) + " tonight (" + signedPct(v) + ")", a: a });
    });
    return out;
  }
  function hudApply(e) {
    var w = e.w, c = H.cur[w];
    if (e.t > H.lastT && H.owner) H.cur[H.owner].ctrl += e.t - H.lastT;
    H.lastT = Math.max(H.lastT, e.t);
    var k = e.k;
    if (k === "miss" || k === "hit" || k === "hurt" || k === "kd" || k === "fin") {
      c.att++;
      if (k !== "miss") { c.lnd++; c.land[e.loc === "ground" ? 3 : (e.tg || 0)]++; }
      // a one-shot KO is traced only as its "fin" event, but the engine counts it as a knockdown in the round's totals
      if (k === "kd" || (k === "fin" && e.how === "KO")) c.kd++;
      if (k === "hurt") c.hurt++;
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
      if (camHold && (r > 0 || t > 4)) { camHold = false; if (camChoice === "auto" && show && show.cam) show.cam.mode = "auto"; }
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
      if (rd.ded) ["A", "B"].forEach(function (w, i) {   // engine v4.0.1: point deductions for fouls (already in the round's scores)
        if (rd.ded[i] > 0) addPbp(r, null, "Referee takes " + (rd.ded[i] > 1 ? rd.ded[i] + " points" : "a point") + " from " + nameOf(w) + " for a foul.", "rnd");
      });
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
      if (H) {
        var f = H.f; for (var rr = H.r; rr < f.rounds.length; rr++) hudSync(rr, f.rounds[rr].fin ? f.rounds[rr].fin.t : 300);
        // end exactly on the engine's totals, the finishing round included
        if (f.rounds.every(function (x) { return x.st; })) { H.base = { A: zc(), B: zc() }; f.rounds.forEach(function (x) { addRoundTotals(H.base, x.st); }); H.cur = { A: zc(), B: zc() }; H.idx = 1e9; H.owner = null; }
        renderStats();
      }
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
    if (textMode) $("poster").hidden = true;
    sizeStage();
    if (window.ResizeObserver) new ResizeObserver(sizeStage).observe(stage); else window.addEventListener("resize", sizeStage);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }, { threshold: 0.05 }).observe(stage);
    if (!textMode && document.fonts && document.fonts.load) {
      document.fonts.load('900 64px "Big Shoulders Display"').then(function () { try { show.arena.repaintMat(); } catch (e) { /* older arena */ } }, function () {});
    }
    var spd = $("speedSeg").querySelector('[aria-pressed="true"]'); if (spd) show.speed = +spd.dataset.speed;
    show.replays = $("replayTog").checked;
    window.VGSim = { show: show, newFight: newFight };
    audioAttach();
  }

  /* ---- broadcast sound (src/audio.js, FightAudio): off until the viewer turns it on (FightAudio remembers the choice per
     viewer); FightAudio creates its audio context on the first click or key press after that, as browsers require */
  var AU = { api: null, on: false, unlocked: false };
  function audioAttach() {
    var FA = window.FightAudio;
    AU.api = null;
    if (FA && typeof FA.attach === "function" && FA.supported !== false && show && !textMode) {
      try { var r = FA.attach(show); AU.api = r && typeof r === "object" ? r : (r === false ? null : FA); } catch (e) { AU.api = null; }
    }
    $("sndWrap").hidden = !AU.api;
    if (AU.api) { AU.on = typeof AU.api.isEnabled === "function" ? !!AU.api.isEnabled() : false; $("soundTog").checked = AU.on; audioApply(); }
  }
  function audioApply() {
    var a = AU.api, on = AU.on; if (!a) return;
    try {
      if (typeof a.setEnabled === "function") a.setEnabled(on);
      else if (typeof a.setMuted === "function") a.setMuted(!on);
      else if (typeof a.mute === "function" && typeof a.unmute === "function") { if (on) a.unmute(); else a.mute(); }
    } catch (e) { /* sound is optional */ }
  }
  function audioUnlock() {
    if (AU.unlocked || !AU.api) return;
    AU.unlocked = true;
    try { if (typeof AU.api.unlock === "function") AU.api.unlock(); else if (typeof AU.api.resume === "function") AU.api.resume(); } catch (e) { /* ignore */ }
  }
  document.addEventListener("pointerdown", function first() { if (!AU.api) return; document.removeEventListener("pointerdown", first, true); audioUnlock(); }, true);
  function newFight() {
    clearTimeout(autoNext);
    if (!show || !cur.m) return;
    var sd, f;
    try { var pk = pickFight(); sd = pk.seed; f = E.simulate(cur.m, E.makeRng(sd), true); }
    catch (e) { addPbp(0, null, "The simulator couldn't play this fight: " + e.message, "big"); return; }
    script = buildScript(f, sd);
    if (show && !textMode && show.cam && camChoice === "auto") { show.cam.mode = "broadcast"; camHold = true; }   // open on the wide shot
    resetHud(f, script);
    try { show.load(script); } catch (e) {
      // a show that can't take this script: fall back to the play-by-play
      show = new TextShow(hooks); textMode = true; $("noGl").hidden = false; $("camLabel").hidden = true; show.load(script);
      $("sndWrap").hidden = true;
    }
    if (window.VGSim) window.VGSim.show = show;
  }
  /* The cage plays one simulated fight, but its winner follows the headline odds: draw the winner from the headline
     (blue, draw, red), then try seeds until the simulator's fight has that winner, up to 40 tries. The search runs
     without the event trace (the same seed replays the identical fight with it), so 40 tries cost a few milliseconds. */
  var CAGE_TRIES = 40, lastPick = null;
  function pickFight() {
    var H0 = BL && BL.head, seed = newSeed();
    if (!H0 || !isFinite(H0.pA) || !isFinite(H0.pB)) { lastPick = { seed: seed, want: null, tries: 1 }; return lastPick; }
    var u = newSeed() / 4294967296, pD = H0.pD || 0, want = u < H0.pA ? "A" : (u < H0.pA + pD ? "D" : "B"), s = seed, i;
    for (i = 0; i < CAGE_TRIES; i++) {
      s = i ? newSeed() : seed;
      if (E.simulate(cur.m, E.makeRng(s), false).winner === want) { lastPick = { seed: s, want: want, tries: i + 1, hit: true }; return lastPick; }
    }
    lastPick = { seed: s, want: want, tries: CAGE_TRIES, hit: false };
    return lastPick;
  }
  // camera: the viewer's choice; Auto opens each fight on the wide shot, then hands back to the auto director
  var camChoice = "auto", camHold = false;
  var CAM_NAMES = { Broadcast: "Wide", "Cage-side": "Cage", Overhead: "High", Free: "Free", Replay: "Replay", "Close-up": "Close-up", Center: "Center" };
  function camText(label) { var n = CAM_NAMES[label] || label || ""; return camChoice === "auto" ? "Auto · " + n : n; }
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
      if (!textMode && show.cam && show.cam.label + camChoice !== lastLabel) { lastLabel = show.cam.label + camChoice; $("camLabel").textContent = camText(show.cam.label); }
    }
    posterCheck();
    requestAnimationFrame(loop);
  }
  // the poster ("Building the fighters...") stays up until both skinned fighters are in, or 12 s at most
  var posterT0 = 0;
  function posterCheck() {
    var po = $("poster"); if (!po || po.hidden) return;
    if (!posterT0) posterT0 = performance.now();
    var ready = textMode || !show || show.avatarsOn === false || !show.A || (show.A.avatar && show.B.avatar);
    if (ready || performance.now() - posterT0 > 12000) po.hidden = true;
  }

  /* ================================================================ wiring */
  function matchupChanged(fightNow) {
    buildMatchup(); dropEngine();
    var fb = $("linkFb"); if (fb) fb.hidden = true;
    renderMatchbar(); renderTape(); renderChips(); renderKnobPanel(); renderWhy(); renderForecast(); renderMLCard(); renderResearch();
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
      // a title fight is five rounds: picking three rounds makes it a non-title fight
      b.addEventListener("click", function () { var r = +b.dataset.r; if (r === S.rounds) return; S.rounds = r; if (r === 3) S.title = false; matchupChanged(true); });
    });
    $("chkTitle").addEventListener("change", function () { S.title = this.checked; if (S.title) S.rounds = 5; matchupChanged(true); });
    // inside the artifact frame location.href is the sandbox's address, not the artifact link, so copy only the matchup tag
    // (#...) and show it in a read-only field, selected, with how to use it
    $("btnLink").addEventListener("click", function () {
      writeHash();
      var tag = hashFor(), btn = this, fb = $("linkFb"), fin = $("linkFbIn"), lab = fb.querySelector("label");
      function done(ok) {
        btn.textContent = ok ? "Copied" : "Copy link to this matchup";
        if (ok) setTimeout(function () { btn.textContent = "Copy link to this matchup"; }, 1800);
        lab.textContent = ok ? "Copied. Add this to the end of the artifact link:" : "Copying didn't work here. Add this to the end of the artifact link:";
        fin.value = tag; fb.hidden = false;
        try { fin.focus(); fin.select(); } catch (e) { /* ignore */ }
      }
      try { navigator.clipboard.writeText(tag).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    });
    $("btnDek").addEventListener("click", function () { $("dek").classList.add("open"); this.setAttribute("aria-expanded", "true"); });
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
      $("odd" + s).addEventListener("input", function () { S.odds[s] = this.value.trim(); S.oddsSrc = null; renderForecast(); });
    });
    $("lineTog").addEventListener("change", function () { S.line = this.checked; renderForecast(); });
    $("mlTog").checked = S.ml; $("mlTog").disabled = !MLR.ok && !MLR.pending;
    $("mlTog").addEventListener("change", function () { S.ml = this.checked; buildMatchup(); dropEngine(); renderWhy(); renderKnobPanel(); renderMLCard(); renderForecast(); queueTally(true); });
    $("soundTog").addEventListener("change", function () { audioUnlock(); AU.on = this.checked; audioApply(); });
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
        camChoice = b.dataset.cam; camHold = false; lastLabel = "";
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
      if (Math.abs(w - chartW) > 8) { chartW = w; clearTimeout(redrawT); redrawT = setTimeout(function () { renderForecast(); }, 120); }
    }).observe($("binsChart"));
  }

  /* ================================================================ boot */
  if (!stateFromHash()) applyPairDefaults();
  wire();
  buildMatchup();
  renderMatchbar(); renderTape(); renderChips(); renderKnobPanel(); renderWhy(); renderForecast(); renderMLCard(); renderBacktest(); renderForward(); renderResearch();
  resetHud({ rounds: [], form: null }, null);
  writeHash();
  $("runStatus").textContent = "Starting the tally";
  window.FightLab = { state: S, matchup: function () { return cur.m; }, tally: function () { return lastAgg; }, newFight: function () { newFight(); }, script: function () { return script; }, blend: function () { return BL; }, models: function () { return { moe: !!MOE, mlpage: !!MLP, methodround: !!MR, mlrates: MLR }; },
    hud: function () { return H ? { A: totals("A"), B: totals("B") } : null; }, fight: function () { return H && H.f; }, lastPick: function () { return lastPick; } };
  // the compressed models arrive a few milliseconds after the first paint: re-render everything that reads them
  var started = false;
  function afterModels() {
    $("mlTog").disabled = !MLR.ok;
    if (!MLR.ok) $("mlTog").parentNode.title = "The stat-line model is not in this build";
    buildMatchup(); if (started) dropEngine(); renderKnobPanel(); renderWhy(); renderMLCard(); renderForecast(); renderForward();
    if (started) queueTally(true);
  }
  // heavy work after the first frame: the tally (once the models are in), then the 3D cage
  requestAnimationFrame(function () {
    function go() {
      if (started) return; started = true;
      startTally();
      setTimeout(function () {
        initShow(); newFight();
        if (reduce && show) { show.paused = true; $("btnPlay").textContent = "Play"; try { show.frame(0.016); } catch (e) { /* ignore */ } }
        if (!loopOn) { loopOn = true; requestAnimationFrame(loop); }
      }, 30);
    }
    modelsReady.then(function () { afterModels(); go(); }, go);
    setTimeout(go, 4000);
  });
  }   // start
})();
