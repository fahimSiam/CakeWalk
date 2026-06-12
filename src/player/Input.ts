/**
 * Input → intent. Touch layout per idea.md §2.1:
 *   left half drag        = analog lateral drift
 *   right half hold       = sprint, drag-down-hold = shuffle
 *   right half tap        = jump (disambiguated from hold at ~150 ms)
 *   right half flick up/dn= shoulder raise/drop (both held = full duck)
 * Desktop dev keys: A/D drift, W sprint, S shuffle, Space jump,
 *   Q/E shoulder dips (Q+E duck), F stare, M phone.
 *
 * The sim only ever reads the immutable `InputIntent` produced once per tick,
 * which keeps the simulation deterministic and lets tests inject intents.
 */

export interface InputIntent {
  /** Lateral axis -1 (left) .. 1 (right). Analog. */
  lateral: number;
  /** -1 shuffle, 0 normal walk, 1 sprint. */
  speed: -1 | 0 | 1;
  jump: boolean; // edge-triggered
  shoulderLeft: boolean; // held
  shoulderRight: boolean; // held
  stare: boolean; // edge-triggered
  phone: boolean; // edge-triggered (toggle)
  sandWatch: boolean; // edge-triggered
  sit: boolean; // edge-triggered (context: near bench/cha dokan)
  overbridge: boolean; // edge-triggered (context: at a crossing)
}

const TAP_MS = 150;
const FLICK_PX_PER_MS = 0.45;
const DRAG_DOWN_PX = 36;

interface TouchTrack {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  side: 'left' | 'right';
  /** Right-side hold that survived tap window without flicking. */
  holdActive: boolean;
}

export class InputSystem {
  private keys = new Set<string>();
  private edges = {
    jump: false,
    stare: false,
    phone: false,
    sandWatch: false,
    sit: false,
    overbridge: false,
  };
  private touches = new Map<number, TouchTrack>();
  private lateralTouch = 0;
  private rightHold: TouchTrack | null = null;
  private shoulderTouch = { left: false, right: false };
  private shoulderTouchTimer = 0;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('touchstart', this.onTouchStart, { passive: false });
    el.addEventListener('touchmove', this.onTouchMove, { passive: false });
    el.addEventListener('touchend', this.onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.removeEventListener('touchstart', this.onTouchStart);
    this.el.removeEventListener('touchmove', this.onTouchMove);
    this.el.removeEventListener('touchend', this.onTouchEnd);
    this.el.removeEventListener('touchcancel', this.onTouchEnd);
  }

  /** HUD buttons call these (stare/phone/sand watch/sit live in the HUD). */
  pressStare(): void {
    this.edges.stare = true;
  }
  pressPhone(): void {
    this.edges.phone = true;
  }
  pressSandWatch(): void {
    this.edges.sandWatch = true;
  }
  pressSit(): void {
    this.edges.sit = true;
  }
  pressOverbridge(): void {
    this.edges.overbridge = true;
  }
  /** Test hook: inject a full intent for the next poll. */
  injected: Partial<InputIntent> | null = null;

  /** Called once per sim tick. Consumes edge-triggered inputs. */
  poll(dt: number): InputIntent {
    if (this.shoulderTouchTimer > 0) {
      this.shoulderTouchTimer -= dt;
      if (this.shoulderTouchTimer <= 0) this.shoulderTouch = { left: false, right: false };
    }

    const k = this.keys;
    const lateralKeys = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const speed: -1 | 0 | 1 =
      k.has('KeyW') || this.rightHold?.holdActive
        ? this.rightHold && this.isDragDown(this.rightHold)
          ? -1
          : 1
        : k.has('KeyS')
          ? -1
          : 0;

    const intent: InputIntent = {
      lateral: clamp(lateralKeys + this.lateralTouch, -1, 1),
      speed,
      jump: this.edges.jump,
      shoulderLeft: k.has('KeyQ') || this.shoulderTouch.left,
      shoulderRight: k.has('KeyE') || this.shoulderTouch.right,
      stare: this.edges.stare || k.has('KeyF'),
      phone: this.edges.phone,
      sandWatch: this.edges.sandWatch,
      sit: this.edges.sit,
      overbridge: this.edges.overbridge,
    };
    if (k.has('KeyF')) k.delete('KeyF'); // stare is edge-triggered on keyboard too
    this.edges = {
      jump: false,
      stare: false,
      phone: false,
      sandWatch: false,
      sit: false,
      overbridge: false,
    };

    if (this.injected) {
      const merged = { ...intent, ...this.injected };
      this.injected = null;
      return merged;
    }
    return intent;
  }

  private isDragDown(t: TouchTrack): boolean {
    return t.lastY - t.startY > DRAG_DOWN_PX;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Space') this.edges.jump = true;
    else if (e.code === 'KeyM') this.edges.phone = true;
    else if (e.code === 'KeyR') this.edges.sandWatch = true;
    else if (e.code === 'KeyG') this.edges.sit = true;
    else if (e.code === 'KeyB') this.edges.overbridge = true;
    else this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    const half = window.innerWidth / 2;
    for (const t of Array.from(e.changedTouches)) {
      const side = t.clientX < half ? 'left' : 'right';
      const track: TouchTrack = {
        id: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        lastY: t.clientY,
        startTime: performance.now(),
        side,
        holdActive: false,
      };
      this.touches.set(t.identifier, track);
      if (side === 'right' && !this.rightHold) {
        this.rightHold = track;
        // Hold activates after the tap window so taps don't sprint.
        setTimeout(() => {
          if (this.rightHold === track && this.touches.has(track.id)) track.holdActive = true;
        }, TAP_MS);
      }
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const track = this.touches.get(t.identifier);
      if (!track) continue;
      track.lastX = t.clientX;
      track.lastY = t.clientY;
      if (track.side === 'left') {
        // Analog drift: offset from touch start, full deflection at ~25% screen width.
        this.lateralTouch = clamp((t.clientX - track.startX) / (window.innerWidth * 0.25), -1, 1);
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const track = this.touches.get(t.identifier);
      if (!track) continue;
      this.touches.delete(t.identifier);
      if (track.side === 'left') {
        this.lateralTouch = 0;
        continue;
      }
      const dt = performance.now() - track.startTime;
      const dy = track.lastY - track.startY;
      const speedPxMs = Math.abs(dy) / Math.max(dt, 1);
      if (speedPxMs > FLICK_PX_PER_MS && Math.abs(dy) > 24) {
        // Flick up = raise (dip) one shoulder; direction picks which.
        // Up-flick = left shoulder, down-flick = right shoulder; holding a
        // second flick within the window combines into a full duck.
        if (dy < 0) this.shoulderTouch.left = true;
        else this.shoulderTouch.right = true;
        this.shoulderTouchTimer = 0.45;
      } else if (dt < TAP_MS && !this.isDragDown(track)) {
        this.edges.jump = true;
      }
      if (this.rightHold === track) this.rightHold = null;
    }
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
