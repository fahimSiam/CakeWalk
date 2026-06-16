/**
 * Streaks, missions, shop catalog, ghost packing — the light meta layer
 * around runs. All state lives in the save blob.
 */
import type { SaveData } from '@/core/SaveSystem';

// ---------- Streak (Duolingo guilt) ----------

export function touchStreak(save: SaveData, today = localDateKey()): number {
  const st = save.streak;
  if (st.lastPlayDate === today) return st.count;
  const yesterday = localDateKey(new Date(Date.now() - 86400000));
  st.count = st.lastPlayDate === yesterday ? st.count + 1 : 1;
  st.lastPlayDate = today;
  return st.count;
}

export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- Missions ----------

export interface MissionDef {
  id: string;
  textEn: string;
  textBn: string;
  target: number;
  reward: number;
  /** Which RunSummary stat feeds this mission. */
  stat: keyof RunSummary;
}

export interface RunSummary {
  chaCups: number;
  fruits: number;
  directCrossings: number;
  nearMisses: number;
  spotted: number;
  distanceM: number;
}

export const MISSION_POOL: MissionDef[] = [
  { id: 'cha3', textEn: 'Drink cha at 3 stalls', textBn: '৩টি দোকানে চা খান', target: 3, reward: 50, stat: 'chaCups' },
  { id: 'fruit5', textEn: 'Grab 5 fruits', textBn: '৫টি ফল ধরুন', target: 5, reward: 40, stat: 'fruits' },
  { id: 'cross4', textEn: 'Cross 4 roads without the overbridge', textBn: 'ওভারব্রিজ ছাড়া ৪টি রাস্তা পার হন', target: 4, reward: 60, stat: 'directCrossings' },
  { id: 'near30', textEn: '30 near-misses', textBn: '৩০ বার অল্পের জন্য বাঁচুন', target: 30, reward: 45, stat: 'nearMisses' },
  { id: 'spot3', textEn: 'Spot 3 pocketmars', textBn: '৩ জন পকেটমার ধরুন', target: 3, reward: 70, stat: 'spotted' },
  { id: 'walk3k', textEn: 'Walk 3 km', textBn: '৩ কিমি হাঁটুন', target: 3000, reward: 50, stat: 'distanceM' },
];

/** Three deterministic daily missions (rotate by date). */
export function dailyMissions(dateKey = localDateKey()): MissionDef[] {
  let h = 0;
  for (const c of dateKey) h = (h * 31 + c.charCodeAt(0)) | 0;
  const picks: MissionDef[] = [];
  for (let i = 0; picks.length < 3 && i < MISSION_POOL.length * 2; i++) {
    const m = MISSION_POOL[Math.abs(h + i * 7) % MISSION_POOL.length]!;
    if (!picks.includes(m)) picks.push(m);
  }
  return picks;
}

/** Returns taka earned from newly completed missions. */
export function applyRunToMissions(save: SaveData, summary: RunSummary): number {
  const dateKey = localDateKey();
  let earned = 0;
  for (const m of dailyMissions(dateKey)) {
    const key = `${dateKey}:${m.id}`;
    const prev = save.missions[key] ?? 0;
    if (prev >= m.target) continue;
    const next = Math.min(m.target, prev + (summary[m.stat] ?? 0));
    save.missions[key] = next;
    if (next >= m.target) earned += m.reward;
  }
  return earned;
}

// ---------- Shop ----------

export interface ShopItem {
  id: string;
  nameEn: string;
  nameBn: string;
  desc: string;
  price: number;
  kind: 'powerup' | 'consumable' | 'outfit' | 'character';
  emoji: string;
}

/** Shop character id → Quaternius model path (the player avatar loads this). */
export const CHARACTER_MODELS: Record<string, string> = {
  char_man: 'characters/man',
  char_suit: 'characters/man-suit',
  char_woman: 'characters/woman',
  char_woman_casual: 'characters/woman-casual',
  char_woman_dress: 'characters/woman-dress',
};

