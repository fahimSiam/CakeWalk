/**
 * Random mid-run street events — the "what'll happen this run?" surprise that
 * keeps runs fresh. Each is telegraphed (a couple of seconds of warning), runs
 * for a window, then clears. Pure sim (seeded, deterministic, snapshot-able);
 * RunState reads the modifiers and an FX layer reads the visual state.
 *
 *  - monsoon : sudden downpour — you slow down and the street darkens (take a
 *              cha-stall break or push through).
 *  - blackout: load-shedding — the lights cut, the world goes dark.
 *  - surge   : a crowd surge (cricket win / procession) — the crowd thickens
 *              and presses, so weaving is harder for a bit.
 */
import type { EventBus } from '@/core/EventBus';
import type { RngStream } from '@/core/Rng';

export type StreetEventKind = 'monsoon' | 'blackout' | 'surge';
type Phase = 'idle' | 'warn' | 'active';

interface Spec {
  warn: number; // telegraph seconds
  active: number; // active seconds
  speedMul: number; // player speed while active
  darkness: number; // 0..1 screen darkening while active
  widthAdd: number; // extra crowd hitbox while active
  toast: string;
}

const SPECS: Record<StreetEventKind, Spec> = {
  monsoon: { warn: 2.2, active: 11, speedMul: 0.8, darkness: 0.32, widthAdd: 0.1, toast: '🌧️ Downpour! Slippery streets' },
  blackout: { warn: 2.0, active: 8, speedMul: 1, darkness: 0.72, widthAdd: 0, toast: '🔌 Load-shedding! Lights out' },
  surge: { warn: 2.4, active: 10, speedMul: 1, darkness: 0, widthAdd: 0.3, toast: '🎉 Crowd surge — push through!' },
};

const FIRST_AT = 22; // earliest first event (s into the run)
const GAP_MIN = 26;
const GAP_MAX = 46;

export class StreetEvents {
  private phase: Phase = 'idle';
  private kind: StreetEventKind = 'monsoon';
  private timer = 0; // counts down within the current phase
  private nextAt: number;
  private clock = 0;
  /** Eased 0..1 intensity (ramps up over the warn, down after active). */
  private intensity = 0;

  constructor(
    private rng: RngStream,
    private bus: EventBus,
    enabled = true,
  ) {
    this.nextAt = enabled ? FIRST_AT + rng.range(0, 10) : Infinity;
  }

  get active(): boolean {
    return this.phase === 'active';
  }
  get activeKind(): StreetEventKind | null {
    return this.phase === 'idle' ? null : this.kind;
  }
  /** Eased visual strength of the current event (for the FX overlay). */
  get strength(): number {
    return this.intensity;
  }
  get speedMul(): number {
    return this.phase === 'active' ? SPECS[this.kind].speedMul : 1;
  }
  get darkness(): number {
    return SPECS[this.kind].darkness * this.intensity;
  }
  get widthAdd(): number {
    return this.phase === 'active' ? SPECS[this.kind].widthAdd : 0;
  }

  fixedUpdate(dt: number): void {
    this.clock += dt;
    // Ease intensity toward the current phase's target.
    const target = this.phase === 'active' ? 1 : this.phase === 'warn' ? 0.25 : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 2.2);

    if (this.phase === 'idle') {
      if (this.clock >= this.nextAt) this.begin();
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.phase === 'warn') {
      this.phase = 'active';
      this.timer = SPECS[this.kind].active;
      this.bus.emit('streetEvent', { kind: this.kind, phase: 'active' });
    } else {
      this.phase = 'idle';
      this.bus.emit('streetEvent', { kind: this.kind, phase: 'end' });
      this.nextAt = this.clock + this.rng.range(GAP_MIN, GAP_MAX);
    }
  }

  private begin(): void {
    this.kind = this.rng.weighted<StreetEventKind>(['monsoon', 'blackout', 'surge'], [4, 3, 3]);
    this.phase = 'warn';
    this.timer = SPECS[this.kind].warn;
    this.bus.emit('streetEvent', { kind: this.kind, phase: 'warn', toast: SPECS[this.kind].toast });
  }

  // --- Sand Watch snapshot ---
  static readonly SNAP_FLOATS = 5;
  snapshot(out: Float64Array, off: number): void {
    out[off] = this.phase === 'idle' ? 0 : this.phase === 'warn' ? 1 : 2;
    out[off + 1] = ['monsoon', 'blackout', 'surge'].indexOf(this.kind);
    out[off + 2] = this.timer;
    out[off + 3] = this.nextAt;
    out[off + 4] = this.intensity;
  }
  restore(from: Float64Array, off: number): void {
    this.phase = (['idle', 'warn', 'active'] as Phase[])[from[off]!] ?? 'idle';
    this.kind = (['monsoon', 'blackout', 'surge'] as StreetEventKind[])[from[off + 1]!] ?? 'monsoon';
    this.timer = from[off + 2]!;
    this.nextAt = from[off + 3]!;
    this.intensity = from[off + 4]!;
  }
}
