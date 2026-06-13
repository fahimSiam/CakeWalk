/**
 * Pre-level route puzzle (idea.md §3.3 + Rev 8): a fullscreen, swipeable
 * carousel of the diverse A→B routes. Each route shows the area map with that
 * route highlighted, its risk stats, and — the new part — a turn-by-turn
 * preview: the direction + landmark building name at every junction where you
 * change roads, so you can MEMORISE the route before you set off (the in-run
 * turn minigame then quizzes you on it). Swipe left/right between routes; tap
 * START to walk it.
 */
import type { GameState } from '@/core/StateMachine';
import type { GameContext } from '@/core/GameContext';
import type { BakedArea, Vec2 } from '@/world/levelTypes';
import { RouteGraph, type RouteOption } from '@/routing/RouteGraph';
import { Navigator, type TurnDir } from '@/world/Navigator';
import { SplineCorridor } from '@/world/SplineCorridor';
import { Rng } from '@/core/Rng';
import { loadArea } from '@/world/levelStore';
import { OSM_ATTRIBUTION } from '@/world/levelTypes';
import { spendEnergy } from '@/meta/Energy';

const ROUTE_COLORS = ['#e8a33d', '#5bbf6e', '#5b9fd6', '#c75bb1'];
const ARROW: Record<TurnDir, string> = { left: '⬅️', straight: '⬆️', right: '➡️' };

interface TurnInfo {
  dir: TurnDir;
  landmark?: string;
  pos: Vec2;
}

export interface RouteSelectParams {
  areaId: string;
  seed: number;
  daily?: boolean;
}

