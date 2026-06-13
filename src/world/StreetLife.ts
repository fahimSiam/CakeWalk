/**
 * Footpath fauna & clutter (idea.md §2.2): sleeping dogs (jump or go around;
 * startle one at a sprint and panic ripples through the crowd), darting cats
 * (combo-breaking stumble), and dustbin smell clouds that make the crowd
 * swerve. Pure sim; placements derive deterministically from props/seed.
 */
import type { EventBus } from '@/core/EventBus';
import type { RngStream } from '@/core/Rng';
import type { Player } from '@/player/Player';
import type { CrowdSystem } from '@/crowd/CrowdSystem';
import type { RunScore } from '@/economy/RunScore';
import { SPEED_WALK } from '@/player/Player';

export interface DogSpot {
  s: number;
  t: number;
  barked: boolean;
}

export interface DustbinSpot {
  s: number;
  t: number;
  smelly: boolean;
}

const MAX_CATS = 3;
const DOG_SPACING = 130;
// Cats are rarer now but mug you: a thieving cat darts in, and on contact
// snatches some taka (idea.md Rev 8). Less frequent so it stays a surprise.
const CAT_INTERVAL_MIN = 20;
const CAT_INTERVAL_MAX = 42;
const CAT_STEAL_MIN = 7;
const CAT_STEAL_MAX = 16;

export const MAX_COWS = 6;
export const enum CowState {
  Inactive = 0,
  Led = 1, // walked to the haat: slow, wide moving wall in the crowd flow
  Stampede = 2, // escaped! fast, panicking everyone
}
const LED_COW_INTERVAL_MIN = 40;
const LED_COW_INTERVAL_MAX = 85;
const STAMPEDE_BONUS = 80;

export class StreetLife {
  dogs: DogSpot[] = [];
  dustbins: DustbinSpot[] = [];

  // Cats darting across the path.
  readonly catS = new Float32Array(MAX_CATS);
  readonly catT = new Float32Array(MAX_CATS);
  readonly catDir = new Float32Array(MAX_CATS);
  readonly catActive = new Uint8Array(MAX_CATS);
  private catTimer = 8;

  // Qurbani cows (Eid exodus theming, idea.md §1.1).
  readonly cowS = new Float32Array(MAX_COWS);
  readonly cowT = new Float32Array(MAX_COWS);
  readonly cowSpeed = new Float32Array(MAX_COWS);
  readonly cowState = new Uint8Array(MAX_COWS);
  private cowTimer = 20;
  private stampedeActive = false;
  private stampedeHit = false;

  constructor(
    private rng: RngStream,
    private bus: EventBus,
  ) {}

  /** Dogs placed deterministically along the corridor; dustbins from props. */
  populate(corridorLength: number, corridorHalf: number, dustbins: { s: number; t: number }[]): void {
    this.dogs = [];
    for (let s = 40 + this.rng.range(0, DOG_SPACING); s < corridorLength - 30; s += DOG_SPACING + this.rng.range(-30, 30)) {
      this.dogs.push({ s, t: this.rng.range(-corridorHalf + 0.5, corridorHalf - 0.5), barked: false });
    }
    this.dustbins = dustbins.map((d) => ({ s: d.s, t: d.t, smelly: this.rng.chance(0.5) }));
  }

