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
import { LevelRenderer, type IntersectionMark } from '@/world/LevelRenderer';
import { CrossTrafficRenderer } from '@/gfx/CrossTraffic';
import type { BakedArea } from '@/world/levelTypes';
import type { RouteOption } from '@/routing/RouteGraph';
import type { GameState } from '@/core/StateMachine';
import type { GameContext } from '@/core/GameContext';
import { EventBus } from '@/core/EventBus';
import { Rng } from '@/core/Rng';
import { StraightCorridor, type Corridor, type PathPose } from '@/world/Corridor';
import { Player, HEALTH_MAX } from '@/player/Player';
import { CrowdSystem } from '@/crowd/CrowdSystem';
import { CrowdActors } from '@/gfx/CrowdActors';
import { RunScore } from '@/economy/RunScore';
import { Hud } from '@/ui/Hud';
import { PickpocketSystem } from '@/pickpocket/PickpocketSystem';
import { TrafficSystem, type CrossingZone } from '@/traffic/TrafficSystem';
import { StreetLife } from '@/world/StreetLife';
import { Director } from '@/director/Director';
import { Interactions, type RoutePoint } from '@/world/Interactions';
import { StreetLifeRenderer, TrafficRenderer } from '@/gfx/entityRenderers';
import { PickpocketRenderer } from '@/gfx/PickpocketActors';
import { PhoneOverlay } from '@/ui/PhoneOverlay';
import { RewindBuffer, SandWatch, type Snapshottable } from '@/items/SandWatch';
import { RewindFx } from '@/gfx/RewindFx';
import { JuiceFx } from '@/gfx/JuiceFx';
import { StreetEvents } from '@/world/StreetEvents';
import { EventFx } from '@/gfx/EventFx';
import { RestMarker } from '@/gfx/RestMarker';
import { CrossingMinigame } from '@/ui/CrossingMinigame';
import { bendObject, makeBendUniforms, type BendUniforms } from '@/gfx/worldBend';
import { straightenArea, straightRoute } from '@/world/straighten';
import { Navigator, type DecisionPoint } from '@/world/Navigator';
import { RouteGraph } from '@/routing/RouteGraph';
import { TurnMinigame } from '@/ui/TurnMinigame';
import {
  OUTFIT_COLORS,
  CHARACTER_MODELS,
  localDateKey,
  packGhost,
  unpackGhost,
  type RunSummary,
} from '@/meta/progression';
import { buildPersonGeometry } from '@/gfx/meshFactory';
import { dressScene, rollAtmosphere, type AtmosphereHandle, type AtmosphereMods } from '@/world/Atmosphere';
import { t, tf } from '@/i18n';
import { PmState, SEATED_TELL_TIME } from '@/pickpocket/PickpocketSystem';
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
  /** Set when this run continues a journey after a turn-minigame deviation:
   *  carries the player's vitals/score forward and skips one-time setup. */
  carryOver?: RunCarryOver;
}

