import { describe, expect, it } from 'vitest';
import { EventBus } from '@/core/EventBus';
import { Rng } from '@/core/Rng';
import { Player } from '@/player/Player';
import { RunScore } from '@/economy/RunScore';
import { PickpocketSystem, PmState, MAX_POCKETMARS } from '@/pickpocket/PickpocketSystem';
import { TrafficSystem } from '@/traffic/TrafficSystem';
import { StreetLife } from '@/world/StreetLife';
import { Director } from '@/director/Director';
import { Interactions } from '@/world/Interactions';
import { CrowdSystem } from '@/crowd/CrowdSystem';
import { StraightCorridor } from '@/world/Corridor';

const DT = 1 / 30;

function setup(seed = 1) {
  const bus = new EventBus();
  const rng = new Rng(seed);
  const player = new Player();
  const score = new RunScore(bus);
  return { bus, rng, player, score };
}

describe('PickpocketSystem', () => {
  it('a striking pocketmar steals taka', () => {
    const { bus, rng, player, score } = setup();
    score.add(100, 'test');
    const pm = new PickpocketSystem(rng.stream('pm'), bus);
    pm.state[0] = PmState.Striking;
    pm.s[0] = player.s + 2;
    pm.t[0] = player.t;
    pm.innocent[0] = 0;
    let thefts = 0;
    bus.on('theft', () => thefts++);
    for (let i = 0; i < 90; i++) {
      pm.fixedUpdate(DT, player, score, 3);
      bus.flush();
    }
    expect(thefts).toBe(1);
    expect(score.taka).toBeLessThan(100);
    expect(pm.state[0]).not.toBe(PmState.Striking);
  });

  it('stare-down spots a turned pocketmar and pays a bonus', () => {
    const { bus, rng, player, score } = setup();
    const pm = new PickpocketSystem(rng.stream('pm'), bus);
    pm.state[0] = PmState.Turned;
    pm.s[0] = player.s + 4;
    pm.t[0] = player.t + 1;
    pm.suspicion[0] = 0.8;
    pm.innocent[0] = 0;
    expect(pm.stare(player, score)).toBe('spotted');
    expect(pm.state[0]).toBe(PmState.Fleeing);
    expect(score.taka).toBeGreaterThan(0);
  });

  it('staring at an innocent costs combo (misread)', () => {
    const { bus, rng, player, score } = setup();
    const pm = new PickpocketSystem(rng.stream('pm'), bus);
    pm.state[0] = PmState.Turned;
    pm.s[0] = player.s + 4;
    pm.t[0] = player.t + 1;
    pm.suspicion[0] = 0.5;
    pm.innocent[0] = 1;
    let misreads = 0;
    bus.on('stareMisread', () => misreads++);
    expect(pm.stare(player, score)).toBe('misread');
    bus.flush();
    expect(misreads).toBe(1);
  });

  it('stare respects the cooldown', () => {
    const { bus, rng, player, score } = setup();
    const pm = new PickpocketSystem(rng.stream('pm'), bus);
    expect(pm.stare(player, score)).toBe('nothing');
    expect(pm.stare(player, score)).toBe('cooldown');
  });

  it('director suppression blocks turning into a thief', () => {
    const { bus, rng, player, score } = setup();
    const pm = new PickpocketSystem(rng.stream('pm'), bus);
    pm.config = { risk: 5, canSpawn: () => false };
    for (let i = 0; i < 30 * 30; i++) pm.fixedUpdate(DT, player, score, 3);
    for (let i = 0; i < MAX_POCKETMARS; i++) {
      expect(pm.state[i]).not.toBe(PmState.Striking);
      // Disguised walkers may exist but never commit while suppressed.
      if (pm.state[i] === PmState.Turned) expect(pm.innocent[i]).toBe(1);
    }
  });

  it('snapshot/restore round-trips', () => {
    const { bus, rng, player, score } = setup(9);
    const pm = new PickpocketSystem(rng.stream('pm'), bus);
    for (let i = 0; i < 200; i++) pm.fixedUpdate(DT, player, score, 3);
    const buf = new Float64Array(PickpocketSystem.SNAP_FLOATS);
    pm.snapshot(buf, 0);
    const states = pm.state.slice();
    const ss = pm.s.slice();
    for (let i = 0; i < 100; i++) pm.fixedUpdate(DT, player, score, 3);
    pm.restore(buf, 0);
    expect(Array.from(pm.state)).toEqual(Array.from(states));
    expect(Array.from(pm.s)).toEqual(Array.from(ss));
  });
});

