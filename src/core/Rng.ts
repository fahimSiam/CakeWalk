/**
 * Deterministic seeded PRNG (mulberry32) with named streams.
 *
 * Sim code must NEVER call Math.random(): every random decision flows
 * through a named stream derived from the run seed, so that Daily Commute
 * (same date = same world for everyone), ghost runs, and Sand Watch rewind
 * (snapshot/restore of stream state) all stay deterministic.
 */

export function hashString(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class RngStream {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a uniformly random element. Array must be non-empty. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  /** Snapshot for rewind. */
  getState(): number {
    return this.state;
  }

  /** Restore from rewind snapshot. */
  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** A collection of independently-seeded named streams for one run. */
export class Rng {
  private streams = new Map<string, RngStream>();

  constructor(readonly runSeed: number) {}

  stream(name: string): RngStream {
    let s = this.streams.get(name);
    if (!s) {
      s = new RngStream((this.runSeed ^ hashString(name)) >>> 0);
      this.streams.set(name, s);
    }
    return s;
  }

  /** Snapshot all stream states (for Sand Watch rewind). */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, s] of this.streams) out[name] = s.getState();
    return out;
  }

  restore(snap: Record<string, number>): void {
    for (const [name, state] of Object.entries(snap)) {
      this.stream(name).setState(state);
    }
  }
}

/** Seed for the shared daily route: identical for all players on a date. */
export function dailySeed(date = new Date()): number {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return hashString(`cakewalk-daily-${y}-${m}-${d}`);
}
