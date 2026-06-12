// ═══════════════════════════════════════════════════════════
//  DRIFT — application entry
//  Camera, day–night cycle, sea-state, views, audio, render loop.
// ═══════════════════════════════════════════════════════════

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Scene } from "./scene.js";
import { SeaAudio } from "./audio.js";
import { Net } from "./net.js";

const canvas = document.getElementById("stage");
const scene = new Scene(canvas);
const audio = new SeaAudio();

// ───────── camera ─────────
const controls = new OrbitControls(scene.camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 4;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.495;   // never look from under the water
controls.target.set(0, 1.2, 0);
controls.autoRotate = false;
controls.autoRotateSpeed = 0.25;

// ───────── state ─────────
const state = {
  tod: 400 / 1440,   // time of day fraction (00:00–24:00)
  auto: true,
  paused: false,
};
// the sea is autonomous now: a slow deterministic wander keyed to wall-clock
// time, so every sailor in the shared world rides the same swell
function autonomousSea() {
  const T = Date.now() / 1000;
  const s = 0.95 + 0.5 * Math.sin(T * 0.013) + 0.35 * Math.sin(T * 0.0047 + 2.0);
  return Math.min(1.85, Math.max(0.25, s));
}
let seaScale = autonomousSea();
let seaTick = 0;

// ───────── sailing ─────────
const nav = { x: 0, z: 0, heading: 0, speed: 0, heel: 0 };
const MAX_FWD = 6.0, MAX_REV = 1.8, TURN_RATE = 0.9;
const keys = { fwd: false, back: false, left: false, right: false };
const KEY_NAV = {
  KeyW: "fwd",   ArrowUp: "fwd",
  KeyS: "back",  ArrowDown: "back",
  KeyA: "left",  ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
};
const typing = () => {
  const a = document.activeElement;
  return a && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA");
};
window.addEventListener("keydown", (e) => {
  if (typing()) return;
  if (KEY_NAV[e.code]) { keys[KEY_NAV[e.code]] = true; e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  if (KEY_NAV[e.code]) keys[KEY_NAV[e.code]] = false;
});
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

// ───────── view tweening ─────────
// positions/targets are offsets from the boat
const VIEWS = {
  deck:    { pos: [3.5, 2.0, 5.5],  target: [0, 1.4, 0], rotate: false },
  horizon: { pos: [10, 1.6, 14],    target: [-2, 1.2, -8], rotate: false },
  drone:   { pos: [0, 22, 26],      target: [0, 0.5, 0], rotate: true },
  wake:    { pos: [0, 3.2, -9],     target: [0, 1.4, 4], rotate: false },
};
let tween = null;
function viewVec(arr) { return new THREE.Vector3(arr[0] + nav.x, arr[1], arr[2] + nav.z); }
function goToView(name, instant = false) {
  const v = VIEWS[name];
  if (!v) return;
  controls.autoRotate = v.rotate;
  if (instant) {
    scene.camera.position.copy(viewVec(v.pos));
    controls.target.copy(viewVec(v.target));
    return;
  }
  tween = {
    t: 0, dur: 1.4,
    fromPos: scene.camera.position.clone(), toPos: viewVec(v.pos),
    fromTgt: controls.target.clone(), toTgt: viewVec(v.target),
  };
}
function easeInOut(x) { return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2, 3)/2; }

document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    goToView(btn.dataset.view);
  });
});

// ───────── HUD readouts ─────────
const el = (id) => document.getElementById(id);
const PHASES = [
  [-1.0, "night"], [-0.04, "first light"], [0.02, "sunrise"],
  [0.10, "golden hour"], [0.30, "morning"], [0.7, "midday"],
];
function phaseName(elev, tod) {
  // distinguish rising vs setting using time of day
  const setting = tod > 0.5;
  if (elev < -0.04) return "night";
  if (elev < 0.02) return setting ? "dusk" : "first light";
  if (elev < 0.10) return setting ? "sunset" : "sunrise";
  if (elev < 0.30) return "golden hour";
  if (elev < 0.7) return setting ? "afternoon" : "morning";
  return "midday";
}
function seaLabel(s) {
  if (s < 0.5) return "calm";
  if (s < 0.9) return "slight";
  if (s < 1.3) return "moderate";
  if (s < 1.7) return "rough";
  return "heavy";
}
function fmtClock(frac) {
  const mins = Math.round(frac * 1440) % 1440;
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

// ───────── controls wiring ─────────
const todInput = el("tod"), todVal = el("tod-val");
todInput.addEventListener("input", () => {
  state.tod = +todInput.value / 1440;
  if (state.auto) toggleAuto(false); // manual scrubbing pauses auto
});
const seaVal = el("sea-val");

function toggleAuto(force) {
  state.auto = force === undefined ? !state.auto : force;
  el("tgl-auto").classList.toggle("on", state.auto);
}
el("tgl-auto").addEventListener("click", () => toggleAuto());
el("tgl-gulls").addEventListener("click", (e) => {
  scene.gulls.visible = e.currentTarget.classList.toggle("on");
});
el("tgl-sound").addEventListener("click", (e) => {
  const on = audio.toggle();
  audio.setSea(seaScale);
  e.currentTarget.classList.toggle("on", on);
});
el("tgl-pause").addEventListener("click", (e) => {
  state.paused = !state.paused;
  e.currentTarget.classList.toggle("on", state.paused);
  e.currentTarget.textContent = state.paused ? "resume" : "pause";
});
el("tgl-full").addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});

