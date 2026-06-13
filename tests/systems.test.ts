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
  it('arriving at a zone raises pendingZone for the minigame', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([{ s: 20, difficulty: 3, halfWidth: 4.5, crossed: false }]);
    let entered = false;
    bus.on('crossingEntered', () => (entered = true));
    player.s = 19;
    traffic.fixedUpdate(DT, player, score);
    bus.flush();
    expect(traffic.pendingZone).not.toBeNull();
    expect(entered).toBe(true);
  });

  it('minigame outcomes apply: crossed pays, hit hurts and knocks back, skip is safe', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([
      { s: 20, difficulty: 3, halfWidth: 4.5, crossed: false },
      { s: 80, difficulty: 3, halfWidth: 4.5, crossed: false },
      { s: 140, difficulty: 3, halfWidth: 4.5, crossed: false },
    ]);
    const [z1, z2, z3] = traffic.zones;
    traffic.resolveCrossing(z1!, 'crossed', player, score);
    expect(z1!.crossed).toBe(true);
    expect(score.taka).toBeGreaterThan(0);
    expect(player.s).toBeGreaterThan(20);

    player.s = 79;
    traffic.resolveCrossing(z2!, 'hit', player, score);
    expect(z2!.crossed).toBe(false); // must try again
    expect(player.health).toBeLessThan(100);
    expect(player.s).toBeLessThan(79); // knocked back

    player.s = 139;
    const takaBefore = score.taka;
    traffic.resolveCrossing(z3!, 'skipped', player, score);
    expect(z3!.crossed).toBe(true);
    expect(score.taka).toBe(takaBefore); // no bonus on the overbridge
    expect(player.s).toBeGreaterThan(140);
  });

  it('stream traffic flows toward the player and never collides', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([]);
    let hit = false;
    bus.on('vehicleHit', () => (hit = true));
    for (let i = 0; i < 30 * 30; i++) {
      traffic.fixedUpdate(DT, player, score);
      player.s += 2.4 * DT;
      bus.flush();
    }
    let sawActive = 0;
    for (let i = 0; i < traffic.vActive.length; i++) if (traffic.vActive[i]) sawActive++;
    expect(sawActive).toBeGreaterThan(0);
    expect(hit).toBe(false);
    // All stream vehicles live on the road lanes (left of the footpath).
    for (let i = 0; i < traffic.vActive.length; i++) {
      if (traffic.vActive[i]) expect(traffic.vT[i]!).toBeLessThan(-4);
    }
  });

  it('stepping onto the road exposes the player to fast cars', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([]);
    let hits = 0;
    bus.on('vehicleHit', () => hits++);
    player.t = -6; // out on the road, in the lanes
    for (let i = 0; i < 30 * 30; i++) {
      traffic.fixedUpdate(DT, player, score);
      player.s += 2.4 * DT;
      player.t = -6; // hold position on the road
      bus.flush();
    }
    expect(hits).toBeGreaterThan(0);
    expect(player.health).toBeLessThan(100);
  });

  it('overbridge from a pending zone lifts the player safely across', () => {
    const { bus, rng, player, score } = setup();
    const traffic = new TrafficSystem(rng.stream('t'), bus);
    traffic.setZones([{ s: 20, difficulty: 5, halfWidth: 4.5, crossed: false }]);
    player.s = 19;
    traffic.fixedUpdate(DT, player, score); // raises pendingZone
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
    const { bus, rng, player, score } = setup();
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
    life.fixedUpdate(DT, player, crowd, score);
    bus.flush();
    expect(barked).toBe(true);
    expect(dog.barked).toBe(true);
  });

  it('a thieving cat snatches taka on contact', () => {
    const { bus, rng, player, score } = setup();
    score.add(80, 'test');
    const corridor = new StraightCorridor(600, 3);
    const crowd = new CrowdSystem(corridor, rng.stream('c'), bus);
    const life = new StreetLife(rng.stream('l'), bus);
    life.catActive[0] = 1;
    life.catS[0] = player.s;
    life.catT[0] = player.t;
    life.catDir[0] = 1;
    let stolen = 0;
    bus.on('theft', (e) => (stolen = e.amount));
    life.fixedUpdate(DT, player, crowd, score);
    bus.flush();
    expect(stolen).toBeGreaterThan(0);
    expect(score.taka).toBe(80 - stolen);
  });

  it('a cat with an empty wallet just breaks the combo', () => {
    const { bus, rng, player, score } = setup();
    const corridor = new StraightCorridor(600, 3);
    const crowd = new CrowdSystem(corridor, rng.stream('c'), bus);
    const life = new StreetLife(rng.stream('l'), bus);
    life.catActive[0] = 1;
    life.catS[0] = player.s;
    life.catT[0] = player.t;
    life.catDir[0] = 1;
    let stumble = false;
    bus.on('catStumble', () => (stumble = true));
    life.fixedUpdate(DT, player, crowd, score);
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
    inter.toggleSit(player, 3);
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

describe('Cows (Eid theming)', () => {
  it('stampede panics the crowd and pays a survival bonus', () => {
    const { bus, rng, player, score } = setup();
    const corridor = new StraightCorridor(600, 3);
    const crowd = new CrowdSystem(corridor, rng.stream('c'), bus);
    crowd.config.density = 30;
    crowd.prewarm(0);
    const life = new StreetLife(rng.stream('l'), bus);
    life.populate(600, 3, []);
    player.t = 2.9; // hug the edge to dodge
    let started = false;
    let bonus = 0;
    bus.on('cowStampede', () => (started = true));
    bus.on('stampedeSurvived', (e) => (bonus = e.bonus));
    life.startStampede(player, crowd);
    bus.flush();
    expect(started).toBe(true);
    for (let i = 0; i < 30 * 20 && bonus === 0; i++) {
      life.fixedUpdate(DT, player, crowd, score);
      bus.flush();
    }
    expect(bonus).toBeGreaterThan(0);
    void score;
  });

  it('a stampeding cow hit hurts and voids the bonus', () => {
    const { bus, rng, player, score } = setup();
    const corridor = new StraightCorridor(600, 3);
    const crowd = new CrowdSystem(corridor, rng.stream('c'), bus);
    const life = new StreetLife(rng.stream('l'), bus);
    life.populate(600, 3, []);
    player.t = 0;
    let bonus = 0;
    bus.on('stampedeSurvived', (e) => (bonus = e.bonus));
    life.startStampede(player, crowd);
    // Park the player in the cows' path.
    for (let i = 0; i < 30 * 20; i++) {
      life.fixedUpdate(DT, player, crowd, score);
      player.bumpCooldown = 0; // allow repeated checks
      bus.flush();
    }
    expect(player.health).toBeLessThan(100);
    expect(bonus).toBe(0);
  });
});
