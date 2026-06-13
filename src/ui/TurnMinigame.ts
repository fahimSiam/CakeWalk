/**
 * The junction "which way?" quick-tap minigame (idea.md Rev 8).
 *
 * Pops at a real intersection: shows the available roads as left / straight /
 * right buttons, each tagged with a landmark a little way down it. Tap (or
 * arrow keys) within the timer. Picking the road your planned route takes keeps
 * you efficient (small bonus); picking another road sends you that way and the
 * route re-plans. Timing out keeps you on the plan — forgiving, but you lose
 * the on-time bonus. Navigate by the buildings you memorised.
 */
import type { TurnBranch, TurnDir } from '@/world/Navigator';

const DECIDE_TIME = 3.6; // seconds to choose

const ARROW: Record<TurnDir, string> = { left: '⬅️', straight: '⬆️', right: '➡️' };
const LABEL: Record<TurnDir, string> = { left: 'LEFT', straight: 'STRAIGHT', right: 'RIGHT' };

export interface TurnResult {
  branch: TurnBranch;
  onTime: boolean;
}

export class TurnMinigame {
  private root: HTMLDivElement | null = null;
  private resolveFn: ((r: TurnResult) => void) | null = null;
  private branches: TurnBranch[] = [];
  private timer = 0;
  private raf = 0;
  private last = 0;
  private barEl: HTMLDivElement | null = null;
  private done = false;

  get active(): boolean {
    return this.root !== null;
  }

  open(branches: TurnBranch[], accent: string): Promise<TurnResult> {
    this.branches = branches;
    this.timer = DECIDE_TIME;
    this.done = false;

    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:24;background:rgba(16,11,5,.82);display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:18px;' +
      'font-family:system-ui;color:#fff;-webkit-tap-highlight-color:transparent';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:900;font-size:24px;text-shadow:0 2px 6px #000';
    title.textContent = '🧭 Which way?';
    this.root.appendChild(title);

    const bar = document.createElement('div');
    bar.style.cssText =
      'width:min(70vw,260px);height:9px;border-radius:5px;background:rgba(255,255,255,.18);overflow:hidden';
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:100%;background:${accent};border-radius:5px`;
    bar.appendChild(fill);
    this.barEl = fill;
    this.root.appendChild(bar);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;align-items:stretch;justify-content:center;flex-wrap:wrap;max-width:94vw';
    for (const b of branches) {
      const btn = document.createElement('button');
      btn.style.cssText =
        'pointer-events:auto;min-width:96px;max-width:140px;padding:16px 14px;border:none;border-radius:18px;' +
        'background:#27201a;color:#fff;display:flex;flex-direction:column;align-items:center;gap:8px;' +
        'font-family:inherit;box-shadow:0 6px 18px rgba(0,0,0,.4);border:2px solid rgba(255,255,255,.08)';
      btn.innerHTML =
        `<div style="font-size:40px;line-height:1">${ARROW[b.dir]}</div>` +
        `<div style="font-weight:800;font-size:13px;letter-spacing:.5px">${LABEL[b.dir]}</div>` +
        (b.landmark
          ? `<div style="font-size:12px;opacity:.78;text-align:center;line-height:1.2">${escapeHtml(b.landmark)}</div>`
          : '');
      const pick = (e: Event): void => {
        e.preventDefault();
        this.finish(b, true);
      };
      btn.addEventListener('touchstart', pick, { passive: false });
      btn.addEventListener('click', pick);
      row.appendChild(btn);
    }
    this.root.appendChild(row);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:12px;color:#b7ab97';
    hint.textContent = 'tap a road · ⬅️ ⬆️ ➡️ keys · check the 🗺️ if lost';
    this.root.appendChild(hint);

    document.body.appendChild(this.root);
    window.addEventListener('keydown', this.onKey);

    this.last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.timer -= dt;
      if (this.barEl) this.barEl.style.width = `${Math.max(0, this.timer / DECIDE_TIME) * 100}%`;
      if (this.timer <= 0) {
        // Out of time: stay on the planned route, no bonus.
        const marked = this.branches.find((b) => b.marked) ?? this.branches[0]!;
        this.finish(marked, false);
      }
    };
    this.raf = requestAnimationFrame(loop);

    return new Promise((res) => (this.resolveFn = res));
  }

  private onKey = (e: KeyboardEvent): void => {
    const byDir: Partial<Record<string, TurnDir>> = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowUp: 'straight', KeyW: 'straight',
      ArrowRight: 'right', KeyD: 'right',
    };
    const dir = byDir[e.code];
    if (!dir) return;
    const b = this.branches.find((x) => x.dir === dir);
    if (b) {
      e.preventDefault();
      this.finish(b, true);
    }
  };

  private finish(branch: TurnBranch, onTime: boolean): void {
    if (this.done) return;
    this.done = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.root?.remove();
    this.root = null;
    this.barEl = null;
    this.resolveFn?.({ branch, onTime });
    this.resolveFn = null;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.root?.remove();
    this.root = null;
    this.resolveFn = null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
