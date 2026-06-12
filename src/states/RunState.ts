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

const RUN_LENGTH = 500;
const CORRIDOR_HALF_WIDTH = 3.2;

export interface RunParams {
  seed: number;
  density?: number;
  /** Real-level mode: baked area + chosen route. Absent = graybox corridor. */
  area?: BakedArea;
  route?: RouteOption;
}

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

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const p = (params as RunParams | undefined) ?? { seed: 1 };
    this.params = p;
    this.finished = false;
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
    this.crowd = new CrowdSystem(this.corridor, this.rng.stream('crowd'), this.bus);
    if (p.density) this.crowd.config.density = p.density;
    else if (p.route) this.crowd.config.density = Math.min(190, 60 + p.route.crowd * 26);

    // M4 systems.
    this.director = new Director(this.rng.stream('director'), this.bus);
    this.pickpockets = new PickpocketSystem(this.rng.stream('pocketmar'), this.bus);
    this.pickpockets.config = {
      risk: p.route?.pickpocket ?? 2,
      canSpawn: this.director.canSpawnPickpocket,
    };
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

    this.buildScene();
    this.crowd.prewarm(this.player.s);
    this.crowdRenderer = new CrowdRenderer(this.scene, this.crowd, this.corridor);
    this.avatar = new PlayerAvatar(this.scene);
    this.pmRenderer = new PickpocketRenderer(this.scene, this.pickpockets, this.corridor);
    this.trafficRenderer = new TrafficRenderer(this.scene, this.traffic, this.corridor);
    this.lifeRenderer = new StreetLifeRenderer(this.scene, this.streetLife, this.corridor);
    this.hud = new Hud(this.ctx.input);
    this.phoneOverlay = new PhoneOverlay();

    this.bus.on('bump', () => this.hud.toast('ওহ! bumped', 0));
    this.bus.on('cakewalkMeterFull', () => this.hud.toast('CAKEWALK! 2x points', 0));
    this.bus.on('theft', (e) => this.hud.toast(`😱 pocketmar! -৳${e.amount}`, 0));
    this.bus.on('theftSpotted', () => this.hud.toast('👀 Spotted! He melts away…', 0));
    this.bus.on('stareMisread', () => this.hud.toast('😠 …that was just an uncle', 0));
    this.bus.on('fruitGrabbed', () => this.hud.toast('🥭 +12', 0));
    this.bus.on('catStumble', () => this.hud.toast('🐈 cat! combo lost', 0));
    this.bus.on('dogBark', () => this.hud.toast('🐕 WOOF! panic!', 0));
    this.bus.on('vehicleHit', (e) => this.hud.toast(`🚌 hit by ${e.vehicleKind}!`, 0));
    this.bus.on('crossingResolved', (e) =>
      this.hud.toast(e.method === 'direct' ? `🎉 crossed! +৳${e.bonus}` : '🌉 safe & slow', 0),
    );
    this.bus.on('microEvent', (e) =>
      this.hud.toast(
        e.kind === 'hawkerPitch'
          ? '🧺 "Mama, eita nen!"'
          : e.kind === 'directionsAsk'
            ? '🗣 "Bhai, Gulistan kon dike?"'
            : '☕ "Cha khaben?"',
        0,
      ),
    );
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
    this.hud.dispose();
    this.phoneOverlay.dispose();
    this.avatar.dispose(this.scene);
    this.crowdRenderer.dispose(this.scene);
    this.pmRenderer.dispose(this.scene);
    this.trafficRenderer.dispose(this.scene);
    this.lifeRenderer.dispose(this.scene);
    this.level?.dispose(this.scene);
    this.level = null;
    this.scene.clear();
    delete this.ctx.testApi.run;
  }

  fixedUpdate(dt: number): void {
    if (this.finished) return;
    const input = this.ctx.input.poll(dt);

    // Edge-triggered context actions before movement.
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
    this.director.fixedUpdate(dt, this.player);
    this.score.fixedUpdate(dt);
    this.score.addDistance(Math.max(0, this.player.s - this.prevS));
    this.ctx.debug.agentCount = this.crowd.activeCount;

    this.bus.flush();

    if (this.player.s >= this.runLength) this.finish(true);
    else if (this.player.health <= 0) this.finish(false);
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
    this.ctx.machine.transition('results', {
      success,
      taka: this.score.taka,
      bestCombo: this.score.bestCombo,
      nearMisses: this.score.nearMisses,
      distance: Math.round(this.player.s),
    });
  }

  private buildScene(): void {
    this.scene = new Scene();
    this.scene.background = new Color('#c9b18a'); // dusty Dhaka haze
    this.scene.fog = new Fog('#c9b18a', 30, 130);
    this.scene.add(new HemisphereLight(0xfff3da, 0x5a4a35, 1.05));
    const sun = new DirectionalLight(0xffe7c0, 1.1);
    sun.position.set(-30, 60, -20);
    this.scene.add(sun);

    if (this.params.area && this.params.route) {
      // Real Dhaka: build the world from baked OSM data along the route.
      this.level = new LevelRenderer(this.scene, this.params.area, this.params.route.pts);
      const end: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
      this.corridor.toWorld(this.runLength, 0, end);
      const gate = new Mesh(
        new BoxGeometry(6, 4, 0.5),
        new MeshLambertMaterial({ color: '#3fa34d', flatShading: true }),
      );
      gate.position.set(end.x, 2, end.z);
      gate.rotation.y = Math.atan2(end.dirX, end.dirZ);
      this.scene.add(gate);
      return;
    }

    // Graybox fallback (tests, control spikes).
    // Footpath ribbon.
    const path = new Mesh(
      new PlaneGeometry(CORRIDOR_HALF_WIDTH * 2, RUN_LENGTH + 120),
      new MeshLambertMaterial({ color: '#9b9484' }),
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0, -(RUN_LENGTH + 120) / 2 + 30);
    this.scene.add(path);

    // Road strip beside the footpath (visual context).
    const road = new Mesh(
      new PlaneGeometry(8, RUN_LENGTH + 120),
      new MeshLambertMaterial({ color: '#55524c' }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(CORRIDOR_HALF_WIDTH + 4.2, -0.02, -(RUN_LENGTH + 120) / 2 + 30);
    this.scene.add(road);

    // Graybox "buildings" wall on the left, motion-reference pillars.
    const buildingMat = new MeshLambertMaterial({ color: '#8a7f6f', flatShading: true });
    const buildingGeo = new BoxGeometry(4, 1, 10);
    const rng = this.rng.stream('scenery');
    for (let z = 0; z < RUN_LENGTH + 60; z += 11) {
      const h = rng.range(5, 16);
      const b = new Mesh(buildingGeo, buildingMat);
      b.scale.y = h;
      b.position.set(-CORRIDOR_HALF_WIDTH - 2.5, h / 2, -z);
      this.scene.add(b);
    }

    // Finish gate.
    const gate = new Mesh(
      new BoxGeometry(CORRIDOR_HALF_WIDTH * 2 + 1, 4, 0.5),
      new MeshLambertMaterial({ color: '#3fa34d', flatShading: true }),
    );
    gate.position.set(0, 2, -RUN_LENGTH);
    this.scene.add(gate);
  }
}