describe('TrafficSystem', () => {
  it('crossing directly past the zone pays a bonus', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([{ s: 20, difficulty: 3, halfWidth: 4.5, crossed: false }]);
    let resolved: string | null = null;
    bus.on('crossingResolved', (e) => (resolved = e.method));
    player.s = 25; // beyond the far edge
    traffic.fixedUpdate(DT, player, score);
    bus.flush();
    expect(resolved).toBe('direct');
    expect(score.taka).toBeGreaterThan(0);
  });

  it('vehicle overlap damages and knocks back the player', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([{ s: 20, difficulty: 3, halfWidth: 4.5, crossed: false }]);
    traffic.vActive[0] = 1;
    traffic.vKind[0] = 0; // bus
    traffic.vS[0] = 20;
    traffic.vT[0] = 0;
    traffic.vDir[0] = 1;
    player.s = 20;
    player.t = 0;
    let hit = false;
    bus.on('vehicleHit', () => (hit = true));
    traffic.fixedUpdate(DT, player, score);
    bus.flush();
    expect(hit).toBe(true);
    expect(player.health).toBeLessThan(100);
    expect(player.s).toBeLessThan(20); // knocked back
  });

  it('overbridge lifts the player safely across', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([{ s: 20, difficulty: 5, halfWidth: 4.5, crossed: false }]);
    player.s = 16;
    traffic.fixedUpdate(DT, player, score); // sets inZone
    expect(traffic.inZone).not.toBeNull();
    expect(traffic.useOverbridge(player)).toBe(true);
    let method: string | null = null;
    bus.on('crossingResolved', (e) => (method = e.method));
    for (let i = 0; i < 30 * 10 && method === null; i++) {
      traffic.fixedUpdate(DT, player, score);
      bus.flush();
    }
    expect(method).toBe('overbridge');
    expect(player.health).toBe(100);
    expect(traffic.zones[0]!.crossed).toBe(true);
  });
});

describe('StreetLife', () => {
  it('sprinting past a sleeping dog triggers a bark panic ripple', () => {
    const { bus, rng, player } = setup();
    const corridor = new StraightCorridor(600, 3);
    const crowd = new CrowdSystem(corridor, rng.stream('c'), bus);
    crowd.config.density = 30;
    crowd.prewarm(0);
    const life = new StreetLife(rng.stream('l'), bus);
    life.populate(600, 3, []);
    const dog = life.dogs[0]!;
    player.s = dog.s - 1;
    player.t = dog.t + 1;
    player.speed = 5; // sprinting
    let barked = false;
    bus.on('dogBark', () => (barked = true));
    life.fixedUpdate(DT, player, crowd);
    bus.flush();
    expect(barked).toBe(true);
    expect(dog.barked).toBe(true);
  });

  it('cats break combo on contact', () => {
    const { bus, rng, player } = setup();
    const corridor = new StraightCorridor(600, 3);
    const crowd = new CrowdSystem(corridor, rng.stream('c'), bus);
    const life = new StreetLife(rng.stream('l'), bus);
    life.catActive[0] = 1;
    life.catS[0] = player.s;
    life.catT[0] = player.t;
    life.catDir[0] = 1;
    let stumble = false;
    bus.on('catStumble', () => (stumble = true));
    life.fixedUpdate(DT, player, crowd);
    bus.flush();
    expect(stumble).toBe(true);
  });
});

describe('Director', () => {
  it('suppresses pickpockets after a theft', () => {
    const { bus, rng, player } = setup();
    const director = new Director(rng.stream('d'), bus);
    expect(director.canSpawnPickpocket()).toBe(true);
    bus.emit('theft', { amount: 10, source: 'walk' });
    bus.flush();
    expect(director.canSpawnPickpocket()).toBe(false);
    for (let i = 0; i < 30 * 13; i++) director.fixedUpdate(DT, player);
    expect(director.canSpawnPickpocket()).toBe(true);
  });
});

describe('Interactions', () => {
  it('sitting at a cha dokan restores health and stamina', () => {
    const { bus, player, score } = setup();
    const inter = new Interactions(bus);
    inter.points = [{ kind: 'chaDokan', s: 0, t: 1, fruit: false }];
    player.health = 40;
    player.stamina = 10;
    inter.fixedUpdate(DT, player, score); // detect proximity
    expect(inter.nearRest).not.toBeNull();
    inter.toggleSit(player);
    expect(player.resting).toBe(true);
    for (let i = 0; i < 30 * 5; i++) {
      player.fixedUpdate(DT, { lateral: 0, speed: 0, jump: false, shoulderLeft: false, shoulderRight: false, stare: false, phone: false, sandWatch: false, sit: false, overbridge: false }, new StraightCorridor(100, 3));
      inter.fixedUpdate(DT, player, score);
    }
    expect(player.health).toBeGreaterThan(40);
    expect(player.stamina).toBeGreaterThan(10);
  });

  it('jump-grabbing fruit awards points and health once per tree', () => {
    const { bus, player, score } = setup();
    const inter = new Interactions(bus);
    inter.points = [{ kind: 'tree', s: 0, t: 0, fruit: true }];
    player.health = 80;
    player.y = 0.8;
    player.jumpTimer = 0.2;
    let grabs = 0;
    bus.on('fruitGrabbed', () => grabs++);
    inter.fixedUpdate(DT, player, score);
    inter.fixedUpdate(DT, player, score);
    bus.flush();
    expect(grabs).toBe(1);
    expect(score.taka).toBe(12);
    expect(player.health).toBe(86);
  });

  it('phone check locks the player, min duration, then unlocks', () => {
    const { bus, player, score } = setup();
    const inter = new Interactions(bus);
    inter.togglePhone(player);
    expect(player.phoneLocked).toBe(true);
    // Cannot cancel before 1 s.
    inter.fixedUpdate(DT, player, score);
    inter.togglePhone(player);
    expect(player.phoneLocked).toBe(true);
    for (let i = 0; i < 30 * 3; i++) inter.fixedUpdate(DT, player, score);
    expect(player.phoneLocked).toBe(false);
  });
});
