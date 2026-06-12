/**
 * Road-crossing minigame (idea.md §2.5). Pure sim.
 *
 * Crossing zones sit at route nodes flagged majorCrossing. Vehicles run
 * PERPENDICULAR to the corridor at the zone's s: their position is expressed
 * directly in the corridor's lateral axis t (so the whole minigame stays in
 * path coordinates). The player must pick gaps in the waves — or take the
 * overbridge: slow, safe, zero bonus.
 */
import type { EventBus } from '@/core/EventBus';
import type { RngStream } from '@/core/Rng';
import type { Player } from '@/player/Player';
import type { RunScore } from '@/economy/RunScore';

export const MAX_VEHICLES = 24;

export interface VehicleKind {
  id: string;
  speed: number; // m/s along t
  length: number; // size along its travel axis (t)
  width: number; // size along s
  damage: number;
  weaves: boolean; // bikes drift in s while moving
  color: string;
  height: number;
}

export const VEHICLE_KINDS: VehicleKind[] = [
  { id: 'bus', speed: 7, length: 9, width: 2.6, damage: 55, weaves: false, color: '#b04a3a', height: 3 },
  { id: 'cng', speed: 8, length: 2.6, width: 1.4, damage: 30, weaves: false, color: '#3a7d4f', height: 1.7 },
  { id: 'rickshaw', speed: 4, length: 2.2, width: 1.1, damage: 18, weaves: false, color: '#4a5fb0', height: 1.8 },
  { id: 'bike', speed: 10, length: 1.9, width: 0.8, damage: 28, weaves: true, color: '#333', height: 1.4 },
];

export interface CrossingZone {
  s: number;
  /** 1-5 traffic level → spawn pressure. */
  difficulty: number;
  /** Half-extent of the road along s. */
  halfWidth: number;
  crossed: boolean;
}

const ZONE_HALF = 4.5; // typical major road half-width along the route
const CROSS_BONUS_PER_DIFFICULTY = 15;
const SPAWN_EXTENT = 40; // vehicles travel t in [-extent, extent]

export class TrafficSystem {
  zones: CrossingZone[] = [];

  // SoA vehicle pool. Vehicles belong to the *nearest* active zone.
  readonly vS = new Float32Array(MAX_VEHICLES); // center s (zone s + lane offset)
  readonly vT = new Float32Array(MAX_VEHICLES); // position along the road
  readonly vDir = new Float32Array(MAX_VEHICLES); // +1/-1 travel direction
  readonly vKind = new Uint8Array(MAX_VEHICLES);
  readonly vActive = new Uint8Array(MAX_VEHICLES);
  readonly vWeavePhase = new Float32Array(MAX_VEHICLES);

  /** True while the player is inside a crossing band (HUD shows prompt). */
  inZone: CrossingZone | null = null;
  /** Overbridge auto-walk timer (>0 = climbing; player is invulnerable). */
  overbridgeTimer = 0;
  private overbridgeZone: CrossingZone | null = null;
  private zoneEnterEmitted = new Set<number>();

  constructor(
    private rng: RngStream,
    private bus: EventBus,
  ) {}

  setZones(zones: CrossingZone[]): void {
    this.zones = zones;
  }

  fixedUpdate(dt: number, player: Player, score: RunScore): void {
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

    // Which zone (if any) is the player near?
    this.inZone = null;
    for (let zi = 0; zi < this.zones.length; zi++) {
      const zone = this.zones[zi]!;
      const ds = player.s - (zone.s - zone.halfWidth);
      if (ds > -6 && player.s < zone.s + zone.halfWidth) {
        if (!zone.crossed) this.inZone = zone;
        if (!this.zoneEnterEmitted.has(zi) && ds > -6) {
          this.zoneEnterEmitted.add(zi);
          this.bus.emit('crossingEntered', { roadId: zi });
        }
      }
      // Direct-cross success: passed beyond the far edge without overbridge.
      if (!zone.crossed && player.s > zone.s + zone.halfWidth) {
        zone.crossed = true;
        if (this.overbridgeTimer <= 0) {
          const bonus = zone.difficulty * CROSS_BONUS_PER_DIFFICULTY;
          score.add(bonus, 'crossing');
          this.bus.emit('crossingResolved', { method: 'direct', bonus });
        }
      }
    }

    this.updateVehicles(dt, player);
  }

