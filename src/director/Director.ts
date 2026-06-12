/**
 * Frustration budget + micro-events (idea.md §6.1, §6.7).
 *
 * The Director caps concurrent pressure: after a heavy bump, a theft, or a
 * bark-panic ripple, pickpocket activity is suppressed for a window so the
 * player is never mugged while already down. It also schedules light
 * micro-events ("mama moments") that add texture without damage.
 */
import type { EventBus } from '@/core/EventBus';
import type { RngStream } from '@/core/Rng';
import type { Player } from '@/player/Player';

const SUPPRESS_AFTER_BUMP = 6;
const SUPPRESS_AFTER_THEFT = 12;
const SUPPRESS_AFTER_PANIC = 8;

const MICRO_EVENTS = ['hawkerPitch', 'directionsAsk', 'teaOffer'] as const;
export type MicroEventKind = (typeof MICRO_EVENTS)[number];

export class Director {
  private suppressTimer = 0;
  private microTimer = 25;
  /** Set while a micro-event slow-zone is active. */
  microSlow = 0;

  constructor(
    private rng: RngStream,
    private bus: EventBus,
  ) {
    bus.on('bump', (e) => {
      if (e.severity >= 8) this.suppress(SUPPRESS_AFTER_BUMP);
    });
    bus.on('theft', () => this.suppress(SUPPRESS_AFTER_THEFT));
    bus.on('dogBark', () => this.suppress(SUPPRESS_AFTER_PANIC));
  }

  /** Gate consumed by PickpocketSystem.config.canSpawn. */
  canSpawnPickpocket = (): boolean => this.suppressTimer <= 0;

  fixedUpdate(dt: number, player: Player): void {
    if (this.suppressTimer > 0) this.suppressTimer -= dt;
    if (this.microSlow > 0) {
      this.microSlow -= dt;
      // A hawker holding your sleeve: gentle slow unless you swerve hard.
      player.s -= Math.min(player.speed * 0.35, 1.2) * dt;
    }
    this.microTimer -= dt;
    if (this.microTimer <= 0) {
      this.microTimer = this.rng.range(22, 45);
      if (this.suppressTimer <= 0 && !player.resting && !player.phoneLocked) {
        const kind = this.rng.pick(MICRO_EVENTS);
        this.microSlow = 1.4;
        this.bus.emit('microEvent', { kind });
      }
    }
  }

  private suppress(seconds: number): void {
    this.suppressTimer = Math.max(this.suppressTimer, seconds);
  }

  // --- Sand Watch snapshot ---
  static readonly SNAP_FLOATS = 3;

  snapshot(out: Float64Array, offset: number): void {
    out[offset] = this.suppressTimer;
    out[offset + 1] = this.microTimer;
    out[offset + 2] = this.microSlow;
  }

  restore(from: Float64Array, offset: number): void {
    this.suppressTimer = from[offset]!;
    this.microTimer = from[offset + 1]!;
    this.microSlow = from[offset + 2]!;
  }
}
