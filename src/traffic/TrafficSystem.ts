/**
 * Traffic, two jobs (idea.md §2.5 + Rev 6 cartoon pivot):
 *
 * 1. STREAM: fast vehicles flow constantly along the road BESIDE the
 *    footpath, always opposite to the player — the vehicular mirror of the
 *    crowd. Pure ambiance + dread; they never leave the road.
 *
 * 2. CROSSINGS: zones at major-road intersections trigger the separate
 *    Crossy-Roads-style 2D minigame (ui/CrossingMinigame). This system only
 *    detects arrival and applies the outcome; the overbridge remains the
 *    safe skip.
 */
import type { EventBus } from '@/core/EventBus';
import type { RngStream } from '@/core/Rng';
import { ROAD_EDGE_T, type Player } from '@/player/Player';
import type { RunScore } from '@/economy/RunScore';

export const MAX_VEHICLES = 14;

export interface VehicleKind {
  id: string;
  speedMin: number;
  speedMax: number;
  length: number; // along the road (s axis)
  color: string;
  height: number;
  width: number;
}

export const VEHICLE_KINDS: VehicleKind[] = [
  { id: 'bus', speedMin: 11, speedMax: 15, length: 9, width: 2.6, color: '#b04a3a', height: 3 },
  { id: 'cng', speedMin: 12, speedMax: 17, length: 2.6, width: 1.4, color: '#3a7d4f', height: 1.7 },
  { id: 'rickshaw', speedMin: 6, speedMax: 9, length: 2.2, width: 1.1, color: '#4a5fb0', height: 1.8 },
  { id: 'bike', speedMin: 16, speedMax: 21, length: 1.9, width: 0.8, color: '#333', height: 1.4 },
  // Cars (Poly Pizza GLBs) — realistic proportions so nothing looks oversized.
  { id: 'car', speedMin: 13, speedMax: 18, length: 4.3, width: 1.8, color: '#d23a3a', height: 1.5 },
  { id: 'taxi', speedMin: 12, speedMax: 17, length: 4.4, width: 1.85, color: '#f4c20d', height: 1.5 },
  { id: 'suv', speedMin: 13, speedMax: 18, length: 4.7, width: 1.95, color: '#3a6ea5', height: 1.7 },
];

/** Road lanes left of the footpath (negative t), nearest first. */
export const STREAM_LANES = [-4.2, -6.1, -8.0, -9.6];

export interface CrossingZone {
  s: number;
  difficulty: number; // 1-5 → minigame lanes/speed
  halfWidth: number;
  crossed: boolean;
}

const CROSS_BONUS_PER_DIFFICULTY = 15;

export class TrafficSystem {
  zones: CrossingZone[] = [];

  // SoA stream-vehicle pool: vS along the route, vT = fixed lane.
  readonly vS = new Float32Array(MAX_VEHICLES);
  readonly vT = new Float32Array(MAX_VEHICLES);
  readonly vSpeed = new Float32Array(MAX_VEHICLES);
  readonly vKind = new Uint8Array(MAX_VEHICLES);
  readonly vActive = new Uint8Array(MAX_VEHICLES);

  /** Zone awaiting the crossing minigame (RunState consumes this). */
  pendingZone: CrossingZone | null = null;
  /** Overbridge auto-walk timer (>0 = climbing; safely above it all). */
  overbridgeTimer = 0;
  private overbridgeZone: CrossingZone | null = null;

  constructor(
    private rng: RngStream,
    private bus: EventBus,
  ) {}

  setZones(zones: CrossingZone[]): void {
    // Merge zones closer than 25 m so crossings don't chain unfairly.
    zones.sort((a, b) => a.s - b.s);
    this.zones = zones.filter((z, i) => i === 0 || z.s - zones[i - 1]!.s > 25);
  }

  fixedUpdate(dt: number, player: Player, _score: RunScore): void {
    // Overbridge auto-walk: lift the player over the road.
    if (this.overbridgeTimer > 0) {
      this.overbridgeTimer -= dt;
      player.s += 2.0 * dt;
      player.y = Math.min(4, player.y + (this.overbridgeTimer > 1.2 ? 3 : -3) * dt * 2);
      if (this.overbridgeTimer <= 0) {
        player.y = 0;
        if (this.overbridgeZone) this.overbridgeZone.crossed = true;
        this.bus.emit('crossingResolved', { method: 'overbridge', bonus: 0 });
        this.overbridgeZone = null;
      }
    }

    // Arriving at an uncrossed zone hands control to the minigame.
    if (!this.pendingZone && this.overbridgeTimer <= 0) {
      for (const zone of this.zones) {
        if (zone.crossed) continue;
        if (player.s >= zone.s - 2 && player.s < zone.s + zone.halfWidth) {
          this.pendingZone = zone;
          this.bus.emit('crossingEntered', { roadId: this.zones.indexOf(zone) });
          break;
        }
      }
    }

    this.updateStream(dt, player);
  }