  /** HUD overbridge button pressed inside a zone. */
  useOverbridge(player: Player): boolean {
    if (!this.inZone || this.overbridgeTimer > 0) return false;
    if (player.s > this.inZone.s - 6 && player.s < this.inZone.s) {
      this.overbridgeTimer = (this.inZone.halfWidth * 2 + 4) / 2.0;
      this.overbridgeZone = this.inZone;
      return true;
    }
    return false;
  }

  private updateVehicles(dt: number, player: Player): void {
    // Spawn pressure for the nearest upcoming uncrossed zone.
    const zone = this.nearestZone(player.s);
    if (zone && Math.abs(player.s - zone.s) < 60) {
      const want = Math.min(MAX_VEHICLES, 4 + zone.difficulty * 3);
      let active = 0;
      for (let i = 0; i < MAX_VEHICLES; i++) if (this.vActive[i]) active++;
      if (active < want && this.rng.chance(dt * (0.5 + zone.difficulty * 0.35))) {
        this.spawnVehicle(zone);
      }
    }

    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (!this.vActive[i]) continue;
      const kind = VEHICLE_KINDS[this.vKind[i]!]!;
      this.vT[i]! += kind.speed * this.vDir[i]! * dt;
      if (kind.weaves) {
        this.vWeavePhase[i]! += dt * 2;
        this.vS[i]! += Math.sin(this.vWeavePhase[i]!) * 0.8 * dt;
      }
      if (Math.abs(this.vT[i]!) > SPAWN_EXTENT + 10) {
        this.vActive[i] = 0;
        continue;
      }
      // Hit check (skip while on the overbridge).
      if (this.overbridgeTimer <= 0 && player.y < 1.2) {
        const dsOverlap = Math.abs(player.s - this.vS[i]!) < kind.width / 2 + 0.35;
        const dtOverlap = Math.abs(player.t - this.vT[i]!) < kind.length / 2 + 0.3;
        if (dsOverlap && dtOverlap) {
          if (player.applyBump(kind.damage)) {
            this.bus.emit('vehicleHit', { vehicleKind: kind.id });
            // Knock the player back toward the near edge.
            player.s = this.vS[i]! - kind.width / 2 - 1.2;
          }
        }
      }
    }
  }

  private nearestZone(s: number): CrossingZone | null {
    let best: CrossingZone | null = null;
    let bestD = Infinity;
    for (const z of this.zones) {
      if (z.crossed) continue;
      const d = z.s - s;
      if (d > -z.halfWidth && d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  private spawnVehicle(zone: CrossingZone): void {
    let slot = -1;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (!this.vActive[i]) {
        slot = i;
        break;
      }
    }
    if (slot === -1) return;
    const kindIdx = this.rng.weighted([0, 1, 2, 3], [2, 3, 3, 2]);
    const dir = this.rng.chance(0.5) ? 1 : -1;
    // Two "lanes" per direction across the road's s extent.
    const lane = this.rng.chance(0.5) ? 0.45 : 0.8;
    this.vActive[slot] = 1;
    this.vKind[slot] = kindIdx;
    this.vDir[slot] = dir;
    this.vT[slot] = -dir * SPAWN_EXTENT;
    this.vS[slot] = zone.s + (dir > 0 ? -1 : 1) * zone.halfWidth * lane;
    this.vWeavePhase[slot] = this.rng.range(0, 6);
  }

  // --- Sand Watch snapshot ---
  static readonly SNAP_FLOATS = MAX_VEHICLES * 6 + 2 + 32;

  snapshot(out: Float32Array, offset: number): void {
    let o = offset;
    out[o++] = this.overbridgeTimer;
    out[o++] = this.overbridgeZone ? this.zones.indexOf(this.overbridgeZone) : -1;
    for (let z = 0; z < 32; z++) {
      out[o++] = z < this.zones.length ? (this.zones[z]!.crossed ? 1 : 0) : 0;
    }
    for (let i = 0; i < MAX_VEHICLES; i++) {
      out[o++] = this.vS[i]!;
      out[o++] = this.vT[i]!;
      out[o++] = this.vDir[i]!;
      out[o++] = this.vKind[i]!;
      out[o++] = this.vActive[i]!;
      out[o++] = this.vWeavePhase[i]!;
    }
  }

  restore(from: Float32Array, offset: number): void {
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
      this.vDir[i] = from[o++]!;
      this.vKind[i] = from[o++]!;
      this.vActive[i] = from[o++]!;
      this.vWeavePhase[i] = from[o++]!;
    }
  }
}

export { ZONE_HALF };
