/* Realistic fighters: skinned MakeHuman humans baked per fighter, driven by the primitive rig.

   Body, morph targets, skins, eyes, brows, lashes and hair are CC0 MakeHuman / MPFB2 assets in
   HumanForge's packed format. The decoding (byte-planed delta shapes, sparse quantized morphs, macro
   weights, proxy fitting, joint helpers) is ported from HumanForge's runtime (MIT, (c) abdulrehman043,
   https://github.com/abdulrehman043/humanforge, src/human/runtime.ts and glb.ts). Clips are CC0
   Mesh2Motion / Quaternius UAL animations, pre-baked to world-delta quaternions (assets/LICENSES.md).

   How it fits: the Show keeps animating the primitive Rig, which becomes an invisible DRIVER. Its
   segment lengths are set to the avatar's measured skeleton, so contacts, aims and footprints carry
   over exactly. Every rendered frame, sync() poses the skinned skeleton from the driver (torso
   rotations, two-bone IK for arms and legs with the driver's poles, the driver's feet), then blends
   clip layers per body part (falls, getting up, dizzy, celebration, breathing idle).

   FightAvatar.attach(actor, appearance, scene) builds asynchronously and swaps itself in when ready;
   anything missing (WebGL2, DecompressionStream, assets) leaves the primitive rig in place. */
