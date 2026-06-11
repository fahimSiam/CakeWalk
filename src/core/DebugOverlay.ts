/**
 * Dev overlay: FPS, sim tick time, draw calls, agent count. Toggled with
 * backtick or ?debug=1. Also exposes the window.__cakewalk test hook used
 * by Playwright for deterministic input injection and tick stepping.
 */
import type { WebGLRenderer } from 'three';

export class DebugOverlay {
  private el: HTMLDivElement;
  private frames = 0;
  private fps = 0;
  private lastFpsTime = 0;
  simMs = 0;
  agentCount = 0;
  visible: boolean;

  constructor(private renderer: WebGLRenderer) {
    this.visible = new URLSearchParams(location.search).has('debug');
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;top:4px;left:4px;z-index:9999;color:#0f0;background:rgba(0,0,0,.6);' +
      'font:11px monospace;padding:4px 6px;border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(this.el);
    this.el.style.display = this.visible ? 'block' : 'none';
    window.addEventListener('keydown', (e) => {
      if (e.key === '`') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  frame(now: number): void {
    this.frames++;
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.lastFpsTime = now;
      if (this.visible) {
        const info = this.renderer.info;
        this.el.textContent =
          `fps ${this.fps}  sim ${this.simMs.toFixed(2)}ms\n` +
          `draws ${info.render.calls}  tris ${info.render.triangles}\n` +
          `agents ${this.agentCount}  mem ${memMb()}`;
      }
    }
  }
}

function memMb(): string {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? `${(m.usedJSHeapSize / 1048576).toFixed(0)}MB` : 'n/a';
}
