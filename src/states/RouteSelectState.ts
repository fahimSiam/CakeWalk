/**
 * Pre-level route puzzle (idea.md §3.3): canvas-drawn area map with random
 * A→B, up to 4 diverse routes with risk stats. Tap a route, then start.
 */
import type { GameState } from '@/core/StateMachine';
import type { GameContext } from '@/core/GameContext';
import type { BakedArea, Vec2 } from '@/world/levelTypes';
import { RouteGraph, type RouteOption } from '@/routing/RouteGraph';
import { Rng } from '@/core/Rng';
import { loadArea } from '@/world/levelStore';
import { OSM_ATTRIBUTION } from '@/world/levelTypes';

const ROUTE_COLORS = ['#e8a33d', '#5bbf6e', '#5b9fd6', '#c75bb1'];

export interface RouteSelectParams {
  areaId: string;
  seed: number;
}

export class RouteSelectState implements GameState {
  private root: HTMLDivElement | null = null;
  private area: BakedArea | null = null;
  private routes: RouteOption[] = [];
  private selected = 0;
  private endpoints = { a: 0, b: 0 };
  private seed = 1;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const p = (params as RouteSelectParams | undefined) ?? { areaId: 'dhanmondi', seed: 1 };
    this.seed = p.seed;
    void this.load(p);
  }

  private async load(p: RouteSelectParams): Promise<void> {
    this.area = await loadArea(p.areaId);
    const graph = new RouteGraph(this.area);
    const rng = new Rng(p.seed).stream('route');
    this.endpoints = graph.pickEndpoints(rng);
    this.routes = graph.findRoutes(this.endpoints.a, this.endpoints.b);
    this.selected = 0;
    this.buildUi();

    this.ctx.testApi.routeSelect = {
      routes: this.routes,
      start: (i: number) => this.start(i),
    };
  }

  private buildUi(): void {
    const area = this.area!;
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:15;background:#221a10;color:#fff;font-family:system-ui;' +
      'display:flex;flex-direction:column;overflow:hidden';
    this.root.innerHTML = `
      <div style="padding:max(12px,env(safe-area-inset-top)) 16px 4px;display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:22px;font-weight:800">${area.nameEn} <span style="opacity:.7;font-size:15px">${area.nameBn}</span></div>
        <div style="font-size:12px;opacity:.6">${OSM_ATTRIBUTION}</div>
      </div>
      <canvas id="cw-map" style="flex:1;width:100%;touch-action:none"></canvas>
      <div id="cw-cards" style="display:flex;gap:8px;overflow-x:auto;padding:10px 12px max(12px,env(safe-area-inset-bottom))"></div>
    `;
    document.body.appendChild(this.root);
    this.drawCards();
    requestAnimationFrame(() => this.drawMap());
  }

  private drawCards(): void {
    const cards = this.root!.querySelector<HTMLDivElement>('#cw-cards')!;
    cards.innerHTML = '';
    this.routes.forEach((r, i) => {
      const el = document.createElement('button');
      const sel = i === this.selected;
      el.style.cssText =
        `min-width:148px;text-align:left;border-radius:12px;padding:10px 12px;border:2px solid ${sel ? ROUTE_COLORS[i] : 'transparent'};` +
        `background:${sel ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)'};color:#fff;font-family:inherit`;
      el.innerHTML = `
        <div style="font-weight:800;color:${ROUTE_COLORS[i]}">Route ${i + 1} · ${(r.lengthM / 1000).toFixed(1)} km</div>
        <div style="font-size:12px;line-height:1.7;opacity:.9">
          👥 crowd ${bar(r.crowd)}<br>🚌 traffic ${bar(r.traffic)}<br>🕶 pocketmar ${bar(r.pickpocket)}<br>
          ☕ cha ${r.chaDokan} · 🛣 crossings ${r.crossings}
        </div>
        ${sel ? '<div style="margin-top:6px;font-weight:800;background:#e8a33d;color:#1a1208;border-radius:8px;text-align:center;padding:6px">START ➜</div>' : ''}
      `;
      el.addEventListener('click', () => {
        if (this.selected === i) this.start(i);
        else {
          this.selected = i;
          this.drawCards();
          this.drawMap();
        }
      });
      cards.appendChild(el);
    });
  }

  private drawMap(): void {
    const area = this.area!;
    const canvas = this.root!.querySelector<HTMLCanvasElement>('#cw-map')!;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    const g = canvas.getContext('2d')!;
    g.scale(devicePixelRatio, devicePixelRatio);

    const [minX, minZ, maxX, maxZ] = area.bbox;
    const pad = 16;
    const scale = Math.min(
      (rect.width - pad * 2) / (maxX - minX),
      (rect.height - pad * 2) / (maxZ - minZ),
    );
    const ox = (rect.width - (maxX - minX) * scale) / 2;
    const oz = (rect.height - (maxZ - minZ) * scale) / 2;
    const X = (p: Vec2): number => ox + (p[0] - minX) * scale;
    const Y = (p: Vec2): number => oz + (p[1] - minZ) * scale;

    g.fillStyle = '#2b2317';
    g.fillRect(0, 0, rect.width, rect.height);

    const poly = (pts: Vec2[], close: boolean): void => {
      g.beginPath();
      g.moveTo(X(pts[0]!), Y(pts[0]!));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i]!), Y(pts[i]!));
      if (close) g.closePath();
    };

    for (const w of area.water) {
      poly(w, true);
      g.fillStyle = '#39576b';
      g.fill();
    }
    for (const p of area.parks) {
      poly(p, true);
      g.fillStyle = '#41523a';
      g.fill();
    }
    for (const road of area.roads) {
      if (road.pts.length < 2) continue;
      poly(road.pts, false);
      g.strokeStyle = road.class === 'major' ? '#6d6759' : '#4a443a';
      g.lineWidth = road.class === 'major' ? 3 : 1.2;
      g.stroke();
    }
    // Landmarks labels (a few, real names).
    g.fillStyle = '#cbbd9d';
    g.font = '10px system-ui';
    let labels = 0;
    for (const poi of area.pois) {
      if (poi.kind === 'landmark' && poi.name && labels < 8) {
        g.fillText(poi.name, X(poi.pos) + 4, Y(poi.pos));
        g.fillRect(X(poi.pos) - 1.5, Y(poi.pos) - 1.5, 3, 3);
        labels++;
      }
    }
    // Routes (unselected dim, selected bright).
    this.routes.forEach((r, i) => {
      if (i === this.selected) return;
      poly(r.pts, false);
      g.strokeStyle = ROUTE_COLORS[i] + '55';
      g.lineWidth = 2.5;
      g.stroke();
    });
    const sel = this.routes[this.selected];
    if (sel) {
      poly(sel.pts, false);
      g.strokeStyle = ROUTE_COLORS[this.selected]!;
      g.lineWidth = 4;
      g.stroke();
    }
    // A/B markers.
    const a = area.graph.nodes[this.endpoints.a]!.pos;
    const b = area.graph.nodes[this.endpoints.b]!.pos;
    for (const [p, label, color] of [
      [a, 'A', '#5bbf6e'],
      [b, 'B', '#e05c4a'],
    ] as const) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(X(p), Y(p), 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 11px system-ui';
      g.textAlign = 'center';
      g.fillText(label, X(p), Y(p) + 4);
      g.textAlign = 'left';
    }
  }

  private start(i: number): void {
    const route = this.routes[i];
    if (!route || !this.area) return;
    this.ctx.machine.transition('run', {
      seed: this.seed,
      area: this.area,
      route,
    });
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
    delete this.ctx.testApi.routeSelect;
  }

  fixedUpdate(_dt: number): void {}
  render(_alpha: number, _frameDt: number): void {}
}

function bar(v: number): string {
  return '▰'.repeat(Math.max(1, Math.min(5, v))) + '▱'.repeat(5 - Math.max(1, Math.min(5, v)));
}
