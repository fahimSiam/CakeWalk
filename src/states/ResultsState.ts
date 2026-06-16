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
    this.ctx.audio.jingle(r.success);
    this.build(r, stars);
  }

  /** Persist everything the run earned. */
  private bank(r: RunResult): StarBreakdown | null {
    let stars: StarBreakdown | null = null;
    const areaId = r.runParams.area?.id;
    this.ctx.save.update((save) => {
      // Failed runs keep only a quarter of the taka and no mission progress —
      // otherwise die-on-purpose + free retry farms the economy infinitely.
      save.taka += r.success ? r.taka : Math.floor(r.taka * 0.25);
      if (r.success) save.taka += applyRunToMissions(save, r.summary);
      touchStreak(save);
      save.recentRuns.unshift({
        date: localDateKey(),
        area: areaId ?? 'graybox',
        taka: r.taka,
        stars: 0, // patched below once rated
        success: r.success,
        distance: Math.round(r.distance),
      });
      save.recentRuns = save.recentRuns.slice(0, 10);
      // Tutorial runs are unrated (idea.md §4 ruling).
      if (r.runParams.route && areaId && !r.runParams.daily && !r.runParams.tutorial) {
        stars = rateRun(r, r.runParams.route);
        save.stars[areaId] = Math.max(save.stars[areaId] ?? 0, stars.total);
        if (save.recentRuns[0]) save.recentRuns[0].stars = stars.total;
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
        ${!r.success && !r.runParams.daily ? '<button class="cw-r-btn" id="cw-retry" style="background:#e8a33d;color:#1a1208">↻ Retry (free)</button>' : ''}
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

  /** Render an eye-catching recap card → native share sheet (or download). The
   *  headline + hero stat are keyed to what stood out, so every share brags
   *  about something different. */
  private async share(r: RunResult, stars: StarBreakdown | null): Promise<void> {
    const W = 720;
    const H = 1100;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const where = r.runParams.area ? r.runParams.area.nameEn : 'Dhaka';

    // Background: success blue / fail red into warm dark, with faint footpath
    // candy-lane stripes along the bottom (the game's motif).
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, r.success ? '#23407a' : '#5a1f1f');
    grad.addColorStop(0.55, '#241a0e');
    grad.addColorStop(1, '#140d06');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = ['#d98c6a18', '#e0b65c18', '#7fb09a18', '#6f9cc018'][i]!;
      g.fillRect(40 + i * 165, H - 240, 150, 240);
    }

    g.fillStyle = '#ffd34a';
    g.font = '900 70px system-ui';
    g.fillText('CakeWalk', 56, 110);
    g.fillStyle = '#ffffffcc';
    g.font = '700 30px system-ui';
    g.fillText(r.runParams.daily ? `🗓 Ajker Rasta · ${where}` : `📍 ${where}`, 58, 158);

    g.fillStyle = '#fff';
    g.font = '900 58px system-ui';
    wrapText(g, this.headline(r), 56, 268, W - 100, 66);

    // Hero stat: the dodge count (the thrill people brag about).
    g.fillStyle = '#7ad0ff';
    g.font = '900 150px system-ui';
    g.fillText(`${r.nearMisses}`, 52, 580);
    g.fillStyle = '#ffffffcc';
    g.font = '700 34px system-ui';
    g.fillText('near-misses dodged', 60, 628);

    const stat = (x: number, y: number, val: string, label: string, col = '#ffd34a'): void => {
      g.fillStyle = col;
      g.font = '900 50px system-ui';
      g.fillText(val, x, y);
      g.fillStyle = '#ffffffaa';
      g.font = '600 25px system-ui';
      g.fillText(label, x, y + 36);
    };
    stat(56, 740, `৳${r.taka}`, 'taka earned');
    stat(400, 740, `x${r.bestCombo}`, 'best combo', '#ff8a5b');
    stat(56, 858, `${Math.round(r.distance)} m`, fmtTime(r.timeS), '#7fb09a');
    if (r.summary.spotted > 0) stat(400, 858, `${r.summary.spotted}`, 'pocketmars foiled', '#ff6f9e');

    if (stars) {
      g.font = '60px system-ui';
      g.fillText('★'.repeat(stars.total) + '☆'.repeat(5 - stars.total), 56, 968);
    }

    g.fillStyle = '#ffffff66';
    g.font = '400 24px system-ui';
    g.fillText('Walk home against the Eid exodus. Can you beat me?', 56, H - 78);
    g.fillText('Map data © OpenStreetMap contributors', 56, H - 42);

    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const file = new File([blob], 'cakewalk.png', { type: 'image/png' });
    const text = `I dodged ${r.nearMisses} near-misses walking home through ${where} in CakeWalk — ৳${r.taka}, combo x${r.bestCombo}. Beat that!`;
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'CakeWalk', text });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cakewalk.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  /** Brag headline from whatever was most impressive this run. */
  private headline(r: RunResult): string {
    const where = r.runParams.area ? r.runParams.area.nameEn : 'Dhaka';
    if (!r.success) return `${where} ate me alive 💀`;
    if (r.bestCombo >= 15) return `Untouchable through ${where} 🔥`;
    if (r.summary.spotted >= 3) return `Foiled ${r.summary.spotted} pocketmars 🕶`;
    if (r.healthFraction >= 0.99) return `Not a scratch in ${where} ✨`;
    if (r.nearMisses >= 20) return `Threaded ${r.nearMisses} near-misses 😮‍💨`;
    return `Made it home through ${where} 🏠`;
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

/** Word-wrap canvas text to a max width, drawing each line `lh` apart. */
function wrapText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lh: number,
): void {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) g.fillText(line, x, yy);
}
