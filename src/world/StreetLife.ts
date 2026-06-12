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
const CAT_INTERVAL_MIN = 11;
const CAT_INTERVAL_MAX = 24;

export class StreetLife {
  dogs: DogSpot[] = [];
  dustbins: DustbinSpot[] = [];

  // Cats darting across the path.
  readonly catS = new Float32Array(MAX_CATS);
  readonly catT = new Float32Array(MAX_CATS);
  readonly catDir = new Float32Array(MAX_CATS);
  readonly catActive = new Uint8Array(MAX_CATS);
  private catTimer = 8;

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

  fixedUpdate(dt: number, player: Player, crowd: CrowdSystem): void {
    // Dogs: low obstacle (jump clears); sprinting close startles → bark panic.
    for (const dog of this.dogs) {
      const ds = Math.abs(player.s - dog.s);
      const dtt = Math.abs(player.t - dog.t);
      if (ds < 0.6 && dtt < 0.55 && !player.jumping) {
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
      if (ds < 0.6 && dtt < 0.6 && !player.jumping) {
        if (player.applyBump(3)) this.bus.emit('bump', { severity: 3, agentIndex: -1 });
      }
      if (!bin.smelly) continue;
      crowd.repelFrom(bin.s, bin.t, 2.6, 2.2 * dt);
    }

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
      if (Math.abs(player.s - this.catS[i]!) < 0.5 && Math.abs(player.t - this.catT[i]!) < 0.45 && !player.jumping) {
        this.catActive[i] = 0;
        this.bus.emit('catStumble', {});
      }
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

  // --- Sand Watch snapshot (dogs barked flags + cats; placements are static) ---
  snapFloats(): number {
    return 2 + this.dogs.length + MAX_CATS * 4;
  }

  snapshot(out: Float32Array, offset: number): void {
    let o = offset;
    out[o++] = this.catTimer;
    out[o++] = this.dogs.length;
    for (const dog of this.dogs) out[o++] = dog.barked ? 1 : 0;
    for (let i = 0; i < MAX_CATS; i++) {
      out[o++] = this.catS[i]!;
      out[o++] = this.catT[i]!;
      out[o++] = this.catDir[i]!;
      out[o++] = this.catActive[i]!;
    }
  }

  restore(from: Float32Array, offset: number): void {
    let o = offset;
    this.catTimer = from[o++]!;
    const n = from[o++]!;
    for (let i = 0; i < n && i < this.dogs.length; i++) this.dogs[i]!.barked = from[o++]! === 1;
    for (let i = 0; i < MAX_CATS; i++) {
      this.catS[i] = from[o++]!;
      this.catT[i] = from[o++]!;
      this.catDir[i] = from[o++]!;
      this.catActive[i] = from[o++]!;
    }
  }
}
