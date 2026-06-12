/**
 * The Sand Watch (idea.md §2.6): charges as you walk (full per ~400 m, one
 * charge stored), rewinds the world 6 seconds — undo a theft, a bus clip,
 * a bad crossing. Disabled on Daily Commute routes.
 *
 * Implementation: a ring buffer of COMPLETE sim snapshots (every system +
 * RNG stream states) captured each 30 Hz tick. Rewinding plays the buffer
 * backwards visually, then restores the oldest frame and resumes. Because
 * RNG state restores too, the world re-evolves deterministically — only the
 * player's new choices differ. Nothing desyncs by construction: we snapshot
 * everything.
 */

export const REWIND_SECONDS = 6;
export const REWIND_FRAMES = REWIND_SECONDS * 30;
const CHARGE_PER_METER = 1 / 400;
/** Real-time length of the backwards playback. */
const PLAYBACK_SECONDS = 1.5;

export interface Snapshottable {
  snapshot(out: Float64Array, offset: number): void;
  restore(from: Float64Array, offset: number): void;
}

export class RewindBuffer {
  private frames: Float64Array;
  private frameFloats: number;
  private head = 0; // next write index
  private count = 0;
  private systems: { sys: Snapshottable; offset: number }[] = [];

  constructor(systems: { sys: Snapshottable; floats: number }[]) {
    let offset = 0;
    for (const { sys, floats } of systems) {
      this.systems.push({ sys, offset });
      offset += floats;
    }
    this.frameFloats = offset;
    // One contiguous preallocated slab; zero GC pressure at runtime.
    this.frames = new Float64Array(this.frameFloats * REWIND_FRAMES);
  }

  get frameCount(): number {
    return this.count;
  }

  get bytes(): number {
    return this.frames.byteLength;
  }

  capture(): void {
    const base = this.head * this.frameFloats;
    const view = this.frames.subarray(base, base + this.frameFloats);
    for (const { sys, offset } of this.systems) sys.snapshot(view, offset);
    this.head = (this.head + 1) % REWIND_FRAMES;
    if (this.count < REWIND_FRAMES) this.count++;
  }

  /** Restore the i-th frame back from the newest (0 = newest). */
  restoreBack(framesBack: number): void {
    const clamped = Math.min(framesBack, this.count - 1);
    let idx = this.head - 1 - clamped;
    while (idx < 0) idx += REWIND_FRAMES;
    const base = idx * this.frameFloats;
    const view = this.frames.subarray(base, base + this.frameFloats);
    for (const { sys, offset } of this.systems) sys.restore(view, offset);
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

export type RewindPhase = 'idle' | 'rewinding' | 'recovering';

export class SandWatch {
  /** 0..1; full = one rewind stored. */
  charge = 0;
  owned = false;
  enabled = true; // false on Daily Commute (leaderboard integrity)
  phase: RewindPhase = 'idle';
  /** 0..1 progress through the backwards playback. */
  playback = 0;
  /** Slow-mo seconds remaining after the rewind point lands. */
  private recoverTimer = 0;

  constructor(readonly buffer: RewindBuffer) {}

  addDistance(meters: number): void {
    if (!this.owned || this.phase !== 'idle') return;
    this.charge = Math.min(1, this.charge + meters * CHARGE_PER_METER);
  }

  get canActivate(): boolean {
    return (
      this.owned && this.enabled && this.phase === 'idle' && this.charge >= 1 &&
      this.buffer.frameCount > 30
    );
  }

  activate(): boolean {
    if (!this.canActivate) return false;
    this.charge = 0;
    this.phase = 'rewinding';
    this.playback = 0;
    return true;
  }

  /**
   * Advance the rewind. Returns 'tick' while sim should stay frozen,
   * 'landed' on the single tick the rewind point restores, 'done' when
   * normal play resumes, or 'idle' when not rewinding.
   */
  fixedUpdate(dt: number): 'idle' | 'tick' | 'landed' | 'done' {
    if (this.phase === 'rewinding') {
      this.playback = Math.min(1, this.playback + dt / PLAYBACK_SECONDS);
      // Visual scrub: restore intermediate frames so the world walks backwards.
      const framesBack = Math.floor(this.playback * (this.buffer.frameCount - 1));
      this.buffer.restoreBack(framesBack);
      if (this.playback >= 1) {
        this.buffer.restoreBack(this.buffer.frameCount - 1);
        this.buffer.clear();
        this.phase = 'recovering';
        this.recoverTimer = 1.0;
        return 'landed';
      }
      return 'tick';
    }
    if (this.phase === 'recovering') {
      this.recoverTimer -= dt;
      if (this.recoverTimer <= 0) {
        this.phase = 'idle';
        return 'done';
      }
    }
    return 'idle';
  }
}
