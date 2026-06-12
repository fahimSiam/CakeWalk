/**
 * Energy meta-system (idea.md §5): starting a NEW run costs energy; retrying
 * a failed run is FREE (the Flappy Bird loop stays intact). Generous tune:
 * 8 runs per bar, one energy back every 12 minutes. Ads refill fully.
 */
import type { SaveData } from '@/core/SaveSystem';

export const ENERGY_MAX = 8;
export const RECHARGE_MS = 12 * 60 * 1000;

/** Applies passive recharge based on wall-clock time. */
export function rechargeEnergy(save: SaveData, now = Date.now()): void {
  const e = save.energy;
  if (e.current >= ENERGY_MAX) {
    e.lastRefillEpoch = now;
    return;
  }
  const gained = Math.floor((now - e.lastRefillEpoch) / RECHARGE_MS);
  if (gained > 0) {
    e.current = Math.min(ENERGY_MAX, e.current + gained);
    e.lastRefillEpoch += gained * RECHARGE_MS;
  }
}

export function canStartRun(save: SaveData): boolean {
  return save.energy.current > 0;
}

/** Spend one energy for a fresh run. Retries must NOT call this. */
export function spendEnergy(save: SaveData): boolean {
  if (save.energy.current <= 0) return false;
  if (save.energy.current === ENERGY_MAX) save.energy.lastRefillEpoch = Date.now();
  save.energy.current--;
  return true;
}

export function refillEnergy(save: SaveData): void {
  save.energy.current = ENERGY_MAX;
  save.energy.lastRefillEpoch = Date.now();
}

/** ms until the next energy point (for the menu countdown). */
export function msToNextEnergy(save: SaveData, now = Date.now()): number {
  if (save.energy.current >= ENERGY_MAX) return 0;
  return Math.max(0, save.energy.lastRefillEpoch + RECHARGE_MS - now);
}
