// ═══════════════════════════════════════════════════════════
//  DRIFT — sky model
//  One GLSL skyColor(dir) function powers BOTH the sky dome and the
//  water reflection, so the sea always mirrors the real sky.
//  A JS palette maps sun elevation → colours for the day–night cycle.
// ═══════════════════════════════════════════════════════════

import * as THREE from "three";

// shared GLSL: hashing, sky gradient, sun disk, moon, stars, ACES tonemap.
export const SKY_GLSL = `
float hash21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }

// idealised filmic tonemap so the bright sun rolls off to white
vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}

vec3 skyColor(vec3 dir, vec3 sunDir, vec3 zenithC, vec3 horizonC, vec3 sunC, float sunInt, float night){
  dir = normalize(dir);
  float el = dir.y;
  // vertical gradient horizon→zenith
  vec3 col = mix(horizonC, zenithC, smoothstep(-0.05, 0.55, el));
  // below the horizon line (used by downward reflection rays): hold horizon tone
  col = mix(col, horizonC * 0.82, smoothstep(0.0, -0.25, el));

  float sd = dot(dir, sunDir);
  // warm scattering halo that hugs the horizon near the sun
  float haze = pow(max(1.0 - abs(el) * 1.4, 0.0), 6.0) * pow(max(sd, 0.0), 2.0);
  col += sunC * haze * 0.55 * sunInt;
  // broad glow + sharp disk
  float glow = pow(max(sd, 0.0), 7.0) * 0.22 + smoothstep(0.9965, 0.9999, sd) * 0.7;
  float disk = smoothstep(0.99965, 0.99985, sd);
  col += sunC * (glow + disk * 7.0) * sunInt * smoothstep(-0.12, 0.02, sunDir.y);

  // ── night extras ──
  if (night > 0.001) {
    // stars in the upper hemisphere
    if (el > 0.02) {
      vec2 uv = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
      vec2 g = floor(uv * 44.0);
      float h = hash21(g);
      float star = smoothstep(0.9955, 1.0, h);
      float twinkle = 0.6 + 0.4 * sin(h * 90.0);
      col += vec3(0.8, 0.86, 1.0) * star * twinkle * night * smoothstep(0.02, 0.2, el);
    }
    // moon opposite the sun
    float md = dot(dir, -sunDir);
    float moon = smoothstep(0.9994, 0.99975, md);
    float mglow = pow(max(md, 0.0), 60.0) * 0.25;
    col += (vec3(0.85, 0.9, 1.0) * moon * 1.6 + vec3(0.5, 0.6, 0.85) * mglow) * night;
  }
  return col;
}
`;

// ── day–night palette keyframes, indexed by sun elevation (-1..1) ──
const KEYS = [
  // el,    zenith,   horizon,  sun,      sunInt, fog,      deep
  [-1.00, 0x05080f, 0x0a1422, 0x2a3a5c, 0.10, 0x0a1422, 0x040a12],
  [-0.10, 0x0b1428, 0x1d2542, 0x46506e, 0.18, 0x1a2236, 0x06101c],
  [-0.02, 0x202a4c, 0x6e3a52, 0xff8a52, 0.55, 0x4a3548, 0x0a1622],
  [ 0.03, 0x2c4a78, 0xff7a40, 0xffd29a, 1.35, 0xb87a55, 0x10283a],
  [ 0.14, 0x3f78b0, 0xffb068, 0xffe6bc, 1.55, 0xc9aa86, 0x1a4458],
  [ 0.55, 0x2f7ec6, 0xbfe3ee, 0xffffff, 1.10, 0xcfe6ee, 0x16586e],
];

const _a = new THREE.Color(), _b = new THREE.Color();
function pickColor(arr, idxA, idxB, f, slot, out) {
  _a.setHex(arr[idxA][slot]); _b.setHex(arr[idxB][slot]);
  return out.copy(_a).lerp(_b, f);
}

// Compute the full sky/lighting state for a given sun elevation.
export function skyState(el, out) {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = THREE.MathUtils.clamp((el - a[0]) / (b[0] - a[0]), 0, 1);

  pickColor(KEYS, i, i + 1, f, 1, out.zenith);
  pickColor(KEYS, i, i + 1, f, 2, out.horizon);
  pickColor(KEYS, i, i + 1, f, 3, out.sun);
  pickColor(KEYS, i, i + 1, f, 5, out.fog);
  pickColor(KEYS, i, i + 1, f, 6, out.deep);
  out.sunInt = a[4] + (b[4] - a[4]) * f;
  out.night = THREE.MathUtils.clamp((0.04 - el) / 0.12, 0, 1);
  return out;
}

export function makeSkyState() {
  return {
    zenith: new THREE.Color(), horizon: new THREE.Color(),
    sun: new THREE.Color(), fog: new THREE.Color(), deep: new THREE.Color(),
    sunInt: 1, night: 0,
  };
}
