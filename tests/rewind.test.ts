/**
 * Sand Watch correctness: full-state snapshot/restore must make the world
 * re-evolve identically given identical inputs (the determinism guarantee
 * the whole rewind feature rests on).
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import { Rng } from '@/core/Rng';
import { Player } from '@/player/Player';
import { RunScore } from '@/economy/RunScore';
import { CrowdSystem } from '@/crowd/CrowdSystem';
import { PickpocketSystem } from '@/pickpocket/PickpocketSystem';
import { TrafficSystem } from '@/traffic/TrafficSystem';
import { Director } from '@/director/Director';
import { StraightCorridor } from '@/world/Corridor';
import { RewindBuffer, SandWatch, REWIND_FRAMES, type Snapshottable } from '@/items/SandWatch';
import type { InputIntent } from '@/player/Input';

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

/** A miniature run: player + crowd + pickpockets + traffic + director. */
function makeWorld(seed = 31) {
  const bus = new EventBus();
  const rng = new Rng(seed);
  const corridor = new StraightCorridor(2000, 3);
  const player = new Player();
  const score = new RunScore(bus);
  const crowd = new CrowdSystem(corridor, rng.stream('crowd'), bus);
  crowd.config.density = 80;
  crowd.prewarm(0);
  const director = new Director(rng.stream('director'), bus);
  const pm = new PickpocketSystem(rng.stream('pocketmar'), bus);
  pm.config = { risk: 4, canSpawn: director.canSpawnPickpocket };
  const traffic = new TrafficSystem(rng.stream('traffic'), bus);
  traffic.setZones([{ s: 60, difficulty: 4, halfWidth: 4.5, crossed: false }]);

  const rngSnap: Snapshottable = {
    snapshot: (out, off) => {
      ['crowd', 'pocketmar', 'traffic', 'director'].forEach(
        (n, i) => (out[off + i] = rng.stream(n).getState()),
      );
    },
    restore: (from, off) => {
      ['crowd', 'pocketmar', 'traffic', 'director'].forEach((n, i) =>
        rng.stream(n).setState(from[off + i]!),
      );
    },
  };
  const buffer = new RewindBuffer([
    { sys: player, floats: Player.SNAP_FLOATS },
    { sys: crowd, floats: CrowdSystem.SNAP_FLOATS },
    { sys: pm, floats: PickpocketSystem.SNAP_FLOATS },
    { sys: traffic, floats: TrafficSystem.SNAP_FLOATS },
    { sys: director, floats: Director.SNAP_FLOATS },
    { sys: score, floats: RunScore.SNAP_FLOATS },
    { sys: rngSnap, floats: 4 },
  ]);

  const step = (input: InputIntent): void => {
    player.fixedUpdate(DT, input, corridor);
    crowd.fixedUpdate(DT, player);
    traffic.fixedUpdate(DT, player, score);
    pm.fixedUpdate(DT, player, score, 3);
    director.fixedUpdate(DT, player);
    score.fixedUpdate(DT);
    // Capture AFTER the flush: event handlers (combo, director suppression)
    // mutate sim state, and the snapshot must include those effects.
    bus.flush();
    buffer.capture();
  };

  const hash = (): string => {
    // Cheap structural hash over the live state.
    let h = 0;
    const mix = (v: number): void => {
      h = (Math.imul(h, 31) + Math.round(v * 1000)) | 0;
    };
    mix(player.s);
    mix(player.t);
    mix(player.health);
    mix(player.stamina);
    mix(score.taka);
    for (let i = 0; i < crowd.s.length; i += 7) {
      mix(crowd.s[i]!);
      mix(crowd.t[i]!);
      mix(crowd.state[i]!);
    }
    for (let i = 0; i < pm.s.length; i++) {
      mix(pm.s[i]!);
      mix(pm.state[i]!);
    }
    for (let i = 0; i < traffic.vS.length; i++) {
      mix(traffic.vT[i]!);
      mix(traffic.vActive[i]!);
    }
    return h.toString(16);
  };

  return { step, hash, buffer, player, score };
}

describe('Sand Watch rewind determinism', () => {
  it('restore + identical inputs ⇒ identical evolution (state-hash equality)', () => {
    const world = makeWorld();
    // Walk a while with varied inputs.
    const script: InputIntent[] = [];
    for (let i = 0; i < 240; i++) {
      script.push(intent({ speed: i % 60 < 30 ? 1 : 0, lateral: Math.sin(i / 20) }));
    }
    for (const inp of script.slice(0, 120)) world.step(inp);

    // Snapshot here, run 120 more ticks, record the trajectory of hashes.
    world.buffer.capture();
    const tail = script.slice(120);
    const hashesA: string[] = [];
    for (const inp of tail) {
      world.step(inp);
      hashesA.push(world.hash());
    }

    // Rewind to the snapshot and replay the same inputs.
    world.buffer.restoreBack(tail.length); // back to the capture point
    const hashesB: string[] = [];
    for (const inp of tail) {
      world.step(inp);
      hashesB.push(world.hash());
    }
    expect(hashesB).toEqual(hashesA);
  });

  it('different post-rewind inputs diverge (the "undo" actually changes fate)', () => {
    const world = makeWorld(77);
    for (let i = 0; i < 150; i++) world.step(intent({ speed: 1 }));
    const before = world.hash();
    world.buffer.restoreBack(60);
    for (let i = 0; i < 60; i++) world.step(intent({ speed: -1, lateral: 1 }));
    expect(world.hash()).not.toBe(before);
  });

  it('SandWatch charges by distance and activates once at full charge', () => {
    const world = makeWorld();
    const watch = new SandWatch(world.buffer);
    watch.owned = true;
    expect(watch.canActivate).toBe(false);
    watch.addDistance(399);
    expect(watch.canActivate).toBe(false); // not full yet
    watch.addDistance(2);
    for (let i = 0; i < 40; i++) world.step(intent());
    expect(watch.canActivate).toBe(true);
    expect(watch.activate()).toBe(true);
    expect(watch.charge).toBe(0);
    expect(watch.activate()).toBe(false);
  });

  it('rewind playback restores the oldest frame after the scrub', () => {
    const world = makeWorld(5);
    const watch = new SandWatch(world.buffer);
    watch.owned = true;
    watch.charge = 1;
    // Fill the buffer fully.
    for (let i = 0; i < REWIND_FRAMES + 20; i++) world.step(intent({ speed: 1 }));
    const sNow = world.player.s;
    expect(watch.activate()).toBe(true);
    let result: string = 'tick';
    let guard = 0;
    while (result !== 'landed' && guard++ < 200) result = watch.fixedUpdate(DT);
    expect(result).toBe('landed');
    // 6 seconds of walking undone (within a tolerance for accel phases).
    expect(world.player.s).toBeLessThan(sNow - 20);
  });

  it('disabled (Daily Commute) never activates', () => {
    const world = makeWorld();
    const watch = new SandWatch(world.buffer);
    watch.owned = true;
    watch.enabled = false;
    watch.charge = 1;
    for (let i = 0; i < 40; i++) world.step(intent());
    expect(watch.canActivate).toBe(false);
  });
});
