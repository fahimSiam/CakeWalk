/**
 * Game "juice": the moment-to-moment feedback that makes near-misses feel
 * thrilling and a hot streak feel powerful (Subway-Surfers / Temple-Run feel).
 *
 * On every near-miss: a camera kick, a white speed-line flash, a haptic blip,
 * and a bump to the "heat" meter. Sustained near-misses fill heat; when it tops
 * out the player enters FLOW — a brief slow-mo burst, a golden vignette + score
 * doubling, and a banner — the power spike you chase. A knockout gets a red
 * freeze-flash. All visual layers ride a lightweight 2D canvas over the WebGL
 * canvas; slow-mo is driven through the shared loop time-scale.
 */
import type { PerspectiveCamera } from 'three';
import type { EventBus } from '@/core/EventBus';

const FLOW_TIME = 4.2; // seconds a flow-state lasts
const HEAT_PER_MISS = 0.26; // heat added per near-miss (≈4 in a row → flow)
const HEAT_DECAY = 0.34; // heat lost per second when not grazing

export class JuiceFx {
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private flash = 0; // white near-miss flash, decays
  private redFlash = 0; // knockout flash
  private kick = 0; // camera punch amount, decays
  private shake = 0; // camera shake amount, decays
  private slowmo = 0; // seconds of slow-mo remaining
  private heat = 0; // 0..1 combo heat
  private flow = 0; // seconds of flow-state remaining
  private flowPulse = 0; // entry pulse
  private ownsTime = false; // true while we're actively driving slow-mo
  private offs: (() => void)[] = [];

  /** True while flow-state is active (RunScore reads this to double taka). */
  get flowing(): boolean {
    return this.flow > 0;
  }
  /** 0..1 heat for the HUD. */
  get heatLevel(): number {
    return this.heat;
  }

  constructor(
    gameCanvas: HTMLCanvasElement,
    bus: EventBus,
    private setTimeScale: (s: number) => void,
    private haptic: (ms: number) => void = vibrate,
  ) {
    this.overlay = document.createElement('canvas');
    this.overlay.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5';
    gameCanvas.parentElement?.appendChild(this.overlay);
    this.octx = this.overlay.getContext('2d')!;

    this.offs.push(
      bus.on('nearMiss', () => this.onNearMiss()),
      bus.on('comboBroken', () => this.onBreak()),
      bus.on('cakewalkMeterFull', () => this.enterFlow()),
    );
  }

  private onNearMiss(): void {
    this.flash = Math.max(this.flash, 0.8);
    this.kick = Math.max(this.kick, 1);
    this.shake = Math.max(this.shake, 0.4 + this.heat * 0.5);
    this.haptic(12);
    this.heat = Math.min(1, this.heat + HEAT_PER_MISS);
    if (this.heat >= 1 && this.flow <= 0) this.enterFlow();
  }

  private onBreak(): void {
    this.heat = 0;
  }

  /** Cinematic knockout: red freeze-flash + slow-mo + a strong buzz. */
  knockout(): void {
    this.redFlash = 1;
    this.slowmo = Math.max(this.slowmo, 0.5);
    this.haptic(120);
  }

  private enterFlow(): void {
    this.flow = FLOW_TIME;
    this.flowPulse = 1;
    this.slowmo = Math.max(this.slowmo, 0.32);
    this.heat = 1;
    this.haptic(40);
  }

  /** Advance timers + drive slow-mo. Call once per rendered frame. */
  frame(frameDt: number): void {
    // Decay visual layers (use real time so slow-mo doesn't drag the FX out).
    this.flash = decay(this.flash, frameDt * 3.2);
    this.redFlash = decay(this.redFlash, frameDt * 1.3);
    this.kick = decay(this.kick, frameDt * 6);
    this.shake = decay(this.shake, frameDt * 5);
    this.flowPulse = decay(this.flowPulse, frameDt * 2.2);
    if (this.flow > 0) this.flow = Math.max(0, this.flow - frameDt);
    else this.heat = Math.max(0, this.heat - HEAT_DECAY * frameDt);

    // Slow-mo: only WRITE the shared time-scale while we own an active slow-mo,
    // and restore to 1 exactly once when it ends — so we never fight an external
    // pause/freeze (e.g. a minigame overlay or a test) the rest of the time.
    if (this.slowmo > 0) {
      this.slowmo = Math.max(0, this.slowmo - frameDt);
      this.setTimeScale(0.42);
      this.ownsTime = true;
    } else if (this.ownsTime) {
      this.setTimeScale(1);
      this.ownsTime = false;
    }

    this.draw();
  }

  /** Apply the camera punch + shake. Call after the chase cam is positioned. */
  applyCamera(cam: PerspectiveCamera): void {
    if (this.kick <= 0.001 && this.shake <= 0.001 && this.flow <= 0) return;
    const baseFov = 70;
    // Punch in on a graze; widen slightly during flow for a speed rush.
    cam.fov = baseFov - this.kick * 6 - (this.flow > 0 ? 4 : 0);
    cam.updateProjectionMatrix();
    if (this.shake > 0.001) {
      const a = this.shake * 0.06;
      cam.position.x += Math.sin(performance.now() * 0.05) * a;
      cam.position.y += Math.cos(performance.now() * 0.073) * a;
    }
  }

  private draw(): void {
    const w = (this.overlay.width = this.overlay.clientWidth || window.innerWidth);
    const h = (this.overlay.height = this.overlay.clientHeight || window.innerHeight);
    const g = this.octx;
    g.clearRect(0, 0, w, h);

    // Heat / flow edge vignette — cool blue building up, golden in flow.
    const v = this.flow > 0 ? 1 : this.heat;
    if (v > 0.02) {
      const grad = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.72);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      const col = this.flow > 0 ? '255,196,64' : '90,200,255';
      grad.addColorStop(1, `rgba(${col},${0.16 + v * 0.32})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }

    // Near-miss white speed-lines + flash.
    if (this.flash > 0.02) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.22})`;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = `rgba(255,255,255,${this.flash * 0.5})`;
      g.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const e = (i / 9) * Math.PI * 2;
        const r0 = h * 0.32;
        const r1 = h * (0.5 + this.flash * 0.3);
        g.beginPath();
        g.moveTo(w / 2 + Math.cos(e) * r0, h / 2 + Math.sin(e) * r0);
        g.lineTo(w / 2 + Math.cos(e) * r1, h / 2 + Math.sin(e) * r1);
        g.stroke();
      }
    }

    // Flow banner pulse.
    if (this.flowPulse > 0.05) {
      g.save();
      g.globalAlpha = Math.min(1, this.flowPulse);
      g.fillStyle = '#ffd24d';
      g.font = `800 ${Math.round(h * 0.07)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('FLOW! 2×', w / 2, h * 0.3);
      g.restore();
    }

    // Knockout red flash.
    if (this.redFlash > 0.02) {
      g.fillStyle = `rgba(200,40,30,${this.redFlash * 0.4})`;
      g.fillRect(0, 0, w, h);
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.ownsTime) this.setTimeScale(1);
    this.overlay.remove();
  }
}

function decay(v: number, d: number): number {
  return v > d ? v - d : 0;
}

function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
