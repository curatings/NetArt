const WALL_THROTTLE_MS = 95;

/** MIDI note number to Hz (equal temperament, A4 = 440) */
function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * @param {number} seed
 * @param {number} index
 */
function seededRatio(seed, index) {
  const x = Math.imul(seed ^ (index * 0x9e3779b9), 0x85ebca6b);
  return ((x >>> 0) % 10000) / 10000;
}

export class AudioController {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {GainNode | null} */
    this.pathBus = null;
    /** @type {GainNode | null} */
    this.pathGain = null;
    /** @type {OscillatorNode[]} */
    this.pathOscs = [];
    /** @type {number[]} */
    this._padBaseHz = [];
    /** @type {GainNode | null} */
    this.pathLfoGain = null;
    /** @type {OscillatorNode | null} */
    this.lfoOsc = null;
    this.pathRunning = false;
    this.lastWallAt = 0;
    this.seed = 0;
    this.maxManhattan = 1;
    this.victoryPlaying = false;
    /** @type {number} */
    this._pathBaseHz = 110;
    /** @type {number} */
    this._distMult = 1;
    /** @type {number} */
    this._rootMidi = 60;
    /** @type {number[]} */
    this._arpPattern = [];
    /** @type {number} */
    this._arpIndex = 0;
    /** @type {ReturnType<typeof setInterval> | null} */
    this._arpIntervalId = null;
  }

  async ensureRunning() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  /**
   * @param {number} seed
   * @param {number} cellCount cols * rows of logical maze
   * @param {number} maxManhattan for distance-based pitch drift
   */
  startPathAmbience(seed, cellCount, maxManhattan) {
    if (!this.ctx || !this.master) return;
    this.stopPathAmbienceInternal();
    this.seed = seed >>> 0;
    this.maxManhattan = Math.max(1, maxManhattan);
    this._distMult = 1;

    const t = this.ctx.currentTime;
    this.pathBus = this.ctx.createGain();
    this.pathGain = this.ctx.createGain();
    this.pathGain.gain.setValueAtTime(1, t);
    this.pathBus.connect(this.pathGain);
    this.pathGain.connect(this.master);

    /** 根音：C4 附近，随种子微调调性 */
    this._rootMidi = 58 + Math.floor(seededRatio(this.seed, 2) * 5);
    const third = this._rootMidi + 4;
    const fifth = this._rootMidi + 7;
    this._padBaseHz = [midiToHz(this._rootMidi), midiToHz(third), midiToHz(fifth)];
    this._pathBaseHz = this._padBaseHz[0];

    /** 古典风格分解和弦（大调琶音 + 经过音） */
    this._arpPattern = [0, 4, 7, 12, 7, 4, 12, 7, 5, 4, 0, -1];
    if (seededRatio(this.seed, 11) > 0.5) {
      this._arpPattern = [0, 7, 4, 7, 12, 7, 4, 0, 2, 4, 7, 4];
    }
    this._arpIndex = 0;

    const padLevels = [0.07, 0.055, 0.05];
    this.pathOscs = this._padBaseHz.map((hz, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(hz, t);
      osc.detune.setValueAtTime((seededRatio(this.seed, i + 20) - 0.5) * 8, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(padLevels[i], t);
      osc.connect(g);
      g.connect(this.pathBus);
      osc.start(t);
      return osc;
    });

    this.lfoOsc = this.ctx.createOscillator();
    this.lfoOsc.type = "sine";
    this.lfoOsc.frequency.setValueAtTime(0.25 + seededRatio(this.seed, 30) * 0.2, t);
    this.pathLfoGain = this.ctx.createGain();
    this.pathLfoGain.gain.setValueAtTime(0.04 + seededRatio(this.seed, 31) * 0.03, t);
    this.lfoOsc.connect(this.pathLfoGain);
    this.pathLfoGain.connect(this.pathBus.gain);
    this.lfoOsc.start(t);

    const arpMs = 135 + Math.floor(seededRatio(this.seed, 40) * 45);
    this._arpIntervalId = setInterval(() => this._playArpPluck(), arpMs);

    this.pathRunning = true;
  }

  _playArpPluck() {
    if (!this.ctx || !this.pathBus || !this._arpPattern.length) return;
    const semis = this._arpPattern[this._arpIndex % this._arpPattern.length];
    this._arpIndex++;
    const midi = this._rootMidi + semis;
    const hz = midiToHz(midi) * this._distMult;

    const t = this.ctx.currentTime;
    const dur = 0.11;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(hz, t);
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(2200, t);
    filt.Q.setValueAtTime(0.7, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.065, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filt);
    filt.connect(g);
    g.connect(this.pathBus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  stopPathAmbienceInternal() {
    if (this._arpIntervalId != null) {
      clearInterval(this._arpIntervalId);
      this._arpIntervalId = null;
    }

    const t = this.ctx?.currentTime ?? 0;
    if (this.lfoOsc) {
      try {
        this.lfoOsc.stop(t);
      } catch (_) {}
      this.lfoOsc.disconnect();
      this.lfoOsc = null;
    }
    if (this.pathLfoGain) {
      this.pathLfoGain.disconnect();
      this.pathLfoGain = null;
    }
    for (const osc of this.pathOscs) {
      try {
        osc.stop(t);
      } catch (_) {}
      osc.disconnect();
    }
    this.pathOscs = [];
    this._padBaseHz = [];
    if (this.pathBus) {
      this.pathBus.disconnect();
      this.pathBus = null;
    }
    if (this.pathGain) {
      this.pathGain.disconnect();
      this.pathGain = null;
    }
    this.pathRunning = false;
  }

  stopAll() {
    this.stopPathAmbienceInternal();
    this.victoryPlaying = false;
    this.lastWallAt = 0;
  }

  /**
   * Subtle pitch shift toward goal (Manhattan distance).
   * @param {number} manhattan
   */
  updateDistanceCue(manhattan) {
    if (!this.ctx || !this.pathOscs.length || !this._padBaseHz.length) return;
    const t = this.ctx.currentTime;
    const n = Math.min(1, Math.max(0, manhattan / this.maxManhattan));
    this._distMult = 1 + (1 - n) * 0.06;
    this.pathOscs.forEach((osc, i) => {
      osc.frequency.setTargetAtTime(this._padBaseHz[i] * this._distMult, t, 0.08);
    });
  }

  /**
   * @param {'path' | 'wall'} surface
   */
  setSurface(surface) {
    if (!this.ctx || !this.pathGain) return;
    const t = this.ctx.currentTime;
    const target = surface === "wall" ? 0.2 : 1;
    this.pathGain.gain.setTargetAtTime(target, t, 0.04);
  }

  triggerWallHit() {
    if (!this.ctx || !this.master) return;
    const now = performance.now();
    if (now - this.lastWallAt < WALL_THROTTLE_MS) return;
    this.lastWallAt = now;

    const t = this.ctx.currentTime;
    const dur = 0.06;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(140 + seededRatio(this.seed, 40) * 80, t);
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(520, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f);
    f.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  playVictory() {
    if (!this.ctx || !this.master || this.victoryPlaying) return;
    this.victoryPlaying = true;
    if (this.pathGain) {
      const t = this.ctx.currentTime;
      this.pathGain.gain.setTargetAtTime(0, t, 0.05);
    }

    const t0 = this.ctx.currentTime + 0.02;
    const freqs = [392, 493.88, 587.33, 698.46, 783.99];
    const peakGain = 0.42;
    let t = t0;

    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, t);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peakGain, t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + 0.38);
      t += 0.11;
    });

    const endMs = (freqs.length * 0.11 + 0.55) * 1000;
    window.setTimeout(() => {
      this.victoryPlaying = false;
    }, endMs);
  }
}
