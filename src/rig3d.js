/* Articulated fighter rig: primitive body parts on a joint hierarchy, two-bone IK for arms and legs. */
(function (root) {
  "use strict";
  var T = root.THREE;
  if (!T) return;
  var V3 = T.Vector3, Q = T.Quaternion;
  var _a = new V3(), _d = new V3(), _p = new V3(), _e = new V3(), _t = new V3(), _x = new V3(), _y = new V3(), _z = new V3(), _yU = new V3(), _yL = new V3();
  var _q1 = new Q(), _q2 = new Q(), _qp = new Q(), _m = new T.Matrix4(), _eu = new T.Euler();

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  // Capsule-like solid of revolution, pivot at the top, extending down local -Y.
  function capsuleGeo(r1, r2, len, radial, cap) {
    radial = radial || 12; cap = cap || 4;
    var pts = [], i, a;
    for (i = 0; i <= cap; i++) { a = -Math.PI / 2 + (Math.PI / 2) * (i / cap); pts.push(new T.Vector2(Math.max(1e-4, r2 * Math.cos(a)), -len + r2 * Math.sin(a))); }
    for (i = 1; i <= cap; i++) { a = (Math.PI / 2) * (i / cap); pts.push(new T.Vector2(Math.max(1e-4, r1 * Math.cos(a)), r1 * Math.sin(a))); }
    return new T.LatheGeometry(pts, radial);
  }

  var SPH = null, HEMI = null, CYL = null;
  function shared() {
    if (!SPH) {
      SPH = new T.SphereGeometry(1, 18, 12);
      HEMI = new T.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.52);
      CYL = new T.CylinderGeometry(1, 1, 1, 14, 1, true);
    }
  }

  function mat(color, rough, metal) {
    return new T.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.6 : rough, metalness: metal || 0 });
  }

  /* spec: { H, build, skin, shorts, trim, glove, band, hair, beard, shirt, pants, shoes, ref } */
  function Rig(spec) {
    shared();
    var H = spec.H, bw = spec.build || 1;
    this.H = H; this.spec = spec;
    var skin = mat(spec.skin, 0.58);
    var M = this.mats = {
      skin: skin,
      shorts: mat(spec.shorts || 0x333333, 0.82),
      trim: mat(spec.trim || 0xf2f2f2, 0.7),
      glove: mat(spec.glove || 0x17191d, 0.4, 0.05),
      band: mat(spec.band || spec.shorts || 0x333333, 0.5),
      hair: mat(spec.hair || 0x241a14, 0.95),
      shirt: spec.shirt ? mat(spec.shirt, 0.85) : null,
      pants: spec.pants ? mat(spec.pants, 0.85) : null,
      shoes: spec.shoes ? mat(spec.shoes, 0.5) : null
    };
    var torsoM = M.shirt || skin, sleeveM = M.shirt || skin, hipM = M.pants || M.shorts, legM = M.pants || skin, footM = M.shoes || skin;
    var meshes = this.meshes = [];
    function add(parent, geo, material, x, y, z, sx, sy, sz) {
      var m = new T.Mesh(geo, material);
      m.position.set(x || 0, y || 0, z || 0);
      if (sx != null) m.scale.set(sx, sy, sz);
      m.castShadow = true; m.receiveShadow = false;
      parent.add(m); meshes.push(m); return m;
    }
    function ell(parent, material, x, y, z, rx, ry, rz) { return add(parent, SPH, material, x, y, z, rx, ry, rz); }
    function cap(parent, material, r1, r2, len, y0) { return add(parent, capsuleGeo(r1, r2, len), material, 0, y0 || 0, 0); }

    var g = this.root = new T.Group();
    var pelvis = this.pelvis = new T.Group(); g.add(pelvis);
    var spine = this.spine = new T.Group(); spine.position.y = 0.06 * H; pelvis.add(spine);
    var chest = this.chest = new T.Group(); chest.position.y = 0.16 * H; spine.add(chest);
    var neck = this.neck = new T.Group(); neck.position.y = 0.115 * H; chest.add(neck);
    var head = this.head = new T.Group(); head.position.y = 0.04 * H; neck.add(head);

    // torso
    ell(pelvis, hipM, 0, -0.004 * H, 0, 0.1 * H * bw, 0.072 * H, 0.076 * H);
    if (!spec.ref) ell(pelvis, M.trim, 0, 0.052 * H, 0.001 * H, 0.094 * H * bw, 0.014 * H, 0.071 * H);
    else ell(pelvis, M.shoes, 0, 0.05 * H, 0.001 * H, 0.093 * H * bw, 0.011 * H, 0.07 * H);
    ell(spine, torsoM, 0, 0.07 * H, 0.004 * H, 0.085 * H * bw, 0.1 * H, 0.062 * H);
    ell(chest, torsoM, 0, 0.032 * H, 0.002 * H, 0.112 * H * bw, 0.09 * H, 0.068 * H);
    ell(chest, torsoM, 0.047 * H * bw, 0.046 * H, 0.033 * H, 0.052 * H * bw, 0.034 * H, 0.033 * H);
    ell(chest, torsoM, -0.047 * H * bw, 0.046 * H, 0.033 * H, 0.052 * H * bw, 0.034 * H, 0.033 * H);
    ell(chest, torsoM, 0, 0.096 * H, -0.012 * H, 0.078 * H * bw, 0.034 * H, 0.044 * H);
    if (!spec.ref) { // a hint of abs and lats
      ell(spine, skin, 0, 0.1 * H, 0.028 * H, 0.052 * H * bw, 0.075 * H, 0.034 * H);
      ell(chest, skin, 0.07 * H * bw, -0.01 * H, -0.01 * H, 0.05 * H, 0.07 * H, 0.05 * H);
      ell(chest, skin, -0.07 * H * bw, -0.01 * H, -0.01 * H, 0.05 * H, 0.07 * H, 0.05 * H);
    }
    // neck and head
    cap(neck, skin, 0.034 * H, 0.036 * H, 0.06 * H, 0.06 * H);
    ell(head, skin, 0, 0.046 * H, 0.004 * H, 0.052 * H, 0.063 * H, 0.059 * H);
    ell(head, skin, 0, 0.017 * H, 0.025 * H, 0.04 * H, 0.03 * H, 0.036 * H);
    ell(head, skin, 0, 0.044 * H, 0.06 * H, 0.008 * H, 0.013 * H, 0.011 * H);
    ell(head, skin, 0.051 * H, 0.044 * H, -0.003 * H, 0.008 * H, 0.016 * H, 0.012 * H);
    ell(head, skin, -0.051 * H, 0.044 * H, -0.003 * H, 0.008 * H, 0.016 * H, 0.012 * H);
    if (spec.hair != null) {
      var hair = add(head, HEMI, M.hair, 0, 0.05 * H, -0.002 * H, 0.055 * H, 0.066 * H, 0.062 * H);
      hair.rotation.x = -0.32;
    }
    if (spec.beard) ell(head, M.hair, 0, 0.015 * H, 0.025 * H, 0.0425 * H, 0.031 * H, 0.0375 * H);

    // limbs
    this.ua = 0.17 * H; this.la = 0.18 * H; this.th = 0.2225 * H; this.sh = 0.2225 * H; this.ankleH = 0.045 * H;
    var self = this;
    function arm(side) {
      var s = new T.Group(); s.position.set(side * 0.115 * H * bw, 0.085 * H, 0); chest.add(s);
      var e = new T.Group(); e.position.y = -self.ua; s.add(e);
      ell(s, sleeveM, 0, -0.014 * H, 0, 0.041 * H * bw, 0.044 * H, 0.04 * H * bw);
      cap(s, sleeveM, 0.034 * H * bw, 0.028 * H * bw, self.ua);
      if (spec.shirt) cap(s, skin, 0.029 * H * bw, 0.027 * H * bw, self.ua * 0.45, -self.ua * 0.55);
      cap(e, skin, 0.029 * H, 0.022 * H, 0.14 * H);
      var hand;
      if (spec.ref) {
        hand = ell(e, skin, 0, -0.165 * H, 0.004 * H, 0.02 * H, 0.03 * H, 0.016 * H);
      } else {
        hand = ell(e, M.glove, 0, -0.176 * H, 0.002 * H, 0.031 * H, 0.035 * H, 0.031 * H);
        var band = add(e, CYL, M.band, 0, -0.146 * H, 0, 0.026 * H, 0.026 * H, 0.026 * H);
        band.castShadow = false;
      }
      return { sh: s, el: e, hand: hand, wq: new Q() };
    }
    function leg(side) {
      var h = new T.Group(); h.position.set(side * 0.056 * H * bw, -0.03 * H, 0); pelvis.add(h);
      var k = new T.Group(); k.position.y = -self.th; h.add(k);
      var f = new T.Group(); f.position.y = -self.sh; k.add(f);
      cap(h, legM, 0.056 * H * bw, 0.038 * H, self.th);
      if (!spec.pants) cap(h, M.shorts, 0.064 * H * bw, 0.058 * H * bw, 0.1 * H, 0.012 * H);
      cap(k, legM, 0.039 * H, 0.025 * H, self.sh);
      ell(k, legM, 0, -0.075 * H, -0.017 * H, 0.034 * H, 0.062 * H, 0.033 * H);
      ell(f, footM, 0, -0.02 * H, 0.03 * H, 0.03 * H, 0.022 * H, 0.072 * H);
      return { hip: h, knee: k, foot: f, wq: new Q() };
    }
    this.armL = arm(1); this.armR = arm(-1); this.legL = leg(1); this.legR = leg(-1);

    // nodes recorded for replays, in a fixed order
    this.nodes = [g, pelvis, spine, chest, neck, head,
      this.armL.sh, this.armL.el, this.armR.sh, this.armR.el,
      this.legL.hip, this.legL.knee, this.legL.foot, this.legR.hip, this.legR.knee, this.legR.foot];
  }

  /* Torso: root position/yaw plus pelvis, spine, chest, neck and head rotations. */
  Rig.prototype.setTorso = function (P) {
    var r = this.root;
    r.position.set(P.x, P.y || 0, P.z);
    r.rotation.set(P.rp || 0, P.yaw, P.rr || 0, "YXZ");
    this.pelvis.position.set(P.px || 0, P.py, P.pz || 0);
    this.pelvis.rotation.set(P.pp || 0, P.pyaw || 0, P.pr || 0, "YXZ");
    this.spine.rotation.set(P.sp || 0, P.sy || 0, P.sr || 0, "YXZ");
    this.chest.rotation.set(P.cp || 0, P.cy || 0, P.cr || 0, "YXZ");
    this.neck.rotation.set((P.hp || 0) * 0.4, (P.hy || 0) * 0.4, (P.hr || 0) * 0.3, "YXZ");
    this.head.rotation.set((P.hp || 0) * 0.6, (P.hy || 0) * 0.6, (P.hr || 0) * 0.7, "YXZ");
    r.updateMatrixWorld(true);
  };

  Rig.prototype.chestToWorld = function (x, y, z, out) {
    out.set(x, y, z);
    return this.chest.localToWorld(out);
  };
  Rig.prototype.chestDirToWorld = function (x, y, z, out) {
    out.set(x, y, z);
    this.chest.getWorldQuaternion(_qp);
    return out.applyQuaternion(_qp).normalize();
  };
  Rig.prototype.headPos = function (out) { out.set(0, 0.045 * this.H, 0.01 * this.H); return this.head.localToWorld(out); };
  Rig.prototype.bodyPos = function (out) { out.set(0, 0.0, 0.05 * this.H); return this.chest.localToWorld(out); };
  Rig.prototype.liverPos = function (out) { out.set(0, 0.05 * this.H, 0.05 * this.H); return this.spine.localToWorld(out); };
  Rig.prototype.handPos = function (left, out) { var a = left ? this.armL : this.armR; out.set(0, -this.la, 0); return a.el.localToWorld(out); };
  Rig.prototype.footPos = function (left, out) { var l = left ? this.legL : this.legR; out.set(0, 0, 0); return l.foot.localToWorld(out); };
  Rig.prototype.kneePos = function (left, out) { var l = left ? this.legL : this.legR; out.set(0, 0, 0); return l.knee.localToWorld(out); };

  function basisQuat(q, yAxis, zHint) {
    _y.copy(yAxis).normalize();
    _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
    if (_z.lengthSq() < 1e-9) { _z.set(0, 0, 1).addScaledVector(_y, -_y.z); if (_z.lengthSq() < 1e-9) _z.set(1, 0, 0); }
    _z.normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    return q.setFromRotationMatrix(_m);
  }

  /* Two-bone IK. upper/lower bones point down local -Y; pole is the world direction the middle joint bends toward. */
  Rig.prototype.solve = function (limb, upper, lower, l1, l2, target, pole) {
    _a.setFromMatrixPosition(upper.matrixWorld);
    _d.subVectors(target, _a);
    var dist = _d.length();
    if (dist < 1e-5) { _d.set(0, -1, 0); dist = 1; } else _d.multiplyScalar(1 / dist);
    var D = clamp(dist, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
    var cosA = clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_p.lengthSq() < 1e-9) { _p.set(0, 0, 1).addScaledVector(_d, -_d.z); if (_p.lengthSq() < 1e-9) _p.set(1, 0, 0); }
    _p.normalize();
    _e.copy(_a).addScaledVector(_d, l1 * cosA).addScaledVector(_p, l1 * sinA);
    _t.copy(_a).addScaledVector(_d, D);
    _yU.subVectors(_a, _e); _yL.subVectors(_e, _t);
    basisQuat(_q1, _yU, _p);
    basisQuat(_q2, _yL, _p);
    upper.parent.getWorldQuaternion(_qp);
    upper.quaternion.copy(_qp).invert().multiply(_q1);
    lower.quaternion.copy(_q1).invert().multiply(_q2);
    limb.wq.copy(_q2);
    upper.updateMatrixWorld(true);
  };

  Rig.prototype.arm = function (left, target, pole) {
    var a = left ? this.armL : this.armR;
    this.solve(a, a.sh, a.el, this.ua, this.la, target, pole);
  };
  Rig.prototype.leg = function (left, target, pole, footYaw, footPitch) {
    var l = left ? this.legL : this.legR;
    this.solve(l, l.hip, l.knee, this.th, this.sh, target, pole);
    _eu.set(footPitch || 0, footYaw, 0, "YXZ");
    _q1.setFromEuler(_eu);
    l.foot.quaternion.copy(l.wq).invert().multiply(_q1);
    l.foot.updateMatrixWorld(true);
  };

  /* Replay snapshots: positions and quaternions of every recorded node. */
  Rig.STRIDE = 16 * 7;
  Rig.prototype.snapshot = function (buf, off) {
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i], o = off + i * 7;
      buf[o] = n.position.x; buf[o + 1] = n.position.y; buf[o + 2] = n.position.z;
      buf[o + 3] = n.quaternion.x; buf[o + 4] = n.quaternion.y; buf[o + 5] = n.quaternion.z; buf[o + 6] = n.quaternion.w;
    }
  };
  Rig.prototype.restore = function (bufA, offA, bufB, offB, f) {
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i], a = offA + i * 7, b = offB + i * 7;
      n.position.set(bufA[a] + (bufB[b] - bufA[a]) * f, bufA[a + 1] + (bufB[b + 1] - bufA[a + 1]) * f, bufA[a + 2] + (bufB[b + 2] - bufA[a + 2]) * f);
      _q1.set(bufA[a + 3], bufA[a + 4], bufA[a + 5], bufA[a + 6]);
      _q2.set(bufB[b + 3], bufB[b + 4], bufB[b + 5], bufB[b + 6]);
      n.quaternion.copy(_q1).slerp(_q2, f);
    }
    this.root.updateMatrixWorld(true);
  };

  root.FightRig = { Rig: Rig, capsuleGeo: capsuleGeo, clamp: clamp };
})(typeof window !== "undefined" ? window : globalThis);
