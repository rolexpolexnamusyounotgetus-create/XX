/* The show: turns an animation script into a live 3D fight with footwork, strikes, takedowns,
   knockdowns, a referee, broadcast cameras and instant replays.

   STANCE PROFILES. Every fighter stands, moves and guards his own way. FightShow.stanceProfile(info)
   builds a profile from script.fighters[side] (slug, stance, height_in, reach_in, division,
   scouting {archetype, tags}, appearance.likeness): data-derived defaults from the archetype, tags,
   stance, ape index and division, then any explicit "stance" block in data/likeness/<slug>.json on top.
   Schema of that block (every field optional; numbers are unitless 0..1 unless noted):

     "stance": {
       "schema": "stance/1",
       "base": "orthodox" | "southpaw" | "switch",   // the stance he starts in (switch: starts orthodox)
       "width": 1.0,          // lateral foot spacing, multiple of a neutral stance (0.7 narrow .. 1.4 wide)
       "depth": 1.0,          // front-to-back foot spacing, multiple of neutral (0.7 .. 1.4)
       "crouch": 0.3,         // 0 tall and upright .. 1 deep, knees bent, hips low
       "lean": 0.2,           // torso lean: -0.5 leaning back .. 1 far forward over the lead knee
       "lead_foot_deg": 10,   // lead toes turned in toward the centre line, degrees (negative = turned out)
       "rear_foot_deg": 45,   // rear foot turned out, degrees (90 = fully side-on)
       "weight_front": 0.5,   // share of weight on the lead leg (0.35 back-weighted kicker .. 0.65 pressure)
       "bladed": 0.6,         // hips and shoulders: 0 square to the opponent .. 1 fully side-on
       "guard": {
         "style": "standard",   // label only: standard | high | long | low | shell | peekaboo | hand-fighting
         "height": 0.6,         // glove tops: 0 chest .. 0.5 nose bottom .. 0.65 under the eyes .. 1 brow (eyes stay visible)
         "lead_reach": 0.35,    // lead hand: 0 by the face .. 1 extended, pawing or measuring
         "lead_height": 0.6,    // lead glove height relative to the guard height (0 low .. 1 high)
         "lead_width": 0.0,     // lead glove: -1 across the centre line .. 1 out wide
         "rear_height": 0.6,    // rear glove: 0 chest .. 1 brow (0.5 = chin)
         "rear_tuck": 0.8,      // rear glove: 0 held out front .. 1 pinned to the cheek
         "elbow_flare": 0.2,    // 0 elbows on the ribs .. 1 winged out
         "shoulder_roll": 0.6   // shoulders rolled forward around the chin (0 open .. 1 hunched shell)
       },
       "head": { "offset": 0.0,  // head off the centre line: -1 rear side .. 1 lead side
                 "movement": 0.4, // head and upper-body movement amplitude (0 still .. 1 constant slips)
                 "chin_tuck": 0.6 },
       "bounce": { "amp": 0.5,   // 0 flat-footed and planted .. 1 springy on the toes
                   "rate": 1.0 },// rhythm multiplier (1 = about 1.5 bounces per second)
       "switch_per_min": 0,   // stance switches per minute of standing time
       "feints": 0.25,        // hand and shoulder feints, level-change feints (0 never .. 1 constant)
       "hand_fighting": 0.2,  // lead hand pawing, touching and parrying the opponent's lead
       "posture": "closed",   // closed (chin behind the shoulder) | open (square, hands lower)
       "footwork": ["pressure"], // any of: pressure, circling, in-and-out, lateral, flat-footed, stance-switch, cage-cutting
       "source": "...", "confidence": "low|medium|high", "notes": "..."
     }

   The profile drives Actor.homeFor (footprint), Actor.poseFor("stand") (guard, crouch, bounce, head
   movement, feints) and Show.updatePair (who presses, circling, range). Avatars read actor.prof for the
   shoulder roll and chin tuck. */