  /** Minigame outcome (or overbridge skip from inside the minigame). */
  resolveCrossing(
    zone: CrossingZone,
    result: 'crossed' | 'skipped' | 'hit',
    player: Player,
    score: RunScore,
  ): void {
    this.pendingZone = null;
    if (result === 'crossed') {
      zone.crossed = true;
      const bonus = zone.difficulty * CROSS_BONUS_PER_DIFFICULTY;
      score.add(bonus, 'crossing');
      player.s = zone.s + zone.halfWidth + 1.5;
      this.bus.emit('crossingResolved', { method: 'direct', bonus });
    } else if (result === 'skipped') {
      zone.crossed = true;
      player.s = zone.s + zone.halfWidth + 1.5;
      player.stamina = Math.max(0, player.stamina - 18); // stairs cost sweat
      this.bus.emit('crossingResolved', { method: 'overbridge', bonus: 0 });
    } else {
      // Clipped by a car: hurt + knocked back to approach again.
      if (player.applyBump(32)) this.bus.emit('vehicleHit', { vehicleKind: 'car' });
      player.s = zone.s - zone.halfWidth - 8;
    }
  }

  /** Legacy/manual overbridge from the HUD before the zone triggers. */
  useOverbridge(player: Player): boolean {
    const zone = this.pendingZone;
    if (!zone || this.overbridgeTimer > 0) return false;
    this.pendingZone = null;
    const remaining = zone.s + zone.halfWidth + 2 - player.s;
    this.overbridgeTimer = Math.max(1.5, remaining / 2.0);
    this.overbridgeZone = zone;
    return true;
  }

  /** The endless oncoming stream beside the footpath. */
  private updateStream(dt: number, player: Player): void {
    // High-risk road: if the player has stepped off the footpath onto the
    // road (and isn't airborne / on the overbridge), oncoming cars can hit.
    const onRoad = player.t < ROAD_EDGE_T && player.y < 0.9 && this.overbridgeTimer <= 0;
    let active = 0;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (!this.vActive[i]) continue;
      this.vS[i]! -= this.vSpeed[i]! * dt; // always toward/past the player
      if (onRoad) {
        const kind = VEHICLE_KINDS[this.vKind[i]!]!;
        if (
          Math.abs(player.t - this.vT[i]!) < kind.width / 2 + player.hitHalfWidth &&
          Math.abs(player.s - this.vS[i]!) < kind.length / 2 + 0.5
        ) {
          if (player.applyBump(28)) {
            this.bus.emit('vehicleHit', { vehicleKind: kind.id });
            player.t = ROAD_EDGE_T - 0.2; // shoved back toward the footpath
          }
        }
      }
      if (this.vS[i]! < player.s - 20) {
        this.vActive[i] = 0;
        continue;
      }
      active++;
    }
    const want = 12;
    if (active < want && this.rng.chance(dt * 2.4)) {
      for (let i = 0; i < MAX_VEHICLES; i++) {
        if (this.vActive[i]) continue;
        const kindIdx = this.rng.weighted(
          [0, 1, 2, 3, 4, 5, 6],
          [2, 3, 2, 2, 3, 2, 2],
        );
        const kind = VEHICLE_KINDS[kindIdx]!;
        this.vActive[i] = 1;
        this.vKind[i] = kindIdx;
        this.vS[i] = player.s + this.rng.range(70, 130);
        this.vT[i] = this.rng.pick(STREAM_LANES);
        this.vSpeed[i] = this.rng.range(kind.speedMin, kind.speedMax);
        break;
      }
    }
  }

  // --- Sand Watch snapshot ---
  static readonly SNAP_FLOATS = MAX_VEHICLES * 5 + 2 + 32;

  snapshot(out: Float64Array, offset: number): void {
    let o = offset;
    out[o++] = this.overbridgeTimer;
    out[o++] = this.overbridgeZone ? this.zones.indexOf(this.overbridgeZone) : -1;
    for (let z = 0; z < 32; z++) {
      out[o++] = z < this.zones.length ? (this.zones[z]!.crossed ? 1 : 0) : 0;
    }
    for (let i = 0; i < MAX_VEHICLES; i++) {
      out[o++] = this.vS[i]!;
      out[o++] = this.vT[i]!;
      out[o++] = this.vSpeed[i]!;
      out[o++] = this.vKind[i]!;
      out[o++] = this.vActive[i]!;
    }
  }

  restore(from: Float64Array, offset: number): void {
    let o = offset;
    this.overbridgeTimer = from[o++]!;
    const obz = from[o++]!;
    this.overbridgeZone = obz >= 0 ? (this.zones[obz] ?? null) : null;
    for (let z = 0; z < 32; z++) {
      const crossed = from[o++]!;
      if (z < this.zones.length) this.zones[z]!.crossed = crossed === 1;
    }
    for (let i = 0; i < MAX_VEHICLES; i++) {
      this.vS[i] = from[o++]!;
      this.vT[i] = from[o++]!;
      this.vSpeed[i] = from[o++]!;
      this.vKind[i] = from[o++]!;
      this.vActive[i] = from[o++]!;
    }
    this.pendingZone = null;
  }
}
