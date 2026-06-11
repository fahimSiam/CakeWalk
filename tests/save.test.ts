import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, defaultSave, migrate } from '@/core/SaveSystem';

describe('save migration', () => {
  it('upgrades an empty/corrupt blob to defaults', () => {
    const out = migrate({});
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.unlockedAreas).toEqual(['dhanmondi']);
  });

  it('preserves known fields with matching types', () => {
    const out = migrate({ version: CURRENT_VERSION, taka: 777, ftueDone: true });
    expect(out.taka).toBe(777);
    expect(out.ftueDone).toBe(true);
  });

  it('discards fields with wrong types', () => {
    const out = migrate({ version: CURRENT_VERSION, taka: 'lots' });
    expect(out.taka).toBe(defaultSave().taka);
  });
});
