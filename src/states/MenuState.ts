/**
 * Home screen: area chain with star-gated unlocks, Ajker Rasta (daily),
 * energy, streak, wallet, shop, missions, settings. Pure DOM.
 */
import type { GameState } from '@/core/StateMachine';
import type { GameContext } from '@/core/GameContext';
import {
  ENERGY_MAX,
  canStartRun,
  msToNextEnergy,
  rechargeEnergy,
  refillEnergy,
} from '@/meta/Energy';
import { AREA_ORDER, UNLOCK_COST, totalStars } from '@/economy/stars';
import { SHOP_CATALOG, buyItem, dailyMissions, localDateKey } from '@/meta/progression';
import { dailySeed, hashString } from '@/core/Rng';
import { OSM_ATTRIBUTION } from '@/world/levelTypes';

const AREA_NAMES: Record<string, { en: string; bn: string; flavor: string }> = {
  dhanmondi: { en: 'Dhanmondi', bn: 'ধানমন্ডি', flavor: 'Lakeside calm. Learn the streets.' },
  uttara: { en: 'Uttara', bn: 'উত্তরা', flavor: 'Wide roads, fast traffic, long crossings.' },
  bashundhara: { en: 'Bashundhara R/A', bn: 'বসুন্ধরা', flavor: 'Long quiet stretches. Manage stamina.' },
  mohammadpur: { en: 'Mohammadpur', bn: 'মোহাম্মদপুর', flavor: 'Bazaar mazes. Watch your pockets.' },
  puran_dhaka: { en: 'Puran Dhaka', bn: 'পুরান ঢাকা', flavor: 'Narrowest lanes, densest crowd.' },
  gulistan: { en: 'Gulistan/Motijheel', bn: 'গুলিস্তান', flavor: 'Maximum chaos. The final walk.' },
};

