/**
 * Crowd simulation (idea.md §2.2). Pure sim — no Three.js.
 *
 * Structure-of-Arrays over a fixed agent pool: cache-friendly, instancing-
 * friendly, and trivially snapshot-able for Sand Watch rewind. Agents live
 * in path coordinates (s = along route, t = lateral). The whole crowd flows
 * in `flowDirection` (-1 = toward the player, the core premise; +1 = with
 * the player for the Eid-ul-Fitr reversed-flow event).
 *
 * Local avoidance is simple separation steering on the lateral axis via a
 * spatial hash bucketed by s — agents mostly flow one way, so full RVO is
 * unnecessary; bumping the *player* is the game.
 */
import { ARCHETYPES, Band } from './archetypes';
import type { Corridor } from '@/world/Corridor';
import type { EventBus } from '@/core/EventBus';
import type { RngStream } from '@/core/Rng';
import { Player, Pose, SPEED_WALK } from '@/player/Player';

export const MAX_AGENTS = 220;

// Agent state machine values (kept in a Uint8Array).
export const enum AgentState {
  Inactive = 0,
  Walking = 1,
  Stopped = 2,
  Panicked = 3, // dog bark ripple
}

const SPAWN_AHEAD_MIN = 30;
const SPAWN_AHEAD_MAX = 110;
const DESPAWN_BEHIND = 12;
const NEAR_MISS_DIST = 0.32; // beyond combined hitbox
const SEPARATION_DIST = 0.9;
const PANIC_TIME = 1.6;

export interface CrowdConfig {
  /** Target simultaneous active agents (density). */
  density: number;
  /** -1 = crowd walks toward the player (default premise). */
  flowDirection: -1 | 1;
}

export class CrowdSystem {
  // SoA agent pool.
  readonly s = new Float32Array(MAX_AGENTS);
  readonly t = new Float32Array(MAX_AGENTS);
  readonly speed = new Float32Array(MAX_AGENTS); // current
  readonly baseSpeed = new Float32Array(MAX_AGENTS);
  readonly phase = new Float32Array(MAX_AGENTS); // walk-cycle offset
  readonly timer = new Float32Array(MAX_AGENTS); // state timer (stop/panic)
  readonly state = new Uint8Array(MAX_AGENTS);
  readonly archetype = new Uint8Array(MAX_AGENTS);
  readonly variant = new Uint8Array(MAX_AGENTS); // render color variant
  /** 1 if the player already collected the near-miss for this passing. */
  readonly nearMissDone = new Uint8Array(MAX_AGENTS);

  activeCount = 0;
  config: CrowdConfig = { density: 120, flowDirection: -1 };

  private spatial = new Map<number, number[]>();

  constructor(
    private corridor: Corridor,
    private rng: RngStream,
    private bus: EventBus,
  ) {}

  /** Spawn initial field of agents ahead of the player. */
  prewarm(playerS: number): void {
    for (let i = 0; i < this.config.density; i++) {
      this.spawnAgent(playerS + this.rng.range(8, SPAWN_AHEAD_MAX));
    }
  }

