/* The arena: octagon canvas, fence, posts, apron, overhead rig, crowd, lights and the camera. */
(function (root) {
  "use strict";
  var T = root.THREE;
  if (!T) return;

  var APO = 4.3, RV = APO / Math.cos(Math.PI / 8);
  function vertexAngle(k) { return Math.PI / 8 + k * Math.PI / 4; }
  var BLUE_K = 4, RED_K = 0;   // blue corner on the -X side, red corner on +X

  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function canvasTex(w, h, draw) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    var t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  function paintMat(ctx, S, fonts) {
    var disp = fonts ? '"Big Shoulders Display", "Arial Narrow", sans-serif' : '"Arial Narrow", Arial, sans-serif';
    var ui = fonts ? '"Archivo", Arial, sans-serif' : 'Arial, sans-serif';
    var cx = S / 2, scale = S / (2 * RV);
    ctx.fillStyle = "#cfd5dc"; ctx.fillRect(0, 0, S, S);
    // fabric grain
    var r = rng(11);
    for (var i = 0; i < 2600; i++) { ctx.fillStyle = r() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)"; ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
    function oct(rad, k0) {
      ctx.beginPath();
      for (var k = 0; k < 8; k++) { var a = vertexAngle(k); var x = cx + Math.cos(a) * rad * scale, y = cx + Math.sin(a) * rad * scale; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath();
    }
    // outer band and fence line
    oct(RV, 0); ctx.fillStyle = "#b9c0c8"; ctx.fill();
    oct(RV * 0.87, 0); ctx.fillStyle = "#d3d9df"; ctx.fill();
    ctx.lineWidth = S * 0.004; ctx.strokeStyle = "rgba(20,24,30,0.35)"; oct(RV * 0.87, 0); ctx.stroke();
    // centre circle
    ctx.beginPath(); ctx.arc(cx, cx, 1.05 * scale, 0, Math.PI * 2); ctx.fillStyle = "#c3cad2"; ctx.fill();
    ctx.lineWidth = S * 0.003; ctx.strokeStyle = "rgba(20,24,30,0.45)"; ctx.stroke();
    ctx.save(); ctx.translate(cx, cx); ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "rgba(18,22,28,0.78)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "900 " + Math.round(S * 0.105) + "px " + disp; ctx.fillText("155", 0, -S * 0.012);
    ctx.font = "700 " + Math.round(S * 0.018) + "px " + ui; ctx.fillStyle = "rgba(18,22,28,0.6)";
    ctx.fillText("FIVE ROUNDS  ·  MONTE CARLO", 0, S * 0.058);
    ctx.restore();
    // band lettering on two flats
    ctx.fillStyle = "rgba(18,22,28,0.42)"; ctx.font = "800 " + Math.round(S * 0.03) + "px " + disp; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    [[0, -1, 0], [0, 1, Math.PI]].forEach(function (d) {
      ctx.save(); ctx.translate(cx + d[0] * APO * 0.935 * scale, cx + d[1] * APO * 0.935 * scale); ctx.rotate(d[2]);
      ctx.fillText("VOLKANOVSKI  ·  GAETHJE", 0, 0); ctx.restore();
    });
    // corner marks
    [[BLUE_K, "#2a78d6"], [RED_K, "#e34948"]].forEach(function (c) {
      var a = vertexAngle(c[0]);
      ctx.beginPath();
      var x0 = cx + Math.cos(a) * RV * scale, y0 = cx + Math.sin(a) * RV * scale;
      var x1 = cx + Math.cos(a - 0.17) * RV * 0.8 * scale, y1 = cx + Math.sin(a - 0.17) * RV * 0.8 * scale;
      var x2 = cx + Math.cos(a + 0.17) * RV * 0.8 * scale, y2 = cx + Math.sin(a + 0.17) * RV * 0.8 * scale;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
      ctx.fillStyle = c[1]; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
    });
  }

  function chainTex() {
    var t = canvasTex(256, 256, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 5; ctx.lineCap = "round";
      for (var i = -4; i <= 8; i++) {
        ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64 + 256, 256); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i * 64, 256); ctx.lineTo(i * 64 + 256, 0); ctx.stroke();
      }
    });
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.encoding = T.LinearEncoding;
    return t;
  }

  function Arena(canvas, opts) {
    opts = opts || {};
    var renderer = this.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, opts.maxDpr || 1.75));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    var scene = this.scene = new T.Scene();
    scene.background = new T.Color(0x06070a);
    scene.fog = new T.Fog(0x06070a, 15, 40);
    var cam = this.camera = new T.PerspectiveCamera(36, 1, 0.1, 120);
    cam.position.set(0, 4, 9);

    // lights
    scene.add(new T.HemisphereLight(0x9fb0c6, 0x0a0b0e, 0.42));
    var key = this.key = new T.SpotLight(0xffffff, 2.1, 0, 0.62, 0.55, 1);
    key.position.set(0, 11.5, 0.6); key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(opts.shadow || 2048, opts.shadow || 2048);
    key.shadow.camera.near = 6; key.shadow.camera.far = 16;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    scene.add(key); scene.add(key.target);
    var f1 = new T.DirectionalLight(0xdfe8ff, 0.42); f1.position.set(8, 6, 6); scene.add(f1);
    var f2 = new T.DirectionalLight(0xfff1e0, 0.36); f2.position.set(-8, 5, -6); scene.add(f2);
    var blueRim = new T.PointLight(0x3d7ff0, 1.1, 14, 2), redRim = new T.PointLight(0xff4a45, 1.1, 14, 2);
    blueRim.position.set(Math.cos(vertexAngle(BLUE_K)) * 7, 3.2, Math.sin(vertexAngle(BLUE_K)) * 7);
    redRim.position.set(Math.cos(vertexAngle(RED_K)) * 7, 3.2, Math.sin(vertexAngle(RED_K)) * 7);
    scene.add(blueRim); scene.add(redRim);

    // canvas
    var shape = new T.Shape();
    for (var k = 0; k < 8; k++) { var a = vertexAngle(k); if (k === 0) shape.moveTo(Math.cos(a) * RV, Math.sin(a) * RV); else shape.lineTo(Math.cos(a) * RV, Math.sin(a) * RV); }
    var matTex = this.matTex = canvasTex(1024, 1024, function (ctx, S) { paintMat(ctx, S, false); });
    matTex.repeat.set(1 / (2 * RV), 1 / (2 * RV)); matTex.offset.set(0.5, 0.5);
    var floorMesh = new T.Mesh(new T.ShapeGeometry(shape), new T.MeshStandardMaterial({ map: matTex, roughness: 0.92, metalness: 0 }));
    floorMesh.rotation.x = -Math.PI / 2;   // face up; shape (x, y) lands at world (x, -y), mapped back in the UVs
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);
    this.repaintMat = function () {
      var c = matTex.image, ctx = c.getContext("2d");
      paintMat(ctx, c.width, true); matTex.needsUpdate = true;
    };

    // apron and skirt
    var apronShape = new T.Shape();
    var RO = RV + 1.25;
    for (k = 0; k < 8; k++) { a = vertexAngle(k); if (k === 0) apronShape.moveTo(Math.cos(a) * RO, Math.sin(a) * RO); else apronShape.lineTo(Math.cos(a) * RO, Math.sin(a) * RO); }
    var hole = new T.Path();
    for (k = 7; k >= 0; k--) { a = vertexAngle(k); if (k === 7) hole.moveTo(Math.cos(a) * RV, Math.sin(a) * RV); else hole.lineTo(Math.cos(a) * RV, Math.sin(a) * RV); }
    apronShape.holes.push(hole);
    var apron = new T.Mesh(new T.ShapeGeometry(apronShape), new T.MeshStandardMaterial({ color: 0x101216, roughness: 0.8 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.004; apron.receiveShadow = true; scene.add(apron);
    var skirt = new T.Mesh(new T.CylinderGeometry(RO, RO, 1.2, 8, 1, true, 3 * Math.PI / 8), new T.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.9, side: T.DoubleSide }));
    skirt.position.y = -0.6; scene.add(skirt);
    var ground = new T.Mesh(new T.PlaneGeometry(90, 90), new T.MeshStandardMaterial({ color: 0x090a0d, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; scene.add(ground);

    // fence
    var side = 2 * RV * Math.sin(Math.PI / 8);
    var ctex = chainTex(); ctex.repeat.set(side / 0.3, 1.62 / 0.3);
    var fenceMat = new T.MeshStandardMaterial({ color: 0x2a2d33, map: ctex, alphaMap: ctex, transparent: true, alphaTest: 0.3, side: T.DoubleSide, roughness: 0.55, metalness: 0.35, depthWrite: true });
    var padMat = new T.MeshStandardMaterial({ color: 0x15171b, roughness: 0.55, metalness: 0.05 });
    var postMat = new T.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.45, metalness: 0.2 });
    var fenceGroup = this.fence = new T.Group(); scene.add(fenceGroup);
    for (k = 0; k < 8; k++) {
      var am = vertexAngle(k) + Math.PI / 8;
      var mx = Math.cos(am) * APO, mz = Math.sin(am) * APO, rotY = Math.PI / 2 - am;
      var panel = new T.Mesh(new T.PlaneGeometry(side, 1.62), fenceMat);
      panel.position.set(mx, 0.12 + 0.81, mz); panel.rotation.y = rotY; fenceGroup.add(panel);
      var rail = new T.Mesh(new T.BoxGeometry(side, 0.12, 0.14), padMat);
      rail.position.set(mx * 1.003, 1.8, mz * 1.003); rail.rotation.y = rotY; rail.castShadow = true; fenceGroup.add(rail);
      var base = new T.Mesh(new T.BoxGeometry(side, 0.15, 0.16), padMat);
      base.position.set(mx * 1.01, 0.075, mz * 1.01); base.rotation.y = rotY; base.receiveShadow = true; fenceGroup.add(base);
      var va = vertexAngle(k);
      var post = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 1.72, 10), (k === BLUE_K || k === RED_K) ? new T.MeshStandardMaterial({ color: k === BLUE_K ? 0x1f5fb0 : 0xb7302f, roughness: 0.5 }) : postMat);
      post.position.set(Math.cos(va) * RV, 0.92, Math.sin(va) * RV); post.castShadow = true; fenceGroup.add(post);
      var cap = new T.Mesh(new T.SphereGeometry(0.11, 10, 8), padMat); cap.position.set(Math.cos(va) * RV, 1.8, Math.sin(va) * RV); fenceGroup.add(cap);
    }

    // overhead rig
    var rig = new T.Group(); scene.add(rig);
    var trussMat = new T.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.6 });
    var lampMat = new T.MeshBasicMaterial({ color: 0xffffff });
    for (k = 0; k < 8; k++) {
      var a1 = vertexAngle(k) + Math.PI / 8;
      var tr = new T.Mesh(new T.BoxGeometry(2 * 5.4 * Math.sin(Math.PI / 8) * 1.08, 0.3, 0.3), trussMat);
      tr.position.set(Math.cos(a1) * 5.4 * Math.cos(Math.PI / 8), 7.4, Math.sin(a1) * 5.4 * Math.cos(Math.PI / 8)); tr.rotation.y = Math.PI / 2 - a1; rig.add(tr);
      for (var j = -1; j <= 1; j += 2) {
        var lamp = new T.Mesh(new T.BoxGeometry(0.5, 0.05, 0.28), lampMat);
        var off = j * 0.9;
        lamp.position.set(tr.position.x + Math.cos(Math.PI / 2 - a1) * off, 7.22, tr.position.z - Math.sin(Math.PI / 2 - a1) * off);
        lamp.rotation.y = tr.rotation.y; rig.add(lamp);
      }
    }

    // stools for the breaks
    var stoolMat = new T.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.6, metalness: 0.3 });
    this.stools = {};
    var self = this;
    [["A", BLUE_K], ["B", RED_K]].forEach(function (s) {
      var g = new T.Group(); var va = vertexAngle(s[1]);
      g.position.set(Math.cos(va) * (RV - 0.62), 0, Math.sin(va) * (RV - 0.62));
      var seat = new T.Mesh(new T.CylinderGeometry(0.21, 0.19, 0.06, 16), stoolMat); seat.position.y = 0.43; seat.castShadow = true; g.add(seat);
      var leg = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.42, 8), stoolMat); leg.position.y = 0.21; g.add(leg);
      var foot = new T.Mesh(new T.CylinderGeometry(0.17, 0.2, 0.03, 16), stoolMat); foot.position.y = 0.015; g.add(foot);
      g.visible = false; scene.add(g); self.stools[s[0]] = g;
    });

    // crowd
    var prof = [[0.0, 0], [0.21, 0], [0.24, 0.3], [0.23, 0.5], [0.16, 0.6], [0.07, 0.64], [0.075, 0.68], [0.1, 0.74], [0.105, 0.8], [0.09, 0.87], [0.05, 0.91], [0.0, 0.92]];
    var pawn = new T.LatheGeometry(prof.map(function (p) { return new T.Vector2(Math.max(1e-3, p[0]), p[1]); }), 8);
    var seats = [], rr = rng(7);
    for (var row = 0; row < 12; row++) {
      var rad = 7.4 + row * 0.92, yy = -1.2 + 0.48 * row + (row > 0 ? 0.25 : 0.05);
      var n = Math.floor(2 * Math.PI * rad / 0.62);
      for (var s2 = 0; s2 < n; s2++) {
        var ang = (s2 + (row % 2) * 0.5) / n * Math.PI * 2;
        var gap = false;
        for (k = 0; k < 4; k++) { var aisle = vertexAngle(k * 2 + 1); var dd = Math.abs(Math.atan2(Math.sin(ang - aisle), Math.cos(ang - aisle))); if (dd < 0.045) gap = true; }
        if (gap || rr() < 0.06) continue;
        seats.push([Math.cos(ang) * rad, yy, Math.sin(ang) * rad, ang]);
      }
    }
    var crowd = new T.InstancedMesh(pawn, new T.MeshStandardMaterial({ roughness: 1, metalness: 0 }), seats.length);
    var dummy = new T.Object3D(), col = new T.Color();
    var pal = [0x1b2230, 0x262a31, 0x30251f, 0x1f2c36, 0x3f444c, 0x4e2626, 0x24385a, 0x9fa5ad, 0x171a1f, 0x5c4a3a, 0x2f3b2c];
    for (var c2 = 0; c2 < seats.length; c2++) {
      var st = seats[c2];
      dummy.position.set(st[0], st[1], st[2]);
      dummy.rotation.set(0, -st[3] - Math.PI / 2, 0);
      var sc = 0.92 + rr() * 0.2; dummy.scale.set(sc, sc * (0.95 + rr() * 0.15), sc);
      dummy.updateMatrix(); crowd.setMatrixAt(c2, dummy.matrix);
      col.setHex(pal[Math.floor(rr() * pal.length)]).multiplyScalar(0.55 + rr() * 0.5);
      crowd.setColorAt(c2, col);
    }
    crowd.instanceMatrix.needsUpdate = true; if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    scene.add(crowd);
    this.crowdLight = new T.PointLight(0xb8c4d8, 0.0, 30, 1.5); this.crowdLight.position.set(0, 6, 0); scene.add(this.crowdLight);

    // camera flashes in the stands
    var NF = 220, fpos = new Float32Array(NF * 3), fcol = new Float32Array(NF * 3);
    for (var f = 0; f < NF; f++) { var sp = seats[Math.floor(rr() * seats.length)]; fpos[f * 3] = sp[0]; fpos[f * 3 + 1] = sp[1] + 0.95; fpos[f * 3 + 2] = sp[2]; }
    var fg = new T.BufferGeometry();
    fg.setAttribute("position", new T.BufferAttribute(fpos, 3));
    fg.setAttribute("color", new T.BufferAttribute(fcol, 3));
    var spark = canvasTex(64, 64, function (ctx, w) {
      var g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.75)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    });
    this.flashes = new T.Points(fg, new T.PointsMaterial({ size: 0.42, map: spark, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true }));
    scene.add(this.flashes);
    this.flashLevel = 0.004;
    this.flashRng = rng(99);
  }

  Arena.prototype.resize = function (w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };
  Arena.prototype.tickFx = function (dt) {
    var colA = this.flashes.geometry.attributes.color, arr = colA.array, r = this.flashRng;
    for (var i = 0; i < arr.length; i += 3) {
      var v = arr[i] * Math.exp(-dt * 16);
      if (r() < this.flashLevel * dt * 60) v = 0.6 + r() * 0.4;
      arr[i] = arr[i + 1] = arr[i + 2] = v;
    }
    colA.needsUpdate = true;
    this.flashLevel += (0.004 - this.flashLevel) * Math.min(1, dt * 0.8);
  };
  Arena.prototype.burst = function (lvl) { this.flashLevel = Math.max(this.flashLevel, lvl); };
  Arena.prototype.render = function () { this.renderer.render(this.scene, this.camera); };

  root.FightArena = { Arena: Arena, APO: APO, RV: RV, vertexAngle: vertexAngle, BLUE_K: BLUE_K, RED_K: RED_K };
})(typeof window !== "undefined" ? window : globalThis);