export interface RunCarryOver {
  health: number;
  stamina: number;
  taka: number;
  combo: number;
  bestCombo: number;
  nearMisses: number;
  stolenTotal: number;
  summary: RunSummary;
  elapsed: number;
  glassesActive: boolean;
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
  /** Real curved route, used only to project world POIs/buildings → along-route
   *  distance s. The run itself plays on a StraightCorridor. */
  private projector: SplineCorridor | null = null;
  private player!: Player;
  private crowd!: CrowdSystem;
  private crowdActors!: CrowdActors;
  private score!: RunScore;
  private hud!: Hud;
  private avatar!: PlayerAvatar;
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private finished = false;
  private prevS = 0;
  private prevT = 0;
  private level: LevelRenderer | null = null;
  private crossTraffic: CrossTrafficRenderer | null = null;
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
  private juice!: JuiceFx;
  private streetEvents!: StreetEvents;
  private eventFx!: EventFx;
  /** Scene lights captured so street events can dim/restore them. */
  private baseHemi = 1;
  private baseSun = 1;
  private hemiLight: HemisphereLight | null = null;
  private sunLight: DirectionalLight | null = null;
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
  private camInit = false;
  private camLook = { x: 0, z: 0 };
  private restMarker!: RestMarker;
  private crossingGame = new CrossingMinigame();
  private turnGame = new TurnMinigame();
  private navigator: Navigator | null = null;
  private nextDecision = 0;
  private bendUniforms: BendUniforms = makeBendUniforms();

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const p = (params as RunParams | undefined) ?? { seed: 1 };
    this.params = p;
    this.finished = false;
    this.prevS = 0;
    this.prevT = 0;
    this.elapsed = 0;
    this.reviveUsed = false;
    this.summary = { chaCups: 0, fruits: 0, directCrossings: 0, nearMisses: 0, spotted: 0, distanceM: 0 };
    this.ghostFrames = [];
    this.camInit = false;
    this.bus = new EventBus();
    this.rng = new Rng(p.seed);
    if (p.route) {
      // Always-straight corridor: project the real route for s, but walk straight.
      this.projector = new SplineCorridor(p.route.pts);
      this.runLength = Math.max(50, this.projector.length - 5);
      this.corridor = new StraightCorridor(this.projector.length + 60, CORRIDOR_HALF_WIDTH);
    } else {
      this.projector = null;
      this.corridor = new StraightCorridor(RUN_LENGTH + 60, CORRIDOR_HALF_WIDTH);
      this.runLength = RUN_LENGTH;
    }
    // Turn-by-turn navigation: real junctions become quick-tap "which way?"
    // popups. Off on the daily (leaderboard fairness) and the tutorial.
    this.navigator = null;
    this.nextDecision = 0;
    if (p.area && p.route && this.projector && !p.daily && !p.tutorial) {
      const graph = new RouteGraph(p.area);
      this.navigator = new Navigator(p.area, graph, p.route, this.projector, this.runLength);
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
      // Route-length trade-off: short routes are denser gauntlets; long
      // routes run lighter overall but alternate crowded/easy sections.
      const lengthFactor = Math.max(0.85, Math.min(1.3, 1.35 - p.route.lengthM / 1800));
      this.crowd.config.density = Math.min(
        180,
        Math.round(
          (30 + p.route.crowd * 22) * this.atmosphere.crowdDensityMul * newcomer * lengthFactor,
        ),
      );
      this.crowd.config.profile = this.buildDensityProfile(p);
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
    // Random mid-run street events (off on tutorial; daily keeps it for variety).
    this.streetEvents = new StreetEvents(this.rng.stream('events'), this.bus, !p.tutorial);
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
        const names = ['crowd', 'pocketmar', 'traffic', 'streetlife', 'director', 'events'];
        names.forEach((n, i) => (out[off + i] = this.rng.stream(n).getState()));
      },
      restore: (from, off) => {
        const names = ['crowd', 'pocketmar', 'traffic', 'streetlife', 'director', 'events'];
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
      { sys: this.streetEvents, floats: StreetEvents.SNAP_FLOATS },
      { sys: rngSnapshot, floats: 6 },
    ]);
    this.sandWatch = new SandWatch(buffer);
    const save = this.ctx.save.get();
    this.sandWatch.owned =
      save.ownedItems.includes('sandWatch') ||
      (p.items?.includes('sandWatch') ?? false) ||
      new URLSearchParams(location.search).has('sandwatch');
    // Rewind is off while navigating a re-plannable journey (the buffer is
    // sized per segment) and on the daily.
    this.sandWatch.enabled = !p.daily && !p.carryOver && !this.navigator;
    // Glasses are a 3-run consumable: burn one charge at run start — but NOT on
    // a turn-deviation continuation (the charge was already spent).
    if (p.carryOver) {
      this.pickpockets.glassesActive = p.carryOver.glassesActive;
    } else if (save.glassesCharges > 0) {
      this.pickpockets.glassesActive = true;
      this.ctx.save.update((d) => d.glassesCharges--);
    }
    if (save.ownedItems.includes('shoes')) this.player.staminaEfficiency = 0.8;
    if (save.ownedItems.includes('headphones')) this.score.meterGainMul = 1.25;
    this.player.staminaEfficiency *= this.atmosphere.staminaDrainMul; // noon heat
    this.player.speedMul = this.atmosphere.playerSpeedMul; // rain w/o umbrella

    this.buildScene();
    this.crowd.prewarm(this.player.s);
    this.crowdActors = new CrowdActors(this.scene, this.crowd, this.corridor, 26, this.bendUniforms);
    this.avatar = new PlayerAvatar(
      this.scene,
      OUTFIT_COLORS[save.equippedOutfit] ?? OUTFIT_COLORS.default,
      this.bendUniforms,
      CHARACTER_MODELS[save.equippedCharacter] ?? CHARACTER_MODELS.char_man,
    );
    this.setupGhost(p);
    this.pmRenderer = new PickpocketRenderer(this.scene, this.pickpockets, this.corridor, this.bendUniforms);
    this.trafficRenderer = new TrafficRenderer(this.scene, this.traffic, this.corridor, this.bendUniforms);
    this.lifeRenderer = new StreetLifeRenderer(this.scene, this.streetLife, this.corridor, this.bendUniforms);
    this.restMarker = new RestMarker(this.scene);
    this.hud = new Hud(this.ctx.input);
    this.phoneOverlay = new PhoneOverlay();
    this.rewindFx = new RewindFx(this.ctx.renderer.domElement);
    this.juice = new JuiceFx(this.ctx.renderer.domElement, this.bus, this.ctx.loopTimeScale);
    this.eventFx = new EventFx(this.ctx.renderer.domElement, this.streetEvents);

    // Curved-world bend: straight under the player, road falls away in the
    // distance. Patches every mesh material now that the scene is fully built.
    bendObject(this.scene, this.bendUniforms);

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
    this.bus.on('streetEvent', (e) => {
      if (e.phase === 'warn' && e.toast) this.hud.toast(e.toast, 0);
    });
    this.bus.on('theft', (e) => {
      this.hud.toast(tf('theft', e.amount), 0);
      if (this.params.tutorial && !this.tutorialTheftDone) {
        this.tutorialTheftDone = true;
        setTimeout(() => this.hud.toast(t('tutTheft'), 0), 1600);
      }
    });
    this.bus.on('theftSpotted', () => this.hud.toast(t('spotted'), 0));
    this.bus.on('seatedTellStarted', () => this.ctx.audio.alert());
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
      if (this.params.area && this.params.route && this.projector) {
        const rp: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
        this.projector.toWorld(this.player.s, this.player.t, rp);
        this.phoneOverlay.show(this.params.area, this.params.route.pts, rp.x, rp.z);
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
      navigator: this.navigator,
    };

    if (p.carryOver) this.applyCarryOver(p.carryOver);
  }

  /** Carry vitals/score forward when a turn deviation re-enters the run. */
  private applyCarryOver(c: RunCarryOver): void {
    this.player.health = c.health;
    this.player.stamina = c.stamina;
    this.score.taka = c.taka;
    this.score.combo = c.combo;
    this.score.bestCombo = c.bestCombo;
    this.score.nearMisses = c.nearMisses;
    this.score.stolenTotal = c.stolenTotal;
    this.summary = c.summary;
    this.elapsed = c.elapsed;
  }

  /** Snapshot the live vitals/score for a turn-deviation continuation. */
  private gatherCarryOver(): RunCarryOver {
    return {
      health: this.player.health,
      stamina: this.player.stamina,
      taka: this.score.taka,
      combo: this.score.combo,
      bestCombo: this.score.bestCombo,
      nearMisses: this.score.nearMisses,
      stolenTotal: this.score.stolenTotal,
      summary: this.summary,
      elapsed: this.elapsed,
      glassesActive: this.pickpockets.glassesActive,
    };
  }

  /**
   * Per-section density from the route's real edge stats: walking through a
   * bazaar edge (crowd 5) is packed, a residential edge (crowd 1) breathes.
   * Normalized around the route average so the base density stays honest.
   */
  private buildDensityProfile(p: RunParams): ((s: number) => number) | null {
    const { area, route } = p;
    if (!area || !route || route.edgePath.length < 2) return null;
    const segs: { end: number; crowd: number }[] = [];
    let acc = 0;
    let sum = 0;
    for (const ei of route.edgePath) {
      const e = area.graph.edges[ei]!;
      acc += e.stats.lengthM;
      segs.push({ end: acc, crowd: e.stats.crowd });
      sum += e.stats.crowd * e.stats.lengthM;
    }
    const avg = sum / acc || 1;
    return (s: number) => {
      let crowd = segs[segs.length - 1]!.crowd;
      for (const seg of segs) {
        if (s <= seg.end) {
          crowd = seg.crowd;
          break;
        }
      }
      // 1..5 around the route average → roughly 0.6×..1.5×.
      return Math.max(0.55, Math.min(1.55, 0.55 + (crowd / avg) * 0.45));
    };
  }

  /** Pop the "which way?" minigame when the player reaches the next junction. */
  private maybeOpenTurn(): void {
    if (!this.navigator || this.turnGame.active || this.crossingGame.active) return;
    const dps = this.navigator.decisionPoints;
    while (
      this.nextDecision < dps.length &&
      (dps[this.nextDecision]!.consumed || dps[this.nextDecision]!.s < this.player.s - 6)
    ) {
      this.nextDecision++;
    }
    const dp = dps[this.nextDecision];
    if (!dp || this.player.s < dp.s - 6) return;
    dp.consumed = true;
    // Estimate the remaining distance to the destination via each branch, so
    // the player can weigh the options (the marked road isn't always shortest).
    for (const b of dp.branches) {
      if (b.distM === undefined) b.distM = this.navigator.replan(dp, b)?.lengthM;
    }
    const accent = OUTFIT_COLORS[this.ctx.save.get().equippedOutfit] ?? OUTFIT_COLORS.default!;
    void this.turnGame.open(dp.branches, accent).then((res) => this.resolveTurn(dp, res));
  }

  private resolveTurn(dp: DecisionPoint, res: import('@/ui/TurnMinigame').TurnResult): void {
    const { branch } = res;
    if (branch.marked) {
      // Stayed on the planned route.
      if (res.onTime) {
        this.score.add(8, 'turn');
        this.hud.toast(t('onRoute'), 0);
      }
      this.prevS = this.player.s;
      this.prevT = this.player.t;
      return;
    }
    // Deviation: re-plan to the destination and re-enter the run on the new
    // road, carrying vitals/score forward.
    const newRoute = this.navigator?.replan(dp, branch) ?? null;
    if (!newRoute) {
      this.prevS = this.player.s;
      this.prevT = this.player.t;
      return;
    }
    const next: RunParams = {
      seed: this.params.seed,
      ...(this.params.area ? { area: this.params.area } : {}),
      route: newRoute,
      ...(this.params.items ? { items: this.params.items } : {}),
      carryOver: this.gatherCarryOver(),
    };
    this.hud.toast(t('newRoute'), 0);
    this.ctx.machine.transition('run', next);
  }

  /** World-space marks for every intersection the player meets — the crossing
   *  zones (road crossings) and the navigator's junctions (route changes) —
   *  so the level can break the walkway, lay a cross-road and stand a sign,
   *  and the cross-traffic can drive through. Merged when very close. */
  private gatherIntersections(): IntersectionMark[] {
    const out: IntersectionMark[] = [];
    const pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
    const add = (s: number, kind: 'crossing' | 'turn'): void => {
      if (s < 16 || s > this.runLength - 10) return;
      this.corridor.toWorld(s, 0, pose);
      out.push({ s, kind, x: pose.x, z: pose.z, dirX: pose.dirX, dirZ: pose.dirZ });
    };
    for (const z of this.traffic.zones) add(z.s, 'crossing');
    for (const dp of this.navigator?.decisionPoints ?? []) add(dp.s, 'turn');
    out.sort((a, b) => a.s - b.s);
    // Merge marks closer than 12 m to the last KEPT one (a junction that's also
    // a crossing = one chourasta), so dense clusters don't all collapse.
    const merged: IntersectionMark[] = [];
    for (const m of out) {
      if (!merged.length || m.s - merged[merged.length - 1]!.s > 12) merged.push(m);
    }
    return merged;
  }

  /** Crossing zones: every route intersection plus gap-fillers so the player
   *  meets way more crossings (idea.md Rev 8). */
  private buildCrossingZones(): CrossingZone[] {
    const zones: CrossingZone[] = [];
    const { area, route } = this.params;
    if (area && route && this.projector) {
      for (const ni of route.nodePath.slice(1, -1)) {
        const node = area.graph.nodes[ni]!;
        const s = this.projector.closestS(node.pos[0], node.pos[1]);
        if (s < 25 || s > this.runLength - 15) continue;
        // Major intersections are harder; minor ones are quick dashes.
        const difficulty = node.majorCrossing ? route.traffic : Math.max(2, route.traffic - 1);
        zones.push({ s, difficulty, halfWidth: 4.5, crossed: false });
      }
    } else {
      zones.push({ s: 120, difficulty: 2, halfWidth: 4.5, crossed: false });
      zones.push({ s: 280, difficulty: 3, halfWidth: 4.5, crossed: false });
      zones.push({ s: 420, difficulty: 4, halfWidth: 4.5, crossed: false });
    }
    // Fill long gaps so a crossing shows up roughly every ~140 m.
    const GAP = 140;
    const rng = this.rng.stream('crossing-fill');
    zones.sort((a, b) => a.s - b.s);
    const marks = [10, ...zones.map((z) => z.s), this.runLength - 12];
    for (let i = 1; i < marks.length; i++) {
      let at = marks[i - 1]!;
      while (marks[i]! - at > GAP) {
        at += GAP * (0.7 + rng.range(0, 0.25));
        if (at > this.runLength - 20) break;
        const difficulty = Math.max(2, Math.min(5, Math.round((route?.traffic ?? 3) + rng.range(-1, 1))));
        zones.push({ s: at, difficulty, halfWidth: 4.5, crossed: false });
      }
    }
    // Merge zones closer than 22 m so waves don't stack unfairly.
    zones.sort((a, b) => a.s - b.s);
    return zones.filter((z, i) => i === 0 || z.s - zones[i - 1]!.s > 22);
  }

  /** Reachable lateral bands for rest spots: right side, and the left edge of
   *  the footpath (kept off the road, which starts near t = -3.4). */
  private static readonly REST_T_MIN = 2.2;
  private static readonly REST_T_MAX = 6.0;
  private static readonly REST_T_LEFT_MIN = 2.0;
  private static readonly REST_T_LEFT_MAX = 3.0;

  /** Cha dokans, bus stops & fruit trees near the walking line. */
  private buildRoutePoints(): RoutePoint[] {
    const points: RoutePoint[] = [];
    const { area, route } = this.params;
    if (area && route && this.projector) {
      const corridor = this.projector;
      const pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      for (const poi of area.pois) {
        if (poi.kind !== 'chaDokan' && poi.kind !== 'busStop' && poi.kind !== 'tree') continue;
        const s = corridor.closestS(poi.pos[0], poi.pos[1]);
        if (s < 10 || s > this.runLength - 5) continue;
        corridor.toWorld(s, 0, pose);
        const dx = poi.pos[0] - pose.x;
        const dz = poi.pos[1] - pose.z;
        const t = dx * -pose.dirZ + dz * pose.dirX;
        if (poi.kind === 'tree') {
          // Trees keep their real position (the fruit-grab must line up with the
          // rendered tree); only the reachable, right-side ones count.
          if (dx * dx + dz * dz > 12 * 12 || t < -2) continue;
          points.push({ kind: 'tree', s, t, fruit: true });
        } else {
          // Rest stalls snap into a reachable band on the POI's real side — the
          // right footpath, or the left edge (off the road) — and are rendered
          // there too, so what you see is what you can sit at.
          if (dx * dx + dz * dz > 22 * 22) continue;
          points.push({ kind: poi.kind, s, t: RunState.snapRestT(t), fruit: false });
        }
      }
      this.fillRestGaps(points);
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

  /** Clamp a stall's lateral offset into the reachable band on its own side. */
  private static snapRestT(t: number): number {
    return t >= 0
      ? Math.max(RunState.REST_T_MIN, Math.min(RunState.REST_T_MAX, t))
      : -Math.max(RunState.REST_T_LEFT_MIN, Math.min(RunState.REST_T_LEFT_MAX, -t));
  }

  /**
   * Guarantees the player always meets seatable rest spots: where the gap
   * between consecutive cha dokans / bus stops exceeds ~170 m, drop a
   * synthesized cha dokan in the middle — alternating sides so seating appears
   * on both the right footpath and the left edge.
   */
  private fillRestGaps(points: RoutePoint[]): void {
    const MAX_GAP = 170;
    const rests = points.filter((p) => p.kind !== 'tree').sort((a, b) => a.s - b.s);
    const marks: number[] = [20, ...rests.map((r) => r.s), this.runLength - 20];
    const rng = this.rng.stream('rest-fill');
    let n = points.length;
    for (let i = 1; i < marks.length; i++) {
      let gap = marks[i]! - marks[i - 1]!;
      let at = marks[i - 1]!;
      while (gap > MAX_GAP) {
        at += MAX_GAP * (0.6 + rng.range(0, 0.3));
        if (at > this.runLength - 25) break;
        const left = n++ % 2 === 1;
        const t = left
          ? -(RunState.REST_T_LEFT_MIN + rng.range(0, 0.8))
          : RunState.REST_T_MIN + rng.range(0, 1.4);
        points.push({ kind: 'chaDokan', s: at, t, fruit: false });
        gap = marks[i]! - at;
      }
    }
  }

  /** World positions + facings for the seatable stalls (fed to LevelRenderer). */
  private buildRestStalls(): import('@/world/LevelRenderer').RestStall[] {
    if (!this.projector) return [];
    const pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
    const stalls: import('@/world/LevelRenderer').RestStall[] = [];
    for (const p of this.interactions.points) {
      if (p.kind === 'tree') continue;
      this.corridor.toWorld(p.s, p.t, pose);
      // Bench faces back toward the walkway centerline from whichever side it
      // sits on. Right normal = (-dirZ, dirX); the bench faces -sign×normal.
      const sign = p.t >= 0 ? 1 : -1;
      const angle = Math.atan2(sign * pose.dirZ, -sign * pose.dirX);
      stalls.push({ kind: p.kind, x: pose.x, z: pose.z, angle });
    }
    return stalls;
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
    this.juice.dispose();
    this.eventFx.dispose();
    this.avatar.dispose(this.scene);
    this.crowdActors.dispose();
    this.pmRenderer.dispose(this.scene);
    this.trafficRenderer.dispose(this.scene);
    this.lifeRenderer.dispose(this.scene);
    this.restMarker.dispose(this.scene);
    this.crossingGame.dispose();
    this.turnGame.dispose();
    this.level?.dispose(this.scene);
    this.level = null;
    this.crossTraffic?.dispose(this.scene);
    this.crossTraffic = null;
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
    // The crossing / turn popups own the screen; street time is frozen.
    if (this.crossingGame.active || this.turnGame.active) return;

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
    if (input.sit) {
      this.interactions.toggleSit(this.player, this.corridor.halfWidth(this.player.s));
    }
    if (input.phone) this.interactions.togglePhone(this.player);
    if (input.overbridge) this.traffic.useOverbridge(this.player);

    // Random street events: advance, then fold their modifiers onto the base
    // atmosphere ones (downpour slows you, a surge thickens the crowd).
    this.streetEvents.fixedUpdate(dt);
    this.player.speedMul = this.atmosphere.playerSpeedMul * this.streetEvents.speedMul;
    this.crowd.config.widthAdd = this.atmosphere.agentWidthAdd + this.streetEvents.widthAdd;

    this.prevS = this.player.s;
    this.prevT = this.player.t;
    const wasExhausted = this.player.exhausted;
    this.player.fixedUpdate(dt, input, this.corridor);
    if (!wasExhausted && this.player.exhausted) this.bus.emit('staminaEmpty', {});
    this.crowd.fixedUpdate(dt, this.player);
    this.traffic.fixedUpdate(dt, this.player, this.score);
    // Arriving at a junction → the "which way?" turn minigame takes over.
    this.maybeOpenTurn();
    if (this.turnGame.active) return;
    // Arriving at a major road → the Crossy-Roads minigame takes over.
    const zone = this.traffic.pendingZone;
    if (zone && !this.crossingGame.active && this.traffic.overbridgeTimer <= 0) {
      const outfit =
        OUTFIT_COLORS[this.ctx.save.get().equippedOutfit] ?? OUTFIT_COLORS.default!;
      void this.crossingGame.open(zone.difficulty, outfit).then((result) => {
        this.traffic.resolveCrossing(zone, result, this.player, this.score);
        this.prevS = this.player.s;
        this.prevT = this.player.t;
      });
    }
    this.pickpockets.fixedUpdate(dt, this.player, this.score, this.corridor.halfWidth(this.player.s));
    this.streetLife.fixedUpdate(dt, this.player, this.crowd, this.score);
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
      this.juice.knockout();
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
    // Sitting: ease onto the bench just off the strip, facing the street.
    let sitTarget: { x: number; z: number; yaw: number } | null = null;
    const restingAt = this.interactions.restingAt;
    if (this.player.resting && restingAt) {
      const half = this.corridor.halfWidth(restingAt.s);
      const side = restingAt.t >= 0 ? 1 : -1;
      // The bench is on the street side of the stall (the stall geometry's
      // bench sits ~1.3 m in front of its center) — never inside the stall.
      const benchT = side * Math.max(0.8, Math.min(Math.abs(restingAt.t) - 1.3, half + 0.5));
      const bp: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      this.corridor.toWorld(restingAt.s, benchT, bp);
      // Path normal (right side) is (-dirZ, dirX); the bench sits on `side`,
      // so the seated player faces the opposite way — back toward the street.
      const faceX = -side * -bp.dirZ;
      const faceZ = -side * bp.dirX;
      sitTarget = { x: bp.x, z: bp.z, yaw: Math.atan2(faceX, faceZ) };
    }
    this.avatar.update(this.player, s, t, this.corridor, sitTarget, frameDt);

    // Chase cam: locked behind the player along the path tangent and high
    // enough to clear roadside buildings, looking slightly down at the player
    // so the whole world banks with the road (Temple-Run feel) and the
    // character is never hidden behind a building on a curve.
    const cam = this.ctx.camera;
    const back = 6.0;
    let targetX = this.pose.x - this.pose.dirX * back - t * 0.2;
    let targetY = 5.0 + this.player.y * 0.3;
    let targetZ = this.pose.z - this.pose.dirZ * back;
    let lookX = this.pose.x + this.pose.dirX * 3.0;
    let lookZ = this.pose.z + this.pose.dirZ * 3.0;
    if (sitTarget) {
      // Cinematic rest framing: swing out front so the seated character
      // (and any approaching pocketmar) is in view.
      const fx = Math.sin(sitTarget.yaw);
      const fz = Math.cos(sitTarget.yaw);
      // High three-quarter angle: above passing heads, looking down at the bench.
      targetX = sitTarget.x + fx * 6.5 - fz * 2.5;
      targetY = 4.6;
      targetZ = sitTarget.z + fz * 6.5 + fx * 2.5;
      lookX = sitTarget.x;
      lookZ = sitTarget.z;
    }
    if (this.camInit) {
      const k = Math.min(1, frameDt * 6);
      cam.position.x += (targetX - cam.position.x) * k;
      cam.position.y += (targetY - cam.position.y) * k;
      cam.position.z += (targetZ - cam.position.z) * k;
      this.camLook.x += (lookX - this.camLook.x) * Math.min(1, frameDt * 8);
      this.camLook.z += (lookZ - this.camLook.z) * Math.min(1, frameDt * 8);
    } else {
      cam.position.set(targetX, targetY, targetZ);
      this.camLook = { x: lookX, z: lookZ };
      this.camInit = true;
    }
    cam.lookAt(this.camLook.x, 1.1, this.camLook.z);
    // Near-miss camera punch + shake on top of the chase framing.
    this.juice.applyCamera(cam);
    this.score.flowActive = this.juice.flowing;

    // Crowd = animated Quaternius people (same art style as the player), pooled
    // onto the agents nearest the camera.
    this.crowdActors.update(this.player.s, frameDt);
    this.pmRenderer.render(frameDt);
    this.trafficRenderer.render();
    this.crossTraffic?.update(frameDt);
    this.lifeRenderer.render();
    this.renderGhost();
    // Floating ☕/🪑 cue above the rest spot the sit button would use.
    const near = this.interactions.nearRest;
    if (near && !this.player.resting) {
      const mp: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      this.corridor.toWorld(near.s, near.t, mp);
      this.restMarker.update(frameDt, {
        kind: near.kind as 'chaDokan' | 'busStop',
        x: mp.x,
        z: mp.z,
      });
    } else {
      this.restMarker.update(frameDt, null);
    }
    // Seated-theft minigame: ❗ over the creeping thief + draining timer.
    const thief = this.player.resting ? this.pickpockets.seatedThiefPos : null;
    if (thief) {
      const tp: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      this.corridor.toWorld(thief.s, thief.t, tp);
      this.restMarker.updateAlert({ x: tp.x, z: tp.z });
      this.hud.setSeatedAlert(this.pickpockets.seatedTell / SEATED_TELL_TIME);
    } else {
      this.restMarker.updateAlert(null);
      this.hud.setSeatedAlert(null);
    }
    this.hud.set(
      (this.player.health / HEALTH_MAX) * 100,
      this.player.stamina,
      this.score.meterActive > 0 ? 1 : this.score.meter,
      this.score.taka,
      this.score.combo,
    );
    this.hud.setContext(
      this.interactions.nearRest
        ? (this.interactions.nearRest.kind as 'chaDokan' | 'busStop')
        : null,
      this.player.resting,
      false, // crossings are handled by the minigame overlay now
    );
    this.hud.setSandWatch(this.sandWatch.owned, this.sandWatch.charge, this.sandWatch.canActivate);
    this.rewindFx.frame(frameDt);
    this.juice.frame(frameDt);
    this.eventFx.frame(frameDt);
    // Street-event darkening on the scene lights (blackout / downpour dusk).
    const dim = 1 - this.streetEvents.darkness;
    if (this.hemiLight) this.hemiLight.intensity = this.baseHemi * dim;
    if (this.sunLight) this.sunLight.intensity = this.baseSun * dim;
    this.atmosphereHandle.frame(frameDt);
    if (this.player.phoneLocked && this.params.area && this.params.route && this.projector) {
      const rp: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      this.projector.toWorld(this.player.s, this.player.t, rp);
      this.phoneOverlay.updatePosition(this.params.area, this.params.route.pts, rp.x, rp.z);
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
      // Total journey distance (accumulates across turn-deviation segments).
      distance: Math.round(this.summary.distanceM),
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
    const hemi = new HemisphereLight(0xfff3da, 0x5a4a35, 1.05);
    this.scene.add(hemi);
    const sun = new DirectionalLight(0xffe7c0, 1.1);
    sun.position.set(-30, 60, -20);
    this.scene.add(sun);
    // Remember base light levels so street events can darken/restore them.
    this.hemiLight = hemi;
    this.sunLight = sun;
    this.baseHemi = hemi.intensity;
    this.baseSun = sun.intensity;
    // Time-of-day & weather overrides + rain updater.
    this.atmosphereHandle = dressScene(this.scene, this.atmosphere, () => ({
      x: this.pose.x,
      z: this.pose.z,
    }));

    if (this.params.area && this.params.route && this.projector) {
      // Real Dhaka, unrolled straight: build from baked OSM data mapped into
      // the straight corridor so the road never bends while walking.
      const marks = this.gatherIntersections();
      this.level = new LevelRenderer(
        this.scene,
        straightenArea(this.params.area, this.projector),
        straightRoute(this.params.route.pts, this.projector),
        this.buildRestStalls(),
        this.bendUniforms,
        marks,
      );
      this.crossTraffic = new CrossTrafficRenderer(this.scene, marks, this.bendUniforms);
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