export class RouteSelectState implements GameState {
  private root: HTMLDivElement | null = null;
  private area: BakedArea | null = null;
  private routes: RouteOption[] = [];
  private turnsByRoute: TurnInfo[][] = [];
  private selected = 0;
  private endpoints = { a: 0, b: 0 };
  private seed = 1;
  private daily = false;
  private generation = 0;
  private touchX: number | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const p = (params as RouteSelectParams | undefined) ?? { areaId: 'dhanmondi', seed: 1 };
    this.seed = p.seed;
    this.daily = p.daily ?? false;
    void this.load(p, ++this.generation);
  }

  private async load(p: RouteSelectParams, generation: number): Promise<void> {
    const area = await loadArea(p.areaId);
    if (generation !== this.generation) return; // state exited while loading
    this.area = area;
    const graph = new RouteGraph(area);
    const rng = new Rng(p.seed).stream('route');
    this.endpoints = graph.pickEndpoints(rng);
    this.routes = graph.findRoutes(this.endpoints.a, this.endpoints.b);
    this.selected = 0;
    // Turn-by-turn preview per route (junction direction + landmark).
    this.turnsByRoute = this.routes.map((route) => {
      const projector = new SplineCorridor(route.pts);
      const nav = new Navigator(area, graph, route, projector, projector.length - 5);
      return nav.decisionPoints.map((dp) => {
        const marked = dp.branches.find((b) => b.marked) ?? dp.branches[0]!;
        const info: TurnInfo = { dir: marked.dir, pos: area.graph.nodes[dp.node]!.pos };
        if (marked.landmark) info.landmark = marked.landmark;
        return info;
      });
    });
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
      'display:flex;flex-direction:column;overflow:hidden;touch-action:pan-y';
    this.root.innerHTML = `
      <div style="padding:max(12px,env(safe-area-inset-top)) 16px 4px;display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:22px;font-weight:800">${area.nameEn} <span style="opacity:.7;font-size:15px">${area.nameBn}</span></div>
        <div style="font-size:11px;opacity:.55">${OSM_ATTRIBUTION}</div>
      </div>
      <canvas id="cw-map" style="flex:1;width:100%;touch-action:none"></canvas>
      <div id="cw-panel"></div>
    `;
    document.body.appendChild(this.root);

    // Swipe between routes (touch) + arrow keys.
    this.root.addEventListener('touchstart', this.onTouchStart, { passive: true });
    this.root.addEventListener('touchend', this.onTouchEnd, { passive: true });
    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.code === 'ArrowLeft') this.selectRoute(this.selected - 1);
      else if (e.code === 'ArrowRight') this.selectRoute(this.selected + 1);
      else if (e.code === 'Enter') this.start(this.selected);
    };
    window.addEventListener('keydown', this.keyHandler);

    this.buildPanel();
    requestAnimationFrame(() => this.drawMap());
  }

  private onTouchStart = (e: TouchEvent): void => {
    this.touchX = e.changedTouches[0]!.clientX;
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (this.touchX === null) return;
    const dx = e.changedTouches[0]!.clientX - this.touchX;
    this.touchX = null;
    if (Math.abs(dx) > 50) this.selectRoute(this.selected + (dx < 0 ? 1 : -1));
  };

  private selectRoute(i: number): void {
    const n = this.routes.length;
    const next = ((i % n) + n) % n; // wrap
    if (next === this.selected) return;
    this.selected = next;
    this.buildPanel();
    this.drawMap();
  }

  private buildPanel(): void {
    const panel = this.root!.querySelector<HTMLDivElement>('#cw-panel')!;
    const r = this.routes[this.selected];
    const color = ROUTE_COLORS[this.selected]!;
    if (!r) {
      panel.innerHTML = '<div style="padding:16px">No route.</div>';
      return;
    }
    const turns = this.turnsByRoute[this.selected] ?? [];
    const chips = turns.length
      ? turns
          .map(
            (t, k) =>
              `<span style="display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.08);` +
              `border-radius:999px;padding:5px 11px;font-size:13px;white-space:nowrap">` +
              `<b style="color:${color}">${k + 1}</b> ${ARROW[t.dir]} ${escapeHtml(t.landmark ?? t.dir)}</span>`,
          )
          .join('')
      : '<span style="opacity:.6;font-size:13px">Straight through — no turns to remember 🎉</span>';
    const dots = this.routes
      .map(
        (_, i) =>
          `<span data-dot="${i}" style="width:9px;height:9px;border-radius:50%;cursor:pointer;` +
          `background:${i === this.selected ? color : 'rgba(255,255,255,.28)'}"></span>`,
      )
      .join('');
    panel.style.cssText =
      'padding:10px 14px max(12px,env(safe-area-inset-bottom));background:rgba(0,0,0,.25);' +
      'display:flex;flex-direction:column;gap:9px';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800;font-size:17px;color:${color}">Route ${this.selected + 1} · ${(r.lengthM / 1000).toFixed(1)} km</div>
        <div style="font-size:12px;opacity:.85">👥${r.crowd} 🚌${r.traffic} 🕶${r.pickpocket} ☕${r.chaDokan} 🛣${r.crossings}</div>
      </div>
      <div style="display:flex;align-items:center;gap:7px">
        <span style="font-size:13px;opacity:.8;white-space:nowrap">🧭 turns</span>
        <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px">${chips}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;gap:7px;align-items:center">${dots}<span style="font-size:11px;opacity:.5;margin-left:4px">swipe ‹ ›</span></div>
        <button id="cw-start" style="border:none;border-radius:11px;padding:11px 26px;font-weight:900;font-size:16px;
          background:${color};color:#1a1208;font-family:inherit">START ➜</button>
      </div>
    `;
    panel.querySelector('#cw-start')!.addEventListener('click', () => this.start(this.selected));
    panel.querySelectorAll<HTMLSpanElement>('[data-dot]').forEach((d) => {
      d.addEventListener('click', () => this.selectRoute(Number(d.dataset.dot)));
    });
  }

  private drawMap(): void {
    const area = this.area!;
    const canvas = this.root!.querySelector<HTMLCanvasElement>('#cw-map')!;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    const g = canvas.getContext('2d')!;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

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
    // Other routes dim.
    this.routes.forEach((r, i) => {
      if (i === this.selected) return;
      poly(r.pts, false);
      g.strokeStyle = ROUTE_COLORS[i] + '44';
      g.lineWidth = 2.5;
      g.stroke();
    });
    // Selected route bright.
    const sel = this.routes[this.selected];
    const color = ROUTE_COLORS[this.selected]!;
    if (sel) {
      poly(sel.pts, false);
      g.strokeStyle = color;
      g.lineWidth = 4;
      g.stroke();
    }
    // A/B markers.
    const a = area.graph.nodes[this.endpoints.a]!.pos;
    const b = area.graph.nodes[this.endpoints.b]!.pos;
    for (const [p, label, c] of [
      [a, 'A', '#5bbf6e'],
      [b, 'B', '#e05c4a'],
    ] as const) {
      g.fillStyle = c;
      g.beginPath();
      g.arc(X(p), Y(p), 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 11px system-ui';
      g.textAlign = 'center';
      g.fillText(label, X(p), Y(p) + 4);
      g.textAlign = 'left';
    }
    // Numbered turn markers + landmark labels for the selected route.
    const turns = this.turnsByRoute[this.selected] ?? [];
    turns.forEach((t, k) => {
      const x = X(t.pos);
      const y = Y(t.pos);
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a1208';
      g.font = 'bold 11px system-ui';
      g.textAlign = 'center';
      g.fillText(String(k + 1), x, y + 4);
      g.textAlign = 'left';
      if (t.landmark) {
        g.font = '10px system-ui';
        const label = `${ARROW[t.dir]} ${t.landmark}`;
        const w = g.measureText(label).width;
        g.fillStyle = 'rgba(20,14,8,.8)';
        g.fillRect(x + 10, y - 8, w + 8, 15);
        g.fillStyle = '#f3e6c8';
        g.fillText(label, x + 14, y + 3);
      }
    });
  }

  private start(i: number): void {
    const route = this.routes[i];
    if (!route || !this.area) return;
    if (!this.daily) {
      let ok = false;
      this.ctx.save.update((d) => (ok = spendEnergy(d)));
      void this.ctx.save.flush();
      if (!ok) {
        this.ctx.machine.transition('menu');
        return;
      }
    }
    this.ctx.machine.transition('run', {
      seed: this.seed,
      area: this.area,
      route,
      daily: this.daily,
    });
  }

  exit(): void {
    this.generation++;
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.root?.remove();
    this.root = null;
    delete this.ctx.testApi.routeSelect;
  }

  fixedUpdate(_dt: number): void {}
  render(_alpha: number, _frameDt: number): void {}
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
