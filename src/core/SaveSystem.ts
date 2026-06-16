/**
 * Versioned save system. One JSON blob persisted via Capacitor Preferences
 * (native) with localStorage fallback (web/dev). Migrations run in order on
 * load so old saves always upgrade cleanly.
 */
import { Preferences } from '@capacitor/preferences';

export interface SaveData {
  version: number;
  taka: number;
  /** Stars per area: areaId -> best stars (0-5) aggregated over runs. */
  stars: Record<string, number>;
  unlockedAreas: string[];
  ownedItems: string[];
  equippedOutfit: string;
  /** Shop id of the equipped character model (collection). */
  equippedCharacter: string;
  energy: { current: number; lastRefillEpoch: number };
  streak: { lastPlayDate: string; count: number };
  missions: Record<string, number>;
  dailyResults: Record<string, { timeS: number; taka: number; stars: number }>;
  leaderboards: Record<string, { name: string; score: number; date: string }[]>;
  ghosts: Record<string, number[]>; // seeded-route id -> packed keyframes
  settings: { lang: 'en' | 'bn'; audio: boolean; haptics: boolean };
  ftueDone: boolean;
  sandWatchCharge: number;
  glassesCharges: number;
  /** Last 10 runs for the home-screen history. */
  recentRuns: {
    date: string;
    area: string;
    taka: number;
    stars: number;
    success: boolean;
    distance: number;
  }[];
}

export const SAVE_KEY = 'cakewalk-save';
export const CURRENT_VERSION = 2;

export function defaultSave(): SaveData {
  return {
    version: CURRENT_VERSION,
    taka: 0,
    stars: {},
    unlockedAreas: ['dhanmondi'],
    ownedItems: [],
    equippedOutfit: 'default',
    equippedCharacter: 'char_man',
    energy: { current: 8, lastRefillEpoch: Date.now() },
    streak: { lastPlayDate: '', count: 0 },
    missions: {},
    dailyResults: {},
    leaderboards: {},
    ghosts: {},
    settings: { lang: 'en', audio: true, haptics: true },
    ftueDone: false,
    sandWatchCharge: 0,
    glassesCharges: 0,
    recentRuns: [],
  };
}

/** Migration from version N to N+1, keyed by N. */
type Migration = (old: Record<string, unknown>) => Record<string, unknown>;
const migrations: Record<number, Migration> = {
  // 1 -> 2: character collection added; default to the base "man" model.
  1: (old) => ({ ...old, version: 2, equippedCharacter: 'char_man' }),
};

export function migrate(raw: Record<string, unknown>): SaveData {
  let data = raw;
  let v = typeof data.version === 'number' ? data.version : 0;
  while (v < CURRENT_VERSION) {
    const step = migrations[v];
    if (!step) {
      // Unknown ancient/corrupt save: keep what overlaps, fill the rest.
      return { ...defaultSave(), ...pickKnownFields(data) };
    }
    data = step(data);
    v = data.version as number;
  }
  return { ...defaultSave(), ...pickKnownFields(data) };
}

function pickKnownFields(data: Record<string, unknown>): Partial<SaveData> {
  const def = defaultSave() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(def)) {
    if (key in data && shapeMatches(data[key], def[key])) out[key] = data[key];
  }
  return out as Partial<SaveData>;
}

/**
 * Structural validation: `typeof null === 'object'` and arrays masquerade as
 * objects, so a corrupt blob like {"energy": null} must NOT survive migration
 * (it would crash every boot until the user wipes app data).
 */
function shapeMatches(value: unknown, reference: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(reference)) return Array.isArray(value);
  if (typeof reference === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    // Every key the default object has must exist with a matching primitive type.
    for (const [k, refV] of Object.entries(reference as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[k];
      if (typeof refV !== 'object' && typeof v !== typeof refV) return false;
    }
    return true;
  }
  return typeof value === typeof reference;
}

export class SaveSystem {
  private data: SaveData = defaultSave();
  private dirty = false;

  async load(): Promise<SaveData> {
    try {
      const { value } = await Preferences.get({ key: SAVE_KEY });
      if (value) this.data = migrate(JSON.parse(value));
    } catch {
      this.data = defaultSave();
    }
    return this.data;
  }

  get(): SaveData {
    return this.data;
  }

  /** Mutate via callback; persisted on next flush (debounced by callers). */
  update(fn: (data: SaveData) => void): void {
    fn(this.data);
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await Preferences.set({ key: SAVE_KEY, value: JSON.stringify(this.data) });
  }
}
