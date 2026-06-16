import { describe, expect, it } from 'vitest';
import { defaultSave } from '@/core/SaveSystem';
import {
  ENERGY_MAX,
  RECHARGE_MS,
  canStartRun,
  msToNextEnergy,
  rechargeEnergy,
  refillEnergy,
  spendEnergy,
} from '@/meta/Energy';
import { rateRun, parTimeS, unlockedAreas, totalStars, UNLOCK_COST } from '@/economy/stars';
import {
  applyRunToMissions,
  buyItem,
  dailyMissions,
  lockedCharacters,
  packGhost,
  touchStreak,
  unpackGhost,
} from '@/meta/progression';
import { migrate, CURRENT_VERSION } from '@/core/SaveSystem';

describe('Character collection', () => {
  it('buys, owns, and equips a character', () => {
    const save = defaultSave();
    save.taka = 1000;
    expect(save.equippedCharacter).toBe('char_man');
    expect(buyItem(save, 'char_woman')).toBe(true);
    expect(save.ownedItems).toContain('char_woman');
    expect(save.equippedCharacter).toBe('char_woman'); // auto-worn on buy
    // Re-buy is refused; equipping owned is free.
    expect(buyItem(save, 'char_woman')).toBe(false);
  });

  it('mystery box unlocks a random un-owned character, then refuses when complete', () => {
    const save = defaultSave();
    save.taka = 100000;
    const total = lockedCharacters(save).length;
    expect(total).toBeGreaterThan(0);
    for (let i = 0; i < total; i++) {
      expect(buyItem(save, 'mystery_box')).toBe(true);
    }
    expect(lockedCharacters(save).length).toBe(0);
    // Nothing left to unlock → the box won't sell.
    expect(buyItem(save, 'mystery_box')).toBe(false);
  });
});

describe('Energy', () => {
  it('spends and refuses at zero', () => {
    const save = defaultSave();
    expect(save.energy.current).toBe(ENERGY_MAX);
    for (let i = 0; i < ENERGY_MAX; i++) expect(spendEnergy(save)).toBe(true);
    expect(spendEnergy(save)).toBe(false);
    expect(canStartRun(save)).toBe(false);
  });

  it('recharges on the wall clock', () => {
    const save = defaultSave();
    save.energy.current = 2;
    save.energy.lastRefillEpoch = Date.now() - RECHARGE_MS * 3 - 1000;
    rechargeEnergy(save);
    expect(save.energy.current).toBe(5);
    expect(msToNextEnergy(save)).toBeGreaterThan(0);
    expect(msToNextEnergy(save)).toBeLessThanOrEqual(RECHARGE_MS);
  });

  it('ad refill fills the bar', () => {
    const save = defaultSave();
    save.energy.current = 0;
    refillEnergy(save);
    expect(save.energy.current).toBe(ENERGY_MAX);
  });
});

describe('Stars', () => {
  const route = { lengthM: 1000, crossings: 2 };

  it('one star per criterion', () => {
    const perfect = rateRun(
      { success: true, timeS: parTimeS(route) - 10, healthFraction: 0.9, stolenTotal: 0, bestCombo: 12 },
      route,
    );
    expect(perfect.total).toBe(5);
    const failed = rateRun(
      { success: false, timeS: 100, healthFraction: 0, stolenTotal: 0, bestCombo: 20 },
      route,
    );
    expect(failed.total).toBe(0); // no stars without finishing
    const slowSurvivor = rateRun(
      { success: true, timeS: parTimeS(route) + 100, healthFraction: 0.3, stolenTotal: 50, bestCombo: 2 },
      route,
    );
    expect(slowSurvivor.total).toBe(1);
  });

  it('area chain unlocks by total stars', () => {
    expect(unlockedAreas({})).toEqual(['dhanmondi']);
    const stars = { dhanmondi: 5 };
    expect(unlockedAreas(stars)).toContain('uttara');
    expect(unlockedAreas(stars)).not.toContain('gulistan');
    const all = { dhanmondi: 5, uttara: 5, bashundhara: 5, mohammadpur: 5, puran_dhaka: 5 };
    expect(totalStars(all)).toBeGreaterThanOrEqual(UNLOCK_COST.gulistan!);
    expect(unlockedAreas(all)).toContain('gulistan');
  });
});

describe('Streak', () => {
  it('increments on consecutive days and resets after a gap', () => {
    const save = defaultSave();
    expect(touchStreak(save, '2026-06-12')).toBe(1);
    expect(touchStreak(save, '2026-06-12')).toBe(1); // same day no double
    save.streak.lastPlayDate = '2026-06-11';
    save.streak.count = 4;
    // touchStreak compares against real yesterday; emulate via direct logic:
    const yesterdayKey = new Date(Date.now() - 86400000);
    const key = `${yesterdayKey.getFullYear()}-${String(yesterdayKey.getMonth() + 1).padStart(2, '0')}-${String(yesterdayKey.getDate()).padStart(2, '0')}`;
    save.streak.lastPlayDate = key;
    expect(touchStreak(save)).toBe(5);
    save.streak.lastPlayDate = '2020-01-01';
    expect(touchStreak(save)).toBe(1);
  });
});

describe('Missions', () => {
  it('returns 3 deterministic missions per date', () => {
    const a = dailyMissions('2026-06-12');
    const b = dailyMissions('2026-06-12');
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(a).toHaveLength(3);
    expect(new Set(a.map((m) => m.id)).size).toBe(3);
  });

  it('pays out once on completion', () => {
    const save = defaultSave();
    const missions = dailyMissions();
    const summary = { chaCups: 99, fruits: 99, directCrossings: 99, nearMisses: 99, spotted: 99, distanceM: 99999 };
    const earned = applyRunToMissions(save, summary);
    expect(earned).toBe(missions.reduce((a, m) => a + m.reward, 0));
    expect(applyRunToMissions(save, summary)).toBe(0); // already complete
  });
});

describe('Shop', () => {
  it('buys within budget, no double-buy of permanents', () => {
    const save = defaultSave();
    save.taka = 500;
    expect(buyItem(save, 'shoes')).toBe(true);
    expect(save.taka).toBe(100);
    expect(buyItem(save, 'shoes')).toBe(false);
    expect(buyItem(save, 'sandWatch')).toBe(false); // too expensive
  });

  it('glasses stack charges', () => {
    const save = defaultSave();
    save.taka = 400;
    expect(buyItem(save, 'glasses')).toBe(true);
    expect(buyItem(save, 'glasses')).toBe(true);
    expect(save.glassesCharges).toBe(6);
    expect(save.ownedItems).not.toContain('glasses');
  });
});

describe('Ghost packing', () => {
  it('round-trips keyframes with quantization', () => {
    const frames = [
      { s: 12.345, t: -1.234 },
      { s: 13.05, t: 0.5 },
    ];
    const unpacked = unpackGhost(packGhost(frames));
    expect(unpacked).toHaveLength(2);
    expect(unpacked[0]!.s).toBeCloseTo(12.3, 1);
    expect(unpacked[0]!.t).toBeCloseTo(-1.23, 2);
  });
});

describe('Save migration with new fields', () => {
  it('old saves gain the new defaults', () => {
    const out = migrate({ version: CURRENT_VERSION, taka: 50 });
    expect(out.glassesCharges).toBe(0);
    expect(out.equippedOutfit).toBe('default');
    expect(out.energy.current).toBeGreaterThan(0);
  });
});