export const SHOP_CATALOG: ShopItem[] = [
  { id: 'glasses', nameEn: 'Pocketmar Glasses', nameBn: 'পকেটমার চশমা', desc: 'Reveals pocketmars for 3 runs. Training wheels — learn the tells!', price: 150, kind: 'consumable', emoji: '🕶' },
  { id: 'shoes', nameEn: 'Good Shoes', nameBn: 'ভালো জুতা', desc: 'Stamina drains 20% slower.', price: 400, kind: 'powerup', emoji: '👟' },
  { id: 'umbrella', nameEn: 'Umbrella', nameBn: 'ছাতা', desc: 'No rain slow-down in monsoon weather.', price: 250, kind: 'powerup', emoji: '☂️' },
  { id: 'headphones', nameEn: 'Headphones', nameBn: 'হেডফোন', desc: 'Cakewalk meter fills 25% faster.', price: 350, kind: 'powerup', emoji: '🎧' },
  { id: 'sandWatch', nameEn: 'Sand Watch', nameBn: 'বালুঘড়ি', desc: 'Rewind time 6 seconds. Charges as you walk.', price: 1200, kind: 'powerup', emoji: '⏳' },
  { id: 'outfit_lungi', nameEn: 'Lungi Speedrun', nameBn: 'লুঙ্গি', desc: 'Pure style.', price: 200, kind: 'outfit', emoji: '🩳' },
  { id: 'outfit_panjabi', nameEn: 'Eid Panjabi', nameBn: 'ঈদ পাঞ্জাবি', desc: 'Festive.', price: 300, kind: 'outfit', emoji: '🥻' },
  { id: 'outfit_school', nameEn: 'School Uniform', nameBn: 'স্কুল ইউনিফর্ম', desc: 'Nostalgia.', price: 150, kind: 'outfit', emoji: '🎒' },
  // Character collection — play as different Dhakaites (the base "man" is free).
  { id: 'char_suit', nameEn: 'Office Bhai', nameBn: 'অফিসের ভাই', desc: 'Play as a sharp-suited commuter.', price: 500, kind: 'character', emoji: '🧑‍💼' },
  { id: 'char_woman', nameEn: 'Apu', nameBn: 'আপু', desc: 'Play as a woman commuter.', price: 500, kind: 'character', emoji: '👩' },
  { id: 'char_woman_casual', nameEn: 'College Apu', nameBn: 'কলেজ আপু', desc: 'Casual-style woman runner.', price: 500, kind: 'character', emoji: '👚' },
  { id: 'char_woman_dress', nameEn: 'Eid Apu', nameBn: 'ঈদ আপু', desc: 'Festive dressed-up runner.', price: 700, kind: 'character', emoji: '👗' },
  { id: 'mystery_box', nameEn: 'Cha-Stall Mystery Box', nameBn: 'চা-দোকান মিস্ট্রি বক্স', desc: 'Unlocks a random new character you don’t own yet.', price: 350, kind: 'consumable', emoji: '🎁' },
];

export const OUTFIT_COLORS: Record<string, string> = {
  default: '#e8a33d',
  outfit_lungi: '#3e8f5a',
  outfit_panjabi: '#f5f5f0',
  outfit_school: '#5b9fd6',
};

export function buyItem(save: SaveData, id: string): boolean {
  const item = SHOP_CATALOG.find((i) => i.id === id);
  if (!item || save.taka < item.price) return false;
  if (item.kind !== 'consumable' && save.ownedItems.includes(id)) return false;
  // Mystery box: only worth buying if there's a character left to unlock.
  if (item.id === 'mystery_box' && lockedCharacters(save).length === 0) return false;
  save.taka -= item.price;
  if (item.id === 'glasses') save.glassesCharges += 3;
  else if (item.id === 'mystery_box') {
    const locked = lockedCharacters(save);
    const pick = locked[Math.floor(Math.random() * locked.length)]!;
    save.ownedItems.push(pick);
    save.equippedCharacter = pick; // wear the new find right away
  } else {
    save.ownedItems.push(id);
    if (item.kind === 'character') save.equippedCharacter = id;
  }
  return true;
}

/** Buyable character ids the player doesn't own yet (excludes the free base). */
export function lockedCharacters(save: SaveData): string[] {
  return Object.keys(CHARACTER_MODELS).filter(
    (id) => id !== 'char_man' && !save.ownedItems.includes(id),
  );
}

// ---------- Ghost packing (seeded routes only) ----------

/** Pack (s,t) keyframes at 2 Hz into a flat number array for the save blob. */
export function packGhost(frames: { s: number; t: number }[]): number[] {
  const out: number[] = [];
  for (const f of frames) out.push(Math.round(f.s * 10) / 10, Math.round(f.t * 100) / 100);
  return out;
}

export function unpackGhost(packed: number[]): { s: number; t: number }[] {
  const out: { s: number; t: number }[] = [];
  for (let i = 0; i + 1 < packed.length; i += 2) out.push({ s: packed[i]!, t: packed[i + 1]! });
  return out;
}
