/**
 * Fixed-timestep game loop: simulation at 30 Hz, rendering at display rate
 * with interpolation alpha. 30 Hz halves Sand Watch snapshot memory and sim
 * CPU on low-end phones; render interpolation keeps motion smooth.
 */

export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
const MAX_STEPS_PER_FRAME = 5; // avoid spiral-of-death after hitches

export interface LoopClient {
  /** Advance simulation by exactly SIM_DT (possibly time-scaled). */
  fixedUpdate(dt: number): void;
  /** Draw, interpolating between previous and current sim states. */
  render(alpha: number, frameDt: number): void;
}

export class GameLoop {
  /** Scales sim time: 1 = normal, <1 = slow-mo (Sand Watch exit), 0 = frozen. */
  timeScale = 1;

  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(private client: LoopClient) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(frame);
      const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
      this.lastTime = now;

      this.accumulator += frameDt * this.timeScale;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
        this.client.fixedUpdate(SIM_DT);
        this.accumulator -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

      const alpha = this.timeScale > 0 ? this.accumulator / SIM_DT : 1;
      this.client.render(alpha, frameDt);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
