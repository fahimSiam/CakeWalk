/**
 * Bootstrap: renderer, game loop, state machine, debug overlay, test hook.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  IcosahedronGeometry,
  WebGLRenderer,
} from 'three';
import { GameLoop } from '@/core/GameLoop';
import { StateMachine, type GameState } from '@/core/StateMachine';
import { DebugOverlay } from '@/core/DebugOverlay';
import { SaveSystem } from '@/core/SaveSystem';

const app = document.getElementById('app')!;
const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const debug = new DebugOverlay(renderer);
const save = new SaveSystem();
const machine = new StateMachine();

/** M0 smoke state: spinning flat-shaded icosahedron over Dhaka-dusk sky. */
class BootState implements GameState {
  private scene = new Scene();
  private mesh: Mesh;
  private t = 0;

  constructor() {
    this.scene.background = new Color('#2a1f14');
    this.scene.add(new HemisphereLight(0xfff0d0, 0x403020, 1.0));
    const sun = new DirectionalLight(0xffe0b0, 1.2);
    sun.position.set(3, 5, 2);
    this.scene.add(sun);
    this.mesh = new Mesh(
      new IcosahedronGeometry(1, 0),
      new MeshLambertMaterial({ color: '#e8a33d', flatShading: true }),
    );
    this.scene.add(this.mesh);
    camera.position.set(0, 0.5, 3.2);
    camera.lookAt(0, 0, 0);
  }

  enter(): void {}
  exit(): void {}

  fixedUpdate(dt: number): void {
    this.t += dt;
  }

  render(alpha: number, _frameDt: number): void {
    const t = this.t + alpha * (1 / 30);
    this.mesh.rotation.set(t * 0.4, t * 0.7, 0);
    renderer.render(this.scene, camera);
  }
}

machine.register('boot', new BootState());

const loop = new GameLoop({
  fixedUpdate(dt) {
    const t0 = performance.now();
    machine.fixedUpdate(dt);
    debug.simMs = performance.now() - t0;
  },
  render(alpha, frameDt) {
    machine.render(alpha, frameDt);
    debug.frame(performance.now());
  },
});

/** Playwright/dev hook: deterministic state inspection & tick stepping. */
declare global {
  interface Window {
    __cakewalk: {
      machine: StateMachine;
      loop: GameLoop;
      renderer: WebGLRenderer;
      ready: boolean;
      step(ticks: number): void;
    };
  }
}
window.__cakewalk = {
  machine,
  loop,
  renderer,
  ready: false,
  step(ticks: number) {
    for (let i = 0; i < ticks; i++) machine.fixedUpdate(1 / 30);
  },
};

void (async () => {
  await save.load();
  machine.transition('boot');
  loop.start();
  window.__cakewalk.ready = true;
})();
