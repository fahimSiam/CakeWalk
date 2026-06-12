/**
 * Per-run scoring: taka, near-miss combo, Cakewalk meter (idea.md §2.2, §6.1).
 * Pure sim. Listens to crowd events via the bus; distance taka is accrued
 * by RunState calling addDistance.
 */
import type { EventBus } from '@/core/EventBus';

const NEAR_MISS_BASE = 5;
const COMBO_STEP = 0.5; // each near miss adds 0.5x to multiplier
const COMBO_MAX_MULT = 5;
const METER_PER_NEARMISS = 0.09;
const METER_DECAY = 0.015; // per second
const METER_FULL_DURATION = 8; // seconds of doubled points
const TAKA_PER_METER = 0.4;

export class RunScore {
  taka = 0;
  combo = 0;
  meter = 0; // 0..1 Cakewalk meter
  /** >1 with Headphones (meter fills faster). */
  meterGainMul = 1;
  meterActive = 0; // seconds remaining of doubled points
  stolenTotal = 0;
  nearMisses = 0;
  bestCombo = 0;
  private distanceCarry = 0;

  constructor(private bus: EventBus) {
    bus.on('nearMiss', () => this.onNearMiss());
    bus.on('bump', () => this.breakCombo('bump'));
    bus.on('catStumble', () => this.breakCombo('stumble'));
    bus.on('stareMisread', () => {
      // Misread penalty is gentle: lose part of the combo, not all.
      this.combo = Math.floor(this.combo / 2);
    });
  }

  get multiplier(): number {
    const comboMult = Math.min(1 + this.combo * COMBO_STEP, COMBO_MAX_MULT);
    return this.meterActive > 0 ? comboMult * 2 : comboMult;
  }

  fixedUpdate(dt: number): void {
    if (this.meterActive > 0) {
      this.meterActive = Math.max(0, this.meterActive - dt);
    } else if (this.meter > 0) {
      this.meter = Math.max(0, this.meter - METER_DECAY * dt);
    }
  }

  addDistance(meters: number): void {
    this.distanceCarry += meters * TAKA_PER_METER * this.multiplier;
    if (this.distanceCarry >= 1) {
      const whole = Math.floor(this.distanceCarry);
      this.distanceCarry -= whole;
      this.add(whole, 'distance');
    }
  }

  add(amount: number, reason: string): void {
    if (amount === 0) return;
    this.taka += amount;
    this.bus.emit('takaChanged', { delta: amount, total: this.taka, reason });
  }

  /** Pickpocket theft. Returns the amount actually stolen. */
  steal(amount: number, source: 'walk' | 'phone' | 'seated'): number {
    const stolen = Math.min(this.taka, Math.floor(amount));
    if (stolen <= 0) return 0;
    this.taka -= stolen;
    this.stolenTotal += stolen;
    this.bus.emit('theft', { amount: stolen, source });
    this.bus.emit('takaChanged', { delta: -stolen, total: this.taka, reason: 'theft' });
    return stolen;
  }

  private onNearMiss(): void {
    this.combo++;
    this.nearMisses++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.add(Math.round(NEAR_MISS_BASE * this.multiplier), 'nearMiss');
    if (this.meterActive === 0) {
      this.meter = Math.min(1, this.meter + METER_PER_NEARMISS * this.meterGainMul);
      if (this.meter >= 1) {
        this.meter = 0;
        this.meterActive = METER_FULL_DURATION;
        this.bus.emit('cakewalkMeterFull', {});
      }
    }
  }

  private breakCombo(reason: 'bump' | 'stumble'): void {
    if (this.combo > 0) this.bus.emit('comboBroken', { combo: this.combo, reason });
    this.combo = 0;
  }

  // --- Sand Watch snapshot ---
  static readonly SNAP_FLOATS = 8;

  snapshot(out: Float64Array, offset: number): void {
    out[offset] = this.taka;
    out[offset + 1] = this.combo;
    out[offset + 2] = this.meter;
    out[offset + 3] = this.meterActive;
    out[offset + 4] = this.stolenTotal;
    out[offset + 5] = this.nearMisses;
    out[offset + 6] = this.bestCombo;
    out[offset + 7] = this.distanceCarry;
  }

  restore(from: Float64Array, offset: number): void {
    this.taka = from[offset]!;
    this.combo = from[offset + 1]!;
    this.meter = from[offset + 2]!;
    this.meterActive = from[offset + 3]!;
    this.stolenTotal = from[offset + 4]!;
    this.nearMisses = from[offset + 5]!;
    this.bestCombo = from[offset + 6]!;
    this.distanceCarry = from[offset + 7]!;
  }
}
