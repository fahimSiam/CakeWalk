/**
 * Pocketmar AI (idea.md §2.6). Pure sim.
 *
 * Lifecycle: Disguised (walks with the crowd, indistinguishable) → The Turn
 * (flips to walk the player's direction, pacing them) → Drift (angles
 * closer) → Strike (steals taka) → melt away. Rare INNOCENT same-direction
 * walkers share the Turn so it stays a strong prior, not proof.
 *
 * Counter-play: Stare-Down auto-targets the most suspicious entity in the
 * facing cone; real pocketmar flees (+bonus), innocent costs combo.
 */
import type { EventBus } from '@/core/EventBus';
import type { RngStream } from '@/core/Rng';
import type { Player } from '@/player/Player';
import type { RunScore } from '@/economy/RunScore';

export const MAX_POCKETMARS = 10;

export const enum PmState {
  Inactive = 0,
  Disguised = 1, // walking with the crowd flow ahead of the player
  Turned = 2, // walking the player's way, pacing
  Striking = 3, // committed, closing in
  Fleeing = 4, // spotted or done stealing
}

const STARE_COOLDOWN = 2.5;
const STARE_RANGE_S = 12;
const STARE_RANGE_T = 4;
const STRIKE_RANGE = 0.85;
const WALK_STEAL_FRACTION = 0.18;
const PHONE_STEAL_FRACTION = 0.2; // hard cap per check (idea.md §2.4)
const SEATED_TELL_TIME = 1.0;

export interface PickpocketConfig {
  /** 1-5 route risk → spawn pressure. */
  risk: number;
  /** Suppression gate from the Director (frustration budget). */
  canSpawn: () => boolean;
}

export class PickpocketSystem {
  // SoA pool.
  readonly s = new Float32Array(MAX_POCKETMARS);
  readonly t = new Float32Array(MAX_POCKETMARS);
  readonly state = new Uint8Array(MAX_POCKETMARS);
  readonly timer = new Float32Array(MAX_POCKETMARS);
  readonly innocent = new Uint8Array(MAX_POCKETMARS); // 1 = honest same-direction walker
  readonly phase = new Float32Array(MAX_POCKETMARS);
  /** 0-1, how readable the tells are right now (drives render highlight). */
  readonly suspicion = new Float32Array(MAX_POCKETMARS);

  stareCooldown = 0;
  /** Set by items (glasses powerup): outlines real pocketmars. */
  glassesActive = false;
  /** Seated-theft tell countdown (>0 = a pocketmar approaches the bench). */
  seatedTell = 0;
  private seatedThief = -1;
  private spawnTimer = 4;

  config: PickpocketConfig = { risk: 2, canSpawn: () => true };

  constructor(
    private rng: RngStream,
    private bus: EventBus,
  ) {}

