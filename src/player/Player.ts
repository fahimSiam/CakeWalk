/**
 * Player locomotion + vitals. Pure simulation: no Three.js, no DOM.
 *
 * Movement model (idea.md §2.1/§2.3):
 *  - analog lateral drift, clamped to corridor width
 *  - speed tiers: shuffle / walk / jog; jog drains stamina, empty stamina
 *    forces shuffle until partially recovered
 *  - shoulder dips shrink the effective hitbox on one side and clear
 *    HIGH-band obstacles on that side; both dips together = full duck
 *  - jump clears LOW-band obstacles and grabs fruit
 */
import type { InputIntent } from './Input';
import type { Corridor } from '@/world/Corridor';

export enum Pose {
  Normal = 0,
  DipLeft = 1,
  DipRight = 2,
  Duck = 3,
}

export const SPEED_SHUFFLE = 1.4;
export const SPEED_WALK = 3.0;
export const SPEED_JOG = 6.2;
const LATERAL_SPEED = 3.7; // m/s at full deflection
const JUMP_DURATION = 0.55; // seconds
const JUMP_HEIGHT = 1.0; // meters (apex)

const STAMINA_MAX = 100;
const STAMINA_DRAIN_JOG = 14; // per second
const STAMINA_RECOVER_WALK = 3;
const STAMINA_RECOVER_REST = 25;
const STAMINA_LOCK_THRESHOLD = 25; // exhausted until back above this
export const HEALTH_MAX = 100;

/** How far left of the footpath centerline the player may step onto the road. */
export const ROAD_EDGE_T = -3.4; // beyond this (more negative) = on the road

export class Player {
  /** Leftmost reach onto the road (lanes live at t ≈ -4.8 … -9.0). */
  static readonly ROAD_REACH = 9.5;
  s = 0;
  t = 0;
  /** Render height (jump arc). */
  y = 0;
  speed = SPEED_WALK;
  pose = Pose.Normal;
  jumpTimer = 0;
  health = HEALTH_MAX;
  stamina = STAMINA_MAX;
  exhausted = false;
  /** True while sitting at a cha dokan / bus stop. */
  resting = false;
  /** Brief post-bump invulnerability so one crowd knot ≠ instant death. */
  bumpCooldown = 0;
  /** Set by phone-check; player stops and is blind. */
  phoneLocked = false;
  walkPhase = 0;
  /** <1 with Good Shoes (stamina drains slower). */
  staminaEfficiency = 1;
  /** <1 in rain without an umbrella. */
  speedMul = 1;

  get jumping(): boolean {
    return this.jumpTimer > 0;
  }

  fixedUpdate(dt: number, input: InputIntent, corridor: Corridor): void {
    if (this.bumpCooldown > 0) this.bumpCooldown -= dt;

    if (this.resting || this.phoneLocked) {
      this.speed = 0;
      if (this.resting) {
        this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_RECOVER_REST * dt);
        if (this.exhausted && this.stamina >= STAMINA_LOCK_THRESHOLD) this.exhausted = false;
      }
      return;
    }

    // Pose from shoulder inputs (can't dip mid-air).
    if (!this.jumping) {
      if (input.shoulderLeft && input.shoulderRight) this.pose = Pose.Duck;
      else if (input.shoulderLeft) this.pose = Pose.DipLeft;
      else if (input.shoulderRight) this.pose = Pose.DipRight;
      else this.pose = Pose.Normal;
    }

    // Speed tier; ducking caps you at walk, exhaustion forces shuffle.
    let target =
      input.speed === 1 && !this.exhausted
        ? SPEED_JOG
        : input.speed === -1
          ? SPEED_SHUFFLE
          : SPEED_WALK;
    if (this.pose === Pose.Duck) target = Math.min(target, SPEED_WALK);
    if (this.exhausted) target = SPEED_SHUFFLE;
    target *= this.speedMul;
    // Smooth accel/decel so speed reads as human, not instant.
    this.speed += (target - this.speed) * Math.min(1, dt * 6);

    // Stamina.
    if (this.speed > SPEED_WALK + 0.5) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_JOG * this.staminaEfficiency * dt);
      if (this.stamina === 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_RECOVER_WALK * dt);
      if (this.exhausted && this.stamina >= STAMINA_LOCK_THRESHOLD) this.exhausted = false;
    }

    // Jump.
    if (input.jump && !this.jumping && this.pose === Pose.Normal) {
      this.jumpTimer = JUMP_DURATION;
    }
    if (this.jumping) {
      this.jumpTimer = Math.max(0, this.jumpTimer - dt);
      const p = 1 - this.jumpTimer / JUMP_DURATION; // 0..1
      this.y = JUMP_HEIGHT * 4 * p * (1 - p); // parabola
    } else {
      this.y = 0;
    }

    // Move. The footpath edge (building wall) limits the right; the LEFT opens
    // onto the traffic road — the player may step out there as a high-risk
    // shortcut (no crowd, but fast cars). The road collision lives in traffic.
    this.s += this.speed * dt;
    this.t += input.lateral * LATERAL_SPEED * dt;
    const hw = corridor.halfWidth(this.s) - 0.3;
    if (this.t > hw) this.t = hw;
    if (this.t < -Player.ROAD_REACH) this.t = -Player.ROAD_REACH;

    this.walkPhase += this.speed * dt * 2.2;
  }

  /** Effective lateral half-width for collision, by pose. */
  get hitHalfWidth(): number {
    switch (this.pose) {
      case Pose.Duck:
        return 0.22;
      case Pose.DipLeft:
      case Pose.DipRight:
        return 0.26;
      default:
        return 0.34;
    }
  }

  applyBump(severity: number): boolean {
    if (this.bumpCooldown > 0) return false;
    this.bumpCooldown = 0.6;
    this.health = Math.max(0, this.health - severity);
    return true;
  }

  heal(amount: number): void {
    this.health = Math.min(HEALTH_MAX, this.health + amount);
  }

  // --- Sand Watch snapshot (fixed-size, no allocation) ---
  static readonly SNAP_FLOATS = 12;

  snapshot(out: Float64Array, offset: number): void {
    out[offset] = this.s;
    out[offset + 1] = this.t;
    out[offset + 2] = this.y;
    out[offset + 3] = this.speed;
    out[offset + 4] = this.pose;
    out[offset + 5] = this.jumpTimer;
    out[offset + 6] = this.health;
    out[offset + 7] = this.stamina;
    out[offset + 8] = (this.exhausted ? 1 : 0) + (this.resting ? 2 : 0) + (this.phoneLocked ? 4 : 0);
    out[offset + 9] = this.bumpCooldown;
    out[offset + 10] = this.walkPhase;
    out[offset + 11] = 0; // reserved
  }

  restore(from: Float64Array, offset: number): void {
    this.s = from[offset]!;
    this.t = from[offset + 1]!;
    this.y = from[offset + 2]!;
    this.speed = from[offset + 3]!;
    this.pose = from[offset + 4]! as Pose;
    this.jumpTimer = from[offset + 5]!;
    this.health = from[offset + 6]!;
    this.stamina = from[offset + 7]!;
    const flags = from[offset + 8]!;
    this.exhausted = (flags & 1) !== 0;
    this.resting = (flags & 2) !== 0;
    this.phoneLocked = (flags & 4) !== 0;
    this.bumpCooldown = from[offset + 9]!;
    this.walkPhase = from[offset + 10]!;
  }
}
