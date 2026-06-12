/**
 * Service interfaces + local-first adapters (idea.md §8.3).
 *
 * Everything works fully offline today. Post-launch, real adapters slot in
 * behind the same interfaces without touching game code:
 *   IAds         → @capacitor-community/admob rewarded ads
 *   ILeaderboard → Firebase/PlayFab
 *   IAnalytics   → Firebase Analytics / PostHog
 * (See next_steps.md for the wiring guide.)
 */
import type { SaveSystem } from '@/core/SaveSystem';

export interface IAds {
  /** Shows a rewarded ad; resolves true if the reward was earned. */
  showRewarded(placement: string): Promise<boolean>;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  date: string;
}

export interface ILeaderboard {
  submit(board: string, entry: LeaderboardEntry): Promise<void>;
  top(board: string, n: number): Promise<LeaderboardEntry[]>;
}

export interface IAnalytics {
  track(event: string, props?: Record<string, string | number>): void;
}

/**
 * Simulated rewarded ad: a skippable-after-5s fake ad screen. Honest about
 * being a placeholder, and exercises the exact flow real AdMob will use.
 */
export class SimulatedAds implements IAds {
  showRewarded(placement: string): Promise<boolean> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;inset:0;z-index:100;background:#13202e;color:#fff;display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;gap:14px';
      el.innerHTML = `
        <div style="font-size:40px">📺</div>
        <div style="font-weight:800;font-size:20px">Ad break (${placement})</div>
        <div style="opacity:.7;font-size:13px">simulated rewarded ad — real AdMob slots in here</div>
        <button id="cw-ad-done" disabled style="margin-top:10px;font-size:17px;padding:10px 30px;border-radius:10px;border:none;
          background:#555;color:#fff;font-weight:700">5</button>
        <button id="cw-ad-cancel" style="font-size:13px;padding:6px 16px;border-radius:8px;border:none;
          background:rgba(255,255,255,.12);color:#aaa">✕ cancel (no reward)</button>`;
      document.body.appendChild(el);
      const btn = el.querySelector<HTMLButtonElement>('#cw-ad-done')!;
      let left = 5;
      const tick = setInterval(() => {
        left--;
        btn.textContent = left > 0 ? String(left) : 'Collect reward ✓';
        if (left <= 0) {
          clearInterval(tick);
          btn.disabled = false;
          btn.style.background = '#e8a33d';
          btn.style.color = '#1a1208';
        }
      }, 1000);
      btn.addEventListener('click', () => {
        clearInterval(tick);
        el.remove();
        resolve(true);
      });
      el.querySelector('#cw-ad-cancel')!.addEventListener('click', () => {
        clearInterval(tick);
        el.remove();
        resolve(false); // mirrors real AdMob's not-earned callback
      });
    });
  }
}

/** Leaderboards stored in the save blob; same API a server adapter exposes. */
export class LocalLeaderboard implements ILeaderboard {
  constructor(private save: SaveSystem) {}

  async submit(board: string, entry: LeaderboardEntry): Promise<void> {
    this.save.update((d) => {
      const list = (d.leaderboards[board] ??= []);
      list.push(entry);
      list.sort((a, b) => b.score - a.score);
      d.leaderboards[board] = list.slice(0, 20);
    });
    await this.save.flush();
  }

  async top(board: string, n: number): Promise<LeaderboardEntry[]> {
    return (this.save.get().leaderboards[board] ?? []).slice(0, n);
  }
}

export class NoopAnalytics implements IAnalytics {
  track(): void {
    // Intentionally empty: real analytics adapter slots in post-launch.
  }
}

export interface Services {
  ads: IAds;
  leaderboard: ILeaderboard;
  analytics: IAnalytics;
}

export function createLocalServices(save: SaveSystem): Services {
  return {
    ads: new SimulatedAds(),
    leaderboard: new LocalLeaderboard(save),
    analytics: new NoopAnalytics(),
  };
}
