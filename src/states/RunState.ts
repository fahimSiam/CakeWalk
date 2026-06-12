/**
 * The core gameplay state. M1: graybox corridor + crowd + scoring.
 * Later milestones layer minigames, pickpockets, items, and the Director on
 * top of the same structure.
 */
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
} from 'three';
import { PlayerAvatar } from '@/gfx/PlayerAvatar';
import { SplineCorridor } from '@/world/SplineCorridor';
import { LevelRenderer } from '@/world/LevelRenderer';
import type { BakedArea } from '@/world/levelTypes';
import type { RouteOption } from '@/routing/RouteGraph';
import type { GameState } from '@/core/StateMachine';
import type { GameContext } from '@/core/GameContext';
import { EventBus } from '@/core/EventBus';
import { Rng } from '@/core/Rng';
import { StraightCorridor, type Corridor, type PathPose } from '@/world/Corridor';
import { Player, HEALTH_MAX } from '@/player/Player';
import { CrowdSystem } from '@/crowd/CrowdSystem';
import { CrowdRenderer } from '@/crowd/CrowdRenderer';
import { RunScore } from '@/economy/RunScore';
import { Hud } from '@/ui/Hud';
import { PickpocketSystem } from '@/pickpocket/PickpocketSystem';
import { TrafficSystem, type CrossingZone } from '@/traffic/TrafficSystem';
import { StreetLife } from '@/world/StreetLife';
import { Director } from '@/director/Director';
import { Interactions, type RoutePoint } from '@/world/Interactions';
import { PickpocketRenderer, StreetLifeRenderer, TrafficRenderer } from '@/gfx/entityRenderers';
import { PhoneOverlay } from '@/ui/PhoneOverlay';
import { RewindBuffer, SandWatch, type Snapshottable } from '@/items/SandWatch';
import { RewindFx } from '@/gfx/RewindFx';
import {
  OUTFIT_COLORS,
  localDateKey,
  packGhost,
  unpackGhost,
  type RunSummary,
} from '@/meta/progression';
import { buildPersonGeometry } from '@/gfx/meshFactory';
import { dressScene, rollAtmosphere, type AtmosphereHandle, type AtmosphereMods } from '@/world/Atmosphere';
import { t, tf } from '@/i18n';
import { PmState } from '@/pickpocket/PickpocketSystem';
import { totalStars } from '@/economy/stars';

const RUN_LENGTH = 500;
const CORRIDOR_HALF_WIDTH = 3.2;

export interface RunParams {
  seed: number;
  density?: number;
  /** Real-level mode: baked area + chosen route. Absent = graybox corridor. */
  area?: BakedArea;
  route?: RouteOption;
  /** Owned items applied to this run (sandWatch, glasses, …). */
  items?: string[];
  /** Daily Commute: Sand Watch disabled for leaderboard integrity. */
  daily?: boolean;
  /** FTUE: scripted teaching beats, unrated, no energy cost. */
  tutorial?: boolean;
}

/** Teaching beats by distance along the tutorial route (idea.md §9). */
const TUTORIAL_STEPS: { at: number; key: import('@/i18n').LangKey }[] = [
  { at: 8, key: 'tutDrift' },
  { at: 45, key: 'tutDip' },
  { at: 80, key: 'tutDuck' },
  { at: 120, key: 'tutSprint' },
  { at: 170, key: 'tutJump' },
  { at: 230, key: 'tutCha' },
];
const TUTORIAL_THEFT_AT = 300;

