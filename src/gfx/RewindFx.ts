/**
 * Sand Watch rewind presentation (idea.md §2.6): the world drains to sepia,
 * golden sand streams into the watch, then color snaps back with a brief
 * slow-mo. Sepia rides the compositor (CSS filter on the WebGL canvas);
 * sand is a lightweight 2D canvas overlay. Designed to look great in
 * vertical share clips.
 */

const PARTICLES = 90;

interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

export class RewindFx {
  private overlay: HTMLCanvasElement;
  private grains: Grain[] = [];
  private active = false;

  constructor(private gameCanvas: HTMLCanvasElement) {
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText = 'position:fixed;inset:0;z-index:12;pointer-events:none;display:none';
    document.body.appendChild(this.overlay);
  }

  start(): void {
    this.active = true;
    this.overlay.style.display = 'block';
    this.overlay.width = innerWidth * devicePixelRatio;
    this.overlay.height = innerHeight * devicePixelRatio;
    this.gameCanvas.style.transition = 'filter .25s';
    this.gameCanvas.style.filter = 'sepia(.85) saturate(.8) brightness(1.06)';
    this.grains = [];
    for (let i = 0; i < PARTICLES; i++) this.grains.push(this.spawnGrain());
  }

  /** Color snaps back at the rewind point ("glass-turn" click moment). */
  land(): void {
    this.gameCanvas.style.filter = 'none';
  }

  stop(): void {
    this.active = false;
    this.overlay.style.display = 'none';
    this.gameCanvas.style.filter = 'none';
  }

  frame(dt: number): void {
    if (!this.active) return;
    const g = this.overlay.getContext('2d')!;
    const w = this.overlay.width;
    const h = this.overlay.height;
    g.clearRect(0, 0, w, h);
    // Sand converges on the watch (bottom-right HUD corner).
    const tx = w * 0.86;
    const ty = h * 0.82;
    g.fillStyle = '#ffd98a';
    for (const grain of this.grains) {
      const dx = tx - grain.x;
      const dy = ty - grain.y;
      const d = Math.hypot(dx, dy) || 1;
      grain.vx += (dx / d) * 2600 * dt;
      grain.vy += (dy / d) * 2600 * dt;
      grain.x += grain.vx * dt;
      grain.y += grain.vy * dt;
      g.globalAlpha = Math.min(1, d / 200);
      g.fillRect(grain.x, grain.y, grain.size, grain.size);
      if (d < 40) Object.assign(grain, this.spawnGrain());
    }
    g.globalAlpha = 1;
  }

  dispose(): void {
    this.overlay.remove();
    this.gameCanvas.style.filter = 'none';
  }

  private spawnGrain(): Grain {
    return {
      x: Math.random() * this.overlay.width,
      y: Math.random() * this.overlay.height,
      vx: (Math.random() - 0.5) * 120,
      vy: (Math.random() - 0.5) * 120,
      size: 2 + Math.random() * 3 * devicePixelRatio,
    };
  }
}
