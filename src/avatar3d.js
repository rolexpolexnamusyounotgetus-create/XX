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
   anything missing (WebGL2, DecompressionStream, assets) leaves the primitive rig in place.

   Pass 2 (Nov 6, 2026): extra MPFB2 / community targets (ears incl. cauliflower and flap, jaw, nose,
   lips, eyelids, head shapes, asymmetry, muscle groups) from mh-shapes-x; likeness sheets' morphs plus
   their morphs_unavailable / morphs_not_in_embed / morphs_if_available values; ethnicity shape bases only
   from a fitted "ethnicity_fit" block; strand-shell hair and beards over painted coverage maps; athletic
   normal map, tiled pores and a roughness map on island-evened skins; MMA glove and board-shorts
   proxies; Mixamo fight clips for strikes (timed to the driver's contact and pulled onto the target),
   reactions, knockdowns, get-ups, the takedown entry and the referee; southpaw mirroring.
   Credits: board shorts mesh "elvs_male_swim_shorts1" by Elvaerwyn, CC BY 2.5 SE (makehumancommunity.org);
   MMA glove proxy by "learning" and Mindfront skin/normal maps, CC0; motion clips from Adobe Mixamo. */
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
        t.anisotropy = 4; t.needsUpdate = true; t._shared = true;
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
  /* Mean linear luminance of the opaque texels (hair textures are tinted relative to it). */
  function meanLum(img) {
    try {
      var c = root.document.createElement("canvas"); c.width = c.height = 64;
      var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 64, 64);
      var d = x.getImageData(0, 0, 64, 64).data, sum = 0, n = 0;
      for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 128) {
        var r = Math.pow(d[i] / 255, 2.2), g = Math.pow(d[i + 1] / 255, 2.2), b = Math.pow(d[i + 2] / 255, 2.2);
        sum += 0.299 * r + 0.587 * g + 0.114 * b; n++;
      }
      return n ? Math.max(0.02, sum / n) : 0.2;
    } catch (e) { return 0.2; }
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
    this.smoothShoulderWeights();
    this.proxyCache = {};
    this.clips = clips;
    this.mocap = null;
  }
  /* The game rig's weights pinch the front of the shoulder when the arm comes forward into a guard (a
     folded notch by the collarbone). Diffuse the clavicle / upper-arm / upper-chest weights over the
     mesh a few times (per MakeHuman vertex, so UV seams stay closed), keep the top four, renormalise. */
  Base.prototype.smoothShoulderWeights = function () {
    var bi = this.boneIndex, J = this.joints, Wt = this.weights, mh = this.mh, idx = this.index, n = mh.length, N = this.N, i, k;
    var zone = {}; ["LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "Spine2", "Neck"].forEach(function (b) { if (bi[b] != null) zone[bi[b]] = 1; });
    var nb = 52, Wm = new Float32Array(N * nb), cnt = new Uint8Array(N), inZone = new Uint8Array(N);
    for (i = 0; i < n; i++) {
      var m = mh[i]; if (cnt[m]) continue; cnt[m] = 1;
      var z = 0; for (k = 0; k < 4; k++) { var j = J[i * 4 + k], w = Wt[i * 4 + k]; if (w > 0 && j < nb) { Wm[m * nb + j] += w; if (zone[j] && w > 0.08) z++; } }
      var hasSh = (bi.LeftShoulder != null && Wm[m * nb + bi.LeftShoulder] > 0.04) || (bi.RightShoulder != null && Wm[m * nb + bi.RightShoulder] > 0.04);
      inZone[m] = z >= 2 && hasSh ? 1 : 0;
    }
    // MakeHuman-vertex adjacency from the render triangles
    var adj = []; for (i = 0; i < N; i++) adj.push(null);
    function link(a, b) { if (!inZone[a]) return; (adj[a] || (adj[a] = [])).push(b); }
    for (i = 0; i < idx.length; i += 3) { var a = mh[idx[i]], b = mh[idx[i + 1]], c = mh[idx[i + 2]]; link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b); }
    var tmp = new Float32Array(N * nb);
    for (var it = 0; it < 4; it++) {
      tmp.set(Wm);
      for (i = 0; i < N; i++) {
        if (!inZone[i] || !adj[i]) continue;
        var L = adj[i], o = i * nb;
        for (k = 0; k < nb; k++) { var sum = 0; for (var q = 0; q < L.length; q++) sum += Wm[L[q] * nb + k]; tmp[o + k] = Wm[o + k] * 0.4 + 0.6 * sum / L.length; }
      }
      Wm.set(tmp);
    }
    for (i = 0; i < n; i++) {
      var mm = mh[i]; if (!inZone[mm]) continue;
      var o2 = mm * nb, best = [];
      for (k = 0; k < nb; k++) if (Wm[o2 + k] > 1e-4) best.push([Wm[o2 + k], k]);
      best.sort(function (x, y) { return y[0] - x[0]; }); best = best.slice(0, 4);
      var tot = 0; best.forEach(function (bb) { tot += bb[0]; });
      for (k = 0; k < 4; k++) { J[i * 4 + k] = best[k] ? best[k][1] : 0; Wt[i * 4 + k] = best[k] ? best[k][0] / tot : 0; }
    }
  };
  /* Extra targets (assets/embed/mh-shapes-x.bin.gz): same packed coding, own header. */
  Base.prototype.addShapes = function (bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), hl = dv.getUint32(0, true);
    var hdr = JSON.parse(utf8(bytes.subarray(4, 4 + hl))), data = bytes.subarray(4 + hl), morphs = this.morphs;
    hdr.morphs.forEach(function (m) {
      var idx = unplane16(data, m.offset, m.count, false), d = new Int16Array(m.count * 3), at = m.offset + m.count * 2;
      for (var kk = 0; kk < 3; kk++) {
        var v = m.bits === 8 ? unplane8(data, at, m.count) : unplane16(data, at, m.count, true);
        at += m.count * (m.bits === 8 ? 1 : 2);
        for (var j = 0; j < m.count; j++) d[j * 3 + kk] = v[j];
      }
      if (!morphs[m.name]) morphs[m.name] = { idx: idx, d: d, scale: m.scale };
    });
    this.extraShapes = hdr.morphs.length;
  };
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
    // ethnicity shape bases stay at MakeHuman's neutral thirds unless the likeness sheet carries an
    // "ethnicity_fit" block: weights fitted by eye to that person's reference photos (recorded with the
    // photos used), never assigned from name, nationality or assumption
    var E = c.ethnic, ea = 1 / 3, eb = 1 / 3, ec = 1 / 3;
    if (E && E.african + E.asian + E.caucasian > 0.01) { var es = E.african + E.asian + E.caucasian; ea = E.african / es; eb = E.asian / es; ec = E.caucasian / es; }
    [["african", ea], ["asian", eb], ["caucasian", ec]].forEach(function (r) { w["macro/" + r[0] + "F"] = r[1] * (1 - g); w["macro/" + r[0] + "M"] = r[1] * g; });
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
    var tg = c.targets || {};
    for (k in tg) add(k, tg[k]);
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
        return { meta: meta, prim: prim, tex: r[1], lum: r[1] && meta.kind === "hair" ? meanLum(r[1].image) : 0.2, refs: toU16(prim.attributes._REFS), refw: toFloat(prim.attributes._REFW), offs: toFloat(prim.attributes._OFFS),
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

  /* Clip sets. v1 (mh-clips.bin.gz, Mesh2Motion): frame-major int16. v2 (mh-mocap.bin.gz, Mixamo):
     per clip channel-major, delta-coded int16 in low/high byte planes, own fps, plus contact metadata. */
  function parseClips(bytes, setId, idBase) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var hl = dv.getUint32(0, true), header = JSON.parse(utf8(bytes.subarray(4, 4 + hl))), data0 = 4 + hl;
    var nb = header.bones.length, per = 3 + nb * 4, v2 = /mocap\/2/.test(header.format || "");
    var out = { fps: header.fps, bones: header.bones, src: header.src, clips: {}, list: [], set: setId || 0 };
    for (var name in header.clips) {
      var c = header.clips[name], n = c.frames, fps = c.fps || header.fps, raw;
      if (v2) {
        raw = new Int16Array(n * per);
        var b = bytes.subarray(data0 + c.off, data0 + c.off + n * per * 2);
        for (var ch = 0; ch < per; ch++) {
          var o = ch * n * 2, acc = 0;
          for (var f = 0; f < n; f++) { acc = (acc + (b[o + f] | (b[o + n + f] << 8))) & 0xffff; raw[f * per + ch] = acc > 32767 ? acc - 65536 : acc; }
        }
      } else raw = new Int16Array(bytes.buffer.slice(bytes.byteOffset + data0 + c.off, bytes.byteOffset + data0 + c.off + n * per * 2));
      out.clips[name] = { name: name, frames: n, fps: fps, dur: (n - 1) / fps, loop: c.loop, data: raw, per: per, id: (idBase || 0) + out.list.length, set: out.set,
        eff: c.eff || null, hit: c.hit != null ? c.hit : null, go: c.go != null ? c.go : null, back: c.back != null ? c.back : null, bones: header.bones };
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
    function opt(name, fn) { return assetUrl(name) ? fn(name).catch(function (e) { if (root.console) console.warn("FightAvatar: optional " + name, e); return null; }) : Promise.resolve(null); }
    basePromise = fetchBytes("mh-manifest.json").then(function (mb) {
      var man = JSON.parse(utf8(mb));
      return Promise.all([loadBin(man.shapes.file), loadBin(man.body.file), opt("mh-clips.bin.gz", loadBin), opt("mh-shapes-x.bin.gz", loadBin),
        opt("mh-proxies-x.json", fetchBytes), opt("mh-mocap.bin.gz", loadBin)])
        .then(function (r) {
          if (r[4]) { try { var px = JSON.parse(utf8(r[4])); man.proxies = man.proxies.concat(px.proxies || []); } catch (e) { if (root.console) console.warn(e); } }
          var old = r[2] ? parseClips(r[2], 0, 0) : null;
          var b = new Base(man, r[0], readGlb(r[1]), old);
          if (r[3]) b.addShapes(r[3]);
          if (r[5]) b.mocap = parseClips(r[5], 1, old ? old.list.length : 0);
          b.clipSets = [old, b.mocap];
          b.clipList = [];
          b.clipSets.forEach(function (S) { if (S) S.list.forEach(function (n) { b.clipList.push(S.clips[n]); }); });
          return b;
        });
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
    if (/^#[0-9a-f]{6}$/.test(t)) return t;
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
    var st = src.style && src.style[slug];
    var a = {};
    function take(o) { for (var k in o) if (o[k] != null && o[k] !== "" && (typeof o[k] !== "string" || known(o[k]))) a[k] = o[k]; }
    take(sc); take(ovApp);
    a.slug = slug; a.name = ov.name || prof.name || slug;
    if (!a.likeness && src.likeness && src.likeness[slug]) a.likeness = src.likeness[slug];
    a.height_in = ov.height_in || prof.height_in || a.height_in || 70;
    a.reach_in = ov.reach_in || prof.reach_in || a.reach_in || a.height_in;
    a.stance = ov.stance || prof.stance || "Orthodox";
    a.division = ov.division || prof.division || "Lightweight";
    a.dob = ov.dob || prof.dob || null;
    if (st && !a.style) a.style = st;
    return a;
  }
  function dbFromPage() {
    var out = { fighters: {}, overrides: {}, scouting: {}, likeness: {}, style: {}, referee: null };
    if (!root.document) return out;
    function j(id) { var el = root.document.getElementById(id); if (!el) return null; try { return JSON.parse(el.textContent); } catch (e) { return null; } }
    var f = j("fighters-db"), o = j("overrides-db"), s = j("appearance-db"), sdb = j("scouting-db");
    if (f && f.fighters) out.fighters = f.fighters;
    if (o) { out.overrides = o.fighters || {}; if (o.manual) for (var k in o.manual) out.fighters[k] = out.fighters[k] || o.manual[k]; if (o.referee) out.referee = o.referee.appearance; }
    if (s) out.scouting = s.fighters || s;
    if (sdb) {
      var sc = sdb.scouting || {};
      for (var k2 in sc) { if (sc[k2] && sc[k2].appearance) out.scouting[k2] = sc[k2].appearance; if (sc[k2] && sc[k2].style) out.style[k2] = sc[k2].style; }
      out.likeness = sdb.likeness || {};
    }
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
    var listed = /(\d{3})\s*lb/.exec(lower(app.build));
    var lb = app.weight_lb || (div === "Heavyweight" ? (listed ? +listed[1] : 238 + (hIn - 75) * 6) : limit * (limit <= 170 ? 1.08 : 1.065));
    if (ref) lb = app.weight_lb || 190;
    var bmi = 703 * lb / (hIn * hIn);
    var muscleBias = 0;
    if (/muscular|jacked|thick|powerful|stocky|barrel|broad/.test(fig)) muscleBias += 0.06;
    if (/lean|lanky|long-limbed|rangy|slim|wiry|skinny/.test(fig)) muscleBias -= 0.06;
    var muscle = ref ? 0.55 : clamp(0.9 + muscleBias + (bmi - 24) * 0.012, 0.72, 1.0);
    if (female && !ref) muscle = clamp(muscle - 0.12, 0.6, 0.9);
    var weight = clamp(0.5 + (bmi - 23.5) * 0.06 - (muscle - 0.5) * 0.25, 0.25, 0.97);
    if (ref) weight = clamp(0.5 + (bmi - 24.5) * 0.05, 0.35, 0.8);
    var det = {};
    if (!ref) {
      var m = muscle - 0.7;
      det.neckWidth = clamp(0.45 + m * 1.2 + (bmi - 24) * 0.05, 0, 1);
      det.shoulders = clamp(0.25 + m * 0.8 + (/stocky|broad|thick/.test(fig) ? 0.15 : 0), -0.2, 0.8);
      det.vShape = clamp(0.35 + m * 0.9, 0, 0.8);
      det.chest = clamp(0.15 + m * 0.6 + (bmi - 25) * 0.03, -0.2, 0.55);
      det.upperLip = -0.3; det.lowerLip = -0.15;
      det.waist = clamp(-0.15 + (bmi - 26) * 0.07 - m * 0.4, -0.5, 0.6);
      det.belly = bmi > 29 ? clamp((bmi - 29) * 0.07, 0, 0.5) : -0.15;
      det.buttocks = -0.1;
      if (female) { det.neckWidth *= 0.5; det.shoulders *= 0.6; det.vShape *= 0.5; }
    } else { det.belly = clamp((bmi - 25) * 0.08, 0, 0.4); }
    var LK = app.likeness && typeof app.likeness === "object" ? app.likeness : null, targets = {}, mo = LK && LK.morphs;
    if (mo) {
      // likeness sheet (data/likeness): raw MakeHuman targets for face and build; macros only nudge the data-driven body
      var mu = mo["macro/muscleUpM"] != null ? 0.5 + 0.5 * mo["macro/muscleUpM"] : (mo["macro/muscleDownM"] != null ? 0.5 - 0.5 * mo["macro/muscleDownM"] : null);
      var we = mo["macro/weightUpM"] ? 0.5 + 0.5 * mo["macro/weightUpM"] : (mo["macro/weightDownM"] != null ? 0.5 - 0.5 * mo["macro/weightDownM"] : null);
      if (mu != null && !ref) muscle = clamp(0.55 * muscle + 0.45 * mu, 0.55, 1);
      if (we != null && !ref) weight = clamp(0.55 * weight + 0.45 * we, 0.2, 0.97);
      for (var tn in mo) {
        if (tn.indexOf("macro/") === 0 || !mo[tn]) continue;
        targets[tn] = mo[tn];
        for (var did in DETAIL) if (DETAIL[did].pos.indexOf(tn) >= 0 || DETAIL[did].neg.indexOf(tn) >= 0) delete det[did];
      }
    } else {
      var face = app.face || {};
      for (var k in face) if (DETAIL[k]) det[k] = face[k];
    }
    // targets the sheets list outside "morphs" (ear, lip and other targets missing from the first embed; now in mh-shapes-x)
    if (LK) ["morphs_unavailable", "morphs_not_in_embed", "morphs_if_available", "morphs_extra"].forEach(function (key) {
      var blk = LK[key]; if (!blk || typeof blk !== "object") return;
      for (var tn2 in blk) {
        var v2 = blk[tn2]; if (typeof v2 !== "number" || tn2.indexOf("/") < 0 || tn2.indexOf("macro/") === 0) continue;
        var nm2 = TARGET_ALIAS[tn2] || tn2; if (targets[nm2] == null) targets[nm2] = v2;
      }
    });
    if (!ref) athleteTargets(targets, app, LK, muscle, bmi, female, div);
    var ethnic = null, EF = LK && LK.ethnicity_fit;
    if (EF && typeof EF === "object" && Array.isArray(EF.photos) && EF.photos.length) ethnic = { african: +EF.african || 0, asian: +EF.asian || 0, caucasian: +EF.caucasian || 0 };
    var propFromSheet = mo && mo["macro/proportionsUpM"] != null ? 0.5 + 0.5 * mo["macro/proportionsUpM"] : null;
    // reach -> arm stretch, computed after the bake (needs the measured span)
    return {
      gender: female ? 0 : 1, years: years, muscle: muscle, weight: weight, heightRaw: 0.5, proportions: ref ? 0.5 : (propFromSheet != null ? Math.max(propFromSheet, 0.6) : 0.75), targets: targets,
      cupSize: female ? 0.4 : 0.5, firmness: 0.6, detail: det, H: H, reach: (+app.reach_in || hIn) * 0.0254, bmi: bmi, female: female, ref: ref, ethnic: ethnic,
      lean: ref ? 0 : clamp01(0.55 + (muscle - 0.85) * 2 - Math.max(0, bmi - 27) * 0.08 + (/lean|shredded|six-pack|visible abs|defined/.test(lower(LK && LK.body && (LK.body.body_fat + " " + (LK.body.body_fat_note || LK.body.body_fat_notes || "")))) ? 0.25 : 0))
    };
  }
  var TARGET_ALIAS = { "ears/l-ear-big-incr": "ears/l-ear-scale-incr", "ears/r-ear-big-incr": "ears/r-ear-scale-incr" };
  function addT(t, name, v) { if (Math.abs(v) > 1e-3) t[name] = (t[name] || 0) + v; }
  function lrT(t, base, v) { addT(t, base.replace("/", "/l-"), v); addT(t, base.replace("/", "/r-"), v); }
  /* Athletic definition: muscle targets driven by build and division, leaner limbs, a lip correction
     (the MakeHuman base reads full-lipped on these faces), cues from the sheet's body notes. */
  function athleteTargets(t, app, LK, muscle, bmi, female, div) {
    var B = LK && LK.body ? LK.body : {}, txt = lower([B.build, B.shoulders, B.chest, B.arms, B.legs_calves, B.neck, B.notable_physique_traits, B.waist, app.build].join(" "));
    var k = female ? 0.5 : 1, m = clamp01((muscle - 0.7) / 0.3);
    var heavy = /heavyweight/i.test(div) && !/light/i.test(div);
    addT(t, "torso/torso-muscle-pectoral-incr", k * (0.18 + 0.3 * m + (/flat pec|flat pector|not bulky/.test(txt) ? -0.12 : 0) + (/big chest|thick chest|well-developed pec|barrel/.test(txt) ? 0.12 : 0)));
    addT(t, "torso/torso-muscle-dorsi-incr", k * (0.25 + 0.3 * m + (/v-taper|v taper|wide back|lats/.test(txt) ? 0.15 : 0)));
    lrT(t, "arms/upperarm-shoulder-muscle-incr", k * (0.3 + 0.35 * m + (/round.{0,12}delt|broad shoulder|big shoulder|capped/.test(txt) ? 0.15 : 0)));
    lrT(t, "arms/upperarm-muscle-incr", k * (0.25 + 0.35 * m + (/big arms|thick arms|bicep/.test(txt) ? 0.1 : 0) - (/lanky|slim arms|thin arms/.test(txt) ? 0.15 : 0)));
    lrT(t, "arms/lowerarm-muscle-incr", k * (0.3 + 0.3 * m + (/forearm/.test(txt) ? 0.12 : 0)));
    lrT(t, "legs/upperleg-muscle-incr", k * (0.25 + 0.3 * m + (/quad|thick thigh|powerful legs|big legs|tree trunk/.test(txt) ? 0.18 : 0) - (/thin legs|skinny legs|long thin/.test(txt) ? 0.15 : 0)));
    lrT(t, "legs/lowerleg-muscle-incr", k * (0.2 + 0.3 * m + (/calves|calf/.test(txt) ? 0.15 : 0)));
    if (/calves|calf/.test(txt) && /well-developed|thick|big|noticeabl/.test(txt)) addT(t, "legs/measure-calf-circ-incr", 0.2);
    if (!heavy || bmi < 30) { lrT(t, "arms/upperarm-fat-decr", 0.35); lrT(t, "arms/lowerarm-fat-decr", 0.3); lrT(t, "legs/upperleg-fat-decr", 0.25); lrT(t, "legs/lowerleg-fat-decr", 0.3); }
    if (/thick neck|very thick neck|wide neck|traps/.test(txt)) { addT(t, "neck/measure-neck-circ-incr", 0.25); addT(t, "neck/neck-back-scale-depth-incr", 0.3); }
    if (!female) {
      addT(t, "mouth/mouth-upperlip-height-decr", 0.18); addT(t, "mouth/mouth-lowerlip-height-decr", 0.12);
      addT(t, "mouth/mouth-upperlip-volume-decr", 0.12); addT(t, "mouth/mouth-lowerlip-volume-decr", 0.1);
    }
  }

  function looksFor(app, cfg, base) {
    var ref = cfg.ref, hairT = lower(app.hair), fhT = lower(app.facial_hair);
    // v2 overrides stored colours here: hair "#rrggbb", beard true/false
    if (/^#[0-9a-f]{6}$/.test(hairT)) { app = Object.assign({}, app, { hair_color: app.hair_color || app.hair }); hairT = "short"; }
    if (!fhT && app.beard != null) fhT = app.beard === true ? "short beard" : (app.beard === false ? "clean-shaven" : lower(app.beard));
    var L = { hair: null, scalp: 0, hairColor: pickColor(app.hair_color || app.hair, "#2a1d14"), beard: 0.22, beardShell: 0, moustacheOnly: false, chinOnly: false };
    if (/bald|shaved|shaven head|clean-shaven head/.test(hairT)) { L.hair = null; L.scalp = 0.22; }
    else if (/buzz|very short|crew|induction|clipper/.test(hairT)) { L.hair = null; L.scalp = 0.9; }
    else if (/afro/.test(hairT)) L.hair = "hair-afro01";
    else if (/ponytail|top knot|topknot|tied|bun|braid/.test(hairT) || (/long/.test(hairT) && !/short/.test(hairT))) L.hair = "hair-ponytail01";
    else if (/mop|shaggy|medium|styled up|quiff|swept|side part|curly/.test(hairT)) L.hair = "hair-short01";
    else if (/receding|thinning|short on the sides|crop|high and tight|fade/.test(hairT)) L.hair = "hair-short04";
    else L.hair = cfg.female ? "hair-ponytail01" : "hair-short02";
    if (L.hair) L.scalp = 0.35;
    if (!known(fhT)) L.beard = cfg.female ? 0 : 0.28;
    else if (/clean|shaven|no beard|beardless/.test(fhT)) L.beard = 0.12;
    else if (/full|thick|long/.test(fhT) && /beard/.test(fhT)) { L.beard = 1; L.beardShell = 0.006; }
    else if (/beard/.test(fhT) && !/chin beard|goatee/.test(fhT)) { L.beard = /short|trim|stubble|light/.test(fhT) ? 0.8 : 0.92; L.beardShell = 0; }
    else if (/stubble|scruff|5 o/.test(fhT)) L.beard = 0.55;
    if (/moustache|mustache/.test(fhT) && (/chin|goatee/.test(fhT))) { L.beard = 0.85; L.moustacheOnly = true; L.chinOnly = true; }
    else if (/moustache|mustache/.test(fhT) && !/beard/.test(fhT)) { L.beard = 0.85; L.moustacheOnly = true; }
    else if (/goatee|chin beard/.test(fhT)) { L.beard = 0.85; L.chinOnly = true; }
    if (cfg.female) L.beard = 0;
    L.beardColor = pickColor(app.beard_color || app.facial_hair, L.hairColor);
    if (!app.beard_color && /ginger|red|auburn/.test(fhT)) L.beardColor = pickColor(fhT.replace(/reddish-brown|reddish brown/, "auburn"), L.beardColor);
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
    var LK = app.likeness && typeof app.likeness === "object" ? app.likeness : null;
    if (LK) applyLikeness(L, LK, app, cfg, base, ids);
    hairPlan(L, app, LK, cfg, base);
    return L;
  }

  /* Hair and facial hair as worn: painted scalp shadow for shaved heads, multi-layer strand shells for
     buzz cuts, crops and fades (length from the sheet), proxy meshes for longer hair; painted stubble as
     the undercoat under a strand shell for beards. Coverage maps: mh-mask-hair.png (buzz, skin fade,
     receding buzz, horseshoe) and mh-mask-beard.png (3-day, heavy stubble, goatee+moustache, shaved scalp). */
  function firstNum(v) {
    if (typeof v === "number") return v;
    var m = /(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/.exec(String(v || "")), m2 = /(\d+(?:\.\d+)?)/.exec(String(v || ""));
    return m ? (+m[1] + +m[2]) / 2 : (m2 ? +m2[1] : null);
  }
  function hairPlan(L, app, LK, cfg, base) {
    var H = (LK && LK.hair) || {}, FH = (LK && LK.facial_hair) || {};
    var txt = lower([H.style, H.hairline, app.hair].join(" ")), len = H.length_cm, top = null, sides = null;
    if (typeof len === "number") top = len; else if (len && typeof len === "object") { top = firstNum(len.top); sides = firstNum(len.sides); }
    L.hairMode = L.hair ? "mesh" : "paint"; L.scalpCh = -1; L.hairLen = 0; L.hairSides = sides;
    var reced = /reced|receding|m shape|m-shape|thinning|widow/.test(txt), horseshoe = /horseshoe|male-pattern|crown thinning|bald on top/.test(txt);
    // "slightly receded temple corners" on a dense hairline is a normal hairline, not the receding-buzz mask
    if (reced && /(slight|mild|minor|a little)\w*\s+(\w+\s+){0,2}(reced|recess)/.test(txt) && !/thinning|deeply|heavily|strongly|widow/.test(txt)) reced = false;
    var fade = /fade|taper|high and tight|clipped very short|skin fade/.test(txt);
    if (top === 0 || (top == null && /bald|clean-shaven head|shaved head|head shaved|shaven head/.test(txt))) {
      L.hair = null; L.hairMode = "paint"; L.scalpCh = horseshoe || reced ? 3 : 4; L.scalp = 0.2;
    } else if ((top != null && top <= 1.3) || (top == null && /buzz|induction|clipper|very short|crew cut/.test(txt))) {
      L.hair = null; L.hairMode = "shell"; L.hairLen = Math.max(0.25, top || 0.6); L.scalpCh = reced ? 2 : (horseshoe ? 3 : (fade ? 1 : 0)); L.scalp = 0.9;
    } else if (top != null && top <= 6.5 && /fade|taper|crop|crew|short|high and tight|buzz|textured|spiky|tapered|coil|curl/.test(txt) &&
        !(/\blong\b|ponytail|\bbun\b|braid|afro|\bmop\b|shoulder|mullet/.test(txt) || (/fringe/.test(txt) && !/no fringe/.test(txt)))) {
      // crops and fades: painted hair colour on the scalp under a strand shell; the hair lies down, so the shell
      // carries at most ~2.6 cm of volume however long the top is
      L.hair = null; L.hairMode = "shell"; L.hairLen = Math.min(top, 2.6); L.scalpCh = reced ? 2 : (fade ? 1 : 0); L.scalp = 0.95;
    } else if (L.hair) { L.scalpCh = reced ? 2 : 0; L.scalp = 0.55; }
    else if (!L.hair && L.scalp > 0.5) { L.hairMode = "shell"; L.hairLen = 0.5; L.scalpCh = 0; }
    else if (!L.hair) { L.scalpCh = 4; }
    // a longer top (3 cm and up) over clipped sides: a hair proxy mesh for the top, cut above the temples so
    // the faded sides stay painted under a short strand shell. render_hints.hair_proxy names the mesh
    // (e.g. "short02"), render_hints.hair_cut_cm moves the cut (cm above the temple line; "none" keeps the
    // whole mesh). Shaved, buzzed and cropped heads keep the painted scalp and strand shell alone.
    var RH = (LK && LK.render_hints) || {}, hp = RH.hair_proxy ? String(RH.hair_proxy).replace(/^hair-/, "") : null;
    function haveP(id) { return base.man.proxies.some(function (p) { return p.kind + "-" + p.id === id; }); }
    L.hairCut = null;
    if (hp && hp !== "none" && haveP("hair-" + hp)) {
      L.hair = "hair-" + hp;
      if (RH.hair_cut_cm !== "none") L.hairCut = typeof RH.hair_cut_cm === "number" ? RH.hair_cut_cm / 100 : ((sides != null && sides <= 1.5) || fade ? 0.03 : null);
    } else if (!hp && L.hairMode === "shell" && top != null && top >= 3 && (sides == null || sides <= 1.5) && haveP("hair-short02")) {
      // swept back or pushed up (no fringe) -> short04, curls -> short01, else the forward crop short02
      L.hair = /curl|coil|wav/.test(txt) ? "hair-short01" : (/slick|combed (straight )?back|swept back|pushed up|brushed up|no fringe|back and up|up and back/.test(txt) ? "hair-short04" : "hair-short02");
      if (!haveP(L.hair)) L.hair = "hair-short02";
      L.hairCut = 0.03;
    }
    if (L.hair && L.hairMode === "shell") L.hairLen = Math.min(L.hairLen, sides != null ? Math.max(0.3, sides) : 1.0);
    // a big rounded mass of curls reads as the afro proxy rather than a short crop
    if (!hp && L.hairMode !== "shell" && /afro|mass of (loose |tight )?curls|rounded mass|big curls/.test(txt) && (top == null || top >= 6) && haveP("hair-afro01")) L.hair = "hair-afro01";
    // facial hair: undercoat mask, strand length and density
    var ft = lower([FH.type, FH.shape, typeof FH.length_mm === "string" ? FH.length_mm : "", app.facial_hair].join(" "));
    var mm = firstNum(FH.length_mm);
    L.beardCh = 0; L.beardLen = 0;
    if (cfg.female || L.beard <= 0.15) { L.beardLen = 0; }
    else if (L.chinOnly || L.moustacheOnly || /goatee|chin beard|moustache only|mustache only/.test(lower(FH.type))) { L.beardCh = 2; L.beardLen = mm || 8; }
    else if (/full|long|thick/.test(lower(FH.type)) && /beard/.test(lower(FH.type))) { L.beardCh = 1; L.beardLen = mm || 22; }
    else if (/beard/.test(lower(FH.type)) || (/beard/.test(ft) && !/stubble/.test(lower(FH.type)))) { L.beardCh = 1; L.beardLen = mm || 9; }
    else if (/stubble|scruff/.test(ft) || L.beard >= 0.5) { L.beardCh = /heavy/.test(ft) ? 1 : 0; L.beardLen = mm || (/heavy/.test(ft) ? 3.5 : 1.5); }
    L.beardDensity = /patchy|sparse|thin|light/.test(lower(FH.density || "")) ? 0.75 : (/dense|thick/.test(lower(FH.density || "")) ? 1 : 0.9);
    // full beards: how long the cheeks run relative to the chin ("about 10 mm on the cheeks", 30 at the chin)
    var cheekMm = /(\d+(?:\.\d+)?)\s*mm on the cheek/.exec(lower(FH.length_mm || ""));
    L.beardCheekK = cheekMm && L.beardLen ? clamp(+cheekMm[1] / L.beardLen, 0.2, 1) : 0.5;
    L.moustacheDens = /moustache[^.;]{0,40}(sparse|sparser|thin|thinner|patchy)/.test(lower([FH.density, FH.shape].join(" "))) ? 0.55 : 1;
    // grey hairs: share of light strands from the sheet's colour notes (salt-and-pepper, a few grey hairs...)
    var gtx = lower([FH.colour, FH.colour_note, FH.notes].join(" "));
    L.beardGrey = /salt[- ]and[- ]pepper|mostly grey|heavily grey/.test(gtx) ? 0.3 : (/grey|gray|white hairs|silver/.test(gtx) ? 0.1 : 0);
  }

  /* Likeness sheet (data/likeness/<slug>.json) -> looks: colours sampled from photos, beard type, iris,
     brows, skin texture and tint, tattoo placement. Sheet text is data, read with simple keyword rules. */
  function applyLikeness(L, LK, app, cfg, base, ids) {
    var hx = /^#[0-9a-f]{6}$/i, H = LK.hair || {}, FH = LK.facial_hair || {}, SK = LK.skin || {}, RH = LK.render_hints || {};
    if (hx.test(H.colour_hex || "")) L.hairColor = H.colour_hex;
    if (H.length_cm === 0 && L.hair) { L.hair = null; L.scalp = 0.22; }
    var ft = lower(FH.type);
    if (ft) {
      L.chinOnly = false; L.moustacheOnly = false;
      if (/clean|none/.test(ft)) L.beard = cfg.female ? 0 : 0.12;
      else if (/stubble/.test(ft)) L.beard = 0.55;
      else if (/full|thick|long/.test(ft)) L.beard = 1;
      else if (/goatee|chin/.test(ft)) { L.beard = 0.85; L.chinOnly = true; L.moustacheOnly = /moustache|mustache/.test(ft); }
      else if (/moustache|mustache/.test(ft)) { L.beard = 0.85; L.moustacheOnly = true; }
      else if (/beard/.test(ft)) L.beard = 0.85;
    }
    if (hx.test(FH.colour_hex || "")) L.beardColor = FH.colour_hex;
    var iris = lower(RH.iris || (LK.face && LK.face.eyes && LK.face.eyes.colour));
    base.man.irises.forEach(function (n) { if (iris.indexOf(n) === 0 || iris === n) L.iris = n; });
    if (/eyebrow010/.test(RH.eyebrows || "")) L.brows = "eyebrows-eyebrow010"; else if (/eyebrow001/.test(RH.eyebrows || "")) L.brows = "eyebrows-eyebrow001";
    var skinPick = lower([RH.skin_base, SK.texture_pick].join(" "));
    base.man.skins.forEach(function (s) { if (skinPick.indexOf(s.id) >= 0 && (!cfg.female === !/female/.test(s.id))) L.skin = s; });
    var tone = SK.tone_hex_recommended || SK.tone_hex || SK.tone_hex_average_face;
    if (hx.test(tone || "") && L.skin && L.skin.swatch) {
      // multiply tint so the texture's average lands on the sampled tone (no brightening)
      // ratio in linear light; stored as an sRGB hex because the material converts tints to linear
      var t = new T.Color(tone).convertSRGBToLinear(), sw = new T.Color(L.skin.swatch).convertSRGBToLinear();
      var tc = new T.Color(Math.min(1, t.r / sw.r), Math.min(1, t.g / sw.g), Math.min(1, t.b / sw.b));
      tc.lerp(new T.Color(1, 1, 1), 0.15);            // photos carry arena and flash casts: go 85% of the way
      L.tint = "#" + tc.convertLinearToSRGB().getHexString();
    }
    if (!(app.tattoo_marks && app.tattoo_marks.length) && Array.isArray(LK.tattoos)) {
      var marks = [];
      LK.tattoos.forEach(function (tt) {
        var w = lower(tt.where), d = lower(tt.description);
        if (/^none|none clearly/.test(d) || /^none/.test(w)) return;
        var side = /right/.test(w) ? "right" : (/left/.test(w) ? "left" : null);
        if (side && /sleeve/.test(w + " " + d) && /arm/.test(w)) marks.push({ at: side + " arm", shape: "sleeve" });
        else if (side && /forearm/.test(w)) marks.push({ at: side + " forearm", shape: "sleeve" });
        else if (/upper back|across the back|back/.test(w)) { var m = /"([^"]{2,16})"|'([^']{2,16})'/.exec(tt.description || ""); if (m) marks.push({ at: "upper back", text: (m[1] || m[2]).toUpperCase() }); }
        else if (side && /shoulder/.test(w) && /cross/.test(d)) marks.push({ at: side + " shoulder", shape: "cross" });
      });
      if (marks.length) L.tattoos = marks.slice(0, 2);
    }
  }

  /* ------------------------------------------------------------ kit colours */
  function colorOf(v, d) { return new T.Color(v == null ? d : v).convertSRGBToLinear(); }
  function lin(v) { return new T.Color(v).convertSRGBToLinear(); }

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
    this.P = P; this.scale = sc;
    // 2. joints from helper vertices
    var man = base.man, J = {};
    function mean(idx, out) { out.set(0, 0, 0); for (var k = 0; k < idx.length; k++) { out.x += P[idx[k] * 3]; out.y += P[idx[k] * 3 + 1]; out.z += P[idx[k] * 3 + 2]; } return out.divideScalar(idx.length); }
    man.bones.forEach(function (b) { J[b.name.replace(PRE, "")] = { h: mean(b.head, new V3()), t: mean(b.tail, new V3()) }; });
    // 3. reach: stretch upper arm, forearm (and a little of the hand) to the real ape index
    var shW = J.LeftArm.h.distanceTo(J.RightArm.h);
    var tipL = this.fingertip(true, J), armLen = J.LeftArm.h.distanceTo(J.LeftForeArm.h) + J.LeftForeArm.h.distanceTo(J.LeftHand.h) + J.LeftHand.h.distanceTo(tipL);
    var span0 = shW + 2 * armLen, ua = J.LeftArm.h.distanceTo(J.LeftForeArm.h), fa = J.LeftForeArm.h.distanceTo(J.LeftHand.h);
    var need = (cfg.reach - span0) / 2;                       // extra length per arm
    var s = clamp(1 + need / (ua + fa + 0.35 * J.LeftHand.h.distanceTo(tipL)), 0.84, 1.2);
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
    this.group.updateMatrixWorld(true);
    this.skeleton = new T.Skeleton(bones);
    // 6. masks (facial hair, damage zones, kick zones, scalp) and decals per MakeHuman vertex
    var masks = this.computeMasks(P, J);
    // 7. materials and meshes
    function optTex(name, srgb) { return assetUrl(name) ? loadTexture(name, !!srgb).catch(function () { return null; }) : null; }
    var shortsId = cfg.ref || cfg.female || opts.proxyShorts === false ? null : (typeof opts.proxyShorts === "string" ? opts.proxyShorts : "clothes-elvs_male_swim_shorts1");
    if (shortsId && !base.man.proxies.some(function (p) { return p.kind + "-" + p.id === shortsId; })) shortsId = null;
    var gloveId = "clothes-learning_mma_fighting_gloves", wantGlove = !cfg.ref && opts.proxyGloves !== false && base.man.proxies.some(function (p) { return p.kind + "-" + p.id === gloveId; });
    return Promise.all([
      loadTexture(looks.skin.file, true),
      base.proxy("eyes-high-poly"), loadTexture("mh-iris-" + looks.iris + ".webp", true),
      base.proxy(looks.brows), base.proxy("eyelashes-eyelashes01"),
      looks.hair ? base.proxy(looks.hair) : null,
      optTex("mh-skin-athletic-n.jpg"), optTex("mh-skin-pores-n.jpg"), optTex("mh-skin-spec.jpg"), optTex("mh-mask-hair.png"), optTex("mh-mask-beard.png"), optTex("mh-mask-hair2.png"),
      wantGlove ? base.proxy(gloveId).catch(function () { return null; }) : null,
      shortsId ? base.proxy(shortsId).catch(function () { return null; }) : null
    ]).then(function (r) {
      self.shortsProxy = r[13];
      self.tex = { normal: r[6], pores: r[7], spec: r[8], maskHair: r[9], maskBeard: r[10], maskHair2: r[11] };
      self.gloveProxy = r[12];
      self.makeBody(r[0], masks);
      self.addProxy(r[1], { map: r[2], roughness: 0.12, eyes: true });
      self.addProxy(r[3], { color: mixHex(looks.beardColor === looks.hairColor ? looks.hairColor : mixHex(looks.hairColor, looks.beardColor, 0.4), "#a07a5c", 0.25), brows: true });
      self.addProxy(r[4], { lashes: true });
      if (r[5]) self.addProxy(r[5], { color: looks.hairColor, hair: true, cutY: looks.hairCut != null && self.maskL ? (self.maskL.sideburnR.y + self.maskL.sideburnL.y) / 2 + looks.hairCut : null });
      if (self.cfg.ref) self.makeRefKit(); else self.makeFightKit();
      if ((!self.cfg.ref || looks.hairMode === "shell") && !self.opts.noStrands) self.makeStrands();
      self.initRetarget();
      self.measure();
      self.group.traverse(function (o) { if (o.isMesh) { o.castShadow = !o.userData.noShadow; o.receiveShadow = !o.userData.noShadow; o.frustumCulled = false; } });
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
     side), w: kick zone on the legs (signed by side). Second vec4: scalp, chest, face, lips. */
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
        var tx = clamp01(ax / Math.max(0.03, earX)), tm = clamp01((mouthHalf + 0.004) / Math.max(0.03, earX)), lineY;
        if (tx < tm) lineY = lerp(noseB + 0.001, lipTopY + 0.012, smooth(0, 1, tx / tm));
        else lineY = lerp(lipTopY + 0.012, sbY - 0.016, Math.pow((tx - tm) / (1 - tm), 1.15));   // cheek line: mouth corner to mid-ear, under the cheekbone
        // soft cheek line (beards thin out over the upper cheek instead of ending in a hard edge)
        var top = 1 - smooth(lineY - 0.024, lineY + 0.004, p.y);
        var neck = smooth(neckLine - 0.02, neckLine + 0.004, p.y);
        // lips: a soft ellipse around the mouth, not a box
        var lr = Math.sqrt(Math.pow(ax / (mouthHalf + 0.003), 2) + Math.pow((p.y - (lipTopY + L.lipBot.y) / 2) / Math.max(0.006, (lipTopY - L.lipBot.y) / 2 + 0.002), 2));
        var lips = p.z > L.lipBot.z - 0.02 ? smooth(0.82, 1.12, lr) : 1;
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
        // lips (soft): between the lip lines, inside the mouth corners, on the front of the face
        var lipC = (L.lipTop.y + L.lipBot.y) / 2 - 0.001, lipH = Math.max(0.0085, (L.lipTop.y - L.lipBot.y) / 2 + 0.006);
        if (p.z > L.lipBot.z - 0.025 && ax < mouthHalf + 0.006) { var le = Math.sqrt(Math.pow(ax / (mouthHalf + 0.002), 2) + Math.pow((p.y - lipC) / (lipH * 1.05), 2)); m2[o1 + 3] = 1 - smooth(0.5, 1.0, le); }
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
    this.maskL = L; this.headC = headC;
    return { m1: m1, m2: m2, L: L, headC: headC };
  };

  /* Skin: physically based, wrap lighting for a subsurface feel, sweat as clearcoat, painted stubble,
     beard shading, cuts, swelling and leg-kick redness driven by uniforms. */
  Avatar.prototype.skinMaterial = function (map, opts) {
    var self = this, looks = this.looks;
    var mat = new T.MeshPhysicalMaterial({ map: map, roughness: 0.56, metalness: 0, clearcoat: 0.0, clearcoatRoughness: 0.32, skinning: true });
    mat.color.copy(lin(looks.tint));
    // fighters train under lights and outdoors: a mild tan and less milky environment reflection, so skin
    // keeps its colour under the arena's white key light instead of washing out pale pink (not the referee)
    if (!this.cfg.ref) { mat.color.multiply(new T.Color(0.96, 0.88, 0.82)); mat.envMapIntensity = 0.75; }
    var X = this.tex || {}, cfg = this.cfg;
    function chan(i) { return new T.Vector4(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0, i === 3 ? 1 : 0); }
    if (X.normal && !this.opts.noNormal) {
      // sculpted athletic relief (MakeHuman UV, glTF v convention so green is flipped); leaner fighters show more of it
      var ns = cfg.ref ? 0.35 : 0.45 + 0.75 * (cfg.lean || 0.5);
      mat.normalMap = X.normal; mat.normalScale = new T.Vector2(ns, -ns);
    }
    var maskOn = !!(X.maskHair && X.maskBeard && X.maskHair2);
    var U = this.uniforms = this.uniforms || {
      uBeard: { value: looks.beard }, uBeardOp: { value: looks.beardLen >= 12 ? 0.9 : (looks.beardLen >= 6 ? 0.8 : 0.7) * (looks.beardDensity < 0.85 ? 0.88 : 1) }, uBeardCol: { value: lin(looks.beardColor) }, uScalp: { value: looks.scalp }, uHairCol: { value: lin(looks.hairColor) },
      uDam: { value: new T.Vector2(0, 0) }, uLeg: { value: new T.Vector2(0, 0) }, uSweat: { value: 0 }, uFlush: { value: 0 },
      uTattoo: { value: this.tattooTex || null }, uTatOn: { value: this.tattooTex ? 1 : 0 },
      uMaskOn: { value: maskOn ? 1 : 0 }, uMaskH: { value: X.maskHair || null }, uMaskH2: { value: X.maskHair2 || null }, uMaskB: { value: X.maskBeard || null },
      uScalpCh: { value: looks.scalpCh >= 0 && looks.scalpCh < 3 ? chan(looks.scalpCh) : new T.Vector4(0, 0, 0, 0) }, uScalpCh2: { value: looks.scalpCh >= 3 ? chan(looks.scalpCh - 3) : new T.Vector4(0, 0, 0, 0) },
      uBeardCh: { value: (function () { var v = chan(looks.beardCh || 0); v.w = looks.beardCh === 2 ? 0 : (looks.moustache === false ? 0 : 1); return v; })() }, uPores: { value: X.pores || null }, uPoreAmt: { value: X.pores ? 0.55 : 0 }, uSpec: { value: X.spec || null }, uSpecOn: { value: X.spec ? 1 : 0 }
    };
    mat.onBeforeCompile = function (sh) {
      for (var k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aMask;\nattribute vec4 aMask2;\nattribute vec4 aDecal;\nvarying vec4 vMask;\nvarying vec4 vMask2;\nvarying vec4 vDecal;\nuniform vec2 uDam;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMask = aMask; vMask2 = aMask2; vDecal = aDecal;\nfloat swl = max(aMask.z, 0.0) * uDam.x + max(-aMask.z, 0.0) * uDam.y;\ntransformed += objectNormal * swl * 0.0055;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec4 vMask;\nvarying vec4 vMask2;\nvarying vec4 vDecal;\nuniform float uBeard; uniform float uBeardOp; uniform vec3 uBeardCol; uniform float uScalp; uniform vec3 uHairCol; uniform vec2 uDam; uniform vec2 uLeg; uniform float uSweat; uniform float uFlush;\nuniform sampler2D uTattoo; uniform float uTatOn;\n" +
          "uniform float uMaskOn; uniform sampler2D uMaskH; uniform sampler2D uMaskH2; uniform sampler2D uMaskB; uniform vec4 uScalpCh; uniform vec4 uScalpCh2; uniform vec4 uBeardCh;\nuniform sampler2D uPores; uniform float uPoreAmt; uniform sampler2D uSpec; uniform float uSpecOn;\nfloat gBeard; float gScalp;\n" +
          "float hh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n" +
          "float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1,0)), f.x), mix(hh(i + vec2(0,1)), hh(i + vec2(1,1)), f.x), f.y); }")
        .replace("#include <map_fragment>", "#include <map_fragment>\n" +
          "{ vec2 su = vUv;\n" +
          "  float hfw = length(fwidth(su * 1400.0)); float hatt = 1.0 - smoothstep(0.35, 1.2, hfw);\n" +
          "  float hair = mix(0.5, vn(su * 1400.0), hatt); float hair2 = vn(su * 330.0); float hair3 = vn(su * 90.0);\n" +
          "  float mB = vMask.x, mS = vMask2.x;\n" +
          "  if (uMaskOn > 0.5) {\n" +
          "    mB = vMask.x;\n" +
          "    vec2 hu = (su - vec2(0.6, 0.03)) / vec2(0.3, 0.84);\n" +
          "    float inH = step(0.0, hu.x) * step(hu.x, 1.0) * step(0.0, hu.y) * step(hu.y, 1.0);\n" +
          "    vec2 hc = clamp(hu, 0.0, 1.0); mS = (dot(texture2D(uMaskH, hc), uScalpCh) + dot(texture2D(uMaskH2, hc), uScalpCh2)) * inH;\n" +
          "  }\n" +
          "  float bd = smoothstep(0.04 + 0.22 * vn(su * 160.0), 0.85, mB) * clamp(uBeard, 0.0, 1.0); gBeard = bd;\n" +
          "  float bfw = length(fwidth(su * 1700.0)); float bk = 1.0 - smoothstep(0.45, 1.3, bfw);\n" +
          "  float bn1 = vn(su * 1700.0), bn2 = vn(su * 520.0), bn3 = vn(su * 90.0);\n" +
          "  float dens = clamp(bd * (0.85 + 0.3 * bn3), 0.0, 1.0);\n" +
          "  float hairs = mix(dens, smoothstep(1.0 - dens - 0.02, 1.0 - dens + 0.2, bn1 * 0.7 + bn2 * 0.3), bk);\n" +
          "  vec3 bcol = uBeardCol * (0.68 + 0.45 * bn2);\n" +
          "  diffuseColor.rgb *= 1.0 - 0.16 * smoothstep(0.0, 0.5, mB) * clamp(uBeard * 1.4, 0.0, 1.0);\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, bcol, clamp(hairs * (0.5 + 0.42 * bd), 0.0, uBeardOp));\n" +
          "  float sc = mS * uScalp; float sst = sc * (0.55 + 0.45 * smoothstep(0.2, 0.9, hair)); gScalp = sc;\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, uHairCol * 0.7, clamp(sst * 0.85, 0.0, 0.9));\n" +
          "  float sideL = step(0.0, vMask.y);\n" +
          "  float dam = mix(uDam.y, uDam.x, step(0.0, vMask.z));\n" +
          "  float swz = abs(vMask.z) * dam; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.62, 0.66), clamp(swz * 0.75, 0.0, 0.6));\n" +
          "  float cz = abs(vMask.y) * mix(uDam.y, uDam.x, sideL);\n" +
          "  float bl = smoothstep(0.62, 0.8, vn(su * 140.0) * 0.6 + vn(su * 37.0) * 0.4 + cz * 0.55);\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.02, 0.02), clamp(bl * smoothstep(0.15, 0.45, cz), 0.0, 0.92));\n" +
          "  float lz = abs(vMask.w) * mix(uLeg.y, uLeg.x, step(0.0, vMask.w));\n" +
          "  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.6, 0.58), clamp(lz * (0.75 + 0.25 * vn(su * 60.0)), 0.0, 0.7));\n" +
          "  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.06, 0.93, 0.92), uFlush * vMask2.z);\n" +
          "  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.74, 0.72), clamp(vMask2.w, 0.0, 1.0) * 0.6);\n" +
          "  if (uTatOn > 0.5) {\n" +
          "    vec2 d1 = vDecal.xy, d2 = vDecal.zw; float ink = 0.0;\n" +
          "    if (d1.x > 0.0 && d1.x < 1.0 && d1.y > 0.0 && d1.y < 1.0) ink = max(ink, texture2D(uTattoo, vec2(d1.x * 0.5, d1.y)).r);\n" +
          "    if (d2.x > 0.0 && d2.x < 1.0 && d2.y > 0.0 && d2.y < 1.0) ink = max(ink, texture2D(uTattoo, vec2(0.5 + d2.x * 0.5, d2.y)).r);\n" +
          "    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.16, 0.2, 0.25), clamp(ink, 0.0, 1.0) * 0.86);\n" +
          "  }\n" +
          "}")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nif (uSpecOn > 0.5) roughnessFactor = 0.64 - 0.3 * texture2D(uSpec, vUv).g;\nroughnessFactor = mix(roughnessFactor, 0.3, uSweat * (1.0 - gBeard)) + 0.3 * gBeard + 0.2 * gScalp;")
        .replace("#include <lights_physical_fragment>", "#include <lights_physical_fragment>\n#ifdef CLEARCOAT\nmaterial.clearcoat *= 1.0 - 0.92 * max(gBeard, gScalp * 0.6);\n#endif")
        .replace("#include <normal_fragment_maps>", "#ifdef USE_NORMALMAP\n" +
          "{ vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0; mapN.xy *= normalScale;\n" +
          "  float headIsl = smoothstep(0.615, 0.64, vUv.x) * smoothstep(0.02, 0.05, vUv.y) * (1.0 - smoothstep(0.88, 0.91, vUv.y)); mapN.xy *= 1.0 - 0.9 * headIsl;\n" +
          "  float pfw = length(fwidth(vUv * 46.0)); float patt = 1.0 - smoothstep(0.25, 0.9, pfw);\n" +
          "  vec3 pN = texture2D( uPores, vUv * 46.0 ).xyz * 2.0 - 1.0; mapN = normalize(vec3(mapN.xy + pN.xy * uPoreAmt * patt * vec2(1.0, -1.0) * (1.0 - 0.7 * gBeard), mapN.z));\n" +
          "  normal = perturbNormal2Arb( -vViewPosition, normal, mapN, faceDirection ); }\n" +
          "#endif\n" +
          "{ vec3 pp = -vViewPosition; float fw = length(fwidth(vUv * 520.0)); float att = 1.0 - smoothstep(0.12, 0.45, fw);\n" +
          "  float hgt = vn(vUv * 520.0);\n" +
          "  vec2 dH = vec2(dFdx(hgt), dFdy(hgt)) * (uPoreAmt > 0.0 ? 0.0005 : 0.0012) * att * (1.0 - 0.6 * gBeard);\n" +
          "  vec3 dpx = dFdx(pp), dpy = dFdy(pp); vec3 pr1 = cross(dpy, normal), pr2 = cross(normal, dpx); float det = dot(dpx, pr1);\n" +
          "  vec3 grad = sign(det) * (dH.x * pr1 + dH.y * pr2); normal = normalize(abs(det) * normal - grad); }")
        .replace("#include <lights_physical_pars_fragment>", T.ShaderChunk.lights_physical_pars_fragment
          .replace("vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = dotNL * directLight.color;\n\tfloat rawNL = dot( geometry.normal, directLight.direction );\n\tvec3 irradianceW = clamp( ( vec3( rawNL ) + vec3( 0.36, 0.16, 0.11 ) ) / vec3( 1.36, 1.16, 1.11 ), 0.0, 1.0 ) * directLight.color;\n\t#ifndef PHYSICALLY_CORRECT_LIGHTS\n\t\tirradianceW *= PI;\n\t#endif")
          .replace("reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );", "reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradianceW * BRDF_Diffuse_Lambert( material.diffuseColor );")
          .replace("reflectedLight.directDiffuse += irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );", "reflectedLight.directDiffuse += irradianceW * BRDF_Diffuse_Lambert( material.diffuseColor );"));
    };
    mat.customProgramCacheKey = function () { return "fight-skin-v3" + (mat.normalMap ? "n" : ""); };
    mat.extensions = { derivatives: true };
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
    var vb = this.vMaskBeard = new Float32Array(n); for (i = 0; i < n; i++) vb[i] = a1[i * 4];
    g.setAttribute("aMask2", new T.BufferAttribute(a2, 4));
    g.setAttribute("aDecal", new T.BufferAttribute(this.decals(), 4));
    g.setIndex(new T.BufferAttribute(base.index.slice(), 1));
    this.exprDelta = this.expressionDeltas();
    var self2 = this;
    g.morphAttributes.position = this.exprDelta.map(function (d) {
      var arr = new Float32Array(n * 3);
      for (var j = 0; j < n; j++) { var m = mh[j] * 3; arr[j * 3] = d[m]; arr[j * 3 + 1] = d[m + 1]; arr[j * 3 + 2] = d[m + 2]; }
      return new T.BufferAttribute(arr, 3);
    });
    g.morphTargetsRelative = true;
    this.bodyGeo = g;
    var mat = this.skinMat = this.skinMaterial(map);
    mat.morphTargets = true;
    var mesh = this.body = new T.SkinnedMesh(g, mat);
    mesh.name = "body";
    mesh.updateMorphTargets();
    this.morphMeshes = [mesh];
    this.group.add(mesh);
    mesh.bind(this.skeleton, new M4());
    this.meshes.push(mesh); this.disposables.push(g, mat);
  };

  /* Expression targets as full-shape deltas (MakeHuman/MPFB expression units, scaled to this body):
     0 blink (both eyes), 1 jaw open, 2 brows down. */
  var EXPR = [["expr/eye-left-closure", "expr/eye-right-closure"], ["expr/mouth-open"], ["expr/eyebrows-left-down", "expr/eyebrows-right-down"]];
  Avatar.prototype.expressionDeltas = function () {
    var base = this.base, sc = this.scale || 1;
    return EXPR.map(function (names) {
      var d = new Float32Array(base.N * 3);
      names.forEach(function (nm) {
        var m = base.morphs[nm]; if (!m) return;
        for (var i = 0; i < m.idx.length; i++) { var o = m.idx[i] * 3; d[o] += m.d[i * 3] * m.scale * sc; d[o + 1] += m.d[i * 3 + 1] * m.scale * sc; d[o + 2] += m.d[i * 3 + 2] * m.scale * sc; }
      });
      return d;
    });
  };

  /* Tattoo decals: planar projections in the rest pose, carried as a vertex attribute (u, v per decal;
     negative = off). Text and simple marks only where a source describes them. */
  Avatar.prototype.decals = function () {
    var base = this.base, n = base.mh.length, out = new Float32Array(n * 4).fill(-1), marks = this.looks.tattoos || [];
    if (!marks.length || !root.document) return out;
    var J = this.J, pos = this.pos, self = this;
    var cv = root.document.createElement("canvas"); cv.width = 1024; cv.height = 256;
    var ctx = cv.getContext("2d"); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1024, 256);
    var exp = [];
    marks.forEach(function (mk) {
      if (/^(right|left) arm$/.test(mk.at) && mk.shape === "sleeve") { var sd0 = mk.at.split(" ")[0]; exp.push({ at: sd0 + " forearm", shape: "sleeve" }, { at: sd0 + " upper arm", shape: "sleeve" }); }
      else exp.push(mk);
    });
    exp.slice(0, 2).forEach(function (mk, slot) {
      var x0 = slot * 512;
      ctx.save(); ctx.translate(x0, 0); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#fff";
      if (mk.text) {
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        var fs = 200; ctx.font = "900 " + fs + "px 'Arial Black', Impact, sans-serif";
        while (ctx.measureText(mk.text).width > 492 && fs > 40) { fs -= 4; ctx.font = "900 " + fs + "px 'Arial Black', Impact, sans-serif"; }
        ctx.lineWidth = fs * 0.06; ctx.lineJoin = "round"; ctx.strokeText(mk.text, 256, 132); ctx.fillText(mk.text, 256, 132);
      } else if (mk.shape === "cross") {
        ctx.fillRect(236, 30, 40, 196); ctx.fillRect(176, 80, 160, 36);
      } else if (mk.shape === "sleeve") {
        // grey-wash sleeve: shaded blobs, a few solid fills and fine line work, drawn at half width because
        // the 512 px run wraps the whole arm (about twice the length the 256 px rows cover); seeded per slot
        var seed = 9301 + slot * 4721 + (self.app.slug || "").length * 131;
        function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
        ctx.save(); ctx.filter = "blur(1.2px)";
        for (var s = 0; s < 34; s++) {
          var bx = rnd() * 512, by = rnd() * 256, br = 16 + rnd() * 42, gr = ctx.createRadialGradient(bx, by, 0, bx, by, br);
          var a0 = 0.35 + rnd() * 0.55; gr.addColorStop(0, "rgba(255,255,255," + a0 + ")"); gr.addColorStop(0.7, "rgba(255,255,255," + (a0 * 0.5) + ")"); gr.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(bx, by, br * 0.5, br, rnd() * 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 0.95; ctx.fillStyle = "#fff";
        for (s = 0; s < 6; s++) { ctx.beginPath(); var fx = rnd() * 512, fy = rnd() * 256; ctx.moveTo(fx, fy); for (var k2 = 0; k2 < 5; k2++) ctx.quadraticCurveTo(fx + (rnd() - 0.5) * 60, fy + (rnd() - 0.5) * 110, fx + (rnd() - 0.5) * 50, fy + (rnd() - 0.5) * 100); ctx.closePath(); ctx.fill(); }
        ctx.filter = "none"; ctx.strokeStyle = "#fff";
        for (s = 0; s < 40; s++) { ctx.globalAlpha = 0.6 + rnd() * 0.4; ctx.lineWidth = 1.5 + rnd() * 3; ctx.beginPath(); var lx0 = rnd() * 512, ly0 = rnd() * 256; ctx.moveTo(lx0, ly0); ctx.bezierCurveTo(lx0 + (rnd() - 0.5) * 70, ly0 + (rnd() - 0.5) * 120, lx0 + (rnd() - 0.5) * 70, ly0 + (rnd() - 0.5) * 120, lx0 + (rnd() - 0.5) * 60, ly0 + (rnd() - 0.5) * 140); ctx.stroke(); }
        ctx.restore(); ctx.globalAlpha = 1;
      }
      ctx.restore();
      // projection frame
      var c = new V3(), ax = new V3(), ay = new V3(), w = 0.3, h = 0.1, nrmDir = new V3(), boneSel = null;
      if (mk.at === "upper back") { c.copy(J.Spine2.h).lerp(J.Neck.h, 0.5); c.z -= 0.2; ax.set(-1, 0, 0); ay.set(0, 1, 0); nrmDir.set(0, 0, -1); w = 0.34; h = 0.17; boneSel = ["Spine1", "Spine2", "Neck", "LeftShoulder", "RightShoulder"]; }
      else if (mk.at === "right shoulder" || mk.at === "left shoulder") {
        var sd = mk.at === "right shoulder" ? "Right" : "Left";
        c.copy(J[sd + "Arm"].h).lerp(J[sd + "ForeArm"].h, 0.22); var out2 = sd === "Right" ? -1 : 1; ax.set(0, 0, out2 > 0 ? -1 : 1); ay.set(0, 1, 0); nrmDir.set(out2, 0, 0); w = 0.075; h = 0.075; boneSel = [sd + "Arm", sd + "Shoulder"];
      } else if (mk.at === "right upper arm" || mk.at === "left upper arm") {
        var ud = mk.at.indexOf("right") === 0 ? "Right" : "Left";
        c.copy(J[ud + "Arm"].h).lerp(J[ud + "ForeArm"].h, 0.5); ay.copy(J[ud + "ForeArm"].h).sub(J[ud + "Arm"].h).normalize(); ax.set(0, 0, 1).cross(ay).normalize(); nrmDir.set(0, 0, 1); w = 0.3; h = J[ud + "ForeArm"].h.distanceTo(J[ud + "Arm"].h) * 1.05; boneSel = [ud + "Arm"]; mk.wrap = true;
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
    var g = new T.BufferGeometry(), index = px.prim.index;
    if (o.cutY != null) {
      // fade: keep only the hair above the cut line (the clipped sides and nape are painted and shelled)
      var kept = [];
      for (var q = 0; q < index.length; q += 3) {
        var ya = pos[index[q] * 3 + 1], yb = pos[index[q + 1] * 3 + 1], yc = pos[index[q + 2] * 3 + 1];
        if (Math.max(ya, yb, yc) > o.cutY && (ya + yb + yc) / 3 > o.cutY - 0.006) kept.push(index[q], index[q + 1], index[q + 2]);
      }
      index = new Uint32Array(kept);
    }
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.BufferAttribute(px.uv, 2));
    var sj = px.joints, swt = px.weights;
    if (o.reweight) { var rw = this.refWeights(px); sj = rw.j; swt = rw.w; }
    g.setAttribute("skinIndex", new T.BufferAttribute(sj, 4));
    g.setAttribute("skinWeight", new T.BufferAttribute(swt, 4));
    g.setIndex(new T.BufferAttribute(index, 1));
    g.computeVertexNormals();
    var mat = new T.MeshStandardMaterial({ map: o.map || px.tex, roughness: o.roughness != null ? o.roughness : (o.hair ? 0.5 : 0.8), metalness: 0, skinning: true,
      side: meta.doubleSided ? T.DoubleSide : T.FrontSide });
    if (o.color) mat.color.copy(lin(o.color));
    var mesh, extra = null;
    if (o.hair) {
      mat.alphaTest = 0.5; mat.side = T.DoubleSide;
      hairShading(mat, 1 / px.lum);
      var tips = mat.clone(); hairShading(tips, 1 / px.lum); tips.alphaTest = 0.04; tips.transparent = true; tips.depthWrite = false;
      extra = new T.SkinnedMesh(g, tips); extra.renderOrder = 3; extra.castShadow = false;
      this.hairMats = [mat, tips];
      this.disposables.push(tips);
    } else if (meta.transparent) {
      mat.transparent = true; mat.depthWrite = false;
      if (o.brows || o.lashes) { mat.alphaTest = 0; mat.polygonOffset = true; mat.polygonOffsetFactor = -1; }
    }
    if (o.eyes) { mat.roughness = 0.08; }   // eyeball plus a cornea layer whose texels are mostly transparent
    if (o.tint) {
      // greyscale the proxy's texture and multiply by the kit colour (leather creases and seams stay)
      var tk = (o.tintGain || 1.6).toFixed(2);
      mat.roughness = o.roughness != null ? o.roughness : 0.45;
      mat.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n\tdiffuseColor.rgb = diffuse * clamp(pow(dot(texelColor.rgb, vec3(0.299, 0.587, 0.114)), 0.8) * " + tk + ", 0.0, 1.6);"); };
      mat.customProgramCacheKey = function () { return "proxy-tint-" + tk; };
    }
    if (o.brows || o.lashes) {
      var boost = o.brows ? 1.45 : 1.25;
      mat.onBeforeCompile = function (sh) { sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n\tdiffuseColor.a = clamp(diffuseColor.a * " + boost.toFixed(2) + ", 0.0, 1.0);"); };
      mat.customProgramCacheKey = function () { return "fight-proxy-alpha-" + boost; };
    }
    if ((o.brows || o.lashes) && this.exprDelta) {
      var D = this.exprDelta;
      g.morphAttributes.position = D.map(function (d) {
        var arr = new Float32Array(n * 3);
        for (var j = 0; j < n; j++) for (var k = 0; k < 3; k++) arr[j * 3 + k] = w[j * 3] * d[r[j * 3] * 3 + k] + w[j * 3 + 1] * d[r[j * 3 + 1] * 3 + k] + w[j * 3 + 2] * d[r[j * 3 + 2] * 3 + k];
        return new T.BufferAttribute(arr, 3);
      });
      g.morphTargetsRelative = true;
      mat.morphTargets = true;
    }
    mesh = new T.SkinnedMesh(g, mat);
    mesh.name = meta.kind;
    if (g.morphAttributes.position) { mesh.updateMorphTargets(); this.morphMeshes.push(mesh); }
    mesh.renderOrder = meta.transparent && !o.eyes ? 2 : 0;
    this.group.add(mesh); mesh.bind(this.skeleton, new M4());
    if (extra) { this.group.add(extra); extra.bind(this.skeleton, new M4()); this.meshes.push(extra); }
    if (o.brows || o.lashes || o.eyes) { mesh.castShadow = false; }
    this.meshes.push(mesh); this.disposables.push(g, mat);
    return mesh;
  };
  /* Skin weights for a proxy from its three reference body vertices (barycentric blend of the body's
     weights, top four kept). The glove proxy ships with its fingertips weighted to the second phalanx
     only, so a closed fist left them sticking out like claws; the body's weights follow every joint. */
  Avatar.prototype.refWeights = function (px) {
    var base = this.base, n = px.refs.length / 3, N = base.N, first = this._mhFirst;
    if (!first) { first = this._mhFirst = new Int32Array(N).fill(-1); for (var v = 0; v < base.mh.length; v++) if (first[base.mh[v]] < 0) first[base.mh[v]] = v; }
    var J = new Uint16Array(n * 4), Wt = new Float32Array(n * 4), acc = {}, i, k, q;
    for (i = 0; i < n; i++) {
      acc = {};
      for (q = 0; q < 3; q++) {
        var bw = px.refw[i * 3 + q], rv = first[px.refs[i * 3 + q]]; if (bw <= 0 || rv < 0) continue;
        for (k = 0; k < 4; k++) { var w = base.weights[rv * 4 + k]; if (w > 0) { var j = base.joints[rv * 4 + k]; acc[j] = (acc[j] || 0) + w * bw; } }
      }
      var best = Object.keys(acc).map(function (key) { return [acc[key], +key]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, 4), tot = 0;
      best.forEach(function (b) { tot += b[0]; });
      if (!tot) { for (k = 0; k < 4; k++) { J[i * 4 + k] = px.joints[i * 4 + k]; Wt[i * 4 + k] = px.weights[i * 4 + k]; } continue; }
      for (k = 0; k < 4; k++) { J[i * 4 + k] = best[k] ? best[k][1] : 0; Wt[i * 4 + k] = best[k] ? best[k][0] / tot : 0; }
    }
    return { j: J, w: Wt };
  };
  function hairShading(m, k) {
    k = (k || 4.5).toFixed(2);
    // texture luminance x hair colour (any colour), then HumanForge's darkening of near-white
    // transparent texels so strand tips fade instead of haloing
    m.onBeforeCompile = function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n\tdiffuseColor.rgb = diffuse * clamp(dot(texelColor.rgb, vec3(0.299, 0.587, 0.114)) * " + k + ", 0.0, 2.2);\n\tdiffuseColor.rgb *= mix(0.35, 1.0, smoothstep(0.05, 0.85, diffuseColor.a));");
    };
    m.customProgramCacheKey = function () { return "fight-hair-" + k; };
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
    var hemY = hipJ - thigh * (this.cfg.female ? 0.4 : 0.64);
    var ARMS = {}, LEGS = {}, i;
    ["Left", "Right"].forEach(function (s) { ["Arm", "ForeArm", "Hand", "Shoulder"].forEach(function (b) { ARMS[s + b] = 1; }); FINGERS.concat(["Thumb"]).forEach(function (f) { for (var k = 1; k <= 3; k++) ARMS[s + "Hand" + f + k] = 1; }); LEGS[s + "UpLeg"] = 1; LEGS[s + "Leg"] = 1; });
    function y(i) { return pos[i * 3 + 1]; }
    function inShorts(i, pad) { pad = pad || 0; return y(i) < waistY - pad && y(i) > hemY + pad && self.boneW(i, ARMS) < 0.05; }
    var hemSpan = Math.max(0.05, waistY - hemY);
    var sp = this.shortsProxy, smesh = null;
    if (sp) {
      // fitted board-shorts proxy (cloth hangs between the legs instead of two tubes); kit panels from its rest shape
      smesh = this.addProxy(sp, { color: app.shorts || "#2563c9", roughness: 0.7 });
      // fight shorts hang taut across the seat: bridge the gluteal cleft (each back-facing vertex takes the
      // furthest-back depth among its neighbours across ~7 cm at the same height), then lift the cloth 3 mm
      // off the skin so the body does not poke through along the side seams
      (function (g) {
        var P0 = g.attributes.position.array, nv0 = P0.length / 3, cz = J.Hips.h.z, out = new Float32Array(P0), a2;
        for (a2 = 0; a2 < nv0; a2++) {
          var ya = P0[a2 * 3 + 1], za = P0[a2 * 3 + 2], xa = P0[a2 * 3]; if (za > cz - 0.02 || Math.abs(xa) > 0.09 || ya < hipJ - 0.12) continue;
          var zmin = za;
          for (var b2 = 0; b2 < nv0; b2++) { var dx = P0[b2 * 3] - xa, dy = P0[b2 * 3 + 1] - ya; if (dx * dx < 0.0049 && dy * dy < 0.0001 && P0[b2 * 3 + 2] < zmin) zmin = P0[b2 * 3 + 2]; }
          out[a2 * 3 + 2] = lerp(za, zmin, 0.85 * smooth(0.09, 0.03, Math.abs(xa)));
        }
        g.attributes.position.array.set(out); g.computeVertexNormals();
        var Nn = g.attributes.normal.array; for (a2 = 0; a2 < P0.length; a2++) P0[a2] += Nn[a2] * 0.003;
        g.attributes.position.needsUpdate = true; g.computeVertexNormals();
      })(smesh.geometry);
      var sg = smesh.geometry, spos = sg.attributes.position.array, snrm = sg.attributes.normal.array, nv = spos.length / 3, top = -1e9, bot = 1e9, q;
      for (q = 0; q < nv; q++) { top = Math.max(top, spos[q * 3 + 1]); bot = Math.min(bot, spos[q * 3 + 1]); }
      var span2 = Math.max(0.05, top - bot), kit = new Float32Array(nv * 4);
      for (q = 0; q < nv; q++) { kit[q * 4] = clamp01((spos[q * 3 + 1] - bot) / span2); kit[q * 4 + 1] = Math.atan2(snrm[q * 3], snrm[q * 3 + 2]); kit[q * 4 + 2] = spos[q * 3] >= 0 ? 1 : -1; kit[q * 4 + 3] = spos[q * 3 + 2]; }
      sg.setAttribute("aKit", new T.BufferAttribute(kit, 4));
      hemSpan = span2;
      var del = new Uint8Array(this.base.N), mhv = this.base.mh;
      (sp.meta.deleteVerts || []).forEach(function (r) { for (var q2 = r[0]; q2 <= r[1]; q2++) del[q2] = 1; });
      this.hideUnder(function (i) { return del[mhv[i]] === 1; });
    }
    var shortsG = this.shortsProxy ? null : this.shell(function (i) { return inShorts(i); }, function (i) {
      var v = clamp01((y(i) - hemY) / hemSpan), lat = Math.abs(nrm[i * 3]);
      return 0.006 + 0.022 * (1 - smooth(0.2, 0.8, v)) + 0.012 * lat * (1 - v);
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
          "  float weave = 0.95 + 0.05 * fract(sin(dot(floor(vec2(vKit.y * 260.0, vKit.x * 420.0)), vec2(12.9898, 78.233))) * 43758.5453);\n" +
          "  diffuseColor.rgb = c * weave;\n" +
          "  if (slit > 0.5) discard;\n" +
          "  if (!gl_FrontFacing) diffuseColor.rgb *= 0.8; }")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, smoothstep(1.0 - uBandW, 1.0 - uBandW + 0.02, vKit.x));");
    } });
    this.shortsMat = shorts;
    if (smesh) { var oldM = smesh.material; smesh.material = shorts; this.disposables.push(shorts); if (oldM && oldM.dispose) oldM.dispose(); smesh.name = "shorts"; }
    if (shortsG) { this.addShell(shortsG, shorts, "shorts"); this.hideUnder(function (i) { return inShorts(i, 0.02); }); }
    if (this.gloveProxy) {
      // CC0 open-finger MMA glove proxy (corner-neutral colour), fitted to this hand
      var gp = this.gloveProxy, gm = this.addProxy(gp, { color: app.glove || "#16181c", tint: true, tintGain: 1.9, roughness: 0.42, reweight: true });
      gm.name = "gloves"; this.gloveMesh = gm;
      // body skin the glove sits on (its reference vertices) would poke through the cuff and palm when skinned
      var cov = new Uint8Array(this.base.N), mhb = this.base.mh;
      for (var gi = 0; gi < gp.refs.length; gi++) if (gp.refw[gi] > 0.2) cov[gp.refs[gi]] = 1;
      this.hideUnder(function (i) { return cov[mhb[i]] === 1; });
      return;
    }
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
    this.addShell(wrapG, fabricMaterial(lin("#e9e6dc"), { rough: 0.9 }), "wraps");
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
    this.addShell(shoeG, fabricMaterial(lin("#0c0d10"), { rough: 0.45 }), "shoes");
    var gloveG = this.shell(function (i) { return self.boneW(i, HANDS) > 0.3; }, function () { return 0.0014; });
    this.addShell(gloveG, fabricMaterial(colorOf(this.app.gloves, "#15161a"), { rough: 0.35 }), "latex");
    this.hideUnder(function (i) { return inShirt(i, 0.02) || inPants(i, 0.02) || self.boneW(i, FEET) > 0.9 || self.boneW(i, HANDS) > 0.95; });
  };

  /* ------------------------------------------------------------ strand shells (hair and beards) */
  function texPixels(tex) {
    if (tex._px) return tex._px;
    var img = tex.image, c = root.document.createElement("canvas"); c.width = img.width; c.height = img.height;
    var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
    tex._px = { w: c.width, h: c.height, d: x.getImageData(0, 0, c.width, c.height).data };
    return tex._px;
  }
  function sampleMask(px, u, v, ch) {
    var fx = clamp(u * px.w - 0.5, 0, px.w - 1), fy = clamp(v * px.h - 0.5, 0, px.h - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(px.w - 1, x0 + 1), y1 = Math.min(px.h - 1, y0 + 1), ax = fx - x0, ay = fy - y0, d = px.d, w = px.w;
    return (d[(y0 * w + x0) * 4 + ch] * (1 - ax) * (1 - ay) + d[(y0 * w + x1) * 4 + ch] * ax * (1 - ay) + d[(y1 * w + x0) * 4 + ch] * (1 - ax) * ay + d[(y1 * w + x1) * 4 + ch] * ax * ay) / 255;
  }
  /* Hair and beard caps (the game-style "fur card" approach): a few shells of the covered skin pushed
     0.6-12 mm out, each drawn with procedural hairs: short anti-aliased strokes laid along a per-vertex
     growth direction (down the jaw, out from the crown whorl, down the sides), thinning to their tips,
     alpha-blended inner to outer over the opaque skin. Up close every hair is a stroke; once a stroke cell
     shrinks under a pixel or two the strokes average out to their mean coverage, so short hair never breaks
     into a speckled dot cloud. A Kajiya-Kay highlight runs across the strands. Skinned and given the
     expression morphs, so a beard follows the jaw. Coverage: the per-vertex beard mask (cheek line,
     neckline, lips, goatee and moustache cut-outs) or the painted hairline masks, sampled per pixel. */
  Avatar.prototype.headUVScale = function () {
    if (this._huvs) return this._huvs;
    var base = this.base, idx = base.index, pos = this.pos, uv = base.uv, HB = { Head: 1 }, s3 = 0, s2 = 0;
    for (var i = 0; i < idx.length; i += 3) {
      var a = idx[i], b = idx[i + 1];
      if (this.boneW(a, HB) < 0.6 || this.boneW(b, HB) < 0.6) continue;
      var dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2], du = uv[a * 2] - uv[b * 2], dv = uv[a * 2 + 1] - uv[b * 2 + 1];
      s3 += Math.sqrt(dx * dx + dy * dy + dz * dz); s2 += Math.sqrt(du * du + dv * dv);
    }
    this._huvs = s2 > 0 ? s3 / s2 : 1.2;
    return this._huvs;
  };
  /* Growth direction per render vertex as a unit vector in UV space: dir3(i, out) gives a direction in
     the rest pose; it is projected on the surface and expressed in the triangle's UV basis (dP/du, dP/dv). */
  Avatar.prototype.flowUV = function (sel, dir3) {
    var base = this.base, idx = base.index, P = this.pos, Nr = this.nrm, uv = base.uv, n = base.mh.length;
    var acc = new Float32Array(n * 2), e1 = new V3(), e2 = new V3(), Tu = new V3(), Tv = new V3(), d = new V3(), nn = new V3();
    for (var i = 0; i < idx.length; i += 3) {
      var a = idx[i], b = idx[i + 1], c = idx[i + 2];
      if (!sel[a] && !sel[b] && !sel[c]) continue;
      e1.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]);
      e2.set(P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]);
      var du1 = uv[b * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1], du2 = uv[c * 2] - uv[a * 2], dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
      var r = du1 * dv2 - du2 * dv1; if (Math.abs(r) < 1e-12) continue; r = 1 / r;
      Tu.copy(e1).multiplyScalar(dv2).addScaledVector(e2, -dv1).multiplyScalar(r);
      Tv.copy(e2).multiplyScalar(du1).addScaledVector(e1, -du2).multiplyScalar(r);
      var a11 = Tu.dot(Tu), a12 = Tu.dot(Tv), a22 = Tv.dot(Tv), det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-14) continue;
      [a, b, c].forEach(function (v) {
        if (!sel[v]) return;
        dir3(v, d); nn.set(Nr[v * 3], Nr[v * 3 + 1], Nr[v * 3 + 2]); d.addScaledVector(nn, -nn.dot(d));
        var b1 = Tu.dot(d), b2 = Tv.dot(d), x = (a22 * b1 - a12 * b2) / det, y = (a11 * b2 - a12 * b1) / det, L = Math.hypot(x, y);
        if (L > 1e-9) { acc[v * 2] += x / L; acc[v * 2 + 1] += y / L; }
      });
    }
    for (i = 0; i < n; i++) { var l = Math.hypot(acc[i * 2], acc[i * 2 + 1]); if (l > 1e-9) { acc[i * 2] /= l; acc[i * 2 + 1] /= l; } else { acc[i * 2] = 0; acc[i * 2 + 1] = 1; } }
    return acc;
  };
  Avatar.prototype.makeStrands = function () {
    var looks = this.looks, X = this.tex || {}, base = this.base, n = base.mh.length, uv = base.uv, i, self = this;
    if (!root.document) return;
    var HEADB = { Head: 1, Neck: 1 }, M = this.maskL, P = this.pos, Nr = this.nrm, tmp = new V3(), mm = 0.001;
    var bl = looks.beardLen || 0;
    if (bl >= 0.5 && looks.beard > 0.3 && this.vMaskBeard && M) {
      var lmB = this.vMaskBeard, covB = new Float32Array(n), lenB = new Float32Array(n), densB = new Float32Array(n), full = bl >= 18;
      var lipY = (M.lipTop.y + M.lipBot.y) / 2, mh2 = Math.abs(M.mouthL.x - M.mouthR.x) / 2, noseY = M.noseBottom.y;
      var mouV = new Float32Array(n);
      for (i = 0; i < n; i++) {
        if (!(lmB[i] > 0.01) || this.boneW(i, HEADB) < 0.5) continue;
        covB[i] = lmB[i];
        var x = P[i * 3], y = P[i * 3 + 1], ax = Math.abs(x);
        var chinK = (1 - smooth(lipY - 0.014, lipY + 0.002, y)) * (1 - smooth(mh2 * 0.7, mh2 * 2.3, ax));
        var mous = smooth(lipY - 0.001, lipY + 0.006, y) * (1 - smooth(noseY - 0.001, noseY + 0.007, y)) * (1 - smooth(mh2 + 0.004, mh2 + 0.018, ax));
        mouV[i] = mous;
        lenB[i] = (full ? lerp(looks.beardCheekK || 0.45, 1, chinK) : lerp(0.75, 1, chinK)) * (1 - 0.35 * mous);
        densB[i] = 1 - mous * (1 - (looks.moustacheDens != null ? looks.moustacheDens : 1));
      }
      var bdir = function (v, out) {
        var under = smooth(-0.15, -0.65, Nr[v * 3 + 1]), sx = P[v * 3] >= 0 ? 1 : -1;
        out.set(0.1 * sx, -1, 0.12).lerp(tmp.set(0, -0.35, -1), under);
        out.x += sx * 0.45 * mouV[v];
        return out;
      };
      var stub = bl < 4, dB = looks.beardDensity || 0.9;
      var bo = stub ? { offs: bl < 2 ? [0.55 * mm] : [0.5 * mm, 1.2 * mm], cell: 0.85 + 0.12 * bl, slen: 0.75 + 0.3 * bl, sw: 0.05, dens: 0.92 * dB, grids: 3, opac: 1.5 }
        : (!full ? { offs: [0.6, 0.45, 0.72, 1].map(function (k, j) { return j === 0 ? 0.6 * mm : k * clamp(bl * 0.38, 2.4, 5.2) * mm; }), cell: 1.7 + 0.05 * bl, slen: 1.9 + 0.06 * bl, sw: 0.075, dens: 0.95 * dB, grids: 3, opac: 1.45 }
          : { offs: [0.7, 0.2, 0.36, 0.52, 0.68, 0.84, 1].map(function (k, j) { return j === 0 ? 0.7 * mm : k * clamp(bl * 0.38, 6, 12) * mm; }), droop: clamp(bl * 0.22, 3, 9) * mm, cell: 2.3, slen: 2.8, sw: 0.085, dens: 0.95 * dB, grids: 3, opac: 1.45 });
      this.addCap("beard", covB, Object.assign(bo, { len: lenB, densV: densB, dir: bdir, color: looks.beardColor, grey: looks.beardGrey || 0, lenK: 0.7, edgeK: full ? 1 : 0.7, seed: 11, spec: 0.09, shin: 60 }));
    }
    if (looks.hairMode === "shell" && X.maskHair && X.maskHair2 && looks.scalpCh >= 0 && looks.scalpCh < 4) {
      var maskT = looks.scalpCh < 3 ? X.maskHair : X.maskHair2, ph = texPixels(maskT), covH = new Float32Array(n), ch = looks.scalpCh % 3;
      for (i = 0; i < n; i++) {
        if (this.boneW(i, HEADB) < 0.5) continue;
        var u = (uv[i * 2] - 0.6) / 0.3, v = (uv[i * 2 + 1] - 0.03) / 0.84;
        if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) continue;
        covH[i] = sampleMask(ph, clamp01(u), clamp01(v), ch);
      }
      var topmm = looks.hairLen * 10, sidemm = looks.hairSides != null ? Math.min(topmm, looks.hairSides * 10) : (ch === 1 ? topmm * 0.3 : topmm * 0.8);
      if (looks.hair) topmm = Math.min(topmm, Math.max(sidemm * 1.6, 8));   // a hair mesh carries the top: the cap only has to blend into it
      var earY = M ? (M.sideburnR.y + M.sideburnL.y) / 2 : this.J.Head.h.y + 0.05, hc = this.headC || this.J.Head.h;
      var whorl = new V3(hc.x, this.cfg.H - 0.012, hc.z - 0.055), lenH = new Float32Array(n);
      for (i = 0; i < n; i++) if (covH[i] > 0) lenH[i] = lerp(sidemm, topmm, smooth(earY + 0.025, earY + 0.085, P[i * 3 + 1])) / Math.max(0.1, topmm);
      var hdir = function (v, out) {
        var y = P[v * 3 + 1], tf = smooth(earY + 0.03, earY + 0.09, y);
        out.set(P[v * 3] - whorl.x, (P[v * 3 + 1] - whorl.y) * 0.4, P[v * 3 + 2] - whorl.z).normalize();
        out.lerp(tmp.set(0, -1, -0.35).normalize(), 1 - tf);
        return out;
      };
      var buzz = topmm <= 6.5;
      var ho = buzz ? { offs: [0.5 * mm, Math.max(0.9, topmm * 0.32) * mm], cell: 0.9 + 0.08 * topmm, slen: Math.min(0.7 + topmm * 0.35, 2.4), sw: 0.045, dens: 0.95, grids: 3, opac: 1.55 }
        : { offs: [0.55, 0.4, 0.7, 1].map(function (k, j) { return j === 0 ? 0.55 * mm : k * clamp(topmm * 0.28, 1.8, 7) * mm; }), cell: 1.6, slen: 2.2, sw: 0.06, dens: 0.95, grids: 3, opac: 1.5 };
      this.addCap("hair", covH, Object.assign(ho, { len: lenH, dir: hdir, color: looks.hairColor, grey: 0, lenK: 0.6, edgeK: 0.8, seed: 53, spec: 0.12, shin: 80, maskTex: maskT, maskCh: ch, maskSet: looks.scalpCh < 3 ? 0 : 1 }));
    }
  };
  var CAP_FS_PARS = "varying vec4 vCap;\nvarying vec2 vFlow;\nvarying vec2 vCUv;\n" +
    "uniform float uScale; uniform float uCell; uniform float uSLen; uniform float uSW; uniform float uDens; uniform float uGrids; uniform float uOpac; uniform float uGrey;\n" +
    "uniform float uSpecK; uniform float uShin; uniform float uMaskOn; uniform sampler2D uMaskT; uniform vec4 uMaskCh; uniform float uLenK; uniform float uEdgeK; uniform float uSeed; uniform vec3 uCapCol;\n" +
    "vec3 gHairT; float gHairA;\n" +
    "float ch1(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n" +
    "float cvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(ch1(i), ch1(i + vec2(1.0, 0.0)), f.x), mix(ch1(i + vec2(0.0, 1.0)), ch1(i + vec2(1.0, 1.0)), f.x), f.y); }\n" +
    // one jittered grid of strokes: x coverage, y coverage-weighted shade, z grey share
    "vec3 capGrid(vec2 s, vec2 f, float pw, float dens, float seed, float slen) {\n" +
    "  vec2 ci = floor(s / uCell); float keep = 1.0, shade = 0.0, grey = 0.0, ws = 0.0;\n" +
    "  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {\n" +
    "    vec2 c = ci + vec2(float(i), float(j));\n" +
    "    vec2 cs = c + seed;\n" +
    "    if (ch1(cs) > dens) continue;\n" +
    "    vec2 rt = (c + vec2(ch1(cs + 7.13), ch1(cs + 3.71))) * uCell;\n" +
    "    float ang = (ch1(cs + 11.3) - 0.5) * 0.75; float ca = cos(ang), sa = sin(ang);\n" +
    "    vec2 d = vec2(f.x * ca - f.y * sa, f.x * sa + f.y * ca);\n" +
    "    float L = slen * (0.45 + 0.55 * ch1(cs + 5.9));\n" +
    "    vec2 q = s - rt; float t = clamp(dot(q, d), 0.0, L); float dist = length(q - d * t);\n" +
    "    float hw = uSW * (1.0 - 0.6 * t / L); float ehw = max(hw, pw * 0.5);\n" +
    "    float cv = (1.0 - smoothstep(ehw - pw * 0.5, ehw + pw * 0.5, dist)) * (hw / ehw);\n" +
    "    keep *= 1.0 - cv;\n" +
    "    float h3 = ch1(cs + 19.7);\n" +
    "    shade += cv * (0.7 + 0.55 * h3) * (1.12 - 0.3 * t / L); grey += cv * step(h3, uGrey); ws += cv;\n" +
    "  }\n" +
    "  return vec3(1.0 - keep, ws > 0.0 ? shade / ws : 1.0, ws > 0.0 ? grey / ws : 0.0);\n" +
    "}\n";
  var CAP_FS_MAIN =
    "{ vec2 s = vCUv * uScale; vec2 f = normalize(vFlow + vec2(1e-5));\n" +
    "  float pw = max(length(fwidth(s)), 1e-4);\n" +
    "  float cov = vCap.y;\n" +
    "  if (uMaskOn > 0.5) { vec2 hu = (vCUv - vec2(0.6, 0.03)) / vec2(0.3, 0.84); cov = min(cov * 1.6 + 0.08, dot(texture2D(uMaskT, clamp(hu, 0.0, 1.0)), uMaskCh)); }\n" +
    "  float h = vCap.x;\n" +
    "  float dens = uDens * vCap.w * smoothstep(0.03 + 0.45 * h * uEdgeK, 0.5 + 0.4 * h * uEdgeK, cov) * (0.72 + 0.56 * cvn(s / 7.0)) * (1.0 - 0.3 * h);\n" +
    "  float slen = uSLen * mix(1.0, vCap.z, uLenK);\n" +
    "  float far = smoothstep(0.42 * uCell, 1.05 * uCell, pw);\n" +
    "  float A = 0.725 * slen * 1.4 * uSW / (uCell * uCell);\n" +
    "  float meanC = 1.0 - exp(-uGrids * clamp(dens, 0.0, 1.0) * A * 1.05);\n" +
    "  float a = meanC, shade = 0.98, grey = uGrey;\n" +
    "  if (far < 0.999 && dens > 0.002) {\n" +
    "    vec3 g1 = capGrid(s, f, pw, dens, uSeed, slen);\n" +
    "    vec3 g2 = capGrid(s + uCell * vec2(0.5, 0.31), f, pw, dens, uSeed + 37.0, slen);\n" +
    "    vec3 g3 = uGrids > 2.5 ? capGrid(s + uCell * vec2(0.23, 0.67), f, pw, dens, uSeed + 71.0, slen) : vec3(0.0, 1.0, 0.0);\n" +
    "    float nearC = 1.0 - (1.0 - g1.x) * (1.0 - g2.x) * (1.0 - g3.x), ws = g1.x + g2.x + g3.x + 1e-4;\n" +
    "    a = mix(nearC, meanC, far);\n" +
    "    shade = mix((g1.x * g1.y + g2.x * g2.y + g3.x * g3.y) / ws, shade, far);\n" +
    "    grey = mix((g1.x * g1.z + g2.x * g2.z + g3.x * g3.z) / ws, grey, far);\n" +
    "  }\n" +
    "  a = clamp(a * uOpac, 0.0, 1.0);\n" +
    "  if (a < 0.004) discard;\n" +
    "  vec3 col = uCapCol * shade * mix(0.66, 1.06, h);\n" +
    "  col = mix(col, vec3(0.42, 0.41, 0.4), clamp(grey, 0.0, 1.0) * 0.85);\n" +
    "  diffuseColor = vec4(col, a); gHairA = a; }\n";
  var CAP_FS_TANGENT =
    "{ vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition); vec2 st0 = dFdx(vCUv), st1 = dFdy(vCUv);\n" +
    "  vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);\n" +
    "  vec3 tu = q1p * st0.x + q0p * st1.x, tv = q1p * st0.y + q0p * st1.y; vec2 ff = normalize(vFlow + vec2(1e-5));\n" +
    "  vec3 tt = tu * ff.x + tv * ff.y; gHairT = dot(tt, tt) > 1e-20 ? normalize(tt) : vec3(0.0, 1.0, 0.0); }\n";
  var CAP_KK =
    "\n#ifdef CAP_KK\n" +
    "\t{ vec3 hH = normalize( directLight.direction + geometry.viewDir );\n" +
    "\t  float t1 = dot( gHairT, hH ), s1 = sqrt( max( 0.0, 1.0 - t1 * t1 ) );\n" +
    "\t  vec3 tB = normalize( gHairT - geometry.normal * 0.22 ); float t2 = dot( tB, hH ), s2 = sqrt( max( 0.0, 1.0 - t2 * t2 ) );\n" +
    "\t  float nl = smoothstep( -0.1, 0.45, dot( geometry.normal, directLight.direction ) );\n" +
    "\t  vec3 kk = vec3( pow( s1, uShin ) ) * uSpecK + material.diffuseColor * pow( s2, uShin * 0.3 ) * uSpecK * 2.2;\n" +
    "\t  reflectedLight.directSpecular += directLight.color * kk * nl; }\n" +
    "#endif\n";
  Avatar.prototype.addCap = function (name, cov, o) {
    var base = this.base, n = base.mh.length, idx = base.index, mh = base.mh, i, k;
    var map = new Int32Array(n).fill(-1), sel = [], tris = [], selU = new Uint8Array(n);
    for (i = 0; i < idx.length; i += 3) {
      var a = idx[i], b = idx[i + 1], c = idx[i + 2];
      if (cov[a] < 0.03 && cov[b] < 0.03 && cov[c] < 0.03) continue;
      if (cov[a] + cov[b] + cov[c] < 0.12) continue;
      [a, b, c].forEach(function (v) { if (map[v] < 0) { map[v] = sel.length; sel.push(v); selU[v] = 1; } });
      tris.push(map[a], map[b], map[c]);
    }
    var m = sel.length; if (!m) return null;
    var flow = this.flowUV(selU, o.dir);
    var offs = o.offs, K = offs.length, NN = m * K, pos = new Float32Array(NN * 3), nrm = new Float32Array(NN * 3), uvA = new Float32Array(NN * 2), si = new Uint16Array(NN * 4), sw = new Float32Array(NN * 4);
    var capA = new Float32Array(NN * 4), flA = new Float32Array(NN * 2);
    var D = this.exprDelta || [], md = D.map(function () { return new Float32Array(NN * 3); });
    var P = this.pos, Nr = this.nrm, maxOff = offs[K - 1];
    for (k = 0; k < K; k++) {
      var h = K > 1 ? k / (K - 1) : 0;
      for (var j = 0; j < m; j++) {
        var v = sel[j], q = k * m + j, lr = o.len ? Math.max(0.05, o.len[v]) : 1, cv = clamp01(cov[v] * 1.5);
        var off = offs[k] * Math.pow(lr, 0.8) * (k === 0 ? 1 : 0.35 + 0.65 * cv);
        var drop = o.droop ? o.droop * h * h * lr * cv : 0;
        for (var c3 = 0; c3 < 3; c3++) { pos[q * 3 + c3] = P[v * 3 + c3] + Nr[v * 3 + c3] * off; nrm[q * 3 + c3] = Nr[v * 3 + c3]; }
        pos[q * 3 + 1] -= drop;
        uvA[q * 2] = base.uv[v * 2]; uvA[q * 2 + 1] = base.uv[v * 2 + 1];
        for (c3 = 0; c3 < 4; c3++) { si[q * 4 + c3] = base.joints[v * 4 + c3]; sw[q * 4 + c3] = base.weights[v * 4 + c3]; }
        capA[q * 4] = (k + 1) / K; capA[q * 4 + 1] = cov[v]; capA[q * 4 + 2] = lr; capA[q * 4 + 3] = o.densV ? o.densV[v] : 1;
        flA[q * 2] = flow[v * 2]; flA[q * 2 + 1] = flow[v * 2 + 1];
        for (var e = 0; e < D.length; e++) { var mi = mh[v] * 3; md[e][q * 3] = D[e][mi]; md[e][q * 3 + 1] = D[e][mi + 1]; md[e][q * 3 + 2] = D[e][mi + 2]; }
      }
    }
    // inner layer first: one draw call blends the shells in index order (inside out)
    var index = new Uint32Array(tris.length * K);
    for (k = 0; k < K; k++) for (i = 0; i < tris.length; i++) index[k * tris.length + i] = tris[i] + k * m;
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("normal", new T.BufferAttribute(nrm, 3)); g.setAttribute("uv", new T.BufferAttribute(uvA, 2));
    g.setAttribute("skinIndex", new T.BufferAttribute(si, 4)); g.setAttribute("skinWeight", new T.BufferAttribute(sw, 4));
    g.setAttribute("aCap", new T.BufferAttribute(capA, 4)); g.setAttribute("aFlow", new T.BufferAttribute(flA, 2));
    g.setIndex(new T.BufferAttribute(index, 1));
    if (md.length) { g.morphAttributes.position = md.map(function (a2) { return new T.BufferAttribute(a2, 3); }); g.morphTargetsRelative = true; }
    var maskCh = new T.Vector4(o.maskCh === 0 ? 1 : 0, o.maskCh === 1 ? 1 : 0, o.maskCh === 2 ? 1 : 0, 0);
    var U = { uScale: { value: this.headUVScale() * 1000 }, uCell: { value: o.cell }, uSLen: { value: o.slen }, uSW: { value: o.sw }, uDens: { value: o.dens }, uGrids: { value: o.grids || 3 },
      uOpac: { value: o.opac || 1.4 }, uGrey: { value: o.grey || 0 }, uSpecK: { value: o.spec || 0.1 }, uShin: { value: o.shin || 60 }, uMaskOn: { value: o.maskTex ? 1 : 0 },
      uMaskT: { value: o.maskTex || null }, uMaskCh: { value: maskCh }, uLenK: { value: o.lenK != null ? o.lenK : 0.6 }, uEdgeK: { value: o.edgeK != null ? o.edgeK : 0.8 },
      uSeed: { value: o.seed || 0 }, uCapCol: { value: lin(o.color) } };
    var mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, skinning: true, morphTargets: !!md.length, transparent: true, depthWrite: false, side: T.FrontSide });
    mat.envMapIntensity = 0.45;
    mat.defines = { CAP_KK: "" };
    mat.onBeforeCompile = function (sh) {
      for (var kk in U) sh.uniforms[kk] = U[kk];
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute vec4 aCap;\nattribute vec2 aFlow;\nvarying vec4 vCap;\nvarying vec2 vFlow;\nvarying vec2 vCUv;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCap = aCap; vFlow = aFlow; vCUv = uv;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + CAP_FS_PARS)
        .replace("#include <alphatest_fragment>", CAP_FS_MAIN)
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + CAP_FS_TANGENT)
        .replace("#include <lights_physical_pars_fragment>", T.ShaderChunk.lights_physical_pars_fragment
          .replace("reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );",
            "reflectedLight.directDiffuse += ( 1.0 - clearcoatDHR ) * irradiance * BRDF_Diffuse_Lambert( material.diffuseColor );" + CAP_KK));
    };
    mat.customProgramCacheKey = function () { return "fight-cap-v1"; };
    mat.extensions = { derivatives: true };
    var mesh = new T.SkinnedMesh(g, mat); mesh.name = name; mesh.castShadow = false; mesh.userData.noShadow = true; mesh.renderOrder = 1;
    if (md.length) { mesh.updateMorphTargets(); this.morphMeshes.push(mesh); }
    this.group.add(mesh); mesh.bind(this.skeleton, new M4());
    this.meshes.push(mesh); this.disposables.push(g, mat);
    this.capU = (this.capU || {}); this.capU[name] = U;
    return mesh;
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
      // thumb: swing the first bone toward the palm about the hand's long axis, then fold the two outer
      // bones over the curled fingers (a hinge tilted toward the knuckle line), so it closes the fist
      // instead of sticking out at the face
      var hd = J[s + "HandMiddle1"].h.clone().sub(J[s + "Hand"].h).normalize(), k1 = bi[s + "HandThumb1"];
      if (k1 != null) {
        var t1 = J[s + "HandThumb1"].t.clone().sub(J[s + "HandThumb1"].h).normalize(), ax1 = hd.clone();
        if (new V3().crossVectors(ax1, t1).dot(pn) < 0) ax1.negate();
        self.curl[s + "HandThumb1"] = { k: k1, axis: ax1.applyQuaternion(Rq[k1].clone().invert()), ang: 0.5 };
        var across = J[s + "HandIndex1"].h.clone().sub(J[s + "HandPinky1"].h).normalize().multiplyScalar(s === "Left" ? 1 : -1);
        [2, 3].forEach(function (j) {
          var nm = s + "HandThumb" + j, kk = bi[nm]; if (kk == null) return;
          var dir = J[nm].t.clone().sub(J[nm].h).normalize(), hinge = new V3().crossVectors(dir, pn).normalize().lerp(across, 0.5).normalize();
          self.curl[nm] = { k: kk, axis: hinge.applyQuaternion(Rq[kk].clone().invert()), ang: j === 2 ? 1.0 : 0.8 };
        });
      }
    });
    this.fistAmt = this.cfg.ref ? 0.25 : 0.92;
    // clip reference rotations per clip set: align each rest bone to that set's source rest direction
    var childOf = { Hips: "Spine", Spine: "Spine1", Spine1: "Spine2", Spine2: "Neck", Neck: "Head", LeftShoulder: "LeftArm", RightShoulder: "RightArm", LeftArm: "LeftForeArm", RightArm: "RightForeArm",
      LeftForeArm: "LeftHand", RightForeArm: "RightHand", LeftHand: "LeftHandMiddle1", RightHand: "RightHandMiddle1", LeftUpLeg: "LeftLeg", RightUpLeg: "RightLeg", LeftLeg: "LeftFoot", RightLeg: "RightFoot", LeftFoot: "LeftToeBase", RightFoot: "RightToeBase" };
    var sets = this.base.clipSets || [this.base.clips];
    this.clipRefs = []; this.clipMirror = []; this.clipBi = [];
    sets.forEach(function (C, si) {
      if (!C) { self.clipRefs.push(null); self.clipMirror.push(null); self.clipBi.push(null); return; }
      self.clipBi.push(C.bones.map(function (nm) { return bi[nm]; }));
      self.clipRefs.push(C.bones.map(function (nm) {
        var k = bi[nm], dmh = childOf[nm] ? J[childOf[nm]].h.clone().sub(J[nm].h) : J[nm].t.clone().sub(J[nm].h);
        var ds = new V3().fromArray(C.src.dirs[nm]);
        return new Q().setFromUnitVectors(dmh.normalize(), ds.normalize()).multiply(Rq[k]);
      }));
      self.clipMirror.push(C.bones.map(function (nm) { var m = nm.indexOf("Left") === 0 ? "Right" + nm.slice(4) : (nm.indexOf("Right") === 0 ? "Left" + nm.slice(5) : nm); var j = C.bones.indexOf(m); return j < 0 ? C.bones.indexOf(nm) : j; }));
    });
    this.clipRef = this.clipRefs[0] || this.clipRefs[1];
    this.hipsY = J.Hips.h.y;
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
    // face landmarks in the head joint's frame, for the guard (Actor.guardTargets puts the gloves against this face)
    var LMk = this.maskL, hj = this.J.Head.h;
    if (LMk) this.faceRef = { chin: LMk.chin.clone().sub(hj), jaw: LMk.jawAngL.clone().sub(hj), cheek: LMk.cheekBoneL.clone().sub(hj), brow: LMk.browL.clone().sub(hj), nose: LMk.noseTip.clone().sub(hj) };
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
    if (this.face) this.face.flinch = Math.min(1, 0.6 + 0.3 * p);
    this.lastHitInfo = { move: move, side: side == null ? 1 : side, body: !HEAD_MOVES[move] && move !== "calf" && move !== "inside", p: p };
    this.hitClip(move, p, side == null ? 1 : side);
    this.applyLooks();
  };
  Avatar.prototype.setRound = function (r) { this.sweat = clamp01(0.25 + 0.17 * r); this.applyLooks(); };
  Avatar.prototype.resetDamage = function () { this.damHead = [0, 0]; this.damLeg = [0, 0]; this.damBody = 0; this.sweat = 0.15; this.applyLooks(); };
  Avatar.prototype.applyLooks = function () {
    var U = this.uniforms; if (!U) return;
    U.uDam.value.set(this.damHead[0], this.damHead[1]);
    U.uLeg.value.set(this.damLeg[0], this.damLeg[1]);
    U.uSweat.value = this.sweat;
    if (this.skinMat) this.skinMat.clearcoat = this.sweat * 0.5;
    U.uFlush.value = clamp01(this.sweat * 0.8 + (this.damHead[0] + this.damHead[1]) * 0.3);
  };

  /* ------------------------------------------------------------ clip layers
     Two clip sets: Mesh2Motion (v1, CC0) and the Mixamo fight set (v2: strikes, reactions, knockdowns,
     get-ups, takedowns, referee, celebrations). Layer: { clip, t, speed, speed2, w, target, rate, mask,
     loop, stop, anchor, mirror, ik, sup, autoOff, prev }.
     mask: "full" (whole body incl. root motion, anchored where the hips were), "upper" (spine, arms and
     head riding on the driver's pelvis), "kick" (whole body on the driver's pelvis, support foot planted
     on the driver's foot), "torso" (spine and head only).
     ik: limb whose effector is pulled onto the driver's target around contact (so strikes land where the
     engine says); sup: support leg pinned to the driver's foot; mirror: left and right swapped (southpaw,
     or a clip thrown with the other hand). speed2: playback speed after contact (recovery). */
  var CLIP_ALIAS = { fallFwd: "koFwd", fallBack2: "koBack", fallBack: "koFallBack", hitHead: "hitMed", hitChest: "hitBody" };
  var MASK_CODE = { full: 0, upper: 1, kick: 2, torso: 3 }, MASK_NAME = ["full", "upper", "kick", "torso"];
  var TORSO_MASK = { Spine: 1, Spine1: 1, Spine2: 1, Neck: 1, Head: 1 };
  Avatar.prototype.clipByName = function (name) {
    var B = this.base, M = B.mocap, C = B.clips;
    if (M && M.clips[name]) return M.clips[name];
    if (M && CLIP_ALIAS[name] && M.clips[CLIP_ALIAS[name]]) return M.clips[CLIP_ALIAS[name]];
    return C && C.clips[name] ? C.clips[name] : null;
  };
  Avatar.prototype.slot = function (mask) { var L = null; this.layers.forEach(function (l) { if (l.mask === mask) L = l; }); return L; };
  Avatar.prototype.clip = function (name, weight, fade, opts) {
    opts = opts || {};
    var c = typeof name === "string" ? this.clipByName(name) : name; if (!c) return null;
    var mask = opts.mask || "full", L = this.slot(mask);
    if (mask === "kick" && !L) { var U = this.slot("upper"); if (U && U.w > 0.05) { U.target = 0; U.rate = 1 / 0.08; } }
    if (weight <= 0) { if (L) { L.target = 0; L.rate = 1 / Math.max(0.05, fade || 0.3); } return null; }
    var a = this.actor, start = opts.t || 0, mir = !!opts.mirror;
    if (L && L.clip === c && !opts.restart && L.mirror === mir) { L.target = weight; L.rate = 1 / Math.max(0.05, fade || 0.3); return L; }
    if (!L) { L = { w: 0 }; this.layers.push(L); }
    else if (L.w > 0.05 && L.clip) L.prev = { clip: L.clip, t: L.t, w: L.w, anchor: L.anchor, mirror: L.mirror, mask: L.mask };
    L.clip = c; L.t = start; L.speed = opts.speed || 1; L.speed2 = opts.speed2 || L.speed; L.target = weight; L.rate = 1 / Math.max(0.03, fade || 0.3);
    L.mask = mask; L.stop = opts.stop != null ? opts.stop : null; L.loop = opts.loop != null ? opts.loop : c.loop; L.mirror = mir;
    L.ik = opts.ik != null ? opts.ik : -1; L.sup = opts.sup != null ? opts.sup : -1; L.autoOff = opts.autoOff != null ? opts.autoOff : null;
    var anchor = L.anchor = { x: 0, z: 0, yaw: a ? a.yaw : 0 };
    if (mask === "full" && a) {
      var d = this.clipPelvis(c, start, _v1, mir), cy = Math.cos(anchor.yaw), sy = Math.sin(anchor.yaw), h = this.hipsY, hp = this.Wp[this.bi.Hips];
      anchor.x = hp.x - (d.x * cy + d.z * sy) * h; anchor.z = hp.z - (-d.x * sy + d.z * cy) * h;
    }
    return L;
  };
  function frameAt(c, t) { return clamp(t * c.fps, 0, c.frames - 1); }
  Avatar.prototype.clipPelvis = function (c, t, out, mir) {
    var f = frameAt(c, t), f0 = Math.floor(f), f1 = Math.min(c.frames - 1, f0 + 1), a = f - f0, D = c.data, per = c.per;
    out.set(lerp(D[f0 * per], D[f1 * per], a) / 8192, lerp(D[f0 * per + 1], D[f1 * per + 1], a) / 8192, lerp(D[f0 * per + 2], D[f1 * per + 2], a) / 8192);
    if (mir) out.x = -out.x;
    return out;
  };
  Avatar.prototype.clipQuat = function (c, t, j, out, mir) {
    if (mir) j = this.clipMirror[c.set][j];
    var f = frameAt(c, t), f0 = Math.floor(f), f1 = Math.min(c.frames - 1, f0 + 1), a = f - f0, D = c.data, per = c.per;
    var o0 = f0 * per + 3 + j * 4, o1 = f1 * per + 3 + j * 4;
    out.set(D[o0] / 32767, D[o0 + 1] / 32767, D[o0 + 2] / 32767, D[o0 + 3] / 32767).normalize();
    if (a > 0) { _q4.set(D[o1] / 32767, D[o1 + 1] / 32767, D[o1 + 2] / 32767, D[o1 + 3] / 32767).normalize(); out.slerp(_q4, a); }
    if (mir) { out.y = -out.y; out.z = -out.z; }
    return out;
  };
  /* Contact envelope: the strike's effector is pulled onto the driver's target from late wind-up to just
     past contact, then let go through the recovery. */
  function ikEnv(L) {
    var c = L.clip; if (c.hit == null) return 0;
    var go = c.go || 0, hit = c.hit, back = c.back || hit + 0.3, t = L.t;
    if (t < hit) return smooth(go + 0.3 * (hit - go), hit, t);
    return 1 - smooth(hit + 0.05, hit + 0.6 * (back - hit), t);
  }

  /* Live update: watch the actor's mode, reactions and actions, advance clip layers. Not called in replays. */
  Avatar.prototype.tick = function (dt) {
    var a = this.actor; if (!a) return;
    var m = a.mode;
    if (m !== this.lastMode) { this.onMode(this.lastMode, m); this.lastMode = m; }
    var r = a.react;
    if (r && r !== this.lastReact) this.onReact(r);
    this.lastReact = r;
    var act = a.act;
    if (act && act !== this.lastAct) this.onAct(act);
    this.lastAct = act;
    for (var i = this.layers.length - 1; i >= 0; i--) {
      var L = this.layers[i], c = L.clip;
      var sp = c.hit != null && L.t >= c.hit ? L.speed2 : L.speed;
      L.t += dt * sp;
      if (L.loop) { if (L.t > c.dur) L.t -= c.dur; }
      else if (L.t > c.dur) L.t = c.dur;
      if (L.stop != null && L.t > L.stop) L.t = L.stop;
      if (L.w < L.target) L.w = Math.min(L.target, L.w + dt * L.rate); else if (L.w > L.target) L.w = Math.max(L.target, L.w - dt * L.rate);
      if (L.prev) { L.prev.w -= dt * Math.max(L.rate, 3) * 1.5; L.prev.t = Math.min(L.prev.clip.dur, L.prev.t + dt); if (L.prev.w <= 0) L.prev = null; }
      if (L.autoOff != null) { L.autoOff -= dt; if (L.autoOff <= 0) { L.target = 0; L.rate = Math.min(L.rate, 1 / 0.22); L.autoOff = null; } }
      if (L.w <= 0 && L.target <= 0 && !L.prev) this.layers.splice(i, 1);
    }
    this.tickFace(dt, a);
    var standing = m === "stand" || m === "clinch";
    this.idleW += ((standing && !a.act ? 0.8 : (standing ? 0.35 : 0)) - this.idleW) * Math.min(1, dt * 3);
    this.idleT += dt * (0.55 + 0.45 * (a.bounce || 1)) * (a.prof && a.prof.bounce ? a.prof.bounce.rate : 1);
  };
  /* Blinks, flinches, KO and knockdown faces. */
  Avatar.prototype.tickFace = function (dt, a) {
    var F = this.face || (this.face = { blink: 0, jaw: 0, brow: 0, next: 1 + Math.random() * 3, bt: -1, flinch: 0 });
    F.next -= dt;
    if (F.next <= 0) { F.bt = 0; F.next = 2.2 + Math.random() * 3.5; }
    var blink = 0;
    if (F.bt >= 0) { F.bt += dt; blink = Math.sin(Math.min(1, F.bt / 0.16) * Math.PI); if (F.bt > 0.16) F.bt = -1; }
    F.flinch = Math.max(0, F.flinch - dt * 3.5);
    var m = a.mode, eyes = 0, jaw = 0, brow = 0.15;
    if (m === "ko") { eyes = 0.85; jaw = 0.35; brow = 0; }
    else if (m === "down") { eyes = 0.55; jaw = 0.25; brow = 0; }
    else if (m === "celebrate") { jaw = 0.25 + 0.25 * Math.max(0, Math.sin(this.idleT * 3.1)); brow = 0; }
    else if (a.react && a.react.type === "wobble") { eyes = 0.45; jaw = 0.18; brow = 0; }
    else if (a.act && (a.act.type === "punch" || a.act.type === "kick" || a.act.type === "shoot")) brow = 0.55;
    eyes = Math.max(eyes, blink, F.flinch * 0.9); brow = Math.max(brow, F.flinch * 0.7);
    var k = Math.min(1, dt * 10);
    F.blink += (eyes - F.blink) * (blink > 0 || F.flinch > 0 ? 1 : k); F.jaw += (jaw - F.jaw) * k * 0.5; F.brow += (brow - F.brow) * k;
  };
  Avatar.prototype.applyFace = function () {
    var F = this.face; if (!F || !this.morphMeshes) return;
    for (var i = 0; i < this.morphMeshes.length; i++) {
      var inf = this.morphMeshes[i].morphTargetInfluences; if (!inf) continue;
      inf[0] = F.blink; inf[1] = F.jaw; inf[2] = F.brow;
    }
  };
  /* Strikes: the matching fight clip, timed so its contact frame lands on the driver's contact, mirrored
     for the other hand or stance; the striking hand or foot is pulled onto the target near contact. */
  var STRIKE_CLIP = { jab: "jab", cross: "cross", hook: "hook", overhand: "overhand", upper: "upper", bodyhook: "bodyhook", bodystraight: "bodycross", short: "rhook",
    elbow: "elbow", shortbody: "bodycross", calf: "lowkick", inside: "lowkick", bodykick: "midkick", headkick: "highkick", knee: "knee", kneehead: "knee" };
  Avatar.prototype.onAct = function (act) {
    if (!this.base.mocap || this.cfg.ref || this.opts.noMocap) return;
    var mv = act.move, c, side, frac;
    if (act.type === "shoot") {
      // double-leg entry: level change, penetration step and drive from the Mixamo takedown, on the upper body
      var cs = this.clipByName("tdShot"); if (!cs) return;
      var Ls = this.clip(cs, 0.85, 0.08, { mask: "upper", t: 0.05, speed: clamp(1.25 / Math.max(0.3, act.dur), 1, 2.6), restart: true, mirror: this.actor && this.actor.stance < 0 });
      if (Ls) Ls.autoOff = act.dur + 0.15;
      return;
    }
    if ((act.type === "gnp" || act.type === "hammer") && this.actor && this.actor.mode === "top") {
      // ground and pound: the Mixamo top-position torso drive under the driver's arms (which aim the shots)
      var Lg = this.clip("gnp", 0.75, 0.12, { mask: "torso", t: Math.random() * 1.5, loop: true });
      if (Lg) Lg.autoOff = act.dur + 0.25;
      return;
    }
    if (act.type === "punch") { c = this.clipByName(STRIKE_CLIP[mv] || (act.hand === "lead" ? "jab" : "cross")); side = act.hi; frac = 0.42; }
    else if (act.type === "kick") {
      // some body kicks come out as a teep (push kick): more often for in-and-out, range fighters
      var pf = this.actor && this.actor.prof, teepP = 0.2 + 0.35 * (pf && pf.foot ? pf.foot.inout : 0.3);
      var nm = mv === "bodykick" && this.clipByName("teep") && Math.random() < teepP ? "teep" : (STRIKE_CLIP[mv] || "midkick");
      c = this.clipByName(nm); side = act.li; frac = 0.48;
    }
    else return;
    if (!c || c.hit == null) return;
    var clipSide = c.eff && c.eff.charAt(0) === "l" ? 0 : 1, mir = clipSide !== side;
    var wind = Math.max(0.05, frac * act.dur), rec = Math.max(0.08, (1 - frac) * act.dur);
    var s1 = clamp((c.hit - c.go) / wind, 0.6, 2.6), s2 = clamp(((c.back || c.hit + 0.3) - c.hit) / (rec + 0.12), 0.8, 3.2);
    var kick = act.type === "kick", knee = /k$/.test(c.eff || "");
    var L = this.clip(c, 1, 0.05, { mask: kick ? "kick" : "upper", t: c.go, speed: s1, speed2: s2, restart: true, mirror: mir,
      ik: kick ? (knee ? -1 : 2 + side) : side, sup: kick ? 2 + (1 - side) : -1 });
    if (L) L.autoOff = wind + rec + 0.06;
  };
  /* Hit reactions on the upper body (the driver's springs still snap the head). side 0 = his left. */
  Avatar.prototype.hitClip = function (move, p, side) {
    if (!this.base.mocap || this.cfg.ref || this.opts.noMocap) return;
    var a = this.actor; if (!a || (a.mode !== "stand" && a.mode !== "clinch")) return;
    if (a.act && (a.act.type === "punch" || a.act.type === "kick")) return;
    var nm, mir = false;
    if (move === "upper" || move === "kneehead") nm = "hitUpper";
    else if (HEAD_MOVES[move]) {
      if (p >= 1.6) { nm = "hitBig"; mir = side === 0; }
      else if (move === "hook" || move === "elbow" || move === "headkick" || move === "overhand" || move === "gnp") { nm = "hitL"; mir = side === 1; }
      else if (p > 1.1) { nm = "hitMed"; mir = side === 0; }
      else { nm = "hitLight"; mir = side === 1; }
    } else if (move === "calf" || move === "inside") return;
    else nm = p >= 1.6 ? "hitLiver" : "hitBody";
    var c = this.clipByName(nm); if (!c) return;
    var start = { hitLight: 0.15, hitMed: 0.22, hitBig: 0.45, hitL: 0.3, hitUpper: 0.2, hitBody: 0.3, hitLiver: 0.3 }[nm] || 0;
    var L = this.clip(c, clamp(0.45 + 0.28 * p, 0.45, 0.95), 0.06, { mask: "upper", t: start, speed: 1.15, restart: true, mirror: mir });
    if (L) L.autoOff = Math.max(0.3, (c.dur - start) / 1.15 - 0.3);
  };
  Avatar.prototype.onMode = function (from, to) {
    var M = this.base.mocap, hl = this.lastHitInfo || {}, nm, mir;
    if (!this.base.clips && !M) return;
    if (to === "ko") {
      mir = Math.random() < 0.5;
      if (M) {
        if (hl.body) nm = "koKnees";
        else if (hl.move === "upper" || hl.move === "kneehead") nm = "koBack";
        else if (hl.move === "hook" || hl.move === "headkick" || hl.move === "elbow") { nm = hl.side === 0 ? "koRight" : "koLeft"; mir = false; }
        else nm = ["koBack", "koFallBack", "koFace", "koFwd"][Math.floor(Math.random() * 4)];
      } else nm = (this.app.slug || "x").length % 3 === 0 ? "fallFwd" : "fallBack2";
      // start where the fall begins (the clips open with a stagger the show has no time for)
      var KO_T0 = { koBack: 1.5, koFwd: 1.7, koFallBack: 0.2, koFace: 0, koKnees: 1.0, koLeft: 0.9, koRight: 0.9 };
      this.clip(nm, 1, 0.12, { restart: true, speed: M ? 1.25 : 1.4, mirror: mir, t: M ? (KO_T0[nm] || 0) : 0 });
    } else if (to === "down") {
      this.clip(M ? "kdSit" : "fallBack2", 1, 0.1, { restart: true, speed: M ? 1.3 : 1.4, mirror: Math.random() < 0.5, t: M ? 0.1 : 0 });
    } else if (to === "stand" && from === "down") {
      var L0 = this.clip("getUp", 1, 0.08, { restart: true, speed: M ? 1.7 : 1.55, t: 0.05 });
      if (L0) L0.autoOff = (L0.clip.dur - L0.t) / L0.speed - 0.3;
    } else if (to === "celebrate") this.clip(M ? (M.clips.victory2 ? "victory2" : "victoryIdle") : "fistPump", 0.85, 0.5, { mask: "upper", loop: true });
    else if (to === "sit" && M) this.clip("sitIdle", 0.55, 0.6, { mask: "torso", loop: true });
    else if (to === "refstop" && M) { var Lr = this.clip("refStop", 0.7, 0.2, { mask: "upper", restart: true, speed: 1.2 }); if (Lr) Lr.autoOff = 1.1; }
    else if (to === "raised" && M && this.actor && this.actor.armTarget === 0) this.clip(M.clips.defeat2 ? "defeat2" : "disappointed", 0.5, 0.8, { mask: "torso", t: 0.3 });
    else {
      this.layers.forEach(function (L) { if (L.mask === "upper" || L.mask === "torso" || (L.mask === "full" && L.clip && L.clip.name !== "getUp")) { L.target = 0; L.rate = 1 / 0.45; } });
    }
    if (to === "walk" && (from === "ko" || from === "down" || from === null)) this.layers.forEach(function (l) { l.target = 0; l.rate = 1 / 0.3; });
  };
  Avatar.prototype.onReact = function (r) {
    if (this.cfg.ref || this.opts.noMocap || !this.base.mocap) return;
    var a = this.actor, mir = !!(a && a.stance < 0), L;
    if (r.type === "wobble") { L = this.clip("dizzy", 0.55, 0.15, { mask: "upper", t: 0.3, restart: true }); if (L) L.autoOff = r.dur * 0.8; }
    else if (r.type === "block" || r.type === "defend") {
      // gloves up to the brow (Mixamo Block), over the driver's tightened guard
      L = this.clip("block", 0.7, 0.06, { mask: "upper", t: 0.62, speed: 1.5, restart: true, mirror: mir }); if (L) L.autoOff = Math.max(0.2, r.dur * 0.85);
    } else if (r.type === "slip" || r.type === "duck") {
      // upper-body slip to the side the driver leans (dir +1 his left)
      var left = (r.dir || 1) * (a ? a.stance : 1) > 0;
      L = this.clip(left ? "slipL" : "slipR", r.type === "duck" ? 0.45 : 0.6, 0.06, { mask: "upper", t: 0.45, speed: 1.7, restart: true }); if (L) L.autoOff = Math.max(0.2, r.dur * 0.8);
    }
  };

  /* Pull a limb's end onto the driver's target (hand: glove centre; foot: ankle) by weight w, bending
     toward where the clip has the elbow or knee. */
  Avatar.prototype.ikPull = function (li, w) {
    var Lm = this.limbs[li], W = this.W, Wp = this.Wp, drv = this.rig, arm = Lm.L.arm;
    this.fk(Lm.il); this.fk(Lm.ie);
    var save = this._ikSave || (this._ikSave = [new Q(), new Q(), new Q(), new Q()]);
    save[0].copy(W[Lm.iu]); save[1].copy(W[Lm.il]); save[2].copy(W[Lm.ie]);
    var toe = arm ? -1 : this.bi[Lm.L.left ? "LeftToeBase" : "RightToeBase"]; if (toe >= 0) save[3].copy(W[toe]);
    var eff = this._ikE || (this._ikE = new V3()), tgt = this._ikT || (this._ikT = new V3()), pole = this._ikP || (this._ikP = new V3());
    eff.copy(Wp[Lm.ie]); pole.copy(Wp[Lm.il]);
    if (arm) { eff.addScaledVector(_v1.copy(Wp[Lm.ie]).sub(Wp[Lm.il]).normalize(), Lm.fist); drv.handPos(Lm.L.left, tgt); }
    else (Lm.L.left ? drv.legL : drv.legR).foot.getWorldPosition(tgt);
    tgt.lerp(eff, 1 - w);
    this.solveLimb(Lm, Wp[Lm.iu], tgt, pole);
    var s = smooth(0, 0.35, w);
    if (s < 0.999) {
      W[Lm.iu].copy(save[0].slerp(W[Lm.iu], s)); W[Lm.il].copy(save[1].slerp(W[Lm.il], s)); W[Lm.ie].copy(save[2].slerp(W[Lm.ie], s));
      if (toe >= 0) W[toe].copy(save[3].slerp(W[toe], s));
      this.fk(Lm.il); this.fk(Lm.ie); if (toe >= 0) this.fk(toe);
    }
  };

  /* Pose the skinned skeleton from the driver (plus clip layers). Called every rendered frame. */
  Avatar.prototype.sync = function () {
    var rig = this.rig; if (!rig) return;
    var W = this.W, Wp = this.Wp, Rq = this.restQ, Lp = this.restLocalP, par = this.parent, bi = this.bi, i, k;
    // driver segment world rotations
    var tq = this._tq || (this._tq = [new Q(), new Q(), new Q(), new Q(), new Q(), new Q(), new Q(), new Q()]), tv = this._tv || (this._tv = [new V3(), new V3(), new V3()]);
    var qP = rig.pelvis.getWorldQuaternion(_q1), qS = rig.spine.getWorldQuaternion(tq[0]), qC = rig.chest.getWorldQuaternion(tq[1]);
    var qN = rig.neck.getWorldQuaternion(tq[2]), qH = rig.head.getWorldQuaternion(tq[3]);
    W[bi.Hips].copy(qP).multiply(Rq[bi.Hips]);
    W[bi.Spine].copy(qS).multiply(Rq[bi.Spine]);
    W[bi.Spine1].copy(qS).multiply(Rq[bi.Spine1]);
    W[bi.Spine2].copy(qC).multiply(Rq[bi.Spine2]);
    W[bi.Neck].copy(qN).multiply(Rq[bi.Neck]);
    W[bi.Head].copy(qH).multiply(Rq[bi.Head]);
    W[bi.LeftShoulder].copy(qC).multiply(Rq[bi.LeftShoulder]);
    W[bi.RightShoulder].copy(qC).multiply(Rq[bi.RightShoulder]);
    rig.pelvis.getWorldPosition(Wp[bi.Hips]);
    // idle layer (additive on the torso and head): the fight-idle bounce from the mocap set, else the breathing idle
    var Mo = this.base.mocap, Cl = this.base.clips, yaw = this.actor ? this.actor.yaw : 0, qy = _q3.setFromAxisAngle(YAX, yaw), qyi = tq[4].copy(qy).invert();
    var ic = Mo && Mo.clips.fightIdle ? Mo.clips.fightIdle : (Cl ? Cl.clips.idle : null);
    if (ic && this.idleW > 0.01) {
      var t = this.idleT % ic.dur, amp = this.actor && this.actor.prof && this.actor.prof.bounce ? 0.45 + 0.55 * this.actor.prof.bounce.amp : 1;
      for (var nm in IDLE_MASK) {
        var j = ic.bones.indexOf(nm); if (j < 0) continue;
        this.clipQuat(ic, t, j, _q2); this.clipQuat(ic, 0, j, tq[5]).invert(); _q2.multiply(tq[5]);
        _q2.premultiply(qy).multiply(qyi);
        var dq = tq[6].identity().slerp(_q2, this.idleW * IDLE_MASK[nm] * amp * (ic.set ? 0.7 : 1));
        W[bi[nm]].premultiply(dq);
      }
    }
    // clip layers on the torso
    var self = this, layers = this.layers, clipW = 0, hasFull = false;
    function layerFrame(L) {
      var qa = new Q().setFromAxisAngle(YAX, L.anchor.yaw);
      if (L.mask !== "upper" && L.mask !== "torso") return qa;
      // upper-body layers ride on the driver's pelvis: rel * clip, rel = W_hips * inverse(clip hips)
      var c = L.clip, jh = c.bones.indexOf("Hips"), ch = self.clipQuat(c, L.t, jh, new Q(), L.mirror).premultiply(qa).multiply(self.clipRefs[c.set][jh]);
      return W[bi.Hips].clone().multiply(ch.invert()).multiply(qa);
    }
    function inMask(L, nm2) { return L.mask === "upper" ? UPPER_MASK[nm2] : (L.mask === "torso" ? TORSO_MASK[nm2] : true); }
    function layerTorso(L, w) {
      var c = L.clip, cy = Math.cos(L.anchor.yaw), sy = Math.sin(L.anchor.yaw), qa = layerFrame(L), refs = self.clipRefs[c.set];
      L._qa = qa;
      for (var jj = 0; jj < c.bones.length; jj++) {
        var nm2 = c.bones[jj], kk = bi[nm2];
        if (!inMask(L, nm2) || LIMB_BONE[nm2]) continue;
        self.clipQuat(c, L.t, jj, _q2, L.mirror).premultiply(qa).multiply(refs[jj]);
        // kicks: the Mixamo kicks fold the trunk far forward; keep about half of the driver's upright,
        // slightly leaning-back trunk so a calf kick does not bow the head to the waist
        W[kk].slerp(_q2, L.mask === "kick" ? w * (nm2 === "Hips" ? 0.7 : 0.5) : w);
      }
      var h = self.hipsY;
      if (L.mask === "full") {
        var d = self.clipPelvis(c, L.t, _v1, L.mirror);
        _v2.set(L.anchor.x + (d.x * cy + d.z * sy) * h, h * (1 + d.y), L.anchor.z + (-d.x * sy + d.z * cy) * h);
        Wp[bi.Hips].lerp(_v2, w);
      } else if (L.mask === "kick") {
        var d1 = self.clipPelvis(c, L.t, _v1, L.mirror).y, d0 = self.clipPelvis(c, c.go || 0, _v2, L.mirror).y;
        Wp[bi.Hips].y += (d1 - d0) * h * w * 0.8;
      }
    }
    if (Mo || Cl) layers.forEach(function (L) {
      if (L.prev && L.prev.w > 0) layerTorso(L.prev, clamp01(L.prev.w));
      if (L.w > 0) { layerTorso(L, clamp01(L.w)); if (L.mask === "full") { hasFull = true; clipW = Math.max(clipW, L.w); } }
    });
    this.clipW = clipW;
    // forward kinematics for the torso, then limbs
    this.fk(bi.Spine); this.fk(bi.Spine1); this.fk(bi.Spine2); this.fk(bi.Neck); this.fk(bi.Head); this.fk(bi.LeftShoulder); this.fk(bi.RightShoulder);
    this.fk(bi.LeftUpLeg); this.fk(bi.RightUpLeg); this.fk(bi.LeftArm); this.fk(bi.RightArm);
    // shoulders: shrug when the upper arm is raised; roll the shoulders forward around the chin when the
    // hands come up in front (the guard), which also spreads the bend so the deltoid does not crease
    var prof = this.actor && this.actor.prof, roll = prof && prof.guard ? prof.guard.shoulderRoll : 0.5;
    var cUp = tv[2].set(0, 1, 0).applyQuaternion(qC), cFw = _v6.set(0, 0, 1).applyQuaternion(qC);
    for (i = 0; i < 2; i++) {
      var Ls = this.limbs[i], ks = i === 0 ? bi.LeftShoulder : bi.RightShoulder;
      var hand = rig.handPos(i === 0, _v3), sp = Wp[Ls.iu], reachL = Ls.l1 + Ls.l2;
      var up = clamp((hand.y - sp.y) / reachL, -1, 1), fwd = clamp(_v4.copy(hand).sub(sp).dot(cFw) / reachL, -1, 1);
      var touched = false;
      if (up > 0.15) {
        var ax = _v4.copy(Wp[Ls.iu]).sub(Wp[ks]).normalize();
        var axis = _v5.crossVectors(ax, YAX).normalize();
        W[ks].premultiply(tq[7].setFromAxisAngle(axis, (up - 0.15) * 0.42)); touched = true;
      }
      var g = clamp01((fwd - 0.05) / 0.45) * clamp01((up + 0.55) / 0.5);
      if (g > 0.01 && !this.cfg.ref) {
        var pa = (0.1 + 0.2 * roll) * g;
        W[ks].premultiply(tq[7].setFromAxisAngle(cUp, i === 0 ? -pa : pa));
        var ax2 = _v4.copy(Wp[Ls.iu]).sub(Wp[ks]).normalize();
        W[ks].premultiply(tq[7].setFromAxisAngle(_v5.crossVectors(ax2, cUp).normalize(), 0.06 * g));
        touched = true;
      }
      if (touched) this.fk(Ls.iu);
    }
    var drv = this.rig, el = _v5;
    for (i = 0; i < 4; i++) {
      var L = this.limbs[i], s = Wp[L.iu], tgt, pole;
      if (L.L.arm) {
        var A = i === 0 ? drv.armL : drv.armR;
        tgt = drv.handPos(i === 0, tv[0]);
        el = A.el.getWorldPosition(tv[1]);
      } else {
        var G = i === 2 ? drv.legL : drv.legR;
        tgt = G.foot.getWorldPosition(tv[0]);
        el = G.knee.getWorldPosition(tv[1]);
      }
      this.solveLimb(L, s, tgt, el);
    }
    // clip layers on the limbs (after IK so they can override it), then contact and support IK
    if (Mo || Cl) {
      layers.forEach(function (L) {
        function limbsFrom(LL, w) {
          var qa = LL._qa || new Q().setFromAxisAngle(YAX, LL.anchor.yaw), c = LL.clip, refs = self.clipRefs[c.set];
          for (var jj = 0; jj < c.bones.length; jj++) {
            var nm2 = c.bones[jj]; if (!LIMB_BONE[nm2] || !inMask(LL, nm2)) continue;
            self.clipQuat(c, LL.t, jj, _q2, LL.mirror).premultiply(qa).multiply(refs[jj]);
            W[bi[nm2]].slerp(_q2, w);
          }
        }
        if (L.prev && L.prev.w > 0) limbsFrom(L.prev, clamp01(L.prev.w));
        if (L.w > 0) limbsFrom(L, clamp01(L.w));
      });
      this.fkAll();
      layers.forEach(function (L) {
        if (L.w <= 0.01) return;
        if (L.sup >= 0) self.ikPull(L.sup, clamp01(L.w));
        if (L.ik >= 0) { var e = ikEnv(L) * clamp01(L.w); if (e > 0.01) self.ikPull(L.ik, e); }
      });
    }
    // fingers and face
    this.fingers();
    this.applyFace();
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
      var lift = 0, chk = [bi.Head, bi.LeftHand, bi.RightHand, bi.LeftFoot, bi.RightFoot, bi.LeftToeBase, bi.RightToeBase, bi.Hips, bi.LeftLeg, bi.RightLeg, bi.Spine2];
      var rad = [0.1, 0.035, 0.035, this.dims.ankle, this.dims.ankle, 0.025, 0.025, 0.09, 0.06, 0.06, 0.1];
      for (k = 0; k < chk.length; k++) lift = Math.max(lift, rad[k] * 0.8 - Wp[chk[k]].y);
      if (lift > 0) bones[0].position.y += lift * clamp01(clipW);
    }
    this.group.updateMatrixWorld(true);
  };
  var _qlo = new Q();
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
    var qlo = basisQuat(_qlo, lo, pole);
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

  /* Replay snapshots: clip layer state appended to the driver's node block (see the Rig patch below).
     [0] idleT [1] idleW [2..4] face, then up to 4 layers x 10: clip id+1, t, w, anchor x, z, yaw,
     speed (+100 while fading out), mask code + 10*mirror, (ik+1) + 10*(sup+1), recovery speed. */
  var SNAP_LAYERS = 4, SNAP_L = 10, EXTRA = 5 + SNAP_LAYERS * SNAP_L;
  Avatar.prototype.snapshot = function (buf, o) {
    var Ls = this.layers;
    buf[o] = this.idleT; buf[o + 1] = this.idleW;
    var F = this.face; buf[o + 2] = F ? F.blink : 0; buf[o + 3] = F ? F.jaw : 0; buf[o + 4] = F ? F.brow : 0;
    for (var i = 0; i < SNAP_LAYERS; i++) {
      var L = Ls[i], b = o + 5 + i * SNAP_L;
      if (L && L.clip) {
        buf[b] = L.clip.id + 1; buf[b + 1] = L.t; buf[b + 2] = L.w; buf[b + 3] = L.anchor.x; buf[b + 4] = L.anchor.z; buf[b + 5] = L.anchor.yaw;
        buf[b + 6] = L.speed + (L.target > 0 ? 0 : 100); buf[b + 7] = (MASK_CODE[L.mask] || 0) + (L.mirror ? 10 : 0); buf[b + 8] = (L.ik + 1) + 10 * (L.sup + 1); buf[b + 9] = L.speed2 || L.speed;
      } else for (var k = 0; k < SNAP_L; k++) buf[b + k] = 0;
    }
  };
  /* Live state around an instant replay: restore() rebuilds layers from snapshots (no fades or timers),
     so the live layers are kept aside and put back when the replay ends. */
  Avatar.prototype.stashLive = function () {
    this._live = { layers: this.layers.map(function (L) { var c = Object.assign({}, L); c.anchor = Object.assign({}, L.anchor); if (L.prev) c.prev = Object.assign({}, L.prev); return c; }),
      idleT: this.idleT, idleW: this.idleW, face: this.face ? Object.assign({}, this.face) : null };
  };
  Avatar.prototype.unstashLive = function () {
    var S = this._live; if (!S) return;
    this.layers = S.layers; this.idleT = S.idleT; this.idleW = S.idleW; if (S.face) this.face = S.face; this._live = null;
  };
  Avatar.prototype.restore = function (A, oa, B, ob, f) {
    var list = this.base.clipList; if (!list || !list.length) return;
    var src = f < 0.5 ? A : B, o = f < 0.5 ? oa : ob;
    this.idleT = lerp(A[oa], B[ob], f); if (Math.abs(B[ob] - A[oa]) > 0.5) this.idleT = src[o];
    this.idleW = lerp(A[oa + 1], B[ob + 1], f);
    if (this.face) { this.face.blink = lerp(A[oa + 2], B[ob + 2], f); this.face.jaw = lerp(A[oa + 3], B[ob + 3], f); this.face.brow = lerp(A[oa + 4], B[ob + 4], f); }
    var layers = [];
    for (var i = 0; i < SNAP_LAYERS; i++) {
      var b = o + 5 + i * SNAP_L, id = src[b];
      if (!id || !list[id - 1]) continue;
      var c = list[id - 1], sp = src[b + 6], fading = sp >= 50, mc = src[b + 7], ikc = src[b + 8];
      var ba = oa + 5 + i * SNAP_L, bb = ob + 5 + i * SNAP_L, t = src[b + 1], w = src[b + 2];
      if (A[ba] === B[bb] && Math.abs(B[bb + 1] - A[ba + 1]) < 0.5) { t = lerp(A[ba + 1], B[bb + 1], f); w = lerp(A[ba + 2], B[bb + 2], f); }
      layers.push({ clip: c, t: t, w: w, target: fading ? 0 : w, rate: 1 / 0.4, mask: MASK_NAME[mc % 10] || "full", mirror: mc >= 10, loop: c.loop, stop: null,
        anchor: { x: src[b + 3], z: src[b + 4], yaw: src[b + 5] }, speed: fading ? sp - 100 : sp, speed2: src[b + 9], ik: (ikc % 10) - 1, sup: Math.floor(ikc / 10) - 1 });
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
  var DEFAULTS = {};   // build options for every avatar (dev pages: proxyShorts, proxyGloves)
  function build(appearance, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
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
    appearanceFor: appearanceFor, configFor: configFor, dbFromPage: dbFromPage, REFEREE: REFEREE, Avatar: Avatar, defaults: DEFAULTS,
    webgl2: function (renderer) { return !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2); }
  };
})(typeof window !== "undefined" ? window : globalThis);
