import { describe, expect, it } from 'vitest';
import { AgentState, CrowdSystem, MAX_AGENTS } from '@/crowd/CrowdSystem';
import { ARCHETYPE_INDEX } from '@/crowd/archetypes';
import { EventBus } from '@/core/EventBus';
import { Rng } from '@/core/Rng';
import { Player, Pose } from '@/player/Player';
import { StraightCorridor } from '@/world/Corridor';

const DT = 1 / 30;

function makeCrowd(seed = 42) {
  const corridor = new StraightCorridor(1000, 3);
  const bus = new EventBus();
  const crowd = new CrowdSystem(corridor, new Rng(seed).stream('crowd'), bus);
  return { crowd, bus, corridor };
}

describe('CrowdSystem', () => {
  it('prewarm fills to configured density', () => {
    const { crowd } = makeCrowd();
    crowd.config.density = 100;
    crowd.prewarm(0);
    let active = 0;
    for (let i = 0; i < MAX_AGENTS; i++) if (crowd.state[i] !== AgentState.Inactive) active++;
    expect(active).toBe(100);
  });

  it('agents flow toward the player (s decreases with flow=-1)', () => {
    const { crowd } = makeCrowd();
    crowd.config.density = 50;
    crowd.prewarm(0);
    const player = new Player();
    const before = crowd.s.slice();
    crowd.fixedUpdate(DT, player);
    let movedToward = 0;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (crowd.state[i] === AgentState.Walking && crowd.s[i]! < before[i]!) movedToward++;
    }
    expect(movedToward).toBeGreaterThan(20);
  });

  it('reversed flow moves agents away (Eid-ul-Fitr event)', () => {
    const { crowd } = makeCrowd();
    crowd.config.flowDirection = 1;
    crowd.config.density = 50;
    crowd.prewarm(0);
    const player = new Player();
    const before = crowd.s.slice();
    crowd.fixedUpdate(DT, player);
    let movedAway = 0;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (crowd.state[i] === AgentState.Walking && crowd.s[i]! > before[i]!) movedAway++;
    }
    expect(movedAway).toBeGreaterThan(20);
  });

  it('walking into an agent emits a bump and damages the player', () => {
    const { crowd, bus } = makeCrowd();
    const player = new Player();
    // Place one agent directly on the player.
    crowd.state[0] = AgentState.Walking;
    crowd.s[0] = player.s;
    crowd.t[0] = player.t;
    crowd.archetype[0] = ARCHETYPE_INDEX.uncle!;
    crowd.baseSpeed[0] = 1;
    let bumps = 0;
    bus.on('bump', () => bumps++);
    crowd.fixedUpdate(DT, player);
    bus.flush();
    expect(bumps).toBe(1);
    expect(player.health).toBeLessThan(100);
  });

  it('duck clears a HIGH-band head-load carrier', () => {
    const { crowd, bus } = makeCrowd();
    const player = new Player();
    player.pose = Pose.Duck;
    crowd.state[0] = AgentState.Walking;
    crowd.s[0] = player.s;
    crowd.t[0] = player.t;
    crowd.archetype[0] = ARCHETYPE_INDEX.headLoadCarrier!;
    crowd.baseSpeed[0] = 1;
    let bumps = 0;
    bus.on('bump', () => bumps++);
    crowd.fixedUpdate(DT, player);
    bus.flush();
    expect(bumps).toBe(0);
    expect(player.health).toBe(100);
  });

  it('near pass without contact emits one near-miss only', () => {
    const { crowd, bus } = makeCrowd();
    const player = new Player();
    crowd.state[0] = AgentState.Walking;
    crowd.s[0] = player.s + 0.3;
    crowd.t[0] = player.t + 0.85; // outside hitbox, inside near-miss ring
    crowd.archetype[0] = ARCHETYPE_INDEX.commuter!;
    crowd.baseSpeed[0] = 1.5;
    crowd.speed[0] = 1.5;
    let misses = 0;
    bus.on('nearMiss', () => misses++);
    crowd.fixedUpdate(DT, player);
    crowd.fixedUpdate(DT, player);
    bus.flush();
    expect(misses).toBe(1);
  });

  it('panicNear panics nearby walkers, who later calm down', () => {
    const { crowd } = makeCrowd();
    crowd.config.density = 40;
    crowd.prewarm(0);
    const player = new Player();
    const s0 = crowd.s[0]!;
    crowd.panicNear(s0, crowd.t[0]!, 5);
    expect(crowd.state[0]).toBe(AgentState.Panicked);
    for (let k = 0; k < 30 * 4; k++) crowd.fixedUpdate(DT, player);
    expect(crowd.state[0]).not.toBe(AgentState.Panicked);
  });

  it('same seed produces identical evolution (determinism)', () => {
    const a = makeCrowd(7);
    const b = makeCrowd(7);
    a.crowd.config.density = 80;
    b.crowd.config.density = 80;
    a.crowd.prewarm(0);
    b.crowd.prewarm(0);
    const pa = new Player();
    const pb = new Player();
    for (let k = 0; k < 120; k++) {
      a.crowd.fixedUpdate(DT, pa);
      b.crowd.fixedUpdate(DT, pb);
    }
    expect(Array.from(a.crowd.s)).toEqual(Array.from(b.crowd.s));
    expect(Array.from(a.crowd.t)).toEqual(Array.from(b.crowd.t));
  });

  it('snapshot/restore round-trips the full pool', () => {
    const { crowd } = makeCrowd(9);
    crowd.config.density = 60;
    crowd.prewarm(0);
    const player = new Player();
    for (let k = 0; k < 60; k++) crowd.fixedUpdate(DT, player);
    const buf = new Float32Array(CrowdSystem.SNAP_FLOATS);
    crowd.snapshot(buf, 0);
    const sBefore = crowd.s.slice();
    const stateBefore = crowd.state.slice();
    for (let k = 0; k < 60; k++) crowd.fixedUpdate(DT, player); // diverge
    crowd.restore(buf, 0);
    expect(Array.from(crowd.s)).toEqual(Array.from(sBefore));
    expect(Array.from(crowd.state)).toEqual(Array.from(stateBefore));
  });
});
