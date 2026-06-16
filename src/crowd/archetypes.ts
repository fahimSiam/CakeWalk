/**
 * Crowd archetype data (idea.md §2.2). Pure data — both sim (speeds, hitboxes,
 * collision bands) and rendering (palette, scale) read from here.
 *
 * Collision bands: which vertical band of the player an agent's obstruction
 * occupies. The player clears HIGH obstructions by dipping/ducking and LOW
 * ones by jumping; FULL always collides.
 */

export enum Band {
  FULL = 0, // normal body — always bumps
  HIGH = 1, // head-height load — clear when dipped past it / ducked
  LOW = 2, // ground-level — clear when jumping
}

export interface Archetype {
  id: string;
  /** Walking speed range, m/s. */
  speedMin: number;
  speedMax: number;
  /** Lateral half-width of the hitbox, meters. */
  halfWidth: number;
  band: Band;
  /** Damage dealt on bump (scaled up at jog speed). */
  bumpDamage: number;
  /** Probability per second of stopping suddenly (phone call etc.). */
  stopChance: number;
  /** Relative spawn weight (per-area/theme multipliers applied on top). */
  weight: number;
  /** Render: body scale + palette family. */
  scale: number;
  palette: 'male' | 'female' | 'vendor' | 'worker';
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'uncle',
    speedMin: 0.9,
    speedMax: 1.3,
    halfWidth: 0.42,
    band: Band.FULL,
    bumpDamage: 8,
    stopChance: 0.02,
    weight: 20,
    scale: 1.0,
    palette: 'male',
  },
  {
    id: 'commuter',
    speedMin: 1.4,
    speedMax: 2.0,
    halfWidth: 0.34,
    band: Band.FULL,
    bumpDamage: 6,
    stopChance: 0.01,
    weight: 30,
    scale: 1.0,
    palette: 'male',
  },
  {
    id: 'commuterF',
    speedMin: 1.3,
    speedMax: 1.9,
    halfWidth: 0.34,
    band: Band.FULL,
    bumpDamage: 6,
    stopChance: 0.01,
    weight: 18,
    scale: 0.95,
    palette: 'female',
  },
  {
    id: 'deliveryGuy',
    speedMin: 2.6,
    speedMax: 3.4,
    halfWidth: 0.3,
    band: Band.FULL,
    bumpDamage: 12,
    stopChance: 0,
    weight: 8,
    scale: 1.0,
    palette: 'worker',
  },
  {
    id: 'hawker',
    speedMin: 0.7,
    speedMax: 1.1,
    halfWidth: 0.55,
    band: Band.FULL,
    bumpDamage: 7,
    stopChance: 0.06,
    weight: 7,
    scale: 1.0,
    palette: 'vendor',
  },
  {
    id: 'headLoadCarrier',
    // Carries a wide sack at head height: body is narrow but the load band
    // is HIGH — dip/duck slides under the overhang. Eid exodus staple.
    speedMin: 1.0,
    speedMax: 1.4,
    halfWidth: 0.52,
    band: Band.HIGH,
    bumpDamage: 10,
    stopChance: 0.01,
    weight: 10,
    scale: 1.0,
    palette: 'worker',
  },
  {
    id: 'luggageDragger',
    // Eid theme: drags a crate/trolley at ground level — JUMP over it (LOW band).
    speedMin: 0.9,
    speedMax: 1.3,
    halfWidth: 0.48,
    band: Band.LOW,
    bumpDamage: 8,
    stopChance: 0.04,
    weight: 9,
    scale: 1.0,
    palette: 'male',
  },
  {
    id: 'phoneStopper',
    speedMin: 1.2,
    speedMax: 1.7,
    halfWidth: 0.34,
    band: Band.FULL,
    bumpDamage: 6,
    stopChance: 0.12,
    weight: 8,
    scale: 1.0,
    palette: 'female',
  },
];

export const ARCHETYPE_INDEX: Record<string, number> = Object.fromEntries(
  ARCHETYPES.map((a, i) => [a.id, i]),
);
