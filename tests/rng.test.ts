import { describe, expect, it } from 'vitest';
import { Rng, RngStream, dailySeed, hashString } from '@/core/Rng';

describe('RngStream', () => {
  it('is deterministic for the same seed', () => {
    const a = new RngStream(12345);
    const b = new RngStream(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('produces different sequences for different seeds', () => {
    const a = new RngStream(1);
    const b = new RngStream(2);
    const same = Array.from({ length: 20 }, () => a.next() === b.next());
    expect(same.every(Boolean)).toBe(false);
  });

  it('snapshot/restore resumes the exact sequence', () => {
    const s = new RngStream(42);
    for (let i = 0; i < 10; i++) s.next();
    const snap = s.getState();
    const expected = Array.from({ length: 10 }, () => s.next());
    s.setState(snap);
    const replayed = Array.from({ length: 10 }, () => s.next());
    expect(replayed).toEqual(expected);
  });

  it('int stays within bounds', () => {
    const s = new RngStream(7);
    for (let i = 0; i < 1000; i++) {
      const v = s.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('weighted respects zero weights', () => {
    const s = new RngStream(9);
    for (let i = 0; i < 200; i++) {
      expect(s.weighted(['a', 'b'], [0, 1])).toBe('b');
    }
  });
});

describe('Rng named streams', () => {
  it('streams are independent and reproducible', () => {
    const r1 = new Rng(999);
    const r2 = new Rng(999);
    expect(r1.stream('crowd').next()).toBe(r2.stream('crowd').next());
    // Consuming one stream must not affect another.
    r1.stream('traffic').next();
    expect(r1.stream('crowd').next()).toBe(r2.stream('crowd').next());
  });

  it('snapshot/restore covers all streams', () => {
    const r = new Rng(5);
    r.stream('a').next();
    r.stream('b').next();
    const snap = r.snapshot();
    const a1 = r.stream('a').next();
    const b1 = r.stream('b').next();
    r.restore(snap);
    expect(r.stream('a').next()).toBe(a1);
    expect(r.stream('b').next()).toBe(b1);
  });
});

describe('dailySeed', () => {
  it('is stable for a given local date and differs across dates', () => {
    const d1 = new Date(2026, 5, 12, 9, 0, 0);
    const d1Later = new Date(2026, 5, 12, 23, 59, 0);
    const d2 = new Date(2026, 5, 13, 0, 1, 0);
    expect(dailySeed(d1)).toBe(dailySeed(d1Later));
    expect(dailySeed(d1)).not.toBe(dailySeed(d2));
  });
});

describe('hashString', () => {
  it('is stable and 32-bit unsigned', () => {
    expect(hashString('cakewalk')).toBe(hashString('cakewalk'));
    expect(hashString('cakewalk')).toBeGreaterThanOrEqual(0);
    expect(hashString('cakewalk')).toBeLessThanOrEqual(0xffffffff);
  });
});
