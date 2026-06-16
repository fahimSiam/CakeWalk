/**
 * Screen overlay for the active street event (see StreetEvents): a darkening
 * tint (monsoon dusk / load-shedding blackout) and animated rain streaks during
 * a downpour. Lightweight 2D canvas over the WebGL canvas, driven each frame
 * from the event's eased strength + kind.
 */
import type { StreetEvents, StreetEventKind } from '@/world/StreetEvents';

interface Drop {
  x: number;
  y: number;
  len: number;
  spd: number;
}

export class EventFx {
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private drops: Drop[] = [];

  constructor(gameCanvas: HTMLCanvasElement, private events: StreetEvents) {
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
    gameCanvas.parentElement?.appendChild(this.overlay);
    this.ctx = this.overlay.getContext('2d')!;
  }

  frame(frameDt: number): void {
    const kind = this.events.activeKind;
    const strength = this.events.strength;
    const w = (this.overlay.width = this.overlay.clientWidth || window.innerWidth);
    const h = (this.overlay.height = this.overlay.clientHeight || window.innerHeight);
    const g = this.ctx;
    g.clearRect(0, 0, w, h);
    if (!kind || strength < 0.01) {
      this.drops.length = 0;
      return;
    }

    // Darkening tint (blue-grey for monsoon, near-black for blackout).
    const dark = this.events.darkness;
    if (dark > 0.01) {
      g.fillStyle = kind === 'blackout' ? `rgba(4,6,12,${dark})` : `rgba(30,38,54,${dark})`;
      g.fillRect(0, 0, w, h);
    }

    if (kind === 'monsoon') this.rain(g, w, h, strength, frameDt);
    if (kind === 'blackout') this.flicker(g, w, h, strength);
  }

  private rain(g: CanvasRenderingContext2D, w: number, h: number, s: number, dt: number): void {
    const want = Math.floor(220 * s);
    while (this.drops.length < want) {
      this.drops.push({ x: Math.random() * w, y: Math.random() * h, len: 12 + Math.random() * 22, spd: 900 + Math.random() * 700 });
    }
    if (this.drops.length > want) this.drops.length = want;
    g.strokeStyle = `rgba(190,210,235,${0.45 * s})`;
    g.lineWidth = 1.5;
    g.beginPath();
    for (const d of this.drops) {
      d.y += d.spd * dt;
      d.x -= d.spd * 0.18 * dt; // slight slant
      if (d.y > h) {
        d.y = -d.len;
        d.x = Math.random() * w;
      }
      g.moveTo(d.x, d.y);
      g.lineTo(d.x + d.len * 0.18, d.y + d.len);
    }
    g.stroke();
  }

  private flicker(g: CanvasRenderingContext2D, w: number, h: number, s: number): void {
    // Occasional faint generator-light flicker so the blackout feels alive.
    if (Math.random() < 0.04) {
      g.fillStyle = `rgba(255,210,120,${0.06 * s})`;
      g.fillRect(0, 0, w, h);
    }
  }

  /** Optional convenience for callers that key tints off a specific kind. */
  static tintFor(kind: StreetEventKind): string {
    return kind === 'blackout' ? '#04060c' : '#1e2636';
  }

  dispose(): void {
    this.overlay.remove();
  }
}