  fixedUpdate(dt: number, player: Player, score: RunScore, corridorHalf: number): void {
    if (this.stareCooldown > 0) this.stareCooldown -= dt;
    this.updateSpawning(dt, player);
    this.updateSeated(dt, player, score);

    for (let i = 0; i < MAX_POCKETMARS; i++) {
      if (this.state[i] === PmState.Inactive) continue;
      const ds = this.s[i]! - player.s;
      const dtt = this.t[i]! - player.t;

      switch (this.state[i]) {
        case PmState.Disguised: {
          // Walk with the crowd (toward the player). Turn when passing close.
          this.s[i]! -= 1.4 * dt;
          if (ds < 2.5 && ds > -1 && Math.abs(dtt) < corridorHalf) {
            if (this.innocent[i]) {
              this.state[i] = PmState.Turned; // innocents turn too
              this.timer[i] = this.rng.range(4, 9);
            } else if (this.config.canSpawn()) {
              this.state[i] = PmState.Turned;
              this.timer[i] = this.rng.range(2.5, 5);
            }
          }
          if (ds < -8) this.state[i] = PmState.Inactive;
          break;
        }
        case PmState.Turned: {
          // The Turn: pace the player slightly behind/beside.
          const targetS = player.s - this.rng.range(0.5, 0.9);
          this.s[i]! += (targetS - this.s[i]!) * Math.min(1, dt * 2) + player.speed * dt * 0.85;
          if (!this.innocent[i]) {
            // The Drift: close lateral distance slowly.
            this.t[i]! += Math.sign(player.t - this.t[i]!) * 0.35 * dt;
            this.suspicion[i] = Math.min(1, this.suspicion[i]! + dt * 0.25);
            this.timer[i]! -= dt;
            if (this.timer[i]! <= 0 || (player.phoneLocked && Math.abs(dtt) < 2)) {
              this.state[i] = PmState.Striking;
            }
          } else {
            // Innocents wander off on their own.
            this.suspicion[i] = Math.min(0.55, this.suspicion[i]! + dt * 0.15);
            this.timer[i]! -= dt;
            if (this.timer[i]! <= 0) this.state[i] = PmState.Fleeing;
          }
          break;
        }
        case PmState.Striking: {
          // Commit: close fast.
          this.s[i]! += (player.s - 0.4 - this.s[i]!) * Math.min(1, dt * 3) + player.speed * dt;
          this.t[i]! += Math.sign(player.t - this.t[i]!) * 1.1 * dt;
          this.suspicion[i] = 1;
          if (Math.abs(this.s[i]! - player.s) < STRIKE_RANGE && Math.abs(this.t[i]! - player.t) < STRIKE_RANGE) {
            const fraction = player.phoneLocked ? PHONE_STEAL_FRACTION : WALK_STEAL_FRACTION;
            // At least 1 taka if there's anything to take, never above the cap.
            const amount = Math.max(Math.min(1, score.taka), Math.floor(score.taka * fraction));
            score.steal(amount, player.phoneLocked ? 'phone' : 'walk');
            this.state[i] = PmState.Fleeing;
            this.timer[i] = 3;
          }
          break;
        }
        case PmState.Fleeing: {
          this.s[i]! -= 3.2 * dt;
          this.t[i]! += (this.t[i]! > 0 ? 1 : -1) * 0.8 * dt;
          this.timer[i]! -= dt;
          if (this.timer[i]! <= 0 || this.s[i]! < player.s - 10) this.state[i] = PmState.Inactive;
          break;
        }
      }
      this.phase[i]! += dt * 3;
    }
  }

