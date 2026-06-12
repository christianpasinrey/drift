// ═══════════════════════════════════════════════════════════
//  DRIFT — WebGL scene
//  Sky dome · physically-displaced Gerstner ocean · sailboat that
//  rides the real surface · circling gulls · day–night lighting.
// ═══════════════════════════════════════════════════════════

import * as THREE from "three";
import { gerstnerGLSL, sampleWave, WAVE_A, WAVE_B } from "./waves.js";
import { SKY_GLSL, skyState, makeSkyState } from "./sky.js";

const UP = new THREE.Vector3(0, 1, 0);

export class Scene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 16000);
    this.camera.position.set(0, 4, 12);

    this.clock = new THREE.Clock();
    this.time = 0;                 // wave time (seconds, scaled)
    this.sky = makeSkyState();
    this._sunDir = new THREE.Vector3();
    this._tmpN = new THREE.Vector3();
    this._q1 = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._q3 = new THREE.Quaternion();
    this._fwd = new THREE.Vector3(1, 0, 0);   // boat local forward (bow at +x)

    this._lights();
    this._buildSky();
    this._buildOcean();
    this._buildBoat();
    this._buildGulls();

    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  // ───────── lighting (re-coloured each frame) ─────────
  _lights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.scene.add(this.sun);
    this.ambient = new THREE.HemisphereLight(0x88aacc, 0x223044, 0.6);
    this.scene.add(this.ambient);
    this.lantern = new THREE.PointLight(0xffb060, 0.0, 9, 2);
    this.scene.add(this.lantern);
  }

  // ───────── sky dome ─────────
  _buildSky() {
    const geo = new THREE.SphereGeometry(7000, 48, 24);
    this.skyUniforms = {
      uSunDir: { value: this._sunDir },
      uZenith: { value: this.sky.zenith },
      uHorizon: { value: this.sky.horizon },
      uSun: { value: this.sky.sun },
      uFog: { value: this.sky.fog },
      uSunInt: { value: 1 },
      uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: this.skyUniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vDir;
        uniform vec3 uSunDir, uZenith, uHorizon, uSun, uFog;
        uniform float uSunInt, uNight;
        ${SKY_GLSL}
        void main(){
          vec3 dir = normalize(vDir);
          vec3 col = skyColor(dir, uSunDir, uZenith, uHorizon, uSun, uSunInt, uNight);
          // haze the band just under the horizon so sky meets sea seamlessly
          col = mix(col, uFog, smoothstep(0.04, -0.03, dir.y) * 0.7);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.skyMesh = new THREE.Mesh(geo, mat);
    this.skyMesh.renderOrder = -1;
    this.scene.add(this.skyMesh);
  }

  // ───────── ocean ─────────
  _buildOcean() {
    this.oceanSize = 1500;
    this.oceanSeg = 384;          // ~3.9u spacing — resolves the 8u shortest wave smoothly
    this.spacing = this.oceanSize / this.oceanSeg;
    const geo = new THREE.PlaneGeometry(this.oceanSize, this.oceanSize, this.oceanSeg, this.oceanSeg);
    geo.rotateX(-Math.PI / 2);

    this.waterUniforms = {
      uTime: { value: 0 },
      uSea: { value: 1 },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uSunDir: { value: this._sunDir },
      uZenith: { value: this.sky.zenith },
      uHorizon: { value: this.sky.horizon },
      uSun: { value: this.sky.sun },
      uDeep: { value: this.sky.deep },
      uFog: { value: this.sky.fog },
      uSunInt: { value: 1 },
      uNight: { value: 0 },
      uFogDensity: { value: 0.0016 },
      uWaveA: { value: WAVE_A },
      uWaveB: { value: WAVE_B },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexShader: /* glsl */`
        precision highp float;
        uniform float uTime, uSea;
        uniform vec2 uOffset;
        varying vec3 vWorldPos;
        varying vec3 vN;
        varying float vCrest;
        ${gerstnerGLSL()}
        void main(){
          vec2 wp = position.xz + uOffset;
          vec3 gPos; vec3 gN;
          gerstner(wp, uTime, uSea, gPos, gN);
          vWorldPos = gPos;
          vN = gN;
          vCrest = gPos.y / (REF_HEIGHT * uSea);
          gl_Position = projectionMatrix * viewMatrix * vec4(gPos, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vWorldPos;
        varying vec3 vN;
        varying float vCrest;
        uniform float uTime, uSea, uSunInt, uNight, uFogDensity;
        uniform vec3 uSunDir, uZenith, uHorizon, uSun, uDeep, uFog;
        ${SKY_GLSL}
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          float a = hash21(i), b = hash21(i+vec2(1.0,0.0));
          float c = hash21(i+vec2(0.0,1.0)), d = hash21(i+vec2(1.0,1.0));
          return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
        }
        float fbm(vec2 p){ return 0.55*vnoise(p) + 0.30*vnoise(p*2.1) + 0.15*vnoise(p*4.3); }
        void main(){
          // all surface detail comes from the moving spectral waves — no static
          // noise layer painted on the water.
          vec3 N = normalize(vN);
          float dist = length(vWorldPos.xz - cameraPosition.xz);

          vec3 viewDir = normalize(vWorldPos - cameraPosition);
          vec3 R = reflect(viewDir, N);
          R.y = max(R.y, 0.015);
          vec3 skyRefl = skyColor(R, uSunDir, uZenith, uHorizon, uSun, uSunInt, uNight);

          float fres = pow(1.0 - max(dot(-viewDir, N), 0.0), 5.0);
          float reflectivity = mix(0.02, 0.74, fres);

          // depth shading: troughs darker than crests
          vec3 deep = uDeep * mix(0.7, 1.15, clamp(vCrest * 0.5 + 0.5, 0.0, 1.0));
          vec3 col = mix(deep, skyRefl, reflectivity);

          // subsurface glow when looking toward the sun through a crest
          float back = pow(max(dot(viewDir, uSunDir), 0.0), 3.0);
          col += uSun * back * max(vCrest, 0.0) * 0.5 * uSunInt;

          // sharp sun glitter
          float spec = pow(max(dot(R, uSunDir), 0.0), 140.0);
          col += uSun * spec * 1.1 * uSunInt;

          // whitecaps: only near steep crests, textured with smooth fbm, scaled by sea state
          float crestMask = smoothstep(0.70, 0.96, vCrest);
          float ftex = fbm(vWorldPos.xz * 0.5 + uTime * 0.04);
          float foam = crestMask * smoothstep(0.35, 0.85, ftex) * smoothstep(0.6, 1.35, uSea);
          foam *= 1.0 - smoothstep(90.0, 320.0, dist);   // hide low-res foam at distance
          vec3 foamCol = mix(vec3(0.93, 0.96, 1.0), uSun, 0.08) * (0.55 + 0.45 * uSunInt);
          col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.85);

          // distance fog → dissolve into the sky
          float fog = 1.0 - exp(-dist * uFogDensity);
          col = mix(col, uFog, fog);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.ocean = new THREE.Mesh(geo, mat);
    this.ocean.frustumCulled = false;
    this.scene.add(this.ocean);
  }

  // ───────── sailboat ─────────
  _buildBoat() {
    const parts = this._makeBoat(0xb44b32);
    this.boat = parts.group;
    this.flag = parts.flag;
    this.lanternMesh = parts.lantern;
    this.foam = parts.foam;
    this.bubble = null;            // own speech bubble
    this.scene.add(this.boat);
    this.remotes = new Map();      // id → remote boat (other sailors)
    this.fx = [];                  // live bombs / splashes
  }

  // build one sailboat; accent colours the waterline stripe (player identity)
  _makeBoat(accent) {
    const boat = new THREE.Group();

    const wood    = new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.5,  metalness: 0.05 });
    const woodLo  = new THREE.MeshStandardMaterial({ color: 0x32200f, roughness: 0.55, metalness: 0.05 });
    const stripe  = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.6 });
    const trim    = new THREE.MeshStandardMaterial({ color: 0xc89b62, roughness: 0.5 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.45 });
    const rigMat  = new THREE.MeshStandardMaterial({ color: 0x15110b, roughness: 0.6 });
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xf1e7d2, roughness: 0.85, side: THREE.DoubleSide,
      emissive: 0x3a2e1e, emissiveIntensity: 0.22,
    });

    // hull outline (pointed bow at +x, transom stern at −x)
    const outline = new THREE.Shape();
    outline.moveTo(1.9, 0);
    outline.quadraticCurveTo(1.25, 0.6, 0.0, 0.64);
    outline.quadraticCurveTo(-1.05, 0.64, -1.52, 0.5);
    outline.lineTo(-1.52, -0.5);
    outline.quadraticCurveTo(-1.05, -0.64, 0.0, -0.64);
    outline.quadraticCurveTo(1.25, -0.6, 1.9, 0);

    // lower hull (dark planking)
    const hullGeo = new THREE.ExtrudeGeometry(outline, {
      depth: 0.66, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.07, bevelSegments: 3,
    });
    hullGeo.rotateX(-Math.PI / 2); hullGeo.translate(0, -0.42, 0);
    boat.add(new THREE.Mesh(hullGeo, wood));

    // waterline "boot" stripe — a thin band at the float line
    const stripeGeo = new THREE.ExtrudeGeometry(outline, { depth: 0.12, bevelEnabled: false });
    stripeGeo.rotateX(-Math.PI / 2); stripeGeo.translate(0, -0.06, 0); stripeGeo.scale(1.015, 1, 1.015);
    boat.add(new THREE.Mesh(stripeGeo, stripe));

    // top rim (gunwale) + recessed deck
    const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.07, bevelEnabled: false }), trim);
    rim.geometry.rotateX(-Math.PI / 2); rim.position.y = 0.18;
    boat.add(rim);
    const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.04, bevelEnabled: false }), deckMat);
    deck.geometry.rotateX(-Math.PI / 2); deck.position.y = 0.2; deck.scale.set(0.9, 1, 0.86);
    boat.add(deck);

    // cockpit well (a dark recess aft of the mast)
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.7), woodLo);
    cockpit.position.set(-0.55, 0.14, 0); boat.add(cockpit);

    // fin keel + bulb below the waterline
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.09), woodLo);
    keel.position.set(-0.15, -1.0, 0); boat.add(keel);
    const bulb = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.4, metalness: 0.3 }));
    bulb.rotation.z = Math.PI / 2; bulb.position.set(-0.15, -1.5, 0); boat.add(bulb);

    // rudder + tiller at the transom
    const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.06), woodLo);
    rudder.position.set(-1.55, -0.5, 0); boat.add(rudder);
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), poleMat);
    tiller.rotation.z = 1.05; tiller.position.set(-1.2, 0.32, 0); boat.add(tiller);

    // mast + boom
    const mastH = 3.4, mastX = 0.3;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, mastH, 12), poleMat);
    mast.position.set(mastX, 0.2 + mastH / 2, 0); boat.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.85, 8), poleMat);
    boom.rotation.z = Math.PI / 2; boom.position.set(-0.55, 0.62, 0); boat.add(boom);
    const mastTopY = 0.2 + mastH;

    // standing rigging (forestay, backstay, port/starboard shrouds)
    const head = [mastX, mastTopY - 0.1, 0];
    boat.add(this._strut(head, [1.85, 0.16, 0], 0.012, rigMat));   // forestay → bow
    boat.add(this._strut(head, [-1.45, 0.2, 0], 0.012, rigMat));   // backstay → stern
    boat.add(this._strut(head, [0.1, 0.2, 0.6], 0.01, rigMat));    // shroud (stbd)
    boat.add(this._strut(head, [0.1, 0.2, -0.6], 0.01, rigMat));   // shroud (port)

    // curved sails
    boat.add(this._curvedSail([mastX + 0.06, mastTopY - 0.15, 0], [mastX + 0.06, 0.62, 0], [-1.4, 0.72, 0], 0.5, sailMat));   // mainsail
    boat.add(this._curvedSail([mastX + 0.02, mastTopY - 0.55, 0], [mastX + 0.02, 0.5, 0], [1.78, 0.2, 0], -0.34, sailMat));    // jib

    // pennant at the masthead
    const flag = this._curvedSail([mastX, mastTopY + 0.02, 0], [mastX, mastTopY - 0.22, 0], [mastX + 0.62, mastTopY - 0.06, 0], 0.0,
      new THREE.MeshStandardMaterial({ color: 0xe0a560, side: THREE.DoubleSide, emissive: 0x6b4012, emissiveIntensity: 0.4 }));
    boat.add(flag);

    // stern lantern (glows at night)
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb060, emissiveIntensity: 1.0 }));
    lantern.position.set(-1.45, 0.55, 0);
    boat.add(lantern);

    // soft foam halo where the hull meets the water
    const foamTex = this._haloTexture();
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 3.0),
      new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.y = 0.02;
    boat.add(foam);

    return { group: boat, flag, lantern, foam };
  }

  // a thin cylinder spanning two points (rigging, struts)
  _strut(a, b, r, mat) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = new THREE.Vector3().subVectors(B, A);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 6), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    return m;
  }

  // a triangular sail bowed smoothly into a belly (zero curve at the edges)
  _curvedSail(head, tack, clew, billow, mat) {
    const H = new THREE.Vector3(...head), T = new THREE.Vector3(...tack), C = new THREE.Vector3(...clew);
    const SEG = 5, verts = [], idx = [];
    // barycentric grid over the triangle; offset along +Z by a belly profile
    const P = (u, v) => {
      // u along luff (H→T), v toward clew
      const a = new THREE.Vector3().lerpVectors(H, T, u);
      const p = new THREE.Vector3().lerpVectors(a, C, v);
      const belly = Math.sin(Math.PI * (1 - v)) * Math.sin(Math.PI * (u * (1 - v) + v * 0.5));
      p.z += billow * belly * (1 - v);
      return p;
    };
    for (let i = 0; i <= SEG; i++)
      for (let j = 0; j <= SEG - i; j++) verts.push(P(i / SEG, j / SEG));
    // index the triangular lattice
    const rowStart = []; let acc = 0;
    for (let i = 0; i <= SEG; i++) { rowStart.push(acc); acc += SEG - i + 1; }
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < SEG - i; j++) {
        const a = rowStart[i] + j, b = rowStart[i + 1] + j, c = a + 1;
        idx.push(a, b, c);
        if (j < SEG - i - 1) idx.push(c, b, rowStart[i + 1] + j + 1);
      }
    }
    const pos = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => { pos[i*3]=v.x; pos[i*3+1]=v.y; pos[i*3+2]=v.z; });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }

  // radial gradient sprite for the waterline foam halo
  _haloTexture() {
    const s = 128, cv = document.createElement("canvas"); cv.width = cv.height = s;
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(s/2, s/2, s*0.18, s/2, s/2, s/2);
    g.addColorStop(0, "rgba(255,255,255,0.0)");
    g.addColorStop(0.55, "rgba(232,243,255,0.55)");
    g.addColorStop(0.78, "rgba(210,232,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(cv); t.needsUpdate = true; return t;
  }

  // ───────── other sailors (multiplayer) ─────────
  addRemote(id, name, accent) {
    if (this.remotes.has(id)) return;
    const parts = this._makeBoat(accent);
    const label = this._textSprite(name, "rgba(10,16,22,0.55)", "#e8f0f8", 22);
    label.position.set(0.3, 4.1, 0);
    parts.group.add(label);
    this.scene.add(parts.group);
    this.remotes.set(id, {
      ...parts, label, bubble: null,
      x: 0, z: 0, heading: 0, speed: 0,     // displayed (smoothed)
      tx: 0, tz: 0, th: 0, fresh: true,      // network targets
    });
  }
  updateRemote(id, x, z, heading, speed) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.tx = x; r.tz = z; r.th = heading; r.speed = speed;
    if (r.fresh) { r.x = x; r.z = z; r.heading = heading; r.fresh = false; }
  }
  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.group);
    this.remotes.delete(id);
  }

  // speech bubble above a boat (id = null → own boat)
  say(id, text) {
    const host = id === null ? this : this.remotes.get(id);
    if (!host) return;
    const group = id === null ? this.boat : host.group;
    if (host.bubble) group.remove(host.bubble.sprite);
    const sprite = this._textSprite(text, "rgba(244,240,230,0.92)", "#1c2630", 26);
    sprite.position.set(0.3, 4.7, 0);
    group.add(sprite);
    host.bubble = { sprite, ttl: 6.5, group };
  }

  // bomb lobbed from (x0,z0) to (x1,z1); splash on impact
  launchBomb(x0, z0, x1, z1, dur) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x16140f, roughness: 0.35, metalness: 0.4 }));
    this.scene.add(ball);
    const dist = Math.hypot(x1 - x0, z1 - z0);
    this.fx.push({ kind: "bomb", ball, x0, z0, x1, z1, t: 0, dur, arc: 2.5 + dist * 0.14 });
  }
  _splash(x, z) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._haloTex || (this._haloTex = this._haloTexture()),
      color: 0xeaf4ff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.position.set(x, 0.6, z);
    s.scale.set(1.5, 1.5, 1);
    this.scene.add(s);
    this.fx.push({ kind: "splash", sprite: s, t: 0, dur: 1.1 });
  }

  // canvas-backed text sprite (name tags, chat bubbles)
  _textSprite(text, bg, fg, px) {
    const pad = 18, cv = document.createElement("canvas");
    const ctx = cv.getContext("2d");
    ctx.font = `600 ${px}px "Hanken Grotesk", sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    cv.width = w; cv.height = px + pad * 1.4;
    const c2 = cv.getContext("2d");
    c2.fillStyle = bg;
    c2.beginPath(); c2.roundRect(0, 0, cv.width, cv.height, 10); c2.fill();
    c2.font = `600 ${px}px "Hanken Grotesk", sans-serif`;
    c2.fillStyle = fg; c2.textAlign = "center"; c2.textBaseline = "middle";
    c2.fillText(text, cv.width / 2, cv.height / 2 + 1);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const scale = 0.018;
    sp.scale.set(cv.width * scale, cv.height * scale, 1);
    return sp;
  }

  // ───────── gulls ─────────
  _buildGulls() {
    const g = new THREE.Group();
    this.gullData = [];
    const N = 6;
    for (let i = 0; i < N; i++) {
      const gull = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcfd6db, roughness: 0.8 });
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 0.85, side: THREE.DoubleSide });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), bodyMat);
      body.scale.set(1, 0.7, 2.2); gull.add(body);
      const wingGeo = new THREE.BufferGeometry();
      wingGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
        0,0,0,  0.9,0.05,-0.25,  0.9,0.05,0.25,
      ]), 3));
      wingGeo.computeVertexNormals();
      const wL = new THREE.Mesh(wingGeo, wingMat);
      const wR = new THREE.Mesh(wingGeo, wingMat); wR.scale.x = -1;
      gull.add(wL, wR);
      gull.userData = { wL, wR };
      g.add(gull);
      this.gullData.push({
        node: gull, radius: 16 + Math.random() * 34, height: 8 + Math.random() * 12,
        phase: Math.random() * Math.PI * 2, speed: 0.08 + Math.random() * 0.12,
        dir: Math.random() < 0.5 ? 1 : -1, flap: 5 + Math.random() * 4,
        cx: (Math.random() - 0.5) * 30, cz: -10 - Math.random() * 30,
      });
    }
    this.gulls = g;
    this.scene.add(g);
  }

  // place a hull on the wave surface at (x,z) with the given heading + heel
  _floatBoat(group, x, z, heading, heel, t, sea) {
    const ch = Math.cos(heading), sh = Math.sin(heading);
    const here = sampleWave(x, z, t, sea);
    group.position.set(x, here.y - 0.12, z);
    // orient: align up to surface normal, blend bow/stern pitch along the heading
    this._tmpN.copy(here.normal);
    const bow = sampleWave(x + ch * 1.6, z - sh * 1.6, t, sea);
    const aft = sampleWave(x - ch * 1.4, z + sh * 1.4, t, sea);
    const pitch = (aft.y - bow.y) * 0.25;
    this._tmpN.x += pitch * ch;
    this._tmpN.z -= pitch * sh;
    this._tmpN.normalize();
    this._q1.setFromUnitVectors(UP, this._tmpN);
    this._q2.setFromAxisAngle(UP, heading);
    this._q1.multiply(this._q2);
    if (heel) { this._q3.setFromAxisAngle(this._fwd, heel); this._q1.multiply(this._q3); }
    group.quaternion.copy(this._q1);
  }

  // ───────── per-frame update ─────────
  // todFrac: time of day 0..1 · sea: 0.1..2 · nav: boat position/heading/speed/heel
  update(dt, todFrac, sea, paused, nav) {
    const adv = paused ? 0 : dt;
    this.time += adv * 0.7;          // calm the (physically fast) long swells
    const t = this.time;

    // sun position from time of day
    const theta = (todFrac - 0.25) * Math.PI * 2;
    const el = Math.sin(theta);
    this._sunDir.set(Math.cos(theta), el, 0.33).normalize();

    // palette
    skyState(el, this.sky);
    const sk = this.sky;
    this.skyUniforms.uSunInt.value = sk.sunInt;
    this.skyUniforms.uNight.value = sk.night;
    this.waterUniforms.uSunInt.value = sk.sunInt;
    this.waterUniforms.uNight.value = sk.night;
    this.waterUniforms.uTime.value = t;
    this.waterUniforms.uSea.value = sea;

    // lights track the sun
    this.sun.position.copy(this._sunDir).multiplyScalar(120);
    this.sun.color.copy(sk.sun);
    this.sun.intensity = 0.15 + Math.max(el, 0) * 2.2;
    this.ambient.color.copy(sk.zenith); this.ambient.groundColor.copy(sk.deep);
    this.ambient.intensity = 0.35 + Math.max(el, -0.1) * 0.5 + sk.night * 0.15;
    this.lantern.intensity = sk.night * 2.4;
    this.lanternMesh.material.emissiveIntensity = 0.4 + sk.night * 1.6;

    // keep sky centred on camera; recentre ocean (snapped) to fake infinity
    this.skyMesh.position.copy(this.camera.position);
    const ox = Math.round(this.camera.position.x / this.spacing) * this.spacing;
    const oz = Math.round(this.camera.position.z / this.spacing) * this.spacing;
    this.waterUniforms.uOffset.value.set(ox, oz);

    // ── float the boats on the real surface ──
    const wob = Math.sin(t * 0.6) * 0.02;   // small wave-induced yaw
    this._floatBoat(this.boat, nav.x, nav.z, nav.heading + wob, nav.heel, t, sea);
    this.lantern.position.set(nav.x, this.boat.position.y + 0.6, nav.z);
    // pennant flutter
    if (this.flag) this.flag.rotation.y = Math.sin(t * 4.0) * 0.4;
    // waterline foam: more in rougher seas and at speed, gentle wash pulse
    const spdK = Math.min(1, Math.abs(nav.speed) / 6);
    if (this.foam) {
      this.foam.material.opacity = (0.18 + sea * 0.22 + spdK * 0.3) * (0.8 + 0.2 * Math.sin(t * 1.6));
      const ws = 1 + Math.sin(t * 1.1) * 0.04;
      this.foam.scale.set(ws + spdK * 0.5, ws, 1);
    }

    // other sailors: ease toward their reported position, ride the same sea
    for (const r of this.remotes.values()) {
      const k = Math.min(1, adv * 4);
      r.x += (r.tx - r.x) * k;
      r.z += (r.tz - r.z) * k;
      let dh = r.th - r.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      r.heading += dh * k;
      this._floatBoat(r.group, r.x, r.z, r.heading, 0, t, sea);
      r.foam.material.opacity = 0.18 + sea * 0.22 + Math.min(1, Math.abs(r.speed) / 6) * 0.3;
      if (r.bubble && (r.bubble.ttl -= adv) <= 0) { r.group.remove(r.bubble.sprite); r.bubble = null; }
    }
    if (this.bubble && (this.bubble.ttl -= adv) <= 0) { this.boat.remove(this.bubble.sprite); this.bubble = null; }

    // ── bombs & splashes ──
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += adv;
      const k = Math.min(1, f.t / f.dur);
      if (f.kind === "bomb") {
        const x = f.x0 + (f.x1 - f.x0) * k, z = f.z0 + (f.z1 - f.z0) * k;
        f.ball.position.set(x, 1.2 + Math.sin(Math.PI * k) * f.arc, z);
        if (k >= 1) { this.scene.remove(f.ball); this.fx.splice(i, 1); this._splash(f.x1, f.z1); }
      } else { // splash
        const s = 1.5 + k * 9;
        f.sprite.scale.set(s, s * 0.8, 1);
        f.sprite.material.opacity = 0.95 * (1 - k);
        if (k >= 1) { this.scene.remove(f.sprite); this.fx.splice(i, 1); }
      }
    }

    // ── gulls ──
    const showGulls = this.gulls.visible && sk.night < 0.55;
    for (const gd of this.gullData) {
      const a = gd.phase + t * gd.speed * gd.dir;
      const x = nav.x + gd.cx + Math.cos(a) * gd.radius;
      const z = nav.z + gd.cz + Math.sin(a) * gd.radius;
      const y = gd.height + Math.sin(t * 1.3 + gd.phase) * 0.7;
      gd.node.position.set(x, y, z);
      gd.node.rotation.y = -a + (gd.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      const flap = Math.sin(t * gd.flap + gd.phase) * 0.6;
      gd.node.userData.wL.rotation.z = flap;
      gd.node.userData.wR.rotation.z = -flap;
    }
    this.gulls.children.forEach((c) => (c.visible = showGulls));

    return el; // elevation, for HUD
  }

  render() { this.renderer.render(this.scene, this.camera); }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