// gulls + auto start "on"
scene.gulls.visible = true;

// ───────── multiplayer ─────────
const net = new Net(scene, {
  getNav: () => nav,
  // server-decided spawn / respawn: teleport boat + camera together
  onRespawn: (x, z) => {
    const dx = x - nav.x, dz = z - nav.z;
    nav.x = x; nav.z = z; nav.speed = 0;
    scene.camera.position.x += dx; scene.camera.position.z += dz;
    controls.target.x += dx; controls.target.z += dz;
  },
});
net.connect();

// ───────── keyboard ─────────
const VIEW_KEYS = { "1": "deck", "2": "horizon", "3": "drone", "4": "wake" };
window.addEventListener("keydown", (e) => {
  if (typing()) return;
  if (VIEW_KEYS[e.key]) {
    const name = VIEW_KEYS[e.key];
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    goToView(name);
  }
  if (e.key === "t" || e.key === "T") el("tgl-auto").click();
  if (e.key === "g" || e.key === "G") el("tgl-gulls").click();
  if (e.key === "m" || e.key === "M") el("tgl-sound").click();
  if (e.key === "f" || e.key === "F") net.sendBomb(nav);
  if (e.code === "Space") { e.preventDefault(); el("tgl-pause").click(); }
});

// ───────── render loop ─────────
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(scene.clock.getDelta(), 0.05);

  // advance day-night cycle (full cycle ≈ 150s)
  if (state.auto && !state.paused) {
    state.tod = (state.tod + dt / 150) % 1;
    todInput.value = Math.round(state.tod * 1440);
  }

  // sail the boat: throttle/rudder with inertia, camera rides along
  if (!state.paused) {
    const thr = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    const targetSpd = thr > 0 ? MAX_FWD : thr < 0 ? -MAX_REV : 0;
    nav.speed += (targetSpd - nav.speed) * Math.min(1, dt * 0.6);
    const trn = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    const spdK = Math.min(1, Math.abs(nav.speed) / MAX_FWD);
    nav.heading += trn * TURN_RATE * (0.35 + 0.65 * spdK) * dt;
    nav.heel += (-trn * 0.22 * spdK - nav.heel) * Math.min(1, dt * 2.5);
    const dx = Math.cos(nav.heading) * nav.speed * dt;
    const dz = -Math.sin(nav.heading) * nav.speed * dt;
    nav.x += dx; nav.z += dz;
    scene.camera.position.x += dx; scene.camera.position.z += dz;
    controls.target.x += dx; controls.target.z += dz;
    if (tween) {
      tween.fromPos.x += dx; tween.fromPos.z += dz;
      tween.toPos.x += dx;   tween.toPos.z += dz;
      tween.fromTgt.x += dx; tween.fromTgt.z += dz;
      tween.toTgt.x += dx;   tween.toTgt.z += dz;
    }
  }

  // view tween
  if (tween) {
    tween.t += dt / tween.dur;
    const k = easeInOut(Math.min(1, tween.t));
    scene.camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    controls.target.lerpVectors(tween.fromTgt, tween.toTgt, k);
    if (tween.t >= 1) tween = null;
  }

  // autonomous swell (shared by every sailor) — refresh label/audio at 1 Hz
  seaScale = autonomousSea();
  seaTick += dt;
  if (seaTick > 1) { seaTick = 0; seaVal.textContent = seaLabel(seaScale); audio.setSea(seaScale); }

  const elev = scene.update(dt, state.tod, seaScale, state.paused, nav);
  net.tick(dt);

  // keep camera above the waves
  if (scene.camera.position.y < 0.8) scene.camera.position.y = 0.8;

  // HUD
  const clock = fmtClock(state.tod);
  el("clock-time").textContent = clock;
  todVal.textContent = clock;
  el("clock-phase").textContent = phaseName(elev, state.tod);
  el("st-sun").textContent = (elev >= 0 ? "+" : "") + Math.round(elev * 90) + "°";
  el("st-sea").textContent = (seaScale * 3.2).toFixed(1);
  const CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const bearing = (Math.atan2(Math.cos(nav.heading), Math.sin(nav.heading)) * 180 / Math.PI + 360) % 360;
  el("st-head").textContent = CARD[Math.round(bearing / 45) % 8] + " " + String(Math.round(bearing) % 360).padStart(3, "0") + "°";
  el("st-kn").textContent = (Math.abs(nav.speed) * 1.9).toFixed(1);

  controls.update();
  scene.render();
}

// ───────── boot ─────────
seaVal.textContent = seaLabel(seaScale);
goToView("deck", true);
// cinematic pull-in
scene.camera.position.set(6, 6, 22);
goToView("deck");
frame();

let warm = 0;
(function warmup() {
  warm++;
  if (warm > 8) el("loader").classList.add("done");
  else requestAnimationFrame(warmup);
})();
