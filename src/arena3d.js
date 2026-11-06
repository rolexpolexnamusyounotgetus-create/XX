/* The arena: octagon canvas, fence, apron, venue and crowd, broadcast lighting and the image pipeline.
 *
 * API used by the show and the app (keep it stable):
 *   new FightArena.Arena(canvas, opts)   opts: { maxDpr, shadow, quality: "high"|"medium"|"low", adaptive, matchup }
 *   arena.scene, arena.camera, arena.renderer, arena.stools.{A,B}, arena.fence, arena.matTex, arena.key
 *   arena.resize(w, h), arena.render(), arena.tickFx(dt, show?), arena.burst(level), arena.repaintMat()
 *   arena.setMatchup({ a, b, weight, division, rounds, event }), arena.setBoard({ round, clock, phase })
 *   arena.mark(x, z, kind, amount)   kind: "scuff" | "sweat" | "blood"
 *   arena.setQuality(q), arena.quality, arena.stats()
 *   FightArena.{ APO, RV, vertexAngle, BLUE_K, RED_K, SIDE, FLOOR_Y, RAIL_Y, lensFov }
 * Everything is procedural; the page needs only three.js. Post-processing uses the r128 example add-ons when
 * they loaded (EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, SMAAPass, FXAAShader) and falls back
 * to a plain render when they did not.
 */
