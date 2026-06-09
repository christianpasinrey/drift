// ═══════════════════════════════════════════════════════════
//  DRIFT — spectral ocean
//  Instead of a few hand-picked waves, the surface is a sum of many
//  components sampled from a Phillips wind-wave spectrum with random
//  phases — the same statistical model an FFT ocean represents. Lots
//  of incommensurate frequencies + random phase = no pattern you can
//  lock onto. The GPU (water surface) and CPU (boat buoyancy) evaluate
//  the *identical* component set, so the hull always rides the real sea.
// ═══════════════════════════════════════════════════════════

import * as THREE from "three";

const G = 9.8;
export const N_WAVES = 56;          // spectral components
const WIND_ANGLE = 0.28;            // dominant swell heading (radians)
const WIND_SPEED = 10.0;            // sets the spectrum's peak (~45 m swell)
const TARGET_SIGMA = 0.74;          // RMS-ish surface energy at sea = 1

// deterministic PRNG so the spectrum (and the boat's ride) is stable
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── build the component set from the spectrum ──
const COMPILED = [];
const _A = new Float32Array(N_WAVES * 4);   // dx, dz, k, c   (per component)
const _B = new Float32Array(N_WAVES * 4);   // amp, steep, phase, 0

(function build() {
  const rng = mulberry32(20260609);
  const Lw = (WIND_SPEED * WIND_SPEED) / G;   // largest wind-driven wavelength scale
  // shortest wavelength stays above ~2× the ocean mesh spacing, so waves are
  // never finer than the grid can draw (that aliasing is what shows as edges)
  const Lmin = 8.0, Lmax = 120.0;
  const raw = [];
  let sigma2 = 0;

  for (let i = 0; i < N_WAVES; i++) {
    // log-spaced wavelengths with jitter so nothing lines up
    const f = (i + rng()) / N_WAVES;
    const L = Lmin * Math.pow(Lmax / Lmin, f);
    const k = (2 * Math.PI) / L;

    // direction: wind ± a spread that widens for shorter waves (real seas
    // have aligned long swell and scattered short chop)
    const spread = 0.35 + 1.15 * f;
    const ang = WIND_ANGLE + (rng() * 2 - 1) * spread;
    const dx = Math.cos(ang), dz = Math.sin(ang);

    // Phillips amplitude: big energy at long waves, exp cut past the peak,
    // directional weighting toward the wind
    const kL = k * Lw;
    const phillips = (Math.exp(-1.0 / (kL * kL)) / (k * k)) *
                     Math.pow(Math.max(Math.cos(ang - WIND_ANGLE), 0.0), 2.0);
    let amp = Math.sqrt(Math.max(phillips, 0)) * (0.5 + 0.5 * rng());

    const c = Math.sqrt(G / k) * (0.9 + 0.2 * rng());   // dispersion + slight jitter
    const phase = rng() * Math.PI * 2;
    // shorter waves are steeper-faced but carry little amplitude
    const steep = THREE.MathUtils.clamp(0.25 + 0.55 * f, 0.2, 0.85);

    raw.push({ dx, dz, k, c, amp, steep, phase });
    sigma2 += amp * amp;
  }

  // normalise so RMS height == TARGET_SIGMA, then bound total steepness so
  // crests never pinch into loops
  const norm = TARGET_SIGMA / Math.sqrt(sigma2);
  let steepSum = 0;
  for (const w of raw) { w.amp *= norm; steepSum += w.k * w.amp * w.steep; }
  const steepScale = steepSum > 0.82 ? 0.82 / steepSum : 1.0;  // softer crests, no creasing

  raw.forEach((w, i) => {
    w.steep *= steepScale;
    COMPILED.push(w);
    _A[i*4] = w.dx; _A[i*4+1] = w.dz; _A[i*4+2] = w.k; _A[i*4+3] = w.c;
    _B[i*4] = w.amp; _B[i*4+1] = w.steep; _B[i*4+2] = w.phase; _B[i*4+3] = 0;
  });
})();

// reference height for foam / crest normalisation (~ tallest crests)
export const REF_HEIGHT = TARGET_SIGMA * 2.0;

// flat Float32Arrays for the shader's `uniform vec4 uWaveA/uWaveB[N_WAVES]`
export const WAVE_A = _A;
export const WAVE_B = _B;

// ── CPU sampler for the boat (identical math to the shader) ──
const _n = new THREE.Vector3();
export function sampleWave(x, z, t, sea) {
  let y = 0, nx = 0, nz = 0, ny = 1;
  for (const w of COMPILED) {
    const A = w.amp * sea;
    const phase = w.k * (w.dx * x + w.dz * z) - w.c * t + w.phase;
    const s = Math.sin(phase), co = Math.cos(phase);
    y += A * s;
    const WA = w.k * A;
    nx -= w.dx * WA * co;
    nz -= w.dz * WA * co;
    ny -= w.steep * WA * s;
  }
  _n.set(nx, ny, nz).normalize();
  const crest = THREE.MathUtils.clamp((y / (REF_HEIGHT * sea)) * 0.5 + 0.5, 0, 1);
  return { y, normal: _n, crest };
}

// ── GLSL: the same component sum, reading the wave set from uniforms ──
export function gerstnerGLSL() {
  return `
#define N_WAVES ${N_WAVES}
uniform vec4 uWaveA[N_WAVES];   // dx, dz, k, c
uniform vec4 uWaveB[N_WAVES];   // amp, steep, phase
const float REF_HEIGHT = ${REF_HEIGHT.toFixed(6)};
void gerstner(vec2 p, float t, float sea, out vec3 gPos, out vec3 gN) {
  vec3 disp = vec3(p.x, 0.0, p.y);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < N_WAVES; i++) {
    vec2 d = uWaveA[i].xy;
    float k = uWaveA[i].z, c = uWaveA[i].w;
    float A = uWaveB[i].x * sea, st = uWaveB[i].y, ph = uWaveB[i].z;
    float phase = k * dot(d, p) - c * t + ph;
    float s = sin(phase), co = cos(phase);
    disp.x += st * A * d.x * co;
    disp.z += st * A * d.y * co;
    disp.y += A * s;
    float WA = k * A;
    nrm.x -= d.x * WA * co;
    nrm.z -= d.y * WA * co;
    nrm.y -= st * WA * s;
  }
  gPos = disp;
  gN = normalize(nrm);
}
`;
}
