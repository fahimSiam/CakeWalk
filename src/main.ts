/**
 * Bootstrap: renderer, game loop, state machine, debug overlay, test hook.
 */
import { PerspectiveCamera, WebGLRenderer } from 'three';
import { GameLoop, SIM_DT } from '@/core/GameLoop';
import { StateMachine } from '@/core/StateMachine';
import { DebugOverlay } from '@/core/DebugOverlay';
import { SaveSystem } from '@/core/SaveSystem';
import { InputSystem } from '@/player/Input';
import type { GameContext } from '@/core/GameContext';
import { RunState } from '@/states/RunState';
import { ResultsState } from '@/states/ResultsState';
import { RouteSelectState } from '@/states/RouteSelectState';
import { MenuState } from '@/states/MenuState';
import { createLocalServices } from '@/services';

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

const save = new SaveSystem();
const ctx: GameContext = {
  renderer,
  camera,
  machine: new StateMachine(),
  save,
  debug: new DebugOverlay(renderer),
  input: new InputSystem(app),
  services: createLocalServices(save),
  loopTimeScale: (scale) => {
    loop.timeScale = scale;
  },
  testApi: {},
};

ctx.machine.register('run', new RunState(ctx));
ctx.machine.register('results', new ResultsState(ctx));
ctx.machine.register('routeSelect', new RouteSelectState(ctx));
ctx.machine.register('menu', new MenuState(ctx));

const loop = new GameLoop({
  fixedUpdate(dt) {
    const t0 = performance.now();
    ctx.machine.fixedUpdate(dt);
    ctx.debug.simMs = performance.now() - t0;
  },
  render(alpha, frameDt) {
    ctx.machine.render(alpha, frameDt);
    ctx.debug.frame(performance.now());
  },
});

/** Playwright/dev hook: deterministic input injection & tick stepping. */
declare global {
  interface Window {
    __cakewalk: {
      ctx: GameContext;
      loop: GameLoop;
      ready: boolean;
      step(ticks: number): void;
      inject(partial: Record<string, unknown>): void;
    };
  }
}
window.__cakewalk = {
  ctx,
  loop,
  ready: false,
  step(ticks: number) {
    for (let i = 0; i < ticks; i++) ctx.machine.fixedUpdate(SIM_DT);
  },
  inject(partial: Record<string, unknown>) {
    ctx.input.injected = partial;
  },
};

void (async () => {
  await ctx.save.load();
  const q = new URLSearchParams(location.search);
  const seed = Number(q.get('seed') ?? 1);
  if (q.has('graybox')) {
    ctx.machine.transition('run', { seed });
  } else if (q.has('area')) {
    ctx.machine.transition('routeSelect', { areaId: q.get('area'), seed });
  } else {
    ctx.machine.transition('menu');
  }
  loop.start();
  window.__cakewalk.ready = true;
})();
