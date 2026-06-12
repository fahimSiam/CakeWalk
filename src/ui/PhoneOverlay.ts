/**
 * The phone-check overlay (idea.md §2.4): a maps-style view rendered from
 * our own baked OSM data (zero Google assets) showing the route, your live
 * position, and the destination. While it's up, the player is blind to the
 * street — the risk is the point.
 */
import type { BakedArea, Vec2 } from '@/world/levelTypes';

export class PhoneOverlay {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private visible = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:18;display:none;align-items:center;justify-content:center;' +
      'background:rgba(10,8,4,.45);pointer-events:none';
    this.root.innerHTML = `
      <div style="width:72vw;max-width:330px;aspect-ratio:9/16;background:#111;border-radius:22px;
        border:4px solid #2a2a2a;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.6)">
        <div style="background:#1c2733;color:#fff;font:600 12px system-ui;padding:8px 12px">📍 CakeWalk Maps</div>
        <canvas style="flex:1;width:100%"></canvas>
        <div style="background:#1c2733;color:#9fb4c4;font:11px system-ui;padding:6px 12px;text-align:center">
          watch your pockets…
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
  }

  show(area: BakedArea, routePts: Vec2[], playerX: number, playerZ: number): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.draw(area, routePts, playerX, playerZ);
  }

  updatePosition(area: BakedArea, routePts: Vec2[], playerX: number, playerZ: number): void {
    if (this.visible) this.draw(area, routePts, playerX, playerZ);
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  dispose(): void {
    this.root.remove();
  }

  private draw(area: BakedArea, routePts: Vec2[], px: number, pz: number): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    const g = this.canvas.getContext('2d')!;
    g.scale(devicePixelRatio, devicePixelRatio);

    // Window centered on the player, ~400 m across.
    const span = 400;
    const scale = rect.width / span;
    const X = (p: Vec2): number => rect.width / 2 + (p[0] - px) * scale;
    const Y = (p: Vec2): number => rect.height / 2 + (p[1] - pz) * scale;

    g.fillStyle = '#e8e3d8';
    g.fillRect(0, 0, rect.width, rect.height);

    for (const w of area.water) {
      g.beginPath();
      g.moveTo(X(w[0]!), Y(w[0]!));
      for (const p of w) g.lineTo(X(p), Y(p));
      g.closePath();
      g.fillStyle = '#a8c8e0';
      g.fill();
    }
    for (const pk of area.parks) {
      g.beginPath();
      g.moveTo(X(pk[0]!), Y(pk[0]!));
      for (const p of pk) g.lineTo(X(p), Y(p));
      g.closePath();
      g.fillStyle = '#bcd5a8';
      g.fill();
    }
    for (const road of area.roads) {
      g.beginPath();
      g.moveTo(X(road.pts[0]!), Y(road.pts[0]!));
      for (const p of road.pts) g.lineTo(X(p), Y(p));
      g.strokeStyle = road.class === 'major' ? '#f5c87a' : '#ffffff';
      g.lineWidth = road.class === 'major' ? 5 : 3;
      g.stroke();
    }
    // Route.
    g.beginPath();
    g.moveTo(X(routePts[0]!), Y(routePts[0]!));
    for (const p of routePts) g.lineTo(X(p), Y(p));
    g.strokeStyle = '#3478f6';
    g.lineWidth = 4;
    g.stroke();
    // Destination.
    const dest = routePts[routePts.length - 1]!;
    g.fillStyle = '#d63a2f';
    g.beginPath();
    g.arc(X(dest), Y(dest), 6, 0, Math.PI * 2);
    g.fill();
    // You.
    g.fillStyle = '#3478f6';
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(rect.width / 2, rect.height / 2, 7, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
}
