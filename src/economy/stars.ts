/**
 * 5-star run rating — one star per criterion so every rating tells the
 * player what to improve (idea.md §4). Rulings: tutorial runs are unrated;
 * a theft undone by Sand Watch rewind doesn't break the wallet star (the
 * rewind restores RunScore.stolenTotal, so that's automatic).
 */
import type { RouteOption } from '@/routing/RouteGraph';

export interface RunStats {
  success: boolean;
  timeS: number;
  healthFraction: number; // 0..1 at the finish
  stolenTotal: number;
  bestCombo: number;
}

export interface StarBreakdown {
  finish: boolean;
  pace: boolean;
  health: boolean;
  wallet: boolean;
  streetSmart: boolean;
  total: number;
}

/** Par pace ~1.45 m/s plus a time allowance per crossing. */
export function parTimeS(route: Pick<RouteOption, 'lengthM' | 'crossings'>): number {
  return route.lengthM / 1.45 + route.crossings * 18;
}

export function rateRun(stats: RunStats, route: Pick<RouteOption, 'lengthM' | 'crossings'>): StarBreakdown {
  const finish = stats.success;
  const pace = finish && stats.timeS <= parTimeS(route);
  const health = finish && stats.healthFraction > 0.5;
  const wallet = finish && stats.stolenTotal === 0;
  const streetSmart = finish && stats.bestCombo >= 8;
  const total = [finish, pace, health, wallet, streetSmart].filter(Boolean).length;
  return { finish, pace, health, wallet, streetSmart, total };
}

/** Area unlock chain: stars accumulated across areas gate the next one. */
export const AREA_ORDER = [
  'dhanmondi',
  'uttara',
  'bashundhara',
  'mohammadpur',
  'puran_dhaka',
  'gulistan',
] as const;

/** Best-run stars per area (max 5 each, 30 total) gate the chain. */
export const UNLOCK_COST: Record<string, number> = {
  dhanmondi: 0,
  uttara: 3,
  bashundhara: 7,
  mohammadpur: 12,
  puran_dhaka: 18,
  gulistan: 24,
};

export function totalStars(stars: Record<string, number>): number {
  return Object.values(stars).reduce((a, b) => a + b, 0);
}

export function unlockedAreas(stars: Record<string, number>): string[] {
  const total = totalStars(stars);
  return AREA_ORDER.filter((id) => total >= (UNLOCK_COST[id] ?? Infinity));
}