(function (root) {
  "use strict";
  var T = root.THREE;
  if (!T) return;
  var V3 = T.Vector3, Q = T.Quaternion, M4 = T.Matrix4;
  var _v1 = new V3(), _v2 = new V3(), _v3 = new V3(), _v4 = new V3(), _v5 = new V3(), _v6 = new V3();
  var _q1 = new Q(), _q2 = new Q(), _q3 = new Q(), _q4 = new Q(), _m1 = new M4();
  var _bx = new V3(), _by = new V3(), _bz = new V3();
  var YAX = new V3(0, 1, 0), ZAX = new V3(0, 0, 1);
  var PRE = "mixamorig:";

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function smooth(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ------------------------------------------------------------ assets */
  function assetUrl(name) { var A = root.FightAssets; return A && A[name] ? A[name] : null; }
  function b64ToBytes(s) {
    var bin = root.atob(s), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function fetchBytes(name) {
    var u = assetUrl(name);
    if (!u) return Promise.reject(new Error("FightAvatar: missing asset " + name));
    if (u.slice(0, 5) === "data:") return Promise.resolve(b64ToBytes(u.slice(u.indexOf(",") + 1)));
    return root.fetch(u).then(function (r) { if (!r.ok) throw new Error("FightAvatar: " + name + " " + r.status); return r.arrayBuffer(); })
      .then(function (b) { return new Uint8Array(b); });
  }
  function gunzip(bytes) {
    if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return Promise.resolve(bytes);
    var ds = new root.DecompressionStream("gzip");
    return new root.Response(new root.Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function loadBin(name) { return fetchBytes(name).then(gunzip); }
  function utf8(bytes) {
    if (root.TextDecoder) return new root.TextDecoder("utf-8").decode(bytes);
    var s = ""; for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return decodeURIComponent(escape(s));
  }
  var texCache = {};
  function loadTexture(name, srgb) {
    var key = name + (srgb ? "|s" : "|l");
    if (texCache[key]) return texCache[key];
    var u = assetUrl(name);
    if (!u) return Promise.reject(new Error("FightAvatar: missing texture " + name));
    texCache[key] = new Promise(function (res, rej) {
      var img = new root.Image();
      img.onload = function () {
        var t = new T.Texture(img);
        t.flipY = false; t.encoding = srgb ? T.sRGBEncoding : T.LinearEncoding;
        t.anisotropy = 4; t.needsUpdate = true; t.userData.shared = true;
        res(t);
      };
      img.onerror = function () { rej(new Error("FightAvatar: texture " + name)); };
      img.src = u;
    });
    return texCache[key];
  }

  /* Minimal GLB reader (port of HumanForge glb.ts, MIT): first mesh primitive, custom attributes,
     KHR_mesh_quantization component types. */
  var CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  var CS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function readGlb(bytes) {
    var buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    var dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
    var jsonLen = dv.getUint32(12, true);
    var json = JSON.parse(utf8(new Uint8Array(buffer, 20, jsonLen)));
    var binStart = 20 + jsonLen + 8;
    function read(i) {
      var acc = json.accessors[i], view = json.bufferViews[acc.bufferView], Ty = CT[acc.componentType], size = CS[acc.type];
      var out = new Ty(acc.count * size), start = binStart + (view.byteOffset || 0) + (acc.byteOffset || 0);
      var stride = view.byteStride || size * Ty.BYTES_PER_ELEMENT;
      if (stride === size * Ty.BYTES_PER_ELEMENT && start % Ty.BYTES_PER_ELEMENT === 0) out.set(new Ty(buffer, start, acc.count * size));
      else {
        var g = { 5120: "getInt8", 5121: "getUint8", 5122: "getInt16", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" }[acc.componentType];
        for (var e = 0; e < acc.count; e++) for (var k = 0; k < size; k++) out[e * size + k] = dv[g](start + e * stride + k * Ty.BYTES_PER_ELEMENT, true);
      }
      return { array: out, itemSize: size, normalized: !!acc.normalized };
    }
    var prim = json.meshes[0].primitives[0], attributes = {};
    for (var name in prim.attributes) attributes[name] = read(prim.attributes[name]);
    return { attributes: attributes, index: read(prim.indices).array };
  }
  function toFloat(a) {
    if (a.array instanceof Float32Array) return a.array;
    var out = new Float32Array(a.array.length), arr = a.array, max = 1;
    if (a.normalized) max = arr instanceof Uint8Array ? 255 : arr instanceof Uint16Array ? 65535 : arr instanceof Int8Array ? 127 : arr instanceof Int16Array ? 32767 : 1;
    for (var i = 0; i < out.length; i++) out[i] = a.normalized && max !== 1 ? Math.max(-1, arr[i] / max) : arr[i];
    return out;
  }
  function toU16(a) { return a.array instanceof Uint16Array ? a.array : Uint16Array.from(a.array); }

  /* Undo HumanForge's wrapping delta coding + byte planes (runtime.ts, MIT). */
  function unplane16(src, at, n, signed) {
    var out = signed ? new Int16Array(n) : new Uint16Array(n), acc = 0;
    for (var i = 0; i < n; i++) { acc = (acc + (src[at + i] | (src[at + n + i] << 8))) & 0xffff; out[i] = acc; }
    return out;
  }
  function unplane8(src, at, n) {
    var out = new Int16Array(n), acc = 0;
    for (var i = 0; i < n; i++) { acc = (acc + src[at + i]) & 0xff; out[i] = acc > 127 ? acc - 256 : acc; }
    return out;
  }

  /* ------------------------------------------------------------ shared base (decoded once) */
  var basePromise = null;
  function Base(man, shapes, body, clips) {
    this.man = man;
    var N = this.N = man.vertexCount, sh = man.shapes, k, i;
    var base = this.base = new Float32Array(N * 3);
    for (k = 0; k < 3; k++) {
      var q = unplane16(shapes, sh.baseOffset + k * N * 2, N, false);
      for (i = 0; i < N; i++) base[i * 3 + k] = sh.baseMin[k] + q[i] * sh.baseScale[k];
    }
    var morphs = this.morphs = {};
    sh.morphs.forEach(function (m) {
      var idx = unplane16(shapes, m.offset, m.count, false), d = new Int16Array(m.count * 3), at = m.offset + m.count * 2;
      for (var kk = 0; kk < 3; kk++) {
        var v = m.bits === 8 ? unplane8(shapes, at, m.count) : unplane16(shapes, at, m.count, true);
        at += m.count * (m.bits === 8 ? 1 : 2);
        for (var j = 0; j < m.count; j++) d[j * 3 + kk] = v[j];
      }
      morphs[m.name] = { idx: idx, d: d, scale: m.scale };
    });
    this.body = body;
    this.mh = toU16(body.attributes._MH);
    this.uv = toFloat(body.attributes.TEXCOORD_0);
    this.joints = toU16(body.attributes.JOINTS_0);
    this.weights = toFloat(body.attributes.WEIGHTS_0);
    this.index = body.index;
    this.boneIndex = {};
    var self = this;
    man.bones.forEach(function (b, j) { self.boneIndex[b.name.replace(PRE, "")] = j; });
    this.proxyCache = {};
    this.clips = clips;
  }
  Base.prototype.macroWeights = function (c) {
    // HumanForge macroWeights (MIT), with height given as MakeHuman's raw 0..1 value and age in years
    var w = {}, g = clamp01(c.gender);
    w["macro/sexF"] = Math.max(0, 1 - 2 * g); w["macro/sexM"] = Math.max(0, 2 * g - 1);
    function split(v, up, down) {
      var x = clamp01(v), key = x >= 0.5 ? up : down, amt = x >= 0.5 ? 2 * x - 1 : 1 - 2 * x;
      w["macro/" + key + "F"] = (w["macro/" + key + "F"] || 0) + amt * (1 - g);
      w["macro/" + key + "M"] = (w["macro/" + key + "M"] || 0) + amt * g;
    }
    split(c.muscle, "muscleUp", "muscleDown"); split(c.weight, "weightUp", "weightDown");
    split(c.heightRaw, "heightUp", "heightDown"); split(c.proportions, "proportionsUp", "proportionsDown");
    split(c.cupSize, "cupUp", "cupDown"); split(c.firmness, "firmUp", "firmDown");
    var years = clamp(c.years, 18, 90), t;
    if (years < 25) { t = (25 - years) / 7; w["macro/ageYoungF"] = t * (1 - g); w["macro/ageYoungM"] = t * g; }
    else { t = (years - 25) / 65; w["macro/ageOldF"] = t * (1 - g); w["macro/ageOldM"] = t * g; }
    // ethnicity mix stays at MakeHuman's neutral thirds: appearance varies only skin tone, hair and beard
    ["african", "asian", "caucasian"].forEach(function (r) { w["macro/" + r + "F"] = (1 / 3) * (1 - g); w["macro/" + r + "M"] = (1 / 3) * g; });
    return w;
  };
  Base.prototype.evaluate = function (c, out) {
    out = out || new Float32Array(this.base.length);
    out.set(this.base);
    var morphs = this.morphs;
    function add(name, weight) {
      var m = morphs[name];
      if (!m || Math.abs(weight) < 1e-4) return;
      var s = m.scale * weight, idx = m.idx, d = m.d;
      for (var i = 0; i < idx.length; i++) { var o = idx[i] * 3; out[o] += d[i * 3] * s; out[o + 1] += d[i * 3 + 1] * s; out[o + 2] += d[i * 3 + 2] * s; }
    }
    var mw = this.macroWeights(c), k;
    for (k in mw) add(k, mw[k]);
    var det = c.detail || {};
    for (k in det) {
      var sl = DETAIL[k], v = det[k];
      if (!sl || !v) continue;
      (v > 0 ? sl.pos : sl.neg).forEach(function (tn) { add(tn, Math.abs(v)); });
    }
    var man = this.man, gy = 0, i;
    for (i = 0; i < man.groundVerts.length; i++) gy += out[man.groundVerts[i] * 3 + 1];
    gy /= man.groundVerts.length;
    for (i = 1; i < out.length; i += 3) out[i] -= gy;
    return out;
  };
  Base.prototype.stature = function (P) {
    var mx = -1e9, n = this.man.bodyVertexRange[1];
    for (var i = 0; i < n; i++) if (P[i * 3 + 1] > mx) mx = P[i * 3 + 1];
    return mx;
  };
  Base.prototype.proxy = function (id) {
    var self = this;
    if (!this.proxyCache[id]) {
      var meta = null;
      this.man.proxies.forEach(function (p) { if (p.kind + "-" + p.id === id) meta = p; });
      if (!meta) return Promise.reject(new Error("FightAvatar: no proxy " + id));
      this.proxyCache[id] = Promise.all([loadBin(meta.file), meta.texture ? loadTexture(meta.texture, true) : null]).then(function (r) {
        var prim = readGlb(r[0]);
        return { meta: meta, prim: prim, tex: r[1], refs: toU16(prim.attributes._REFS), refw: toFloat(prim.attributes._REFW), offs: toFloat(prim.attributes._OFFS),
          uv: toFloat(prim.attributes.TEXCOORD_0), joints: toU16(prim.attributes._JOINTS), weights: toFloat(prim.attributes._WEIGHTS) };
      });
      this.proxyCache[id].catch(function () { delete self.proxyCache[id]; });
    }
    return this.proxyCache[id];
  };

  // detail sliders used here (HumanForge sliders.ts ids -> MakeHuman targets)
  function pr(dir, base, n, p) { return { neg: [dir + "/" + base + "-" + (n || "decr")], pos: [dir + "/" + base + "-" + (p || "incr")] }; }
  function lr(dir, base, n, p) { n = n || "decr"; p = p || "incr"; return { neg: [dir + "/l-" + base + "-" + n, dir + "/r-" + base + "-" + n], pos: [dir + "/l-" + base + "-" + p, dir + "/r-" + base + "-" + p] }; }
  var DETAIL = {
    headWidth: pr("head", "head-scale-horiz"), headHeight: pr("head", "head-scale-vert"), headDepth: pr("head", "head-scale-depth"),
    faceFat: pr("head", "head-fat"), headSquare: { neg: [], pos: ["head/head-square"] }, headOval: { neg: [], pos: ["head/head-oval"] },
    jaw: pr("chin", "chin-bones"), chinWidth: pr("chin", "chin-width"), chinHeight: pr("chin", "chin-height"), chinProminence: pr("chin", "chin-prominent"),
    cheekBones: lr("cheek", "cheek-bones"), cheekVolume: lr("cheek", "cheek-volume"),
    browHeight: pr("eyebrows", "eyebrows-trans", "down", "up"), browDepth: pr("eyebrows", "eyebrows-trans", "backward", "forward"),
    eyeSize: lr("eyes", "eye-scale"), eyeOpening: lr("eyes", "eye-height2"),
    noseWidth: pr("nose", "nose-scale-horiz"), noseLength: pr("nose", "nose-scale-vert"), noseDepth: pr("nose", "nose-scale-depth"),
    noseBridge: pr("nose", "nose-width1"), noseHump: pr("nose", "nose-hump"), noseTipWidth: pr("nose", "nose-point-width"), nostrils: pr("nose", "nose-nostrils-width"),
    mouthWidth: pr("mouth", "mouth-scale-horiz"), upperLip: pr("mouth", "mouth-upperlip-volume"), lowerLip: pr("mouth", "mouth-lowerlip-volume"),
    neckWidth: pr("neck", "neck-scale-horiz"), neckLength: pr("neck", "neck-scale-vert"),
    shoulders: pr("torso", "measure-shoulder-dist"), chest: pr("torso", "measure-bust-circ"), waist: pr("torso", "measure-waist-circ"),
    hips: pr("torso", "measure-hips-circ"), vShape: pr("torso", "torso-vshape"), belly: pr("stomach", "stomach-pregnant"), buttocks: pr("buttocks", "buttocks-volume")
  };

  function parseClips(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var hl = dv.getUint32(0, true), header = JSON.parse(utf8(bytes.subarray(4, 4 + hl))), data0 = 4 + hl;
    var nb = header.bones.length, per = 3 + nb * 4, out = { fps: header.fps, bones: header.bones, src: header.src, clips: {}, list: [] };
    for (var name in header.clips) {
      var c = header.clips[name], n = c.frames;
      var raw = new Int16Array(bytes.buffer.slice(bytes.byteOffset + data0 + c.off, bytes.byteOffset + data0 + c.off + n * per * 2));
      out.clips[name] = { name: name, frames: n, dur: (n - 1) / header.fps, loop: c.loop, data: raw, per: per, id: out.list.length };
      out.list.push(name);
    }
    return out;
  }

  function supported() {
    return !!(root.DecompressionStream && root.Blob && root.Response && root.atob && assetUrl("mh-manifest.json") && assetUrl("mh-body.glb.gz"));
  }

  function loadBase() {
    if (basePromise) return basePromise;
    if (!supported()) return Promise.reject(new Error("FightAvatar: not supported here"));
    basePromise = fetchBytes("mh-manifest.json").then(function (mb) {
      var man = JSON.parse(utf8(mb));
      return Promise.all([loadBin(man.shapes.file), loadBin(man.body.file), assetUrl("mh-clips.bin.gz") ? loadBin("mh-clips.bin.gz").catch(function () { return null; }) : null])
        .then(function (r) { return new Base(man, r[0], readGlb(r[1]), r[2] ? parseClips(r[2]) : null); });
    });
    basePromise.catch(function (e) { if (root.console) console.warn(e); });
    return basePromise;
  }

  /* ------------------------------------------------------------ appearance */
  var DIV_LB = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170, "Middleweight": 185,
    "Light Heavyweight": 205, "Heavyweight": 245, "Women's Strawweight": 115, "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145 };
  var HAIR_COL = { black: "#15110e", dark: "#1f1712", "dark brown": "#2a1d14", brown: "#4a3222", "light brown": "#6e4f35", "light-brown": "#6e4f35", auburn: "#6b3420",
    red: "#7a3a1e", ginger: "#8a4a26", blond: "#a8875a", blonde: "#a8875a", sandy: "#8c7050", grey: "#8a8580", gray: "#8a8580", "salt and pepper": "#5d5853", white: "#c9c5bf" };
  var TONE = { // skin tone -> texture family and multiply tint (tone only; the body shape never reads it)
    "very light": ["caucasian", "#fff4ee"], light: ["caucasian", "#ffffff"], "light-medium": ["caucasian", "#f3dccb"], olive: ["caucasian", "#ecd2b6"],
    medium: ["caucasian", "#e2bf9f"], tan: ["caucasian", "#d9b08f"], "medium-dark": ["african", "#f5e1d6"], brown: ["african", "#ffffff"],
    dark: ["african", "#e3cdc4"], "very dark": ["african", "#c9b0a6"]
  };
  function lower(s) { return (s == null ? "" : String(s)).toLowerCase(); }
  function known(s) { s = lower(s); return s && s.indexOf("unknown") !== 0; }
  function pickColor(text, fallback) {
    var t = lower(text), best = null, bl = 0;
    for (var k in HAIR_COL) if (t.indexOf(k) >= 0 && k.length > bl) { best = HAIR_COL[k]; bl = k.length; }
    return best || fallback;
  }
  function hexLum(h) { var c = new T.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
  function toneFrom(text) {
    var t = lower(text);
    if (/^#[0-9a-f]{6}$/.test(t)) { var L = hexLum(t); return L > 0.62 ? "light" : L > 0.5 ? "light-medium" : L > 0.38 ? "medium" : L > 0.22 ? "brown" : "dark"; }
    var order = ["very light", "light-medium", "medium-dark", "very dark", "light", "olive", "medium", "tan", "brown", "dark"];
    for (var i = 0; i < order.length; i++) if (t.indexOf(order[i]) >= 0) return order[i];
    return "light-medium";
  }
  function ageAt(dob) {
    if (!dob) return 30;
    var d = new Date(dob + "T00:00:00Z"), now = new Date();
    if (isNaN(d)) return 30;
    return (now - d) / (365.25 * 864e5);
  }

  /* Merge roster data (fighters.json profile), overrides appearance and scouting appearance into one
     appearance object. Anything not stated stays at a neutral default. */
  function appearanceFor(slug, src) {
    src = src || dbFromPage();
    var prof = (src.fighters && src.fighters[slug]) || {}, ov = (src.overrides && src.overrides[slug]) || {}, ovApp = ov.appearance || {};
    var sc = (src.scouting && src.scouting[slug]) || {};
    var a = {};
    function take(o) { for (var k in o) if (o[k] != null && o[k] !== "" && (typeof o[k] !== "string" || known(o[k]))) a[k] = o[k]; }
    take(sc); take(ovApp);
    a.slug = slug; a.name = ov.name || prof.name || slug;
    a.height_in = ov.height_in || prof.height_in || a.height_in || 70;
    a.reach_in = ov.reach_in || prof.reach_in || a.reach_in || a.height_in;
    a.stance = ov.stance || prof.stance || "Orthodox";
    a.division = ov.division || prof.division || "Lightweight";
    a.dob = ov.dob || prof.dob || null;
    return a;
  }
  function dbFromPage() {
    var out = { fighters: {}, overrides: {}, scouting: {} };
    if (!root.document) return out;
    function j(id) { var el = root.document.getElementById(id); if (!el) return null; try { return JSON.parse(el.textContent); } catch (e) { return null; } }
    var f = j("fighters-db"), o = j("overrides-db"), s = j("appearance-db");
    if (f && f.fighters) out.fighters = f.fighters;
    if (o) { out.overrides = o.fighters || {}; if (o.manual) for (var k in o.manual) out.fighters[k] = out.fighters[k] || o.manual[k]; }
    if (s) out.scouting = s.fighters || s;
    return out;
  }

  /* Appearance -> MakeHuman config plus looks. */
  function configFor(app, base) {
    var ref = app.role === "referee";
    var div = app.division || "Lightweight", female = /^women/i.test(div) || lower(app.sex) === "female";
    var hIn = +app.height_in || 70, H = hIn * 0.0254;
    var years = app.age || ageAt(app.dob);
    var build = lower(app.build), fig = lower([app.build, app.notes].join(" "));
    var limit = DIV_LB[div] || 155;
    var lb = app.weight_lb || (div === "Heavyweight" ? 238 + (hIn - 75) * 6 : limit * (limit <= 170 ? 1.08 : 1.065));
    if (ref) lb = app.weight_lb || 190;
    var bmi = 703 * lb / (hIn * hIn);
    var muscleBias = 0;
    if (/muscular|jacked|thick|powerful|stocky|barrel|broad/.test(fig)) muscleBias += 0.06;
    if (/lean|lanky|long-limbed|rangy|slim|wiry|skinny/.test(fig)) muscleBias -= 0.06;
    var muscle = ref ? 0.55 : clamp(0.74 + muscleBias + (bmi - 24) * 0.012, 0.6, 0.96);
    var weight = clamp(0.5 + (bmi - 23.5) * 0.045 - (muscle - 0.5) * 0.25, 0.3, 0.95);
    if (ref) weight = clamp(0.5 + (bmi - 24.5) * 0.05, 0.35, 0.8);
    var det = {};
    if (!ref) {
      var m = muscle - 0.7;
      det.neckWidth = clamp(0.35 + m * 1.5 + (bmi - 24) * 0.05, 0, 0.9);
      det.shoulders = clamp(0.12 + m * 1.2 + (/stocky|broad|thick/.test(fig) ? 0.15 : 0), -0.2, 0.7);
      det.vShape = clamp(0.25 + m * 1.2, 0, 0.7);
      det.chest = clamp(0.1 + m * 0.8 + (bmi - 25) * 0.03, -0.2, 0.5);
      det.waist = clamp(-0.15 + (bmi - 26) * 0.07 - m * 0.4, -0.5, 0.6);
      det.belly = bmi > 29 ? clamp((bmi - 29) * 0.07, 0, 0.5) : -0.15;
      det.buttocks = -0.1;
      if (female) { det.neckWidth *= 0.5; det.shoulders *= 0.6; det.vShape *= 0.5; }
    } else { det.belly = clamp((bmi - 25) * 0.08, 0, 0.4); }
    var face = app.face || {};
    for (var k in face) if (DETAIL[k]) det[k] = face[k];
    // reach -> arm stretch, computed after the bake (needs the measured span)
    return {
      gender: female ? 0 : 1, years: years, muscle: muscle, weight: weight, heightRaw: 0.5, proportions: ref ? 0.5 : 0.62,
      cupSize: female ? 0.4 : 0.5, firmness: 0.6, detail: det, H: H, reach: (+app.reach_in || hIn) * 0.0254, bmi: bmi, female: female, ref: ref
    };
  }

  function looksFor(app, cfg, base) {
    var ref = cfg.ref, hairT = lower(app.hair), fhT = lower(app.facial_hair);
    var L = { hair: null, scalp: 0, hairColor: pickColor(app.hair_color || app.hair, "#2a1d14"), beard: 0.22, beardShell: 0, moustacheOnly: false, chinOnly: false };
    if (/bald|shaved|shaven head|clean-shaven head/.test(hairT)) { L.hair = null; L.scalp = 0.22; }
    else if (/buzz|very short|crew|induction|clipper/.test(hairT)) { L.hair = null; L.scalp = 0.9; }
    else if (/afro/.test(hairT)) L.hair = "hair-afro01";
    else if (/ponytail|top knot|topknot|tied|bun|braid/.test(hairT) || (/long/.test(hairT) && !/short/.test(hairT))) L.hair = "hair-ponytail01";
    else if (/mop|shaggy|medium|styled up|quiff|swept|side part|curly/.test(hairT)) L.hair = "hair-short01";
    else if (/receding|thinning/.test(hairT)) L.hair = "hair-short04";
    else L.hair = cfg.female ? "hair-ponytail01" : "hair-short02";
    if (L.hair) L.scalp = 0.35;
    if (!known(fhT)) L.beard = cfg.female ? 0 : 0.28;
    else if (/clean|shaven|no beard|beardless/.test(fhT)) L.beard = 0.12;
    else if (/full|thick|long/.test(fhT) && /beard/.test(fhT)) { L.beard = 1; L.beardShell = 0.006; }
    else if (/beard/.test(fhT) && !/chin beard|goatee/.test(fhT)) { L.beard = /short|trim|stubble|light/.test(fhT) ? 0.78 : 0.9; L.beardShell = /stubble/.test(fhT) ? 0 : 0.0028; }
    else if (/stubble|scruff|5 o/.test(fhT)) L.beard = 0.55;
    if (/moustache|mustache/.test(fhT) && (/chin|goatee/.test(fhT))) { L.beard = 0.85; L.moustacheOnly = true; L.chinOnly = true; }
    else if (/moustache|mustache/.test(fhT) && !/beard/.test(fhT)) { L.beard = 0.85; L.moustacheOnly = true; }
    else if (/goatee|chin beard/.test(fhT)) { L.beard = 0.85; L.chinOnly = true; }
    if (cfg.female) L.beard = 0;
    L.beardColor = pickColor(app.beard_color || app.facial_hair, L.hairColor);
    if (/ginger|red|auburn/.test(fhT)) L.beardColor = pickColor(fhT, L.beardColor);
    var tone = toneFrom(app.skin), fam = (TONE[tone] || TONE["light-medium"])[0];
    L.tint = app.skin_tint || (TONE[tone] || TONE["light-medium"])[1];
    var ageKey = cfg.years < 27 ? "young" : (cfg.years < 52 ? "middleage" : "old");
    var want = [ageKey + "_" + fam + "_" + (cfg.female ? "female" : "male"), "middleage_" + fam + "_" + (cfg.female ? "female" : "male"),
      "young_" + fam + "_" + (cfg.female ? "female" : "male"), "middleage_caucasian_male"];
    var ids = {}; base.man.skins.forEach(function (s) { ids[s.id] = s; });
    for (var i = 0; i < want.length; i++) if (ids[want[i]]) { L.skin = ids[want[i]]; break; }
    if (!L.skin) L.skin = base.man.skins[0];
    L.iris = app.eyes && base.man.irises.indexOf(lower(app.eyes)) >= 0 ? lower(app.eyes) : "brownlight";
    L.brows = /thick|heavy|bushy/.test(lower(app.brows)) || cfg.muscle > 0.85 ? "eyebrows-eyebrow010" : "eyebrows-eyebrow001";
    L.tattoos = app.tattoo_marks || [];
    return L;
  }

  /* ------------------------------------------------------------ kit colours */
  function colorOf(v, d) { return new T.Color(v == null ? d : v); }

  /* ------------------------------------------------------------ the avatar */
  function basisQuat(q, yAxis, zHint) {
    _by.copy(yAxis).normalize();
    _bz.copy(zHint).addScaledVector(_by, -zHint.dot(_by));
    if (_bz.lengthSq() < 1e-10) { _bz.set(0, 0, 1).addScaledVector(_by, -_by.z); if (_bz.lengthSq() < 1e-10) _bz.set(1, 0, 0); }
    _bz.normalize();
    _bx.crossVectors(_by, _bz);
    _m1.makeBasis(_bx, _by, _bz);
    return q.setFromRotationMatrix(_m1);
  }

  var LIMBS = [
    { key: "armL", up: "LeftArm", lo: "LeftForeArm", end: "LeftHand", tip: "LeftHandMiddle1", arm: true, left: true },
    { key: "armR", up: "RightArm", lo: "RightForeArm", end: "RightHand", tip: "RightHandMiddle1", arm: true, left: false },
    { key: "legL", up: "LeftUpLeg", lo: "LeftLeg", end: "LeftFoot", tip: "LeftToeBase", arm: false, left: true },
    { key: "legR", up: "RightUpLeg", lo: "RightLeg", end: "RightFoot", tip: "RightToeBase", arm: false, left: false }
  ];
  var FINGERS = ["Index", "Middle", "Ring", "Pinky"];
  var UPPER_MASK = { Spine: 1, Spine1: 1, Spine2: 1, Neck: 1, Head: 1, LeftShoulder: 1, RightShoulder: 1, LeftArm: 1, RightArm: 1, LeftForeArm: 1, RightForeArm: 1, LeftHand: 1, RightHand: 1 };
  var IDLE_MASK = { Spine: 0.8, Spine1: 0.8, Spine2: 0.8, Neck: 0.7, Head: 0.6, LeftShoulder: 0.8, RightShoulder: 0.8 };

  function Avatar(base, app, opts) {
    opts = opts || {};
    this.base = base; this.app = app; this.opts = opts;
    this.cfg = configFor(app, base);
    this.looks = looksFor(app, this.cfg, base);
    this.group = new T.Group(); this.group.name = "avatar:" + (app.slug || app.role || "");
    this.meshes = []; this.disposables = [];
    this.layers = []; this.idleT = Math.random() * 2; this.idleW = 0;
    this.sweat = 0; this.damHead = [0, 0]; this.damLeg = [0, 0]; this.damBody = 0;
    this.lastMode = null; this.lastReact = null; this.actor = null; this.rig = null;
    this.clipW = 0;
    this.ready = this.build(opts);
  }

  Avatar.prototype.build = function (opts) {
    var self = this, base = this.base, cfg = this.cfg, looks = this.looks;
    // 1. shape: macros + detail, height by the MakeHuman height macro then an exact scale
    var P = new Float32Array(base.base.length), target = cfg.H, h = 0.5, S;
    for (var it = 0; it < 3; it++) {
      cfg.heightRaw = h; base.evaluate(cfg, P); S = base.stature(P);
      h = clamp(h + (target - S) / 1.05, 0.28, 0.78);
      if (Math.abs(S - target) < 0.004) break;
    }
    if (cfg.heightRaw !== h && it === 3) { cfg.heightRaw = h; base.evaluate(cfg, P); S = base.stature(P); }
    var sc = target / S, i;
    for (i = 0; i < P.length; i++) P[i] *= sc;
    this.P = P;
    // 2. joints from helper vertices
    var man = base.man, J = {};
    function mean(idx, out) { out.set(0, 0, 0); for (var k = 0; k < idx.length; k++) { out.x += P[idx[k] * 3]; out.y += P[idx[k] * 3 + 1]; out.z += P[idx[k] * 3 + 2]; } return out.divideScalar(idx.length); }
    man.bones.forEach(function (b) { J[b.name.replace(PRE, "")] = { h: mean(b.head, new V3()), t: mean(b.tail, new V3()) }; });
    // 3. reach: stretch upper arm, forearm (and a little of the hand) to the real ape index
    var shW = J.LeftArm.h.distanceTo(J.RightArm.h);
    var tipL = this.fingertip(true, J), armLen = J.LeftArm.h.distanceTo(J.LeftForeArm.h) + J.LeftForeArm.h.distanceTo(J.LeftHand.h) + J.LeftHand.h.distanceTo(tipL);
    var span0 = shW + 2 * armLen, ua = J.LeftArm.h.distanceTo(J.LeftForeArm.h), fa = J.LeftForeArm.h.distanceTo(J.LeftHand.h);
    var need = (cfg.reach - span0) / 2;                       // extra length per arm
    var s = clamp(1 + need / (ua + fa + 0.35 * J.LeftHand.h.distanceTo(tipL)), 0.9, 1.16);
    this.armStretch = s; this.span0 = span0;
    var stretch = this.stretchFields(J, s);
    // 4. body render geometry
    var mh = base.mh, n = mh.length, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    for (i = 0; i < n; i++) { pos[i * 3] = P[mh[i] * 3]; pos[i * 3 + 1] = P[mh[i] * 3 + 1]; pos[i * 3 + 2] = P[mh[i] * 3 + 2]; }
    this.applyStretch(pos, stretch);
    stretch.joints(J);
    this.J = J;
    computeNormals(pos, nrm, base.index, mh, base.N);
    this.pos = pos; this.nrm = nrm;
    // 5. skeleton (bones +Y down the bone, as HumanForge builds it)
    var bones = [], world = [];
    man.bones.forEach(function (b, k) {
      var nm = b.name.replace(PRE, ""), bone = new T.Bone(); bone.name = nm; bones.push(bone);
      var d = _v1.copy(J[nm].t).sub(J[nm].h).normalize(), q = new Q().setFromUnitVectors(YAX, d);
      world.push({ p: J[nm].h.clone(), q: q });
    });
    man.bones.forEach(function (b, k) {
      var w = world[k];
      if (b.parent < 0) { bones[k].position.copy(w.p); bones[k].quaternion.copy(w.q); }
      else {
        var pw = world[b.parent], iq = _q1.copy(pw.q).invert();
        bones[k].position.copy(w.p).sub(pw.p).applyQuaternion(iq);
        bones[k].quaternion.copy(iq).multiply(w.q);
        bones[b.parent].add(bones[k]);
      }
    });
    this.bones = bones; this.bi = base.boneIndex; this.restWorld = world;
    this.group.add(bones[0]);
    this.skeleton = new T.Skeleton(bones);
    this.group.updateMatrixWorld(true);
    // 6. masks (facial hair, damage zones, kick zones, scalp) and decals per MakeHuman vertex
    var masks = this.computeMasks(P, J);
    // 7. materials and meshes
    return Promise.all([
      loadTexture(looks.skin.file, true),
      base.proxy("eyes-high-poly"), loadTexture("mh-iris-" + looks.iris + ".webp", true),
      base.proxy(looks.brows), base.proxy("eyelashes-eyelashes01"),
      looks.hair ? base.proxy(looks.hair) : null
    ]).then(function (r) {
      self.makeBody(r[0], masks);
      self.addProxy(r[1], { map: r[2], roughness: 0.12, eyes: true });
      self.addProxy(r[3], { color: looks.beardColor === looks.hairColor ? looks.hairColor : mixHex(looks.hairColor, looks.beardColor, 0.4), brows: true });
      self.addProxy(r[4], { lashes: true });
      if (r[5]) self.addProxy(r[5], { color: looks.hairColor, hair: true });
      if (self.cfg.ref) self.makeRefKit(); else self.makeFightKit();
      if (looks.beardShell > 0) self.makeBeardShell(masks);
      self.initRetarget();
      self.measure();
      self.group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      return self;
    });
  };

  function mixHex(a, b, t) { return "#" + new T.Color(a).lerp(new T.Color(b), t).getHexString(); }

  Avatar.prototype.fingertip = function (left, J) {
    // furthest body vertex from the wrist among those weighted to the middle finger's last bone
    var base = this.base, bi = base.boneIndex[(left ? "Left" : "Right") + "HandMiddle3"], P = this.P, best = 0, out = new V3();
    var wr = J[(left ? "Left" : "Right") + "Hand"].h;
    for (var i = 0; i < base.mh.length; i++) {
      var w = 0; for (var k = 0; k < 4; k++) if (base.joints[i * 4 + k] === bi) w += base.weights[i * 4 + k];
      if (w < 0.5) continue;
      var m = base.mh[i], dx = P[m * 3] - wr.x, dy = P[m * 3 + 1] - wr.y, dz = P[m * 3 + 2] - wr.z, d = dx * dx + dy * dy + dz * dz;
      if (d > best) { best = d; out.set(P[m * 3], P[m * 3 + 1], P[m * 3 + 2]); }
    }
    if (!best) out.copy(J[(left ? "Left" : "Right") + "HandMiddle1"].t);
    return out;
  };

  /* Bone-length stretch for the arms in the bind pose: a displacement field per bone (head offset plus
     stretch along the bone), blended by skin weights for vertices and applied exactly to the joints. */
  Avatar.prototype.stretchFields = function (J, s) {
    var self = this, fields = {}, sh = 1 + (s - 1) * 0.35;
    ["Left", "Right"].forEach(function (side) {
      var A = J[side + "Arm"].h, E = J[side + "ForeArm"].h, W = J[side + "Hand"].h, tip = J[side + "HandMiddle1"].h;
      var du = E.clone().sub(A), lu = du.length(); du.normalize();
      var df = W.clone().sub(E), lf = df.length(); df.normalize();
      var dh = tip.clone().sub(W), lh = dh.length(); dh.normalize();
      var dE = du.clone().multiplyScalar((s - 1) * lu), dW = dE.clone().addScaledVector(df, (s - 1) * lf);
      function f(head, dir, len, k, d0) { return { head: head, dir: dir, len: len, k: k, d0: d0 }; }
      fields[side + "Arm"] = f(A, du, lu, s - 1, new V3());
      fields[side + "ForeArm"] = f(E, df, lf, s - 1, dE);
      fields[side + "Hand"] = f(W, dh, lh, sh - 1, dW);
      var dTip = dW.clone().addScaledVector(dh, (sh - 1) * lh);
      FINGERS.concat(["Thumb"]).forEach(function (fn) { for (var j = 1; j <= 3; j++) fields[side + "Hand" + fn + j] = f(W, dh, lh, sh - 1, dW); });
      fields[side + "Hand"].tipD = dTip;
    });
    function disp(name, p, out) {
      var F = fields[name]; out.set(0, 0, 0);
      if (!F) return out;
      var t = clamp(_v6.copy(p).sub(F.head).dot(F.dir), 0, F.len);
      return out.copy(F.d0).addScaledVector(F.dir, F.k * t);
    }
    return {
      fields: fields, disp: disp,
      joints: function (Jt) {
        for (var nm in Jt) {
          var F = fields[nm]; if (!F) continue;
          var a = disp(nm, Jt[nm].h, new V3()), b = disp(nm, Jt[nm].t, new V3());
          Jt[nm].h.add(a); Jt[nm].t.add(b);
        }
      }
    };
  };
  Avatar.prototype.applyStretch = function (pos, st) {
    var base = this.base, names = base.man.bones.map(function (b) { return b.name.replace(PRE, ""); }), p = new V3(), d = new V3(), acc = new V3();
    for (var i = 0; i < pos.length / 3; i++) {
      acc.set(0, 0, 0); var any = false;
      p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      for (var k = 0; k < 4; k++) {
        var w = base.weights[i * 4 + k]; if (w <= 0) continue;
        var nm = names[base.joints[i * 4 + k]]; if (!st.fields[nm]) continue;
        st.disp(nm, p, d); acc.addScaledVector(d, w); any = true;
      }
      if (any) { pos[i * 3] += acc.x; pos[i * 3 + 1] += acc.y; pos[i * 3 + 2] += acc.z; }
    }
  };

  function computeNormals(pos, nrm, index, mh, N) {
    var acc = new Float32Array(N * 3), a = _v1, b = _v2, c = _v3;
    for (var i = 0; i < index.length; i += 3) {
      var i0 = index[i], i1 = index[i + 1], i2 = index[i + 2];
      a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3).sub(a); c.fromArray(pos, i2 * 3).sub(a); b.cross(c);
      var m0 = mh[i0] * 3, m1 = mh[i1] * 3, m2 = mh[i2] * 3;
      acc[m0] += b.x; acc[m0 + 1] += b.y; acc[m0 + 2] += b.z; acc[m1] += b.x; acc[m1 + 1] += b.y; acc[m1 + 2] += b.z; acc[m2] += b.x; acc[m2 + 1] += b.y; acc[m2 + 2] += b.z;
    }
    for (i = 0; i < mh.length; i++) { a.fromArray(acc, mh[i] * 3).normalize(); nrm[i * 3] = a.x; nrm[i * 3 + 1] = a.y; nrm[i * 3 + 2] = a.z; }
  }

  /* Per-vertex masks from the rest shape and face landmarks (MediaPipe-to-MakeHuman vertex map from
     HumanForge faceMap.ts). x: facial hair, y: cut zone (signed by side), z: swelling zone (signed by
     side), w: kick zone on the legs (signed by side). Second vec4: scalp, chest, face, 0. */
  var LM = { noseTip: 297, chin: 5225, mouthR: 3730, mouthL: 10398, lipTop: 455, lipBot: 495, faceR: 5201, faceL: 11812, jawAngR: 910, jawAngL: 7612,
    eyeOutR: 1119, eyeOutL: 7811, browR: 176, browL: 6952, browOutR: 14, browOutL: 6798, glabella: 133, cheekBoneR: 5324, cheekBoneL: 11928, noseBottom: 317,
    underChin: 5162, sideburnR: 5202, sideburnL: 11813, eyeLowR: 79, eyeLowL: 6863, forehead: 3750, noseBridge: 131, cheekLowR: 5332, cheekLowL: 11936 };
  Avatar.prototype.computeMasks = function (P, J) {
    var base = this.base, N = base.N, L = {}, k;
    for (k in LM) L[k] = new V3(P[LM[k] * 3], P[LM[k] * 3 + 1], P[LM[k] * 3 + 2]);
    var looks = this.looks, H = this.cfg.H;
    var m1 = new Float32Array(N * 4), m2 = new Float32Array(N * 4);
    var headC = J.Head.h.clone().lerp(J.Head.t, 0.45), p = new V3();
    var mouthY = (L.lipTop.y + L.lipBot.y) / 2, mouthHalf = Math.abs(L.mouthL.x - L.mouthR.x) / 2;
    var earZ = (L.sideburnR.z + L.sideburnL.z) / 2 - 0.01, earX = Math.abs(L.sideburnL.x - L.sideburnR.x) / 2;
    var browY = (L.browR.y + L.browL.y) / 2, eyeLowY = (L.eyeLowR.y + L.eyeLowL.y) / 2;
    var sbY = (L.sideburnR.y + L.sideburnL.y) / 2;
    var neckLine = L.underChin.y - 0.012 * (H / 1.75), cheekTop = L.cheekLowR.y + 0.004;
    var lipTopY = L.lipTop.y + 0.002, noseB = L.noseBottom.y;
    var thighLen = J.LeftUpLeg.h.distanceTo(J.LeftLeg.h);
    function g(pp, c, s) { return Math.exp(-pp.distanceToSquared(c) / (2 * s * s)); }
    for (var i = 0; i < N; i++) {
      p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      var ax = Math.abs(p.x), o1 = i * 4;
      // facial hair: front of the ears, under the cheek line, above the neckline, off the lips
      if (p.y < sbY + 0.01 && p.y > neckLine - 0.03 && p.z > earZ - 0.035 && ax < earX + 0.02 && p.y > J.Neck.h.y - 0.02) {
        var tx = clamp01(ax / Math.max(0.03, earX)), lineY = lerp(noseB + 0.004, sbY, Math.pow(tx, 1.6));
        if (tx > 0.55) lineY = lerp(lineY, cheekTop + 0.012, (tx - 0.55) * 0.9 * (1 - tx));
        var top = 1 - smooth(lineY - 0.006, lineY + 0.004, p.y);
        var neck = smooth(neckLine - 0.02, neckLine + 0.004, p.y);
        var lips = (p.y < lipTopY + 0.001 && p.y > L.lipBot.y - 0.002 && ax < mouthHalf + 0.002 && p.z > L.lipBot.z - 0.02) ? 0 : 1;
        var back = smooth(earZ - 0.035, earZ - 0.005, p.z);
        var bd = top * neck * lips * back;
        if (looks.moustacheOnly || looks.chinOnly) {
          var mo = looks.moustacheOnly ? (p.y > mouthY && p.y < noseB + 0.002 && ax < mouthHalf + 0.012 ? 1 : 0) : 0;
          var ch = looks.chinOnly ? (p.y < L.lipBot.y - 0.002 && ax < mouthHalf * 0.85 && p.y > L.chin.y - 0.01 ? 1 : 0) : 0;
          bd *= Math.max(mo, ch, 0.18);
        }
        m1[o1] = bd;
      }
      // cut zones: brow ridges, nose bridge, cheekbones; swelling: around the eyes and cheekbones
      var side = p.x >= 0 ? 1 : -1;
      if (p.y > L.chin.y - 0.02 && p.y < L.forehead.y && p.z > earZ - 0.02) {
        var cut = Math.max(g(p, L.browOutR, 0.012), g(p, L.browOutL, 0.012), g(p, L.browR, 0.011) * 0.8, g(p, L.browL, 0.011) * 0.8, g(p, L.noseBridge, 0.008) * 0.6, g(p, L.lipBot, 0.007) * 0.5);
        var sw = Math.max(g(p, L.eyeLowR, 0.014), g(p, L.eyeLowL, 0.014), g(p, L.cheekBoneR, 0.016), g(p, L.cheekBoneL, 0.016), g(p, L.browOutR, 0.014) * 0.8, g(p, L.browOutL, 0.014) * 0.8);
        m1[o1 + 1] = cut * side; m1[o1 + 2] = sw * side;
        m2[o1 + 2] = 1;
      }
      // scalp (shaved or buzzed shading): above the brows, behind the hairline, above the ears' bottoms
      var dy = p.y - (browY + 0.022), front = p.z - headC.z;
      if (p.y > sbY - 0.03 && (front < 0.045 || dy > 0) && p.distanceTo(headC) < 0.15 && p.y > J.Neck.h.y + 0.04) {
        var hl = smooth(-0.005, 0.02, dy + (0.06 - Math.max(0, front)) * 0.9);
        var nape = smooth(sbY - 0.035, sbY + 0.005, p.y);
        var earCut = ax > earX - 0.005 && p.y < sbY + 0.03 && p.z < earZ + 0.03 && p.z > earZ - 0.05 ? 0.3 : 1;
        m2[o1] = hl * nape * earCut;
      }
    }
    // kick zone: outer and front of thigh and calf, from the skin weights
    var bi = base.boneIndex, mh = base.mh, wts = base.weights, jts = base.joints;
    for (i = 0; i < mh.length; i++) {
      var m = mh[i], wl = 0, wr = 0;
      for (k = 0; k < 4; k++) { var b = jts[i * 4 + k], w = wts[i * 4 + k]; if (b === bi.LeftUpLeg || b === bi.LeftLeg) wl += w; if (b === bi.RightUpLeg || b === bi.RightLeg) wr += w; }
      if (wl + wr < 0.5) continue;
      var left = wl > wr, hip = left ? J.LeftUpLeg.h : J.RightUpLeg.h;
      p.set(P[m * 3], P[m * 3 + 1], P[m * 3 + 2]);
      var depth = (hip.y - p.y) / thighLen, outer = (left ? 1 : -1) * (p.x - hip.x) + (p.z - hip.z) * 0.4;
      var z = smooth(0.35, 0.6, depth) * (1 - smooth(1.55, 1.85, depth)) * smooth(-0.01, 0.03, outer);
      m1[m * 4 + 3] = z * (left ? 1 : -1);
    }
    return { m1: m1, m2: m2, L: L, headC: headC };
  };

  /* Skin: physically based, wrap lighting for a subsurface feel, sweat as clearcoat, painted stubble,
     beard shading, cuts, swelling and leg-kick redness driven by uniforms. */
  Avatar.prototype.skinMaterial = function (map, opts) {
    var self = this, looks = this.looks;
    var mat = new T.MeshPhysicalMaterial({ map: map, roughness: 0.56, metalness: 0, clearcoat: 0.0, clearcoatRoughness: 0.32, skinning: true });
    mat.color.set(looks.tint);
    var U = this.uniforms = this.uniforms || {
      uBeard: { value: looks.beard }, uBeardCol: { value: new T.Color(looks.beardColor) }, uScalp: { value: looks.scalp }, uHairCol: { value: new T.Color(looks.hairColor) },
      uDam: { value: new T.Vector2(0, 0) }, uLeg: { value: new T.Vector2(0, 0) }, uSweat: { value: 0 }, uFlush: { value: 0 },
      uTattoo: { value: this.tattooTex || null }, uTatOn: { value: this.tattooTex ? 1 : 0 }
    };
    mat.onBeforeCompile = function (sh) {
      for (var k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aMask;\nattribute vec4 aMask2;\nattribute vec4 aDecal;\nvarying vec4 vMask;\nvarying vec4 vMask2;\nvarying vec4 vDecal;\nuniform vec2 uDam;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMask = aMask; vMask2 = aMask2; vDecal = aDecal;\nfloat swl = max(aMask.z, 0.0) * uDam.x + max(-aMask.z, 0.0) * uDam.y;\ntransformed += objectNormal * swl * 0.0055;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec4 vMask;\nvarying vec4 vMask2;\nvarying vec4 vDecal;\nuniform float uBeard; uniform vec3 uBeardCol; uniform float uScalp; uniform vec3 uHairCol; uniform vec2 uDam; uniform vec2 uLeg; uniform float uSweat; uniform float uFlush;\nuniform sampler2D uTattoo; uniform float uTatOn;\n" +
          "float hh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n" +
          "float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1,0)), f.x), mix(hh(i + vec2(0,1)), hh(i + vec2(1,1)), f.x), f.y); }")
        .replace("#include <map_fragment>", "#include <map_fragment>\n" +
          "{ vec2 su = vUv;\n" +
          "  float hair = hh(floor(su * 2400.0)); float hair2 = vn(su * 900.0);\n" +
          "  float bd = clamp(vMask.x * uBeard, 0.0, 1.0);\n" +
          "  float stub = bd * (0.45 + 0.55 * smoothstep(0.25, 0.85, hair)) * (0.75 + 0.25 * hair2);\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, uBeardCol * 0.85, clamp(stub * (0.55 + 0.45 * bd), 0.0, 0.92));\n" +
          "  float sc = vMask2.x * uScalp; float sst = sc * (0.5 + 0.5 * smoothstep(0.2, 0.9, hair));\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, uHairCol * 0.8, clamp(sst * 0.85, 0.0, 0.9));\n" +
          "  float sideL = step(0.0, vMask.y);\n" +
          "  float dam = mix(uDam.y, uDam.x, step(0.0, vMask.z));\n" +
          "  float swz = abs(vMask.z) * dam; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.62, 0.66), clamp(swz * 0.75, 0.0, 0.6));\n" +
          "  float cz = abs(vMask.y) * mix(uDam.y, uDam.x, sideL);\n" +
          "  float bl = smoothstep(0.62, 0.8, vn(su * 140.0) * 0.6 + vn(su * 37.0) * 0.4 + cz * 0.55);\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.02, 0.02), clamp(bl * smoothstep(0.15, 0.45, cz), 0.0, 0.92));\n" +
          "  float lz = abs(vMask.w) * mix(uLeg.y, uLeg.x, step(0.0, vMask.w));\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.6, 0.58), clamp(lz * (0.75 + 0.25 * vn(su * 60.0)), 0.0, 0.7));\n" +
          "  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.06, 0.93, 0.92), uFlush * vMask2.z);\n" +
          "  if (uTatOn > 0.5) {\n" +
          "    vec2 d1 = vDecal.xy, d2 = vDecal.zw; float ink = 0.0;\n" +
          "    if (d1.x > 0.0 && d1.x < 1.0 && d1.y > 0.0 && d1.y < 1.0) ink = max(ink, texture2D(uTattoo, vec2(d1.x * 0.5, d1.y)).r);\n" +
          "    if (d2.x > 0.0 && d2.x < 1.0 && d2.y > 0.0 && d2.y < 1.0) ink = max(ink, texture2D(uTattoo, vec2(0.5 + d2.x * 0.5, d2.y)).r);\n" +
          "    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.085, 0.09), ink * 0.82);\n" +
          "  }\n" +
          "}")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.34, uSweat) + 0.12 * clamp(vMask.x * uBeard, 0.0, 1.0);")
        .replace("#include <clearcoat_normal_fragment_begin>", "#include <clearcoat_normal_fragment_begin>\nmaterial.clearcoat = uSweat * 0.55 * (0.7 + 0.3 * vMask2.z);")
        .replace("#include <lights_physical_pars_fragment>", T.ShaderChunk.lights_physical_pars_fragment
          .replace("vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = dotNL * directLight.color;\n\tfloat rawNL = dot( geometry.normal, directLight.direction );\n\tvec3 irradianceW = clamp( ( vec3( rawNL ) + vec3( 0.36, 0.16, 0.11 ) ) / vec3( 1.36, 1.16, 1.11 ), 0.0, 1.0 ) * directLight.color;\n\t#ifndef PHYSICALLY_CORRECT_LIGHTS\n\t\tirradianceW *= PI;\n\t#endif")
          .replace("reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );", "reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradianceW * BRDF_Diffuse_Lambert( material.diffuseColor );")
          .replace("reflectedLight.directDiffuse += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );", "reflectedLight.directDiffuse += irradianceW * BRDF_Diffuse_Lambert( material.diffuseColor );"));
    };
    mat.customProgramCacheKey = function () { return "fight-skin-v1"; };
    mat.defines = { CLEARCOAT: "" };
    return mat;
  };

  Avatar.prototype.makeBody = function (map, masks) {
    var base = this.base, n = base.mh.length, mh = base.mh;
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new T.BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new T.BufferAttribute(base.uv, 2));
    g.setAttribute("skinIndex", new T.BufferAttribute(base.joints, 4));
    g.setAttribute("skinWeight", new T.BufferAttribute(base.weights, 4));
    var a1 = new Float32Array(n * 4), a2 = new Float32Array(n * 4);
    for (var i = 0; i < n; i++) for (var k = 0; k < 4; k++) { a1[i * 4 + k] = masks.m1[mh[i] * 4 + k]; a2[i * 4 + k] = masks.m2[mh[i] * 4 + k]; }
    g.setAttribute("aMask", new T.BufferAttribute(a1, 4));
    g.setAttribute("aMask2", new T.BufferAttribute(a2, 4));
    g.setAttribute("aDecal", new T.BufferAttribute(this.decals(), 4));
    g.setIndex(new T.BufferAttribute(base.index.slice(), 1));
    this.bodyGeo = g;
    var mat = this.skinMat = this.skinMaterial(map);
    var mesh = this.body = new T.SkinnedMesh(g, mat);
    mesh.name = "body";
    this.group.add(mesh);
    mesh.bind(this.skeleton, new M4());
    this.meshes.push(mesh); this.disposables.push(g, mat);
  };

  /* Tattoo decals: planar projections in the rest pose, carried as a vertex attribute (u, v per decal;
     negative = off). Text and simple marks only where a source describes them. */
  Avatar.prototype.decals = function () {
    var base = this.base, n = base.mh.length, out = new Float32Array(n * 4).fill(-1), marks = this.looks.tattoos || [];
    if (!marks.length || !root.document) return out;
    var J = this.J, pos = this.pos, self = this;
    var cv = root.document.createElement("canvas"); cv.width = 1024; cv.height = 256;
    var ctx = cv.getContext("2d"); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1024, 256);
    marks.slice(0, 2).forEach(function (mk, slot) {
      var x0 = slot * 512;
      ctx.save(); ctx.translate(x0, 0); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff";
      if (mk.text) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        var fs = 150; ctx.font = "900 " + fs + "px 'Arial Black', Impact, sans-serif";
        while (ctx.measureText(mk.text).width > 470 && fs > 40) { fs -= 6; ctx.font = "900 " + fs + "px 'Arial Black', Impact, sans-serif"; }
        ctx.fillText(mk.text, 256, 132);
      } else if (mk.shape === "cross") {
        ctx.fillRect(236, 30, 40, 196); ctx.fillRect(176, 80, 160, 36);
      } else if (mk.shape === "sleeve") {
        for (var s = 0; s < 70; s++) { ctx.globalAlpha = 0.55 + 0.45 * ((s * 37) % 10) / 10; ctx.lineWidth = 6 + (s % 5) * 4; ctx.beginPath(); var yy = (s * 53) % 256, xx = (s * 97) % 512; ctx.arc(xx, yy, 14 + (s * 13) % 46, (s % 7), (s % 7) + 2.2 + (s % 3)); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      // projection frame
      var c = new V3(), ax = new V3(), ay = new V3(), w = 0.3, h = 0.1, nrmDir = new V3(), boneSel = null;
      if (mk.at === "upper back") { c.copy(J.Spine2.h).lerp(J.Neck.h, 0.55); c.z -= 0.2; ax.set(-1, 0, 0); ay.set(0, 1, 0); nrmDir.set(0, 0, -1); w = 0.3; h = 0.075; boneSel = ["Spine1", "Spine2", "Neck", "LeftShoulder", "RightShoulder"]; }
      else if (mk.at === "right shoulder" || mk.at === "left shoulder") {
        var sd = mk.at === "right shoulder" ? "Right" : "Left";
        c.copy(J[sd + "Arm"].h).lerp(J[sd + "ForeArm"].h, 0.22); var out2 = sd === "Right" ? -1 : 1; ax.set(0, 0, out2 > 0 ? -1 : 1); ay.set(0, 1, 0); nrmDir.set(out2, 0, 0); w = 0.075; h = 0.075; boneSel = [sd + "Arm", sd + "Shoulder"];
      } else if (mk.at === "right forearm" || mk.at === "left forearm") {
        var fd = mk.at === "right forearm" ? "Right" : "Left";
        c.copy(J[fd + "ForeArm"].h).lerp(J[fd + "Hand"].h, 0.5); ay.copy(J[fd + "Hand"].h).sub(J[fd + "ForeArm"].h).normalize(); ax.set(0, 0, 1).cross(ay).normalize(); nrmDir.set(0, 0, 1); w = 0.22; h = J[fd + "Hand"].h.distanceTo(J[fd + "ForeArm"].h) * 0.85; boneSel = [fd + "ForeArm"]; mk.wrap = true;
      } else return;
      var sel = {}; boneSel.forEach(function (b) { sel[base.boneIndex[b]] = 1; });
      var p = new V3(), nn = new V3(), axis = mk.wrap ? ay : null, ctr = c;
      for (var i = 0; i < n; i++) {
        var ok = 0; for (var k = 0; k < 4; k++) if (sel[base.joints[i * 4 + k]] && base.weights[i * 4 + k] > 0.3) ok = 1;
        if (!ok) continue;
        p.fromArray(pos, i * 3); nn.fromArray(self.nrm, i * 3);
        var u, v;
        if (axis) { // wrap around the forearm: angle around the bone, position along it
          var rel = p.clone().sub(ctr), along = rel.dot(axis), rad = rel.addScaledVector(axis, -along);
          var ang = Math.atan2(rad.dot(ax), rad.dot(nrmDir.clone().cross(axis).normalize().negate()));
          u = 0.5 + ang / (2 * Math.PI); v = 0.5 + along / h;
        } else {
          if (nn.dot(nrmDir) < 0.15) continue;
          var r2 = p.clone().sub(ctr); u = 0.5 + r2.dot(ax) / w; v = 0.5 + r2.dot(ay) / h;
        }
        out[i * 4 + slot * 2] = u; out[i * 4 + slot * 2 + 1] = 1 - v;
      }
    });
    var tex = new T.CanvasTexture(cv); tex.flipY = false; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
    this.tattooTex = tex; this.disposables.push(tex);
    return out;
  };

  /* HumanForge proxy fitting: barycentric refs into the MakeHuman shape plus offsets scaled by local
     proportions (runtime.ts reshape, MIT). */
  Avatar.prototype.addProxy = function (px, o) {
    var P = this.P, meta = px.meta, n = px.refs.length / 3;
    var s = meta.scale.map(function (t, k) { return Math.abs(P[t[0] * 3 + k] - P[t[1] * 3 + k]) / t[2]; });
    var pos = new Float32Array(n * 3), r = px.refs, w = px.refw, off = px.offs;
    for (var i = 0; i < n; i++) {
      var a = r[i * 3] * 3, b = r[i * 3 + 1] * 3, c = r[i * 3 + 2] * 3, wa = w[i * 3], wb = w[i * 3 + 1], wc = w[i * 3 + 2];
      for (var k = 0; k < 3; k++) pos[i * 3 + k] = wa * P[a + k] + wb * P[b + k] + wc * P[c + k] + off[i * 3 + k] * s[k];
    }
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.BufferAttribute(px.uv, 2));
    g.setAttribute("skinIndex", new T.BufferAttribute(px.joints, 4));
    g.setAttribute("skinWeight", new T.BufferAttribute(px.weights, 4));
    g.setIndex(new T.BufferAttribute(px.prim.index, 1));
    g.computeVertexNormals();
    var mat = new T.MeshStandardMaterial({ map: o.map || px.tex, roughness: o.roughness != null ? o.roughness : (o.hair ? 0.5 : 0.8), metalness: 0, skinning: true,
      side: meta.doubleSided ? T.DoubleSide : T.FrontSide });
    if (o.color) mat.color.set(o.color);
    var mesh, extra = null;
    if (o.hair) {
      mat.alphaTest = 0.5; mat.side = T.DoubleSide;
      hairShading(mat);
      var tips = mat.clone(); hairShading(tips); tips.alphaTest = 0.04; tips.transparent = true; tips.depthWrite = false;
      extra = new T.SkinnedMesh(g, tips); extra.renderOrder = 3; extra.castShadow = false;
      this.hairMats = [mat, tips];
      this.disposables.push(tips);
    } else if (meta.transparent) {
      mat.transparent = true; mat.depthWrite = false;
      if (o.brows || o.lashes) { mat.alphaTest = 0.02; }
    }
    if (o.eyes) { mat.transparent = false; mat.depthWrite = true; mat.roughness = 0.1; }
    mesh = new T.SkinnedMesh(g, mat);
    mesh.name = meta.kind;
    mesh.renderOrder = meta.transparent && !o.eyes ? 2 : 0;
    this.group.add(mesh); mesh.bind(this.skeleton, new M4());
    if (extra) { this.group.add(extra); extra.bind(this.skeleton, new M4()); this.meshes.push(extra); }
    if (o.brows || o.lashes || o.eyes) { mesh.castShadow = false; }
    this.meshes.push(mesh); this.disposables.push(g, mat);
    return mesh;
  };
  function hairShading(m) {
    // HumanForge: darken near-white transparent texels so strand tips fade instead of haloing
    m.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n\tdiffuseColor.rgb *= mix(0.35, 1.0, smoothstep(0.05, 0.85, diffuseColor.a));");
    };
    m.customProgramCacheKey = function () { return "fight-hair"; };
  }

  /* ------------------------------------------------------------ kit shells from the body itself */
  Avatar.prototype.boneW = function (i, names) {
    var base = this.base, w = 0;
    for (var k = 0; k < 4; k++) { var nm = this.boneNames()[base.joints[i * 4 + k]]; if (names[nm]) w += base.weights[i * 4 + k]; }
    return w;
  };
  Avatar.prototype.boneNames = function () {
    if (!this._bn) this._bn = this.base.man.bones.map(function (b) { return b.name.replace(PRE, ""); });
    return this._bn;
  };
  /* Copy the triangles whose three vertices pass `sel`, push each vertex out along its normal by
     thick(i) metres, keep uv and skinning, smooth normals per MakeHuman vertex. */
  Avatar.prototype.shell = function (sel, thick, extraAttr) {
    var base = this.base, idx = base.index, n = base.mh.length, map = new Int32Array(n).fill(-1), keep = [], i;
    var ok = new Uint8Array(n);
    for (i = 0; i < n; i++) ok[i] = sel(i) ? 1 : 0;
    var count = 0;
    for (i = 0; i < idx.length; i += 3) {
      var a = idx[i], b = idx[i + 1], c = idx[i + 2];
      if (!(ok[a] && ok[b] && ok[c])) continue;
      [a, b, c].forEach(function (v) { if (map[v] < 0) map[v] = count++; keep.push(map[v]); });
    }
    var pos = new Float32Array(count * 3), uv = new Float32Array(count * 2), si = new Uint16Array(count * 4), sw = new Float32Array(count * 4), mhs = new Uint16Array(count), src = new Int32Array(count);
    for (i = 0; i < n; i++) {
      var j = map[i]; if (j < 0) continue;
      var t = thick(i);
      for (var k = 0; k < 3; k++) pos[j * 3 + k] = this.pos[i * 3 + k] + this.nrm[i * 3 + k] * t;
      uv[j * 2] = base.uv[i * 2]; uv[j * 2 + 1] = base.uv[i * 2 + 1];
      for (k = 0; k < 4; k++) { si[j * 4 + k] = base.joints[i * 4 + k]; sw[j * 4 + k] = base.weights[i * 4 + k]; }
      mhs[j] = base.mh[i]; src[j] = i;
    }
    var nrm = new Float32Array(count * 3), index = new Uint32Array(keep);
    computeNormals(pos, nrm, index, mhs, base.N);
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    g.setAttribute("normal", new T.BufferAttribute(nrm, 3));
    g.setAttribute("uv", new T.BufferAttribute(uv, 2));
    g.setAttribute("skinIndex", new T.BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new T.BufferAttribute(sw, 4));
    if (extraAttr) { var ea = new Float32Array(count * extraAttr.size); for (i = 0; i < count; i++) extraAttr.fn(src[i], ea, i * extraAttr.size); g.setAttribute(extraAttr.name, new T.BufferAttribute(ea, extraAttr.size)); }
    g.setIndex(new T.BufferAttribute(index, 1));
    return g;
  };
  /* Drop body triangles fully covered by a shell (they would poke through when skinned). */
  Avatar.prototype.hideUnder = function (covered) {
    var idx = this.bodyGeo.index.array, keep = [];
    for (var i = 0; i < idx.length; i += 3) if (!(covered(idx[i]) && covered(idx[i + 1]) && covered(idx[i + 2]))) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    this.bodyGeo.setIndex(new T.BufferAttribute(new Uint32Array(keep), 1));
  };
  Avatar.prototype.addShell = function (g, mat, name) {
    var m = new T.SkinnedMesh(g, mat); m.name = name;
    this.group.add(m); m.bind(this.skeleton, new M4());
    this.meshes.push(m); this.disposables.push(g, mat);
    return m;
  };
  function fabricMaterial(color, opts) {
    opts = opts || {};
    var mat = new T.MeshStandardMaterial({ color: color, roughness: opts.rough != null ? opts.rough : 0.78, metalness: 0, skinning: true, side: T.DoubleSide });
    mat.userData.U = opts.uniforms || {};
    if (opts.shader) {
      mat.onBeforeCompile = function (sh) {
        for (var k in mat.userData.U) sh.uniforms[k] = mat.userData.U[k];
        opts.shader(sh);
      };
      mat.customProgramCacheKey = function () { return opts.key || "fabric"; };
    } else {
      mat.onBeforeCompile = function (sh) {
        sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb *= 0.35;");
      };
      mat.customProgramCacheKey = function () { return "fabric-plain"; };
    }
    return mat;
  }

  Avatar.prototype.makeFightKit = function () {
    var self = this, J = this.J, app = this.app, H = this.cfg.H, pos = this.pos, nrm = this.nrm;
    var waistY = J.Hips.h.y + 0.028 * H / 1.75 * 1.75 * 0.6 + 0.012, hipJ = J.LeftUpLeg.h.y, thigh = J.LeftUpLeg.h.distanceTo(J.LeftLeg.h);
    waistY = J.Hips.h.y + 0.018 * (H / 1.75);
    var hemY = hipJ - thigh * (this.cfg.female ? 0.38 : 0.5);
    var ARMS = {}, LEGS = {}, i;
    ["Left", "Right"].forEach(function (s) { ["Arm", "ForeArm", "Hand", "Shoulder"].forEach(function (b) { ARMS[s + b] = 1; }); FINGERS.concat(["Thumb"]).forEach(function (f) { for (var k = 1; k <= 3; k++) ARMS[s + "Hand" + f + k] = 1; }); LEGS[s + "UpLeg"] = 1; LEGS[s + "Leg"] = 1; });
    function y(i) { return pos[i * 3 + 1]; }
    function inShorts(i, pad) { pad = pad || 0; return y(i) < waistY - pad && y(i) > hemY + pad && self.boneW(i, ARMS) < 0.05; }
    var hemSpan = Math.max(0.05, waistY - hemY);
    var shortsG = this.shell(function (i) { return inShorts(i); }, function (i) {
      var v = clamp01((y(i) - hemY) / hemSpan), lat = Math.abs(nrm[i * 3]);
      return 0.006 + 0.016 * (1 - smooth(0.25, 0.75, v)) + 0.007 * lat * (1 - v);
    }, { name: "aKit", size: 4, fn: function (i, out, o) {
      out[o] = clamp01((y(i) - hemY) / hemSpan); out[o + 1] = Math.atan2(nrm[i * 3], nrm[i * 3 + 2]); out[o + 2] = pos[i * 3] >= 0 ? 1 : -1; out[o + 3] = pos[i * 3 + 2];
    } });
    var cMain = colorOf(app.shorts, "#2563c9"), cTrim = colorOf(app.trim, "#e9eef5"), cBand = colorOf(app.band || app.waistband, "#15171b");
    var U = { uMain: { value: cMain }, uTrim: { value: cTrim }, uBand: { value: cBand }, uBandW: { value: 0.045 / hemSpan } };
    var shorts = fabricMaterial(cMain, { rough: 0.62, uniforms: U, key: "shorts", shader: function (sh) {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aKit;\nvarying vec4 vKit;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvKit = aKit;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec4 vKit;\nuniform vec3 uMain; uniform vec3 uTrim; uniform vec3 uBand; uniform float uBandW;")
        .replace("#include <color_fragment>", "#include <color_fragment>\n" +
          "{ float v = vKit.x; float a = abs(vKit.y); float side = abs(a - 1.5708);\n" +
          "  vec3 c = uMain;\n" +
          "  float panel = 1.0 - smoothstep(0.30, 0.34, side);\n" +
          "  float piping = smoothstep(0.30, 0.32, side) * (1.0 - smoothstep(0.36, 0.38, side));\n" +
          "  c = mix(c, uMain * 0.55 + uBand * 0.25, panel * step(v, 1.0 - uBandW));\n" +
          "  c = mix(c, uTrim, piping * step(v, 1.0 - uBandW));\n" +
          "  float slit = step(side, 0.05) * (1.0 - smoothstep(0.0, 0.14, v));\n" +
          "  c = mix(c, uTrim, smoothstep(1.0 - uBandW - 0.008, 1.0 - uBandW, v));\n" +
          "  c = mix(c, uBand, smoothstep(1.0 - uBandW + 0.012, 1.0 - uBandW + 0.02, v));\n" +
          "  c = mix(c, uTrim, (1.0 - smoothstep(0.018, 0.03, v)) * 0.9);\n" +
          "  float weave = 0.94 + 0.06 * fract(sin(dot(floor(vUv * 900.0), vec2(12.9898, 78.233))) * 43758.5453);\n" +
          "  diffuseColor.rgb = c * weave;\n" +
          "  if (slit > 0.5) discard;\n" +
          "  if (!gl_FrontFacing) diffuseColor.rgb *= 0.3; }")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, smoothstep(1.0 - uBandW, 1.0 - uBandW + 0.02, vKit.x));");
    } });
    this.shortsMat = shorts;
    this.addShell(shortsG, shorts, "shorts");
    this.hideUnder(function (i) { return inShorts(i, 0.02); });
    // 4 oz open-finger gloves: palm, back and the first phalanx; knuckle padding on the back; wrist strap
    var HAND = {}, PROX = {}, DIST = {};
    ["Left", "Right"].forEach(function (s) {
      HAND[s + "Hand"] = 1;
      FINGERS.forEach(function (f) { PROX[s + "Hand" + f + "1"] = 1; DIST[s + "Hand" + f + "2"] = 1; DIST[s + "Hand" + f + "3"] = 1; });
      PROX[s + "HandThumb1"] = 1; PROX[s + "HandThumb2"] = 0.6; DIST[s + "HandThumb3"] = 1;
    });
    var palmN = { Left: this.palmNormal(true), Right: this.palmNormal(false) };
    function side(i) { return pos[i * 3] >= 0 ? "Left" : "Right"; }
    function wristT(i) { // distance from the wrist back along the forearm (m), negative into the hand
      var s = side(i), W = J[s + "Hand"].h, E = J[s + "ForeArm"].h, d = _v1.copy(E).sub(W).normalize();
      return _v2.fromArray(pos, i * 3).sub(W).dot(d);
    }
    function onArmSide(i) { return self.boneW(i, ARMS) > 0.5; }
    function inGlove(i) { if (!onArmSide(i)) return false; var wp = self.boneW(i, HAND) + self.boneW(i, PROX), wd = self.boneW(i, DIST); var t = wristT(i); return (wp > 0.55 && wd < 0.35 && t < 0.02) || (t >= -0.01 && t < 0.065 && wd < 0.1); }
    var gloveC = colorOf(app.glove, "#16181c"), accent = colorOf(app.glove_accent || app.band || app.shorts, "#2563c9");
    var gloveG = this.shell(inGlove, function (i) {
      var t = wristT(i), s = side(i), nd = palmN[s], dorsal = -(nrm[i * 3] * nd.x + nrm[i * 3 + 1] * nd.y + nrm[i * 3 + 2] * nd.z);
      if (t > 0.0) return 0.0075 + (t < 0.05 ? 0.002 : 0);
      var knuck = self.boneW(i, PROX);
      return 0.0035 + 0.011 * smooth(-0.1, 0.6, dorsal) * (0.45 + 0.55 * knuck);
    }, { name: "aKit", size: 4, fn: function (i, out, o) { var t = wristT(i); out[o] = t; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; } });
    var gU = { uMain: { value: gloveC }, uAcc: { value: accent } };
    var glove = fabricMaterial(gloveC, { rough: 0.38, uniforms: gU, key: "glove", shader: function (sh) {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aKit;\nvarying vec4 vKit;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvKit = aKit;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec4 vKit;\nuniform vec3 uMain; uniform vec3 uAcc;")
        .replace("#include <color_fragment>", "#include <color_fragment>\n{ float t = vKit.x; vec3 c = uMain;\n c = mix(c, uAcc, smoothstep(0.004, 0.007, t) * (1.0 - smoothstep(0.011, 0.014, t)));\n c = mix(c, uMain * 1.25 + 0.03, smoothstep(0.052, 0.056, t));\n diffuseColor.rgb = c; if (!gl_FrontFacing) diffuseColor.rgb *= 0.3; }");
    } });
    this.addShell(gloveG, glove, "gloves");
    // hand wraps peeking out above the strap
    var wrapG = this.shell(function (i) { if (!onArmSide(i)) return false; var t = wristT(i); return t > 0.058 && t < 0.083 && self.boneW(i, DIST) < 0.1; }, function () { return 0.0042; });
    this.addShell(wrapG, fabricMaterial(new T.Color("#e9e6dc"), { rough: 0.9 }), "wraps");
    this.hideUnder(function (i) { if (!onArmSide(i)) return false; var wp = self.boneW(i, HAND) + self.boneW(i, PROX), t = wristT(i); return (wp > 0.8 && t < -0.005 && self.boneW(i, DIST) < 0.05) || (t > 0.005 && t < 0.075); });
  };

  Avatar.prototype.palmNormal = function (left) {
    var J = this.J, s = left ? "Left" : "Right";
    var d = J[s + "HandMiddle1"].h.clone().sub(J[s + "Hand"].h).normalize();
    var across = J[s + "HandIndex1"].h.clone().sub(J[s + "HandPinky1"].h).normalize();
    var n = new V3().crossVectors(d, across).normalize();
    var th = J[s + "HandThumb2"].h.clone().sub(J[s + "Hand"].h);
    if (th.dot(n) < 0) n.negate();   // the thumb sits a little to the palm side
    return n;
  };

  Avatar.prototype.makeRefKit = function () {
    var self = this, J = this.J, pos = this.pos, nrm = this.nrm, H = this.cfg.H;
    var ARMS = {}, UPARM = {}, FORE = {}, HANDS = {}, FEET = {}, i;
    ["Left", "Right"].forEach(function (s) {
      UPARM[s + "Arm"] = 1; FORE[s + "ForeArm"] = 1; HANDS[s + "Hand"] = 1; ARMS[s + "Arm"] = ARMS[s + "ForeArm"] = ARMS[s + "Hand"] = 1;
      FINGERS.concat(["Thumb"]).forEach(function (f) { for (var k = 1; k <= 3; k++) { HANDS[s + "Hand" + f + k] = 1; ARMS[s + "Hand" + f + k] = 1; } });
      FEET[s + "Foot"] = 1; FEET[s + "ToeBase"] = 1;
    });
    function y(i) { return pos[i * 3 + 1]; }
    var waistY = J.Hips.h.y + 0.03 * (H / 1.75), neckY = J.Neck.h.y + 0.012, ankleY = J.LeftFoot.h.y + 0.035;
    function upperT(i) { var s = pos[i * 3] >= 0 ? "Left" : "Right", A = J[s + "Arm"].h, E = J[s + "ForeArm"].h, d = _v1.copy(E).sub(A); var L = d.length(); return _v2.fromArray(pos, i * 3).sub(A).dot(d.normalize()) / L; }
    function inShirt(i, pad) { pad = pad || 0; if (y(i) < waistY - 0.05 + pad || y(i) > neckY - pad) return false; var wa = self.boneW(i, ARMS); if (wa < 0.4) return true; return self.boneW(i, UPARM) > 0.4 && upperT(i) < 0.55 - pad * 4; }
    var shirtG = this.shell(function (i) { return inShirt(i); }, function (i) { return 0.007 + 0.006 * smooth(waistY + 0.1, waistY - 0.03, y(i)); });
    this.addShell(shirtG, fabricMaterial(colorOf(this.app.shirt, "#121316"), { rough: 0.85 }), "shirt");
    function inPants(i, pad) { pad = pad || 0; return y(i) < waistY + 0.005 - pad && y(i) > ankleY + pad && self.boneW(i, ARMS) < 0.05; }
    var hipJ = J.LeftUpLeg.h.y;
    var pantsG = this.shell(function (i) { return inPants(i); }, function (i) { return 0.009 + 0.012 * smooth(hipJ - 0.1, ankleY + 0.1, y(i)); });
    this.addShell(pantsG, fabricMaterial(colorOf(this.app.pants, "#2b2e34"), { rough: 0.8 }), "trousers");
    var shoeG = this.shell(function (i) { return self.boneW(i, FEET) > 0.3 || (y(i) < ankleY + 0.01 && self.boneW(i, ARMS) < 0.05 && self.boneW(i, FEET) + 0.01 > 0); }, function (i) { return y(i) < 0.012 ? 0.002 : 0.008; });
    this.addShell(shoeG, fabricMaterial(new T.Color("#0c0d10"), { rough: 0.45 }), "shoes");
    var gloveG = this.shell(function (i) { return self.boneW(i, HANDS) > 0.3; }, function () { return 0.0014; });
    this.addShell(gloveG, fabricMaterial(colorOf(this.app.gloves, "#15161a"), { rough: 0.35 }), "latex");
    this.hideUnder(function (i) { return inShirt(i, 0.02) || inPants(i, 0.02) || self.boneW(i, FEET) > 0.9 || self.boneW(i, HANDS) > 0.95; });
  };

  /* Thin alpha-tested shell over the beard area for short and full beards (stubble stays painted). */
  Avatar.prototype.makeBeardShell = function (masks) {
    var self = this, base = this.base, m1 = masks.m1, len = this.looks.beardShell, mh = base.mh;
    var g = this.shell(function (i) { return m1[mh[i] * 4] > 0.08; }, function (i) { return len * clamp01(m1[mh[i] * 4] * 1.4); },
      { name: "aKit", size: 4, fn: function (i, out, o) { out[o] = m1[mh[i] * 4]; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; } });
    var col = new T.Color(this.looks.beardColor);
    var U = { uCol: { value: col } };
    var mat = new T.MeshStandardMaterial({ color: col, roughness: 0.75, metalness: 0, skinning: true, transparent: false, alphaTest: 0.5 });
    mat.onBeforeCompile = function (sh) {
      for (var k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aKit;\nvarying vec4 vKit;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvKit = aKit;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec4 vKit;\nfloat bh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }")
        .replace("#include <alphatest_fragment>", "float strand = bh(floor(vUv * 1800.0)); diffuseColor.a = step(1.0 - clamp(vKit.x * 1.15, 0.0, 1.0) * 0.82, strand);\ndiffuseColor.rgb *= 0.75 + 0.35 * strand;\n#include <alphatest_fragment>");
    };
    mat.customProgramCacheKey = function () { return "beard-shell"; };
    var m = this.addShell(g, mat, "beard"); m.castShadow = false;
  };

  /* ------------------------------------------------------------ retargeting */
  Avatar.prototype.initRetarget = function () {
    var bones = this.bones, bi = this.bi, J = this.J, self = this;
    var Rq = this.restQ = [], Rp = this.restP = [], Lp = this.restLocalP = [], Lq = this.restLocalQ = [], par = this.parent = [];
    this.base.man.bones.forEach(function (b, k) {
      Rq.push(self.restWorld[k].q.clone()); Rp.push(self.restWorld[k].p.clone());
      Lp.push(bones[k].position.clone()); Lq.push(bones[k].quaternion.clone()); par.push(b.parent);
    });
    this.W = bones.map(function () { return new Q(); });     // target world quaternions
    this.Wp = bones.map(function () { return new V3(); });   // world positions (FK)
    this.order = bones.map(function (b, k) { return k; });   // manifest bones are parent-before-child
    // limb frames: C = inverse(anatomical basis at rest) * rest world rotation
    this.limbs = LIMBS.map(function (L) {
      var s = J[L.up].h, e = J[L.lo].h, w = J[L.end].h, tip = L.arm ? J[L.tip].h : J[L.tip].h;
      var d = w.clone().sub(s).normalize(), pole = e.clone().sub(s).addScaledVector(d, -e.clone().sub(s).dot(d));
      if (!L.arm || pole.length() < 0.004) pole = L.arm ? new V3(0, 0, -1) : new V3(0, 0, 1);
      pole.normalize();
      var Au = basisQuat(new Q(), e.clone().sub(s), pole), Al = basisQuat(new Q(), w.clone().sub(e), pole);
      var o = { L: L, iu: bi[L.up], il: bi[L.lo], ie: bi[L.end], l1: s.distanceTo(e), l2: e.distanceTo(w), restPole: pole };
      o.Cu = Au.clone().invert().multiply(Rq[o.iu]);
      o.Cl = Al.clone().invert().multiply(Rq[o.il]);
      if (L.arm) {
        var Ah = basisQuat(new Q(), tip.clone().sub(w), pole);
        o.Ch = Ah.clone().invert().multiply(Rq[o.ie]);
        o.fist = w.distanceTo(tip) * 0.78;     // wrist to glove centre
      }
      return o;
    });
    // fingers: fist curl as local rotations about each finger's hinge (palm side)
    this.curl = {};
    ["Left", "Right"].forEach(function (s) {
      var pn = self.palmNormal(s === "Left");
      FINGERS.concat(["Thumb"]).forEach(function (f) {
        for (var j = 1; j <= 3; j++) {
          var nm = s + "Hand" + f + j, k = bi[nm]; if (k == null) continue;
          var dir = J[nm].t.clone().sub(J[nm].h).normalize();
          var hinge = new V3().crossVectors(dir, pn).normalize();     // rotating about it moves the tip toward the palm
          var localAxis = hinge.clone().applyQuaternion(Rq[k].clone().invert());
          var ang = f === "Thumb" ? [0.25, 0.55, 0.5][j - 1] : [1.45, 1.6, 1.05][j - 1];
          if (f === "Pinky" && j === 1) ang = 1.5;
          self.curl[nm] = { k: k, axis: localAxis, ang: ang };
        }
      });
    });
    this.fistAmt = this.cfg.ref ? 0.25 : 0.92;
    // clip reference rotations: align each rest bone to the clip skeleton's rest direction
    var C = this.base.clips;
    if (C) {
      this.clipBones = C.bones.map(function (nm) { return bi[nm]; });
      var childOf = { Hips: "Spine", Spine: "Spine1", Spine1: "Spine2", Spine2: "Neck", Neck: "Head", LeftShoulder: "LeftArm", RightShoulder: "RightArm", LeftArm: "LeftForeArm", RightArm: "RightForeArm",
        LeftForeArm: "LeftHand", RightForeArm: "RightHand", LeftHand: "LeftHandMiddle1", RightHand: "RightHandMiddle1", LeftUpLeg: "LeftLeg", RightUpLeg: "RightLeg", LeftLeg: "LeftFoot", RightLeg: "RightFoot", LeftFoot: "LeftToeBase", RightFoot: "RightToeBase" };
      this.clipRef = C.bones.map(function (nm) {
        var k = bi[nm], dmh = childOf[nm] ? J[childOf[nm]].h.clone().sub(J[nm].h) : J[nm].t.clone().sub(J[nm].h);
        var ds = new V3().fromArray(C.src.dirs[nm]);
        return new Q().setFromUnitVectors(dmh.normalize(), ds.normalize()).multiply(Rq[k]);
      });
      this.hipsY = J.Hips.h.y;
    }
  };

  Avatar.prototype.measure = function () {
    var J = this.J;
    this.dims = {
      H: this.cfg.H,
      spine: J.Spine.h.clone().sub(J.Hips.h), chest: J.Spine2.h.clone().sub(J.Spine.h), neck: J.Neck.h.clone().sub(J.Spine2.h), head: J.Head.h.clone().sub(J.Neck.h),
      shL: J.LeftArm.h.clone().sub(J.Spine2.h), shR: J.RightArm.h.clone().sub(J.Spine2.h),
      hipL: J.LeftUpLeg.h.clone().sub(J.Hips.h), hipR: J.RightUpLeg.h.clone().sub(J.Hips.h),
      ua: this.limbs[0].l1, la: this.limbs[0].l2 + this.limbs[0].fist, fa: this.limbs[0].l2,
      th: this.limbs[2].l1, sh: this.limbs[2].l2, ankle: J.LeftFoot.h.y, hipsY: J.Hips.h.y, hipOff: J.Hips.h.y - J.LeftUpLeg.h.y,
      headTop: this.cfg.H, span: this.span0 + (this.armStretch - 1) * 2 * (this.limbs[0].l1 / this.armStretch + this.limbs[0].l2 / this.armStretch)
    };
  };

  /* Bind to an Actor's primitive Rig: resize the driver to this skeleton, hide its meshes, hook hits. */
  Avatar.prototype.bindDriver = function (actor) {
    var rig = actor.rig, D = this.dims, self = this;
    this.actor = actor; this.rig = rig;
    var H0 = rig.H;                                         // driver poses are fractions of the real height
    actor.H = D.H; rig.H = D.H;
    rig.spine.position.copy(D.spine); rig.chest.position.copy(D.chest); rig.neck.position.copy(D.neck); rig.head.position.copy(D.head);
    rig.armL.sh.position.copy(D.shL); rig.armR.sh.position.copy(D.shR);
    rig.ua = D.ua; rig.la = D.la; rig.armL.el.position.set(0, -D.ua, 0); rig.armR.el.position.set(0, -D.ua, 0);
    rig.legL.hip.position.copy(D.hipL); rig.legR.hip.position.copy(D.hipR);
    rig.th = D.th; rig.sh = D.sh; rig.legL.knee.position.set(0, -D.th, 0); rig.legR.knee.position.set(0, -D.th, 0);
    rig.legL.foot.position.set(0, -D.sh, 0); rig.legR.foot.position.set(0, -D.sh, 0);
    rig.ankleH = D.ankle;
    rig.meshes.forEach(function (m) { m.visible = false; });
    // pelvis height: the poses were written for the primitive's legs; keep each pose's knee bend
    if (!rig._avOrigSetTorso) {
      rig._avOrigSetTorso = rig.setTorso;
      rig.setTorso = function (P) {
        var py = P.py, H = rig.H, w = actor.mode === "sit" ? 0 : smooth(0.16, 0.3, py / H);
        if (w > 0) {
          var r = (py - 0.03 * H - 0.045 * H) / (0.445 * H);
          var py2 = D.ankle + r * (D.th + D.sh) + D.hipOff;
          P.py = py + (py2 - py) * w;
        }
        rig._avOrigSetTorso.call(rig, P);
        P.py = py;
      };
      // aims follow what is drawn while a clip moves the body away from the driver
      ["headPos", "bodyPos", "liverPos"].forEach(function (fn) {
        var orig = rig[fn];
        rig["_av_" + fn] = orig;
        rig[fn] = function (out) {
          orig.call(rig, out);
          var av = rig.avatar;
          if (av && av.clipW > 0.02) { av.landmark(fn, _v5); out.lerp(_v5, clamp01(av.clipW)); }
          return out;
        };
      });
    }
    rig.avatar = this;
    actor.feet.forEach(function (f) { f.p.y = D.ankle; f.to.y = D.ankle; f.from.y = D.ankle; });
    if (!actor._avOrigTakeHit) {
      actor._avOrigTakeHit = actor.takeHit;
      actor.takeHit = function (move, power, from) {
        actor._avOrigTakeHit.call(actor, move, power, from);
        if (actor.avatar) actor.avatar.hit(move, power, from);
      };
    }
    actor.avatar = this;
    this.lastMode = actor.mode;
    this.sync();
  };
  Avatar.prototype.unbind = function () {
    var a = this.actor, rig = this.rig;
    if (!a) return;
    if (rig.avatar === this) rig.avatar = null;
    if (a.avatar === this) a.avatar = null;
    rig.meshes.forEach(function (m) { m.visible = true; });
    this.actor = null; this.rig = null;
  };

  Avatar.prototype.landmark = function (fn, out) {
    var k = fn === "headPos" ? this.bi.Head : (fn === "bodyPos" ? this.bi.Spine2 : this.bi.Spine1);
    out.copy(this.Wp[k]);
    if (fn === "headPos") out.add(_v4.set(0, this.cfg.H * 0.055, 0).applyQuaternion(this.W[k].clone().multiply(this.restQ[k].clone().invert())));
    return out;
  };

  /* Damage, sweat and flush. */
  var HEAD_MOVES = { jab: 0.6, cross: 1, hook: 1.1, overhand: 1.2, upper: 1, headkick: 1.6, elbow: 1.4, kneehead: 1.4, gnp: 0.8, gnpelbow: 1.3, upelbow: 0.9, short: 0.6 };
  Avatar.prototype.hit = function (move, power, from) {
    var p = power || 1, side;
    if (HEAD_MOVES[move]) {
      // a right-hand shot from an orthodox opponent lands on this fighter's left side
      side = from && from.hi === 1 ? 0 : 1;
      if (from && from.stance < 0) side = 1 - side;
      this.damHead[side] = Math.min(1, this.damHead[side] + 0.012 * HEAD_MOVES[move] * p);
      this.damHead[1 - side] = Math.min(1, this.damHead[1 - side] + 0.004 * HEAD_MOVES[move] * p);
    } else if (move === "calf" || move === "inside") {
      var a = this.actor, lead = a && a.stance < 0 ? 1 : 0;
      this.damLeg[lead] = Math.min(1, this.damLeg[lead] + 0.05 * p);
    } else this.damBody = Math.min(1, this.damBody + 0.02 * p);
    this.applyLooks();
  };
  Avatar.prototype.setRound = function (r) { this.sweat = clamp01(0.25 + 0.17 * r); this.applyLooks(); };
  Avatar.prototype.resetDamage = function () { this.damHead = [0, 0]; this.damLeg = [0, 0]; this.damBody = 0; this.sweat = 0.15; this.applyLooks(); };
  Avatar.prototype.applyLooks = function () {
    var U = this.uniforms; if (!U) return;
    U.uDam.value.set(this.damHead[0], this.damHead[1]);
    U.uLeg.value.set(this.damLeg[0], this.damLeg[1]);
    U.uSweat.value = this.sweat;
    U.uFlush.value = clamp01(this.sweat * 0.8 + (this.damHead[0] + this.damHead[1]) * 0.3);
  };

  /* Clip layers: { clip, t, speed, w, target, rate, mask, hold, stop, anchor } */
  Avatar.prototype.clipByName = function (name) { var C = this.base.clips; return C && C.clips[name] ? C.clips[name] : null; };
  Avatar.prototype.clip = function (name, weight, fade, opts) {
    opts = opts || {};
    var c = this.clipByName(name); if (!c) return null;
    var mask = opts.mask || "full", L = null;
    this.layers.forEach(function (l) { if (l.mask === mask) L = l; });
    if (weight <= 0) { if (L) { L.target = 0; L.rate = 1 / Math.max(0.05, fade || 0.3); } return null; }
    var a = this.actor, start = opts.t || 0;
    var anchor = { x: 0, z: 0, yaw: a ? a.yaw : 0 };
    if (L && L.clip === c && !opts.restart) { L.target = weight; L.rate = 1 / Math.max(0.05, fade || 0.3); return L; }
    if (!L) { L = { w: 0 }; this.layers.push(L); }
    else if (L.w > 0.05 && L.clip) { L.prev = { clip: L.clip, t: L.t, w: L.w, anchor: L.anchor }; }
    L.clip = c; L.t = start; L.speed = opts.speed || 1; L.target = weight; L.rate = 1 / Math.max(0.05, fade || 0.3);
    L.mask = mask; L.stop = opts.stop != null ? opts.stop : null; L.loop = opts.loop != null ? opts.loop : c.loop; L.anchor = anchor;
    if (mask === "full" && a) {
      // keep the hips where they are at the clip's first frame
      var d = this.clipPelvis(c, start, _v1), cy = Math.cos(anchor.yaw), sy = Math.sin(anchor.yaw), h = this.hipsY;
      var hp = this.Wp[this.bi.Hips];
      anchor.x = hp.x - (d.x * cy + d.z * sy) * h; anchor.z = hp.z - (-d.x * sy + d.z * cy) * h;
    }
    return L;
  };
  Avatar.prototype.clipPelvis = function (c, t, out) {
    var f = clamp(t * this.base.clips.fps, 0, c.frames - 1), f0 = Math.floor(f), f1 = Math.min(c.frames - 1, f0 + 1), a = f - f0, D = c.data, per = c.per;
    return out.set(lerp(D[f0 * per], D[f1 * per], a) / 8192, lerp(D[f0 * per + 1], D[f1 * per + 1], a) / 8192, lerp(D[f0 * per + 2], D[f1 * per + 2], a) / 8192);
  };
  Avatar.prototype.clipQuat = function (c, t, j, out) {
    var f = clamp(t * this.base.clips.fps, 0, c.frames - 1), f0 = Math.floor(f), f1 = Math.min(c.frames - 1, f0 + 1), a = f - f0, D = c.data, per = c.per;
    var o0 = f0 * per + 3 + j * 4, o1 = f1 * per + 3 + j * 4;
    out.set(D[o0] / 32767, D[o0 + 1] / 32767, D[o0 + 2] / 32767, D[o0 + 3] / 32767).normalize();
    if (a > 0) { _q4.set(D[o1] / 32767, D[o1 + 1] / 32767, D[o1 + 2] / 32767, D[o1 + 3] / 32767).normalize(); out.slerp(_q4, a); }
    return out;
  };

  /* Live update: watch the actor's mode and reactions, advance clip layers. Not called in replays. */
  Avatar.prototype.tick = function (dt) {
    var a = this.actor; if (!a) return;
    var m = a.mode;
    if (m !== this.lastMode) { this.onMode(this.lastMode, m); this.lastMode = m; }
    var r = a.react;
    if (r && r !== this.lastReact) this.onReact(r);
    this.lastReact = r;
    for (var i = this.layers.length - 1; i >= 0; i--) {
      var L = this.layers[i], c = L.clip;
      L.t += dt * L.speed;
      if (L.loop) { if (L.t > c.dur) L.t -= c.dur; }
      else if (L.t > c.dur) L.t = c.dur;
      if (L.stop != null && L.t > L.stop) L.t = L.stop;
      if (L.w < L.target) L.w = Math.min(L.target, L.w + dt * L.rate); else if (L.w > L.target) L.w = Math.max(L.target, L.w - dt * L.rate);
      if (L.prev) { L.prev.w -= dt * L.rate * 1.5; L.prev.t = Math.min(L.prev.clip.dur, L.prev.t + dt); if (L.prev.w <= 0) L.prev = null; }
      if (L.autoOff != null) { L.autoOff -= dt; if (L.autoOff <= 0) { L.target = 0; L.autoOff = null; } }
      if (L.w <= 0 && L.target <= 0 && !L.prev) this.layers.splice(i, 1);
    }
    var standing = m === "stand" || m === "clinch";
    this.idleW += ((standing && !a.act ? 0.75 : (standing ? 0.35 : 0)) - this.idleW) * Math.min(1, dt * 3);
    this.idleT += dt * (a.bounce || 1) * 0.9;
  };
  Avatar.prototype.onMode = function (from, to) {
    var C = this.base.clips; if (!C) return;
    var self = this, pick = (this.app.slug || "x").length % 2 ? "fallBack" : "fallBack2";
    if (to === "ko") this.clip(pick, 1, 0.12, { restart: true });
    else if (to === "down") {
      var c = this.clipByName("fallBack");
      this.clip("fallBack", 1, 0.12, { restart: true, speed: 1.45, stop: c ? c.dur * 0.62 : null });
    } else if (to === "stand" && (from === "down")) this.clip("getUp", 1, 0.08, { restart: true, speed: 1.55, t: 0.05 });
    else if (to === "celebrate") this.clip("fistPump", 0.85, 0.5, { mask: "upper", loop: true });
    else {
      this.layers.forEach(function (L) { if (L.mask === "upper" || (L.mask === "full" && L.clip && L.clip.name !== "getUp")) { L.target = 0; L.rate = 1 / 0.45; } });
    }
    if (to === "stand" && from === "down") {
      // fade the get-up out as it completes
      var L = null; this.layers.forEach(function (l) { if (l.mask === "full") L = l; });
      if (L) L.autoOff = (L.clip.dur - L.t) / L.speed - 0.3;
    }
    if (to === "walk" && (from === "ko" || from === "down" || from === null)) this.layers.forEach(function (l) { l.target = 0; l.rate = 1 / 0.3; });
  };
  Avatar.prototype.onReact = function (r) {
    if (r.type === "wobble") { var L = this.clip("dizzy", 0.55, 0.15, { mask: "upper", t: 0.3, restart: true }); if (L) L.autoOff = r.dur * 0.8; }
  };

  /* Pose the skinned skeleton from the driver (plus clip layers). Called every rendered frame. */
  Avatar.prototype.sync = function () {
    var rig = this.rig; if (!rig) return;
    var W = this.W, Wp = this.Wp, Rq = this.restQ, Lp = this.restLocalP, par = this.parent, bi = this.bi, i, k;
    // driver segment world rotations
    var qP = rig.pelvis.getWorldQuaternion(_q1), qS = rig.spine.getWorldQuaternion(new Q()), qC = rig.chest.getWorldQuaternion(new Q());
    var qN = rig.neck.getWorldQuaternion(new Q()), qH = rig.head.getWorldQuaternion(new Q());
    W[bi.Hips].copy(qP).multiply(Rq[bi.Hips]);
    W[bi.Spine].copy(qS).multiply(Rq[bi.Spine]);
    W[bi.Spine1].copy(qS).multiply(Rq[bi.Spine1]);
    W[bi.Spine2].copy(qC).multiply(Rq[bi.Spine2]);
    W[bi.Neck].copy(qN).multiply(Rq[bi.Neck]);
    W[bi.Head].copy(qH).multiply(Rq[bi.Head]);
    W[bi.LeftShoulder].copy(qC).multiply(Rq[bi.LeftShoulder]);
    W[bi.RightShoulder].copy(qC).multiply(Rq[bi.RightShoulder]);
    rig.pelvis.getWorldPosition(Wp[bi.Hips]);
    // idle breathing layer (additive, torso only)
    var C = this.base.clips, yaw = this.actor ? this.actor.yaw : 0, qy = _q3.setFromAxisAngle(YAX, yaw), qyi = new Q().copy(qy).invert();
    if (C && this.idleW > 0.01) {
      var ic = C.clips.idle, t = this.idleT % ic.dur;
      for (var nm in IDLE_MASK) {
        var j = C.bones.indexOf(nm); if (j < 0) continue;
        this.clipQuat(ic, t, j, _q2); _q4.copy(this.clipQuat(ic, 0, j, new Q())).invert(); _q2.multiply(_q4);
        _q2.premultiply(qy).multiply(qyi);
        new Q().slerp(_q2, this.idleW * IDLE_MASK[nm]);
        var dq = new Q().slerp(_q2, this.idleW * IDLE_MASK[nm]);
        W[bi[nm]].premultiply(dq);
      }
    }
    // full-body and upper-body clip layers for the torso
    var self = this, layers = this.layers, clipW = 0, hasFull = false;
    function layerTorso(L, w) {
      var c = L.clip, cy = Math.cos(L.anchor.yaw), sy = Math.sin(L.anchor.yaw), qa = new Q().setFromAxisAngle(YAX, L.anchor.yaw);
      for (var jj = 0; jj < C.bones.length; jj++) {
        var nm2 = C.bones[jj], kk = bi[nm2];
        if (L.mask === "upper" && !UPPER_MASK[nm2]) continue;
        if (LIMB_BONE[nm2]) continue;
        self.clipQuat(c, L.t, jj, _q2).premultiply(qa).multiply(self.clipRef[jj]);
        W[kk].slerp(_q2, w);
      }
      if (L.mask === "full") {
        var d = self.clipPelvis(c, L.t, _v1), h = self.hipsY;
        _v2.set(L.anchor.x + (d.x * cy + d.z * sy) * h, h * (1 + d.y), L.anchor.z + (-d.x * sy + d.z * cy) * h);
        Wp[bi.Hips].lerp(_v2, w);
      }
    }
    if (C) layers.forEach(function (L) {
      if (L.prev && L.prev.w > 0) layerTorso({ clip: L.prev.clip, t: L.prev.t, anchor: L.prev.anchor, mask: L.mask }, clamp01(L.prev.w));
      if (L.w > 0) { layerTorso(L, clamp01(L.w)); if (L.mask === "full") { hasFull = true; clipW = Math.max(clipW, L.w); } }
    });
    this.clipW = clipW;
    // forward kinematics for the torso, then limbs
    this.fk(bi.Spine); this.fk(bi.Spine1); this.fk(bi.Spine2); this.fk(bi.Neck); this.fk(bi.Head); this.fk(bi.LeftShoulder); this.fk(bi.RightShoulder);
    this.fk(bi.LeftUpLeg); this.fk(bi.RightUpLeg);
    // shoulder shrug when the upper arm is raised
    for (i = 0; i < 2; i++) {
      var Ls = this.limbs[i], ks = i === 0 ? bi.LeftShoulder : bi.RightShoulder;
      var hand = rig.handPos(i === 0, _v3), sp = Wp[Ls.iu];
      var up = clamp((hand.y - sp.y) / (Ls.l1 + Ls.l2), -1, 1);
      if (up > 0.15) {
        var ax = _v4.copy(Wp[Ls.iu]).sub(Wp[ks]).normalize().applyQuaternion(_q2.identity()), fwd = _v6.set(Math.sin(yaw), 0, Math.cos(yaw));
        var axis = new V3().crossVectors(ax, YAX).normalize();
        W[ks].premultiply(new Q().setFromAxisAngle(axis, -(up - 0.15) * 0.35));
        this.fk(Ls.iu);
      }
    }
    var drv = this.rig, el = _v5;
    for (i = 0; i < 4; i++) {
      var L = this.limbs[i], s = Wp[L.iu], tgt, pole;
      if (L.L.arm) {
        var A = i === 0 ? drv.armL : drv.armR;
        tgt = drv.handPos(i === 0, new V3());
        el = A.el.getWorldPosition(new V3());
      } else {
        var G = i === 2 ? drv.legL : drv.legR;
        tgt = G.foot.getWorldPosition(new V3());
        el = G.knee.getWorldPosition(new V3());
      }
      this.solveLimb(L, s, tgt, el);
    }
    // clip layers on the limbs (after IK so they can override it)
    if (C) layers.forEach(function (L) {
      function limbsFrom(LL, w) {
        var qa = new Q().setFromAxisAngle(YAX, LL.anchor.yaw);
        for (var jj = 0; jj < C.bones.length; jj++) {
          var nm2 = C.bones[jj]; if (!LIMB_BONE[nm2]) continue;
          if (LL.mask === "upper" && !UPPER_MASK[nm2]) continue;
          self.clipQuat(LL.clip, LL.t, jj, _q2).premultiply(qa).multiply(self.clipRef[jj]);
          W[bi[nm2]].slerp(_q2, w);
        }
      }
      if (L.prev && L.prev.w > 0) limbsFrom({ clip: L.prev.clip, t: L.prev.t, anchor: L.prev.anchor, mask: L.mask }, clamp01(L.prev.w));
      if (L.w > 0) limbsFrom(L, clamp01(L.w));
    });
    // fingers
    this.fingers();
    // write local rotations
    var bones = this.bones;
    bones[0].position.copy(Wp[0]); bones[0].quaternion.copy(W[0]);
    for (i = 1; i < bones.length; i++) {
      var p = par[i];
      if (this.fingerSet[i]) continue;
      bones[i].quaternion.copy(W[p]).invert().multiply(W[i]);
    }
    // floor clamp while a clip moves the body (feet, hands, head and hips stay above the canvas)
    if (hasFull) {
      this.fkAll();
      var low = 1e9, lift = 0, chk = [bi.Head, bi.LeftHand, bi.RightHand, bi.LeftFoot, bi.RightFoot, bi.LeftToeBase, bi.RightToeBase, bi.Hips, bi.LeftLeg, bi.RightLeg, bi.Spine2];
      var rad = [0.1, 0.035, 0.035, this.dims.ankle, this.dims.ankle, 0.025, 0.025, 0.09, 0.06, 0.06, 0.1];
      for (k = 0; k < chk.length; k++) lift = Math.max(lift, rad[k] * 0.8 - Wp[chk[k]].y);
      if (lift > 0) bones[0].position.y += lift * clamp01(clipW);
    }
    this.group.updateMatrixWorld(true);
  };
  var LIMB_BONE = { LeftArm: 1, LeftForeArm: 1, LeftHand: 1, RightArm: 1, RightForeArm: 1, RightHand: 1, LeftUpLeg: 1, LeftLeg: 1, LeftFoot: 1, LeftToeBase: 1, RightUpLeg: 1, RightLeg: 1, RightFoot: 1, RightToeBase: 1 };

  Avatar.prototype.fk = function (k) {
    var p = this.parent[k];
    this.Wp[k].copy(this.restLocalP[k]).applyQuaternion(this.W[p]).add(this.Wp[p]);
  };
  Avatar.prototype.fkAll = function () {
    for (var k = 1; k < this.bones.length; k++) this.fk(k);
  };

  Avatar.prototype.solveLimb = function (L, s, target, elbowHint) {
    var W = this.W, l1 = L.l1, l2 = L.L.arm ? L.l2 + L.fist : L.l2;
    var d = _v1.copy(target).sub(s), dist = d.length();
    if (dist < 1e-5) { d.set(0, -1, 0); dist = 1; } else d.multiplyScalar(1 / dist);
    var D = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.9995);
    var cosA = clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    var pole = _v2.copy(elbowHint).sub(s); pole.addScaledVector(d, -pole.dot(d));
    if (pole.lengthSq() < 1e-8) pole.copy(L.restPole).addScaledVector(d, -L.restPole.dot(d));
    pole.normalize();
    var e = _v3.copy(s).addScaledVector(d, l1 * cosA).addScaledVector(pole, l1 * sinA);
    var t = _v4.copy(s).addScaledVector(d, D);
    var up = _v5.copy(e).sub(s), lo = _v6.copy(t).sub(e);
    basisQuat(W[L.iu], up, pole).multiply(L.Cu);
    var qlo = basisQuat(new Q(), lo, pole);
    if (L.L.arm) {
      // pronation: palm turns down as the arm extends; split between forearm and hand
      var ext = clamp01((D / (l1 + l2) - 0.55) / 0.4), side = L.L.left ? 1 : -1;
      var tw = (0.35 + 0.9 * ext) * side * (this.cfg.ref ? 0.2 : 1);
      W[L.il].copy(qlo).multiply(_q2.setFromAxisAngle(YAX, tw * 0.5)).multiply(L.Cl);
      W[L.ie].copy(qlo).multiply(_q2.setFromAxisAngle(YAX, tw)).multiply(L.Ch);
      this.fk(L.il); this.fk(L.ie);
    } else {
      W[L.il].copy(qlo).multiply(L.Cl);
      this.fk(L.il);
      // foot: the driver's foot orientation applied to the rest foot
      var G = L.L.left ? this.rig.legL : this.rig.legR;
      G.foot.getWorldQuaternion(_q2);
      W[L.ie].copy(_q2).multiply(this.restQ[L.ie]);
      this.fk(L.ie);
      var toe = this.bi[L.L.left ? "LeftToeBase" : "RightToeBase"];
      W[toe].copy(W[L.ie]).multiply(_q2.copy(this.restQ[L.ie]).invert().multiply(this.restQ[toe]));
      this.fk(toe);
    }
  };

  Avatar.prototype.fingers = function () {
    var self = this, W = this.W, bones = this.bones, amt = this.fistAmt;
    if (!this.fingerSet) {
      this.fingerSet = {};
      for (var nm in this.curl) this.fingerSet[this.curl[nm].k] = 1;
      this.fingerSet[this.bi.LeftToeBase] = 0; this.fingerSet[this.bi.RightToeBase] = 0;
    }
    for (var n2 in this.curl) {
      var c = this.curl[n2];
      bones[c.k].quaternion.copy(this.restLocalQ[c.k]).multiply(_q1.setFromAxisAngle(c.axis, c.ang * amt));
    }
  };

  /* Replay snapshots: clip layer state appended to the driver's node block (see the Rig patch below). */
  Avatar.prototype.snapshot = function (buf, o) {
    var Ls = this.layers;
    buf[o] = this.idleT; buf[o + 1] = this.idleW;
    for (var i = 0; i < 2; i++) {
      var L = Ls[i], b = o + 2 + i * 6;
      if (L && L.clip) { buf[b] = L.clip.id + 1; buf[b + 1] = L.t; buf[b + 2] = L.w; buf[b + 3] = L.anchor.x; buf[b + 4] = L.anchor.z; buf[b + 5] = L.anchor.yaw + (L.mask === "upper" ? 1000 : 0); }
      else { buf[b] = 0; buf[b + 1] = buf[b + 2] = buf[b + 3] = buf[b + 4] = buf[b + 5] = 0; }
    }
  };
  Avatar.prototype.restore = function (A, oa, B, ob, f) {
    var C = this.base.clips; if (!C) return;
    var src = f < 0.5 ? A : B, o = f < 0.5 ? oa : ob;
    this.idleT = lerp(A[oa], B[ob], f); if (Math.abs(B[ob] - A[oa]) > 0.5) this.idleT = src[o];
    this.idleW = lerp(A[oa + 1], B[ob + 1], f);
    var layers = [];
    for (var i = 0; i < 2; i++) {
      var b = o + 2 + i * 6, id = src[b];
      if (!id) continue;
      var c = C.clips[C.list[id - 1]], ya = src[b + 5], upper = ya > 500;
      var ba = oa + 2 + i * 6, bb = ob + 2 + i * 6, t = src[b + 1], w = src[b + 2];
      if (A[ba] === B[bb]) { t = lerp(A[ba + 1], B[bb + 1], f); w = lerp(A[ba + 2], B[bb + 2], f); }
      layers.push({ clip: c, t: t, w: w, target: w, rate: 1, mask: upper ? "upper" : "full", anchor: { x: src[b + 3], z: src[b + 4], yaw: upper ? ya - 1000 : ya }, speed: 0 });
    }
    this.layers = layers;
  };

  Avatar.prototype.dispose = function () {
    this.unbind();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.disposables.forEach(function (d) { if (d && d.dispose) d.dispose(); });
    this.disposables = []; this.meshes = [];
    if (this.skeleton && this.skeleton.dispose) this.skeleton.dispose();
  };

  /* Patch the primitive Rig's replay snapshot so clip state rides along (extra floats per rig). */
  var EXTRA = 16;
  if (root.FightRig && root.FightRig.Rig && !root.FightRig.Rig._avPatched) {
    var R = root.FightRig.Rig, base0 = R.STRIDE;
    R._avPatched = true; R.STRIDE = base0 + EXTRA;
    var snap = R.prototype.snapshot, rest = R.prototype.restore;
    R.prototype.snapshot = function (buf, off) {
      snap.call(this, buf, off);
      if (this.avatar) this.avatar.snapshot(buf, off + base0); else for (var i = 0; i < EXTRA; i++) buf[off + base0 + i] = 0;
    };
    R.prototype.restore = function (A, oa, B, ob, f) {
      rest.call(this, A, oa, B, ob, f);
      if (this.avatar) this.avatar.restore(A, oa + base0, B, ob + base0, f);
    };
  }

  /* ------------------------------------------------------------ public API */
  function build(appearance, opts) {
    return loadBase().then(function (base) { return new Avatar(base, appearance || {}, opts).ready; });
  }
  /* Build for an Actor and swap in when ready. Returns a promise of the avatar (or null on failure). */
  function attach(actor, appearance, scene, opts) {
    if (!supported()) return Promise.resolve(null);
    var token = {}; actor._avToken = token;
    return build(appearance, opts).then(function (av) {
      if (actor._avToken !== token) { av.dispose(); return null; }
      if (actor.avatar) actor.avatar.dispose();
      scene.add(av.group);
      av.bindDriver(actor);
      av.setRound(0);
      return av;
    }).catch(function (e) { if (root.console) console.warn("FightAvatar: falling back to the primitive rig", e); return null; });
  }
  function detach(actor) { actor._avToken = null; if (actor.avatar) actor.avatar.dispose(); }

  var REFEREE = { role: "referee", height_in: 71, age: 48, build: "average", skin: "light", hair: "short grey", facial_hair: "clean-shaven", shirt: "#121316", pants: "#2b2e34", gloves: "#15161a" };

  root.FightAvatar = {
    supported: supported, loadBase: loadBase, build: build, attach: attach, detach: detach,
    appearanceFor: appearanceFor, configFor: configFor, dbFromPage: dbFromPage, REFEREE: REFEREE, Avatar: Avatar,
    webgl2: function (renderer) { return !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2); }
  };
})(typeof window !== "undefined" ? window : globalThis);
