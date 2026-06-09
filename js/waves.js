// ═══════════════════════════════════════════════════════════
//  DRIFT — Gerstner wave field (single source of truth)
//  The same wave set is sampled on the CPU (for the boat & gulls)
//  and on the GPU (for the water surface), so the boat sits on the
//  real surface, not a faked sine.
// ═══════════════════════════════════════════════════════════

import * as THREE from "three";

const G = 9.8;

// Each wave: direction (will be normalised), wavelength L (world units),
// amplitude & steepness "base" values scaled at runtime by sea state,
// and a speed multiplier. Directions cluster around +X (the wind).
export const WAVES = [
  { dir: [1.0,  0.18], L: 64, amp: 1.15, steep: 0.55, speed: 1.0 },
  { dir: [0.82, 0.55], L: 41, amp: 0.78, steep: 0.55, speed: 1.0 },
  { dir: [0.95, -0.4], L: 23, amp: 0.42, steep: 0.62, speed: 1.1 },
  { dir: [0.6,  0.85], L: 14, amp: 0.22, steep: 0.62, speed: 1.2 },
  { dir: [1.0, -0.22], L: 8.2, amp: 0.11, steep: 0.7, speed: 1.4 },
  { dir: [0.32, 1.0],  L: 5.4, amp: 0.06, steep: 0.7, speed: 1.5 },
];

// pre-compute per-wave constants
const COMPILED = WAVES.map((w) => {
  const len = Math.hypot(w.dir[0], w.dir[1]);
  const dx = w.dir[0] / len, dz = w.dir[1] / len;
  const k = (2 * Math.PI) / w.L;          // wave number
  const c = Math.sqrt(G / k);             // deep-water phase speed
  return { dx, dz, k, c, amp: w.amp, steep: w.steep, speed: w.speed };
});

export const SUM_AMP = WAVES.reduce((s, w) => s + w.amp, 0);

// Sample the surface at world (x, z) and time t for a given sea scale.
// Returns { y, normal:THREE.Vector3, crest } — crest∈[0,1] for foam/tilt.
const _n = new THREE.Vector3();
export function sampleWave(x, z, t, sea) {
  let y = 0, nx = 0, nz = 0, ny = 1;
  for (const w of COMPILED) {
    const A = w.amp * sea;
    const phase = w.k * (w.dx * x + w.dz * z) - w.c * w.speed * t;
    const s = Math.sin(phase), co = Math.cos(phase);
    y += A * s;
    const WA = w.k * A;
    nx -= w.dx * WA * co;
    nz -= w.dz * WA * co;
    ny -= w.steep * WA * s;
  }
  _n.set(nx, ny, nz).normalize();
  const crest = THREE.MathUtils.clamp((y / (SUM_AMP * sea)) * 0.5 + 0.5, 0, 1);
  return { y, normal: _n, crest };
}

// Emit the GLSL that mirrors sampleWave(), injected into the water shader.
// Produces displaced position `gPos` and surface normal `gN`.
export function gerstnerGLSL() {
  const N = COMPILED.length;
  let consts = "";
  COMPILED.forEach((w, i) => {
    consts += `
  W[${i}] = vec4(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}, ${w.k.toFixed(6)}, ${(w.c * w.speed).toFixed(6)});
  AS[${i}] = vec2(${w.amp.toFixed(6)}, ${w.steep.toFixed(6)});`;
  });
  return `
const int N_WAVES = ${N};
void gerstner(vec2 p, float t, float sea, out vec3 gPos, out vec3 gN) {
  vec4 W[${N}];   // dx, dz, k, c
  vec2 AS[${N}];  // amp, steep
  ${consts}
  vec3 disp = vec3(p.x, 0.0, p.y);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < N_WAVES; i++) {
    float A = AS[i].x * sea;
    float st = AS[i].y;
    float k = W[i].z;
    float phase = k * (W[i].x * p.x + W[i].y * p.y) - W[i].w * t;
    float s = sin(phase), c = cos(phase);
    disp.x += st * A * W[i].x * c;
    disp.z += st * A * W[i].y * c;
    disp.y += A * s;
    float WA = k * A;
    nrm.x -= W[i].x * WA * c;
    nrm.z -= W[i].y * WA * c;
    nrm.y -= st * WA * s;
  }
  gPos = disp;
  gN = normalize(nrm);
}
const float SUM_AMP = ${SUM_AMP.toFixed(6)};
`;
}