export class RunState implements GameState {
  private scene!: Scene;
  private bus!: EventBus;
  private rng!: Rng;
  private corridor!: Corridor;
  private player!: Player;
  private crowd!: CrowdSystem;
  private crowdRenderer!: CrowdRenderer;
  private score!: RunScore;
  private hud!: Hud;
  private avatar!: PlayerAvatar;
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private finished = false;
  private prevS = 0;
  private prevT = 0;
  private level: LevelRenderer | null = null;
  private params: RunParams = { seed: 1 };
  private runLength = RUN_LENGTH;
  private pickpockets!: PickpocketSystem;
  private traffic!: TrafficSystem;
  private streetLife!: StreetLife;
  private director!: Director;
  private interactions!: Interactions;
  private pmRenderer!: PickpocketRenderer;
  private trafficRenderer!: TrafficRenderer;
  private lifeRenderer!: StreetLifeRenderer;
  private phoneOverlay!: PhoneOverlay;
  private sandWatch!: SandWatch;
  private rewindFx!: RewindFx;
  private elapsed = 0;
  private summary: RunSummary = {
    chaCups: 0,
    fruits: 0,
    directCrossings: 0,
    nearMisses: 0,
    spotted: 0,
    distanceM: 0,
  };
  private reviveUsed = false;
  private reviveOverlay: HTMLDivElement | null = null;
  // Ghost (seeded/daily routes): record this run, race the saved best.
  private ghostFrames: { s: number; t: number }[] = [];
  private ghostBest: { s: number; t: number }[] = [];
  private ghostMesh: Mesh | null = null;
  private atmosphere!: AtmosphereMods;
  private atmosphereHandle: AtmosphereHandle = { frame: () => {}, dispose: () => {} };
  /** Scene-local resources (graybox planes, finish gate) disposed on exit. */
  private ownedResources: { geometry?: { dispose(): void }; material?: { dispose(): void } }[] = [];
  private tutorialStep = 0;
  private tutorialTheftDone = false;
  private tutorialTheftStaged = false;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const p = (params as RunParams | undefined) ?? { seed: 1 };
    this.params = p;
    this.finished = false;
    this.elapsed = 0;
    this.reviveUsed = false;
    this.summary = { chaCups: 0, fruits: 0, directCrossings: 0, nearMisses: 0, spotted: 0, distanceM: 0 };
    this.ghostFrames = [];
    this.bus = new EventBus();
    this.rng = new Rng(p.seed);
    if (p.route) {
      this.corridor = new SplineCorridor(p.route.pts);
      this.runLength = Math.max(50, this.corridor.length - 5);
    } else {
      this.corridor = new StraightCorridor(RUN_LENGTH + 60, CORRIDOR_HALF_WIDTH);
      this.runLength = RUN_LENGTH;
    }
    this.player = new Player();
    this.score = new RunScore(this.bus);
    this.atmosphere = rollAtmosphere(
      this.rng.stream('weather'),
      this.ctx.save.get().ownedItems.includes('umbrella'),
    );
    this.crowd = new CrowdSystem(this.corridor, this.rng.stream('crowd'), this.bus);
    if (p.tutorial) this.crowd.config.density = 45;
    else if (p.density) this.crowd.config.density = p.density;
    else if (p.route) {
      // Softer base curve + newcomer grace until the first 5 stars are earned.
      const newcomer = totalStars(this.ctx.save.get().stars) < 5 ? 0.7 : 1;
      this.crowd.config.density = Math.min(
        170,
        Math.round((30 + p.route.crowd * 22) * this.atmosphere.crowdDensityMul * newcomer),
      );
    }
    this.crowd.config.widthAdd = this.atmosphere.agentWidthAdd;

    // M4 systems.
    this.director = new Director(this.rng.stream('director'), this.bus);
    this.pickpockets = new PickpocketSystem(this.rng.stream('pocketmar'), this.bus);
    this.pickpockets.config = {
      risk: p.route?.pickpocket ?? 2,
      // Tutorial: no organic pocketmars — only the one scripted loss.
      canSpawn: p.tutorial ? () => false : this.director.canSpawnPickpocket,
    };
    this.tutorialStep = 0;
    this.tutorialTheftDone = false;
    this.tutorialTheftStaged = false;
    this.traffic = new TrafficSystem(this.rng.stream('traffic'), this.bus);
    this.traffic.setZones(this.buildCrossingZones());
    this.streetLife = new StreetLife(this.rng.stream('streetlife'), this.bus);
    this.interactions = new Interactions(this.bus);
    this.interactions.points = this.buildRoutePoints();
    this.streetLife.populate(
      this.runLength,
      CORRIDOR_HALF_WIDTH,
      this.interactions.points
        .filter((pt) => pt.kind === 'tree')
        .map((pt) => ({ s: pt.s + 7, t: -pt.t })), // dustbins offset from trees deterministically
    );