export class MenuState implements GameState {
  private root: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private ctx: GameContext) {}

  enter(): void {
    const save = this.ctx.save.get();
    rechargeEnergy(save);
    this.build();
    this.timer = setInterval(() => {
      rechargeEnergy(this.ctx.save.get());
      this.refreshEnergy();
    }, 1000);
    this.ctx.testApi.menu = {
      startArea: (id: string) => this.startArea(id),
      startDaily: () => this.startDaily(),
    };
  }

  exit(): void {
    if (this.timer) clearInterval(this.timer);
    this.root?.remove();
    this.root = null;
    void this.ctx.save.flush();
    delete this.ctx.testApi.menu;
  }

  fixedUpdate(_dt: number): void {}
  render(_alpha: number, _frameDt: number): void {}

  private build(): void {
    const save = this.ctx.save.get();
    const stars = totalStars(save.stars);
    this.root?.remove();
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;z-index:15;background:linear-gradient(#2a1f12,#1a1208);color:#fff;' +
      'font-family:system-ui;overflow-y:auto;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))';
    const dateKey = localDateKey();
    const dailyDone = dateKey in save.dailyResults;
    this.root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:34px;font-weight:900;letter-spacing:-1px">Cake<span style="color:#e8a33d">Walk</span></div>
          <div style="font-size:12px;opacity:.65">Everyone's leaving Dhaka for Eid. You're going the other way — home.</div>
        </div>
        <div style="text-align:right;font-weight:800">
          <div>৳ ${save.taka}</div>
          <div style="font-size:13px;color:#ffb04a">🔥 ${save.streak.count}</div>
        </div>
      </div>

      <div id="cw-energy" style="margin:14px 0;padding:10px 14px;background:rgba(255,255,255,.07);border-radius:12px;
        display:flex;justify-content:space-between;align-items:center"></div>

      <button id="cw-daily" style="width:100%;text-align:left;border:2px solid #5b9fd6;border-radius:14px;padding:12px 14px;
        background:rgba(91,159,214,.12);color:#fff;font-family:inherit;margin-bottom:14px">
        <div style="font-weight:900;font-size:17px">📅 Ajker Rasta <span style="opacity:.6;font-size:12px">(today's route)</span></div>
        <div style="font-size:12px;opacity:.8">${dailyDone ? `Done today: ৳${save.dailyResults[dateKey]!.taka} · ${save.dailyResults[dateKey]!.stars}⭐ — come back tomorrow!` : 'Same route for everyone, one attempt, no Sand Watch. Beat the world.'}</div>
      </button>

      <div style="font-weight:800;margin-bottom:8px">Areas <span style="opacity:.6;font-size:13px">· ${stars}⭐ collected</span></div>
      <div id="cw-areas" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"></div>

      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="cw-menu-btn" id="cw-shop">🛍 Shop</button>
        <button class="cw-menu-btn" id="cw-missions">📋 Missions</button>
        <button class="cw-menu-btn" id="cw-settings">⚙️</button>
      </div>
      <div id="cw-panel"></div>
      <style>
        .cw-menu-btn{flex:1;padding:12px;border-radius:12px;border:none;background:rgba(255,255,255,.1);
          color:#fff;font-weight:800;font-size:15px;font-family:inherit}
        .cw-area{border-radius:14px;padding:12px;border:none;text-align:left;color:#fff;font-family:inherit}
      </style>
    `;
    document.body.appendChild(this.root);
    this.refreshEnergy();

    const areas = this.root.querySelector('#cw-areas')!;
    for (const id of AREA_ORDER) {
      const meta = AREA_NAMES[id]!;
      const unlocked = stars >= (UNLOCK_COST[id] ?? 0);
      const btn = document.createElement('button');
      btn.className = 'cw-area';
      btn.style.background = unlocked ? 'rgba(232,163,61,.15)' : 'rgba(255,255,255,.05)';
      btn.style.border = unlocked ? '2px solid #e8a33d55' : '2px solid transparent';
      btn.innerHTML = unlocked
        ? `<div style="font-weight:800">${meta.en}</div>
           <div style="font-size:11px;opacity:.6">${meta.bn}</div>
           <div style="font-size:11px;opacity:.75;margin-top:4px">${meta.flavor}</div>
           <div style="font-size:12px;color:#ffd34a;margin-top:4px">${'★'.repeat(this.ctx.save.get().stars[id] ?? 0)}${'☆'.repeat(5 - (this.ctx.save.get().stars[id] ?? 0))}</div>`
        : `<div style="font-weight:800;opacity:.45">🔒 ${meta.en}</div>
           <div style="font-size:11px;opacity:.4">needs ${UNLOCK_COST[id]}⭐</div>`;
      if (unlocked) btn.addEventListener('click', () => this.startArea(id));
      areas.appendChild(btn);
    }

    this.root.querySelector('#cw-daily')!.addEventListener('click', () => {
      if (!dailyDone) this.startDaily();
    });
    this.root.querySelector('#cw-shop')!.addEventListener('click', () => this.showShop());
    this.root.querySelector('#cw-missions')!.addEventListener('click', () => this.showMissions());
    this.root.querySelector('#cw-settings')!.addEventListener('click', () => this.showSettings());
    this.root.querySelector('#cw-energy')!.addEventListener('click', () => void this.adRefill());
  }

  private refreshEnergy(): void {
    const el = this.root?.querySelector('#cw-energy');
    if (!el) return;
    const save = this.ctx.save.get();
    const ms = msToNextEnergy(save);
    const mins = Math.ceil(ms / 60000);
    el.innerHTML = `
      <div style="font-weight:800">⚡ ${save.energy.current}/${ENERGY_MAX}
        <span style="opacity:.6;font-size:12px">${save.energy.current >= ENERGY_MAX ? 'full' : `+1 in ${mins} min`}</span></div>
      ${save.energy.current < ENERGY_MAX ? '<div style="font-size:12px;background:#e8a33d;color:#1a1208;font-weight:800;border-radius:8px;padding:6px 10px">📺 refill</div>' : ''}`;
  }

  private async adRefill(): Promise<void> {
    const save = this.ctx.save.get();
    if (save.energy.current >= ENERGY_MAX) return;
    const ok = await this.ctx.services.ads.showRewarded('energy-refill');
    if (ok) {
      this.ctx.save.update((d) => refillEnergy(d));
      await this.ctx.save.flush();
      this.refreshEnergy();
    }
  }

  private startArea(id: string): void {
    const save = this.ctx.save.get();
    if (!canStartRun(save)) {
      void this.adRefill();
      return;
    }
    const seed = (Date.now() ^ hashString(id)) >>> 0;
    this.ctx.machine.transition('routeSelect', { areaId: id, seed });
  }

  private startDaily(): void {
    // Daily ignores energy and locks — it's the shared world challenge.
    const seed = dailySeed();
    const areaId = AREA_ORDER[seed % AREA_ORDER.length]!;
    this.ctx.machine.transition('routeSelect', { areaId, seed, daily: true });
  }

  private showShop(): void {
    const save = this.ctx.save.get();
    const panel = this.root!.querySelector<HTMLDivElement>('#cw-panel')!;
    panel.innerHTML = `<div style="margin-top:14px;font-weight:800">Shop · ৳ ${save.taka} <span style="opacity:.5;font-size:12px">(no pay-to-win — everything earned by walking)</span></div>`;
    for (const item of SHOP_CATALOG) {
      const owned = item.kind !== 'consumable' && save.ownedItems.includes(item.id);
      const equipped = item.kind === 'outfit' && save.equippedOutfit === item.id;
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;padding:10px;border-radius:10px;' +
        'background:rgba(255,255,255,.06);margin-top:8px;gap:8px';
      row.innerHTML = `
        <div style="font-size:22px">${item.emoji}</div>
        <div style="flex:1">
          <div style="font-weight:700">${item.nameEn} <span style="opacity:.5;font-size:11px">${item.nameBn}</span></div>
          <div style="font-size:11px;opacity:.7">${item.desc}${item.id === 'glasses' ? ` (charges: ${save.glassesCharges})` : ''}</div>
        </div>
        <button style="border:none;border-radius:8px;padding:8px 12px;font-weight:800;font-family:inherit;
          background:${owned ? (equipped ? '#3fa34d' : '#555') : '#e8a33d'};color:${owned ? '#fff' : '#1a1208'}">
          ${owned ? (item.kind === 'outfit' ? (equipped ? 'Worn' : 'Wear') : 'Owned') : `৳${item.price}`}
        </button>`;
      row.querySelector('button')!.addEventListener('click', () => {
        this.ctx.save.update((d) => {
          if (item.kind === 'outfit' && d.ownedItems.includes(item.id)) d.equippedOutfit = item.id;
          else buyItem(d, item.id);
        });
        void this.ctx.save.flush();
        this.showShop();
        this.build(); // refresh wallet display
        this.showShop();
      });
      panel.appendChild(row);
    }
    panel.scrollIntoView({ behavior: 'smooth' });
  }

  private showMissions(): void {
    const save = this.ctx.save.get();
    const panel = this.root!.querySelector<HTMLDivElement>('#cw-panel')!;
    const dateKey = localDateKey();
    panel.innerHTML = `<div style="margin-top:14px;font-weight:800">Today's missions</div>`;
    for (const m of dailyMissions(dateKey)) {
      const progress = save.missions[`${dateKey}:${m.id}`] ?? 0;
      const done = progress >= m.target;
      const row = document.createElement('div');
      row.style.cssText =
        'padding:10px;border-radius:10px;background:rgba(255,255,255,.06);margin-top:8px';
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between">
          <div style="font-weight:700">${done ? '✅' : '⬜'} ${m.textEn}</div>
          <div style="color:#ffd34a;font-weight:800">+৳${m.reward}</div>
        </div>
        <div style="font-size:11px;opacity:.6">${m.textBn} · ${Math.min(progress, m.target)}/${m.target}</div>`;
      panel.appendChild(row);
    }
  }

  private showSettings(): void {
    const save = this.ctx.save.get();
    const panel = this.root!.querySelector<HTMLDivElement>('#cw-panel')!;
    panel.innerHTML = `
      <div style="margin-top:14px;font-weight:800">Settings</div>
      <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,.06);margin-top:8px;display:flex;flex-direction:column;gap:10px">
        <button class="cw-menu-btn" id="cw-lang">Language: ${save.settings.lang === 'en' ? 'English' : 'বাংলা'}</button>
        <button class="cw-menu-btn" id="cw-audio">Sound: ${save.settings.audio ? 'On 🔊' : 'Off 🔇'}</button>
        <div style="font-size:11px;opacity:.6;line-height:1.6">
          ${OSM_ATTRIBUTION}.<br>
          Maps are derived from OpenStreetMap and remain under ODbL.<br>
          CakeWalk v0.1 — a love letter to Dhaka.
        </div>
      </div>`;
    panel.querySelector('#cw-lang')!.addEventListener('click', () => {
      this.ctx.save.update((d) => (d.settings.lang = d.settings.lang === 'en' ? 'bn' : 'en'));
      this.showSettings();
    });
    panel.querySelector('#cw-audio')!.addEventListener('click', () => {
      this.ctx.save.update((d) => (d.settings.audio = !d.settings.audio));
      this.showSettings();
    });
  }
}