  fixedUpdate(dt: number, player: Player, crowd: CrowdSystem, score: RunScore): void {
    const airborne = player.y > 1.2; // on the overbridge — street can't touch you
    // Dogs: low obstacle (jump clears); sprinting close startles → bark panic.
    for (const dog of this.dogs) {
      const ds = Math.abs(player.s - dog.s);
      const dtt = Math.abs(player.t - dog.t);
      if (ds < 0.6 && dtt < 0.55 && !player.jumping && !airborne) {
        if (player.applyBump(4)) this.bus.emit('bump', { severity: 4, agentIndex: -1 });
      }
      if (!dog.barked && ds < 2.2 && dtt < 2 && player.speed > SPEED_WALK + 0.5) {
        dog.barked = true;
        crowd.panicNear(dog.s, dog.t, 7);
        this.bus.emit('dogBark', { x: dog.s, z: dog.t });
      }
    }

    // Dustbin smell clouds: nearby crowd swerves away (reading it is a skill).
    for (const bin of this.dustbins) {
      // Static obstacle for the player too.
      const ds = Math.abs(player.s - bin.s);
      const dtt = Math.abs(player.t - bin.t);
      if (ds < 0.6 && dtt < 0.6 && !player.jumping && !airborne) {
        if (player.applyBump(3)) this.bus.emit('bump', { severity: 3, agentIndex: -1 });
      }
      if (!bin.smelly) continue;
      crowd.repelFrom(bin.s, bin.t, 2.6, 2.2 * dt);
    }

    this.updateCows(dt, player, crowd);

    // Cats.
    this.catTimer -= dt;
    if (this.catTimer <= 0) {
      this.catTimer = this.rng.range(CAT_INTERVAL_MIN, CAT_INTERVAL_MAX);
      this.spawnCat(player);
    }
    for (let i = 0; i < MAX_CATS; i++) {
      if (!this.catActive[i]) continue;
      this.catT[i]! += this.catDir[i]! * 4.5 * dt;
      if (Math.abs(this.catT[i]!) > 6) {
        this.catActive[i] = 0;
        continue;
      }
      if (Math.abs(player.s - this.catS[i]!) < 0.6 && Math.abs(player.t - this.catT[i]!) < 0.5 && !airborne) {
        // A thieving cat: snatches taka and bolts (you can't jump over a mugging).
        // steal() emits the 'theft' event (toast + tally); fall back to a plain
        // stumble when the wallet is already empty.
        this.catActive[i] = 0;
        if (score.steal(this.rng.range(CAT_STEAL_MIN, CAT_STEAL_MAX), 'cat') <= 0) {
          this.bus.emit('catStumble', {});
        }
      }
    }
  }

  /** Escaped-cow stampede (Director-triggered): big hazard, big reward. */
  startStampede(player: Player, crowd: CrowdSystem): void {
    if (this.stampedeActive) return;
    this.stampedeActive = true;
    this.stampedeHit = false;
    let spawned = 0;
    for (let i = 0; i < MAX_COWS && spawned < 3; i++) {
      if (this.cowState[i] !== CowState.Inactive) continue;
      this.cowState[i] = CowState.Stampede;
      this.cowS[i] = player.s + 38 + spawned * 6;
      this.cowT[i] = this.rng.range(-2, 2);
      this.cowSpeed[i] = this.rng.range(6.2, 7.5);
      spawned++;
    }
    if (spawned > 0) {
      crowd.panicNear(player.s + 25, 0, 30);
      this.bus.emit('cowStampede', {});
    } else {
      this.stampedeActive = false;
    }
  }