  fixedUpdate(dt: number, player: Player): void {
    this.maintainPopulation(player.s);
    this.rebuildSpatialHash();

    const flow = this.config.flowDirection;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (this.state[i] === AgentState.Inactive) continue;

      // State timers: stopped agents resume, panicked agents calm down.
      if (this.state[i] === AgentState.Stopped || this.state[i] === AgentState.Panicked) {
        this.timer[i]! -= dt;
        if (this.timer[i]! <= 0) this.state[i] = AgentState.Walking;
      } else {
        const arch = ARCHETYPES[this.archetype[i]!]!;
        if (arch.stopChance > 0 && this.rng.chance(arch.stopChance * dt)) {
          this.state[i] = AgentState.Stopped;
          this.timer[i] = this.rng.range(0.8, 2.2);
        }
      }

      // Movement along s.
      const moving = this.state[i] === AgentState.Walking || this.state[i] === AgentState.Panicked;
      const panicMul = this.state[i] === AgentState.Panicked ? 1.8 : 1;
      const v = moving ? this.baseSpeed[i]! * panicMul : 0;
      this.speed[i] = v;
      // Crowd flows opposite the player's +s direction when flow = -1.
      this.s[i]! += v * flow * dt;

      // Lateral separation from neighbours (+ jitter while panicked).
      let push = 0;
      const bucket = Math.floor(this.s[i]! / 2);
      for (let b = bucket - 1; b <= bucket + 1; b++) {
        const cell = this.spatial.get(b);
        if (!cell) continue;
        for (const j of cell) {
          if (j === i) continue;
          const ds = this.s[i]! - this.s[j]!;
          const dtt = this.t[i]! - this.t[j]!;
          const d2 = ds * ds + dtt * dtt;
          if (d2 < SEPARATION_DIST * SEPARATION_DIST && d2 > 1e-6) {
            push += (dtt >= 0 ? 1 : -1) * (1 - Math.sqrt(d2) / SEPARATION_DIST);
          }
        }
      }
      if (this.state[i] === AgentState.Panicked) push += this.rng.range(-1.5, 1.5);
      this.t[i]! += push * 1.6 * dt;
      const hw = this.corridor.halfWidth(this.s[i]!) - 0.25;
      if (this.t[i]! < -hw) this.t[i] = -hw;
      if (this.t[i]! > hw) this.t[i] = hw;

      this.phase[i]! += v * dt * 2.2;
    }