    // Sand Watch: ring buffer over every sim system + RNG stream states.
    const rngSnapshot: Snapshottable = {
      snapshot: (out, off) => {
        const names = ['crowd', 'pocketmar', 'traffic', 'streetlife', 'director'];
        names.forEach((n, i) => (out[off + i] = this.rng.stream(n).getState()));
      },
      restore: (from, off) => {
        const names = ['crowd', 'pocketmar', 'traffic', 'streetlife', 'director'];
        names.forEach((n, i) => this.rng.stream(n).setState(from[off + i]!));
      },
    };
    // Mission stats + clock must rewind too, or re-walked seconds double-count
    // mission progress and inflate the pace-star time.
    const summarySnapshot: Snapshottable = {
      snapshot: (out, off) => {
        out[off] = this.summary.chaCups;
        out[off + 1] = this.summary.fruits;
        out[off + 2] = this.summary.directCrossings;
        out[off + 3] = this.summary.nearMisses;
        out[off + 4] = this.summary.spotted;
        out[off + 5] = this.summary.distanceM;
        out[off + 6] = this.elapsed;
      },
      restore: (from, off) => {
        this.summary.chaCups = from[off]!;
        this.summary.fruits = from[off + 1]!;
        this.summary.directCrossings = from[off + 2]!;
        this.summary.nearMisses = from[off + 3]!;
        this.summary.spotted = from[off + 4]!;
        this.summary.distanceM = from[off + 5]!;
        this.elapsed = from[off + 6]!;
      },
    };
    const buffer = new RewindBuffer([
      { sys: summarySnapshot, floats: 7 },
      { sys: this.player, floats: Player.SNAP_FLOATS },
      { sys: this.crowd, floats: CrowdSystem.SNAP_FLOATS },
      { sys: this.pickpockets, floats: PickpocketSystem.SNAP_FLOATS },
      { sys: this.traffic, floats: TrafficSystem.SNAP_FLOATS },
      { sys: this.streetLife, floats: this.streetLife.snapFloats() },
      { sys: this.interactions, floats: this.interactions.snapFloats() },
      { sys: this.director, floats: Director.SNAP_FLOATS },
      { sys: this.score, floats: RunScore.SNAP_FLOATS },
      { sys: rngSnapshot, floats: 5 },
    ]);
    this.sandWatch = new SandWatch(buffer);
    const save = this.ctx.save.get();
    this.sandWatch.owned =
      save.ownedItems.includes('sandWatch') ||
      (p.items?.includes('sandWatch') ?? false) ||
      new URLSearchParams(location.search).has('sandwatch');
    this.sandWatch.enabled = !p.daily;
    // Glasses are a 3-run consumable: burn one charge at run start.
    if (save.glassesCharges > 0) {
      this.pickpockets.glassesActive = true;
      this.ctx.save.update((d) => d.glassesCharges--);
    }
    if (save.ownedItems.includes('shoes')) this.player.staminaEfficiency = 0.8;
    if (save.ownedItems.includes('headphones')) this.score.meterGainMul = 1.25;
    this.player.staminaEfficiency *= this.atmosphere.staminaDrainMul; // noon heat
    this.player.speedMul = this.atmosphere.playerSpeedMul; // rain w/o umbrella

    this.buildScene();
    this.crowd.prewarm(this.player.s);
    this.crowdRenderer = new CrowdRenderer(this.scene, this.crowd, this.corridor);
    this.avatar = new PlayerAvatar(
      this.scene,
      OUTFIT_COLORS[save.equippedOutfit] ?? OUTFIT_COLORS.default,
    );
    this.setupGhost(p);
    this.pmRenderer = new PickpocketRenderer(this.scene, this.pickpockets, this.corridor);
    this.trafficRenderer = new TrafficRenderer(this.scene, this.traffic, this.corridor);
    this.lifeRenderer = new StreetLifeRenderer(this.scene, this.streetLife, this.corridor);
    this.hud = new Hud(this.ctx.input);
    this.phoneOverlay = new PhoneOverlay();
    this.rewindFx = new RewindFx(this.ctx.renderer.domElement);