  private updateCows(dt: number, player: Player, crowd: CrowdSystem): void {
    // A led cow joins the exodus flow every now and then.
    this.cowTimer -= dt;
    if (this.cowTimer <= 0) {
      this.cowTimer = this.rng.range(LED_COW_INTERVAL_MIN, LED_COW_INTERVAL_MAX);
      for (let i = 0; i < MAX_COWS; i++) {
        if (this.cowState[i] !== CowState.Inactive) continue;
        this.cowState[i] = CowState.Led;
        this.cowS[i] = player.s + this.rng.range(40, 80);
        this.cowT[i] = this.rng.range(-1.5, 1.5);
        this.cowSpeed[i] = this.rng.range(0.7, 1.0);
        break;
      }
    }

    let stampedeStillRunning = false;
    for (let i = 0; i < MAX_COWS; i++) {
      if (this.cowState[i] === CowState.Inactive) continue;
      this.cowS[i]! -= this.cowSpeed[i]! * dt; // both kinds move toward the player
      const isStampede = this.cowState[i] === CowState.Stampede;
      if (isStampede) {
        stampedeStillRunning = stampedeStillRunning || this.cowS[i]! > player.s - 5;
        crowd.repelFrom(this.cowS[i]!, this.cowT[i]!, 3.5, 4 * dt);
      }
      // A cow is a wall: jump doesn't clear it, duck doesn't either —
      // but the overbridge does.
      if (
        player.y <= 1.2 &&
        Math.abs(player.s - this.cowS[i]!) < 1.3 &&
        Math.abs(player.t - this.cowT[i]!) < 1.15
      ) {
        if (player.applyBump(isStampede ? 35 : 16)) {
          this.bus.emit('bump', { severity: isStampede ? 35 : 16, agentIndex: -2 });
          player.s = this.cowS[i]! - 1.6; // shoved back
          if (isStampede) this.stampedeHit = true;
        }
      }
      if (this.cowS[i]! < player.s - 12) this.cowState[i] = CowState.Inactive;
    }

    // Survived the stampede untouched → big bonus (survival, not mockery).
    if (this.stampedeActive && !stampedeStillRunning) {
      this.stampedeActive = false;
      if (!this.stampedeHit) this.bus.emit('stampedeSurvived', { bonus: STAMPEDE_BONUS });
    }
  }

  private spawnCat(player: Player): void {
    for (let i = 0; i < MAX_CATS; i++) {
      if (this.catActive[i]) continue;
      this.catActive[i] = 1;
      this.catS[i] = player.s + this.rng.range(6, 14);
      this.catDir[i] = this.rng.chance(0.5) ? 1 : -1;
      this.catT[i] = -this.catDir[i]! * 5;
      return;
    }
  }

  // --- Sand Watch snapshot (dynamic state; placements are static) ---
  snapFloats(): number {
    return 5 + this.dogs.length + MAX_CATS * 4 + MAX_COWS * 4;
  }

  snapshot(out: Float64Array, offset: number): void {
    let o = offset;
    out[o++] = this.catTimer;
    out[o++] = this.cowTimer;
    out[o++] = (this.stampedeActive ? 1 : 0) + (this.stampedeHit ? 2 : 0);
    out[o++] = this.dogs.length;
    out[o++] = 0; // reserved
    for (const dog of this.dogs) out[o++] = dog.barked ? 1 : 0;
    for (let i = 0; i < MAX_CATS; i++) {
      out[o++] = this.catS[i]!;
      out[o++] = this.catT[i]!;
      out[o++] = this.catDir[i]!;
      out[o++] = this.catActive[i]!;
    }
    for (let i = 0; i < MAX_COWS; i++) {
      out[o++] = this.cowS[i]!;
      out[o++] = this.cowT[i]!;
      out[o++] = this.cowSpeed[i]!;
      out[o++] = this.cowState[i]!;
    }
  }

  restore(from: Float64Array, offset: number): void {
    let o = offset;
    this.catTimer = from[o++]!;
    this.cowTimer = from[o++]!;
    const flags = from[o++]!;
    this.stampedeActive = (flags & 1) !== 0;
    this.stampedeHit = (flags & 2) !== 0;
    const n = from[o++]!;
    o++; // reserved
    for (let i = 0; i < n && i < this.dogs.length; i++) this.dogs[i]!.barked = from[o++]! === 1;
    for (let i = 0; i < MAX_CATS; i++) {
      this.catS[i] = from[o++]!;
      this.catT[i] = from[o++]!;
      this.catDir[i] = from[o++]!;
      this.catActive[i] = from[o++]!;
    }
    for (let i = 0; i < MAX_COWS; i++) {
      this.cowS[i] = from[o++]!;
      this.cowT[i] = from[o++]!;
      this.cowSpeed[i] = from[o++]!;
      this.cowState[i] = from[o++]!;
    }
  }
}
