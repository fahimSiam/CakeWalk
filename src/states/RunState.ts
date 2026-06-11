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

const RUN_LENGTH = 500;
const CORRIDOR_HALF_WIDTH = 3.2;

export interface RunParams {
  seed: number;
  density?: number;
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
  private playerMesh!: Mesh;
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private finished = false;
  private prevS = 0;
  private prevT = 0;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const p = (params as RunParams | undefined) ?? { seed: 1 };
    this.finished = false;
    this.bus = new EventBus();
    this.rng = new Rng(p.seed);
    this.corridor = new StraightCorridor(RUN_LENGTH + 60, CORRIDOR_HALF_WIDTH);
    this.player = new Player();
    this.score = new RunScore(this.bus);
    this.crowd = new CrowdSystem(this.corridor, this.rng.stream('crowd'), this.bus);
    if (p.density) this.crowd.config.density = p.density;

    this.buildScene();
    this.crowd.prewarm(this.player.s);
    this.crowdRenderer = new CrowdRenderer(this.scene, this.crowd, this.corridor);
    this.hud = new Hud(this.ctx.input);

    this.bus.on('bump', () => this.hud.toast('ওহ! bumped', 0));
    this.bus.on('cakewalkMeterFull', () => this.hud.toast('CAKEWALK! 2x points', 0));

    this.ctx.testApi.run = {
      player: this.player,
      crowd: this.crowd,
      score: this.score,
      bus: this.bus,
    };
  }

  exit(): void {
    this.hud.dispose();
    this.crowdRenderer.dispose(this.scene);
    this.scene.clear();
    delete this.ctx.testApi.run;
  }

  fixedUpdate(dt: number): void {
    if (this.finished) return;
    const input = this.ctx.input.poll(dt);

    this.prevS = this.player.s;
    this.prevT = this.player.t;
    this.player.fixedUpdate(dt, input, this.corridor);
    this.crowd.fixedUpdate(dt, this.player);
    this.score.fixedUpdate(dt);
    this.score.addDistance(this.player.s - this.prevS);
    this.ctx.debug.agentCount = this.crowd.activeCount;

    this.bus.flush();

    if (this.player.s >= RUN_LENGTH) this.finish(true);
    else if (this.player.health <= 0) this.finish(false);
  }

  render(alpha: number, frameDt: number): void {
    // Interpolate player between previous and current sim positions.
    const s = this.prevS + (this.player.s - this.prevS) * alpha;
    const t = this.prevT + (this.player.t - this.prevT) * alpha;
    this.corridor.toWorld(s, t, this.pose);

    this.playerMesh.position.set(this.pose.x, this.player.y, this.pose.z);
    const duckScale = this.player.pose === 3 ? 0.62 : this.player.pose !== 0 ? 0.85 : 1;
    this.playerMesh.scale.y = duckScale;
    this.playerMesh.rotation.z =
      this.player.pose === 1 ? 0.22 : this.player.pose === 2 ? -0.22 : 0;

    // Chase cam: behind and above, looking ahead down the path.
    const cam = this.ctx.camera;
    cam.position.set(this.pose.x * 0.6, 3.0 + this.player.y * 0.3, this.pose.z + 5.2);
    cam.lookAt(this.pose.x * 0.8, 1.1, this.pose.z - 6);

    this.crowdRenderer.render();
    this.hud.set(
      (this.player.health / HEALTH_MAX) * 100,
      this.player.stamina,
      this.score.meterActive > 0 ? 1 : this.score.meter,
      this.score.taka,
      this.score.combo,
    );
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

    // Player placeholder body.
    const body = new BoxGeometry(0.55, 1.7, 0.35);
    body.translate(0, 0.85, 0);
    this.playerMesh = new Mesh(
      body,
      new MeshLambertMaterial({ color: '#e8a33d', flatShading: true }),
    );
    this.scene.add(this.playerMesh);
  }
}