    // Mission/summary counters.
    this.bus.on('restStarted', (e) => {
      if (e.kind === 'chaDokan') this.summary.chaCups++;
      this.ctx.audio.sip();
    });
    this.bus.on('fruitGrabbed', () => this.summary.fruits++);
    this.bus.on('crossingResolved', (e) => {
      if (e.method === 'direct') this.summary.directCrossings++;
    });
    this.bus.on('nearMiss', () => this.summary.nearMisses++);
    this.bus.on('theftSpotted', () => this.summary.spotted++);

    this.bus.on('bump', () => this.hud.toast(t('bumped'), 0));
    this.bus.on('cakewalkMeterFull', () => this.hud.toast(t('cakewalk'), 0));
    this.bus.on('theft', (e) => {
      this.hud.toast(tf('theft', e.amount), 0);
      if (this.params.tutorial && !this.tutorialTheftDone) {
        this.tutorialTheftDone = true;
        setTimeout(() => this.hud.toast(t('tutTheft'), 0), 1600);
      }
    });
    this.bus.on('theftSpotted', () => this.hud.toast(t('spotted'), 0));
    this.bus.on('stareMisread', () => this.hud.toast(t('misread'), 0));
    this.bus.on('fruitGrabbed', () => this.hud.toast(t('fruit'), 0));
    this.bus.on('catStumble', () => this.hud.toast(t('cat'), 0));
    this.bus.on('dogBark', () => this.hud.toast(t('bark'), 0));
    this.bus.on('cowStampede', () => this.hud.toast(t('stampede'), 0));
    this.bus.on('stampedeSurvived', (e) => {
      this.score.add(e.bonus, 'stampede');
      this.hud.toast(tf('stampedeSurvived', e.bonus), 0);
    });
    this.bus.on('vehicleHit', (e) => this.hud.toast(tf('vehicleHit', e.vehicleKind), 0));
    this.bus.on('crossingResolved', (e) =>
      this.hud.toast(e.method === 'direct' ? tf('crossed', e.bonus) : t('overbridge'), 0),
    );
    this.bus.on('microEvent', (e) =>
      this.hud.toast(
        e.kind === 'hawkerPitch' ? t('hawker') : e.kind === 'directionsAsk' ? t('directions') : t('teaOffer'),
        0,
      ),
    );
    this.ctx.audio.startRun(this.bus, this.atmosphere.weather === 'rain');
    this.bus.on('phoneCheckStarted', () => {
      if (this.params.area && this.params.route) {
        this.corridor.toWorld(this.player.s, this.player.t, this.pose);
        this.phoneOverlay.show(this.params.area, this.params.route.pts, this.pose.x, this.pose.z);
      }
    });
    this.bus.on('phoneCheckEnded', () => this.phoneOverlay.hide());

