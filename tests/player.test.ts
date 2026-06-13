import { describe, expect, it } from 'vitest';
import { Player, Pose, SPEED_JOG, SPEED_SHUFFLE } from '@/player/Player';
import { StraightCorridor } from '@/world/Corridor';
import type { InputIntent } from '@/player/Input';

const corridor = new StraightCorridor(1000, 3);
const DT = 1 / 30;

function intent(partial: Partial<InputIntent> = {}): InputIntent {
  return {
    lateral: 0,
    speed: 0,
    jump: false,
    shoulderLeft: false,
    shoulderRight: false,
    stare: false,
    phone: false,
    sandWatch: false,
    sit: false,
    overbridge: false,
    ...partial,
  };
}

function steps(p: Player, n: number, i: InputIntent): void {
  for (let k = 0; k < n; k++) p.fixedUpdate(DT, i, corridor);
}

describe('Player', () => {
  it('walks forward at walk speed by default', () => {
    const p = new Player();
    steps(p, 60, intent()); // 2s; ~SPEED_WALK m/s after a brief accel ramp
    expect(p.s).toBeGreaterThan(4.5);
    expect(p.s).toBeLessThan(6.5);
  });

  it('sprint drains stamina and exhaustion forces shuffle', () => {
    const p = new Player();
    steps(p, 30 * 9, intent({ speed: 1 })); // 9s sprint > 100/14s
    expect(p.exhausted).toBe(true);
    steps(p, 30, intent({ speed: 1 }));
    expect(p.speed).toBeLessThan(SPEED_SHUFFLE + 0.4);
  });

  it('recovers from exhaustion above the lock threshold', () => {
    const p = new Player();
    p.stamina = 0;
    p.exhausted = true;
    steps(p, 30 * 12, intent()); // walk recovery 3/s → 36 > 25
    expect(p.exhausted).toBe(false);
  });

  it('clamps lateral movement to corridor width', () => {
    const p = new Player();
    steps(p, 30 * 5, intent({ lateral: 1 }));
    expect(p.t).toBeLessThanOrEqual(3 - 0.3 + 1e-6);
  });

  it('both shoulders = duck, capping speed and shrinking hitbox', () => {
    const p = new Player();
    const duck = intent({ shoulderLeft: true, shoulderRight: true, speed: 1 });
    steps(p, 60, duck);
    expect(p.pose).toBe(Pose.Duck);
    expect(p.speed).toBeLessThan(SPEED_JOG - 1);
    expect(p.hitHalfWidth).toBeLessThan(0.3);
  });

  it('jump arc rises and lands', () => {
    const p = new Player();
    p.fixedUpdate(DT, intent({ jump: true }), corridor);
    let peak = 0;
    for (let k = 0; k < 30; k++) {
      p.fixedUpdate(DT, intent(), corridor);
      peak = Math.max(peak, p.y);
    }
    expect(peak).toBeGreaterThan(0.6);
    expect(p.y).toBe(0);
    expect(p.jumping).toBe(false);
  });

  it('bump cooldown prevents multi-hits', () => {
    const p = new Player();
    expect(p.applyBump(10)).toBe(true);
    expect(p.applyBump(10)).toBe(false);
    expect(p.health).toBe(90);
  });

  it('resting recovers stamina and stops movement', () => {
    const p = new Player();
    p.stamina = 10;
    p.resting = true;
    const s0 = p.s;
    steps(p, 60, intent({ speed: 1 }));
    expect(p.s).toBe(s0);
    expect(p.stamina).toBeGreaterThan(50);
  });

  it('snapshot/restore round-trips exactly', () => {
    const p = new Player();
    steps(p, 50, intent({ speed: 1, lateral: 0.5 }));
    const buf = new Float64Array(Player.SNAP_FLOATS);
    p.snapshot(buf, 0);
    const q = new Player();
    q.restore(buf, 0);
    expect(q.s).toBeCloseTo(p.s, 5);
    expect(q.t).toBeCloseTo(p.t, 5);
    expect(q.stamina).toBeCloseTo(p.stamina, 4);
    expect(q.pose).toBe(p.pose);
    expect(q.exhausted).toBe(p.exhausted);
  });
});
