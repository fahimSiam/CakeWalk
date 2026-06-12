/**
 * In-run HUD: health/stamina bars, taka, combo, Cakewalk meter, and the
 * touch buttons (stare 👀, phone 🗺). DOM overlay — cheap, crisp on any DPI,
 * and trivially localizable.
 */
import type { InputSystem } from '@/player/Input';

export class Hud {
  private root: HTMLDivElement;
  private healthFill!: HTMLDivElement;
  private staminaFill!: HTMLDivElement;
  private meterFill!: HTMLDivElement;
  private takaEl!: HTMLDivElement;
  private comboEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private toastTimer = 0;

  constructor(input: InputSystem) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;';
    this.root.innerHTML = `
      <style>
        .cw-bars{position:absolute;top:max(10px,env(safe-area-inset-top));left:12px;width:38vw;max-width:220px}
        .cw-bar{height:10px;border-radius:5px;background:rgba(0,0,0,.45);margin-bottom:6px;overflow:hidden}
        .cw-bar>div{height:100%;border-radius:5px;transition:width .15s}
        .cw-health>div{background:#e05c4a}
        .cw-stamina>div{background:#e8c34a}
        .cw-meter{height:6px}.cw-meter>div{background:#7ad0ff}
        .cw-taka{position:absolute;top:max(10px,env(safe-area-inset-top));right:12px;color:#fff;
          font:700 20px system-ui;text-shadow:0 1px 3px #000}
        .cw-combo{position:absolute;top:calc(max(10px,env(safe-area-inset-top)) + 28px);right:12px;
          color:#ffd34a;font:700 16px system-ui;text-shadow:0 1px 3px #000}
        .cw-toast{position:absolute;top:22%;left:50%;transform:translateX(-50%);color:#fff;
          font:700 18px system-ui;text-shadow:0 2px 4px #000;opacity:0;transition:opacity .2s;
          text-align:center;white-space:nowrap}
        .cw-btn{position:absolute;width:58px;height:58px;border-radius:50%;border:none;
          background:rgba(0,0,0,.5);color:#fff;font-size:26px;pointer-events:auto;
          display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
        .cw-btn:active{background:rgba(255,255,255,.25)}
        .cw-btn-stare{right:14px;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 76px)}
        .cw-btn-phone{right:14px;top:calc(max(10px,env(safe-area-inset-top)) + 64px)}
        .cw-btn-sit{left:14px;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 76px);display:none}
        .cw-btn-bridge{left:50%;transform:translateX(-50%);bottom:calc(max(14px,env(safe-area-inset-bottom)) + 76px);
          width:auto;border-radius:14px;padding:0 18px;font-size:15px;font-weight:800;display:none}
        .cw-crossing{position:absolute;top:34%;left:50%;transform:translateX(-50%);color:#ffd34a;
          font:800 17px system-ui;text-shadow:0 2px 4px #000;display:none;text-align:center}
      </style>
      <div class="cw-bars">
        <div class="cw-bar cw-health"><div></div></div>
        <div class="cw-bar cw-stamina"><div></div></div>
        <div class="cw-bar cw-meter"><div></div></div>
      </div>
      <div class="cw-taka">৳ 0</div>
      <div class="cw-combo"></div>
      <div class="cw-toast"></div>
      <button class="cw-btn cw-btn-stare">👀</button>
      <button class="cw-btn cw-btn-phone">🗺️</button>
      <button class="cw-btn cw-btn-sit">🪑</button>
      <button class="cw-btn cw-btn-bridge">🌉 overbridge</button>
      <div class="cw-crossing">⚠️ CROSSING — time the gap!<br><span style="font-size:13px;opacity:.85">or take the overbridge (safe, no bonus)</span></div>
    `;
    document.body.appendChild(this.root);
    this.healthFill = this.root.querySelector('.cw-health>div')!;
    this.staminaFill = this.root.querySelector('.cw-stamina>div')!;
    this.meterFill = this.root.querySelector('.cw-meter>div')!;
    this.takaEl = this.root.querySelector('.cw-taka')!;
    this.comboEl = this.root.querySelector('.cw-combo')!;
    this.toastEl = this.root.querySelector('.cw-toast')!;

    const bind = (selector: string, fn: () => void): HTMLButtonElement => {
      const el = this.root.querySelector<HTMLButtonElement>(selector)!;
      el.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        fn();
      });
      el.addEventListener('click', fn);
      return el;
    };
    bind('.cw-btn-stare', () => input.pressStare());
    bind('.cw-btn-phone', () => input.pressPhone());
    this.sitBtn = bind('.cw-btn-sit', () => input.pressSit());
    this.bridgeBtn = bind('.cw-btn-bridge', () => input.pressOverbridge());
    this.crossingEl = this.root.querySelector('.cw-crossing')!;
  }

  private sitBtn!: HTMLButtonElement;
  private bridgeBtn!: HTMLButtonElement;
  private crossingEl!: HTMLDivElement;
  private crossingShown = false;

  /** Contextual prompts: bench in range / inside a crossing zone. */
  setContext(nearRest: boolean, resting: boolean, inCrossing: boolean): void {
    this.sitBtn.style.display = nearRest || resting ? 'flex' : 'none';
    this.sitBtn.textContent = resting ? '🚶' : '🪑';
    this.bridgeBtn.style.display = inCrossing ? 'flex' : 'none';
    if (inCrossing !== this.crossingShown) {
      this.crossingShown = inCrossing;
      this.crossingEl.style.display = inCrossing ? 'block' : 'none';
    }
  }

  set(health: number, stamina: number, meter: number, taka: number, combo: number): void {
    this.healthFill.style.width = `${health}%`;
    this.staminaFill.style.width = `${stamina}%`;
    this.meterFill.style.width = `${meter * 100}%`;
    this.takaEl.textContent = `৳ ${taka}`;
    this.comboEl.textContent = combo > 1 ? `x${combo} combo` : '';
  }

  toast(msg: string, frameDt: number): void {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    this.toastTimer = 1.4;
    void frameDt;
  }

  update(frameDt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= frameDt;
      if (this.toastTimer <= 0) this.toastEl.style.opacity = '0';
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