    this.ctx.testApi.run = {
      player: this.player,
      crowd: this.crowd,
      score: this.score,
      bus: this.bus,
      pickpockets: this.pickpockets,
      traffic: this.traffic,
      streetLife: this.streetLife,
      interactions: this.interactions,
      sandWatch: this.sandWatch,
    };
  }

  /** Crossing zones from route nodes flagged majorCrossing. */
  private buildCrossingZones(): CrossingZone[] {
    const zones: CrossingZone[] = [];
    const { area, route } = this.params;
    if (area && route && this.corridor instanceof SplineCorridor) {
      for (const ni of route.nodePath.slice(1, -1)) {
        const node = area.graph.nodes[ni]!;
        if (!node.majorCrossing) continue;
        const s = this.corridor.closestS(node.pos[0], node.pos[1]);
        if (s < 25 || s > this.runLength - 15) continue;
        // Difficulty from the route's overall traffic level.
        zones.push({ s, difficulty: route.traffic, halfWidth: 4.5, crossed: false });
      }
    } else {
      // Graybox: two practice crossings.
      zones.push({ s: 180, difficulty: 2, halfWidth: 4.5, crossed: false });
      zones.push({ s: 360, difficulty: 4, halfWidth: 4.5, crossed: false });
    }
    // Merge zones closer than 25 m so waves don't stack unfairly.
    zones.sort((a, b) => a.s - b.s);
    return zones.filter((z, i) => i === 0 || z.s - zones[i - 1]!.s > 25);
  }

  /** Cha dokans, bus stops & fruit trees near the walking line. */
  private buildRoutePoints(): RoutePoint[] {
    const points: RoutePoint[] = [];
    const { area, route } = this.params;
    if (area && route && this.corridor instanceof SplineCorridor) {
      const corridor = this.corridor;
      const pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      for (const poi of area.pois) {
        if (poi.kind !== 'chaDokan' && poi.kind !== 'busStop' && poi.kind !== 'tree') continue;
        const s = corridor.closestS(poi.pos[0], poi.pos[1]);
        if (s < 10 || s > this.runLength - 5) continue;
        corridor.toWorld(s, 0, pose);
        const dx = poi.pos[0] - pose.x;
        const dz = poi.pos[1] - pose.z;
        if (dx * dx + dz * dz > 8 * 8) continue;
        // Lateral offset = projection on the path normal.
        const t = dx * -pose.dirZ + dz * pose.dirX;
        points.push({ kind: poi.kind, s, t, fruit: poi.kind === 'tree' });
      }
    } else if (!area) {
      // Graybox: regular practice props.
      const rng = this.rng.stream('graybox-props');
      for (let s = 60; s < this.runLength - 40; s += 90) {
        const kind = rng.pick(['chaDokan', 'busStop', 'tree'] as const);
        points.push({ kind, s, t: rng.chance(0.5) ? 2.4 : -2.4, fruit: kind === 'tree' });
      }
    }
    return points.sort((a, b) => a.s - b.s);
  }

  exit(): void {
    this.ctx.loopTimeScale(1);
    this.ctx.audio.stopRun();
    this.reviveOverlay?.remove();
    this.reviveOverlay = null;
    if (this.ghostMesh) {
      this.ghostMesh.geometry.dispose();
      (this.ghostMesh.material as MeshLambertMaterial).dispose();
      this.ghostMesh = null;
    }
    this.hud.dispose();
    this.phoneOverlay.dispose();
    this.rewindFx.dispose();
    this.avatar.dispose(this.scene);
    this.crowdRenderer.dispose(this.scene);
    this.pmRenderer.dispose(this.scene);
    this.trafficRenderer.dispose(this.scene);
    this.lifeRenderer.dispose(this.scene);
    this.level?.dispose(this.scene);
    this.level = null;
    this.atmosphereHandle.dispose();
    // Graybox planes / finish gate / anything buildScene created directly.
    for (const r of this.ownedResources) {
      r.geometry?.dispose();
      r.material?.dispose();
    }
    this.ownedResources = [];
    this.scene.clear();
    delete this.ctx.testApi.run;
  }

  /** Register a mesh whose geometry/material this state must dispose. */
  private own<T extends Mesh>(mesh: T): T {
    this.ownedResources.push({
      geometry: mesh.geometry,
      material: Array.isArray(mesh.material) ? undefined : mesh.material,
    });
    return mesh;
  }

  fixedUpdate(dt: number): void {
    if (this.finished) return;

    // Sand Watch rewind owns the tick while active.
    const rewind = this.sandWatch.fixedUpdate(dt);
    if (rewind === 'tick') {
      this.prevS = this.player.s;
      this.prevT = this.player.t;
      return;
    }
    if (rewind === 'landed') {
      this.prevS = this.player.s;
      this.prevT = this.player.t;
      this.bus.clearQueue();
      this.rewindFx.land();
      this.ctx.loopTimeScale(0.4); // brief slow-mo to correct the mistake
      return;
    }
    if (rewind === 'done') {
      this.ctx.loopTimeScale(1);
      this.rewindFx.stop();
      this.bus.emit('rewindFinished', {});
    }

    const input = this.ctx.input.poll(dt);
    if (input.sandWatch && this.sandWatch.activate()) {
      this.bus.emit('rewindStarted', {});
      this.bus.flush();
      this.rewindFx.start();
      return;
    }

    // Edge-triggered context actions before movement.
    if (input.jump && !this.player.jumping && !this.player.resting && !this.player.phoneLocked) {
      this.ctx.audio.jump();
    }
    if (input.stare) this.pickpockets.stare(this.player, this.score);
    if (input.sit) this.interactions.toggleSit(this.player);
    if (input.phone) this.interactions.togglePhone(this.player);
    if (input.overbridge) this.traffic.useOverbridge(this.player);

    this.prevS = this.player.s;
    this.prevT = this.player.t;
    this.player.fixedUpdate(dt, input, this.corridor);
    this.crowd.fixedUpdate(dt, this.player);
    this.traffic.fixedUpdate(dt, this.player, this.score);
    this.pickpockets.fixedUpdate(dt, this.player, this.score, this.corridor.halfWidth(this.player.s));
    this.streetLife.fixedUpdate(dt, this.player, this.crowd);
    this.interactions.fixedUpdate(dt, this.player, this.score);
    this.updateTutorial();
    this.director.fixedUpdate(dt, this.player);
    if (this.director.stampedeRequested) {
      this.director.stampedeRequested = false;
      this.streetLife.startStampede(this.player, this.crowd);
    }
    this.score.fixedUpdate(dt);
    this.score.addDistance(Math.max(0, this.player.s - this.prevS));
    this.sandWatch.addDistance(Math.max(0, this.player.s - this.prevS));
    this.summary.distanceM += Math.max(0, this.player.s - this.prevS);
    this.elapsed += dt;
    // Ghost recording at 2 Hz on seeded (daily) routes.
    if (this.params.daily && Math.floor(this.elapsed * 2) > this.ghostFrames.length - 1) {
      this.ghostFrames.push({ s: this.player.s, t: this.player.t });
    }
    this.ctx.debug.agentCount = this.crowd.activeCount;

    this.bus.flush();
    // Capture AFTER the flush: event handlers (combo, director suppression)
    // mutate sim state, and the snapshot must include those effects.
    this.sandWatch.buffer.capture();

    if (this.player.s >= this.runLength) this.finish(true);
    else if (this.player.health <= 0) {
      if (!this.reviveUsed && !this.params.daily) this.offerRevive();
      else this.finish(false);
    }
  }

  /** Scripted FTUE beats (idea.md §9): teach by distance, one staged theft. */
  private updateTutorial(): void {
    if (!this.params.tutorial) return;
    const step = TUTORIAL_STEPS[this.tutorialStep];
    if (step && this.player.s >= step.at) {
      this.tutorialStep++;
      this.hud.toast(t(step.key), 0);
    }
    // The staged first theft: small, survivable, immediately explained.
    // Staged ONCE — re-staging every tick would pin the thief out of strike
    // range forever and the lesson would never fire.
    if (
      !this.tutorialTheftStaged &&
      !this.tutorialTheftDone &&
      this.player.s >= TUTORIAL_THEFT_AT &&
      this.score.taka > 20
    ) {
      this.tutorialTheftStaged = true;
      this.pickpockets.state[0] = PmState.Striking;
      this.pickpockets.s[0] = this.player.s + 2;
      this.pickpockets.t[0] = this.player.t;
      this.pickpockets.innocent[0] = 0;
      this.pickpockets.suspicion[0] = 1;
    }
    if (this.player.s >= this.runLength - 15 && this.tutorialStep === TUTORIAL_STEPS.length) {
      this.tutorialStep++;
      this.hud.toast(t('tutDone'), 0);
    }
  }

  /** One rewarded-ad revive per run (not on the daily — leaderboard fairness). */
  private offerRevive(): void {
    this.reviveUsed = true;
    this.ctx.loopTimeScale(0);
    this.reviveOverlay = document.createElement('div');
    this.reviveOverlay.style.cssText =
      'position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;background:rgba(20,14,6,.85);color:#fff;font-family:system-ui;gap:12px';
    this.reviveOverlay.innerHTML = `
      <div style="font-size:30px;font-weight:900">😵 Knocked out!</div>
      <button id="cw-revive" style="font-size:18px;padding:12px 32px;border-radius:12px;border:none;
        background:#e8a33d;color:#1a1208;font-weight:800">📺 Second wind (watch ad)</button>
      <button id="cw-giveup" style="font-size:14px;padding:8px 20px;border-radius:10px;border:none;
        background:rgba(255,255,255,.15);color:#fff">Give up</button>`;
    document.body.appendChild(this.reviveOverlay);
    this.reviveOverlay.querySelector('#cw-revive')!.addEventListener('click', () => {
      this.reviveOverlay?.remove();
      this.reviveOverlay = null;
      void this.ctx.services.ads.showRewarded('revive').then((ok) => {
        if (ok) {
          this.player.health = 60;
          this.player.bumpCooldown = 2;
          this.ctx.loopTimeScale(1);
        } else {
          this.finishNow(false);
        }
      });
    });
    this.reviveOverlay.querySelector('#cw-giveup')!.addEventListener('click', () => {
      this.reviveOverlay?.remove();
      this.reviveOverlay = null;
      this.finishNow(false);
    });
  }

  private finishNow(success: boolean): void {
    this.ctx.loopTimeScale(1);
    this.finish(success);
  }

  render(alpha: number, frameDt: number): void {
    // Interpolate player between previous and current sim positions.
    const s = this.prevS + (this.player.s - this.prevS) * alpha;
    const t = this.prevT + (this.player.t - this.prevT) * alpha;
    this.corridor.toWorld(s, t, this.pose);
    this.avatar.update(this.player, s, t, this.corridor);

    // Chase cam: behind and above along the path direction, looking ahead.
    const cam = this.ctx.camera;
    const back = 5.2;
    cam.position.set(
      this.pose.x - this.pose.dirX * back - t * 0.4,
      3.0 + this.player.y * 0.3,
      this.pose.z - this.pose.dirZ * back,
    );
    cam.lookAt(this.pose.x + this.pose.dirX * 6, 1.1, this.pose.z + this.pose.dirZ * 6);

    this.crowdRenderer.render();
    this.pmRenderer.render();
    this.trafficRenderer.render();
    this.lifeRenderer.render();
    this.renderGhost();
    this.hud.set(
      (this.player.health / HEALTH_MAX) * 100,
      this.player.stamina,
      this.score.meterActive > 0 ? 1 : this.score.meter,
      this.score.taka,
      this.score.combo,
    );
    this.hud.setContext(
      this.interactions.nearRest !== null,
      this.player.resting,
      this.traffic.inZone !== null && this.traffic.overbridgeTimer <= 0,
    );
    this.hud.setSandWatch(this.sandWatch.owned, this.sandWatch.charge, this.sandWatch.canActivate);
    this.rewindFx.frame(frameDt);
    this.atmosphereHandle.frame(frameDt);
    if (this.player.phoneLocked && this.params.area && this.params.route) {
      this.phoneOverlay.updatePosition(this.params.area, this.params.route.pts, this.pose.x, this.pose.z);
    }
    this.hud.update(frameDt);
    this.ctx.renderer.render(this.scene, this.ctx.camera);
  }

  private finish(success: boolean): void {
    this.finished = true;
    this.bus.emit('runFinished', { success });
    this.bus.flush();
    if (this.params.tutorial && success) {
      this.ctx.save.update((d) => (d.ftueDone = true));
      void this.ctx.save.flush();
    }
    // Persist the daily ghost if this run beat the stored one.
    if (this.params.daily && success) {
      const board = `daily-${localDateKey()}`;
      this.ctx.save.update((d) => {
        const prev = d.dailyResults[localDateKey()];
        if (!prev || this.score.taka > prev.taka) d.ghosts[board] = packGhost(this.ghostFrames);
      });
    }
    this.ctx.machine.transition('results', {
      success,
      taka: this.score.taka,
      bestCombo: this.score.bestCombo,
      nearMisses: this.score.nearMisses,
      distance: Math.round(this.player.s),
      timeS: this.elapsed,
      healthFraction: this.player.health / HEALTH_MAX,
      stolenTotal: this.score.stolenTotal,
      summary: this.summary,
      runParams: this.params,
    });
  }

  /** Daily routes race the translucent ghost of your stored best. */
  private setupGhost(p: RunParams): void {
    this.ghostMesh = null;
    this.ghostBest = [];
    if (!p.daily) return;
    const packed = this.ctx.save.get().ghosts[`daily-${localDateKey()}`];
    if (!packed || packed.length < 4) return;
    this.ghostBest = unpackGhost(packed);
    const mat = new MeshLambertMaterial({
      flatShading: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
    });
    this.ghostMesh = new Mesh(buildPersonGeometry(), mat);
    this.scene.add(this.ghostMesh);
  }

  private renderGhost(): void {
    if (!this.ghostMesh || this.ghostBest.length === 0) return;
    const idx = Math.min(this.elapsed * 2, this.ghostBest.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, this.ghostBest.length - 1);
    const f = idx - i0;
    const a = this.ghostBest[i0]!;
    const b = this.ghostBest[i1]!;
    const pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
    this.corridor.toWorld(a.s + (b.s - a.s) * f, a.t + (b.t - a.t) * f, pose);
    this.ghostMesh.position.set(pose.x, 0, pose.z);
    this.ghostMesh.rotation.y = Math.atan2(pose.dirX, pose.dirZ);
  }

  private buildScene(): void {
    this.scene = new Scene();
    this.scene.background = new Color('#c9b18a'); // dusty Dhaka haze
    this.scene.fog = new Fog('#c9b18a', 30, 130);
    this.scene.add(new HemisphereLight(0xfff3da, 0x5a4a35, 1.05));
    const sun = new DirectionalLight(0xffe7c0, 1.1);
    sun.position.set(-30, 60, -20);
    this.scene.add(sun);
    // Time-of-day & weather overrides + rain updater.
    this.atmosphereHandle = dressScene(this.scene, this.atmosphere, () => ({
      x: this.pose.x,
      z: this.pose.z,
    }));

    if (this.params.area && this.params.route) {
      // Real Dhaka: build the world from baked OSM data along the route.
      this.level = new LevelRenderer(this.scene, this.params.area, this.params.route.pts);
      const end: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      this.corridor.toWorld(this.runLength, 0, end);
      const gate = this.own(
        new Mesh(
          new BoxGeometry(6, 4, 0.5),
          new MeshLambertMaterial({ color: '#3fa34d', flatShading: true }),
        ),
      );
      gate.position.set(end.x, 2, end.z);
      gate.rotation.y = Math.atan2(end.dirX, end.dirZ);
      this.scene.add(gate);
      return;
    }

    // Graybox fallback (tests, control spikes).
    // Footpath ribbon.
    const path = this.own(
      new Mesh(
        new PlaneGeometry(CORRIDOR_HALF_WIDTH * 2, RUN_LENGTH + 120),
        new MeshLambertMaterial({ color: '#9b9484' }),
      ),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0, -(RUN_LENGTH + 120) / 2 + 30);
    this.scene.add(path);

    // Road strip beside the footpath (visual context).
    const road = this.own(
      new Mesh(
        new PlaneGeometry(8, RUN_LENGTH + 120),
        new MeshLambertMaterial({ color: '#55524c' }),
      ),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(CORRIDOR_HALF_WIDTH + 4.2, -0.02, -(RUN_LENGTH + 120) / 2 + 30);
    this.scene.add(road);

    // Graybox "buildings" wall on the left, motion-reference pillars.
    const buildingMat = new MeshLambertMaterial({ color: '#8a7f6f', flatShading: true });
    const buildingGeo = new BoxGeometry(4, 1, 10);
    this.ownedResources.push({ geometry: buildingGeo, material: buildingMat });
    const rng = this.rng.stream('scenery');
    for (let z = 0; z < RUN_LENGTH + 60; z += 11) {
      const h = rng.range(5, 16);
      const b = new Mesh(buildingGeo, buildingMat);
      b.scale.y = h;
      b.position.set(-CORRIDOR_HALF_WIDTH - 2.5, h / 2, -z);
      this.scene.add(b);
    }

    // Finish gate.
    const gate = this.own(
      new Mesh(
        new BoxGeometry(CORRIDOR_HALF_WIDTH * 2 + 1, 4, 0.5),
        new MeshLambertMaterial({ color: '#3fa34d', flatShading: true }),
      ),
    );
    gate.position.set(0, 2, -RUN_LENGTH);
    this.scene.add(gate);
  }
}
