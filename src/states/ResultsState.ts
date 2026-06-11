/**
 * Post-run results overlay. M1: minimal stats + retry. Stars, energy, and
 * share cards arrive in M6.
 */
import type { GameState } from '@/core/StateMachine';
import type { GameContext } from '@/core/GameContext';

export interface RunResult {
  success: boolean;
  taka: number;
  bestCombo: number;
  nearMisses: number;
  distance: number;
}

export class ResultsState implements GameState {
  private root: HTMLDivElement | null = null;
  private lastSeed = 1;

  constructor(private ctx: GameContext) {}

  enter(params?: unknown): void {
    const r = (params as RunResult | undefined) ?? {
      success: false,
      taka: 0,
      bestCombo: 0,
      nearMisses: 0,
      distance: 0,
    };
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;background:rgba(20,14,6,.82);color:#fff;font-family:system-ui;gap:10px';
    this.root.innerHTML = `
      <div style="font-size:34px;font-weight:800">${r.success ? '🎉 Reached!' : '💥 Knocked out'}</div>
      <div style="font-size:22px">৳ ${r.taka}</div>
      <div style="opacity:.8">distance ${r.distance} m · best combo x${r.bestCombo} · near-misses ${r.nearMisses}</div>
      <button id="cw-retry" style="margin-top:16px;font-size:20px;padding:12px 36px;border-radius:12px;
        border:none;background:#e8a33d;color:#1a1208;font-weight:800">Walk again</button>
    `;
    document.body.appendChild(this.root);
    this.root.querySelector('#cw-retry')!.addEventListener('click', () => {
      this.lastSeed = (this.lastSeed * 1664525 + 1013904223) >>> 0;
      this.ctx.machine.transition('run', { seed: this.lastSeed });
    });
  }

  exit(): void {
    this.root?.remove();
    this.root = null;
  }

  fixedUpdate(_dt: number): void {}
  render(_alpha: number, _frameDt: number): void {}
}
