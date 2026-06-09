// ═══════════════════════════════════════════════════════════
//  DRIFT — procedural sea ambience (Web Audio, no assets)
//  Layered filtered noise: a low ocean wash that swells on an LFO,
//  plus a brighter wind hiss whose level tracks the sea state.
// ═══════════════════════════════════════════════════════════

export class SeaAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  _noiseBuffer(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // brownish noise: integrate white for a softer, lower spectrum
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // ── ocean wash ──
    const wash = ctx.createBufferSource();
    wash.buffer = this._noiseBuffer(4); wash.loop = true;
    const washLP = ctx.createBiquadFilter();
    washLP.type = "lowpass"; washLP.frequency.value = 480; washLP.Q.value = 0.6;
    this.washGain = ctx.createGain(); this.washGain.gain.value = 0.6;
    wash.connect(washLP); washLP.connect(this.washGain); this.washGain.connect(this.master);
    wash.start();

    // swell LFO modulating the wash level
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.28;
    lfo.connect(lfoGain); lfoGain.connect(this.washGain.gain); lfo.start();

    // ── wind hiss ──
    const wind = ctx.createBufferSource();
    wind.buffer = this._noiseBuffer(3); wind.loop = true;
    const windBP = ctx.createBiquadFilter();
    windBP.type = "bandpass"; windBP.frequency.value = 1100; windBP.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    wind.connect(windBP); windBP.connect(this.windGain); this.windGain.connect(this.master);
    wind.start();
  }

  toggle() {
    this._ensure();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.enabled = !this.enabled;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.5 : 0.0, t + 0.4);
    return this.enabled;
  }

  // sea∈[0.1..2] → more wind & wash with higher seas
  setSea(sea) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.04 + sea * 0.14, t, 0.5);
  }
}
