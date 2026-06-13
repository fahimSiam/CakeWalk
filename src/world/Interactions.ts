/**
 * Route-side interactions, all in path coordinates:
 *  - cha dokan / bus stop rest (stamina/health regen, seated-theft exposure)
 *  - fruit trees (jump-grab → points + health)
 *  - the phone check (stop, blind window, own-map overlay; idea.md §2.4)
 */
import type { EventBus } from '@/core/EventBus';
import type { Player } from '@/player/Player';
import type { RunScore } from '@/economy/RunScore';

export interface RoutePoint {
  kind: 'chaDokan' | 'busStop' | 'tree';
  s: number;
  t: number;
  /** Trees: fruit still available. */
  fruit: boolean;
}

// Stalls/benches sit just OFF the walkable strip (|t| can be up to ~7 m),
// so proximity is judged mostly along s — the player walks "up to" the
// stall, not into it.
const REST_RANGE_S = 5.5;
const REST_RANGE_T = 7.5;
const FRUIT_RANGE_S = 1.4;
const FRUIT_RANGE_T = 2.2;
const PHONE_MIN = 2.5;
const PHONE_CANCEL_AFTER = 1.0;
const CHA_HEAL_PER_S = 9;

export class Interactions {
  points: RoutePoint[] = [];
  /** >0 while the phone is up. */
  phoneTimer = 0;
  phoneElapsed = 0;
  /** The rest spot currently in range (HUD shows the sit button). */
  nearRest: RoutePoint | null = null;
  restingAt: RoutePoint | null = null;

  constructor(private bus: EventBus) {}

  fixedUpdate(dt: number, player: Player, score: RunScore): void {
    // Phone check lifecycle.
    if (this.phoneTimer > 0) {
      this.phoneTimer -= dt;
      this.phoneElapsed += dt;
      if (this.phoneTimer <= 0) this.endPhone(player);
    }

    // Rest proximity.
    this.nearRest = null;
    for (const p of this.points) {
      if (p.kind === 'tree') continue;
      if (Math.abs(player.s - p.s) < REST_RANGE_S && Math.abs(player.t - p.t) < REST_RANGE_T) {
        this.nearRest = p;
        break;
      }
    }
    if (this.restingAt) {
      // Cha dokan also heals (idea.md §2.3); bus stop is stamina-only.
      if (this.restingAt.kind === 'chaDokan') player.heal(CHA_HEAL_PER_S * dt);
      if (player.stamina >= 99.5 && player.health >= 99.5) this.standUp(player);
      else if (player.stamina >= 99.5 && this.restingAt.kind === 'busStop') this.standUp(player);
    }

    // Fruit grab: jumping under a tree.
    if (player.jumping && player.y > 0.55) {
      for (const p of this.points) {
        if (p.kind !== 'tree' || !p.fruit) continue;
        if (Math.abs(player.s - p.s) < FRUIT_RANGE_S && Math.abs(player.t - p.t) < FRUIT_RANGE_T) {
          p.fruit = false;
          const points = 12;
          score.add(points, 'fruit');
          player.heal(6);
          this.bus.emit('fruitGrabbed', { kind: 'mango', points });
        }
      }
    }
  }

  /** Sit/stand toggle (HUD bench button or G key). */
  toggleSit(player: Player, corridorHalf: number): void {
    if (this.restingAt) {
      this.standUp(player);
    } else if (this.nearRest && !player.phoneLocked) {
      this.restingAt = this.nearRest;
      player.resting = true;
      // Shuffle toward the stall but stay on the walkable strip.
      const edge = corridorHalf - 0.3;
      player.t = Math.max(-edge, Math.min(edge, this.nearRest.t));
      player.s = this.nearRest.s;
      this.bus.emit('restStarted', { kind: this.nearRest.kind as 'chaDokan' | 'busStop' });
    }
  }

  /** Phone button. Returns true if the overlay should open. */
  togglePhone(player: Player): boolean {
    if (this.phoneTimer > 0) {
      // Cancellable after the commit window.
      if (this.phoneElapsed >= PHONE_CANCEL_AFTER) this.endPhone(player);
      return false;
    }
    if (player.resting) return false;
    this.phoneTimer = PHONE_MIN;
    this.phoneElapsed = 0;
    player.phoneLocked = true;
    this.bus.emit('phoneCheckStarted', {});
    return true;
  }

  private endPhone(player: Player): void {
    this.phoneTimer = 0;
    player.phoneLocked = false;
    this.bus.emit('phoneCheckEnded', {});
  }

  private standUp(player: Player): void {
    this.restingAt = null;
    player.resting = false;
    this.bus.emit('restEnded', {});
  }

  // --- Sand Watch snapshot ---
  snapFloats(): number {
    return 4 + this.points.length;
  }

  snapshot(out: Float64Array, offset: number): void {
    let o = offset;
    out[o++] = this.phoneTimer;
    out[o++] = this.phoneElapsed;
    out[o++] = this.restingAt ? this.points.indexOf(this.restingAt) : -1;
    out[o++] = this.points.length;
    for (const p of this.points) out[o++] = p.fruit ? 1 : 0;
  }

  restore(from: Float64Array, offset: number): void {
    let o = offset;
    this.phoneTimer = from[o++]!;
    this.phoneElapsed = from[o++]!;
    const restIdx = from[o++]!;
    this.restingAt = restIdx >= 0 ? (this.points[restIdx] ?? null) : null;
    const n = from[o++]!;
    for (let i = 0; i < n && i < this.points.length; i++) this.points[i]!.fruit = from[o++]! === 1;
  }
}