    this.resolvePlayerInteractions(dt, player);
  }

  /** Lateral repulsion (dustbin smell clouds): crowd swerves away. */
  repelFrom(s: number, t: number, radius: number, strength: number): void {
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (this.state[i] === AgentState.Inactive) continue;
      const ds = this.s[i]! - s;
      if (ds > radius || ds < -radius) continue;
      const dtt = this.t[i]! - t;
      const d2 = ds * ds + dtt * dtt;
      if (d2 < radius * radius && d2 > 1e-6) {
        this.t[i]! += (dtt >= 0 ? 1 : -1) * strength * (1 - Math.sqrt(d2) / radius);
      }
    }
  }

  /** Dog bark ripple: panic agents within radius of (s, t). */
  panicNear(s: number, t: number, radius: number): void {
    const r2 = radius * radius;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (this.state[i] !== AgentState.Walking && this.state[i] !== AgentState.Stopped) continue;
      const ds = this.s[i]! - s;
      const dtt = this.t[i]! - t;
      if (ds * ds + dtt * dtt < r2) {
        this.state[i] = AgentState.Panicked;
        this.timer[i] = PANIC_TIME * this.rng.range(0.7, 1.3);
      }
    }
  }

  private resolvePlayerInteractions(dt: number, player: Player): void {
    void dt;
    const pHalf = player.hitHalfWidth;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (this.state[i] === AgentState.Inactive) continue;
      const arch = ARCHETYPES[this.archetype[i]!]!;
      const ds = Math.abs(this.s[i]! - player.s);
      const dtt = Math.abs(this.t[i]! - player.t);
      const reach = arch.halfWidth + pHalf;

      if (ds < 0.5 && dtt < reach) {
        // Band check: can the player's pose clear this obstruction?
        const cleared =
          (arch.band === Band.HIGH &&
            (player.pose === Pose.Duck ||
              player.pose === Pose.DipLeft ||
              player.pose === Pose.DipRight)) ||
          (arch.band === Band.LOW && player.jumping);
        if (!cleared) {
          const severity = arch.bumpDamage * (player.speed > SPEED_WALK + 0.5 ? 1.6 : 1);
          if (player.applyBump(severity)) {
            this.bus.emit('bump', { severity, agentIndex: i });
            // Shove the player off the agent so one knot doesn't multi-hit.
            player.t += player.t >= this.t[i]! ? 0.25 : -0.25;
          }
          this.nearMissDone[i] = 1;
        }
      } else if (
        ds < 0.7 &&
        dtt < reach + NEAR_MISS_DIST &&
        this.nearMissDone[i] === 0 &&
        this.speed[i]! > 0
      ) {
        // Passed close without touching → near-miss (once per agent).
        this.nearMissDone[i] = 1;
        this.bus.emit('nearMiss', { distance: dtt - reach, combo: 0 });
      }
    }
  }

  private maintainPopulation(playerS: number): void {
    // Despawn behind, count active.
    let active = 0;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (this.state[i] === AgentState.Inactive) continue;
      if (
        this.s[i]! < playerS - DESPAWN_BEHIND ||
        this.s[i]! > playerS + SPAWN_AHEAD_MAX + 30
      ) {
        this.state[i] = AgentState.Inactive;
        continue;
      }
      active++;
    }
    this.activeCount = active;
    while (active < this.config.density) {
      if (!this.spawnAgent(playerS + this.rng.range(SPAWN_AHEAD_MIN, SPAWN_AHEAD_MAX))) break;
      active++;
    }
    this.activeCount = active;
  }

  private spawnAgent(atS: number): boolean {
    const i = this.findFreeSlot();
    if (i < 0) return false;
    const archIdx = this.pickArchetype();
    const arch = ARCHETYPES[archIdx]!;
    this.s[i] = atS;
    const hw = this.corridor.halfWidth(atS) - 0.3;
    this.t[i] = this.rng.range(-hw, hw);
    this.baseSpeed[i] = this.rng.range(arch.speedMin, arch.speedMax);
    this.speed[i] = this.baseSpeed[i]!;
    this.phase[i] = this.rng.range(0, Math.PI * 2);
    this.timer[i] = 0;
    this.state[i] = AgentState.Walking;
    this.archetype[i] = archIdx;
    this.variant[i] = this.rng.int(0, 255);
    this.nearMissDone[i] = 0;
    return true;
  }

  private pickArchetype(): number {
    let total = 0;
    for (const a of ARCHETYPES) total += a.weight;
    let r = this.rng.next() * total;
    for (let i = 0; i < ARCHETYPES.length; i++) {
      r -= ARCHETYPES[i]!.weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  private freeCursor = 0;
  private findFreeSlot(): number {
    for (let k = 0; k < MAX_AGENTS; k++) {
      const i = (this.freeCursor + k) % MAX_AGENTS;
      if (this.state[i] === AgentState.Inactive) {
        this.freeCursor = i + 1;
        return i;
      }
    }
    return -1;
  }

  private rebuildSpatialHash(): void {
    this.spatial.clear();
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (this.state[i] === AgentState.Inactive) continue;
      const bucket = Math.floor(this.s[i]! / 2);
      let cell = this.spatial.get(bucket);
      if (!cell) {
        cell = [];
        this.spatial.set(bucket, cell);
      }
      cell.push(i);
    }
  }

  // --- Sand Watch snapshot ---
  static readonly SNAP_FLOATS = MAX_AGENTS * 6 + 2;

  snapshot(out: Float64Array, offset: number): void {
    let o = offset;
    out[o++] = this.activeCount;
    out[o++] = this.freeCursor;
    for (let i = 0; i < MAX_AGENTS; i++) {
      out[o++] = this.s[i]!;
      out[o++] = this.t[i]!;
      out[o++] = this.baseSpeed[i]!;
      out[o++] = this.phase[i]!;
      out[o++] = this.timer[i]!;
      // Pack the small ints into one float (each < 256).
      out[o++] =
        this.state[i]! + this.archetype[i]! * 256 + this.variant[i]! * 65536 +
        this.nearMissDone[i]! * 16777216;
    }
  }

  restore(from: Float64Array, offset: number): void {
    let o = offset;
    this.activeCount = from[o++]!;
    this.freeCursor = from[o++]!;
    for (let i = 0; i < MAX_AGENTS; i++) {
      this.s[i] = from[o++]!;
      this.t[i] = from[o++]!;
      this.baseSpeed[i] = from[o++]!;
      this.phase[i] = from[o++]!;
      this.timer[i] = from[o++]!;
      let packed = from[o++]!;
      this.state[i] = packed % 256;
      packed = Math.floor(packed / 256);
      this.archetype[i] = packed % 256;
      packed = Math.floor(packed / 256);
      this.variant[i] = packed % 256;
      this.nearMissDone[i] = Math.floor(packed / 256);
      this.speed[i] = this.state[i] === AgentState.Walking ? this.baseSpeed[i]! : 0;
    }
  }
}
