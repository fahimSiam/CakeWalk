/**
 * Post-run results: 5-star breakdown, wallet banking, mission rewards,
 * streak, daily leaderboard + ghost, share card, taka doubler (ad),
 * free retry (failed runs) vs new route.
 */
import type { GameState } from '@/core/StateMachine';
import type { GameContext } from '@/core/GameContext';
import type { RunParams } from './RunState';
import { rateRun, type StarBreakdown } from '@/economy/stars';
import { applyRunToMissions, localDateKey, touchStreak, type RunSummary } from '@/meta/progression';

export interface RunResult {
  success: boolean;
  taka: number;
  bestCombo: number;
  nearMisses: number;
  distance: number;
  timeS: number;
  healthFraction: number;
  stolenTotal: number;
  summary: RunSummary;
  runParams: RunParams;
}

export class ResultsState implements GameState {
  private root: HTMLDivElement | null = null;
  private doubled = false;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const r = params as RunResult;
    this.doubled = false;
    const stars = this.bank(r);
    this.build(r, stars);
  }

  /** Persist everything the run earned. */
  private bank(r: RunResult): StarBreakdown | null {
    let stars: StarBreakdown | null = null;
    const areaId = r.runParams.area?.id;
    let missionTaka = 0;
    this.ctx.save.update((save) => {
      save.taka += r.taka;
      missionTaka = applyRunToMissions(save, r.summary);
      save.taka += missionTaka;
      touchStreak(save);
      if (r.runParams.route && areaId && !r.runParams.daily) {
        stars = rateRun(r, r.runParams.route);
        save.stars[areaId] = Math.max(save.stars[areaId] ?? 0, stars.total);
      }
      if (r.runParams.daily) {
        const key = localDateKey();
        const prev = save.dailyResults[key];
        const rating = r.runParams.route ? rateRun(r, r.runParams.route).total : 0;
        if (!prev || r.taka > prev.taka) {
          save.dailyResults[key] = { timeS: Math.round(r.timeS), taka: r.taka, stars: rating };
        }
      }
    });
    void this.ctx.save.flush();
    if (r.runParams.daily && r.success) {
      void this.ctx.services.leaderboard.submit(`daily-${localDateKey()}`, {
        name: 'You',
        score: r.taka,
        date: localDateKey(),
      });
    }
    this.ctx.services.analytics.track('run_finished', {
      success: String(r.success),
      taka: r.taka,
      area: areaId ?? 'graybox',
    });
    return stars;
  }

  private build(r: RunResult, stars: StarBreakdown | null): void {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;background:rgba(20,14,6,.92);color:#fff;font-family:system-ui;gap:10px;padding:20px';
    const starRow = stars
      ? `<div style="font-size:26px;letter-spacing:4px">${'★'.repeat(stars.total)}${'☆'.repeat(5 - stars.total)}</div>
         <div style="font-size:12px;opacity:.75;line-height:1.8;text-align:center">
           ${star(stars.finish, 'Reached B')} · ${star(stars.pace, 'Good pace')} · ${star(stars.health, 'Healthy')}<br>
           ${star(stars.wallet, 'Untouched wallet')} · ${star(stars.streetSmart, 'Street smart')}
         </div>`
      : '';
    this.root.innerHTML = `
      <div style="font-size:32px;font-weight:900">${r.success ? '🏠 Made it!' : '💥 Knocked out'}</div>
      ${starRow}
      <div id="cw-taka" style="font-size:24px;font-weight:800;color:#ffd34a">+৳ ${r.taka}</div>
      <div style="opacity:.8;font-size:13px">${Math.round(r.distance)} m · ${fmtTime(r.timeS)} · best combo x${r.bestCombo} · ${r.nearMisses} near-misses</div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;justify-content:center">
        ${r.success ? '<button class="cw-r-btn" id="cw-double" style="background:#5b9fd6">📺 Double taka</button>' : ''}
        ${!r.success ? '<button class="cw-r-btn" id="cw-retry" style="background:#e8a33d;color:#1a1208">↻ Retry (free)</button>' : ''}
        <button class="cw-r-btn" id="cw-share" style="background:rgba(255,255,255,.15)">📤 Share</button>
        <button class="cw-r-btn" id="cw-home" style="background:rgba(255,255,255,.15)">🏘 Home</button>
      </div>
      <style>.cw-r-btn{font-size:16px;padding:12px 22px;border-radius:12px;border:none;color:#fff;font-weight:800;font-family:inherit}</style>
    `;
    document.body.appendChild(this.root);

    this.root.querySelector('#cw-retry')?.addEventListener('click', () => {
      // Free retry: identical params, no energy spent (idea.md §5).
      this.ctx.machine.transition('run', r.runParams);
    });
    this.root.querySelector('#cw-home')!.addEventListener('click', () => {
      this.ctx.machine.transition('menu');
    });
    this.root.querySelector('#cw-double')?.addEventListener('click', () => {
      if (this.doubled) return;
      void this.ctx.services.ads.showRewarded('taka-doubler').then((ok) => {
        if (ok && !this.doubled) {
          this.doubled = true;
          this.ctx.save.update((d) => (d.taka += r.taka));
          void this.ctx.save.flush();
          const el = this.root?.querySelector('#cw-taka');
          if (el) el.textContent = `+৳ ${r.taka * 2} (doubled!)`;
        }
      });
    });
    this.root.querySelector('#cw-share')!.addEventListener('click', () => void this.share(r, stars));
  }

  /** Render a share card to canvas → native share sheet (or download). */
  private async share(r: RunResult, stars: StarBreakdown | null): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 900;
    const g = canvas.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 900);
    grad.addColorStop(0, '#2a1f12');
    grad.addColorStop(1, '#1a1208');
    g.fillStyle = grad;
    g.fillRect(0, 0, 720, 900);
    g.fillStyle = '#fff';
    g.font = '900 64px system-ui';
    g.fillText('CakeWalk', 60, 120);
    g.fillStyle = '#e8a33d';
    g.font = '700 28px system-ui';
    const where = r.runParams.area ? r.runParams.area.nameEn : 'Dhaka';
    g.fillText(r.runParams.daily ? `Ajker Rasta · ${where}` : where, 60, 170);
    g.fillStyle = '#fff';
    g.font = '900 54px system-ui';
    g.fillText(r.success ? `I survived ${where}` : `${where} ate me alive`, 60, 300);
    g.fillStyle = '#ffd34a';
    g.font = '800 90px system-ui';
    g.fillText(`৳ ${r.taka}`, 60, 430);
    g.fillStyle = '#fff';
    g.font = '500 30px system-ui';
    g.fillText(`${Math.round(r.distance)} m in ${fmtTime(r.timeS)}`, 60, 500);
    g.fillText(`best combo x${r.bestCombo}`, 60, 550);
    if (stars) {
      g.font = '60px system-ui';
      g.fillText('★'.repeat(stars.total) + '☆'.repeat(5 - stars.total), 60, 650);
    }
    g.fillStyle = '#888';
    g.font = '400 22px system-ui';
    g.fillText('Walking against the Eid exodus, one street at a time.', 60, 800);
    g.fillText('Map data © OpenStreetMap contributors', 60, 840);

    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const file = new File([blob], 'cakewalk.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'CakeWalk' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cakewalk.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  fixedUpdate(_dt: number): void {}
  render(_alpha: number, _frameDt: number): void {}
}

function star(earned: boolean, label: string): string {
  return `${earned ? '⭐' : '▫️'} ${label}`;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
