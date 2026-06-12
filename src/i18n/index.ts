/**
 * Bangla + English strings. t(key) reads the active language; setLang flips
 * it at runtime (menu setting). Strings used across HUD/menu/results.
 */

const STRINGS = {
  en: {
    tagline: "Everyone's leaving Dhaka for Eid. You're going the other way — home.",
    bumped: 'Oof! bumped',
    cakewalk: 'CAKEWALK! 2x points',
    theft: (n: number) => `😱 pocketmar! -৳${n}`,
    spotted: '👀 Spotted! He melts away…',
    misread: '😠 …that was just an uncle',
    fruit: '🥭 +12',
    cat: '🐈 cat! combo lost',
    bark: '🐕 WOOF! panic!',
    stampede: '🐂🐂🐂 STAMPEDE! Get out of the way!',
    stampedeSurvived: (n: number) => `🐂 survived the stampede! +৳${n}`,
    vehicleHit: (k: string) => `🚌 hit by ${k}!`,
    crossed: (n: number) => `🎉 crossed! +৳${n}`,
    overbridge: '🌉 safe & slow',
    crossing: '⚠️ CROSSING — time the gap!',
    crossingSub: 'or take the overbridge (safe, no bonus)',
    madeIt: '🏠 Made it!',
    knockedOut: '💥 Knocked out',
    retry: '↻ Retry (free)',
    home: '🏘 Home',
    share: '📤 Share',
    doubleTaka: '📺 Double taka',
    hawker: '🧺 "Mama, eita nen!"',
    directions: '🗣 "Bhai, Gulistan kon dike?"',
    teaOffer: '☕ "Cha khaben?"',
    tutDrift: 'Drag left side (or A/D) to weave through the crowd',
    tutDip: 'Flick up/down on the right (Q/E) to dip a shoulder past loads',
    tutDuck: 'Both shoulders together = full duck under head-loads',
    tutSprint: 'Hold right side (W) to jog — watch your stamina!',
    tutJump: 'Tap right side (Space) to jump drains and grab fruit',
    tutCha: 'Sit at a cha dokan (🪑) to recover health & stamina',
    tutTheft: 'A pocketmar got you! They walk YOUR way. Stare (👀) to scare them off',
    tutDone: 'You know the streets now. Go home, hero. 🏠',
  },
  bn: {
    tagline: 'ঈদে সবাই ঢাকা ছাড়ছে। আপনি উল্টো পথে — বাড়ির দিকে।',
    bumped: 'ওহ! ধাক্কা',
    cakewalk: 'কেকওয়াক! ২x পয়েন্ট',
    theft: (n: number) => `😱 পকেটমার! -৳${n}`,
    spotted: '👀 ধরা পড়েছে! পালিয়ে গেল…',
    misread: '😠 …উনি তো নিরীহ চাচা',
    fruit: '🥭 +১২',
    cat: '🐈 বিড়াল! কম্বো শেষ',
    bark: '🐕 ঘেউ! আতঙ্ক!',
    stampede: '🐂🐂🐂 গরু ছুটেছে! সরে যান!',
    stampedeSurvived: (n: number) => `🐂 বেঁচে গেছেন! +৳${n}`,
    vehicleHit: (k: string) => `🚌 ${k} ধাক্কা দিয়েছে!`,
    crossed: (n: number) => `🎉 পার হয়েছেন! +৳${n}`,
    overbridge: '🌉 নিরাপদ কিন্তু ধীর',
    crossing: '⚠️ রাস্তা পার — ফাঁক বুঝে দৌড়ান!',
    crossingSub: 'অথবা ওভারব্রিজ নিন (নিরাপদ, বোনাস নেই)',
    madeIt: '🏠 পৌঁছে গেছেন!',
    knockedOut: '💥 আর পারলেন না',
    retry: '↻ আবার (ফ্রি)',
    home: '🏘 হোম',
    share: '📤 শেয়ার',
    doubleTaka: '📺 টাকা দ্বিগুণ',
    hawker: '🧺 "মামা, এইটা নেন!"',
    directions: '🗣 "ভাই, গুলিস্তান কোন দিকে?"',
    teaOffer: '☕ "চা খাবেন?"',
    tutDrift: 'বাম পাশে টেনে (বা A/D) ভিড়ের ভেতর দিয়ে চলুন',
    tutDip: 'ডান পাশে উপরে/নিচে ফ্লিক (Q/E) করে কাঁধ কাত করুন',
    tutDuck: 'দুই কাঁধ একসাথে = মাথার বোঝার নিচ দিয়ে যান',
    tutSprint: 'ডান পাশ চেপে ধরুন (W) দৌড়াতে — স্ট্যামিনা খেয়াল রাখুন!',
    tutJump: 'ডান পাশে ট্যাপ (Space) করে লাফ দিন, ফল ধরুন',
    tutCha: 'চা দোকানে বসুন (🪑) — স্বাস্থ্য ও স্ট্যামিনা ফিরবে',
    tutTheft: 'পকেটমার ধরেছে! ওরা আপনার দিকেই হাঁটে। তাকান (👀) ভয় দেখাতে',
    tutDone: 'রাস্তা এখন আপনার চেনা। বাড়ি যান, বীর। 🏠',
  },
} as const;

export type LangKey = keyof typeof STRINGS.en;

let lang: 'en' | 'bn' = 'en';

export function setLang(l: 'en' | 'bn'): void {
  lang = l;
}

export function t(key: LangKey): string {
  const v = STRINGS[lang][key];
  return typeof v === 'string' ? v : '';
}

export function tf(key: LangKey, arg: number | string): string {
  const v = STRINGS[lang][key] as unknown;
  return typeof v === 'function' ? (v as (a: number | string) => string)(arg) : String(v);
}
