/**
 * The road crossing as a self-contained Crossy-Roads-style 2D minigame
 * (Rev 6): top-down candy-colored lanes, fast cars, hop cell by cell from
 * the bottom footpath to the top one. Reach the top = bonus; get hit = hurt
 * and knocked back outside; the overbridge skip is always one tap away.
 *
 * Controls: arrows/WASD, or swipe (tap = hop forward) on touch.
 */

export type CrossingResult = 'crossed' | 'skipped' | 'hit';

const COLS = 9;
const CAR_COLORS = ['#ff5a8a', '#39c2a5', '#ffb84d', '#6aa6ff', '#b98aff', '#7fd16a'];
const HOP_TIME = 0.12;

interface Car {
  lane: number; // row index among car lanes
  x: number; // in cells
  speed: number; // cells/s, signed
  len: number; // cells
  color: string;
}

export class CrossingMinigame {
  private root: HTMLDivElement | null = null;
  private canvas!: HTMLCanvasElement;
  private raf = 0;
  private resolveFn: ((r: CrossingResult) => void) | null = null;
  private cars: Car[] = [];
  private lanes = 4;
  private px = Math.floor(COLS / 2);
  private py = 0; // 0 = bottom footpath … lanes+1 = top footpath
  private hopFrom = { x: 0, y: 0 };
  private hopT = 1;
  private time = 0;
  private last = 0;
  private over = false;
  private playerColor = '#e8a33d';
  private touchStart: { x: number; y: number } | null = null;