(function (root) {
  "use strict";
  var T = root.THREE, FR = root.FightRig, FA = root.FightArena;
  if (!T || !FR || !FA) return;
  var V3 = T.Vector3, clamp = FR.clamp;
  var TAU = Math.PI * 2;
  var DEG = Math.PI / 180;

  /* ------------------------------------------------------------ stance profiles */
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function neutralProfile() {
    return { base: 1, width: 1, depth: 1, crouch: 0.3, lean: 0.2, leadToe: 10 * DEG, rearToe: 45 * DEG, weightFront: 0.5, bladed: 0.6,
      guard: { style: "standard", height: 0.6, leadReach: 0.35, leadHeight: 0.6, leadWidth: 0, rearHeight: 0.6, rearTuck: 0.8, elbowFlare: 0.2, shoulderRoll: 0.6 },
      head: { offset: 0, move: 0.4, chinTuck: 0.6 }, bounce: { amp: 0.5, rate: 1 }, switchRate: 0, feints: 0.25, handFight: 0.2, open: 0,
      foot: { pressure: 0.4, circling: 0.3, inout: 0.3, lateral: 0.2 }, src: "neutral" };
  }
  /* info: script.fighters[side] (or an appearance object with slug/stance/division/likeness/style). */
  function stanceProfile(info) {
    info = info || {};
    var P = neutralProfile(), G = P.guard, Hd = P.head, F = P.foot, Bo = P.bounce;
    var app = info.appearance || info, sc = info.scouting || info.style || app.style || {};
    var arch = String(sc.archetype || "").toLowerCase(), tags = {}, i;
    (sc.tags || []).forEach(function (t) { tags[String(t).toLowerCase()] = 1; });
    var stanceTxt = String(info.stance || app.stance || sc.stance || "orthodox").toLowerCase();
    P.base = /south/.test(stanceTxt) ? -1 : 1;
    if (/switch/.test(stanceTxt)) P.switchRate = 0.8;
    function add(o, k, v) { o[k] += v; }
    // archetype
    if (/wrestl|chain|sambo/.test(arch)) { add(P, "crouch", 0.22); add(P, "width", 0.1); add(P, "lean", 0.2); add(P, "bladed", -0.18); add(P, "weightFront", 0.05);
      add(G, "height", -0.12); add(G, "leadReach", 0.15); add(G, "elbowFlare", 0.05); add(Bo, "amp", -0.15); add(P, "handFight", 0.35); add(F, "pressure", 0.2); G.style = "hand-fighting"; }
    if (/wrestle-boxer/.test(arch)) { add(P, "crouch", -0.08); add(G, "height", 0.08); add(P, "handFight", -0.15); G.style = "standard"; }
    if (/kickbox|muay/.test(arch)) { add(P, "weightFront", -0.1); add(P, "crouch", -0.1); add(P, "bladed", -0.1); add(G, "height", 0.15); add(G, "leadReach", 0.1); G.style = "high";
      if (/muay/.test(arch)) { add(Bo, "amp", -0.15); add(Bo, "rate", -0.3); add(P, "bladed", -0.15); } }
    if (/karate|point/.test(arch)) { add(P, "bladed", 0.25); add(P, "width", -0.1); add(P, "depth", 0.2); add(Bo, "amp", 0.35); add(G, "height", -0.2); add(G, "leadReach", 0.15);
      add(F, "inout", 0.4); add(P, "weightFront", -0.08); G.style = "low"; }
    if (/boxer/.test(arch) && !/wrestle/.test(arch)) { add(P, "crouch", 0.08); add(G, "height", 0.05); add(Hd, "move", 0.2); add(G, "shoulderRoll", 0.1); }
    if (/pressure/.test(arch)) { add(P, "weightFront", 0.08); add(P, "lean", 0.15); add(F, "pressure", 0.4); add(Bo, "amp", -0.1); add(G, "height", 0.05); }
    if (/counter/.test(arch)) { add(P, "weightFront", -0.08); add(F, "circling", 0.3); add(F, "inout", 0.2); add(G, "height", -0.1); add(G, "leadReach", 0.15); add(Hd, "move", 0.15); add(F, "pressure", -0.25); }
    if (/volume/.test(arch)) { add(P, "feints", 0.2); add(Bo, "amp", 0.15); add(F, "lateral", 0.2); add(F, "pressure", 0.15); }
    if (/power/.test(arch)) { add(P, "crouch", 0.1); add(P, "weightFront", 0.04); add(Bo, "amp", -0.15); }
    if (/grappler|bjj/.test(arch)) { add(P, "crouch", 0.1); add(G, "height", -0.1); add(G, "leadReach", 0.1); add(Bo, "amp", -0.1); }
    // tags
    if (tags["switch-stance"]) P.switchRate = Math.max(P.switchRate, 1.2);
    if (tags.southpaw && P.base > 0 && !/orth/.test(stanceTxt)) P.base = -1;
    if (tags.feints) add(P, "feints", 0.25);
    if (tags["head-movement"]) add(Hd, "move", 0.25);
    if (tags.footwork) { add(Bo, "amp", 0.15); add(F, "circling", 0.15); add(F, "lateral", 0.15); }
    if (tags.pressure) { add(F, "pressure", 0.25); add(P, "weightFront", 0.04); }
    if (tags.counter) { add(F, "circling", 0.15); add(F, "pressure", -0.1); }
    if (tags.rangy || tags["range-control"]) { add(G, "leadReach", 0.15); add(P, "depth", 0.08); add(F, "inout", 0.2); }
    if (tags["short-range"]) { add(P, "crouch", 0.1); add(P, "depth", -0.1); }
    if (tags["head-kicks"] || tags["leg-kicks"]) add(P, "weightFront", -0.03);
    if (tags["chain-wrestling"] || tags["double-leg"] || tags["single-leg"]) add(P, "crouch", 0.06);
    // body: long arms reach out more; heavyweights bounce less and slower; flyweights more
    var ape = num(+info.reach_in, 0) - num(+info.height_in, 0);
    if (info.reach_in && info.height_in && ape > 2) add(G, "leadReach", Math.min(0.15, (ape - 2) * 0.04));
    var div = String(info.division || app.division || "");
    if (/heavy/i.test(div) && !/light/i.test(div)) { add(Bo, "amp", -0.2); add(Bo, "rate", -0.15); add(P, "crouch", -0.05); }
    if (/fly|straw/i.test(div)) { add(Bo, "amp", 0.1); add(Bo, "rate", 0.1); }
    P.src = "derived: " + (arch || "no archetype") + (Object.keys(tags).length ? " + tags" : "");
    // explicit block from the likeness sheet wins
    var lk = app.likeness && typeof app.likeness === "object" ? app.likeness : null, S = (lk && lk.stance) || info.stanceProfile || null;
    if (S && typeof S === "object") {
      var b = String(S.base || "").toLowerCase();
      if (/south/.test(b)) P.base = -1; else if (/orth/.test(b)) P.base = 1; else if (/switch/.test(b)) { P.base = 1; P.switchRate = Math.max(P.switchRate, 1); }
      P.width = num(S.width, P.width); P.depth = num(S.depth, P.depth); P.crouch = num(S.crouch, P.crouch); P.lean = num(S.lean, P.lean);
      if (S.lead_foot_deg != null) P.leadToe = num(S.lead_foot_deg, 10) * DEG;
      if (S.rear_foot_deg != null) P.rearToe = num(S.rear_foot_deg, 45) * DEG;
      P.weightFront = num(S.weight_front, P.weightFront); P.bladed = num(S.bladed, P.bladed);
      var g = S.guard || {};
      G.style = g.style || G.style; G.height = num(g.height, G.height); G.leadReach = num(g.lead_reach, G.leadReach); G.leadHeight = num(g.lead_height, G.leadHeight);
      G.leadWidth = num(g.lead_width, G.leadWidth); G.rearHeight = num(g.rear_height, G.rearHeight); G.rearTuck = num(g.rear_tuck, G.rearTuck);
      G.elbowFlare = num(g.elbow_flare, G.elbowFlare); G.shoulderRoll = num(g.shoulder_roll, G.shoulderRoll);
      var h = S.head || {}; Hd.offset = num(h.offset, Hd.offset); Hd.move = num(h.movement, Hd.move); Hd.chinTuck = num(h.chin_tuck, Hd.chinTuck);
      var bo = S.bounce || {}; Bo.amp = num(bo.amp, Bo.amp); Bo.rate = num(bo.rate, Bo.rate);
      P.switchRate = num(S.switch_per_min, P.switchRate); P.feints = num(S.feints, P.feints); P.handFight = num(S.hand_fighting, P.handFight);
      if (S.posture) P.open = /open/i.test(S.posture) ? 1 : 0;
      if (Array.isArray(S.footwork)) {
        var fw = S.footwork.join(" ").toLowerCase();
        F.pressure = /pressure|cage-cutting|forward/.test(fw) ? 0.85 : (/circl|counter|back/.test(fw) ? 0.15 : F.pressure);
        F.circling = /circl|lateral|angle/.test(fw) ? 0.75 : F.circling * 0.6;
        F.inout = /in-and-out|in and out|blitz/.test(fw) ? 0.8 : F.inout * 0.7;
        F.lateral = /lateral|circl/.test(fw) ? 0.6 : F.lateral;
        if (/flat/.test(fw)) Bo.amp = Math.min(Bo.amp, 0.2);
        if (/stance-switch|switch/.test(fw)) P.switchRate = Math.max(P.switchRate, 1.2);
      }
      P.src = "likeness sheet" + (S.confidence ? " (" + S.confidence + ")" : "");
    }
    // clamp
    P.width = clamp(P.width, 0.7, 1.45); P.depth = clamp(P.depth, 0.7, 1.45); P.crouch = clamp(P.crouch, 0, 1); P.lean = clamp(P.lean, -0.5, 1);
    P.weightFront = clamp(P.weightFront, 0.3, 0.7); P.bladed = clamp(P.bladed, 0, 1);
    ["height", "leadReach", "leadHeight", "rearHeight", "rearTuck", "elbowFlare", "shoulderRoll"].forEach(function (k) { G[k] = clamp(G[k], 0, 1); });
    G.leadWidth = clamp(G.leadWidth, -1, 1); Hd.offset = clamp(Hd.offset, -1, 1); Hd.move = clamp(Hd.move, 0, 1); Hd.chinTuck = clamp(Hd.chinTuck, 0, 1);
    Bo.amp = clamp(Bo.amp, 0, 1); Bo.rate = clamp(Bo.rate, 0.5, 1.6); P.switchRate = clamp(P.switchRate, 0, 6);
    P.feints = clamp(P.feints, 0, 1); P.handFight = clamp(P.handFight, 0, 1);
    for (i in F) F[i] = clamp(F[i], 0, 1);
    return P;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); var i = 1 - t; return 1 - i * i * i; }
  function easeIn(t) { t = clamp(t, 0, 1); return t * t * t; }
  function bell(t) { t = clamp(t, 0, 1); return Math.sin(Math.PI * t); }
  function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
  function punchCurve(u, h) { if (u < h) return easeOut(u / h); if (u < h + 0.1) return 1; return 1 - smooth((u - h - 0.1) / (1 - h - 0.1)); }
  function kickCurve(u, h) { return u < h ? smooth(u / h) : 1 - smooth((u - h) / (1 - h)); }

  var _v = new V3(), _w = new V3(), _u = new V3(), _q = new T.Quaternion(), _cham = new V3(), _sp = new V3();
  var UP = new V3(0, 1, 0);

  /* ------------------------------------------------------------ actors */
  function Spring(k, c) { this.x = 0; this.v = 0; this.k = k || 170; this.c = c || 17; }
  Spring.prototype.step = function (dt) { this.v += (-this.k * this.x - this.c * this.v) * dt; this.x += this.v * dt; };
  Spring.prototype.reset = function () { this.x = 0; this.v = 0; };

  function Foot() { this.p = new V3(); this.yaw = 0; this.home = new V3(); this.homeYaw = 0; this.sw = 0; this.swT = 0; this.swDur = 0.16; this.from = new V3(); this.to = new V3(); this.fromYaw = 0; this.toYaw = 0; this.lift = 0.06; }

  function newPose() {
    return { x: 0, y: 0, z: 0, yaw: 0, rp: 0, rr: 0, px: 0, py: 1, pz: 0, pp: 0, pyaw: 0, pr: 0, sp: 0, sy: 0, sr: 0, cp: 0, cy: 0, cr: 0, hp: 0, hy: 0, hr: 0,
      hl: [new V3(), new V3()], hpl: [new V3(), new V3()], hw: [new V3(), new V3()], hwk: [0, 0], hwp: [new V3(), new V3()], hwpk: [0, 0],
      fp: [new V3(), new V3()], fpole: [new V3(), new V3()], fyaw: [0, 0], fpitch: [0, 0] };
  }
  var NUMS = ["x", "y", "z", "rp", "rr", "px", "py", "pz", "pp", "pyaw", "pr", "sp", "sy", "sr", "cp", "cy", "cr", "hp", "hy", "hr"];
  function blendPose(out, a, b, t) {
    for (var i = 0; i < NUMS.length; i++) { var k = NUMS[i]; out[k] = lerp(a[k], b[k], t); }
    out.yaw = a.yaw + angDiff(b.yaw, a.yaw) * t;
    for (var j = 0; j < 2; j++) {
      out.hl[j].lerpVectors(a.hl[j], b.hl[j], t); out.hpl[j].lerpVectors(a.hpl[j], b.hpl[j], t);
      out.hw[j].lerpVectors(a.hwk[j] > 0 ? a.hw[j] : b.hw[j], b.hwk[j] > 0 ? b.hw[j] : a.hw[j], t);
      out.hwk[j] = lerp(a.hwk[j], b.hwk[j], t);
      out.hwp[j].lerpVectors(a.hwp[j], b.hwp[j], t); out.hwpk[j] = lerp(a.hwpk[j], b.hwpk[j], t);
      out.fp[j].lerpVectors(a.fp[j], b.fp[j], t); out.fpole[j].lerpVectors(a.fpole[j], b.fpole[j], t);
      out.fyaw[j] = a.fyaw[j] + angDiff(b.fyaw[j], a.fyaw[j]) * t; out.fpitch[j] = lerp(a.fpitch[j], b.fpitch[j], t);
    }
  }

  var STEP_MODES = { stand: 1, clinch: 1, walk: 1, celebrate: 1, ref: 1, raised: 1, refstop: 1 };

  function Actor(spec, id, stance, scene) {
    this.rig = new FR.Rig(spec); scene.add(this.rig.root);
    this.spec = spec; this.H = spec.H; this.id = id; this.stance = stance; this.isRef = !!spec.ref;
    this.pos = new V3(); this.yaw = 0; this.vel = new V3();
    this.mode = "stand"; this.from = null; this.tr = 0; this.trDur = 0; this.trEase = smooth;
    this.act = null; this.react = null;
    this.feet = [new Foot(), new Foot()];
    this.s = { hp: new Spring(150, 13), hy: new Spring(150, 13), hr: new Spring(150, 13), tp: new Spring(110, 13), tr: new Spring(110, 13), kb: new Spring(55, 11), dip: new Spring(120, 14) };
    this.lunge = 0; this.opp = null; this.phase = Math.random() * 10; this.bounce = spec.bounce || 1;
    this.prof = neutralProfile(); this.feint = null; this.feT = 1 + Math.random() * 3; this.swT = 20 + Math.random() * 20; this.homeStance = stance;
    this.P = newPose(); this.P2 = newPose(); this.PB = newPose();
    this.walkTo = null; this.faceTo = null; this.walkSpeed = 1.2;
    this.armUp = 0; this.wave = 0;
    this.lastHit = 0;
  }
  /* Stance profile (see the header): footprint, guard, rhythm and movement for this fighter. */
  Actor.prototype.setProfile = function (pf) {
    this.prof = pf || neutralProfile();
    this.stance = this.homeStance = this.prof.base || 1;
    this.bounce = 0.4 + 1.4 * this.prof.bounce.amp;
    this.swT = this.prof.switchRate > 0 ? 8 + Math.random() * 40 / this.prof.switchRate : 1e9;
  };
  /* Face landmarks in the head's local frame (origin at the head joint, +z forward, +x his left):
     measured on the skinned head when an avatar is bound, else the primitive head's proportions. */
  Actor.prototype.faceRef = function () {
    if (this.avatar && this.avatar.faceRef) return this.avatar.faceRef;
    var H = this.H;
    if (!this._fr || this._frH !== H) {
      this._frH = H;
      this._fr = { chin: new V3(0, -0.004 * H, 0.06 * H), jaw: new V3(0.03 * H, 0.004 * H, 0.04 * H), cheek: new V3(0.03 * H, 0.03 * H, 0.052 * H),
        brow: new V3(0.028 * H, 0.058 * H, 0.056 * H), nose: new V3(0, 0.032 * H, 0.072 * H),
        eyeLow: new V3(0.014 * H, 0.047 * H, 0.068 * H), eyeOut: new V3(0.022 * H, 0.05 * H, 0.066 * H), noseB: new V3(0, 0.024 * H, 0.08 * H) };
    }
    return this._fr;
  };
  /* A point in the head's local frame -> the chest frame, with the neck and head rotations setTorso will
     apply for pose P (neck 0.4/0.4/0.3, head 0.6/0.6/0.7 of hp/hy/hr). */
  var _eh = new T.Euler(), _qn = new T.Quaternion(), _qh = new T.Quaternion();
  Actor.prototype.headToChest = function (P, p, out) {
    var r = this.rig;
    _qn.setFromEuler(_eh.set(P.hp * 0.4, P.hy * 0.4, P.hr * 0.3, "YXZ"));
    _qh.setFromEuler(_eh.set(P.hp * 0.6, P.hy * 0.6, P.hr * 0.7, "YXZ"));
    return out.copy(p).applyQuaternion(_qh).add(r.head.position).applyQuaternion(_qn).add(r.neck.position);
  };
  /* Guard glove targets (chest frame) from the stance profile, placed against the face. Heights set the
     TOP of the glove against the face: 0.5 at the bottom of the nose (glove centre about the chin), 0.65
     just under the lower eyelid (centre at the mouth: cheekbone-and-jaw guard), 1 at the brow. Above 0.65 the
     sheet value is compressed (0.8 -> 0.72) and the gloves slide out beside the eyes, so the eyes stay open
     from the opponent's side (owner review, Nov 6: gloves were reading as covering the face). Rear glove:
     against the rear jaw and cheek, a finger off the skin (rear_tuck 1) or ~10 cm out (rear_tuck 0); lead
     glove: further out on the opponent's line by lead_reach, on the lead side of the face. */
  var _g1 = new V3(), _g2 = new V3();
  Actor.prototype.guardTargets = function (P, lh, rh, G, op, lead, rear, st) {
    var F = this.faceRef(), sc = this.H / 1.75, GR = 0.052 * sc;   // glove radius (4 oz MMA glove, closed fist)
    var cx = Math.abs(F.cheek.x);
    var eyeBot = (F.eyeLow ? F.eyeLow.y : lerp(F.cheek.y, F.brow.y, 0.5)) - 0.008 * sc;
    var noseY = F.noseB ? F.noseB.y : lerp(F.chin.y, F.cheek.y, 0.75);
    var eyeX = Math.max(F.eyeOut ? Math.abs(F.eyeOut.x) : 0, cx * 0.85);
    function veff(v) { return v <= 0.65 ? v : 0.65 + (v - 0.65) * 0.45; }
    function topY(v) {
      v = veff(v);
      if (v <= 0.5) return noseY - (0.5 - v) / 0.5 * 0.2 * sc;
      if (v <= 0.65) return lerp(noseY, eyeBot, (v - 0.5) / 0.15);
      return lerp(eyeBot, F.brow.y, (v - 0.65) / 0.35);
    }
    function outK(top) { return smooth((top - eyeBot + 0.004 * sc) / (0.022 * sc)); }   // glove top over the lower lid: move out beside the eye
    function fz(y) {                     // face surface depth at height y (chin -> cheekbone -> brow)
      if (y <= F.cheek.y) return lerp(F.chin.z, F.cheek.z + 0.012 * sc, clamp((y - F.chin.y) / Math.max(0.01, F.cheek.y - F.chin.y), 0, 1));
      return lerp(F.cheek.z + 0.012 * sc, F.brow.z, clamp((y - F.cheek.y) / Math.max(0.01, F.brow.y - F.cheek.y), 0, 1));
    }
    // offsets off the face run level in the world (the head is pitched down by th), not along the tucked face
    var th = P.pp + P.sp + P.cp + P.hp, cs = Math.cos(th), sn = Math.sin(th);
    var rt = topY(rh) - 0.03 * op * sc, ry = rt - GR * 0.95;
    var rx = -st * (lerp(cx * 1.36, Math.max(cx * 1.36, eyeX + GR * 0.92), outK(rt)) + 0.02 * op * sc);
    var rg = GR + (0.005 + 0.1 * (1 - G.rearTuck)) * sc;
    _g1.set(rx, ry + rg * sn, fz(ry) - 0.016 * sc + rg * cs);   // the face curves back toward the jaw
    this.headToChest(P, _g1, P.hl[rear]);
    // lead glove: out front on the lead side of the face (lead_reach 0 at the face .. 1 about 30 cm off it)
    var lt = topY(lh) - 0.03 * op * sc, ly = lt - GR * 0.95, reach = (0.035 + 0.24 * G.leadReach) * sc;
    var lx = st * (lerp(cx * 1.36, Math.max(cx * 1.36, eyeX + GR * 0.92), outK(lt)) + (0.04 * G.leadWidth - 0.012 * G.leadReach) * sc + 0.02 * op * sc);
    var lg = GR + 0.012 * sc + reach;
    _g2.set(lx, ly + lg * sn - 0.06 * reach, fz(ly) + lg * cs);
    this.headToChest(P, _g2, P.hl[lead]);
  };
  Actor.prototype.local = function (x, z, out) {
    var c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.pos.x + x * c + z * s, 0, this.pos.z - x * s + z * c);
  };
  Actor.prototype.fwd = function (out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); };
  Actor.prototype.left = function (out) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); };
  Actor.prototype.setMode = function (m, dur, ease) {
    if (m === this.mode && !this.tr) return;
    this.from = this.mode; this.mode = m; this.trDur = dur || 0.3; this.tr = this.trDur; this.trEase = ease || smooth;
    if (STEP_MODES[m] && !STEP_MODES[this.from]) this.replant();
  };
  Actor.prototype.snapMode = function (m) { this.mode = m; this.from = null; this.tr = 0; if (STEP_MODES[m]) this.replant(true); };
  Actor.prototype.replant = function (atHome) {
    for (var i = 0; i < 2; i++) {
      var f = this.feet[i];
      if (atHome) { this.homeFor(i, f.home); f.p.copy(f.home); f.yaw = f.homeYaw; }
      else { this.rig.footPos(i === 0, f.p); f.p.y = this.rig.ankleH; f.yaw = this.yaw; }
      f.sw = 0;
    }
  };
  Actor.prototype.busy = function () { return !!this.act || this.tr > 0; };

  // stance footprint in root space
  Actor.prototype.homeFor = function (i, out) {
    var H = this.H, st = this.stance, lead = st > 0 ? 0 : 1, m = this.mode, x, z, yo;
    if (m === "walk" || m === "celebrate" || m === "raised") { x = (i === 0 ? 0.055 : -0.055) * H; z = 0; yo = (i === 0 ? 0.08 : -0.08); }
    else if (m === "ref" || m === "refstop") { x = (i === 0 ? 0.1 : -0.1) * H; z = (i === 0 ? 0.02 : -0.02) * H; yo = (i === 0 ? 0.25 : -0.25); }
    else if (m === "clinch") { if (i === lead) { x = 0.06 * H * st; z = 0.1 * H; yo = -0.2 * st; } else { x = -0.14 * H * st; z = -0.1 * H; yo = -0.7 * st; } }
    else {
      // fighting stance from the profile: width and depth of the base, toe angles, weight over the lead or rear leg
      var pf = this.prof, c = -0.04 * H, half = 0.075 * H * pf.width, shiftZ = -(pf.weightFront - 0.5) * 0.18 * H;
      if (i === lead) { x = (c + half) * st; z = 0.14 * H * pf.depth + shiftZ; yo = -pf.leadToe * st; }
      else { x = (c - half) * st; z = -0.12 * H * pf.depth + shiftZ; yo = -pf.rearToe * st; }
    }
    this.local(x, z, out); out.y = this.rig.ankleH;
    this.feet[i].homeYaw = this.yaw + yo;
    return out;
  };

  Actor.prototype.stepFeet = function (dt) {
    var walking = this.mode === "walk" || this.mode === "celebrate" || this.mode === "raised" || this.mode === "refstop";
    var thresh = walking ? 0.09 : 0.11;
    for (var i = 0; i < 2; i++) {
      var f = this.feet[i];
      this.homeFor(i, f.home);
      if (f.sw) {
        f.swT += dt;
        var u = clamp(f.swT / f.swDur, 0, 1), s = smooth(u);
        f.p.lerpVectors(f.from, f.to, s); f.p.y = this.rig.ankleH + f.lift * Math.sin(Math.PI * u);
        f.yaw = f.fromYaw + angDiff(f.toYaw, f.fromYaw) * s;
        if (u >= 1) { f.sw = 0; f.p.copy(f.to); f.yaw = f.toYaw; }
      }
    }
    // kicks plant the support foot; a shot steps in (penetration step) rather than stretching the legs out behind
    if (this.act && this.act.type === "kick") return;
    if (!this.feet[0].sw && !this.feet[1].sw) {
      var best = -1, bestE = 0;
      for (i = 0; i < 2; i++) {
        var g = this.feet[i];
        var e = Math.hypot(g.p.x - g.home.x, g.p.z - g.home.z) + 0.12 * Math.abs(angDiff(g.yaw, g.homeYaw));
        if (e > bestE) { bestE = e; best = i; }
      }
      if (best >= 0 && bestE > thresh) {
        var h = this.feet[best];
        h.sw = 1; h.swT = 0; h.from.copy(h.p); h.fromYaw = h.yaw;
        h.to.copy(h.home).addScaledVector(this.vel, 0.09); h.to.y = this.rig.ankleH; h.toYaw = h.homeYaw;
        var dist = Math.hypot(h.to.x - h.from.x, h.to.z - h.from.z);
        h.swDur = clamp(0.1 + dist * 0.28, 0.11, walking ? 0.3 : 0.2);
        h.lift = clamp(0.035 + dist * 0.18, 0.035, 0.11);
      }
    }
  };

  /* ---- base poses by mode ---- */
  Actor.prototype.poseFor = function (m, P, t) {
    var H = this.H, st = this.stance, lead = st > 0 ? 0 : 1, rear = 1 - lead, opp = this.opp, i;
    P.x = this.pos.x; P.y = 0; P.z = this.pos.z; P.yaw = this.yaw; P.rp = 0; P.rr = 0; P.px = 0; P.pz = 0;
    P.hwk[0] = P.hwk[1] = 0; P.hwpk[0] = P.hwpk[1] = 0;
    for (i = 0; i < 2; i++) { P.fpitch[i] = 0; }
    var stepping = !!STEP_MODES[m];
    if (stepping) for (i = 0; i < 2; i++) { var f = this.feet[i]; P.fp[i].copy(f.p); P.fyaw[i] = f.yaw; P.fpole[i].set(Math.sin(f.yaw), 0.25, Math.cos(f.yaw)); }
    var bob = Math.sin(this.phase * TAU * 1.5) * 0.007 * H * this.bounce;
    if (m === "stand" || m === "clinch") {
      var cl = m === "clinch", pf = this.prof, G = pf.guard, hd = pf.head, bl = pf.bladed, cr = pf.crouch, ln = pf.lean;
      if (!cl) bob = Math.sin(this.phase * TAU * 1.5 * pf.bounce.rate) * 0.0125 * H * pf.bounce.amp;
      P.py = (cl ? 0.452 : 0.478 - 0.038 * cr) * H + (cl ? 0 : bob); P.pp = cl ? 0.34 : 0.05 + 0.13 * cr + 0.05 * ln; P.pyaw = (cl ? -0.3 : -(0.25 + 0.6 * bl)) * st; P.pr = 0;
      P.sp = cl ? 0.16 : 0.02 + 0.07 * ln + 0.03 * cr; P.sy = (cl ? 0.12 : 0.1 + 0.25 * bl) * st; P.sr = 0;
      P.cp = cl ? 0.14 : 0.03 + 0.05 * ln + 0.05 * G.shoulderRoll; P.cy = (cl ? 0.1 : 0.06 + 0.14 * bl) * st; P.cr = 0;
      // chin down, eyes on the opponent: the face's pitch is set in world terms (the torso already leans
      // forward, so the neck only adds what the lean leaves of the chin tuck)
      P.hp = cl ? 0.15 : (0.1 + 0.3 * hd.chinTuck) - 0.9 * (P.pp + P.sp + P.cp); P.hy = (cl ? 0.08 : 0.1 + 0.25 * bl) * st; P.hr = 0;
      var op = pf.open, gh = G.height, lh = clamp(gh + (G.leadHeight - 0.6) * 0.6, 0, 1), rh = clamp(gh + (G.rearHeight - 0.6) * 0.6, 0, 1);
      if (!cl) {
        // upper-body movement and head position off the centre line
        var hm = hd.move, wv = this.phase * TAU * 0.42;
        P.cr += (hm * 0.06 * Math.sin(wv) + hd.offset * 0.07) * st; P.sr += hm * 0.035 * Math.sin(wv + 0.7) * st;
        P.hr += (hm * 0.04 * Math.sin(wv * 1.3 + 1.1) - hd.offset * 0.05) * st; P.px += hm * 0.012 * H * Math.sin(wv + 0.3);
        P.cp += hm * 0.025 * Math.sin(wv * 0.7 + 2);
        // guard, anchored on the face (landmarks measured on the skinned head when one is bound): rear glove
        // beside the chin and cheek, lead glove a little out front at cheekbone height, elbows down on the ribs,
        // forearms angled in. Heights (glove top): 0 chest .. 0.5 nose bottom .. 0.65 under the eyes .. 1 brow.
        this.guardTargets(P, lh, rh, G, op, lead, rear, st);
      } else {
        var cyaw = 0, lz = (0.16 + 0.12 * G.leadReach) * H, rz = (0.12 + 0.08 * (1 - G.rearTuck)) * H;
        P.hl[lead].set(((0.035 + 0.035 * G.leadWidth) * H + lz * cyaw) * st, (0.045 + 0.13) * H, lz);
        P.hl[rear].set((-0.062 * H + rz * cyaw) * st, (0.035 + 0.13) * H, rz);
      }
      // elbows down on the ribs, a little outside the gloves so the forearms angle in (elbow_flare wings them)
      var fl = 0.04 + 0.6 * G.elbowFlare;
      if (cl) { P.hpl[lead].set((fl - 0.02) * st, -1, -0.18); P.hpl[rear].set((fl - 0.04) * -st, -1, -0.28); }
      else { P.hpl[lead].set((0.22 + fl) * st, -1, -0.04); P.hpl[rear].set((0.42 + fl) * -st, -1, -0.12); }
      if (!cl) {
        var fe = this.feint;
        if (fe) {
          var fb = bell(fe.t / fe.dur);
          if (fe.type === "jab") { P.hl[lead].z += 0.07 * H * fb; P.hl[lead].y -= 0.01 * H * fb; P.cy -= 0.1 * st * fb; P.sp += 0.04 * fb; }
          else if (fe.type === "rear") { P.hl[rear].z += 0.04 * H * fb; P.cy += 0.12 * st * fb; P.pyaw += 0.08 * st * fb; }
          else if (fe.type === "shoulder") { P.cr += 0.09 * fe.dir * fb; P.cp += 0.05 * fb; P.hr -= 0.05 * fe.dir * fb; }
          else if (fe.type === "level") { P.py -= 0.055 * H * fb; P.pp += 0.16 * fb; P.sp += 0.06 * fb; P.hl[lead].y -= 0.02 * H * fb; P.hl[rear].y -= 0.02 * H * fb; }
          else if (fe.type === "paw") { P.hl[lead].x -= 0.05 * H * st * fb; P.hl[lead].z += 0.06 * H * fb; P.hl[lead].y -= 0.02 * H * fb; }
        }
      }
      if (cl && opp) {
        // collar tie with the lead hand, underhook with the rear hand
        opp.rig.headPos(P.hw[lead]); opp.fwd(_v); P.hw[lead].addScaledVector(_v, -0.07); P.hw[lead].y -= 0.1; P.hwk[lead] = 1;
        opp.rig.bodyPos(P.hw[rear]); opp.left(_w); P.hw[rear].addScaledVector(_w, -0.14 * st).addScaledVector(_v, -0.1); P.hw[rear].y -= 0.05; P.hwk[rear] = 1;
        P.hwp[lead].set(0, -1, 0); P.hwp[rear].set(0, -1, 0); P.hwpk[lead] = P.hwpk[rear] = 0.6;
      }
    } else if (m === "walk" || m === "celebrate" || m === "raised") {
      var g = m === "raised" ? 0 : Math.sin(this.phase * TAU * 1.9) * Math.min(1, this.vel.length() * 1.5);
      P.py = 0.503 * H - Math.abs(g) * 0.006 * H; P.pp = 0.03; P.pyaw = g * 0.08; P.pr = 0;
      P.sp = 0.02; P.sy = -g * 0.06; P.sr = 0; P.cp = 0.02; P.cy = -g * 0.04; P.cr = 0; P.hp = 0; P.hy = 0; P.hr = 0;
      P.hl[0].set(0.145 * H, -0.09 * H, 0.03 * H + g * 0.05 * H); P.hl[1].set(-0.145 * H, -0.09 * H, 0.03 * H - g * 0.05 * H);
      P.hpl[0].set(0.2, 0, -1); P.hpl[1].set(-0.2, 0, -1);
      if (m === "celebrate") {
        var w2 = Math.sin(this.phase * TAU * 0.8) * 0.03 * H;
        P.hl[0].set(0.13 * H, 0.46 * H + w2, 0.05 * H); P.hl[1].set(-0.13 * H, 0.46 * H - w2, 0.05 * H);
        P.hpl[0].set(1, 0.2, -0.3); P.hpl[1].set(-1, 0.2, -0.3); P.hp = -0.35; P.cp = -0.1;
      } else if (m === "raised") {
        var up = this.armUp, side = this.raiseSide || 0;
        P.hl[side].set((side === 0 ? 0.11 : -0.11) * H, lerp(-0.09 * H, 0.47 * H, up), lerp(0.03 * H, 0.03 * H, up));
        P.hpl[side].set(side === 0 ? 1 : -1, 0.3, -0.2);
        P.hp = -0.15 * up;
      }
    } else if (m === "ref" || m === "refstop") {
      P.py = 0.488 * H + bob * 0.3; P.pp = 0.16; P.pyaw = 0; P.pr = 0; P.sp = 0.06; P.sy = 0; P.sr = 0; P.cp = 0.05; P.cy = 0; P.cr = 0; P.hp = 0.12; P.hy = 0; P.hr = 0;
      P.hl[0].set(0.075 * H, 0.02 * H, 0.13 * H); P.hl[1].set(-0.075 * H, 0.02 * H, 0.13 * H);
      P.hpl[0].set(0.6, -1, -0.2); P.hpl[1].set(-0.6, -1, -0.2);
      if (this.hold) {
        for (var hi = 0; hi < 2; hi++) { var hh = this.hold[hi]; if (hh) { hh.a.rig.handPos(hh.i === 0, P.hw[hi]); P.hwk[hi] = 1; } }
      }
      if (m === "refstop") {
        var wv = Math.sin(this.phase * TAU * 2.2);
        P.hl[0].set((0.02 + 0.13 * wv) * H, 0.38 * H, 0.12 * H); P.hl[1].set((-0.02 - 0.13 * wv) * H, 0.38 * H, 0.12 * H);
        P.hpl[0].set(1, 0, -0.2); P.hpl[1].set(-1, 0, -0.2); P.pp = 0.05; P.hp = 0;
      }
    } else if (m === "top") {
      P.py = 0.232 * H; P.pp = 0.5; P.pyaw = 0; P.pr = 0; P.sp = 0.24; P.sy = 0; P.sr = 0; P.cp = 0.15; P.cy = 0; P.cr = 0; P.hp = 0.1; P.hy = 0; P.hr = 0;
      P.hl[0].set(0.08 * H, 0.07 * H, 0.18 * H); P.hl[1].set(-0.08 * H, 0.07 * H, 0.18 * H);
      P.hpl[0].set(0.7, -1, -0.3); P.hpl[1].set(-0.7, -1, -0.3);
      if (opp) {
        opp.rig.bodyPos(P.hw[0]); this.left(_w); P.hw[0].addScaledVector(_w, 0.13); P.hw[0].y = Math.max(0.12, P.hw[0].y - 0.04);
        opp.rig.bodyPos(P.hw[1]); P.hw[1].addScaledVector(_w, -0.13); P.hw[1].y = Math.max(0.12, P.hw[1].y - 0.04);
        P.hwk[0] = P.hwk[1] = 0.85;
      }
      this.fwd(_v);
      for (i = 0; i < 2; i++) {
        this.local((i === 0 ? 0.085 : -0.085) * H, -0.235 * H, P.fp[i]); P.fp[i].y = 0.035;
        P.fpole[i].copy(_v).addScaledVector(UP, -0.55); P.fyaw[i] = this.yaw; P.fpitch[i] = 1.3;
      }
    } else if (m === "bottom") {
      P.py = 0.075 * H; P.pp = -1.4; P.pyaw = 0; P.pr = 0; P.sp = 0.2; P.sy = 0; P.sr = 0; P.cp = 0.22; P.cy = 0; P.cr = 0; P.hp = 0.42; P.hy = 0; P.hr = 0;
      P.hl[0].set(0.055 * H, 0.17 * H, 0.13 * H); P.hl[1].set(-0.055 * H, 0.17 * H, 0.13 * H);
      P.hpl[0].set(0.8, -0.6, 0); P.hpl[1].set(-0.8, -0.6, 0);
      if (opp) {
        opp.rig.bodyPos(P.hw[0]); opp.left(_w); P.hw[0].addScaledVector(_w, -0.16); P.hwk[0] = 0.55;
        opp.rig.bodyPos(P.hw[1]); P.hw[1].addScaledVector(_w, 0.16); P.hwk[1] = 0.55;
        // closed guard: ankles crossed behind his back
        opp.fwd(_v);
        for (i = 0; i < 2; i++) {
          P.fp[i].copy(opp.pos).addScaledVector(_v, -0.13).addScaledVector(_w, i === 0 ? -0.1 : 0.1); P.fp[i].y = 0.34;
          this.left(_u); P.fpole[i].copy(_u).multiplyScalar(i === 0 ? 1 : -1).addScaledVector(UP, 0.9);
          P.fyaw[i] = this.yaw + (i === 0 ? -1.2 : 1.2); P.fpitch[i] = 0.4;
        }
      } else {
        this.fwd(_v); this.left(_w);
        for (i = 0; i < 2; i++) { P.fp[i].copy(this.pos).addScaledVector(_v, 0.55).addScaledVector(_w, i === 0 ? 0.18 : -0.18); P.fp[i].y = 0.05; P.fpole[i].copy(UP); P.fyaw[i] = this.yaw; }
      }
    } else if (m === "down") {
      P.py = 0.078 * H; P.pp = -0.85; P.pyaw = 0.25 * st; P.pr = 0; P.sp = 0.24; P.sy = -0.1 * st; P.sr = 0; P.cp = 0.16; P.cy = -0.1 * st; P.cr = 0; P.hp = 0.2; P.hy = -0.05 * st; P.hr = 0;
      P.hl[lead].set(0.05 * H * st, 0.17 * H, 0.12 * H); P.hpl[lead].set(0.6 * st, -1, 0);
      this.fwd(_v); this.left(_w);
      P.hw[rear].copy(this.pos).addScaledVector(_v, -0.3).addScaledVector(_w, -0.17 * st); P.hw[rear].y = 0.03; P.hwk[rear] = 1;
      P.hl[rear].set(-0.1 * H * st, 0, -0.1 * H); P.hpl[rear].set(-0.4 * st, 0, -1);
      P.hwp[rear].copy(_v).multiplyScalar(-1).addScaledVector(UP, 0.6); P.hwpk[rear] = 1;
      for (i = 0; i < 2; i++) {
        P.fp[i].copy(this.pos).addScaledVector(_v, i === lead ? 0.44 : 0.36).addScaledVector(_w, i === 0 ? 0.14 : -0.14); P.fp[i].y = this.rig.ankleH;
        P.fpole[i].copy(UP).addScaledVector(_v, 0.3); P.fyaw[i] = this.yaw + (i === 0 ? 0.25 : -0.25);
      }
    } else if (m === "ko") {
      P.py = 0.062 * H; P.pp = -1.53; P.pyaw = 0; P.pr = 0.12; P.sp = 0.02; P.sy = 0; P.sr = 0; P.cp = 0; P.cy = 0; P.cr = 0.05; P.hp = 0.02; P.hy = 0.75; P.hr = 0.2;
      this.fwd(_v); this.left(_w);
      P.hw[0].copy(this.pos).addScaledVector(_v, -0.2).addScaledVector(_w, 0.52); P.hw[0].y = 0.035; P.hwk[0] = 1;
      P.hw[1].copy(this.pos).addScaledVector(_v, -0.32).addScaledVector(_w, -0.47); P.hw[1].y = 0.035; P.hwk[1] = 1;
      P.hl[0].set(0.15 * H, 0, 0); P.hl[1].set(-0.15 * H, 0, 0); P.hpl[0].set(0, 0, -1); P.hpl[1].set(0, 0, -1);
      P.hwp[0].copy(UP); P.hwp[1].copy(UP); P.hwpk[0] = P.hwpk[1] = 1;
      for (i = 0; i < 2; i++) {
        P.fp[i].copy(this.pos).addScaledVector(_v, 0.8).addScaledVector(_w, i === 0 ? 0.17 : -0.12); P.fp[i].y = 0.055;
        P.fpole[i].copy(UP); P.fyaw[i] = this.yaw + (i === 0 ? 0.5 : -0.4); P.fpitch[i] = -0.9;
      }
    } else if (m === "sit") {
      P.py = 0.46 + 0.062 * H; P.pp = 0.1; P.pyaw = 0; P.pr = 0; P.sp = 0.12; P.sy = 0; P.sr = 0; P.cp = 0.1; P.cy = 0; P.cr = 0; P.hp = 0.05; P.hy = 0; P.hr = 0;
      this.fwd(_v); this.left(_w);
      for (i = 0; i < 2; i++) {
        P.hw[i].copy(this.pos).addScaledVector(_v, 0.32).addScaledVector(_w, i === 0 ? 0.15 : -0.15); P.hw[i].y = 0.5; P.hwk[i] = 1;
        P.hl[i].set((i === 0 ? 0.1 : -0.1) * H, 0, 0.1 * H); P.hpl[i].set(i === 0 ? 0.8 : -0.8, -0.5, -0.5);
        P.fp[i].copy(this.pos).addScaledVector(_v, 0.46).addScaledVector(_w, i === 0 ? 0.2 : -0.2); P.fp[i].y = this.rig.ankleH;
        P.fpole[i].copy(_v).addScaledVector(UP, 0.4); P.fyaw[i] = this.yaw + (i === 0 ? 0.2 : -0.2);
      }
    }
  };

  /* ---- actions: strikes, shots, defense, reactions ---- */
  var PUNCH = {
    jab: { dur: 0.27, hand: "lead", twist: -0.22, hip: -0.1, lunge: 0.24, arc: 0.02, arcUp: 0, lean: 0.06 },
    cross: { dur: 0.33, hand: "rear", twist: 0.48, hip: 0.36, lunge: 0.32, arc: 0.03, arcUp: 0, lean: 0.1 },
    hook: { dur: 0.35, hand: "lead", twist: 0.42, hip: 0.25, lunge: 0.16, arc: 0.3, arcUp: 0.05, lean: 0.04, elbowUp: true },
    overhand: { dur: 0.39, hand: "rear", twist: 0.55, hip: 0.4, lunge: 0.32, arc: 0.18, arcUp: 0.26, lean: 0.18, dip: 0.04 },
    upper: { dur: 0.32, hand: "rear", twist: 0.32, hip: 0.25, lunge: 0.16, arc: 0.04, arcUp: -0.26, lean: 0.02, dip: 0.05 },
    bodyhook: { dur: 0.34, hand: "lead", twist: 0.38, hip: 0.22, lunge: 0.2, arc: 0.22, arcUp: -0.05, lean: 0.16, dip: 0.07, body: true, elbowUp: true },
    bodystraight: { dur: 0.32, hand: "rear", twist: 0.45, hip: 0.32, lunge: 0.3, arc: 0.02, arcUp: 0, lean: 0.2, dip: 0.09, body: true },
    short: { dur: 0.26, hand: "rear", twist: 0.3, hip: 0.15, lunge: 0, arc: 0.12, arcUp: 0.03, lean: 0.02 },
    elbow: { dur: 0.28, hand: "lead", twist: 0.45, hip: 0.15, lunge: 0, arc: 0.14, arcUp: 0.1, lean: 0.02, elbowUp: true },
    shortbody: { dur: 0.26, hand: "rear", twist: 0.3, hip: 0.15, lunge: 0, arc: 0.1, arcUp: -0.04, lean: 0.1, dip: 0.03, body: true }
  };
  var KICK = {
    calf: { dur: 0.5, leg: "rear", hip: 1.2, h: 0.3, lean: -0.16, aim: "calf", lunge: 0.4 },
    inside: { dur: 0.42, leg: "lead", hip: -0.35, h: 0.22, lean: -0.06, aim: "inside", lunge: 0.3 },
    bodykick: { dur: 0.56, leg: "rear", hip: 1.35, h: 0.42, lean: -0.26, aim: "body", lunge: 0.62 },
    headkick: { dur: 0.62, leg: "rear", hip: 1.45, h: 0.5, lean: -0.4, aim: "head", lunge: 0.68 },
    knee: { dur: 0.42, leg: "rear", hip: 0.25, h: 0.36, lean: -0.1, aim: "kneeBody", knee: true, lunge: 0 },
    kneehead: { dur: 0.45, leg: "rear", hip: 0.25, h: 0.4, lean: -0.12, aim: "kneeHead", knee: true, lunge: 0 }
  };

  Actor.prototype.startAction = function (a) {
    a.t = 0; this.act = a;
    var lead = this.stance > 0 ? 0 : 1;
    this.feint = null;
    if (a.type === "punch" || a.type === "gnp" || a.type === "hammer") {
      a.hi = a.hand === "lead" ? lead : 1 - lead;
      a.start = this.rig.handPos(a.hi === 0, new V3());
      if (a.type === "punch" && this.opp) {
        // close the distance the punch needs: shoulder to target minus the arm's reach (the old fixed lunge left jabs ~0.7 m short)
        var sh = (a.hi === 0 ? this.rig.armL : this.rig.armR).sh.getWorldPosition(_u);
        this.aimPoint(a.def.body ? "body" : "head", _v);
        // the glove's centre stops a glove radius off the face (or body), not at the head's centre; the body
        // closes whatever distance the arm cannot (applyAction aims at the same stop point)
        a.stop = a.def.body ? 0.1 : 0.125;
        var need = sh.distanceTo(_v) - a.stop - (this.rig.ua + this.rig.la) * (a.def.elbowUp ? 0.88 : 0.96);
        a.lungeNeed = clamp(need, 0, 1.15);
      }
    } else if (a.type === "kick") {
      a.li = a.leg === "lead" ? lead : 1 - lead;
      a.start = this.feet[a.li].p.clone();
      if (this.opp) {
        var hp = (a.li === 0 ? this.rig.legL : this.rig.legR).hip.getWorldPosition(_u);
        this.aimPoint(a.def.aim, _v);
        var reachK = a.def.knee ? 0.62 : 0.97;
        a.lungeNeed = clamp((hp.distanceTo(_v) - (this.rig.th + this.rig.sh) * reachK) * 1.1, 0, 1.2);
      }
    }
  };
  Actor.prototype.startReact = function (r) { r.t = 0; this.react = r; };

  Actor.prototype.aimPoint = function (kind, out) {
    var o = this.opp, lead = o.stance > 0 ? 0 : 1;
    if (kind === "head") return o.rig.headPos(out);
    if (kind === "body") return o.rig.liverPos(out);
    if (kind === "calf") { o.rig.kneePos(lead === 0, out); out.y = Math.max(0.2, out.y - 0.14); return out; }
    if (kind === "inside") { o.rig.footPos(lead === 0, out); out.y += 0.14; return out; }
    if (kind === "kneeBody") { o.rig.liverPos(out); out.y -= 0.04; return out; }
    if (kind === "kneeHead") { o.rig.headPos(out); return out; }
    return o.rig.headPos(out);
  };

  Actor.prototype.applyAction = function (P, dt) {
    var a = this.act; if (!a) return;
    a.t += dt;
    var u = clamp(a.t / a.dur, 0, 1), H = this.H, st = this.stance, i;
    if (a.type === "punch") {
      var d = a.def, e = punchCurve(u, 0.42);
      this.aimPoint(d.body ? "body" : "head", _v);
      if (a.stop) { (a.hi === 0 ? this.rig.armL : this.rig.armR).sh.getWorldPosition(_sp); _sp.sub(_v); _sp.y *= 0.5; _v.addScaledVector(_sp.normalize(), a.stop); }
      if (!a.landed) _v.addScaledVector(a.missOff, 1);
      this.left(_w);
      var sideSign = a.hi === 0 ? 1 : -1;
      _u.copy(a.start).lerp(_v, e);
      var arcK = 4 * e * (1 - e);
      _u.addScaledVector(_w, sideSign * d.arc * arcK).addScaledVector(UP, d.arcUp * arcK);
      P.hw[a.hi].copy(_u); P.hwk[a.hi] = Math.min(1, u * 8, (1 - u) * 7);
      if (d.elbowUp) { this.left(_w); P.hwp[a.hi].copy(_w).multiplyScalar(sideSign).addScaledVector(UP, 0.4); P.hwpk[a.hi] = e; }
      var tw = (a.hi === (st > 0 ? 0 : 1) ? 1 : 1) * d.twist;
      var dirSign = a.hand === "lead" ? 1 : 1;
      P.cy += tw * st * e * dirSign; P.pyaw += d.hip * st * e; P.pp += d.lean * e; P.py -= (d.dip || 0) * H * e;
      this.lunge = Math.max(d.lunge * 0.6, a.lungeNeed || 0) * e * (a.lungeK == null ? 1 : a.lungeK);
      if (!a.hitDone && u >= 0.42) { a.hitDone = true; if (a.onHit) a.onHit(); }
    } else if (a.type === "kick") {
      var k = a.def, h = 0.48, kc = kickCurve(u, h);
      this.aimPoint(k.aim, _v);
      if (!a.landed) { _v.addScaledVector(a.missOff, 1); }
      this.fwd(_w); this.left(_u);
      var rearSide = a.li === (st > 0 ? 1 : 0) ? -st : st;
      var cham = _cham.copy(this.pos).addScaledVector(_w, 0.1 * H).addScaledVector(_u, rearSide * 0.05 * H); cham.y = k.h * H;
      var fpos = P.fp[a.li];
      if (u < 0.28) fpos.copy(a.start).lerp(cham, smooth(u / 0.28));
      else if (u < h) fpos.copy(cham).lerp(_v, easeOut((u - 0.28) / (h - 0.28)));
      else if (u < h + 0.1) fpos.copy(_v);
      else fpos.copy(_v).lerp(a.start, smooth((u - h - 0.1) / (1 - h - 0.1)));
      if (k.knee) P.fpole[a.li].copy(_w).addScaledVector(UP, 0.5);
      else P.fpole[a.li].copy(_w).multiplyScalar(1 - kc * 0.6).addScaledVector(_u, rearSide * kc * 0.8).addScaledVector(UP, 0.5);
      P.fpitch[a.li] = -0.2;
      P.fyaw[a.li] = this.yaw + rearSide * -0.9 * kc;
      var support = 1 - a.li;
      P.fyaw[support] += k.hip > 0 ? 0.9 * st * kc : 0;
      P.pyaw += k.hip * st * kc; P.pp += k.lean * kc; P.pr += 0.16 * rearSide * -1 * kc; P.py -= 0.015 * H * kc;
      if (k.knee) { P.pp += 0.25 * kc; P.pz += 0.04 * H * kc; P.hw[0].y -= 0.06 * kc; P.hw[1].y -= 0.06 * kc; }
      else {
        var rh = st > 0 ? 1 : 0;
        this.rig.chestToWorld(-0.15 * H * st, -0.06 * H, -0.08 * H, _u);
        P.hw[rh].copy(P.hwk[rh] > 0 ? P.hw[rh] : _u).lerp(_u, kc); P.hwk[rh] = Math.max(P.hwk[rh], kc * 0.9);
      }
      this.lunge = Math.max(k.lunge * 0.5, a.lungeNeed || 0) * smooth(u / h) * (u < h ? 1 : 1 - smooth((u - h - 0.1) / (1 - h - 0.1)));
      if (!a.hitDone && u >= h) { a.hitDone = true; if (a.onHit) a.onHit(); }
    } else if (a.type === "gnp" || a.type === "hammer") {
      var gh = 0.5;
      a.def.rig.headPos(_v);
      this.rig.chestToWorld((a.hi === 0 ? 0.06 : -0.06) * H, 0.27 * H, 0.06 * H, _w);
      if (u < 0.32) _u.copy(a.start).lerp(_w, smooth(u / 0.32));
      else if (u < gh) _u.copy(_w).lerp(_v, easeIn((u - 0.32) / (gh - 0.32)));
      else if (u < gh + 0.08) _u.copy(_v);
      else _u.copy(_v).lerp(_w, smooth((u - gh - 0.08) / (1 - gh - 0.08)));
      P.hw[a.hi].copy(_u); P.hwk[a.hi] = 1;
      var kc2 = kickCurve(u, gh);
      P.pp += (a.type === "hammer" ? 0.35 : 0.22) * kc2; P.cy += (a.hi === 0 ? -0.3 : 0.3) * kc2;
      if (a.type === "hammer") { P.py -= 0.08 * H * kc2; this.lunge = a.lungeTo != null ? a.lungeTo : 0; }
      if (!a.hitDone && u >= gh) { a.hitDone = true; if (a.onHit) a.onHit(); }
    } else if (a.type === "upelbow") {
      var b2 = bell(u);
      a.def.rig.headPos(_v);
      this.rig.chestToWorld(0.0, 0.2 * H, 0.15 * H, _w);
      P.hw[1].copy(_w).lerp(_v, b2 * 0.8); P.hwk[1] = b2;
      if (!a.hitDone && u >= 0.5) { a.hitDone = true; if (a.onHit) a.onHit(); }
    } else if (a.type === "shoot") {
      var sc = smooth(u / 0.55);
      P.py = lerp(P.py, 0.3 * this.H, sc); P.pp += 0.85 * sc; P.sp += 0.22 * sc; P.cp += 0.08 * sc; P.hp -= 0.55 * sc; P.pyaw *= 1 - sc;
      this.lunge = a.drive * sc;
      var o = this.opp;
      o.rig.kneePos(true, P.hw[0]); o.rig.kneePos(false, P.hw[1]); P.hw[0].y += 0.12; P.hw[1].y += 0.12;
      P.hwk[0] = P.hwk[1] = sc;
    } else if (a.type === "sub") {
      var hc = smooth(u / 0.25) * (a.hold ? 1 : (1 - smooth((u - 0.8) / 0.2)));
      P.pp += 0.55 * hc; P.py -= 0.05 * H * hc; P.sp += 0.2 * hc;
      a.def.rig.headPos(_v); this.left(_w);
      P.hw[0].copy(_v).addScaledVector(_w, 0.08); P.hw[0].y -= 0.07; P.hw[1].copy(_v).addScaledVector(_w, -0.08); P.hw[1].y -= 0.07;
      P.hwk[0] = P.hwk[1] = hc;
    }
    if (u >= 1 && !a.hold) {
      this.act = null; this.lunge = 0;
      if (a.onDone) a.onDone();
    }
  };

  Actor.prototype.applyReact = function (P, dt) {
    var r = this.react; if (!r) return;
    r.t += dt;
    var u = clamp(r.t / r.dur, 0, 1), b = bell(u), H = this.H, st = this.stance, lead = st > 0 ? 0 : 1;
    if (r.type === "slip") { P.cr += 0.34 * r.dir * b; P.sr += 0.12 * r.dir * b; P.px += 0.05 * H * r.dir * b; P.py -= 0.03 * H * b; P.hr += 0.25 * r.dir * b; }
    else if (r.type === "duck") { P.py -= 0.09 * H * b; P.pp += 0.35 * b; P.hp += 0.12 * b; }
    else if (r.type === "block") { P.hl[0].lerp(_v.set(0.035 * H, 0.16 * H, 0.085 * H), b); P.hl[1].lerp(_w.set(-0.035 * H, 0.155 * H, 0.08 * H), b); P.hp += 0.18 * b; }
    else if (r.type === "check") { P.fp[lead].y += 0.2 * b; this.left(_v); P.fp[lead].addScaledVector(_v, 0.05 * st * b); P.fpole[lead].addScaledVector(_v, st * b); }
    else if (r.type === "back") { this.lunge = -0.32 * b; }
    else if (r.type === "legHit") { this.left(_v); P.fp[lead].addScaledVector(_v, -0.07 * st * b); P.py -= 0.035 * H * b; P.pr += 0.06 * st * b; }
    else if (r.type === "wobble") { P.py -= 0.09 * H * b; P.pp -= 0.1 * b; P.hl[0].y -= 0.05 * H * b; P.hl[1].y -= 0.05 * H * b; P.pr += 0.08 * Math.sin(r.t * 9) * b; }
    else if (r.type === "sprawl") {
      var sc = smooth(u / 0.4) * (1 - smooth((u - 0.75) / 0.25));
      P.pz -= 0.2 * H * sc; P.py -= 0.15 * H * sc; P.pp += 0.9 * sc; P.hp -= 0.3 * sc;
      this.opp.rig.chestToWorld(0, 0.1 * this.opp.H, 0, P.hw[0]); P.hw[1].copy(P.hw[0]);
      this.left(_v); P.hw[0].addScaledVector(_v, 0.12); P.hw[1].addScaledVector(_v, -0.12);
      P.hwk[0] = P.hwk[1] = sc; this.lunge = -0.25 * sc;
    } else if (r.type === "tap") {
      var o = this.opp; o.rig.chestToWorld(0, 0.05 * o.H, -0.08 * o.H, _v);
      _v.y += 0.06 * Math.abs(Math.sin(r.t * 9));
      P.hw[0].copy(_v); P.hwk[0] = smooth(u / 0.1);
    } else if (r.type === "defend") {
      P.hl[0].lerp(_v.set(0.03 * H, 0.19 * H, 0.08 * H), b); P.hl[1].lerp(_w.set(-0.03 * H, 0.19 * H, 0.08 * H), b);
      P.hwk[0] *= 1 - b; P.hwk[1] *= 1 - b;
    }
    if (u >= 1) { if (this.react === r) { this.react = null; if (r.type === "back" || r.type === "sprawl") this.lunge = 0; } }
  };

  // spring impulses on impact
  Actor.prototype.takeHit = function (move, power, from) {
    var s = this.s, side = (from && from.hi === 0 ? 1 : -1) * (from ? from.stance : 1);
    var p = power || 1;
    if (move === "jab" || move === "cross" || move === "short") { s.hp.v -= 3.2 * p; s.hy.v += side * 1.4 * p; s.tp.v -= 0.7 * p; s.kb.v += 0.7 * p; }
    else if (move === "hook" || move === "elbow") { s.hy.v += side * 5.5 * p; s.hr.v += side * 2.2 * p; s.kb.v += 0.5 * p; }
    else if (move === "overhand") { s.hp.v += 2.2 * p; s.hy.v += side * 3.6 * p; s.hr.v += side * 1.5 * p; s.kb.v += 0.6 * p; }
    else if (move === "upper" || move === "kneehead") { s.hp.v -= 6 * p; s.tp.v -= 1.2 * p; s.kb.v += 0.6 * p; }
    else if (move === "headkick") { s.hy.v += side * 7 * p; s.hr.v += side * 3.5 * p; s.kb.v += 0.9 * p; }
    else if (move === "bodykick" || move === "bodyhook" || move === "bodystraight" || move === "knee" || move === "shortbody") { s.tp.v += 3.2 * p; s.tr.v += side * 1.2 * p; s.dip.v += 0.25 * p; s.kb.v += 0.3 * p; }
    else if (move === "calf" || move === "inside") { s.dip.v += 0.35 * p; this.startReact({ type: "legHit", dur: 0.38 }); }
    else if (move === "gnp" || move === "gnpelbow" || move === "upelbow") { s.hy.v += side * 4 * p; s.hp.v -= 1.5 * p; }
    this.lastHit = performance.now();
  };

  Actor.prototype.applySprings = function (P, dt) {
    var s = this.s;
    for (var k in s) s[k].step(dt);
    P.hp += s.hp.x; P.hy += s.hy.x; P.hr += s.hr.x; P.cp += s.tp.x * 0.6; P.sp += s.tp.x * 0.4; P.cr += s.tr.x;
    P.py -= Math.max(0, s.dip.x) * 0.25 * this.H;
  };

  /* Idle habits while standing: feints, hand-fighting and stance switches (rates from the profile). */
  Actor.prototype.habits = function (dt) {
    var pf = this.prof;
    if (this.feint) { this.feint.t += dt; if (this.feint.t >= this.feint.dur) this.feint = null; }
    if (this.mode !== "stand" || this.act || this.react || this.tr || this.isRef || !this.opp) return;
    this.feT -= dt;
    if (this.feT <= 0) {
      var rate = pf.feints + pf.handFight * 0.8;
      this.feT = lerp(5.5, 0.9, clamp(rate, 0, 1)) * (0.6 + Math.random() * 0.8);
      if (rate > 0.05 && !this.feint) {
        var r = Math.random() * rate, ty;
        if (r < pf.handFight * 0.8) ty = "paw";
        else { var q = Math.random(); ty = q < 0.4 ? "jab" : (q < 0.62 ? "shoulder" : (q < 0.82 ? "level" : "rear")); }
        this.feint = { type: ty, t: 0, dur: ty === "level" ? 0.38 : (ty === "paw" ? 0.3 : 0.24), dir: Math.random() < 0.5 ? 1 : -1 };
      }
    }
    if (pf.switchRate > 0) {
      this.swT -= dt;
      if (this.swT <= 0) { this.stance = -this.stance; this.swT = (12 + Math.random() * 30) / pf.switchRate; }
    }
  };
  Actor.prototype.update = function (dt) {
    this.phase += dt;
    this.habits(dt);
    if (STEP_MODES[this.mode]) this.stepFeet(dt);
    var P = this.P;
    this.poseFor(this.mode, P);
    if (this.tr > 0) {
      this.tr = Math.max(0, this.tr - dt);
      var k = this.trEase(1 - this.tr / this.trDur);
      if (this.from) { this.poseFor(this.from, this.P2); blendPose(this.PB, this.P2, P, k); P = this.PB; }
      if (this.tr === 0) { this.from = null; if (STEP_MODES[this.mode]) this.replant(); }
    }
    this.applyAction(P, dt);
    this.applyReact(P, dt);
    this.applySprings(P, dt);
    this.applyPose(P);
    if (this.avatar) this.avatar.tick(dt);
  };
  /* Blend a Mesh2Motion clip onto the skinned avatar (no-op on the primitive rig). */
  Actor.prototype.clip = function (name, weight, fade, opts) { return this.avatar ? this.avatar.clip(name, weight, fade, opts) : null; };

  Actor.prototype.applyPose = function (P) {
    var rig = this.rig;
    rig.setTorso(P);
    for (var i = 0; i < 2; i++) {
      rig.chestToWorld(P.hl[i].x, P.hl[i].y, P.hl[i].z, _v);
      if (P.hwk[i] > 0) _v.lerp(P.hw[i], clamp(P.hwk[i], 0, 1));
      rig.chestDirToWorld(P.hpl[i].x, P.hpl[i].y, P.hpl[i].z, _w);
      if (P.hwpk[i] > 0) _w.lerp(_u.copy(P.hwp[i]).normalize(), clamp(P.hwpk[i], 0, 1));
      rig.arm(i === 0, _v, _w);
    }
    for (i = 0; i < 2; i++) rig.leg(i === 0, P.fp[i], P.fpole[i], P.fyaw[i], P.fpitch[i]);
  };

  /* ------------------------------------------------------------ cameras */
  // per shot: [position drift m, aim drift m, handheld sway m]
  var HANDHELD = { wide: [0.12, 0.05, 0], mid: [0.1, 0.06, 0], cage: [0.02, 0.05, 0.012], top: [0.1, 0.05, 0], close: [0.03, 0.04, 0.01], high: [0.25, 0.08, 0], ring: [0.02, 0.03, 0.01], replay: [0, 0.02, 0.006] };
  function Cam(camera) {
    this.cam = camera; this.mode = "auto"; this.shot = "wide"; this.shotT = 0; this.nextCut = 7; this.cut = true;
    this.pos = new V3(0, 4.4, 9.5); this.look = new V3(0, 1, 0); this.fov = 34; this.az = Math.PI / 2;
    this.user = { az: 1.1, el: 0.42, dist: 10 }; this.shake = 0; this.cycle = 0; this.label = "";
    this._p = new V3(); this._l = new V3();
  }
  Cam.prototype.pickAuto = function (ctx) {
    if (ctx.phase === "replay") return "replay";
    if (ctx.phase === "break" || ctx.phase === "intro") return "high";
    if (ctx.phase === "decision" || ctx.phase === "result") return "ring";
    if (ctx.phase === "finish") return "close";
    if (ctx.state === "ground") return (this.shotT > 5 && this.shot === "top") ? "mid" : (this.shot === "mid" && this.shotT < 4 ? "mid" : "top");
    if (ctx.state === "clinch") return this.shot === "cage" || this.shot === "mid" ? this.shot : "cage";
    if (this.shotT > this.nextCut || ["wide", "mid", "cage"].indexOf(this.shot) < 0) {
      var seq = ["wide", "mid", "wide", "cage", "wide", "mid"];
      this.cycle = (this.cycle + 1) % seq.length;
      this.nextCut = { wide: 7 + Math.random() * 4, mid: 4 + Math.random() * 3, cage: 3.5 + Math.random() * 2.5 }[seq[this.cycle]];
      return seq[this.cycle];
    }
    return this.shot;
  };
  Cam.prototype.update = function (dt, ctx) {
    var want;
    if (this.mode === "auto") want = this.pickAuto(ctx);
    else if (ctx.phase === "replay") want = "replay";
    else want = { broadcast: "wide", cageside: "cage", overhead: "top", free: "free" }[this.mode] || "wide";
    if (want !== this.shot) { this.shot = want; this.shotT = 0; this.cut = true; }
    this.shotT += dt;
    var F = ctx.focus, th = ctx.theta;
    var perp1 = th + Math.PI / 2, perp2 = th - Math.PI / 2;
    var tgtAz = Math.abs(angDiff(this.az, perp1)) < Math.abs(angDiff(this.az, perp2)) ? perp1 : perp2;
    var p = this._p, l = this._l, fov = 34, k = 2.4;
    function at(az, dist, h) { p.set(F.x + Math.cos(az) * dist, h, F.z + Math.sin(az) * dist); }
    // broadcast lenses: 35 mm-equivalent focal lengths; narrow screens keep most of the horizontal framing
    var asp = Math.max(this.cam.aspect || 1.78, 1.45);
    function lens(mm) { return FA.lensFov ? FA.lensFov(mm, asp) : 2 * Math.atan(Math.tan(Math.atan(18 / mm)) / asp) * 180 / Math.PI; }
    var s = this.shot, creep = 1 - 0.05 * smooth(clamp(this.shotT / 9, 0, 1));
    if (s === "wide") { this.az += angDiff(tgtAz, this.az) * Math.min(1, dt * 0.5); at(this.az, 11.6 * creep, 5.7); l.set(F.x, 0.9, F.z); fov = lens(46); }
    else if (s === "mid") { this.az += angDiff(tgtAz + 0.35, this.az) * Math.min(1, dt * 0.6); at(this.az, 8.4 * creep, 3.9); l.set(F.x, 1.0, F.z); fov = lens(55); k = 3; }
    else if (s === "cage") {
      this.az += angDiff(tgtAz - 0.25, this.az) * Math.min(1, dt * 0.6);
      var ca = Math.atan2(F.z + Math.sin(this.az) * 3, F.x + Math.cos(this.az) * 3);
      ca = Math.round(ca / (Math.PI / 4)) * (Math.PI / 4);   // centre of a fence panel, clear of the posts
      p.set(Math.cos(ca) * 4.12, 1.22, Math.sin(ca) * 4.12); l.set(F.x, 1.0, F.z); fov = lens(24); k = 3;
    }
    else if (s === "top") { this.az += angDiff(tgtAz + 0.5, this.az) * Math.min(1, dt * 0.4); at(this.az, 3.6, 4.5); l.set(F.x, 0.25, F.z); fov = lens(32); k = 2.5; }
    else if (s === "close") { this.az += angDiff(tgtAz + 0.6, this.az) * Math.min(1, dt * 0.4); at(this.az, 3.7, 1.65); l.set(F.x, 0.75, F.z); fov = lens(32); k = 3; }
    else if (s === "high") { p.set(0.01, 11.5, 9.5); l.set(0, 0.3, 0); fov = lens(27); k = 1.5; }
    else if (s === "ring") { var ra = 1.35 + ctx.time * 0.06; p.set(F.x + Math.cos(ra) * 3.6, 1.8, F.z + Math.sin(ra) * 3.6); l.set(F.x, 1.15, F.z); fov = lens(30); k = 2; }
    else if (s === "replay") { var I = ctx.impact || F, az2 = ctx.replayAz - 0.6 + ctx.replayT * 0.08; p.set(I.x + Math.cos(az2) * 3.3, 1.5, I.z + Math.sin(az2) * 3.3); l.set(I.x, 0.95, I.z); fov = lens(35); k = 6; }
    else if (s === "free") {
      var u = this.user, cx = 0, cz = 0;
      p.set(cx + Math.cos(u.az) * Math.cos(u.el) * u.dist, 0.4 + Math.sin(u.el) * u.dist, cz + Math.sin(u.az) * Math.cos(u.el) * u.dist); l.set(F.x * 0.5, 0.9, F.z * 0.5); fov = lens(30); k = 8;
    }
    var inside = s === "close" || s === "replay" || s === "ring";
    if (inside) { var pr = Math.hypot(p.x, p.z); if (pr > 3.95) { p.x *= 3.95 / pr; p.z *= 3.95 / pr; } }
    if (this.cut) { this.pos.copy(p); this.look.copy(l); this.fov = fov; this.cut = false; this.seed = Math.random() * 100; }
    else { var a = 1 - Math.exp(-dt * k); this.pos.lerp(p, a); this.look.lerp(l, a); this.fov += (fov - this.fov) * a; }
    var c = this.cam;
    c.position.copy(this.pos);
    var lk = this._lk || (this._lk = new V3());
    lk.copy(this.look);
    // operator motion: slow drift and aim for the hard cameras, breathing sway for the handhelds on the canvas
    var hm = HANDHELD[s];
    this.rt = (this.rt || 0) + dt;
    if (hm) {
      var t = this.rt, q = this.seed || 0;
      c.position.x += (Math.sin(t * 0.21 + q) * 0.6 + Math.sin(t * 0.47 + q * 2.3) * 0.4) * hm[0];
      c.position.y += (Math.sin(t * 0.17 + q * 1.7) * 0.6 + Math.sin(t * 0.39 + q * 0.7) * 0.4) * hm[0] * 0.5;
      c.position.z += Math.sin(t * 0.25 + q * 3.1) * hm[0];
      lk.x += Math.sin(t * 0.33 + q * 1.3) * hm[1]; lk.y += Math.sin(t * 0.29 + q * 2.9) * hm[1] * 0.6; lk.z += Math.sin(t * 0.37 + q * 0.4) * hm[1];
      if (hm[2]) {
        c.position.x += (Math.sin(t * 1.9 + q) + 0.5 * Math.sin(t * 4.3 + q * 2)) * hm[2];
        c.position.y += (Math.sin(t * 1.4 + q * 3) + 0.4 * Math.sin(t * 5.1 + q)) * hm[2] * 0.8;
        lk.x += Math.sin(t * 2.3 + q * 5) * hm[2] * 1.6; lk.y += Math.sin(t * 2.9 + q) * hm[2];
      }
      if (inside) { var pr2 = Math.hypot(c.position.x, c.position.z); if (pr2 > 3.97) { c.position.x *= 3.97 / pr2; c.position.z *= 3.97 / pr2; } }
    }
    if (this.shake > 0.001) { c.position.x += (Math.random() - 0.5) * this.shake; c.position.y += (Math.random() - 0.5) * this.shake; this.shake *= Math.exp(-dt * 9); }
    c.lookAt(lk);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
    this.label = { wide: "Broadcast", mid: "Broadcast", cage: "Cage-side", top: "Overhead", close: "Close-up", high: "Overhead", ring: "Center", replay: "Replay", free: "Free" }[s];
  };

  /* ------------------------------------------------------------ replay buffer */
  function Replay(rigs) {
    this.rigs = rigs; this.N = 420; this.stride = FR.Rig.STRIDE;
    this.buf = new Float32Array(this.N * rigs.length * this.stride); this.times = new Float64Array(this.N);
    this.head = 0; this.count = 0;
    this.save = new Float32Array(rigs.length * this.stride);
  }
  Replay.prototype.record = function (t) {
    var base = this.head * this.rigs.length * this.stride;
    for (var i = 0; i < this.rigs.length; i++) this.rigs[i].snapshot(this.buf, base + i * this.stride);
    this.times[this.head] = t; this.head = (this.head + 1) % this.N; this.count = Math.min(this.count + 1, this.N);
  };
  Replay.prototype.span = function () {
    if (!this.count) return null;
    var newest = (this.head - 1 + this.N) % this.N, oldest = (this.head - this.count + this.N) % this.N;
    return [this.times[oldest], this.times[newest]];
  };
  Replay.prototype.show = function (t) {
    var n = this.count, N = this.N, prev = -1, idx = -1;
    for (var j = 0; j < n; j++) { var i = (this.head - n + j + N) % N; if (this.times[i] <= t) prev = i; else { idx = i; break; } }
    if (prev < 0) prev = idx; if (idx < 0) idx = prev; if (prev < 0) return;
    var t0 = this.times[prev], t1 = this.times[idx], f = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;
    for (var r = 0; r < this.rigs.length; r++) {
      var o = r * this.stride;
      this.rigs[r].restore(this.buf, prev * this.rigs.length * this.stride + o, this.buf, idx * this.rigs.length * this.stride + o, f);
    }
  };
  Replay.prototype.stash = function () { for (var i = 0; i < this.rigs.length; i++) this.rigs[i].snapshot(this.save, i * this.stride); };
  Replay.prototype.unstash = function () { for (var i = 0; i < this.rigs.length; i++) this.rigs[i].restore(this.save, i * this.stride, this.save, i * this.stride, 0); };

  /* ------------------------------------------------------------ the show */
  var SPECS = {
    A: { H: 1.68, build: 1.07, skin: 0xd9a383, shorts: 0x2563c9, trim: 0xe9eef5, band: 0x2f74e0, glove: 0x16181c, hair: 0x231710, beard: true, bounce: 1.3 },
    B: { H: 1.8, build: 1.0, skin: 0xd59a7c, shorts: 0xc9312f, trim: 0x111111, band: 0xe0403c, glove: 0x16181c, hair: 0x6b4a33, beard: false, bounce: 0.7 },
    R: { H: 1.8, build: 0.98, skin: 0xd8a88a, shirt: 0x1b1d22, pants: 0x3a3e46, shoes: 0x0e0f12, hair: 0x5a5148, ref: true }
  };

  function Show(canvas, hooks, opts) {
    opts = opts || {};
    this.arena = new FA.Arena(canvas, opts);
    var sc = this.arena.scene;
    this.A = new Actor(SPECS.A, "A", 1, sc);
    this.B = new Actor(SPECS.B, "B", 1, sc);
    this.R = new Actor(SPECS.R, "R", 1, sc);
    this.A.opp = this.B; this.B.opp = this.A; this.R.opp = null;
    this.cam = new Cam(this.arena.camera);
    this.replay = new Replay([this.A.rig, this.B.rig, this.R.rig]);
    this.hooks = hooks || {};
    this.speed = 5; this.replays = true; this.paused = false;
    this.M = new V3(); this.theta = 0; this.d = 1.8; this.range = 1.8; this.om = 0; this.omT = 0; this.omTimer = 0;
    this.time = 0; this.timeScale = 1; this.slowT = 0;
    this.script = null; this.phase = "idle"; this.phaseT = 0;
    this.focus = new V3(); this.impact = new V3(); this.impactT = -1; this.replayT = 0; this.replayAz = 0; this.pendingReplay = null;
    this.state = "stand"; this.seqUntil = 0; this.ctrlOwner = null;
    this.rnd = Math.random;
    this.queue = []; this.rIdx = 0; this.clock = 0;
    this.R.snapMode("ref");
    this.avatarsOn = !!(root.FightAvatar && opts.avatars !== false && root.FightAvatar.supported() && root.FightAvatar.webgl2(this.arena.renderer) && !lowEnd());
    if (this.avatarsOn) this.setAppearance(opts.appearance || defaultAppearance());
  }

  /* Phones with little memory keep the primitive figures. */
  function lowEnd() {
    var n = root.navigator || {};
    return /Mobi|Android/i.test(n.userAgent || "") && ((n.deviceMemory && n.deviceMemory < 4) || (n.hardwareConcurrency && n.hardwareConcurrency < 4));
  }
  function defaultAppearance() {
    var FA2 = root.FightAvatar, db = FA2.dbFromPage();
    return { A: FA2.appearanceFor("alexander-volkanovski", db), B: FA2.appearanceFor("justin-gaethje", db), R: Object.assign({}, FA2.REFEREE, db.referee || {}) };
  }
  /* appearance: { A, B, R } objects (FightAvatar.appearanceFor(slug) builds one from the roster).
     Skinned avatars replace the primitive figures as they finish building. */
  Show.prototype.setAppearance = function (app) {
    if (!this.avatarsOn || !app) return;
    var sc = this.arena.scene, self = this;
    var prev = this.appearance || {};
    this.appearance = app;
    [["A", this.A], ["B", this.B], ["R", this.R]].forEach(function (p) {
      if (!app[p[0]]) return;
      if (prev[p[0]] === app[p[0]] && p[1].avatar) return;   // unchanged side keeps its avatar
      var a = p[1];
      root.FightAvatar.attach(a, app[p[0]], sc).then(function (av) { if (av && self.phase === "live") av.setRound(self.rIdx); });
    });
  };
  Show.prototype.avatars = function () { return [this.A.avatar, this.B.avatar, this.R.avatar].filter(Boolean); };

  Show.prototype.resize = function (w, h) { this.arena.resize(w, h); };

  Show.prototype.cornerSpot = function (id, inset, out) {
    var va = FA.vertexAngle(id === "A" ? FA.BLUE_K : FA.RED_K), r = FA.RV - inset;
    return out.set(Math.cos(va) * r, 0, Math.sin(va) * r);
  };

  /* Appearance from the script's fighter info (app.js fills script.fighters with slug, appearance incl.
     likeness sheet, height, reach, stance, division); only sides whose look changed are rebuilt. */
  Show.prototype.appearanceFromScript = function (script) {
    var F = script && script.fighters, FA2 = root.FightAvatar, out = {}, cur = this.appearance || {}, any = false;
    if (!F || !FA2) return null;
    ["A", "B"].forEach(function (side) {
      var f = F[side]; if (!f || !f.slug) return;
      var a = FA2.appearanceFor(f.slug), k;
      if (f.appearance) for (k in f.appearance) if (f.appearance[k] != null && f.appearance[k] !== "") a[k] = f.appearance[k];
      ["height_in", "reach_in", "stance", "division"].forEach(function (k2) { if (f[k2]) a[k2] = f[k2]; });
      var c = cur[side];
      if (c && c.slug === a.slug && c.shorts === a.shorts && c.trim === a.trim) return;
      out[side] = a; any = true;
    });
    return any ? out : null;
  };

  Show.prototype.load = function (script) {
    if (this.avatarsOn) { var na = this.appearanceFromScript(script); if (na) this.setAppearance(Object.assign({}, this.appearance || {}, na)); }
    this.script = script; this.rIdx = 0; this.queue = []; this.clock = 0; this.finished = false; this.result = null;
    var A = this.A, B = this.B, R = this.R, F = (script && script.fighters) || {};
    A.setProfile(stanceProfile(F.A || (this.appearance && this.appearance.A)));
    B.setProfile(stanceProfile(F.B || (this.appearance && this.appearance.B)));
    [A, B, R].forEach(function (a) { a.act = null; a.react = null; a.feint = null; for (var k in a.s) a.s[k].reset(); a.lunge = 0; if (a.avatar) a.avatar.resetDamage(); });
    this.cornerSpot("A", 0.9, A.pos); this.cornerSpot("B", 0.9, B.pos);
    A.yaw = Math.atan2(-A.pos.x, -A.pos.z); B.yaw = Math.atan2(-B.pos.x, -B.pos.z);
    A.snapMode("walk"); B.snapMode("walk");
    R.pos.set(0, 0, 2.6); R.yaw = Math.PI; R.snapMode("ref"); R.hold = null;
    this.timers = []; this.pendingReplay = null; this.downed = null; this.phase = "intro";
    this.arena.stools.A.visible = this.arena.stools.B.visible = false;
    this.state = "stand"; this.timeScale = 1; this.slowT = 0; this.seqUntil = 0; this.ctrlOwner = null; this.rp = null;
    this.startIntro();
  };

  Show.prototype.startIntro = function () {
    var A = this.A, B = this.B, R = this.R;
    this.arena.stools.A.visible = this.arena.stools.B.visible = false;
    this.phase = "intro"; this.phaseT = 0;
    var ang = Math.atan2(B.pos.z - A.pos.z, B.pos.x - A.pos.x);
    this.introA = new V3(-Math.cos(ang) * 0.95, 0, -Math.sin(ang) * 0.95);
    this.introB = new V3(Math.cos(ang) * 0.95, 0, Math.sin(ang) * 0.95);
    A.setMode("walk", 0.4); B.setMode("walk", 0.4); R.setMode("ref", 0.3);
    A.walkTo = this.introA; B.walkTo = this.introB; A.faceTo = B.pos; B.faceTo = A.pos;
    R.walkTo = new V3(-Math.sin(ang) * 2.2, 0, Math.cos(ang) * 2.2); R.faceTo = this.M;
    if (this.hooks.onPhase) this.hooks.onPhase("intro", this.rIdx);
  };

  Show.prototype.beginRound = function () {
    var A = this.A, B = this.B;
    var rd = this.script.rounds[this.rIdx];
    this.queue = rd.beats.slice(); this.clock = 0; this.roundEnd = rd.endT;
    A.walkTo = B.walkTo = null; A.faceTo = B.faceTo = null;
    this.M.set((A.pos.x + B.pos.x) / 2, 0, (A.pos.z + B.pos.z) / 2);
    this.theta = Math.atan2(B.pos.z - A.pos.z, B.pos.x - A.pos.x);
    this.d = Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z);
    A.setMode("stand", 0.45); B.setMode("stand", 0.45);
    var ri = this.rIdx; [A, B].forEach(function (a) { if (a.avatar) a.avatar.setRound(ri); });
    this.state = "stand"; this.ctrlOwner = null;
    this.phase = "live"; this.phaseT = 0;
    if (this.hooks.onPhase) this.hooks.onPhase("live", this.rIdx);
  };

  Show.prototype.actor = function (id) { return id === "A" ? this.A : this.B; };

  /* ---- beat dispatch ---- */
  Show.prototype.canStart = function (b) {
    if (this.time < this.seqUntil) return false;
    if (b.k === "strike") {
      var a = this.actor(b.who);
      if (a.busy() || a.opp.tr > 0) return false;
      if (b.st === 0 && this.state !== "stand") return false;
      if (b.st === 1 && this.state !== "clinch") return false;
      return true;
    }
    return !this.A.busy() && !this.B.busy();
  };

  Show.prototype.dispatch = function (b) {
    var self = this, att = b.who ? this.actor(b.who) : null, def = att ? att.opp : null, H;
    if (b.k === "strike") {
      var power = (b.who === "B" ? 1.15 : 0.95) * (b.kd || b.fin ? 2.2 : (b.hurt ? 1.6 : 1));
      var onHit = function () {
        if (b.landed) {
          def.takeHit(b.move, power, att.act || { hi: 0, stance: att.stance });
          if (b.kd || b.fin || b.hurt) self.bigHit(b, att, def);
        }
        if (self.hooks.onImpact) self.hooks.onImpact(b);
      };
      var missOff = new V3();
      if (!b.landed) { def.left(missOff); missOff.multiplyScalar((this.rnd() < 0.5 ? 1 : -1) * 0.16).addScaledVector(UP, -0.05 - this.rnd() * 0.08); }
      if (this.state === "ground") {
        var top = this.ctrlOwner === b.who;
        if (top) att.startAction({ type: b.fin ? "gnp" : "gnp", hand: this.rnd() < 0.5 ? "lead" : "rear", dur: b.fin ? 0.3 : 0.38, def: def, landed: true, onHit: onHit });
        else att.startAction({ type: "upelbow", dur: 0.35, def: def, landed: true, onHit: onHit });
      } else if (KICK[b.move]) {
        att.startAction({ type: "kick", move: b.move, leg: KICK[b.move].leg, def: KICK[b.move], dur: KICK[b.move].dur, landed: b.landed, missOff: missOff, onHit: onHit });
        if (!b.landed) def.startReact(b.move === "calf" || b.move === "inside" ? { type: this.rnd() < 0.5 ? "check" : "back", dur: 0.42 } : { type: "back", dur: 0.45 });
      } else {
        var d = PUNCH[b.move] || PUNCH.jab;
        att.startAction({ type: "punch", move: PUNCH[b.move] ? b.move : "jab", hand: d.hand, def: d, dur: d.dur, landed: b.landed, missOff: missOff, onHit: onHit, lungeK: this.state === "clinch" ? 0 : 1 });
        if (!b.landed) {
          var rr = this.rnd(), react = d.body ? { type: "block", dur: 0.32 } : (rr < 0.5 ? { type: "slip", dir: missOff.dot(def.left(_v)) > 0 ? -1 : 1, dur: 0.34 } : (rr < 0.75 ? { type: "duck", dur: 0.34 } : (rr < 0.9 ? { type: "block", dur: 0.32 } : { type: "back", dur: 0.4 })));
          def.startReact(react);
        }
      }
      if (b.kd || b.fin) this.seqUntil = this.time + 0.6;
    } else if (b.k === "clinch") {
      this.state = "clinch"; this.A.setMode("clinch", 0.45); this.B.setMode("clinch", 0.45); this.clinchBy = b.who;
    } else if (b.k === "break") {
      this.state = "stand"; this.A.setMode("stand", 0.35); this.B.setMode("stand", 0.35);
      this.A.s.kb.v += 1.4; this.B.s.kb.v += 1.4;
    } else if (b.k === "td") {
      att.startAction({ type: "shoot", dur: 0.6, drive: Math.max(0, this.d - 0.45), onDone: function () { self.toGround(att, def); } });
      this.seqUntil = this.time + 1.3;
    } else if (b.k === "tdx") {
      att.startAction({ type: "shoot", dur: 0.62, drive: Math.max(0, this.d - 0.8) });
      def.startReact({ type: "sprawl", dur: 0.85 });
      this.seqUntil = this.time + 0.9;
    } else if (b.k === "up" || b.k === "reset") {
      if (this.state === "ground") this.standUp();
      else if (this.state === "clinch") { this.state = "stand"; this.A.setMode("stand", 0.35); this.B.setMode("stand", 0.35); }
    } else if (b.k === "sub" || b.k === "subx") {
      var fin = b.k === "sub";
      att.startAction({ type: "sub", dur: fin ? 2.2 : 1.3, def: def, hold: false, onDone: fin ? null : null });
      def.startReact({ type: fin ? "tap" : "defend", dur: fin ? 2.0 : 1.2 });
      this.seqUntil = this.time + (fin ? 2.2 : 1.35);
      if (fin) { this.finishBeat = b; this.impact.copy(def.pos); this.impactT = this.time + 1.6; this.later(1.8, function () { self.startFinish(b); }); }
    }
    if (b.txt && this.hooks.onText) this.hooks.onText(b, this.rIdx, b.t);
    if (this.hooks.onBeat) this.hooks.onBeat(b, this.rIdx);
  };

  Show.prototype.timers = null;
  Show.prototype.later = function (sec, fn) { (this.timers || (this.timers = [])).push({ at: this.time + sec, fn: fn }); };

  Show.prototype.toGround = function (att, def) {
    this.state = "ground"; this.ctrlOwner = att.id;
    def.fwd(_v);
    var back = new V3().copy(def.pos);
    // he lands on his back facing the man on top
    var dir = new V3(att.pos.x - def.pos.x, 0, att.pos.z - def.pos.z).normalize();
    back.addScaledVector(dir, -0.35);
    var lim = 3.55, r = Math.hypot(back.x, back.z); if (r > lim) back.multiplyScalar(lim / r);
    def.pos.copy(back); def.yaw = Math.atan2(dir.x, dir.z);
    att.pos.copy(back).addScaledVector(dir, 0.62); att.yaw = Math.atan2(-dir.x, -dir.z);
    def.setMode("bottom", 0.55, easeIn); att.setMode("top", 0.5);
    att.lunge = 0; def.lunge = 0;
  };

  Show.prototype.standUp = function () {
    var A = this.A, B = this.B;
    this.state = "stand"; this.ctrlOwner = null;
    A.setMode("stand", 0.85); B.setMode("stand", 0.85);
    // reset the pair frame from where they are
    var ang = Math.atan2(B.pos.z - A.pos.z, B.pos.x - A.pos.x);
    this.theta = ang; this.M.set((A.pos.x + B.pos.x) / 2, 0, (A.pos.z + B.pos.z) / 2); this.d = Math.max(0.7, Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z));
    A.yaw = Math.atan2(Math.cos(ang), Math.sin(ang)); B.yaw = Math.atan2(-Math.cos(ang), -Math.sin(ang));
    this.seqUntil = this.time + 0.9;
  };

  Show.prototype.resetPair = function () {
    var A = this.A, B = this.B;
    this.theta = Math.atan2(B.pos.z - A.pos.z, B.pos.x - A.pos.x);
    this.M.set((A.pos.x + B.pos.x) / 2, 0, (A.pos.z + B.pos.z) / 2);
    this.d = Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z);
  };

  Show.prototype.bigHit = function (b, att, def) {
    var self = this;
    this.cam.shake = b.fin ? 0.12 : 0.07;
    this.arena.burst(b.fin ? 0.5 : 0.25);
    this.impactT = this.time;
    var th = this.theta, p1 = th + Math.PI / 2, p2 = th - Math.PI / 2;
    this.replayAz = (Math.abs(angDiff(this.cam.az, p1)) < Math.abs(angDiff(this.cam.az, p2)) ? p1 : p2) + 0.35;
    this.impact.set((att.pos.x + def.pos.x) / 2, 0, (att.pos.z + def.pos.z) / 2);
    if (b.hurt) { def.startReact({ type: "wobble", dur: 0.9 }); def.s.kb.v += 1.4; att.lunge = 0; return; }
    this.timeScale = 0.3; this.slowT = 0.55;
    if (b.kd) {
      if (this.state === "ground") return;
      this.state = "stand";
      if (att.mode === "clinch") att.setMode("stand", 0.3);
      var fallDir = new V3(def.pos.x - att.pos.x, 0, def.pos.z - att.pos.z).normalize();
      def.pos.addScaledVector(fallDir, 0.25);
      def.setMode("down", 0.5, easeIn);
      this.seqUntil = this.time + 2.6;
      this.downed = def;
      this.later(0.55, function () { att.startAction({ type: "hammer", hand: "rear", dur: 0.42, def: def, lungeTo: 0.55, onHit: function () { def.takeHit("gnp", 0.8, { hi: 1, stance: att.stance }); } }); });
      this.later(1.05, function () { att.startAction({ type: "hammer", hand: "lead", dur: 0.4, def: def, lungeTo: 0.55, onHit: function () { def.takeHit("gnp", 0.7, { hi: 0, stance: att.stance }); } }); });
      this.later(1.6, function () { def.setMode("stand", 0.9); self.downed = null; self.resetPair(); });
      if (this.replays) this.pendingReplay = { at: this.time + 2.7, t0: this.time - 1.6, t1: this.time + 0.9 };
    } else if (b.fin) {
      this.finishBeat = b;
      if (this.state === "ground") { this.later(0.2, function () { self.startFinish(b); }); return; }
      var fd = new V3(def.pos.x - att.pos.x, 0, def.pos.z - att.pos.z).normalize();
      def.pos.addScaledVector(fd, 0.32);
      if (b.move === "calf") def.setMode("down", 0.6, easeIn); else def.setMode("ko", 0.65, easeIn);
      this.downed = def;
      this.later(0.5, function () { att.startAction({ type: "hammer", hand: "rear", dur: 0.38, def: def, lungeTo: 0.6, onHit: function () { def.takeHit("gnp", 0.6, { hi: 1, stance: att.stance }); } }); });
      this.later(0.95, function () { self.startFinish(b); });
    }
  };

  Show.prototype.startFinish = function (b) {
    var self = this, att = this.actor(b.who), def = att.opp, R = this.R;
    this.phase = "finish"; this.phaseT = 0; this.queue = [];
    R.setMode("refstop", 0.25); R.walkSpeed = 3.2;
    var mid = new V3().copy(def.pos).lerp(att.pos, 0.35);
    R.walkTo = mid; R.faceTo = att.pos;
    if (this.state === "ground" && b.k !== "sub") {
      // ground strikes finish: a flurry, then the referee dives in
      var n = 0;
      var flurry = function () {
        if (n++ >= 4) return;
        att.startAction({ type: "gnp", hand: n % 2 ? "lead" : "rear", dur: 0.26, def: def, landed: true, onHit: function () { def.takeHit("gnp", 1.2, { hi: n % 2, stance: att.stance }); } });
        self.later(0.27, flurry);
      };
      flurry();
      this.later(1.3, function () { def.setMode("ko", 0.5); att.pos.addScaledVector(att.fwd(_v), -0.5); att.setMode("celebrate", 0.6); att.walkTo = self.celebrateSpot(att); });
    } else if (b.k === "sub") {
      this.later(0.4, function () { att.setMode("celebrate", 0.7); att.walkTo = self.celebrateSpot(att); def.setMode("down", 0.6); });
    } else {
      this.later(0.6, function () { att.setMode("celebrate", 0.6); att.walkTo = self.celebrateSpot(att); });
    }
    this.later(2.4, function () { R.setMode("ref", 0.4); R.walkSpeed = 1.2; });
    this.result = { winner: b.who, method: this.script.method, round: this.rIdx + 1, t: b.t };
    if (this.hooks.onFinish) this.hooks.onFinish(this.result);
    if (this.replays) this.pendingReplay = { at: this.time + 2.6, t0: this.impactT - 1.8, t1: this.impactT + 1.1, final: true };
    else this.later(2.6, function () { self.toResult(); });
  };

  Show.prototype.celebrateSpot = function (a) {
    var r = Math.hypot(a.pos.x, a.pos.z) || 1;
    var out = new V3(a.pos.x / r * 3.0, 0, a.pos.z / r * 3.0);
    if (r < 0.5) out.set(3, 0, 0);
    return out;
  };

  Show.prototype.toResult = function () {
    this.phase = "result"; this.phaseT = 0;
    if (this.hooks.onResult) this.hooks.onResult(this.result || { winner: this.script.winner, method: this.script.method });
  };

  Show.prototype.endRound = function () {
    var self = this, A = this.A, B = this.B, R = this.R, rd = this.script.rounds[this.rIdx];
    this.phase = "break"; this.phaseT = 0; this.state = "stand"; this.ctrlOwner = null;
    if (this.hooks.onRoundEnd) this.hooks.onRoundEnd(this.rIdx, rd);
    var last = this.rIdx >= 4;
    if (last) { this.startDecision(); return; }
    var bs = this.speed >= 10 ? 0.65 : 1;
    A.setMode("walk", 0.6); B.setMode("walk", 0.6); A.walkSpeed = B.walkSpeed = 1.7;
    A.walkTo = this.cornerSpot("A", 0.62, new V3()); B.walkTo = this.cornerSpot("B", 0.62, new V3());
    A.faceTo = B.faceTo = new V3(0, 0, 0);
    R.walkTo = new V3(0, 0, 0.0); R.faceTo = null;
    this.arena.stools.A.visible = this.arena.stools.B.visible = true;
    this.later(2.3 * bs, function () {
      [A, B].forEach(function (a) { a.walkTo = null; a.setMode("sit", 0.55); });
    });
    var stop = rd.stoppage;
    if (stop) {
      var loser = stop === "A" ? B : A, winner = this.actor(stop);
      this.later(3.0 * bs, function () {
        R.setMode("refstop", 0.3); R.walkTo = self.cornerSpot(loser.id, 1.3, new V3()); R.walkSpeed = 2.2;
        winner.setMode("celebrate", 0.7); winner.walkTo = new V3(0, 0, 0.5);
        self.phase = "finish"; self.result = { winner: stop, method: "CORNER", round: self.rIdx + 1, t: 300 };
        if (self.hooks.onFinish) self.hooks.onFinish(self.result);
      });
      this.later(6.2 * bs, function () { R.setMode("ref", 0.4); R.walkSpeed = 1.2; self.toResult(); });
      return;
    }
    this.later(4.6 * bs, function () {
      self.rIdx++; A.walkSpeed = B.walkSpeed = 1.2;
      self.arena.stools.A.visible = self.arena.stools.B.visible = false;
      A.setMode("walk", 0.5); B.setMode("walk", 0.5);
      self.startIntro();
    });
  };

  Show.prototype.startDecision = function () {
    var self = this, A = this.A, B = this.B, R = this.R;
    this.phase = "decision"; this.phaseT = 0;
    A.setMode("walk", 0.6); B.setMode("walk", 0.6); R.setMode("ref", 0.3);
    A.walkTo = new V3(-0.75, 0, 0.35); B.walkTo = new V3(0.75, 0, 0.35); R.walkTo = new V3(0, 0, 0.35);
    var faceSpot = new V3(0, 0, 6);
    A.faceTo = faceSpot; B.faceTo = faceSpot; R.faceTo = faceSpot;
    var w = this.script.winner;
    this.later(3.2, function () {
      if (self.hooks.onDecision) self.hooks.onDecision(self.script);
      [A, B].forEach(function (a) {
        a.setMode("raised", 0.3);
        a.raiseSide = a.id === "A" ? 0 : 1;   // the hand nearest the referee
        a.armTarget = (w === "D" || w === a.id) ? 1 : 0;
      });
      R.hold = [{ a: B, i: 1 }, { a: A, i: 0 }];
      self.result = { winner: w, method: self.script.method, round: 5, t: 300 };
    });
    this.later(5.4, function () { self.toResult(); });
  };

  /* ---- per-frame update ---- */
  Show.prototype.updatePair = function (dt) {
    var A = this.A, B = this.B;
    var clinch = this.state === "clinch";
    this.omTimer -= dt;
    if (this.omTimer <= 0) {
      this.omTimer = 1.8 + this.rnd() * 2.6;
      var opts = [-0.42, -0.22, -0.1, 0, 0.1, 0.22, 0.42], circ = 0.55 + 0.9 * (A.prof.foot.circling + B.prof.foot.circling) / 2;
      this.omT = clinch ? 0 : opts[Math.floor(this.rnd() * opts.length)] * circ;
      var io = (A.prof.foot.inout + B.prof.foot.inout) / 2;
      this.range = 1.42 + 0.1 * io + this.rnd() * (0.18 + 0.22 * io);
    }
    var ax = Math.cos(this.theta), az = Math.sin(this.theta);
    var aPos = _v.set(this.M.x - ax * this.d / 2, 0, this.M.z - az * this.d / 2), bPos = _w.set(this.M.x + ax * this.d / 2, 0, this.M.z + az * this.d / 2);
    var ra = Math.hypot(aPos.x, aPos.z), rb = Math.hypot(bPos.x, bPos.z);
    var lim = clinch ? 3.75 : 3.45;
    if (ra > lim || rb > lim) {
      var worst = ra > rb ? aPos : bPos, sgn = ax * worst.z - az * worst.x;
      this.omT = (sgn > 0 ? -1 : 1) * 0.55 * (clinch ? 0.2 : 1);
      var push = (Math.max(ra, rb) - lim) * 1.8;
      var mr = Math.hypot(this.M.x, this.M.z) || 1;
      this.M.x -= this.M.x / mr * push * dt; this.M.z -= this.M.z / mr * push * dt;
    }
    this.om += (this.omT - this.om) * Math.min(1, dt * 1.6);
    this.theta += this.om * dt;
    var pa = A.prof.foot.pressure, pb = B.prof.foot.pressure;
    var press = clinch ? 0.32 : 0.05 + 0.2 * Math.abs(pa - pb);
    var dirSign = clinch ? (this.clinchBy === "A" ? 1 : -1) : (pa > pb ? 1 : -1);
    this.M.x += ax * press * dirSign * dt; this.M.z += az * press * dirSign * dt;
    var mr2 = Math.hypot(this.M.x, this.M.z);
    if (!clinch && mr2 > 2.2) { this.M.x -= this.M.x / mr2 * (mr2 - 2.2) * 0.4 * dt; this.M.z -= this.M.z / mr2 * (mr2 - 2.2) * 0.4 * dt; }
    var target = (clinch ? 0.6 : this.range) - A.lunge - B.lunge + A.s.kb.x * 0.25 + B.s.kb.x * 0.25;
    if (this.downed) target = Math.max(target, 1.15);
    var striking = (A.act && (A.act.type === "punch" || A.act.type === "kick")) || (B.act && (B.act.type === "punch" || B.act.type === "kick"));
    var punching = (A.act && A.act.type === "punch") || (B.act && B.act.type === "punch");
    // a strike may close to about a step inside the usual minimum (the attacker steps in behind the punch)
    this.d += (Math.max(clinch ? 0.5 : (punching ? 0.66 : 0.98), target) - this.d) * Math.min(1, dt * (striking ? 45 : 7));
    ax = Math.cos(this.theta); az = Math.sin(this.theta);
    var nax = this.M.x - ax * this.d / 2, naz = this.M.z - az * this.d / 2, nbx = this.M.x + ax * this.d / 2, nbz = this.M.z + az * this.d / 2;
    A.vel.set((nax - A.pos.x) / Math.max(dt, 1e-3), 0, (naz - A.pos.z) / Math.max(dt, 1e-3));
    B.vel.set((nbx - B.pos.x) / Math.max(dt, 1e-3), 0, (nbz - B.pos.z) / Math.max(dt, 1e-3));
    if (A.mode !== "down" && A.mode !== "ko") { A.pos.set(nax, 0, naz); A.yaw = Math.atan2(ax, az); }
    if (B.mode !== "down" && B.mode !== "ko") { B.pos.set(nbx, 0, nbz); B.yaw = Math.atan2(-ax, -az); }
  };

  Show.prototype.updateWalker = function (a, dt) {
    if (!a.walkTo) { a.vel.set(0, 0, 0); if (a.faceTo) { var fy = Math.atan2(a.faceTo.x - a.pos.x, a.faceTo.z - a.pos.z); a.yaw += angDiff(fy, a.yaw) * Math.min(1, dt * 5); } return; }
    var dx = a.walkTo.x - a.pos.x, dz = a.walkTo.z - a.pos.z, dist = Math.hypot(dx, dz);
    var sp = Math.min(a.walkSpeed, dist * 2.5);
    if (dist > 0.03) {
      a.vel.set(dx / dist * sp, 0, dz / dist * sp);
      a.pos.addScaledVector(a.vel, dt);
      var wantYaw = (dist > 0.35 || !a.faceTo) ? Math.atan2(dx, dz) : Math.atan2(a.faceTo.x - a.pos.x, a.faceTo.z - a.pos.z);
      a.yaw += angDiff(wantYaw, a.yaw) * Math.min(1, dt * 6);
    } else {
      a.vel.set(0, 0, 0);
      if (a.faceTo) { var fy2 = Math.atan2(a.faceTo.x - a.pos.x, a.faceTo.z - a.pos.z); a.yaw += angDiff(fy2, a.yaw) * Math.min(1, dt * 5); }
    }
  };

  Show.prototype.updateRef = function (dt) {
    var R = this.R;
    if (this.phase === "live") {
      var cam = this.cam.pos, ax = Math.cos(this.theta), az = Math.sin(this.theta);
      var nx = -az, nz = ax;
      if ((cam.x - this.M.x) * nx + (cam.z - this.M.z) * nz > 0) { nx = -nx; nz = -nz; }
      var dist = this.state === "ground" ? 1.9 : (this.state === "clinch" ? 1.9 : 2.4);
      var c = this.state === "ground" ? _u.set((this.A.pos.x + this.B.pos.x) / 2, 0, (this.A.pos.z + this.B.pos.z) / 2) : this.M;
      var side = Math.sin(this.time * 0.11) > 0 ? 1 : -1;
      var tx = c.x + nx * dist + ax * 0.9 * side, tz = c.z + nz * dist + az * 0.9 * side, r = Math.hypot(tx, tz);
      if (r > 3.7) { tx *= 3.7 / r; tz *= 3.7 / r; }
      R.walkTo = R.walkTo || new V3(); R.walkTo.set(tx, 0, tz); R.faceTo = c; R.walkSpeed = 1.5;
    }
    this.updateWalker(R, dt);
  };

  Show.prototype.frame = function (dtReal) {
    if (!this.script) { this.arena.render(); return; }
    var dt = Math.min(dtReal, 1 / 20);
    if (this.paused) { this.render(); return; }
    // slow motion after big shots
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.timeScale = 1; }
    else if (this.timeScale < 1) this.timeScale = Math.min(1, this.timeScale + dt * 1.5);
    var adt = dt * this.timeScale;

    if (this.phase === "replay") { this.stepReplay(dt); this.render(); return; }

    this.time += adt; this.phaseT += adt;
    // timers
    if (this.timers && this.timers.length) {
      var due = [], keep = [];
      for (var i = 0; i < this.timers.length; i++) (this.timers[i].at <= this.time ? due : keep).push(this.timers[i]);
      this.timers = keep; for (i = 0; i < due.length; i++) due[i].fn();
    }
    if (this.pendingReplay && this.time >= this.pendingReplay.at) { var pr = this.pendingReplay; this.pendingReplay = null; this.startReplay(pr); this.render(); return; }

    var A = this.A, B = this.B;
    if (this.phase === "intro") {
      this.updateWalker(A, adt); this.updateWalker(B, adt);
      var near = Math.hypot(A.pos.x - this.introA.x, A.pos.z - this.introA.z) < 0.08 && Math.hypot(B.pos.x - this.introB.x, B.pos.z - this.introB.z) < 0.08;
      if ((near && this.phaseT > 1.0) || this.phaseT > 4) this.beginRound();
    } else if (this.phase === "live") {
      this.clock = Math.min(this.roundEnd, this.clock + adt * this.speed);
      var guard = 0;
      while (this.queue.length && guard++ < 6) {
        var b = this.queue[0];
        if (b.t > this.clock && !(b.chain && this.queue.length)) break;
        if (b.chain && b.t > this.clock + 2.5) break;
        if (!this.canStart(b)) {
          var lagReal = (this.clock - b.t) / this.speed;
          if (b.miss && lagReal > 0.5) { this.queue.shift(); continue; }
          break;
        }
        this.queue.shift(); this.dispatch(b);
        if (this.phase !== "live") break;
      }
      if (this.phase === "live") {
        if (this.state === "stand" || this.state === "clinch") this.updatePair(adt);
        if (this.clock >= this.roundEnd && !this.queue.length && !A.busy() && !B.busy() && this.time > this.seqUntil && !this.script.rounds[this.rIdx].fin) this.endRound();
      }
      if (this.hooks.onClock) this.hooks.onClock(this.rIdx, this.clock, this.state, this.ctrlOwner);
    } else if (this.phase === "break" || this.phase === "decision" || this.phase === "finish" || this.phase === "result") {
      if (A.walkTo || A.faceTo) this.updateWalker(A, adt);
      if (B.walkTo || B.faceTo) this.updateWalker(B, adt);
      if (this.phase === "decision") {
        [A, B].forEach(function (a) { if (a.mode === "raised") a.armUp += ((a.armTarget || 0) - a.armUp) * Math.min(1, adt * 3); });
      }
    }
    this.updateRef(adt);
    A.update(adt); B.update(adt); this.R.update(adt);
    this.replay.record(this.time);
    this.arena.tickFx(dt);
    this.render(dt);
  };

  Show.prototype.render = function (dt) {
    var A = this.A, B = this.B;
    if (this.state === "ground" || this.phase !== "live") this.focus.set((A.pos.x + B.pos.x) / 2, 0, (A.pos.z + B.pos.z) / 2);
    else this.focus.copy(this.M);
    var th = this.phase === "live" ? this.theta : Math.atan2(B.pos.z - A.pos.z, B.pos.x - A.pos.x);
    this.cam.update(dt || 1 / 60, { focus: this.focus, theta: th, phase: this.phase, state: this.state, impact: this.impact, replayT: this.replayT, replayAz: this.replayAz, time: this.time, narrow: this.arena.camera.aspect < 1.25 });
    if (A.avatar) A.avatar.sync(); if (B.avatar) B.avatar.sync(); if (this.R.avatar) this.R.avatar.sync();
    this.arena.render();
  };

  Show.prototype.startReplay = function (pr) {
    var span = this.replay.span(); if (!span) return;
    this.replay.stash();
    this.avatars().forEach(function (av) { if (av.stashLive) av.stashLive(); });
    this.rp = { t0: Math.max(span[0], pr.t0), t1: Math.min(span[1], pr.t1), final: pr.final, prevPhase: this.phase };
    this.replayT = 0; this.phase = "replay";
    if (this.hooks.onReplay) this.hooks.onReplay(true);
  };
  Show.prototype.stepReplay = function (dt) {
    var rp = this.rp; this.replayT += dt;
    var t = rp.t0 + this.replayT * 0.42;
    this.replay.show(Math.min(t, rp.t1));
    if (t >= rp.t1 + 0.25) this.endReplay();
  };
  Show.prototype.endReplay = function () {
    var rp = this.rp; if (!rp) return;
    this.replay.unstash(); this.rp = null;
    this.avatars().forEach(function (av) { if (av.unstashLive) av.unstashLive(); });
    this.phase = rp.prevPhase === "replay" ? "live" : rp.prevPhase;
    if (this.hooks.onReplay) this.hooks.onReplay(false);
    if (rp.final) this.toResult();
  };
  Show.prototype.skip = function () {
    if (this.phase === "replay") { this.endReplay(); return true; }
    return false;
  };

  root.FightShow = { Show: Show, SPECS: SPECS, Actor: Actor, stanceProfile: stanceProfile, neutralProfile: neutralProfile };
})(typeof window !== "undefined" ? window : globalThis);
