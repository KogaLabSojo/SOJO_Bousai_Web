/** 効果音はすべて Web Audio でノイズから合成する（音声ファイル不要） */
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.loops = new Map();
  }

  /** ユーザー操作のハンドラ内で呼ぶ（iOS は操作なしに音を鳴らせない） */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.noise = this._makeBrownNoise(4);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _makeBrownNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  _noiseSource(loop) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    return src;
  }

  /** 地鳴り */
  rumble(duration = 3, intensity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this._noiseSource(true);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 90;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.2 * intensity, t + 0.6);
    g.gain.setValueAtTime(1.2 * intensity, t + duration - 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  /** 衝突音 */
  impact(strength = 1, pitch = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this._noiseSource(false);
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500 * pitch;
    const g = this.ctx.createGain();
    const peak = Math.min(1.5, 0.3 + strength);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + strength * 0.4);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + 1);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(peak * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  /** ひび割れ音（パキッ） */
  crack(strength = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this._noiseSource(false);
    src.playbackRate.value = 3 + Math.random() * 2;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1800 + Math.random() * 1500;
    hp.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6 * strength + 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08 + Math.random() * 0.08);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random() * 3);
    src.stop(t + 0.3);
  }

  /** 継続音（水の流れなど）。volume 0 で止まる */
  setLoop(name, volume, { type = 'bandpass', freq = 700, q = 0.6 } = {}) {
    if (!this.ctx) return;
    let loop = this.loops.get(name);
    if (!loop && volume > 0) {
      const src = this._noiseSource(true);
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      loop = { src, g };
      this.loops.set(name, loop);
    }
    if (loop) loop.g.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.3);
  }

  stopAll() {
    for (const { src, g } of this.loops.values()) {
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      src.stop(this.ctx.currentTime + 0.5);
    }
    this.loops.clear();
  }
}
