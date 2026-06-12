/**
 * Procedural Dhaka soundscape — every sound synthesized in WebAudio, zero
 * audio assets (idea.md §6.12). City rumble + periodic horns as the bed;
 * event stings (rickshaw bell near-miss, bump thud, theft sting, fruit
 * pluck, bark, stampede rumble, cakewalk chime, rewind whoosh) on top.
 */
import type { EventBus } from '@/core/EventBus';

export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bedNodes: AudioNode[] = [];
  private hornTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: (() => void)[] = [];

  constructor(private enabled: () => boolean) {}

  /** Must be called from a user gesture once (autoplay policy). */
  private ensureContext(): AudioContext | null {
    if (!this.enabled()) return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Ambient bed for a run; rain adds a noise layer. */
  startRun(bus: EventBus, rain: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    this.stopRun();

    // City rumble: filtered brown noise.
    const rumble = this.noiseSource(0.18, 220, 'lowpass');
    this.bedNodes.push(rumble);
    if (rain) this.bedNodes.push(this.noiseSource(0.12, 3000, 'highpass'));

    // Distant horns every few seconds.
    this.hornTimer = setInterval(() => {
      if (Math.random() < 0.65) this.horn();
    }, 2600);

    this.unsubs = [
      bus.on('nearMiss', () => this.bell()),
      bus.on('bump', () => this.thud()),
      bus.on('vehicleHit', () => this.thud(1.6)),
      bus.on('theft', () => this.sting(-1)),
      bus.on('theftSpotted', () => this.sting(1)),
      bus.on('fruitGrabbed', () => this.pluck()),
      bus.on('dogBark', () => this.bark()),
      bus.on('cowStampede', () => this.rumbleHit()),
      bus.on('cakewalkMeterFull', () => this.chime()),
      bus.on('rewindStarted', () => this.whoosh()),
    ];
  }

  stopRun(): void {
    for (const n of this.bedNodes) n.disconnect();
    this.bedNodes = [];
    if (this.hornTimer) clearInterval(this.hornTimer);
    this.hornTimer = null;
    for (const off of this.unsubs) off();
    this.unsubs = [];
  }

  // ---------- synth voices ----------

  private noiseSource(gain: number, freq: number, type: BiquadFilterType): AudioNode {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master!);
    src.start();
    return src;
  }

  private env(duration: number, peak = 0.3, attack = 0.01): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(peak, ctx.currentTime + attack);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    g.connect(this.master!);
    return g;
  }

  private tone(freq: number, type: OscillatorType, duration: number, peak = 0.25, detune = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(this.env(duration, peak));
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  private horn(): void {
    // Detuned saw stack = Dhaka bus horn, far away.
    const base = 240 + Math.random() * 120;
    this.tone(base, 'sawtooth', 0.5, 0.05);
    this.tone(base * 1.01, 'sawtooth', 0.5, 0.04, 8);
  }

  private bell(): void {
    // Rickshaw bell: bright FM-ish ping.
    this.tone(1900 + Math.random() * 300, 'triangle', 0.12, 0.12);
  }

  private thud(mul = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 * mul, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.18);
    osc.connect(this.env(0.2, 0.4 * mul));
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  private sting(direction: 1 | -1): void {
    const a = direction > 0 ? 520 : 660;
    const b = direction > 0 ? 780 : 440;
    this.tone(a, 'square', 0.1, 0.1);
    setTimeout(() => this.tone(b, 'square', 0.16, 0.1), 90);
  }

  private pluck(): void {
    this.tone(880, 'triangle', 0.15, 0.18);
    setTimeout(() => this.tone(1320, 'triangle', 0.2, 0.12), 60);
  }

  private bark(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    for (let i = 0; i < 2; i++) {
      setTimeout(() => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.1);
        osc.connect(this.env(0.12, 0.2));
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
      }, i * 160);
    }
  }

  private rumbleHit(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 1.4);
    osc.connect(this.env(1.5, 0.5, 0.05));
    osc.start();
    osc.stop(ctx.currentTime + 1.5);
  }

  private chime(): void {
    [660, 880, 1100].forEach((f, i) => setTimeout(() => this.tone(f, 'sine', 0.3, 0.14), i * 90));
  }

  private whoosh(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const src = this.noiseSource(0.0001, 800, 'bandpass') as AudioBufferSourceNode;
    // Rising filtered noise sweep ≈ reversed whoosh + low heartbeat under it.
    const g = this.env(1.6, 0.35, 0.7);
    src.disconnect();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + 1.5);
    src.connect(filter).connect(g);
    setTimeout(() => src.stop(), 1700);
    for (let i = 0; i < 2; i++) {
      setTimeout(() => this.thud(0.8), 300 + i * 600);
    }
  }
}
