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
// and a speed multiplier.
//
// To avoid a recognisable repeat the set is deliberately irregular:
//  • a WIDE directional fan (−84°…+58° off the wind), not a single march;
//  • two big swells of close wavelength (73 & 61) travelling at slightly
//    different angles — they beat against each other into long-period
//    "sets" (the natural swell-and-fade of real open water);
//  • non-harmonic wavelengths so the combined period is enormous.
export const WAVES = [
  { dir: [0.9945,  0.1045], L: 73.0, amp: 0.90, steep: 0.45, speed: 1.00 }, // primary swell
  { dir: [0.9613,  0.2756], L: 61.0, amp: 0.70, steep: 0.45, speed: 0.97 }, // beat partner → sets
  { dir: [0.8090, -0.5878], L: 47.0, amp: 0.62, steep: 0.50, speed: 1.00 }, // cross swell
  { dir: [0.8660,  0.5000], L: 33.0, amp: 0.42, steep: 0.55, speed: 1.04 },
  { dir: [0.9703, -0.2419], L: 23.4, amp: 0.30, steep: 0.60, speed: 1.00 },
  { dir: [0.5299,  0.8480], L: 16.2, amp: 0.20, steep: 0.62, speed: 1.08 },
  { dir: [0.4695, -0.8829], L: 11.3, amp: 0.13, steep: 0.65, speed: 1.00 },
  { dir: [0.9397,  0.3420], L:  7.4, amp: 0.08, steep: 0.70, speed: 1.12 },
  { dir: [0.1045, -0.9945], L:  4.9, amp: 0.05, steep: 0.70, speed: 1.00 },
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