  /** Opens the overlay; resolves with the outcome. */
  open(difficulty: number, playerColor: string): Promise<CrossingResult> {
    // Always 6 lanes — a proper Crossy-Road crossing. Difficulty still drives
    // car speed/density below.
    this.lanes = 6;
    this.playerColor = playerColor;
    this.px = Math.floor(COLS / 2);
    this.py = 0;
    this.hopT = 1;
    this.time = 0;
    this.over = false;
    this.cars = [];
    for (let lane = 0; lane < this.lanes; lane++) {
      const dir = lane % 2 === 0 ? 1 : -1;
      const speed = (2.2 + difficulty * 0.7 + Math.random() * 1.2) * dir;
      const count = 2 + Math.floor(Math.random() * 2);
      for (let c = 0; c < count; c++) {
        this.cars.push({
          lane,
          x: (COLS / count) * c + Math.random() * 2,
          speed,
          len: Math.random() < 0.3 ? 2.4 : 1.4,
          color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]!,
        });
      }
    }

    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:25;background:#1a1208;display:flex;flex-direction:column';
    this.root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:max(10px,env(safe-area-inset-top)) 14px 6px;color:#fff;font-family:system-ui">
        <div style="font-weight:900;font-size:17px">🚸 CROSS THE ROAD!</div>
        <button id="cw-skip" style="border:none;border-radius:10px;padding:8px 14px;font-weight:800;
          background:rgba(255,255,255,.15);color:#fff;font-family:inherit">🌉 overbridge</button>
      </div>
      <canvas style="flex:1;width:100%;touch-action:none"></canvas>
      <div style="text-align:center;color:#9a8f7c;font:12px system-ui;
        padding:6px 0 max(10px,env(safe-area-inset-bottom))">swipe / tap to hop · arrows on keyboard</div>
    `;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.root.querySelector('#cw-skip')!.addEventListener('click', () => this.finish('skipped'));

    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false });

    this.last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.step(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);

    return new Promise((res) => (this.resolveFn = res));
  }

  get active(): boolean {
    return this.root !== null;
  }

  private finish(result: CrossingResult): void {
    if (this.over) return;
    this.over = true;
    // Brief beat so the hit flash / win pose is visible.
    setTimeout(() => {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('keydown', this.onKey);
      this.root?.remove();
      this.root = null;
      this.resolveFn?.(result);
      this.resolveFn = null;
    }, result === 'crossed' ? 350 : 550);
  }

  private hop(dx: number, dy: number): void {
    if (this.over || this.hopT < 1) return;
    const nx = Math.max(0, Math.min(COLS - 1, this.px + dx));
    const ny = Math.max(0, Math.min(this.lanes + 1, this.py + dy));
    if (nx === this.px && ny === this.py) return;
    this.hopFrom = { x: this.px, y: this.py };
    this.px = nx;
    this.py = ny;
    this.hopT = 0;
    if (this.py === this.lanes + 1) this.finish('crossed');
  }

  private onKey = (e: KeyboardEvent): void => {
    const map: Record<string, [number, number]> = {
      ArrowUp: [0, 1], KeyW: [0, 1],
      ArrowDown: [0, -1], KeyS: [0, -1],
      ArrowLeft: [-1, 0], KeyA: [-1, 0],
      ArrowRight: [1, 0], KeyD: [1, 0],
    };
    const d = map[e.code];
    if (d) {
      e.preventDefault();
      this.hop(d[0], d[1]);
    }
  };

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    const t = e.changedTouches[0]!;
    this.touchStart = { x: t.clientX, y: t.clientY };
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    const t = e.changedTouches[0]!;
    const s = this.touchStart;
    this.touchStart = null;
    if (!s) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.hypot(dx, dy) < 24) return this.hop(0, 1); // tap = forward
    if (Math.abs(dx) > Math.abs(dy)) this.hop(dx > 0 ? 1 : -1, 0);
    else this.hop(0, dy < 0 ? 1 : -1);
  };

  private step(dt: number): void {
    this.time += dt;
    if (this.hopT < 1) this.hopT = Math.min(1, this.hopT + dt / HOP_TIME);
    if (this.over) return;
    for (const car of this.cars) {
      car.x += car.speed * dt;
      const span = COLS + 4;
      if (car.speed > 0 && car.x > COLS + 2) car.x -= span + car.len;
      if (car.speed < 0 && car.x < -2 - car.len) car.x += span + car.len;
      // Collision: player on this lane's row, horizontal overlap.
      const row = car.lane + 1;
      if (this.py === row && this.hopT >= 0.4) {
        if (this.px + 0.75 > car.x && this.px + 0.25 < car.x + car.len) {
          this.finish('hit');
        }
      }
    }
  }

  private draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (this.canvas.width !== rect.width * devicePixelRatio) {
      this.canvas.width = rect.width * devicePixelRatio;
      this.canvas.height = rect.height * devicePixelRatio;
    }
    const g = this.canvas.getContext('2d')!;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const W = rect.width;
    const H = rect.height;
    const rows = this.lanes + 2;
    const cell = Math.min(W / COLS, H / rows);
    const ox = (W - cell * COLS) / 2;
    const oy = (H - cell * rows) / 2;
    /** Row 0 (footpath) is at the BOTTOM of the screen. */
    const rowY = (r: number): number => oy + (rows - 1 - r) * cell;

    g.fillStyle = '#212d36';
    g.fillRect(0, 0, W, H);
    // Footpaths: candy grass-green strips.
    for (const r of [0, rows - 1]) {
      g.fillStyle = '#8fd16a';
      g.fillRect(ox, rowY(r), cell * COLS, cell);
      g.fillStyle = 'rgba(255,255,255,.18)';
      for (let c = 0; c < COLS; c += 2) g.fillRect(ox + c * cell + 6, rowY(r) + 6, cell - 12, cell - 12);
    }
    // Car lanes + dashed separators.
    g.fillStyle = '#37424d';
    g.fillRect(ox, rowY(rows - 2), cell * COLS, cell * this.lanes);
    g.strokeStyle = 'rgba(255,255,255,.5)';
    g.lineWidth = 3;
    g.setLineDash([14, 14]);
    for (let r = 1; r < this.lanes; r++) {
      const y = rowY(r) ;
      g.beginPath();
      g.moveTo(ox, y);
      g.lineTo(ox + cell * COLS, y);
      g.stroke();
    }
    g.setLineDash([]);

    // Cars: rounded candy blocks with cab + wheels.
    for (const car of this.cars) {
      const y = rowY(car.lane + 1);
      const x = ox + car.x * cell;
      const w = car.len * cell;
      g.fillStyle = '#1d242b';
      rr(g, x + 4, y + cell * 0.18 - 3, w - 8, cell * 0.7, 10);
      g.fill();
      g.fillStyle = car.color;
      rr(g, x + 4, y + cell * 0.15, w - 8, cell * 0.62, 10);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      const cabX = car.speed > 0 ? x + w * 0.55 : x + w * 0.12;
      rr(g, cabX, y + cell * 0.22, w * 0.3, cell * 0.3, 6);
      g.fill();
    }

    // Player: little Among-Us-ish capsule in the outfit color.
    const ix = this.hopFrom.x + (this.px - this.hopFrom.x) * this.hopT;
    const iy = this.hopFrom.y + (this.py - this.hopFrom.y) * this.hopT;
    const bounce = Math.sin(this.hopT * Math.PI) * cell * 0.3;
    const pxx = ox + ix * cell + cell / 2;
    const pyy = rowY(iy) + cell / 2 - bounce;
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.ellipse(pxx, rowY(iy) + cell * 0.78, cell * 0.26, cell * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = this.playerColor;
    rr(g, pxx - cell * 0.24, pyy - cell * 0.3, cell * 0.48, cell * 0.62, cell * 0.24);
    g.fill();
    g.fillStyle = '#bfe3ff';
    rr(g, pxx - cell * 0.13, pyy - cell * 0.2, cell * 0.3, cell * 0.18, cell * 0.09);
    g.fill();

    if (this.over) {
      g.fillStyle = this.py === this.lanes + 1 ? 'rgba(143,209,106,.35)' : 'rgba(255,70,50,.35)';
      g.fillRect(0, 0, W, H);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.root?.remove();
    this.root = null;
    this.resolveFn = null;
  }
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