  /** Stare-Down: returns what happened (for HUD/audio). */
  stare(player: Player, score: RunScore): 'spotted' | 'misread' | 'nothing' | 'cooldown' {
    if (this.stareCooldown > 0) return 'cooldown';
    this.stareCooldown = STARE_COOLDOWN;

    // Shoo the seated thief if one is mid-tell.
    if (this.seatedTell > 0 && this.seatedThief >= 0) {
      this.state[this.seatedThief] = PmState.Fleeing;
      this.timer[this.seatedThief] = 2;
      this.seatedTell = 0;
      this.seatedThief = -1;
      this.bus.emit('theftSpotted', { bonus: 5 });
      score.add(5, 'spotted');
      return 'spotted';
    }

    // Suspicion-weighted snap targeting in the facing cone.
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < MAX_POCKETMARS; i++) {
      if (this.state[i] !== PmState.Turned && this.state[i] !== PmState.Striking) continue;
      const ds = this.s[i]! - player.s;
      const dtt = Math.abs(this.t[i]! - player.t);
      if (ds < -2 || ds > STARE_RANGE_S || dtt > STARE_RANGE_T) continue;
      const score_ = this.suspicion[i]! + (1 - dtt / STARE_RANGE_T) * 0.3;
      if (score_ > bestScore) {
        bestScore = score_;
        best = i;
      }
    }
    if (best === -1) return 'nothing';
    if (this.innocent[best]) {
      this.state[best] = PmState.Fleeing;
      this.timer[best] = 2;
      this.bus.emit('stareMisread', {});
      return 'misread';
    }
    this.state[best] = PmState.Fleeing;
    this.timer[best] = 2.5;
    const bonus = 10;
    score.add(bonus, 'spotted');
    this.bus.emit('theftSpotted', { bonus });
    return 'spotted';
  }

  private updateSpawning(dt: number, player: Player): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    // Higher risk → shorter gaps between pocketmar appearances.
    this.spawnTimer = this.rng.range(14, 26) / Math.max(1, this.config.risk * 0.8);
    if (!this.config.canSpawn()) return;
    const slot = this.findSlot();
    if (slot === -1) return;
    this.state[slot] = PmState.Disguised;
    this.s[slot] = player.s + this.rng.range(14, 30);
    this.t[slot] = this.rng.range(-2, 2);
    this.suspicion[slot] = 0;
    this.phase[slot] = this.rng.range(0, 6);
    // ~1 in 4 same-direction walkers is innocent — the Turn is a prior, not proof.
    this.innocent[slot] = this.rng.chance(0.25) ? 1 : 0;
  }

  private updateSeated(dt: number, player: Player, score: RunScore): void {
    if (!player.resting) {
      this.seatedTell = 0;
      this.seatedThief = -1;
      return;
    }
    if (this.seatedTell > 0) {
      this.seatedTell -= dt;
      if (this.seatedTell <= 0 && this.seatedThief >= 0) {
        // Missed the tell: lose taka.
        score.steal(Math.floor(score.taka * 0.12), 'seated');
        this.state[this.seatedThief] = PmState.Fleeing;
        this.timer[this.seatedThief] = 2;
        this.seatedThief = -1;
      }
      return;
    }
    // Resting attracts attention occasionally.
    if (this.config.canSpawn() && this.rng.chance(dt * 0.08 * this.config.risk)) {
      const slot = this.findSlot();
      if (slot !== -1) {
        this.state[slot] = PmState.Striking;
        this.s[slot] = player.s + 4;
        this.t[slot] = player.t + this.rng.range(-1, 1);
        this.innocent[slot] = 0;
        this.suspicion[slot] = 1;
        this.seatedThief = slot;
        this.seatedTell = SEATED_TELL_TIME;
      }
    }
  }

  private findSlot(): number {
    for (let i = 0; i < MAX_POCKETMARS; i++) {
      if (this.state[i] === PmState.Inactive) return i;
    }
    return -1;
  }

  // --- Sand Watch snapshot ---
  static readonly SNAP_FLOATS = MAX_POCKETMARS * 6 + 4;

  snapshot(out: Float64Array, offset: number): void {
    let o = offset;
    out[o++] = this.stareCooldown;
    out[o++] = this.seatedTell;
    out[o++] = this.seatedThief;
    out[o++] = this.spawnTimer;
    for (let i = 0; i < MAX_POCKETMARS; i++) {
      out[o++] = this.s[i]!;
      out[o++] = this.t[i]!;
      out[o++] = this.timer[i]!;
      out[o++] = this.phase[i]!;
      out[o++] = this.suspicion[i]!;
      out[o++] = this.state[i]! + this.innocent[i]! * 256;
    }
  }

  restore(from: Float64Array, offset: number): void {
    let o = offset;
    this.stareCooldown = from[o++]!;
    this.seatedTell = from[o++]!;
    this.seatedThief = from[o++]!;
    this.spawnTimer = from[o++]!;
    for (let i = 0; i < MAX_POCKETMARS; i++) {
      this.s[i] = from[o++]!;
      this.t[i] = from[o++]!;
      this.timer[i] = from[o++]!;
      this.phase[i] = from[o++]!;
      this.suspicion[i] = from[o++]!;
      const packed = from[o++]!;
      this.state[i] = packed % 256;
      this.innocent[i] = Math.floor(packed / 256);
    }
  }
}