(function (root) {
  "use strict";
  var T = root.THREE;
  if (!T) return;

  var PI = Math.PI, TAU = 2 * PI;
  var APO = 4.3, RV = APO / Math.cos(PI / 8);
  function vertexAngle(k) { return PI / 8 + k * PI / 4; }
  var BLUE_K = 4, RED_K = 0;   // blue corner on the -X side, red corner on +X
  var SIDE = 2 * RV * Math.sin(PI / 8);
  var FLOOR_Y = -1.22;                       // arena floor; the canvas sits on a 1.22 m platform
  var RA = RV + 1.0, RAPO = RA * Math.cos(PI / 8);   // apron outer vertex radius and apothem
  var MESH_BOT = 0.12, MESH_TOP = 1.73, RAIL_Y = 1.79, POST_R = 0.125;
  var GATES = [1, 5];                        // fence sides with a gate (side k runs from vertex k to k + 1)
  var TRUSS_Y = 10.4, TRUSS_APO = 5.4;
  var AX = 1.3, AZ = 1.0, SQN = 4.2;         // the bowl is a squircle, longer along X

  var QUALITY = {
    high: { dpr: 2, shadow: 2048, bloom: 1, aa: "smaa", rows3d: 12, floor3d: 8, upper: 1, spots: 8, aniso: 8, mat: 2048, post: true },
    medium: { dpr: 1.5, shadow: 2048, bloom: 0.5, aa: "fxaa", rows3d: 6, floor3d: 8, upper: 0.7, spots: 8, aniso: 4, mat: 2048, post: true },
    low: { dpr: 1.5, shadow: 1024, bloom: 0, aa: "msaa", rows3d: 1, floor3d: 5, upper: 0.45, spots: 4, aniso: 2, mat: 1024, post: false }
  };

  /* ------------------------------------------------------------ small helpers */
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function perfNow() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function sideMid(k) { var a = (k + 1) * PI / 4; return { a: a, x: Math.cos(a) * APO, z: Math.sin(a) * APO, rotY: PI / 2 - a }; }
  function makeCanvas(w, h) { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function canvasTex(c, srgb, aniso) {
    var t = new T.CanvasTexture(c);
    t.encoding = srgb ? T.sRGBEncoding : T.LinearEncoding;
    t.anisotropy = aniso || 1;
    return t;
  }
  function dataTex(data, w, h, aniso) {
    var t = new T.DataTexture(data, w, h, T.RGBAFormat);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter;
    t.anisotropy = aniso || 1; t.needsUpdate = true;
    return t;
  }
  function octShape(rad, path) {
    var s = path ? new T.Path() : new T.Shape();
    for (var k = 0; k < 8; k++) {
      var kk = path ? 7 - k : k, a = vertexAngle(kk), x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (k === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    return s;
  }
  function sq(a, r, out) {
    var c = Math.cos(a), s = Math.sin(a), p = 2 / SQN;
    out[0] = r * AX * (c < 0 ? -1 : 1) * Math.pow(Math.abs(c), p);
    out[1] = r * AZ * (s < 0 ? -1 : 1) * Math.pow(Math.abs(s), p);
    return out;
  }
  // merge [{ g: geometry, m: matrix }] into one non-indexed geometry with position, normal, uv
  function mergeGeos(items) {
    var total = 0, list = [], i;
    for (i = 0; i < items.length; i++) { var g = items[i].g.index ? items[i].g.toNonIndexed() : items[i].g; list.push([g, items[i].m]); total += g.attributes.position.count; }
    var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), o = 0;
    var v = new T.Vector3(), nm = new T.Matrix3();
    for (i = 0; i < list.length; i++) {
      var G = list[i][0], M = list[i][1], P = G.attributes.position, N = G.attributes.normal, U = G.attributes.uv;
      nm.getNormalMatrix(M);
      for (var j = 0; j < P.count; j++) {
        v.fromBufferAttribute(P, j).applyMatrix4(M); pos[(o + j) * 3] = v.x; pos[(o + j) * 3 + 1] = v.y; pos[(o + j) * 3 + 2] = v.z;
        if (N) { v.fromBufferAttribute(N, j).applyMatrix3(nm).normalize(); nor[(o + j) * 3] = v.x; nor[(o + j) * 3 + 1] = v.y; nor[(o + j) * 3 + 2] = v.z; }
        if (U) { uv[(o + j) * 2] = U.getX(j); uv[(o + j) * 2 + 1] = U.getY(j); }
      }
      o += P.count;
    }
    var out = new T.BufferGeometry();
    out.setAttribute("position", new T.BufferAttribute(pos, 3));
    out.setAttribute("normal", new T.BufferAttribute(nor, 3));
    out.setAttribute("uv", new T.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }
  var _up = new T.Vector3(0, 1, 0);
  function cylBetween(a, b, r, seg) {
    var d = new T.Vector3().subVectors(b, a), len = d.length();
    var m = new T.Matrix4().compose(new T.Vector3().addVectors(a, b).multiplyScalar(0.5), new T.Quaternion().setFromUnitVectors(_up, d.normalize()), new T.Vector3(1, 1, 1));
    return { g: new T.CylinderGeometry(r, r, len, seg || 6, 1, true), m: m };
  }
  function boxAt(w, h, d, x, y, z, ry) {
    return { g: new T.BoxGeometry(w, h, d), m: new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromAxisAngle(_up, ry || 0), new T.Vector3(1, 1, 1)) };
  }
  function spaced(s) { return s.split("").join(" "); }

  /* ------------------------------------------------------------ GPU tier */
  function probeGPU() {
    var info = { renderer: "", webgl2: false, mobile: false };
    try {
      var c = document.createElement("canvas"), gl = c.getContext("webgl2") || c.getContext("webgl");
      if (gl) {
        info.webgl2 = typeof root.WebGL2RenderingContext !== "undefined" && gl instanceof root.WebGL2RenderingContext;
        var ext = gl.getExtension("WEBGL_debug_renderer_info");
        info.renderer = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || "");
        var lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext();
      }
    } catch (e) { /* no probe, guess medium */ }
    var nav = root.navigator || {}, ua = nav.userAgent || "";
    info.mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
    return info;
  }
  function guessTier(info) {
    var g = info.renderer.toLowerCase();
    if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(g)) return "low";
    if (info.mobile) return /apple gpu|adreno[^0-9]*(6[4-9]\d|7\d\d|8\d\d)|mali-g(7[1-9]|[89]\d|6[1-9]|\d{3})|immortalis|xclipse/.test(g) ? "medium" : "low";
    if (/nvidia|geforce|rtx|gtx|quadro|radeon|apple m\d|apple gpu|arc\b/.test(g)) return "high";
    if (/intel/.test(g)) return /iris|xe/.test(g) ? "high" : "medium";
    return "medium";
  }
  function forcedQuality(opts) {
    if (opts.quality && QUALITY[opts.quality]) return opts.quality;
    if (root.FIGHT_QUALITY && QUALITY[root.FIGHT_QUALITY]) return root.FIGHT_QUALITY;
    try { var m = /[#&?]q=(high|medium|low)\b/.exec((root.location.hash || "") + (root.location.search || "")); if (m) return m[1]; } catch (e) { /* ignore */ }
    return null;
  }

  /* ------------------------------------------------------------ matchup text */
  var FONT_D = '"Big Shoulders Display", Oswald, Impact, "Arial Narrow", sans-serif';
  var FONT_U = 'Archivo, "Helvetica Neue", Arial, sans-serif';
  var DIVISIONS = { 115: "STRAWWEIGHT", 125: "FLYWEIGHT", 135: "BANTAMWEIGHT", 145: "FEATHERWEIGHT", 155: "LIGHTWEIGHT", 170: "WELTERWEIGHT", 185: "MIDDLEWEIGHT", 205: "LIGHT HEAVYWEIGHT", 265: "HEAVYWEIGHT" };
  function lastName(n) { n = String(n || "").trim(); var p = n.split(/\s+/); return (p.length > 1 ? p.slice(1).join(" ") : n).toUpperCase(); }
  function normInfo(o) {
    o = o || {};
    var w = String(o.weight == null ? 155 : o.weight).replace(/[^0-9]/g, "");
    return {
      a: String(o.a || "Volkanovski").toUpperCase(), b: String(o.b || "Gaethje").toUpperCase(),
      weight: w, division: String(o.division || DIVISIONS[w] || "CATCHWEIGHT").toUpperCase(),
      rounds: o.rounds || 5, event: String(o.event || "FIGHT LAB").toUpperCase()
    };
  }
  var DIV_LB = { strawweight: 115, flyweight: 125, bantamweight: 135, featherweight: 145, lightweight: 155, welterweight: 170, middleweight: 185, "light heavyweight": 205, heavyweight: 265 };
  function infoFromScript(s) {
    if (!s) return null;
    var a = null, b = null, f = s.fighters || {};
    if (s.short && s.short.A) { a = s.short.A; b = s.short.B; }   // broadcast surnames (director v3)
    else if (s.names && s.names.A) { a = lastName(s.names.A); b = lastName(s.names.B); }
    else if (f.A && f.A.name) { a = f.A.short || lastName(f.A.name); b = f.B && (f.B.short || lastName(f.B.name)); }
    if (!a && root.FightDirector && root.FightDirector.NAMES) { a = root.FightDirector.NAMES.A; b = root.FightDirector.NAMES.B; }
    if (!a) return null;
    var d = s.division || (s.matchup && s.matchup.division) || (f.A && f.A.division) || null;
    var key = d ? String(d).toLowerCase().replace(/^women's\s+/, "") : "";
    var w = s.weight || s.weight_lb || (s.matchup && (s.matchup.weight || s.matchup.weight_lb)) || DIV_LB[key] || (d ? null : 155);
    return { a: a, b: b, weight: w || "", division: d ? String(d).toUpperCase() : null, rounds: s.nRounds || s.maxRounds || (s.matchup && s.matchup.rounds) || 5 };
  }

  function fitFont(ctx, text, weight, family, maxW, maxH) {
    var size = Math.max(4, Math.round(maxH));
    ctx.font = weight + " " + size + "px " + family;
    var w = ctx.measureText(text).width;
    if (w > maxW) { size = Math.max(4, Math.floor(size * maxW / w)); ctx.font = weight + " " + size + "px " + family; }
    return size;
  }

  /* ------------------------------------------------------------ the canvas (mat) */
  function paintMat(ctx, S, info) {
    var c = S / 2, k = S / (2 * RV), r = rng(11), i, j, a;
    function X(x) { return c + x * k; }
    function octSub(rad) { for (var q = 0; q < 8; q++) { var aa = vertexAngle(q), x = X(Math.cos(aa) * rad), y = X(Math.sin(aa) * rad); if (q === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    // base: cool off-white vinyl canvas
    ctx.fillStyle = "#d2d6db"; ctx.fillRect(0, 0, S, S);
    // broad mottling over the padding
    for (i = 0; i < 170; i++) {
      var bx = r() * S, by = r() * S, br = (0.18 + r() * 0.95) * k, dark = r() < 0.55;
      var g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, dark ? "rgba(58,64,74,0.04)" : "rgba(255,255,255,0.045)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(bx - br, by - br, 2 * br, 2 * br);
    }
    // outer band, a shade darker, with pinstripes
    var bandIn = 3.58 / Math.cos(PI / 8);
    ctx.beginPath(); octSub(RV + 0.1); octSub(bandIn); ctx.fillStyle = "rgba(38,46,58,0.10)"; ctx.fill("evenodd");
    ctx.beginPath(); octSub(bandIn); ctx.lineWidth = 0.028 * k; ctx.strokeStyle = "rgba(22,26,33,0.62)"; ctx.stroke();
    ctx.beginPath(); octSub(bandIn - 0.075); ctx.lineWidth = 0.009 * k; ctx.strokeStyle = "rgba(22,26,33,0.38)"; ctx.stroke();
    // centre emblem
    ctx.save(); ctx.translate(c, c);
    function lineOct(rad, w, col) { ctx.beginPath(); for (var q = 0; q < 8; q++) { var aa = vertexAngle(q), x = Math.cos(aa) * rad * k, y = Math.sin(aa) * rad * k; if (q === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.lineWidth = w * k; ctx.strokeStyle = col; ctx.stroke(); }
    var cg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.6 * k);
    cg.addColorStop(0, "rgba(255,255,255,0.10)"); cg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = cg; ctx.fillRect(-1.7 * k, -1.7 * k, 3.4 * k, 3.4 * k);
    lineOct(1.62, 0.085, "rgba(22,25,31,0.80)");
    lineOct(1.47, 0.02, "rgba(22,25,31,0.55)");
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    fitFont(ctx, info.event, "900", FONT_D, 2.42 * k, 0.86 * k);
    ctx.fillStyle = "rgba(19,22,27,0.88)"; ctx.fillText(info.event, 0, 0.27 * k);
    ctx.fillStyle = "rgba(190,28,40,0.88)"; ctx.fillRect(-0.95 * k, 0.40 * k, 1.9 * k, 0.075 * k);
    ctx.fillStyle = "rgba(19,22,27,0.74)";
    var divLine = spaced(info.weight ? info.division + "  ·  " + info.weight + " LB" : info.division);
    fitFont(ctx, divLine, "800", FONT_U, 2.1 * k, 0.15 * k);
    ctx.fillText(divLine, 0, 0.70 * k);
    fitFont(ctx, spaced("MONTE CARLO FIGHT SIMULATOR"), "700", FONT_U, 1.9 * k, 0.115 * k);
    ctx.fillStyle = "rgba(19,22,27,0.6)"; ctx.fillText(spaced("MONTE CARLO FIGHT SIMULATOR"), 0, -0.66 * k);
    ctx.restore();
    // band lettering: names beside their corners, branding and the weight between
    var items = { 1: [info.event, null], 5: [info.event, null], 3: [info.a, "37,92,190"], 7: [info.b, "196,40,46"], 0: [info.weight || info.event, null], 4: [info.weight || info.event, null], 2: [info.division, null], 6: [info.rounds === 3 ? "THREE ROUNDS" : "FIVE ROUNDS", null] };
    for (var s = 0; s < 8; s++) {
      var it = items[s], m = sideMid(s), mid = (bandIn * Math.cos(PI / 8) + APO) / 2;
      ctx.save(); ctx.translate(X(Math.cos(m.a) * mid), X(Math.sin(m.a) * mid)); ctx.rotate(m.a + PI / 2);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var big = /^\d+$/.test(it[0]);
      fitFont(ctx, it[0], big ? "900" : "800", FONT_D, SIDE * (big ? 0.42 : 0.74) * k, (big ? 0.52 : 0.4) * k);
      ctx.fillStyle = "rgba(20,23,29,0.70)"; ctx.fillText(it[0], 0, 0.01 * k);
      if (it[1]) { ctx.fillStyle = "rgba(" + it[1] + ",0.85)"; ctx.fillRect(-0.7 * k, 0.24 * k, 1.4 * k, 0.05 * k); }
      ctx.restore();
    }
    // secondary prints on the open canvas, on the diagonals between the emblem and the band
    var marks = ["MONTE CARLO", "20,000 FIGHTS", "MONTE CARLO", "20,000 FIGHTS"];
    for (j = 0; j < 4; j++) {
      var ma = PI / 4 + j * PI / 2 + PI / 8, mr = 2.55, mx = X(Math.cos(ma) * mr), my = X(Math.sin(ma) * mr);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ma + PI / 2);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(24,28,34,0.28)"; ctx.lineWidth = 0.018 * k;
      ctx.beginPath(); for (var q2 = 0; q2 < 8; q2++) { var oa = vertexAngle(q2), ox = Math.cos(oa) * 0.2 * k, oy = Math.sin(oa) * 0.2 * k - 0.22 * k; if (q2 === 0) ctx.moveTo(ox, oy); else ctx.lineTo(ox, oy); } ctx.closePath(); ctx.stroke();
      fitFont(ctx, "FL", "900", FONT_D, 0.3 * k, 0.2 * k); ctx.fillStyle = "rgba(24,28,34,0.34)"; ctx.fillText("FL", 0, -0.215 * k);
      fitFont(ctx, spaced(marks[j]), "800", FONT_U, 1.2 * k, 0.13 * k); ctx.fillStyle = "rgba(24,28,34,0.3)"; ctx.fillText(spaced(marks[j]), 0, 0.08 * k);
      ctx.restore();
    }
    // corner colour wedges: the corner of the band in blue and red
    [[BLUE_K, "28,74,160"], [RED_K, "170,32,40"]].forEach(function (cw) {
      var va = vertexAngle(cw[0]), vp = vertexAngle(cw[0] - 1), vn = vertexAngle(cw[0] + 1);
      var Vx = Math.cos(va) * RV, Vz = Math.sin(va) * RV;
      function along(ta, d) { var tx = Math.cos(ta) * RV - Vx, tz = Math.sin(ta) * RV - Vz, l = Math.hypot(tx, tz); return [Vx + tx / l * d, Vz + tz / l * d]; }
      var p1 = along(vp, 1.25), p2 = along(vn, 1.25), ins = bandIn - 0.12;
      var q1 = [Math.cos(va - 0.2) * ins, Math.sin(va - 0.2) * ins], q2 = [Math.cos(va + 0.2) * ins, Math.sin(va + 0.2) * ins];
      ctx.beginPath(); ctx.moveTo(X(Vx), X(Vz)); ctx.lineTo(X(p1[0]), X(p1[1])); ctx.lineTo(X(q1[0]), X(q1[1])); ctx.lineTo(X(q2[0]), X(q2[1])); ctx.lineTo(X(p2[0]), X(p2[1])); ctx.closePath();
      ctx.fillStyle = "rgba(" + cw[1] + ",0.74)"; ctx.fill();
      ctx.lineWidth = 0.022 * k; ctx.strokeStyle = "rgba(240,242,245,0.45)"; ctx.stroke();
    });
    // occlusion along the fence base and around the posts
    for (s = 0; s < 8; s++) {
      var a0 = vertexAngle(s), a1 = vertexAngle(s + 1), am = (s + 1) * PI / 4, nx = Math.cos(am), nz = Math.sin(am);
      var g2 = ctx.createLinearGradient(X(nx * APO), X(nz * APO), X(nx * (APO - 0.26)), X(nz * (APO - 0.26)));
      g2.addColorStop(0, "rgba(8,10,14,0.5)"); g2.addColorStop(0.35, "rgba(8,10,14,0.16)"); g2.addColorStop(1, "rgba(8,10,14,0)");
      ctx.beginPath();
      ctx.moveTo(X(Math.cos(a0) * (RV + 0.2)), X(Math.sin(a0) * (RV + 0.2))); ctx.lineTo(X(Math.cos(a1) * (RV + 0.2)), X(Math.sin(a1) * (RV + 0.2)));
      ctx.lineTo(X(Math.cos(a1) * (RV - 0.6)), X(Math.sin(a1) * (RV - 0.6))); ctx.lineTo(X(Math.cos(a0) * (RV - 0.6)), X(Math.sin(a0) * (RV - 0.6))); ctx.closePath();
      ctx.fillStyle = g2; ctx.fill();
    }
    for (s = 0; s < 8; s++) {
      a = vertexAngle(s); var px = X(Math.cos(a) * (RV - 0.04)), py = X(Math.sin(a) * (RV - 0.04));
      var g3 = ctx.createRadialGradient(px, py, 0, px, py, 0.5 * k);
      g3.addColorStop(0, "rgba(6,8,10,0.55)"); g3.addColorStop(1, "rgba(6,8,10,0)");
      ctx.fillStyle = g3; ctx.fillRect(px - 0.5 * k, py - 0.5 * k, k, k);
    }
    // old scuffs, sole arcs and grime where fighters work
    ctx.lineCap = "round";
    for (i = 0; i < 420; i++) {
      var rr = (r() < 0.35 ? 3.2 + r() * 1.0 : Math.sqrt(r()) * 3.6), aa = r() * TAU, sx = X(Math.cos(aa) * rr), sy = X(Math.sin(aa) * rr);
      ctx.strokeStyle = "rgba(" + (60 + (r() * 20 | 0)) + ",64,72," + (0.025 + r() * 0.06).toFixed(3) + ")";
      ctx.lineWidth = (0.004 + r() * 0.02) * k;
      var ang = r() * TAU, len = (0.04 + r() * 0.3) * k;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + Math.cos(ang + 0.7) * len * 0.5, sy + Math.sin(ang + 0.7) * len * 0.5, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len); ctx.stroke();
    }
    for (i = 0; i < 40; i++) {
      var gx = X((r() - 0.5) * 6), gy = X((r() - 0.5) * 6), gr = (0.2 + r() * 0.5) * k;
      var g4 = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g4.addColorStop(0, "rgba(90,84,76,0.05)"); g4.addColorStop(1, "rgba(90,84,76,0)");
      ctx.fillStyle = g4; ctx.fillRect(gx - gr, gy - gr, 2 * gr, 2 * gr);
    }
    ctx.restore();
    // fine grain across everything so print and canvas read as one surface
    var img = ctx.getImageData(0, 0, S, S), d = img.data, seed = 1234567 >>> 0;
    for (j = 0; j < d.length; j += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      var n = ((seed >>> 24) - 128) * 0.05;
      d[j] += n; d[j + 1] += n; d[j + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  // plain-weave height field -> tangent-space normal tile
  function weaveNormal(N, threads, aniso) {
    var h = new Float32Array(N * N), p = N / threads, x, y, r = rng(5);
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      var i = Math.floor(x / p), j = Math.floor(y / p), fx = (x % p + 0.5) / p, fy = (y % p + 0.5) / p;
      var ax = Math.pow(Math.sin(PI * fx), 0.7), ay = Math.pow(Math.sin(PI * fy), 0.7);
      var warp = ax * (0.55 + 0.45 * Math.cos(PI * (y + 0.5) / p + PI * i));
      var weft = ay * (0.55 + 0.45 * Math.cos(PI * (x + 0.5) / p + PI * j + PI));
      h[y * N + x] = Math.max(warp, weft) + (r() - 0.5) * 0.08;
    }
    var data = new Uint8Array(N * N * 4), s = 2.2;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      var dx = h[y * N + (x + 1) % N] - h[y * N + (x - 1 + N) % N], dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
      var nx = -dx * s, ny = -dy * s, nz = 1, l = Math.sqrt(nx * nx + ny * ny + nz * nz), o = (y * N + x) * 4;
      data[o] = (nx / l * 0.5 + 0.5) * 255; data[o + 1] = (ny / l * 0.5 + 0.5) * 255; data[o + 2] = (nz / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
    }
    return dataTex(data, N, N, aniso);
  }

  // chain-link: diamond lattice of round, vinyl-coated wire; alpha (coverage) and a tangent-space normal map
  function chainLink(N, cells, aniso) {
    var cp = N / cells, w = cp * 0.052, alpha = new Uint8Array(N * N * 4), normal = new Uint8Array(N * N * 4), R2 = Math.SQRT1_2;
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var u = x + 0.5, v = y + 0.5;
      var s1 = (u + v) / cp, s2 = (u - v) / cp;
      var e1 = (s1 - Math.round(s1)) * cp * R2, e2 = (s2 - Math.round(s2)) * cp * R2;   // signed distance to each wire family
      var d1 = Math.abs(e1), d2 = Math.abs(e2);
      // which wire is on top at a crossing alternates, like the helical bends of real chain-link
      var cross = (Math.round(s1) + Math.round(s2)) & 1, h1 = 1 - d1 / w + (cross ? 0.15 : 0), h2 = 1 - d2 / w + (cross ? 0 : 0.15);
      var useA = h1 >= h2, d = useA ? d1 : d2, e = useA ? e1 : e2;
      var cov = clamp(w - d + 0.5, 0, 1);
      var o = (y * N + x) * 4, av = Math.round(cov * 255);
      alpha[o] = alpha[o + 1] = alpha[o + 2] = av; alpha[o + 3] = 255;
      var t = clamp(e / w, -0.98, 0.98), nz = Math.sqrt(1 - t * t), dirx = useA ? R2 : R2, diry = useA ? R2 : -R2;
      var nx = dirx * t, ny = diry * t;
      if (cov <= 0) { nx = 0; ny = 0; nz = 1; }
      normal[o] = (nx * 0.5 + 0.5) * 255; normal[o + 1] = (ny * 0.5 + 0.5) * 255; normal[o + 2] = (nz * 0.5 + 0.5) * 255; normal[o + 3] = 255;
    }
    return { alpha: dataTex(alpha, N, N, aniso), normal: dataTex(normal, N, N, aniso) };
  }

  /* ------------------------------------------------------------ LED boards and screens */
  function ledSegment(ctx, kind, x0, W, H, info, st) {
    var g;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, W, H); ctx.clip();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (st.flash > 0.08) {
      var f = st.flash;
      g = ctx.createLinearGradient(x0, 0, x0 + W, 0);
      g.addColorStop(0, "rgb(" + Math.round(150 * f + 20) + ",10,18)"); g.addColorStop(0.5, "rgb(" + Math.round(235 * f + 20) + "," + Math.round(40 * f) + ",40)"); g.addColorStop(1, "rgb(" + Math.round(150 * f + 20) + ",10,18)");
      ctx.fillStyle = g; ctx.fillRect(x0, 0, W, H);
      fitFont(ctx, info.event, "900", FONT_D, W * 0.86, H * 0.74);
      ctx.fillStyle = "#ffffff"; ctx.fillText(info.event, x0 + W / 2, H * 0.53);
      ctx.restore(); return;
    }
    if (kind === "a" || kind === "b") {
      var blue = kind === "a";
      g = ctx.createLinearGradient(x0, 0, x0 + W, H);
      g.addColorStop(0, blue ? "#0a2a66" : "#5e0b10"); g.addColorStop(1, blue ? "#1d5fd6" : "#d2262c");
      ctx.fillStyle = g; ctx.fillRect(x0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      for (var i = -2; i < 12; i++) { ctx.beginPath(); ctx.moveTo(x0 + i * W / 8, H); ctx.lineTo(x0 + i * W / 8 + H * 0.6, 0); ctx.lineTo(x0 + i * W / 8 + H * 0.6 + 6, 0); ctx.lineTo(x0 + i * W / 8 + 6, H); ctx.fill(); }
      fitFont(ctx, blue ? info.a : info.b, "900", FONT_D, W * 0.84, H * 0.66);
      ctx.fillStyle = "#ffffff"; ctx.fillText(blue ? info.a : info.b, x0 + W / 2, H * 0.56);
    } else if (kind === "clock") {
      ctx.fillStyle = "#04060a"; ctx.fillRect(x0, 0, W, H);
      ctx.fillStyle = "#c8102e"; ctx.fillRect(x0, 0, W * 0.36, H);
      fitFont(ctx, "R" + st.round, "900", FONT_D, W * 0.3, H * 0.66);
      ctx.fillStyle = "#ffffff"; ctx.fillText("R" + st.round, x0 + W * 0.18, H * 0.55);
      fitFont(ctx, st.clock, "800", FONT_D, W * 0.56, H * 0.7);
      ctx.fillStyle = "#ffd36b"; ctx.fillText(st.clock, x0 + W * 0.68, H * 0.55);
    } else if (kind === "div" || kind === "rounds") {
      ctx.fillStyle = "#06080d"; ctx.fillRect(x0, 0, W, H);
      var txt = kind === "div" ? (info.weight ? info.division + " · " + info.weight : info.division) : (info.rounds === 3 ? "THREE ROUNDS" : "MAIN EVENT · 5 RDS");
      fitFont(ctx, txt, "800", FONT_D, W * 0.86, H * 0.5);
      ctx.fillStyle = "#e9edf2"; ctx.fillText(txt, x0 + W / 2, H * 0.55);
      ctx.fillStyle = kind === "div" ? "#1d5fd6" : "#d2262c"; ctx.fillRect(x0 + W * 0.2, H * 0.84, W * 0.6, H * 0.05);
    } else {
      g = ctx.createLinearGradient(x0, 0, x0, H);
      g.addColorStop(0, "#14171d"); g.addColorStop(1, "#06070a");
      ctx.fillStyle = g; ctx.fillRect(x0, 0, W, H);
      fitFont(ctx, info.event, "900", FONT_D, W * 0.7, H * 0.62);
      ctx.fillStyle = "#ffffff"; ctx.fillText(info.event, x0 + W / 2, H * 0.52);
      ctx.fillStyle = "#c8102e"; ctx.fillRect(x0 + W * 0.33, H * 0.84, W * 0.34, H * 0.06);
    }
    ctx.restore();
  }
  function drawLED(ctx, W, H, info, st) {
    var order = ["logo", "a", "clock", "b", "logo", "div", "clock", "rounds"], seg = W / 8;
    for (var f = 0; f < 8; f++) ledSegment(ctx, order[(f + st.shift) % 8], f * seg, seg, H, info, st);
  }
  function drawScreen(ctx, W, H, info, st) {
    ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0e131c"); g.addColorStop(1, "#040508");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    // header
    ctx.fillStyle = "#c8102e"; ctx.fillRect(0, 0, W, H * 0.16);
    fitFont(ctx, info.event + "  ·  " + info.division, "900", FONT_D, W * 0.9, H * 0.11);
    ctx.fillStyle = "#fff"; ctx.fillText(info.event + "  ·  " + info.division, W / 2, H * 0.085);
    // name plates
    [[info.a, "#1d5fd6", "#0a2a66", 0.04], [info.b, "#d2262c", "#5e0b10", 0.54]].forEach(function (p) {
      var x = W * p[3], w = W * 0.42, y = H * 0.27, h = H * 0.34, gg = ctx.createLinearGradient(x, y, x + w, y + h);
      gg.addColorStop(0, p[2]); gg.addColorStop(1, p[1]); ctx.fillStyle = gg; ctx.fillRect(x, y, w, h);
      fitFont(ctx, p[0], "900", FONT_D, w * 0.9, h * 0.62);
      ctx.fillStyle = "#fff"; ctx.fillText(p[0], x + w / 2, y + h * 0.54);
    });
    fitFont(ctx, "VS", "900", FONT_D, W * 0.1, H * 0.14); ctx.fillStyle = "#ffd36b"; ctx.fillText("VS", W / 2, H * 0.44);
    // round and clock
    var flash = st.flash > 0.08;
    ctx.fillStyle = flash ? "rgba(200,16,46," + (0.4 + 0.6 * st.flash) + ")" : "#0b0e14"; ctx.fillRect(W * 0.2, H * 0.68, W * 0.6, H * 0.24);
    var line = flash ? info.event : ("ROUND " + st.round + "   " + st.clock);
    fitFont(ctx, line, "900", FONT_D, W * 0.56, H * 0.19);
    ctx.fillStyle = flash ? "#fff" : "#e9edf2"; ctx.fillText(line, W / 2, H * 0.805);
  }

  /* ------------------------------------------------------------ shaders */
  var FinishShader = {
    uniforms: { tDiffuse: { value: null }, uLinear: { value: 1 }, uVig: { value: 1.0 }, uTime: { value: 0 }, uRes: { value: new T.Vector2(1, 1) }, uSat: { value: 1.06 }, uContrast: { value: 1.05 }, uLift: { value: 0.006 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: [
      "uniform sampler2D tDiffuse; uniform float uLinear, uVig, uTime, uSat, uContrast, uLift; uniform vec2 uRes; varying vec2 vUv;",
      "float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
      "void main() {",
      "  vec3 col = texture2D(tDiffuse, vUv).rgb;",
      "  if (uLinear > 0.5) { col = max(col, vec3(0.0)); vec3 hi = 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055; col = mix(col * 12.92, hi, step(vec3(0.0031308), col)); }",
      "  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));",
      "  col = mix(vec3(l), col, uSat);",
      "  col = (col - 0.5) * uContrast + 0.5 + uLift;",
      "  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;",
      "  float v = smoothstep(1.05, 0.28, length(q) * uVig);",
      "  col *= mix(0.6, 1.0, v);",
      "  col += (hash(vUv * uRes + fract(uTime) * 61.0) + hash(vUv * uRes * 1.37 - fract(uTime) * 17.0) - 1.0) / 255.0;",
      "  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);",
      "}"
    ].join("\n")
  };

  var CROWD_VS = [
    "uniform float uTime, uExcite, uStand, uWave, uHouse, uSpill;",
    "attribute vec3 aStand; attribute vec3 aStandN; attribute float aPart; attribute float aArm;",
    "attribute vec4 aOff; attribute vec4 aPar; attribute vec3 aC0; attribute vec3 aC1; attribute vec3 aC2; attribute vec3 aC3;",
    "varying vec3 vCol;",
    "#include <fog_pars_vertex>",
    "vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }",
    "vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }",
    "void main() {",
    "  float ph = aPar.x, sr = aPar.y, ex = aPar.z;",
    "  float e = clamp(uExcite * ex, 0.0, 1.0);",
    "  float wv = uWave * ex * smoothstep(0.55, 0.95, sin(aOff.w * 2.0 - uTime * 2.6 + ph * 0.6));",
    "  float st = smoothstep(sr - 0.07, sr + 0.07, uStand * (0.55 + 0.45 * ex) + wv * 0.6);",
    "  vec3 p = mix(position, aStand, st);",
    "  vec3 n = normalize(mix(normal, aStandN, st));",
    "  if (aArm > 0.5) {",
    "    float side = aArm < 1.5 ? -1.0 : 1.0;",
    "    vec3 piv = vec3(side * 0.23, mix(1.0, 1.4, st), 0.0);",
    "    float pump = 0.5 + 0.5 * sin(uTime * (5.5 + 3.0 * fract(ph * 7.31)) + ph * 6.2831 + side * 0.9);",
    "    float lift = clamp(e * 1.7 - 0.3 - fract(ph * 3.71) * 0.55, 0.0, 1.0);",
    "    lift = max(lift * (side > 0.0 || fract(ph * 5.3) > 0.35 ? 1.0 : 0.4), wv);",
    "    float ang = lift * (2.45 + 0.5 * pump);",
    "    vec3 q = rotX(p - piv, -ang); q = rotZ(q, -side * 0.38 * lift);",
    "    p = piv + q; n = rotZ(rotX(n, -ang), -side * 0.38 * lift);",
    "  }",
    "  p.y += (st * 0.06 + 0.012) * e * abs(sin(uTime * 5.2 + ph * 6.2831));",
    "  p *= aPar.w;",
    "  float cy = cos(aOff.w), sy = sin(aOff.w);",
    "  vec3 wp = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z) + aOff.xyz;",
    "  vec3 wn = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);",
    "  vec3 toC = vec3(0.0, 7.0, 0.0) - wp; float d = length(toC);",
    "  float lam = max(dot(wn, toC / d), 0.0) * 0.85 + 0.15;",
    "  float spill = uSpill / (1.0 + d * d * d * 0.00195);",
    "  float top = (0.55 + 0.45 * max(wn.y, 0.0)) * uHouse;",
    "  vec3 col = aPart < 0.5 ? aC0 : (aPart < 1.5 ? aC2 : (aPart < 2.5 ? aC1 : aC3));",
    "  vCol = col * (top + lam * spill) * (0.82 + 0.36 * fract(ph * 13.13));",
    "  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  #include <fog_vertex>",
    "}"
  ].join("\n");
  var CROWD_FS = [
    "varying vec3 vCol;",
    "#include <common>",
    "#include <fog_pars_fragment>",
    "void main() {",
    "  gl_FragColor = vec4(vCol, 1.0);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  #include <fog_fragment>",
    "}"
  ].join("\n");

  // the far crowd as point sprites shaped like heads and shoulders
  var FAR_VS = [
    "uniform float uTime, uExcite, uScale, uHouse, uSpill;",
    "attribute vec3 aC0; attribute vec3 aC2; attribute vec2 aPar;",
    "varying vec3 vShirt; varying vec3 vSkin;",
    "#include <fog_pars_vertex>",
    "void main() {",
    "  vec3 p = position;",
    "  float e = clamp(uExcite, 0.0, 1.0);",
    "  p.y += e * 0.07 * abs(sin(uTime * 5.0 + aPar.x * 6.2831)) + e * 0.25 * step(0.6, fract(aPar.x * 9.7));",
    "  vec4 mvPosition = viewMatrix * vec4(p, 1.0);",
    "  gl_PointSize = clamp(uScale * aPar.y / -mvPosition.z, 1.0, 64.0);",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  float d = length(p - vec3(0.0, 7.0, 0.0));",
    "  float l = uHouse + uSpill / (1.0 + d * d * d * 0.00195);",
    "  l *= 0.8 + 0.4 * fract(aPar.x * 13.13);",
    "  vShirt = aC0 * l; vSkin = aC2 * l;",
    "  #include <fog_vertex>",
    "}"
  ].join("\n");
  var FAR_FS = [
    "varying vec3 vShirt; varying vec3 vSkin;",
    "#include <common>",
    "#include <fog_pars_fragment>",
    "void main() {",
    "  vec2 q = gl_PointCoord - vec2(0.5);",
    "  float head = length((q - vec2(0.0, -0.22)) * vec2(1.0, 0.9)) - 0.17;",
    "  float body = length((q - vec2(0.0, 0.34)) * vec2(0.85, 1.25)) - 0.36;",
    "  if (min(head, body) > 0.0) discard;",
    "  gl_FragColor = vec4(head < body ? vSkin : vShirt, 1.0);",
    "  #include <tonemapping_fragment>",
    "  #include <encodings_fragment>",
    "  #include <fog_fragment>",
    "}"
  ].join("\n");

  // phone screens: small steady lights that come up on big moments
  var PHONE_VS = [
    "uniform float uScale, uPhones, uTime;",
    "attribute float aRand;",
    "varying float vA;",
    "void main() {",
    "  vec4 mvPosition = viewMatrix * vec4(position, 1.0);",
    "  float on = smoothstep(aRand, aRand + 0.04, uPhones);",
    "  vA = on * (0.75 + 0.25 * sin(uTime * 1.3 + aRand * 40.0));",
    "  gl_PointSize = on > 0.0 ? clamp(uScale * 0.09 / -mvPosition.z, 1.4, 6.0) : 0.0;",
    "  gl_Position = projectionMatrix * mvPosition;",
    "  float d = -mvPosition.z; vA *= 1.0 / (1.0 + d * 0.012);",
    "}"
  ].join("\n");
  var PHONE_FS = [
    "varying float vA;",
    "void main() {",
    "  vec2 q = abs(gl_PointCoord - 0.5);",
    "  if (max(q.x * 1.6, q.y) > 0.5) discard;",
    "  gl_FragColor = vec4(vec3(0.75, 0.85, 1.0) * vA * 1.4, 1.0);",
    "}"
  ].join("\n");

  // volumetric-looking light shafts: additive cones, brightest along the axis and near the lamp
  var SHAFT_VS = [
    "varying vec3 vN; varying vec3 vV; varying float vH;",
    "uniform float uLen;",
    "void main() {",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vN = normalize(mat3(modelMatrix) * normal);",
    "  vV = normalize(cameraPosition - wp.xyz);",
    "  vH = clamp(-position.y / uLen, 0.0, 1.0);",
    "  gl_Position = projectionMatrix * viewMatrix * wp;",
    "}"
  ].join("\n");
  var SHAFT_FS = [
    "uniform vec3 uColor; uniform float uIntensity, uTime;",
    "varying vec3 vN; varying vec3 vV; varying float vH;",
    "void main() {",
    "  float f = abs(dot(normalize(vN), normalize(vV)));",
    "  float a = pow(f, 2.2) * pow(1.0 - vH, 1.6) * smoothstep(0.0, 0.05, vH);",
    "  a *= 0.85 + 0.15 * sin(vH * 23.0 + uTime * 0.7);",
    "  gl_FragColor = vec4(uColor * a * uIntensity, 1.0);",
    "}"
  ].join("\n");

  /* ------------------------------------------------------------ crowd figure geometry */
  // A seated figure and the same figure standing (a morph target), built from boxes. Faces +Z, feet at y = 0.
  function personGeometry() {
    var P = [], S = [], N = [], SN = [], PART = [], ARM = [], IDX = [];
    var m1 = new T.Matrix4(), m2 = new T.Matrix4(), n1 = new T.Matrix3(), n2 = new T.Matrix3(), v = new T.Vector3(), q = new T.Quaternion(), e = new T.Euler();
    // add a primitive in its seated and standing placement; seat/stand = [x, y, z, rotX], sc = scale
    function part(g, partId, arm, seat, stand, opt) {
      opt = opt || {};
      var pos = g.attributes.position, nor = g.attributes.normal, idx = g.index ? g.index.array : null, sc = opt.scale || [1, 1, 1];
      m1.compose(v.set(seat[0], seat[1], seat[2]), q.setFromEuler(e.set(seat[3] || 0, 0, 0)), new T.Vector3(sc[0], sc[1], sc[2])); n1.getNormalMatrix(m1);
      m2.compose(v.set(stand[0], stand[1], stand[2]), q.setFromEuler(e.set(stand[3] || 0, 0, 0)), new T.Vector3(sc[0], sc[1], sc[2])); n2.getNormalMatrix(m2);
      var base = P.length / 3, map = {}, kept = 0;
      for (var i = 0; i < pos.count; i++) {
        if (opt.noBottom && nor.getY(i) < -0.9) continue;   // the underside is never seen
        if (opt.keep && !opt.keep(pos.getX(i), pos.getY(i), pos.getZ(i))) continue;
        map[i] = base + kept++;
        var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (opt.taper && y > 0) x *= opt.taper;
        if (opt.waist && y < 0) x *= opt.waist;
        v.set(x, y, z).applyMatrix4(m1); P.push(v.x, v.y, v.z);
        v.set(x, y, z).applyMatrix4(m2); S.push(v.x, v.y, v.z);
        v.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(n1).normalize(); N.push(v.x, v.y, v.z);
        v.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(n2).normalize(); SN.push(v.x, v.y, v.z);
        PART.push(partId); ARM.push(arm);
      }
      var n = idx ? idx.length : pos.count;
      for (i = 0; i < n; i += 3) {
        var i0 = idx ? idx[i] : i, i1 = idx ? idx[i + 1] : i + 1, i2 = idx ? idx[i + 2] : i + 2;
        if (map[i0] !== undefined && map[i1] !== undefined && map[i2] !== undefined) IDX.push(map[i0], map[i1], map[i2]);
      }
    }
    function box(w, h, d) { return new T.BoxGeometry(w, h, d); }
    var H2 = PI / 2, ico = new T.IcosahedronGeometry(1, 0);
    [-1, 1].forEach(function (sd) {
      part(box(0.115, 0.46, 0.12), 2, 0, [sd * 0.1, 0.24, 0.44], [sd * 0.1, 0.24, 0.0], { noBottom: true });            // shin
      part(box(0.14, 0.14, 0.45), 2, 0, [sd * 0.1, 0.53, 0.2], [sd * 0.1, 0.70, 0.0, H2], { noBottom: true });          // thigh
      part(box(0.1, 0.31, 0.11), 0, sd < 0 ? 1 : 2, [sd * 0.23, 0.85, 0.0], [sd * 0.23, 1.25, 0.0], { noBottom: true });  // upper arm (sleeve)
      part(box(0.08, 0.28, 0.08), 1, sd < 0 ? 1 : 2, [sd * 0.22, 0.64, 0.16, H2], [sd * 0.23, 0.95, 0.02], { noBottom: true });   // forearm and hand
    });
    part(box(0.3, 0.53, 0.21), 0, 0, [0, 0.79, -0.02, -0.06], [0, 1.18, 0.0], { taper: 1.25, waist: 0.95, noBottom: true });  // torso, broad shoulders
    part(box(0.07, 0.07, 0.07), 1, 0, [0, 1.07, -0.005, -0.04], [0, 1.465, 0.0], { noBottom: true });                       // neck
    part(ico, 1, 0, [0, 1.155, 0.005, -0.04], [0, 1.55, 0.005], { scale: [0.088, 0.112, 0.1] });                             // head
    part(ico, 3, 0, [0, 1.19, -0.012, -0.04], [0, 1.585, -0.01], { scale: [0.094, 0.085, 0.104], keep: function (x, y, z) { return y > -0.2 || z < -0.3; } });   // hair or cap
    var g = new T.InstancedBufferGeometry();
    g.setIndex(IDX);
    g.setAttribute("position", new T.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new T.Float32BufferAttribute(N, 3));
    g.setAttribute("aStand", new T.Float32BufferAttribute(S, 3));
    g.setAttribute("aStandN", new T.Float32BufferAttribute(SN, 3));
    g.setAttribute("aPart", new T.Float32BufferAttribute(PART, 1));
    g.setAttribute("aArm", new T.Float32BufferAttribute(ARM, 1));
    return g;
  }

  var SHIRTS = [[0x141519, 30], [0x2a2d33, 12], [0x1b2846, 10], [0xd6d8db, 9], [0x777b83, 8], [0x8b1d21, 7], [0x1e4c9c, 6], [0x474c31, 4], [0x581a23, 4], [0x9a8263, 3], [0x1d583a, 3], [0xb39528, 2], [0xb06478, 2]];
  var PANTS = [[0x1c2333, 40], [0x111215, 30], [0x6a5f4b, 12], [0x45484e, 18]];
  var SKINS = [[0xe6c2a6, 14], [0xd8a283, 22], [0xc58e69, 20], [0xa86d4b, 16], [0x8a5538, 12], [0x5f3b28, 10], [0x3f291d, 6]];
  var HAIRS = [[0x121010, 34], [0x2a1c13, 26], [0x4c3422, 14], [0x9f7f4e, 7], [0x77736d, 9], [0, 10]];
  function wpick(list, r) { var tot = 0, i; for (i = 0; i < list.length; i++) tot += list[i][1]; var x = r() * tot; for (i = 0; i < list.length; i++) { x -= list[i][1]; if (x <= 0) return list[i][0]; } return list[0][0]; }

  function CrowdBuilder() { this.off = []; this.par = []; this.c0 = []; this.c1 = []; this.c2 = []; this.c3 = []; this.heads = []; }
  CrowdBuilder.prototype.add = function (x, y, z, yaw, r, o) {
    o = o || {};
    var col = new T.Color();
    var shirt = o.shirt != null ? o.shirt : wpick(SHIRTS, r), skin = wpick(SKINS, r), pants = o.pants != null ? o.pants : wpick(PANTS, r), hair = wpick(HAIRS, r);
    if (hair === 0) hair = r() < 0.5 ? skin : (r() < 0.6 ? 0x16171a : shirt);   // bald or a cap
    var sc = o.scale || (0.93 + r() * 0.13);
    this.off.push(x, y, z, yaw);
    this.par.push(r(), o.stand != null ? o.stand : (0.08 + r() * 0.92), o.excite != null ? o.excite : (0.45 + r() * 0.75), sc);
    col.setHex(shirt).convertSRGBToLinear(); this.c0.push(col.r, col.g, col.b);
    col.setHex(pants).convertSRGBToLinear(); this.c1.push(col.r, col.g, col.b);
    col.setHex(skin).convertSRGBToLinear(); this.c2.push(col.r, col.g, col.b);
    col.setHex(hair).convertSRGBToLinear(); this.c3.push(col.r, col.g, col.b);
    this.heads.push(x, y + 1.2 * sc, z);
  };
  CrowdBuilder.prototype.count = function () { return this.off.length / 4; };
  CrowdBuilder.prototype.mesh = function (base, mat) {
    var g = new T.InstancedBufferGeometry();
    g.index = base.index;
    for (var k in base.attributes) g.attributes[k] = base.attributes[k];
    g.setAttribute("aOff", new T.InstancedBufferAttribute(new Float32Array(this.off), 4));
    g.setAttribute("aPar", new T.InstancedBufferAttribute(new Float32Array(this.par), 4));
    g.setAttribute("aC0", new T.InstancedBufferAttribute(new Float32Array(this.c0), 3));
    g.setAttribute("aC1", new T.InstancedBufferAttribute(new Float32Array(this.c1), 3));
    g.setAttribute("aC2", new T.InstancedBufferAttribute(new Float32Array(this.c2), 3));
    g.setAttribute("aC3", new T.InstancedBufferAttribute(new Float32Array(this.c3), 3));
    g.instanceCount = this.count();
    var m = new T.Mesh(g, mat); m.frustumCulled = false; m.userData.arena = true;
    return m;
  };

  /* ------------------------------------------------------------ image-based lighting */
  function buildEnvironment(renderer, useRoom) {
    if (!T.PMREMGenerator) return null;
    var pm = new T.PMREMGenerator(renderer), tex = null;
    try {
      if (useRoom && T.RoomEnvironment) tex = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
      else {
        var es = new T.Scene();
        var basic = function (col, mult, side) { return new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(mult), side: side || T.FrontSide }); };
        es.add(new T.Mesh(new T.SphereGeometry(60, 24, 12), basic(0x0a0e17, 1, T.BackSide)));
        var ring = new T.Mesh(new T.CylinderGeometry(24, 24, 12, 48, 1, true), basic(0x2b2723, 0.55, T.BackSide)); ring.position.y = 2; es.add(ring);
        var floor = new T.Mesh(new T.CircleGeometry(4.6, 8), basic(0xe2e5ea, 0.9)); floor.rotation.x = -PI / 2; floor.position.y = -1.25; es.add(floor);
        var deck = new T.Mesh(new T.RingGeometry(4.6, 9, 8), basic(0x101216, 1)); deck.rotation.x = -PI / 2; deck.position.y = -1.27; es.add(deck);
        for (var k = 0; k < 8; k++) {
          var a = (k + 1) * PI / 4, p = new T.Mesh(new T.PlaneGeometry(3.6, 0.8), basic(0xfff3e4, 9));
          p.position.set(Math.cos(a) * 5.4, 8.2, Math.sin(a) * 5.4); p.lookAt(0, -1.2, 0); es.add(p);
        }
        var key = new T.Mesh(new T.CircleGeometry(1.3, 24), basic(0xffffff, 14)); key.position.y = 11.4; key.rotation.x = PI / 2; es.add(key);
        var led = new T.Mesh(new T.CylinderGeometry(5.9, 5.9, 0.6, 32, 1, true), basic(0x4060b0, 0.6, T.BackSide)); led.position.y = -1.6; es.add(led);
        [-1, 1].forEach(function (s) { var sc = new T.Mesh(new T.PlaneGeometry(14, 8), basic(0x90a6d8, 1.4)); sc.position.set(s * 40, 18, 0); sc.lookAt(0, 1, 0); es.add(sc); });
        tex = pm.fromScene(es, 0.035, 0.1, 100).texture;
      }
    } catch (e) { tex = null; }
    pm.dispose();
    return tex;
  }

  /* ------------------------------------------------------------ the arena */
  function Arena(canvas, opts) {
    opts = opts || {};
    var self = this;
    this.opts = opts;
    this.gpu = probeGPU();
    var forced = forcedQuality(opts);
    var tier = this.tier = forced || guessTier(this.gpu);
    var Q = this.Q = {}; for (var qk in QUALITY[tier]) Q[qk] = QUALITY[tier][qk];
    if (opts.shadow) Q.shadow = Math.min(Q.shadow, opts.shadow);
    this.adaptive = opts.adaptive !== false && !forced;
    var canPost = !!(T.EffectComposer && T.RenderPass && T.ShaderPass && T.CopyShader);
    this.wantPost = canPost && Q.post;

    var renderer = this.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: !this.wantPost, powerPreference: "high-performance", stencil: false });
    this.msaa = !this.wantPost;
    this.baseDpr = Math.min(root.devicePixelRatio || 1, Q.dpr, opts.maxDpr || 2);
    this.dprScale = 1;
    renderer.setPixelRatio(this.baseDpr);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.86;
    renderer.physicallyCorrectLights = true;
    renderer.shadowMap.enabled = true;
    renderer.info.autoReset = false;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    var caps = renderer.capabilities;
    this.aniso = Math.max(1, Math.min(Q.aniso, caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : 1));

    var scene = this.scene = new T.Scene();
    scene.background = new T.Color(0x040509);
    scene.fog = new T.FogExp2(0x040509, 0.0135);
    var cam = this.camera = new T.PerspectiveCamera(34, 1, 0.1, 170);
    cam.position.set(0, 4, 9);

    this.info = normInfo(opts.matchup); this._infoKey = JSON.stringify(this.info);
    this.board = { round: 1, clock: "5:00", shift: 0, flash: 0 };
    this.t = 0; this.flashLevel = 0.004; this.flashRng = rng(99);
    this.mood = { e: 0.2, s: 0.1, p: 0.05, be: 0, bs: 0, wave: 0, flash: 0 };
    this.cssW = Math.max(1, canvas.clientWidth || canvas.width || 300); this.cssH = Math.max(1, canvas.clientHeight || canvas.height || 150);
    this.contacts = []; for (var ci = 0; ci < 16; ci++) this.contacts.push(new T.Vector4(0, 0, 0, 0));
    this.lowPts = [];
    this.U = { uTime: { value: 0 }, uExcite: { value: 0.2 }, uStand: { value: 0.1 }, uWave: { value: 0 }, uHouse: { value: 0.012 }, uSpill: { value: 1.0 }, uScale: { value: 600 }, uPhones: { value: 0.03 }, uFarHouse: { value: 0.045 } };

    this.env = buildEnvironment(renderer, opts.env === "room");
    if (this.env) scene.environment = this.env;

    this.own = function (o) { o.userData.arena = true; scene.add(o); return o; };

    buildLights(this);
    buildCanvas(this);
    buildFence(this);
    buildApron(this);
    buildRig(this);
    buildVenue(this);
    buildStools(this);
    buildFx(this);
    this.setupPost();
    this.quality = tier;
  }

  /* ---- lights ---- */
  function buildLights(A) {
    var Q = A.Q;
    A.own(new T.HemisphereLight(0x33435e, 0x060709, 0.22));
    // overhead key: one shadow-casting spot straight above the canvas, its frustum fitted to the octagon
    var key = A.key = new T.SpotLight(0xfff5ea, 615, 0, 0.48, 0.55, 2);
    key.position.set(0.25, 13.2, 0.45); key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(Q.shadow, Q.shadow);
    key.shadow.camera.near = 9.2; key.shadow.camera.far = 14.0;
    key.shadow.focus = 0.7;
    key.shadow.bias = -0.00018; key.shadow.normalBias = 0.022; key.shadow.radius = 3;
    A.own(key); A.own(key.target);
    // the truss ring: soft spots from every side so the fighters are lit all round
    A.ring = [];
    var n = Q.spots, step = 8 / n;
    for (var i = 0; i < n; i++) {
      var a = (i * step + 1) * PI / 4, px = Math.cos(a) * TRUSS_APO, pz = Math.sin(a) * TRUSS_APO;
      var sp = new T.SpotLight(0xfff1e2, 46 * step, 0, 0.5, 0.85, 2);
      sp.position.set(px, TRUSS_Y - 0.4, pz); sp.target.position.set(-Math.cos(a) * 1.4, 0.6, -Math.sin(a) * 1.4);
      A.own(sp); A.own(sp.target); A.ring.push(sp);
    }
    // corner-coloured rims, low and soft
    A.rims = [];
    [[BLUE_K, 0x5a8fff], [RED_K, 0xff5d50]].forEach(function (c) {
      var va = vertexAngle(c[0]), sp = new T.SpotLight(c[1], 55, 0, 0.36, 0.95, 2);
      sp.position.set(Math.cos(va) * 9.5, 4.6, Math.sin(va) * 9.5); sp.target.position.set(-Math.cos(va) * 0.6, 1.2, -Math.sin(va) * 0.6);
      A.own(sp); A.own(sp.target); A.rims.push(sp);
    });
  }

  /* ---- the canvas ---- */
  function buildCanvas(A) {
    var S = A.Q.mat, c = makeCanvas(S, S);
    A.matCanvas = c;
    paintMat(c.getContext("2d"), S, A.info);
    var tex = A.matTex = canvasTex(c, true, A.aniso);
    tex.repeat.set(1 / (2 * RV), 1 / (2 * RV)); tex.offset.set(0.5, 0.5);
    var weave = weaveNormal(256, 16, A.aniso);
    var wc = makeCanvas(512, 512), wctx = wc.getContext("2d");
    wctx.fillStyle = "#000"; wctx.fillRect(0, 0, 512, 512);
    A.wear = { c: wc, ctx: wctx, tex: canvasTex(wc, false, 1), dirty: false, upT: 0, stampT: 0, decayT: 0 };
    var mat = new T.MeshStandardMaterial({ map: tex, normalMap: weave, normalScale: new T.Vector2(0.32, 0.32), roughness: 0.8, metalness: 0, envMapIntensity: 0.22 });
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uWear = { value: A.wear.tex };
      sh.uniforms.uDetail = { value: 2 * RV / 0.1 };
      sh.uniforms.uContact = { value: A.contacts };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
        .replace("#include <fog_vertex>", "#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D uWear; uniform float uDetail; uniform vec4 uContact[16]; varying vec3 vWPos;")
        .replace("#include <map_fragment>", [
          "#include <map_fragment>",
          "vec4 wear = texture2D(uWear, vUv);",
          "diffuseColor.rgb *= 1.0 - 0.34 * sqrt(clamp(wear.r, 0.0, 1.0));",
          "diffuseColor.rgb *= 1.0 - 0.2 * sqrt(clamp(wear.g, 0.0, 1.0));",
          "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.012, 0.016), clamp(wear.b, 0.0, 1.0) * 0.85);",
          "float occl = 1.0;",
          "for (int ci = 0; ci < 16; ci++) { vec4 cc = uContact[ci]; if (cc.w > 0.0) { float dd = length(vWPos.xz - cc.xy) / cc.z; float f = clamp(1.0 - dd, 0.0, 1.0); occl *= 1.0 - cc.w * f * f * (3.0 - 2.0 * f); } }",
          "diffuseColor.rgb *= occl;"
        ].join("\n"))
        .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness;\nroughnessFactor = mix(roughnessFactor, 0.28, sqrt(clamp(wear.g, 0.0, 1.0)) * 0.9);\nroughnessFactor = mix(roughnessFactor, 0.45, clamp(wear.b, 0.0, 1.0));")
        .replace("#include <normal_fragment_maps>", T.ShaderChunk.normal_fragment_maps.replace("texture2D( normalMap, vUv )", "texture2D( normalMap, vUv * uDetail )"));
      A.matShader = sh;
    };
    mat.customProgramCacheKey = function () { return "fightlab-canvas"; };
    var floor = A.floor = new T.Mesh(new T.ShapeGeometry(octShape(RV)), mat);
    floor.rotation.x = -PI / 2;   // face up; shape (x, y) lands at world (x, -y), mapped back in the UVs
    floor.receiveShadow = true;
    A.own(floor);
  }

  /* ---- fence, posts, pads, gates ---- */
  function vinyl(color, rough) { return new T.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.42 : rough, metalness: 0, envMapIntensity: 0.45 }); }
  function postTexture(base, stripe) {
    var c = makeCanvas(256, 512), ctx = c.getContext("2d");
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 512);
    var r = rng(3);
    for (var i = 0; i < 900; i++) { ctx.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.05)"; ctx.fillRect(r() * 256, r() * 512, 1 + r() * 2, 1 + r() * 3); }
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0, 0, 3, 512);   // the pad's seam at the back
    if (stripe) { ctx.fillStyle = stripe; ctx.fillRect(0, 20, 256, 14); ctx.fillRect(0, 478, 256, 14); }
    ctx.save(); ctx.translate(128, 256); ctx.rotate(-PI / 2);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    fitFont(ctx, "FIGHT LAB", "900", FONT_D, 300, 40);
    ctx.fillStyle = "rgba(240,242,245,0.9)"; ctx.fillText("FIGHT LAB", 0, 0);
    ctx.restore();
    var t = canvasTex(c, true, 4);
    return t;
  }
  function buildFence(A) {
    var g = A.fence = new T.Group(); A.own(g);
    var cl = chainLink(256, 4, A.aniso), meshH = MESH_TOP - MESH_BOT, cell = 0.05, tile = cell * 4;
    cl.normal.repeat.set(SIDE / tile, meshH / tile); cl.alpha.repeat.copy(cl.normal.repeat);
    var fenceMat = new T.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.46, metalness: 0.05, alphaMap: cl.alpha, normalMap: cl.normal, normalScale: new T.Vector2(1.2, 1.2), transparent: true, depthWrite: false, side: T.DoubleSide, envMapIntensity: 0.6 });
    fenceMat.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace("#include <alphamap_fragment>", [
        "#ifdef USE_ALPHAMAP",
        "  float aRaw = texture2D( alphaMap, vUv ).g;",
        "  vec2 tcx = dFdx(vUv * 256.0), tcy = dFdy(vUv * 256.0);",
        "  float lod = 0.5 * log2(max(max(dot(tcx, tcx), dot(tcy, tcy)), 1e-6));",
        "  float aSharp = clamp((aRaw - 0.5) / max(fwidth(aRaw), 1e-3) + 0.5, 0.0, 1.0);",
        "  diffuseColor.a *= mix(aSharp, min(1.0, aRaw * 1.6), smoothstep(0.2, 1.6, lod));",
        "#endif"
      ].join("\n"));
    };
    fenceMat.customProgramCacheKey = function () { return "fightlab-fence"; };
    A.fenceMat = fenceMat;
    var padMat = vinyl(0x0a0b0d, 0.36), metal = new T.MeshStandardMaterial({ color: 0x121316, roughness: 0.4, metalness: 0.6, envMapIntensity: 0.5 });
    var padItems = [], metalItems = [], k, i;
    function place(geo, x, y, z, ry) { return { g: geo, m: new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromAxisAngle(_up, ry || 0), new T.Vector3(1, 1, 1)) }; }
    var railGeo = new T.CylinderGeometry(0.075, 0.075, SIDE - 0.1, 16, 1, true); railGeo.rotateZ(PI / 2);
    var baseGeo = new T.BoxGeometry(SIDE - 0.1, 0.13, 0.12);
    var tubeGeo = new T.CylinderGeometry(0.014, 0.014, SIDE - 0.1, 6, 1, true); tubeGeo.rotateZ(PI / 2);
    for (k = 0; k < 8; k++) {
      var m = sideMid(k);
      var panel = new T.Mesh(new T.PlaneGeometry(SIDE - 0.08, meshH), fenceMat);
      panel.position.set(m.x, (MESH_BOT + MESH_TOP) / 2, m.z); panel.rotation.y = m.rotY; panel.renderOrder = 2; g.add(panel);
      padItems.push(place(railGeo, m.x, RAIL_Y, m.z, m.rotY));
      padItems.push(place(baseGeo, Math.cos(m.a) * (APO + 0.01), 0.065, Math.sin(m.a) * (APO + 0.01), m.rotY));
      // steel tube that carries the mesh at the bottom and top
      [MESH_BOT + 0.01, MESH_TOP - 0.01].forEach(function (yy) { metalItems.push(place(tubeGeo, Math.cos(m.a) * (APO + 0.02), yy, Math.sin(m.a) * (APO + 0.02), m.rotY)); });
      if (GATES.indexOf(k) >= 0) addGate(metalItems, m);
    }
    // padded posts with rounded top pads; the blue and red corners carry their colours
    var prof = [];
    for (i = 0; i <= 14; i++) { var y = i / 14 * 1.7; prof.push(new T.Vector2(POST_R * (1 + 0.035 * Math.sin(PI * i / 14)), y)); }
    var postGeo = new T.LatheGeometry(prof, 20);
    var capProf = [[0.0, 1.66], [0.15, 1.66], [0.158, 1.7], [0.16, 1.76], [0.152, 1.82], [0.128, 1.87], [0.085, 1.9], [0.0, 1.91]].map(function (p) { return new T.Vector2(Math.max(1e-3, p[0]), p[1]); });
    var capGeo = new T.LatheGeometry(capProf, 20);
    var posts = { black: [], blue: [], red: [] }, caps = { black: padItems, blue: [], red: [] };
    for (k = 0; k < 8; k++) {
      var va = vertexAngle(k), kind = k === BLUE_K ? "blue" : (k === RED_K ? "red" : "black"), px = Math.cos(va) * RV, pz = Math.sin(va) * RV;
      posts[kind].push(place(postGeo, px, 0, pz, PI / 2 - va));
      caps[kind].push(place(capGeo, px, 0, pz, 0));
    }
    var texs = { black: postTexture("#101114", null), blue: postTexture("#123a8a", "#e9eef5"), red: postTexture("#8e1a22", "#111111") };
    var capMats = { blue: vinyl(0x163f93, 0.4), red: vinyl(0x951c24, 0.4) };
    ["black", "blue", "red"].forEach(function (kd) {
      g.add(new T.Mesh(mergeGeos(posts[kd]), new T.MeshStandardMaterial({ map: texs[kd], roughness: 0.46, metalness: 0, envMapIntensity: 0.45 })));
      if (kd !== "black") g.add(new T.Mesh(mergeGeos(caps[kd]), capMats[kd]));
    });
    var pads = new T.Mesh(mergeGeos(padItems), padMat); pads.receiveShadow = true; g.add(pads);
    g.add(new T.Mesh(mergeGeos(metalItems), metal));
  }
  function addGate(items, m) {
    var w = 1.12, y0 = MESH_BOT + 0.02, y1 = MESH_TOP - 0.03, r = 0.02;
    var M = new T.Matrix4().compose(new T.Vector3(Math.cos(m.a) * (APO + 0.035), 0, Math.sin(m.a) * (APO + 0.035)), new T.Quaternion().setFromAxisAngle(_up, m.rotY), new T.Vector3(1, 1, 1));
    function push(it) { items.push({ g: it.g, m: M.clone().multiply(it.m) }); }
    function bar(x0, ya, x1, yb) { push(cylBetween(new T.Vector3(x0, ya, 0), new T.Vector3(x1, yb, 0), r, 8)); }
    bar(-w / 2, y0, -w / 2, y1); bar(w / 2, y0, w / 2, y1); bar(-w / 2, y1, w / 2, y1); bar(-w / 2, y0, w / 2, y0); bar(-w / 2, (y0 + y1) / 2, w / 2, (y0 + y1) / 2);
    push(boxAt(0.07, 0.16, 0.06, w / 2 - 0.08, 1.12, 0.04));
    push(boxAt(0.03, 0.03, 0.12, w / 2 - 0.08, 1.12, 0.1));
    [0.35, 1.45].forEach(function (yy) { push({ g: new T.CylinderGeometry(0.026, 0.026, 0.12, 8), m: new T.Matrix4().makeTranslation(-w / 2, yy, 0) }); });
  }

  /* ---- apron, LED skirt, steps ---- */
  function buildApron(A) {
    var shape = octShape(RA); shape.holes.push(octShape(RV, true));
    var deck = new T.Mesh(new T.ShapeGeometry(shape), new T.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.7, metalness: 0, envMapIntensity: 0.2 }));
    deck.rotation.x = -PI / 2; deck.position.y = -0.004; deck.receiveShadow = true; A.own(deck);
    // LED ring boards around the apron
    var lc = makeCanvas(4096, 128), lctx = lc.getContext("2d");
    A.led = { c: lc, ctx: lctx, tex: canvasTex(lc, true, A.aniso), key: "" };
    A.led.tex.wrapS = T.RepeatWrapping;   // shared by the skirt, the table fronts and the bowl ribbons

    drawLED(lctx, 4096, 128, A.info, A.board);
    var ledMat = new T.MeshBasicMaterial({ map: A.led.tex, toneMapped: false, color: new T.Color(1.5, 1.5, 1.5) });
    ledMat.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", [
        "#ifdef USE_MAP",
        "  vec4 texelColor = mapTexelToLinear( texture2D( map, vUv ) );",
        "  vec2 gp = vUv * vec2(2048.0, 64.0);",
        "  vec2 fw = fwidth(gp);",
        "  float fade = clamp(1.6 - max(fw.x, fw.y) * 2.0, 0.0, 1.0);",
        "  vec2 fr = abs(fract(gp) - 0.5);",
        "  float dotm = smoothstep(0.5, 0.3, max(fr.x, fr.y));",
        "  diffuseColor *= texelColor * vec4(vec3(mix(1.0, 0.3 + 0.9 * dotm, fade)), 1.0);",
        "#endif"
      ].join("\n"));
    };
    ledMat.customProgramCacheKey = function () { return "fightlab-led"; };
    A.ledMat = ledMat;
    var top = -0.07, bot = -0.69, pos = [], uv = [], nor = [], idx = [];
    for (var k = 0; k < 8; k++) {
      var a0 = vertexAngle(k), a1 = vertexAngle(k + 1), am = (k + 1) * PI / 4, nx = Math.cos(am), nz = Math.sin(am), b = pos.length / 3;
      var R = RA + 0.005;
      pos.push(Math.cos(a0) * R, top, Math.sin(a0) * R, Math.cos(a1) * R, top, Math.sin(a1) * R, Math.cos(a1) * R, bot, Math.sin(a1) * R, Math.cos(a0) * R, bot, Math.sin(a0) * R);
      // the text reads left to right for someone outside looking in, so run u against the vertex order
      uv.push((8 - k) / 8, 1, (7 - k) / 8, 1, (7 - k) / 8, 0, (8 - k) / 8, 0);
      for (var q = 0; q < 4; q++) nor.push(nx, 0, nz);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    var lg = new T.BufferGeometry();
    lg.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); lg.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); lg.setAttribute("normal", new T.Float32BufferAttribute(nor, 3)); lg.setIndex(idx);
    A.own(new T.Mesh(lg, ledMat));
    // skirt above and below the LEDs
    var skirtMat = new T.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.85, side: T.DoubleSide, envMapIntensity: 0.1 });
    var sk = new T.Mesh(new T.CylinderGeometry(RA, RA, -FLOOR_Y, 8, 1, true, PI / 2 - PI / 8), skirtMat);
    sk.position.y = FLOOR_Y / 2; A.own(sk);
    var trim = new T.Mesh(new T.CylinderGeometry(RA + 0.012, RA + 0.012, 0.05, 8, 1, true, PI / 2 - PI / 8), vinyl(0x1a1c20, 0.35)); trim.position.y = -0.03; A.own(trim);
    // steps up to each gate, with safety edging
    var stepMat = new T.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.7, envMapIntensity: 0.1 }), edge = new T.MeshStandardMaterial({ color: 0x6d7178, roughness: 0.5, envMapIntensity: 0.2 });
    GATES.forEach(function (gk) {
      var m = sideMid(gk);
      for (var s = 0; s < 3; s++) {
        var h = -FLOOR_Y * (3 - s) / 4, d = RAPO + 0.2 + s * 0.38;
        var st = new T.Mesh(new T.BoxGeometry(1.5, h, 0.38), stepMat);
        st.position.set(Math.cos(m.a) * d, FLOOR_Y + h / 2, Math.sin(m.a) * d); st.rotation.y = m.rotY; A.own(st);
        var ed = new T.Mesh(new T.BoxGeometry(1.5, 0.012, 0.05), edge);
        ed.position.set(Math.cos(m.a) * (d + 0.165), FLOOR_Y + h + 0.006, Math.sin(m.a) * (d + 0.165)); ed.rotation.y = m.rotY; A.own(ed);
      }
    });
  }

  /* ---- overhead rig: truss, fixtures, light shafts, speakers, centre-hung screen ---- */
  function buildRig(A) {
    var items = [], TRV = TRUSS_APO / Math.cos(PI / 8), hw = 0.2, k, b;
    for (k = 0; k < 8; k++) {
      var a0 = vertexAngle(k), a1 = vertexAngle(k + 1), am = (k + 1) * PI / 4;
      var p0 = new T.Vector3(Math.cos(a0) * TRV, TRUSS_Y, Math.sin(a0) * TRV), p1 = new T.Vector3(Math.cos(a1) * TRV, TRUSS_Y, Math.sin(a1) * TRV);
      var out = new T.Vector3(Math.cos(am), 0, Math.sin(am));
      var cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (c) { return new T.Vector3().addScaledVector(out, c[0] * hw).add(new T.Vector3(0, c[1] * hw, 0)); });
      cs.forEach(function (c) { items.push(cylBetween(p0.clone().add(c), p1.clone().add(c), 0.026, 6)); });
      var len = p0.distanceTo(p1), bays = Math.round(len / 0.42);
      for (var f = 0; f < 4; f++) {
        var c1 = cs[f], c2 = cs[(f + 1) % 4];
        for (b = 0; b < bays; b++) {
          var t0 = b / bays, t1 = (b + 1) / bays;
          var q0 = new T.Vector3().lerpVectors(p0, p1, t0).add(b % 2 ? c1 : c2), q1 = new T.Vector3().lerpVectors(p0, p1, t1).add(b % 2 ? c2 : c1);
          items.push(cylBetween(q0, q1, 0.011, 4));
        }
      }
      items.push(boxAt(0.46, 0.46, 0.46, p0.x, p0.y, p0.z, -a0));
    }
    var trussMat = new T.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.38, metalness: 0.85, envMapIntensity: 1.4 });
    A.own(new T.Mesh(mergeGeos(items), trussMat));
    // fixtures: cans hanging under the truss, each aimed at the canvas, with a hot lens and a light shaft
    var fx = [], lens = [], shafts = [], housing = new T.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.5, metalness: 0.5 });
    var lensMat = new T.MeshBasicMaterial({ color: new T.Color(1.0, 0.95, 0.88).multiplyScalar(7), toneMapped: false, fog: false });
    var shaftMat = new T.ShaderMaterial({ uniforms: { uColor: { value: new T.Color(1.0, 0.94, 0.86) }, uIntensity: { value: 0.012 }, uTime: A.U.uTime, uLen: { value: 1 } }, vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    A.shaftMat = shaftMat;
    for (k = 0; k < 8; k++) {
      var amk = (k + 1) * PI / 4, tx = -Math.sin(amk), tz = Math.cos(amk);
      for (var j = -1; j <= 1; j++) {
        var base = new T.Vector3(Math.cos(amk) * TRUSS_APO + tx * j * 1.25, TRUSS_Y - hw - 0.26, Math.sin(amk) * TRUSS_APO + tz * j * 1.25);
        var aim = new T.Vector3(-Math.cos(amk) * 1.2 + tx * j * 0.9, 0, -Math.sin(amk) * 1.2 + tz * j * 0.9);
        var dir = new T.Vector3().subVectors(aim, base).normalize();
        var qq = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), dir);
        var mat4 = new T.Matrix4().compose(base, qq, new T.Vector3(1, 1, 1));
        var can = new T.CylinderGeometry(0.15, 0.12, 0.36, 12, 1, false); can.translate(0, 0.02, 0);
        fx.push({ g: can, m: mat4 });
        var yoke = new T.BoxGeometry(0.36, 0.04, 0.05); yoke.translate(0, 0.26, 0);
        fx.push({ g: yoke, m: mat4.clone() });
        var lg = new T.CircleGeometry(0.115, 16); lg.rotateX(PI / 2); lg.translate(0, -0.161, 0);
        lens.push({ g: lg, m: mat4.clone() });
        if (j !== 0 || k % 2 === 0) {
          var L = base.distanceTo(aim) * 0.82;
          var cone = new T.CylinderGeometry(0.1, 0.1 + L * 0.15, L, 20, 1, true); cone.translate(0, -L / 2, 0);
          var sm = new T.Mesh(cone, shaftMat.clone());
          sm.material.uniforms.uLen.value = L; sm.material.uniforms.uTime = A.U.uTime;
          sm.position.copy(base); sm.quaternion.copy(qq); sm.renderOrder = 3; sm.userData.arena = true;
          shafts.push(sm);
        }
      }
    }
    A.own(new T.Mesh(mergeGeos(fx), housing));
    A.own(new T.Mesh(mergeGeos(lens), lensMat));
    var sg = A.shafts = new T.Group(); shafts.forEach(function (s) { sg.add(s); }); A.own(sg);
    // speakers: four line arrays on the outside corners, plus hoist chains into the dark roof
    var spk = [], chains = [];
    for (k = 0; k < 4; k++) {
      var sa = PI / 4 + k * PI / 2, sx = Math.cos(sa) * 7.6, sz = Math.sin(sa) * 7.6, yaw = -sa - PI / 2;
      for (var e = 0; e < 7; e++) {
        var tilt = 0.05 + e * e * 0.012, y = 12.2 - e * 0.3 - e * e * 0.008;
        var bx = new T.BoxGeometry(1.0, 0.27, 0.6);
        var mm = new T.Matrix4().compose(new T.Vector3(sx + Math.cos(sa) * e * e * 0.008, y, sz + Math.sin(sa) * e * e * 0.008), new T.Quaternion().setFromEuler(new T.Euler(tilt, yaw + PI / 2, 0, "YXZ")), new T.Vector3(1, 1, 1));
        spk.push({ g: bx, m: mm });
      }
      spk.push(boxAt(1.2, 0.08, 0.3, sx, 12.45, sz, yaw + PI / 2));
      chains.push(cylBetween(new T.Vector3(sx, 12.5, sz), new T.Vector3(sx, 30, sz), 0.012, 4));
    }
    for (k = 0; k < 8; k++) { var cv = vertexAngle(k), crx = Math.cos(cv) * TRV, crz = Math.sin(cv) * TRV; chains.push(cylBetween(new T.Vector3(crx, TRUSS_Y + 0.23, crz), new T.Vector3(crx, 30, crz), 0.012, 4)); }
    var dark = new T.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.8, envMapIntensity: 0.2 });
    A.own(new T.Mesh(mergeGeos(spk), dark));
    A.own(new T.Mesh(mergeGeos(chains), housing));
    // centre-hung video board above the truss
    var sc = makeCanvas(768, 432), sctx = sc.getContext("2d");
    A.screen = { c: sc, ctx: sctx, tex: canvasTex(sc, true, A.aniso) };
    drawScreen(sctx, 768, 432, A.info, A.board);
    var scrMat = new T.MeshBasicMaterial({ map: A.screen.tex, toneMapped: false, fog: false, color: new T.Color(1.25, 1.25, 1.25) });
    var hub = new T.Group(); hub.position.y = 16.2; hub.userData.arena = true;
    var core = new T.Mesh(new T.BoxGeometry(6.2, 3.6, 6.2), dark); hub.add(core);
    for (k = 0; k < 4; k++) {
      var face = new T.Mesh(new T.PlaneGeometry(5.9, 3.32), scrMat), fa = k * PI / 2;
      face.position.set(Math.sin(fa) * 3.11, 0, Math.cos(fa) * 3.11); face.rotation.y = fa; hub.add(face);
    }
    var ringLed = new T.Mesh(new T.CylinderGeometry(4.35, 4.35, 0.35, 4, 1, true, PI / 4), A.ledMat); ringLed.position.y = -2.1; hub.add(ringLed);
    A.own(hub);
    A.scrMat = scrMat;
  }

  /* ---- venue: floor, cage-side tables, officials, seating bowl, crowd, screens ---- */
  function buildVenue(A) {
    var Q = A.Q, r = rng(7);
    var floor = new T.Mesh(new T.PlaneGeometry(220, 220), new T.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.5, metalness: 0, envMapIntensity: 0.05 }));
    floor.rotation.x = -PI / 2; floor.position.y = FLOOR_Y; floor.receiveShadow = false; A.own(floor);
    var crowdMat = A.crowdMat = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, {}]), vertexShader: CROWD_VS, fragmentShader: CROWD_FS, fog: true
    });
    ["uTime", "uExcite", "uStand", "uWave", "uHouse", "uSpill"].forEach(function (u) { crowdMat.uniforms[u] = A.U[u]; });
    var base = personGeometry();
    var near = new CrowdBuilder(), far = [], farCol = [], farSkin = [], farPar = [], heads = [];

    // cage-side tables with officials, judges and the commentary desk
    var tableMat = new T.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.9, envMapIntensity: 0.08 }), bezel = new T.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.45, metalness: 0.3, envMapIntensity: 0.15 });
    var monMat = new T.MeshBasicMaterial({ color: new T.Color(0.55, 0.66, 0.9).multiplyScalar(1.6), toneMapped: false });
    var tItems = [], mItems = [], sItems = [], fronts = [];
    var tables = [[0, 7.5, 4.8], [PI, 7.5, 4.8], [3 * PI / 4, 7.7, 3.6], [-PI / 4, 7.7, 3.6], [PI / 4, 7.7, 3.6], [-3 * PI / 4, 7.7, 3.6]];
    tables.forEach(function (tb, ti) {
      var a = tb[0], d = tb[1], L = tb[2], cx = Math.cos(a) * d, cz = Math.sin(a) * d, yaw = PI / 2 - a, ty = FLOOR_Y + 0.75;
      tItems.push(boxAt(L, 0.05, 0.75, cx, ty, cz, yaw));
      var fx = Math.cos(a) * (d - 0.37), fz = Math.sin(a) * (d - 0.37);
      fronts.push([fx, fz, yaw, L]);
      var nSeats = Math.floor(L / 0.85);
      for (var s = 0; s < nSeats; s++) {
        var off = (s - (nSeats - 1) / 2) * 0.85, px = cx - Math.sin(a) * off, pz = cz + Math.cos(a) * off;
        // monitor facing the official, lit screen on the far side from the cage
        var mx = px - Math.cos(a) * 0.08, mz = pz - Math.sin(a) * 0.08;
        sItems.push(boxAt(0.56, 0.36, 0.04, mx, ty + 0.25, mz, yaw));
        var scr = new T.PlaneGeometry(0.52, 0.31);
        mItems.push({ g: scr, m: new T.Matrix4().compose(new T.Vector3(mx + Math.cos(a) * 0.022, ty + 0.25, mz + Math.sin(a) * 0.022), new T.Quaternion().setFromAxisAngle(_up, PI / 2 - a), new T.Vector3(1, 1, 1)) });
        sItems.push(boxAt(0.06, 0.2, 0.06, mx, ty + 0.1, mz, yaw));
        var sx = Math.cos(a) * (d + 0.62) - Math.sin(a) * off, sz = Math.sin(a) * (d + 0.62) + Math.cos(a) * off;
        var suit = ti < 2 && s % 2 === 0 ? 0xd9dadc : (r() < 0.75 ? 0x111317 : 0x23262c);
        near.add(sx, FLOOR_Y, sz, Math.atan2(-sx, -sz), r, { shirt: suit, pants: 0x121316, stand: 5, excite: ti < 2 ? 0.15 : 0.05 });
      }
    });
    A.own(new T.Mesh(mergeGeos(tItems), tableMat));
    A.own(new T.Mesh(mergeGeos(sItems), bezel));
    A.own(new T.Mesh(mergeGeos(mItems), monMat));
    // table fronts carry the LED graphics too
    var fpos = [], fuv = [], fidx = [];
    fronts.forEach(function (f, i) {
      var b = fpos.length / 3, ca = Math.cos(f[2]), sa = Math.sin(f[2]), hl = f[3] / 2, y0 = FLOOR_Y + 0.08, y1 = FLOOR_Y + 0.72;
      // local +X along the table: (cos yaw, 0, -sin yaw)
      var ex = ca * hl, ez = -sa * hl;
      fpos.push(f[0] + ex, y1, f[1] + ez, f[0] - ex, y1, f[1] - ez, f[0] - ex, y0, f[1] - ez, f[0] + ex, y0, f[1] + ez);
      var u0 = (i % 8) / 8, u1 = u0 + 1 / 8;
      fuv.push(u0, 1, u1, 1, u1, 0, u0, 0);
      fidx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    var fg = new T.BufferGeometry(); fg.setAttribute("position", new T.Float32BufferAttribute(fpos, 3)); fg.setAttribute("uv", new T.Float32BufferAttribute(fuv, 2)); fg.setIndex(fidx);
    var fm = new T.Mesh(fg, A.ledMat); fm.material.side = T.DoubleSide; A.own(fm);

    // seating bowl rows: floor seats, lower bowl, ribbon board, upper bowl
    var rows = [], i;
    for (i = 0; i < 8; i++) rows.push({ r: 9.2 + i * 0.95, y: FLOOR_Y + i * 0.07, sec: "floor", i: i });
    var R0 = 16.4, Y0 = FLOOR_Y + 2.3;
    for (i = 0; i < 20; i++) rows.push({ r: R0 + 0.45 + i * 0.86, y: Y0 + i * 0.43, sec: "lower", i: i, tread: [R0 + i * 0.86, 0.86, Y0 + i * 0.43, 0.43] });
    var R1 = R0 + 20 * 0.86 + 1.3, Y1 = Y0 + 20 * 0.43 + 2.6;
    for (i = 0; i < 14; i++) rows.push({ r: R1 + 0.4 + i * 0.8, y: Y1 + i * 0.54, sec: "upper", tread: [R1 + i * 0.8, 0.8, Y1 + i * 0.54, 0.54] });
    var tmp = [0, 0];
    function inAisle(a, rr, wide) {
      for (var q = 0; q < 16; q++) { var aa = (q + 0.5) * TAU / 16, dd = Math.abs(Math.atan2(Math.sin(a - aa), Math.cos(a - aa))) * rr; if (dd < (wide ? 0.9 : 0.55)) return true; }
      if (wide) { var g1 = Math.abs(Math.atan2(Math.sin(a - PI / 2), Math.cos(a - PI / 2))) * rr, g2 = Math.abs(Math.atan2(Math.sin(a + PI / 2), Math.cos(a + PI / 2))) * rr, g3 = Math.abs(Math.atan2(Math.sin(a - PI), Math.cos(a - PI))) * rr; if (g1 < 1.3 || g2 < 1.3 || g3 < 1.6) return true; }
      return false;
    }
    rows.forEach(function (row, ri) {
      var N = 1440, prev = sq(0, row.r, [0, 0]), acc = 0, next = 0.28, sp = 0.56;
      var as3d = (row.sec === "floor" && row.i < Q.floor3d) || (row.sec === "lower" && row.i < Q.rows3d);
      var occ = row.sec === "floor" ? 0.97 : (row.sec === "lower" ? 0.93 : 0.86);
      for (var j = 1; j <= N; j++) {
        var a = j / N * TAU, p = sq(a, row.r, [0, 0]), dl = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        acc += dl;
        while (acc >= next) {
          var f = 1 - (acc - next) / dl, x = prev[0] + (p[0] - prev[0]) * f, z = prev[1] + (p[1] - prev[1]) * f;
          next += sp;
          if (inAisle(Math.atan2(z / AZ, x / AX), row.r, row.sec === "floor") || r() > occ) continue;
          if (as3d) near.add(x, row.y, z, Math.atan2(-x, -z), r);
          else if (r() < Q.upper || row.sec !== "upper") {
            var col = new T.Color(wpick(SHIRTS, r)).convertSRGBToLinear(), sk = new T.Color(wpick(SKINS, r)).convertSRGBToLinear();
            far.push(x, row.y + 0.95 + r() * 0.08, z); farCol.push(col.r, col.g, col.b); farSkin.push(sk.r, sk.g, sk.b); farPar.push(r(), 0.78 + r() * 0.1);
            heads.push(x, row.y + 1.15, z);
          }
        }
        prev = p;
      }
    });
    A.crowd = near.mesh(base, crowdMat); A.own(A.crowd);
    A.crowdCount = near.count();
    heads = near.heads.concat(heads);
    if (far.length) {
      var pg = new T.BufferGeometry();
      pg.setAttribute("position", new T.Float32BufferAttribute(far, 3)); pg.setAttribute("aC0", new T.Float32BufferAttribute(farCol, 3));
      pg.setAttribute("aC2", new T.Float32BufferAttribute(farSkin, 3)); pg.setAttribute("aPar", new T.Float32BufferAttribute(farPar, 2));
      var farMat = new T.ShaderMaterial({ uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, {}]), vertexShader: FAR_VS, fragmentShader: FAR_FS, fog: true });
      ["uTime", "uExcite", "uScale", "uSpill"].forEach(function (u) { farMat.uniforms[u] = A.U[u]; }); farMat.uniforms.uHouse = A.U.uFarHouse;
      var pts = new T.Points(pg, farMat); pts.frustumCulled = false; A.own(pts); A.farCrowd = pts;
    }
    A.heads = heads;

    // tiers, seat backs, walls
    var tp = [], tn = [], bp = [], bn = [], M = 220;
    function quad(arr, nar, a, b, c, d, n) { arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); for (var q = 0; q < 6; q++) nar.push(n[0], n[1], n[2]); }
    function ringStrip(arr, nar, r0, r1, y0, y1, vertical) {
      for (var j = 0; j < M; j++) {
        var a0 = j / M * TAU, a1 = (j + 1) / M * TAU, p0 = sq(a0, r0, [0, 0]), p1 = sq(a1, r0, [0, 0]), q0 = sq(a0, r1, [0, 0]), q1 = sq(a1, r1, [0, 0]);
        if (vertical) { var nx = -(p0[0] + p1[0]), nz = -(p0[1] + p1[1]), l = Math.hypot(nx, nz); quad(arr, nar, [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [nx / l, 0, nz / l]); }
        else quad(arr, nar, [p0[0], y0, p0[1]], [q0[0], y0, q0[1]], [q1[0], y0, q1[1]], [p1[0], y0, p1[1]], [0, 1, 0]);
      }
    }
    rows.forEach(function (row) {
      if (!row.tread) return;
      var t = row.tread;
      ringStrip(tp, tn, t[0], t[0] + t[1], t[2], t[2], false);
      ringStrip(tp, tn, t[0] + t[1], 0, t[2], t[2] + t[3], true);
      ringStrip(bp, bn, t[0] + t[1] * 0.78, 0, t[2], t[2] + 0.48, true);
    });
    ringStrip(tp, tn, R0, 0, FLOOR_Y, Y0, true);
    var Ytop = Y0 + 20 * 0.43;
    ringStrip(tp, tn, R0 + 20 * 0.86, R1, Ytop, Ytop, false);
    ringStrip(tp, tn, R1 + 14 * 0.8, 0, Y1 + 14 * 0.54, Y1 + 14 * 0.54 + 6, true);
    function geo(p, n) { var g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(p, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(n, 3)); return g; }
    A.own(new T.Mesh(geo(tp, tn), new T.MeshStandardMaterial({ color: 0x111317, roughness: 0.9, envMapIntensity: 0.03 })));
    A.own(new T.Mesh(geo(bp, bn), new T.MeshStandardMaterial({ color: 0x24121a, roughness: 0.8, envMapIntensity: 0.03, side: T.DoubleSide })));
    // LED ribbons: the front of the lower bowl and the fascia between the bowls
    function ribbon(rr, y0, y1) {
      var p = [], u = [], ix = [], n = [], per = 0, q0 = sq(0, rr, [0, 0]);
      for (var jj = 1; jj <= M; jj++) { var qq = sq(jj / M * TAU, rr, [0, 0]); per += Math.hypot(qq[0] - q0[0], qq[1] - q0[1]); q0 = qq; }
      var reps = Math.max(1, Math.round(per / (8 * 4 * (y1 - y0))));   // keep each LED segment at its 4:1 shape
      for (var j = 0; j <= M; j++) { var a = j / M * TAU, q = sq(a, rr, [0, 0]); p.push(q[0], y1, q[1], q[0], y0, q[1]); u.push(j / M * reps, 1, j / M * reps, 0); n.push(-q[0], 0, -q[1], -q[0], 0, -q[1]); if (j < M) ix.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2); }
      var g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(p, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(u, 2)); g.setAttribute("normal", new T.Float32BufferAttribute(n, 3)); g.setIndex(ix);
      return g;
    }
    var ribMat = new T.MeshBasicMaterial({ map: A.led.tex, toneMapped: false, color: new T.Color(1.15, 1.15, 1.15), side: T.DoubleSide });
    A.own(new T.Mesh(ribbon(R0 - 0.02, Y0 - 1.0, Y0 - 0.15), ribMat));
    A.own(new T.Mesh(ribbon(R1 - 0.05, Ytop + 0.9, Ytop + 2.1), ribMat));
    A.ribMat = ribMat;
    // end-wall video boards above the upper bowl
    [-1, 1].forEach(function (s) {
      var q = sq(s < 0 ? PI : 0, R1 + 14 * 0.8 - 1, [0, 0]);
      var scr = new T.Mesh(new T.PlaneGeometry(13, 7.3), A.scrMat);
      scr.position.set(q[0], Y1 + 14 * 0.54 + 5.5, 0); scr.lookAt(0, Y1, 0); scr.userData.arena = true; A.own(scr);
    });
  }

  /* ---- stools and cornermen for the breaks ---- */
  function buildStools(A) {
    var stoolMat = new T.MeshStandardMaterial({ color: 0x15171b, roughness: 0.45, metalness: 0.4 });
    var chrome = new T.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.25, metalness: 0.9 });
    A.stools = {};
    var r = rng(17), corner = new CrowdBuilder();
    [["A", BLUE_K, 0x1d3f8a], ["B", RED_K, 0x8a2222]].forEach(function (s) {
      var g = new T.Group(), va = vertexAngle(s[1]);
      g.position.set(Math.cos(va) * (RV - 0.62), 0, Math.sin(va) * (RV - 0.62));
      var seat = new T.Mesh(new T.CylinderGeometry(0.21, 0.19, 0.07, 20), stoolMat); seat.position.y = 0.44; seat.castShadow = true; g.add(seat);
      for (var l = 0; l < 3; l++) {
        var la = l * TAU / 3, leg = new T.Mesh(new T.CylinderGeometry(0.014, 0.016, 0.45, 6), chrome);
        leg.position.set(Math.cos(la) * 0.13, 0.22, Math.sin(la) * 0.13); leg.rotation.set(Math.sin(la) * 0.25, 0, -Math.cos(la) * 0.25); leg.castShadow = true; g.add(leg);
      }
      g.visible = false; A.own(g); A.stools[s[0]] = g;
      // cornermen wait on the apron behind the post
      for (var c = -1; c <= 1; c++) {
        var ca = va + c * 0.16, cx = Math.cos(ca) * (RV + 0.55), cz = Math.sin(ca) * (RV + 0.55);
        corner.add(cx, 0, cz, Math.atan2(-cx, -cz), r, { shirt: c === 0 ? 0xd8dadd : s[2], stand: -1, excite: 0.1 });
      }
    });
    A.corner = corner.mesh(personGeometry(), A.crowdMat); A.corner.visible = false; A.own(A.corner);
  }

  /* ---- camera flashes and phone screens ---- */
  function buildFx(A) {
    var heads = A.heads, nh = heads.length / 3, r = rng(23);
    var NF = 380, fpos = new Float32Array(NF * 3), fcol = new Float32Array(NF * 3);
    for (var f = 0; f < NF; f++) { var h = Math.floor(r() * nh) * 3; fpos[f * 3] = heads[h]; fpos[f * 3 + 1] = heads[h + 1] + 0.25; fpos[f * 3 + 2] = heads[h + 2]; }
    var fg = new T.BufferGeometry();
    fg.setAttribute("position", new T.BufferAttribute(fpos, 3));
    fg.setAttribute("color", new T.BufferAttribute(fcol, 3));
    var sc = makeCanvas(64, 64), ctx = sc.getContext("2d"), g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.8)"); g.addColorStop(0.45, "rgba(200,220,255,0.18)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    var spark = canvasTex(sc, true, 1);
    A.flashes = new T.Points(fg, new T.PointsMaterial({ size: 0.7, map: spark, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true, toneMapped: false, fog: false }));
    A.flashes.frustumCulled = false;
    A.own(A.flashes);
    var NP = Math.min(2600, nh), pp = new Float32Array(NP * 3), pr = new Float32Array(NP);
    for (var i = 0; i < NP; i++) { var hh = Math.floor(r() * nh) * 3; pp[i * 3] = heads[hh] * 0.985; pp[i * 3 + 1] = heads[hh + 1] + 0.32; pp[i * 3 + 2] = heads[hh + 2] * 0.985; pr[i] = r(); }
    var pg = new T.BufferGeometry(); pg.setAttribute("position", new T.BufferAttribute(pp, 3)); pg.setAttribute("aRand", new T.BufferAttribute(pr, 1));
    var pm = new T.ShaderMaterial({ uniforms: { uScale: A.U.uScale, uPhones: A.U.uPhones, uTime: A.U.uTime }, vertexShader: PHONE_VS, fragmentShader: PHONE_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    A.phones = new T.Points(pg, pm); A.phones.frustumCulled = false; A.own(A.phones);
  }

  /* ------------------------------------------------------------ post-processing */
  Arena.prototype.setupPost = function () {
    this.composer = null; this.postOn = false; this.bloom = null; this.smaa = null; this.fxaa = null;
    if (!this.wantPost) return;
    try {
      var r = this.renderer, gl = r.getContext(), caps = r.capabilities;
      var half = !!(caps.isWebGL2 && (gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float")));
      var w = Math.max(2, Math.round(this.cssW * r.getPixelRatio())), h = Math.max(2, Math.round(this.cssH * r.getPixelRatio()));
      var rt = new T.WebGLRenderTarget(w, h, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, type: half ? T.HalfFloatType : T.UnsignedByteType, stencilBuffer: false });
      if (!half) rt.texture.encoding = T.sRGBEncoding;   // 8-bit: store display-referred values, no banding in the darks
      this.linearPost = half;
      var comp = new T.EffectComposer(r, rt);
      comp.addPass(new T.RenderPass(this.scene, this.camera));
      if (T.UnrealBloomPass && T.LuminosityHighPassShader) {
        var bl = this.bloom = new T.UnrealBloomPass(new T.Vector2(w, h), 0.32, 0.55, half ? 0.86 : 0.9);
        var scale = this.Q.bloom || 0.5, set0 = bl.setSize.bind(bl);
        bl.setSize = function (ww, hh) { set0(Math.max(2, Math.round(ww * scale)), Math.max(2, Math.round(hh * scale))); };
        if (half) [bl.renderTargetBright].concat(bl.renderTargetsHorizontal, bl.renderTargetsVertical).forEach(function (t) { if (t) t.texture.type = T.HalfFloatType; });
        bl.enabled = this.Q.bloom > 0;
        comp.addPass(bl);
      }
      var fin = this.finish = new T.ShaderPass(FinishShader);
      fin.uniforms.uLinear.value = half ? 1 : 0;
      comp.addPass(fin);
      if (T.SMAAPass) { this.smaa = new T.SMAAPass(w, h); comp.addPass(this.smaa); }
      if (T.FXAAShader) { this.fxaa = new T.ShaderPass(T.FXAAShader); comp.addPass(this.fxaa); }
      this.composer = comp; this.postOn = true;
      this.applyAA();
      this.resize(this.cssW, this.cssH);
    } catch (e) {
      this.composer = null; this.postOn = false;
      if (root.console) console.warn("FightArena: post-processing unavailable, rendering directly", e);
    }
  };
  Arena.prototype.applyAA = function () {
    var want = this.Q.aa;
    if (this.smaa) this.smaa.enabled = want === "smaa";
    if (this.fxaa) this.fxaa.enabled = want === "fxaa" || (want === "smaa" && !this.smaa) || (want === "msaa" && !this.msaa);
  };

  /* ------------------------------------------------------------ runtime */
  Arena.prototype.resize = function (w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    this.cssW = w; this.cssH = h;
    var r = this.renderer;
    r.setPixelRatio(Math.max(0.5, this.baseDpr * this.dprScale));
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    var pr = r.getPixelRatio();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      if (this.finish) this.finish.uniforms.uRes.value.set(w * pr, h * pr);
    }
    this.U.uScale.value = h * pr / (2 * Math.tan(this.camera.fov * PI / 360));
  };

  Arena.prototype.setMatchup = function (o) {
    var n = normInfo(o), k = JSON.stringify(n);
    if (k === this._infoKey) return;
    this._infoKey = k; this.info = n;
    this.repaintMat();
  };
  Arena.prototype.repaintMat = function () {
    var S = this.matCanvas.width;
    paintMat(this.matCanvas.getContext("2d"), S, this.info); this.matTex.needsUpdate = true;
    this.led.key = ""; this.updateBoards(true);
  };
  Arena.prototype.setBoard = function (o) {
    if (o.round != null) this.board.round = o.round;
    if (o.clock != null) this.board.clock = typeof o.clock === "number" ? fmtClock(o.clock) : o.clock;
    this.updateBoards(false);
  };
  function fmtClock(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  Arena.prototype.updateBoards = function (force) {
    var b = this.board, key = b.round + "|" + b.clock + "|" + b.shift + "|" + (b.flash > 0.08 ? Math.round(b.flash * 6) : 0) + "|" + this.info.a + this.info.b;
    if (!force && key === this.led.key) return;
    this.led.key = key;
    drawLED(this.led.ctx, this.led.c.width, this.led.c.height, this.info, b);
    this.led.tex.needsUpdate = true;
    drawScreen(this.screen.ctx, this.screen.c.width, this.screen.c.height, this.info, b);
    this.screen.tex.needsUpdate = true;
  };

  // wear on the canvas: scuffs (R), sweat (G) and blood (B), painted into a small map the canvas shader reads
  Arena.prototype.mark = function (x, z, kind, amount) {
    var W = this.wear, S = W.c.width, k = S / (2 * RV), ctx = W.ctx;
    var px = S / 2 + x * k, py = S / 2 + z * k, a = clamp(amount == null ? 0.3 : amount, 0, 1);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    if (kind === "sweat") {
      var rr = (0.18 + 0.25 * a) * k, g = ctx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, "rgba(0," + Math.round(90 * a + 20) + ",0,1)"); g.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(px, py, rr, rr * (0.6 + Math.random() * 0.4), Math.random() * PI, 0, TAU); ctx.fill();
    } else if (kind === "drip") {
      var dr0 = (0.015 + 0.03 * a) * k;
      ctx.fillStyle = "rgb(0," + Math.round(70 + 120 * a) + ",0)"; ctx.beginPath(); ctx.arc(px, py, dr0, 0, TAU); ctx.fill();
    } else if (kind === "blood") {
      ctx.fillStyle = "rgba(0,0,0,1)";
      for (var i = 0; i < 6; i++) { var dr = (0.01 + Math.random() * 0.03) * k; ctx.fillStyle = "rgb(0,0," + Math.round(160 + 90 * a) + ")"; ctx.beginPath(); ctx.arc(px + (Math.random() - 0.5) * 0.25 * k, py + (Math.random() - 0.5) * 0.25 * k, dr, 0, TAU); ctx.fill(); }
    } else {
      var ang = Math.random() * TAU, len = (0.06 + 0.16 * a) * k;
      ctx.strokeStyle = "rgb(" + Math.round(22 + 50 * a) + ",0,0)"; ctx.lineWidth = Math.max(1.2, (0.03 + 0.03 * Math.random()) * k); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(px - Math.cos(ang) * len, py - Math.sin(ang) * len); ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); ctx.stroke();
    }
    ctx.restore();
    W.dirty = true;
  };

  Arena.prototype.resetWear = function () {
    var W = this.wear; W.ctx.save(); W.ctx.globalCompositeOperation = "source-over"; W.ctx.fillStyle = "#000"; W.ctx.fillRect(0, 0, W.c.width, W.c.height); W.ctx.restore();
    W.tex.needsUpdate = true; W.dirty = false; this._blood = 0;
  };

  // feet, knees and bodies on the canvas: contact shadows every frame, wear a few times a second
  var _v = new T.Vector3();
  Arena.prototype.trackActors = function () {
    var sc = this.scene, C = this.contacts, n = 0, low = this.lowPts;
    low.length = 0;
    for (var i = 0; i < sc.children.length && n < 15; i++) {
      var o = sc.children[i];
      if (o.userData.arena || !o.visible || o.isLight || o.isCamera) continue;
      o.updateMatrixWorld();
      var cnt = 0, sx = 0, sz = 0, sy = 0, clusters = [];
      o.traverse(function (d) {
        if (!(d.isMesh || d.isBone) || d.isSkinnedMesh || !d.visible) return;
        _v.setFromMatrixPosition(d.matrixWorld);
        cnt++; sx += _v.x; sz += _v.z; sy += _v.y;
        if (_v.y < 0.32 && Math.abs(_v.x) < RV && Math.abs(_v.z) < RV) {
          for (var c = 0; c < clusters.length; c++) { var cl = clusters[c]; if (Math.hypot(cl[0] / cl[3] - _v.x, cl[1] / cl[3] - _v.z) < 0.24) { cl[0] += _v.x; cl[1] += _v.z; cl[2] = Math.min(cl[2], _v.y); cl[3]++; return; } }
          clusters.push([_v.x, _v.z, _v.y, 1]);
        }
      });
      if (!cnt) continue;
      var cy = sy / cnt;
      C[n++].set(sx / cnt, sz / cnt, 0.85, clamp(0.34 - cy * 0.14, 0.12, 0.34));
      clusters.sort(function (u, w) { return u[2] - w[2]; });   // the lowest contacts first, four per actor
      for (var c2 = 0; c2 < clusters.length && c2 < 4 && n < 16; c2++) {
        var q = clusters[c2], s = clamp(1 - q[2] / 0.32, 0, 1);
        C[n++].set(q[0] / q[3], q[1] / q[3], 0.2 + 0.05 * Math.min(4, q[3]), 0.5 * s);
        low.push(q[0] / q[3], q[1] / q[3], q[3], cy);
      }
    }
    for (; n < 16; n++) C[n].w = 0;
  };

  Arena.prototype.tickFx = function (dt, show) {
    dt = Math.min(dt || 0, 0.1);
    show = show || this.show || (root.VGSim && root.VGSim.show) || null;
    this.t += dt;
    this.trackActors(); this._tracked = true;
    var M = this.mood, U = this.U;
    // crowd mood from the show's phase, plus bursts on big moments
    var ph = show && show.phase, tE = 0.2, tS = 0.08, tP = 0.05;
    if (ph === "intro") { tE = 0.42; tS = 0.45; tP = 0.3; }
    else if (ph === "live") { tE = show.state === "ground" ? 0.15 : 0.22; tS = 0.07; tP = 0.02; }
    else if (ph === "break") { tE = 0.12; tS = 0.05; tP = 0.07; }
    else if (ph === "finish" || ph === "result") { tE = 0.95; tS = 0.95; tP = 0.55; }
    else if (ph === "decision") { tE = 0.55; tS = 0.8; tP = 0.38; }
    else if (ph === "replay") { tE = M.e; tS = M.s; tP = M.p; }
    var k1 = Math.min(1, dt * 0.9);
    M.e += (tE - M.e) * k1; M.s += (tS - M.s) * Math.min(1, dt * 0.5); M.p += (tP - M.p) * Math.min(1, dt * 0.7);
    M.be *= Math.exp(-dt / 2.6); M.bs *= Math.exp(-dt / 5); M.wave *= Math.exp(-dt / 5); M.flash *= Math.exp(-dt / 1.4);
    U.uTime.value = this.t;
    U.uExcite.value = Math.min(1, Math.max(M.e, M.be));
    U.uStand.value = Math.min(1, Math.max(M.s, M.bs));
    U.uWave.value = M.wave;
    U.uPhones.value = Math.min(0.9, M.p + M.be * 0.25);
    // camera flashes
    var colA = this.flashes.geometry.attributes.color, arr = colA.array, r = this.flashRng;
    for (var i = 0; i < arr.length; i += 3) {
      var v = arr[i] * Math.exp(-dt * 18);
      if (r() < this.flashLevel * dt * 60) v = 0.7 + r() * 0.6;
      arr[i] = arr[i + 1] = arr[i + 2] = v;
    }
    colA.needsUpdate = true;
    this.flashLevel += (0.004 + M.p * 0.01 - this.flashLevel) * Math.min(1, dt * 0.8);
    // cornermen come up with the stools
    if (this.corner) this.corner.visible = !!(this.stools.A.visible || this.stools.B.visible);
    // boards: names from the script, round and clock from the show
    if (show && show.script && show.script !== this._lastScript) {
      this._lastScript = show.script;
      this.resetWear();
      var inf = infoFromScript(show.script);
      if (inf) this.setMatchup(inf);
    }
    this._boardT = (this._boardT || 0) + dt;
    if (this._boardT > (this.tier === "low" ? 1.0 : 0.5)) {
      this._boardT = 0;
      if (show && typeof show.clock === "number") { this.board.round = (show.rIdx || 0) + 1; this.board.clock = fmtClock(300 - show.clock); }
      this.board.flash = M.flash;
      var sh = Math.floor(this.t / 8) % 8; this.board.shift = sh;
      this.updateBoards(false);
    }
    // canvas wear builds through the fight
    var W = this.wear;
    if (this._blood && show && show.impact) {
      var I = show.impact, nb = 2 + Math.floor(r() * (this._blood >= 0.45 ? 6 : 3));
      for (var bi = 0; bi < nb; bi++) this.mark(I.x + (r() - 0.5) * 0.7, I.z + (r() - 0.5) * 0.7, "blood", 0.3 + r() * 0.5);
      this._blood = 0;
    }
    if (ph === "live" || ph === "finish") {
      W.stampT += dt;
      if (W.stampT > 0.18) {
        W.stampT = 0;
        var L = this.lowPts;
        for (var j = 0; j < L.length; j += 4) {
          if (r() < 0.45) this.mark(L[j] + (r() - 0.5) * 0.06, L[j + 1] + (r() - 0.5) * 0.06, "scuff", 0.25 + r() * 0.3);
          if (L[j + 3] < 0.45 && r() < 0.5) this.mark(L[j], L[j + 1], "sweat", 0.12 + r() * 0.12);
          else if (r() < 0.05) this.mark(L[j] + (r() - 0.5) * 0.5, L[j + 1] + (r() - 0.5) * 0.5, "drip", 0.5 + r() * 0.5);
        }
      }
    }
    W.decayT += dt;
    if (W.decayT > 2) {   // sweat dries slowly; scuffs stay
      W.decayT = 0;
      W.ctx.save(); W.ctx.globalCompositeOperation = "multiply"; W.ctx.fillStyle = "rgb(255,252,255)"; W.ctx.fillRect(0, 0, W.c.width, W.c.height); W.ctx.restore();
      W.dirty = true;
    }
    W.upT += dt;
    if (W.dirty && W.upT > 0.5) { W.upT = 0; W.dirty = false; W.tex.needsUpdate = true; }
  };

  Arena.prototype.burst = function (lvl) {
    this.flashLevel = Math.max(this.flashLevel, lvl);
    if (lvl >= 0.25 && Math.random() < 0.65) this._blood = lvl;   // dropped next tick, once the show has set the impact point
    var M = this.mood;
    M.be = Math.max(M.be, Math.min(1, 0.35 + lvl * 1.4));
    M.bs = Math.max(M.bs, Math.min(1, lvl * 1.6));
    if (lvl >= 0.45) { M.wave = 1; M.flash = 1; }
    else if (lvl >= 0.2) M.flash = Math.max(M.flash, 0.55);
  };

  Arena.prototype.render = function () {
    var now = perfNow();
    this.renderer.info.reset();
    if (!this._tracked) this.trackActors();
    this._tracked = false;
    if (this.finish) this.finish.uniforms.uTime.value = (now / 1000) % 1000;
    var fovScale = this.cssH * this.renderer.getPixelRatio() / (2 * Math.tan(this.camera.fov * PI / 360));
    this.U.uScale.value = fovScale;
    if (this.composer && this.postOn) {
      try { this.composer.render(); }
      catch (e) { this.postOn = false; if (root.console) console.warn("FightArena: post-processing failed, rendering directly", e); this.renderer.render(this.scene, this.camera); }
    } else this.renderer.render(this.scene, this.camera);
    this.govern(now);
  };

  // frame-time governor: steps quality down when frames run long, back up when there is headroom
  Arena.prototype.govern = function (now) {
    if (!this.adaptive) return;
    var g = this.gov || (this.gov = { last: 0, ema: 0, n: 0, t: now, good: 0, step: 0 });
    if (g.last) { var d = now - g.last; if (d > 0 && d < 250) { g.ema = g.ema ? g.ema * 0.92 + d * 0.08 : d; g.n++; } }
    g.last = now;
    if (g.n < 40 || now - g.t < 1500) return;
    g.t = now;
    var budget = this.gpu.mobile ? 34 : 17.2;
    if (g.ema > budget * 1.2) { this.stepDown(); g.n = 0; g.ema = 0; g.good = 0; }
    else if (g.ema < budget * 0.72 && g.step > 0) { if (++g.good > 5) { this.stepUp(); g.good = 0; } }
    else g.good = 0;
  };
  Arena.prototype.stepDown = function () {
    var g = this.gov, Q = this.Q;
    if (this.dprScale > 0.86 && this.baseDpr * 0.85 >= 0.99) { this.dprScale = 0.85; this.resize(this.cssW, this.cssH); }
    else if (this.bloom && this.bloom.enabled) this.bloom.enabled = false;
    else if (Q.aa === "smaa") { Q.aa = "fxaa"; this.applyAA(); }
    else if (this.dprScale > 0.71) { this.dprScale = 0.7; this.resize(this.cssW, this.cssH); }
    else if (this.key.shadow.mapSize.x > 1024) { this.key.shadow.mapSize.set(1024, 1024); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
    else if (this.shafts.visible) this.shafts.visible = false;
    else return;
    g.step++;
  };
  Arena.prototype.stepUp = function () {
    if (this.dprScale < 1) { this.dprScale = Math.min(1, this.dprScale + 0.15); this.resize(this.cssW, this.cssH); this.gov.step = Math.max(0, this.gov.step - 1); }
  };
  Arena.prototype.setQuality = function (q) {
    if (!QUALITY[q]) return;
    var Q = QUALITY[q];
    this.quality = q; this.Q.aa = Q.aa; this.Q.bloom = Q.bloom;
    this.baseDpr = Math.min(root.devicePixelRatio || 1, Q.dpr, this.opts.maxDpr || 2); this.dprScale = 1;
    if (this.bloom) this.bloom.enabled = Q.bloom > 0;
    this.applyAA();
    var sm = Math.min(Q.shadow, this.opts.shadow || Q.shadow);
    if (this.key.shadow.mapSize.x !== sm) { this.key.shadow.mapSize.set(sm, sm); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
    this.shafts.visible = true;
    this.resize(this.cssW, this.cssH);
  };
  Arena.prototype.stats = function () {
    var i = this.renderer.info;
    return { quality: this.quality, tier: this.tier, gpu: this.gpu.renderer, post: !!(this.composer && this.postOn), linearPost: !!this.linearPost, bloom: !!(this.bloom && this.bloom.enabled), aa: this.Q.aa, dpr: this.renderer.getPixelRatio(), frameMs: this.gov ? +this.gov.ema.toFixed(1) : null, calls: i.render.calls, triangles: i.render.triangles, crowd: this.crowdCount };
  };

  // vertical field of view for a 35 mm-equivalent focal length (36 mm wide sensor) at a given aspect
  function lensFov(mm, aspect) { var h = 2 * Math.atan(18 / mm); return 2 * Math.atan(Math.tan(h / 2) / Math.max(0.3, aspect || 16 / 9)) * 180 / PI; }

  root.FightArena = { Arena: Arena, APO: APO, RV: RV, vertexAngle: vertexAngle, BLUE_K: BLUE_K, RED_K: RED_K, SIDE: SIDE, FLOOR_Y: FLOOR_Y, RAIL_Y: RAIL_Y, QUALITY: QUALITY, lensFov: lensFov };
})(typeof window !== "undefined" ? window : globalThis);
