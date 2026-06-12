# CakeWalk — Game Design Document

> *"Everyone in Dhaka is going one way. You're going the other."*

A cross-platform (iOS + Android) walking simulator set in **replica streets of Dhaka city**. Think Subway Surfers / Temple Run pacing, but level-based, grounded in real geography, and built around one core joke that's also the core mechanic: **you are the only person walking against the crowd.**

*Rev 4 — all decisions locked, build started. Tech stack finalized: TypeScript + Three.js + Capacitor (see §8.1).*

---

## 1. Core Concept

| | |
|---|---|
| **Name** | CakeWalk |
| **Genre** | Level-based walking simulator / crowd-dodger |
| **Platforms** | iOS, Android (cross-platform engine) |
| **Session length** | 2–6 minutes per run (snackable, Flappy Bird-style retry loop) |
| **Core fantasy** | Surviving a Dhaka footpath during rush hour — against the flow |
| **Objective per level** | Get from Point A to Point B (e.g., Dhanmondi 2 → Dhanmondi 32) without losing all health, while collecting points (taka) |

### 1.1 Storyline — The Eid Exodus
It's the final days before **Eid-ul-Adha**. The entire city is emptying out — millions rushing toward bus terminals, Kamalapur station, and Sadarghat launch ghat to reach their hometowns. **You're the only one going the other way: toward *your* home, here in Dhaka.** The against-the-flow mechanic isn't just a gimmick — it's the story. Every run is one leg of your journey home through a city in exodus.

Story consequences on gameplay:
- **Crowd has direction and purpose**: people drag luggage, carry sacks on heads, herd children — wider, clumsier, more chaotic obstacles than ordinary pedestrians.
- **Qurbani cows**: cattle being led (and sometimes *escaping*) through the streets. A walked cow is a slow, wide moving wall; an **escaped cow stampede** is a rare scripted event — massive hazard, massive bonus for surviving it. Peak clip-able moment.
- Haat-adjacent routes (cattle market zones) show up on the route-select map as a distinct risk type.
- **Random A→B vs. "going home"**: each run is one *leg* of the journey — an errand, a relative to see off, a shortcut between strongholds — so random destinations stay true to the fiction; completing an area's star chain ends with a final scripted leg that actually reaches *home*.

---

## 2. Core Mechanics (Player-Facing)

### 2.1 Movement — "Walk Like a Human"
- **Analog lateral movement**: no fixed 3 lanes — drift left or right *as little or as much as you want*. Precision sidestepping is the skill.
- **Shoulder dips**: raise/lower a shoulder to squeeze through tight gaps between oncoming people without a full sidestep. People might be carrying things on their head or shoulders, and different people are different heights — so you need shoulder dips, or a **full duck** (both shoulder dips triggered together) to clear the lowest gaps. Collision is checked in vertical bands: what blocks you standing may be clear when dipped or ducked.
- **Variable speed**: speed up to a jog or slow to a shuffle. Speed is a resource decision, not a constant.
- **Jump**: hop over low obstacles (open drains, sleeping dogs, bricks) and **jump to grab fruits from street trees** (mango, jaam, boroi) → bonus points / health.

#### Control layout (validated by on-device spike)
| Input | Action |
|---|---|
| **Left half — horizontal drag** | Analog lateral drift (continuous) |
| **Right half — press & hold** | Speed up (release = normal pace) |
| **Right half — drag down & hold** | Slow to shuffle |
| **Right half — tap** | Jump |
| **Right half — flick up / flick down** | Shoulder raise / shoulder drop (both active = full duck) |
| **HUD button (bottom-right, 👀)** | Stare-Down — auto-targets the most suspicious NPC in your facing cone (suspicion-weighted snap targeting; never raw tap-the-model in a dense crowd), ~2.5 s cooldown |
| **HUD button (top corner)** | Phone check |
- Tap vs. hold disambiguated at ~150 ms; flick vs. drag by velocity. No tilt — tilt is bus-hostile and imprecise.
- Dev/desktop keys: A/D drift, W sprint, S shuffle, Space jump, Q/E shoulder dips (Q+E duck), F stare, M phone.

### 2.2 The Crowd (the real "obstacle course")
- Everyone walks **toward** you. Density varies by road, area, and time of day.
- **Bumping into people costs health.** Hard bumps (at running speed) cost more.
- Crowd is not uniform: slow uncles, fast delivery guys, groups walking 3-abreast, hawkers with baskets, people stopping suddenly to take calls — and during the Eid exodus, luggage-draggers, head-load carriers, and led Qurbani cows (§1.1).
- **Near-miss combo**: brushing past people *without* touching builds a combo multiplier — the Flappy Bird "one more try" hook. Risky play = more points.

#### Street life & footpath clutter
The footpath itself is alive and in the way:
- **Sleeping dogs** — jump over or step around; startling one at a sprint makes it bark and ripples panic through nearby crowd (brief chaos around you).
- **Cats** — dart unpredictably across the footpath; a trip-hazard that costs a stumble (combo break), not health.
- **Dustbins** — static obstacles, sometimes overflowing with a "smell cloud" zone that makes the crowd swerve unpredictably around it (reading those swerves is a skill).
- These keep even low-crowd stretches mechanically interesting instead of being dead walking.

### 2.3 Health & Stamina (two separate bars)
- **Health (HP)**: drained by bumps, rickshaw clips, pickpocket scuffles. Refilled at **cha dokan** (tea stalls) and by fruits.
- **Stamina**: drained by running; running too long fully empties it → forced slow shuffle (very vulnerable). Regained by:
  - Sitting at a **bus stop bench**
  - Sitting at a **cha dokan** (refills health too)
- **Seated theft rule**: while seated, a pocketmar may approach with a visible ~1 s tell — tap them to shoo away; miss the tap and lose taka. Resting is never free of attention.

### 2.4 The Phone Check (risk/reward navigation)
- Tap the phone icon → your character **stops and looks at their phone**: a maps-style interface (our own OSM-derived map — no Google assets) shows current location, destination, and route.
- Minimum ~2.5 s animation, cancellable after 1 s. While looking at the phone you are **blind to the street**: people bump into you, and pickpockets steal heavily — capped at **20% of carried taka per check** so one check can hurt but never zero you out.
- No minimap on the main HUD — memorize the route from the pre-level map screen, or pay the risk price to check.

### 2.5 Road Crossing — minigame within the game
- Reaching a major road = a self-contained crossing minigame: read traffic waves (buses, CNGs, rickshaws, bikes that weave), commit to gaps, sprint or freeze on the median.
- **High risk / high reward**: crossing directly is fast and pays a big point bonus; the **overbridge** is always available — safe, slow, zero bonus.
- Traffic difficulty is per-road (Gulistan crossing ≫ Dhanmondi residential lane).

### 2.6 Pickpockets ("Pocketmar")
- Blend into the crowd, unmarked by default. Walking too close or bumping into one **steals your taka**.

#### Spotting a pocketmar — the "read the street" minigame
Pocketmars are never invisible — they're **hidden in plain sight**, and learning their tells is a core skill (the Papers-Please/Among-Us "spot the liar" loop):

1. **The Turn (the master tell, tied to the core concept)**: everyone in Dhaka walks *toward* you — so when someone quietly turns around and starts walking **your way**, matching your pace a few steps behind or beside you… *why is he going your way?* The game's own premise becomes the detection mechanic. **Crucially, The Turn is a strong prior, not proof**: rare innocent same-direction walkers exist (someone who forgot their bus ticket, a kid chasing a ball, a fellow Dhaka-stayer) — otherwise the tell would be 100% reliable and the guessing game would collapse. What separates a pocketmar is the *combination*: turned AND pacing you AND drifting closer.
2. **The Drift**: instead of holding their line like honest pedestrians, they subtly angle across the footpath toward you, correcting course when you do.
3. **Body-language micro-tells** (readable at closer range): hand hovering at pocket height, head-on-a-swivel glances, loitering at a cha dokan watching you instead of drinking, walking too smoothly through a chaotic crowd.
4. **Distance vs. certainty trade-off**: from far away tells are ambiguous; getting close enough to be *sure* puts you inside theft range. The read itself is high-risk/high-reward.

**Counter-play (what makes it fun, not just punishing):**
- **The Stare-Down**: the 👀 HUD button (§2.1) makes your character look straight at the most suspicious nearby NPC. A real pocketmar breaks off and melts into the crowd (small taka bonus + "Spotted!" feedback); an innocent uncle glares back and you lose a bit of combo for the insult. The ~2.5 s cooldown keeps reads deliberate — you can't brute-force scan the whole street, especially when combo is empty and the misread penalty would otherwise cost nothing.
- **Bait walk**: deliberately slow down near a suspected pocketmar with the Stare ready — successful baits build a "Street Smart" multiplier.
- **Readability assist** (below expert difficulty): a subtle audio sting + 0.5 s highlight window when a pocketmar first Turns — reading Drift and micro-tells while steering is heavy cognitive load; ease players into it.
- **Reversed-flow rule (Eid-ul-Fitr event, §6.6)**: when the crowd flows *with* you, The Turn inverts into **The Shadow** — honest inbound travelers overtake you or fall behind naturally; a pocketmar holds *constant distance* beside/behind you. Crowd-flow direction is therefore a parameter of the crowd sim from v1, not an event reskin.
- **Seated tell** (§2.3): while resting, an approaching pocketmar shows a ~1 s tell — tap to shoo.
- **Glasses powerup** (purchasable, limited charge): outlines pocketmars explicitly — training wheels that teach the organic tells, so when charges run out the player has *learned to see*. That learning curve is the addiction hook: veterans spot pocketmars glasses-free and feel like locals.

#### Sand Watch
- **Sand Watch** (late-game special item): charges as you walk — full charge per ~400 m walked, one charge stored. Activate to **rewind time 6 seconds** (Sands-of-Time style): undo a pickpocketing, a bus clip, or a bad crossing. Disabled in Daily Commute (leaderboard integrity). The ultimate clutch-save moment, very clip-able.
- **Rewind animation**: on activation the world snaps into slow-mo, colors drain to a warm **sepia/sand tone**, and golden sand particles stream out of the world *into* the watch face; everyone walks backwards, your own footsteps retrace, audio plays reversed with a muffled heartbeat under it. At the rewind point: a sharp "glass-turn" *click*, color floods back, and play resumes in brief slow-mo so the player can immediately correct the mistake. Designed frame-one to look incredible in shared clips (§6.8).

---

## 3. Levels, Maps & Routes

### 3.1 Replica Dhaka — bounded curated zones
- Maps are **faithful replicas of real Dhaka roads**, built from OpenStreetMap geodata + street-level reference: real road layouts, real landmarks on the roadside (mosques, markets, Star Kabab, Dhanmondi Lake, Ahsan Manzil, TSC, etc.) — like walking through Google Maps.
- **Scope**: "exact replica" means a **curated 2–3 km² playable zone per area**, hand-finished on top of OSM data — not the entire thana. Dhaka's OSM footpath/sidewalk data is sparse, so the pipeline synthesizes footpaths as offset paths along real roads; landmarks come from real OSM POIs.
- **Each area is a map**: Dhanmondi, Puran Dhaka, Uttara, Bashundhara R/A, Mohammadpur, Gulistan/Motijheel, Mirpur…

### 3.2 Area Specialities (each map has a personality)
| Area | Speciality | Difficulty flavor |
|---|---|---|
| **Dhanmondi** | Lake-side calm stretches, school rush spikes | Tutorial-friendly |
| **Uttara** | Wide roads, fast traffic, long crossings | Crossing-heavy |
| **Bashundhara R/A** | Low crowd, but long distances → stamina management | Endurance |
| **Mohammadpur** | **High pocketmar density** — dense bazaar mazes packed with markets and bus stops | Hard / stealth-read |
| **Puran Dhaka** | Narrowest lanes, densest crowd, rickshaw mazes, best food | Claustrophobic expert |
| **Gulistan/Motijheel** | Max crowd + max traffic + hawker walls | Endgame chaos |

- **Resolved (user sign-off)**: Mohammadpur is the high-pickpocket area. Mechanically, pocketmar spawns are still driven by *location types* (bazaars, bus terminals, crowded markets) — Mohammadpur is hard because its map is dense with those zones.

### 3.3 Route Selection (the pre-level puzzle)
- Before each level you see the **area map** with start (A) and end (B) — **randomly assigned** within the area.
- Multiple connecting routes, like a connect-A-to-B puzzle: each shows hints — crowd density, traffic level, # of road crossings, cha dokan count, pickpocket risk, distance.
- **Short & brutal vs. long & safe** — the route choice IS the strategy layer. Mastery = knowing real Dhaka shortcuts.

---

## 4. Economy & Progression

- **Taka** = points = currency. Earned by distance, near-misses, fruits, crossing bonuses. Lost to pickpockets.
- **Spend taka on**: glasses (pocketmar vision), better shoes (stamina efficiency), umbrella (rain protection), headphones (focus/combo bonus), the **Sand Watch**, cosmetics.
- **Star rating per run** (1–5 stars), one star per criterion so every rating tells you *what to improve*:
  1. ⭐ **Finish** — reach Point B alive
  2. ⭐ **Pace** — beat the par time (normalized by route length; random A/B makes raw time unfair)
  3. ⭐ **Health** — arrive above 50% HP
  4. ⭐ **Untouched wallet** — lose no taka to pocketmars
  5. ⭐ **Street Smart** — hit a near-miss combo / Cakewalk-meter threshold
  - Stars gate later areas → replay pressure; chasing the 5th star on a brutal route is the Candy Crush "one more go" itch.
  - **Rulings**: the FTUE tutorial run is unrated (its scripted pickpocket loss must not poison the first rating); a theft undone by Sand Watch rewind **does not** break the Untouched-wallet star — rewound means it never happened, and clutch saves should be rewarded.
- **Area unlock chain**: Dhanmondi → … → Gulistan. Replay any unlocked area with new random A/B for variety.

## 5. Energy System (session gating)
- A meta **Energy** meter (separate from in-run stamina): **starting a new run costs energy; retrying a failed run is FREE.** The Flappy Bird instant-retry loop stays intact, while energy still prevents hours-long binges of fresh content.
- Energy recharges on a real-time clock. **Watch an ad** to refill; small IAP for refills / infinite-energy day pass.
- **Resolved (user sign-off)**: tuning starts **generous** (e.g., 8 runs per full bar, ~12 min/run recharge) — tighten with soft-launch data rather than launching strict.

---

## 6. Addiction / Virality Hooks (added ideas)

1. **Near-miss combo + "Cakewalk meter"** — flawless stretches fill a meter; at full meter the crowd parts slightly and points double. Losing it to one bump = instant retry urge (and retry is free — see §5).
2. **Daily commute** — one fixed daily route (same for all players worldwide, like Wordle): one attempt, global + friends leaderboard, Sand Watch disabled. In-fiction name: **"Ajker Rasta" (Today's Route)** — fits the exodus story better than "commute." Shareable result card ("I survived Gulistan in 4:32 🚶").
3. **Ghost runs** — race the translucent ghost of a friend's best run. **Seeded routes only** (Daily Commute + featured routes), since random A/B makes ghosts incomparable.
4. **Streaks** — daily login streak gives perks; missing a day breaks it (Duolingo guilt).
5. **Time of day & weather** — rain (slippery, umbrellas widen people), noon heat (stamina drains faster), evening rush (max crowd). Affects route choice.
6. **Seasonal events** — the base game *is* the Eid-ul-Adha exodus (§1.1); events remix it: Eid-ul-Fitr return-rush (crowd flows *into* the city — suddenly you're walking *with* traffic and that feels wrong), Pohela Boishakh (festive cosmetics), Book Fair month (special Shahbagh route), monsoon season (flooded roads = new pathing).
7. **Hawker dodge / "mama" moments** — random micro-events: a hawker tries to sell you something (slows you unless you swerve), a stranger asks for directions, a marriage procession blocks the lane.
8. **Clip-able moments** — slow-mo on Sand Watch rewinds and last-millisecond bus dodges; one-tap share to TikTok/Reels. This is the Flappy Bird virality engine: *make failure and clutch saves funny and shareable.*
9. **Cosmetics with local flavor** — lungi speedrun outfit, panjabi, school uniform, office shirt with backpack; cha cup trail effects. Pure cosmetic, no pay-to-win.
10. **Missions** — rotating mini-goals (drink 3 cups of cha in one run, cross Mirpur Road without the overbridge, grab 5 mangoes) → soft currency.
11. **"Local Legend" per area** — top weekly score per real area; tap into Dhaka neighborhood pride.
12. **Sound design** — real Dhaka soundscape: rickshaw bells, bus horns, hawker calls, cha stall chatter. Headphones-on immersion is a retention multiplier.

### 6.1 Frustration budget (anti-rage-quit rule)
Bumps, unmarked pickpockets, no minimap, and stamina collapse must never all stack at max simultaneously. Director system caps concurrent pressure: e.g., pickpocket spawns suppressed for ~10 s after a heavy bump; stamina-empty shuffle grants brief bump forgiveness; a dog bark-panic ripple (§2.2) counts as a pressure event and suppresses pocketmar approaches while the crowd is chaotic. Difficulty comes from *reading* the street, not from being mugged while already down.

---

## 7. Monetization (ethical, retention-first)

- **Rewarded ads only** — energy refill, post-run taka doubler, one-time mid-run revive. **No forced interstitials.**
- **IAP**: cosmetics, energy passes, starter packs.
- **No pay-to-win**: powerups are earnable with taka; IAP only accelerates.
- **Season pass** (later): cosmetic track per seasonal event.

---

## 8. Technical Plan

### 8.1 Engine — TypeScript + Three.js + Capacitor (locked)
**Final stack**: TypeScript, **Three.js** (3D WebGL engine), Vite build, wrapped with **Capacitor** into native iOS/Android apps. Chosen over Unity because it's fully buildable, runnable, and testable in the development environment, performs well for instanced low-poly crowds, and ships natively to both platforms. All art is **procedurally generated low-poly** (flat-shaded, vertex colors, zero texture assets); all audio is **synthesized via WebAudio**.

### 8.2 Map Pipeline (the "replica" problem)
- **OpenStreetMap** Overpass API extracts per area → offline bake pipeline (`tools/osm/`): project to local meters, simplify (Douglas-Peucker), **synthesize footpaths** as offset polylines along real roads (Dhaka OSM lacks sidewalk data), extrude real building footprints, place real POIs/landmarks, derive the intersection **route graph** with per-edge stats. Output: one baked JSON per area, committed to the repo (no network at runtime).
- Landmark buildings: stylized low-poly procedural models at correct geo-positions, labeled with real names.
- Runtime: chunked loading (~300 m radius around player) for mobile memory; level JSONs are a few hundred KB gzipped.
- **Licensing (resolved)**: OSM is ODbL — attribution string baked into every level file + attribution screen in-game + store-listing credit. Baked level data remains ODbL. Phone-check UI renders our own map from baked data — zero Google tiles, branding, or trade dress.

### 8.3 Module Architecture (clean, senior-grade)
```
src/
├── core/            # Game loop (fixed 30 Hz sim + interpolated render), state machine, event bus, seeded RNG streams, save system w/ migrations
├── player/          # Locomotion (analog lateral, shoulder dips/duck, speed), stamina, health, input (touch + keyboard)
├── crowd/           # Flow-along-spline crowd sim (SoA typed arrays), archetypes w/ vertical collision bands, instanced rendering, near-miss
├── traffic/         # Vehicle waves, crossing-minigame controller
├── pickpocket/      # Pocketmar AI (Turn/Drift/micro-tells), suspicion scoring, Stare-Down, theft events
├── world/           # Baked-level loader, chunk streaming, landmarks, props (cha dokan, trees, dustbins), street animals (dogs, cats, cows)
├── routing/         # Area graph, seeded A→B generation, k-diverse routes, route stats
├── items/           # Powerups, Sand Watch rewind (full-state snapshot ring buffer incl. RNG streams)
├── economy/         # Taka, shop, 5-star ratings, unlocks
├── meta/            # Energy, streaks, Ajker Rasta (daily), missions, ghosts, local leaderboards
├── director/        # Frustration budget, difficulty pacing, micro-events (§6.1, §6.7, cow stampede)
├── ui/              # HUD, phone-check overlay, route picker, shop, results, share cards
├── services/        # Interfaces + local-first adapters: save, leaderboards, ads (simulated), analytics (no-op) — Firebase/AdMob swap in later
├── i18n/            # Bangla + English from day one
├── audio/           # WebAudio-synthesized Dhaka soundscape, adaptive mixing
└── gfx/             # Procedural mesh factory (people/vehicles/buildings/props), shader walk-cycle, palettes, particles
tools/osm/           # Build-time OSM fetch + bake pipeline
```
- Sim modules are renderer/DOM-free → unit-testable headless; only `gfx/`, `ui/`, `audio/` touch Three.js/DOM/WebAudio.
- **Services are local-first** (resolved): local save (Capacitor Preferences), local leaderboards, date-seeded daily route (identical for all players via date math — no server), simulated rewarded-ad flow. Real Firebase/AdMob adapters slot behind the same interfaces post-launch (see next_steps.md).
- **Sand Watch rewind (resolved: ships in MVP)**: ring buffer of *complete* sim snapshots at 30 Hz (player, all pooled agents, traffic, pickpocket brains, taka event log, **RNG stream states**) — ~1.2 MB preallocated, zero GC. Rewind plays the buffer backwards visually, then restores the oldest frame; determinism is unit-tested via state hashing. Snapshotting all agents (not radius-limited) eliminates desync by construction.
- Crowd sim: flow along footpath splines + spatial-hash separation (not per-agent pathfinding). **Target = low-end Android WebView**: 150–250 agents in 2–3 InstancedMeshes, shader-injected procedural walk cycle, no shadow maps (blob decals), < 40 draw calls, no textures.

### 8.4 Content Authenticity & Sensitivity
- Pickpockets, crowds, traffic portrayed with humor and affection, never mean-spirited — the game is a love letter to Dhaka.
- Pocketmar spawns driven by **location types** (markets, terminals); Mohammadpur's difficulty comes from its density of those zones (user-approved framing, §3.2).
- **Eid/Qurbani guardrails**: never depict slaughter, blood, or the ritual itself — cows are pre-Eid street-logistics comedy only; the player dodges cows and can never harm or deliberately scare them (no points for it); the stampede bonus reads as *survival*, not mockery; the departing working-class crowd (head-load carriers, luggage-draggers) stays sympathetic, never buffoonish.
- Real brand signage replaced with playful parodies unless licensed.

---

## 9. Difficulty Curve & Onboarding (FTUE)
1. **First 60 seconds**: Dhanmondi lakeside, light crowd, learn drift + shoulder dip + duck. First cha dokan moment scripted.
2. **First crossing**: a quiet residential road — teach the wave-reading without punishment.
3. **First pickpocket loss**: scripted, small amount, immediately followed by glasses unlock offer — turns frustration into a goal. Tutorial run is unrated (§4).
4. Mohammadpur and Gulistan locked behind stars → aspirational endgame.

---

## 9.1 Home Screen & Flow (user feedback, Rev 5)
- **Home page** (always shown after the tutorial): big **▶ PLAY** button, **history** of recent runs (area, taka, stars, date), energy/streak/wallet, daily card, shop, missions, **controls guide** (touch + keyboard side by side), settings.
- **Play flow**: PLAY → choose a **map** (area) → random A & B revealed on the area map → choose a route (connect-A-to-B puzzle with risk stats) → run starts.
- **Gradual difficulty**: crowd density ramps over the first ~80 m of every run, and is globally eased until the player has earned 5⭐ (newcomer grace). Area tuning stays the long-term curve (Dhanmondi gentle → Gulistan chaos).
- **Art**: low-poly people get **faces** (eyes + mouth, Sims-readable at a glance), not blank blocks.
- **Roadside life**: denser synthesized props (trees/dustbins/cha dokans) + parked rickshaws and utility poles along the route so streets never feel empty.
- **Sound**: every action gets a catchy synthesized sound (jump, sit/cha sip, button clicks, results jingle) on top of the event stings.

## 10. Resolved Decisions
- **Camera**: third-person 3D (Subway Surfers-style chase cam), low-poly stylized.
- **Energy vs. retry**: free retries, energy gates new runs (§5); **generous** starting tune.
- **Controls**: touch layout per §2.1 table, no tilt.
- **Engine**: TypeScript + Three.js + Capacitor (§8.1).
- **Mohammadpur**: high-pocketmar area, location-type spawn mechanism (§3.2).
- **Sand Watch**: ships in MVP — nothing deferred to update 1.
- **Services**: local-first now; Firebase/AdMob post-launch via adapters.
- **Launch plan**: geofenced BD soft launch → tune with real players → global launch with "explore Dhaka" framing.

## 12. Rev 6 — Cartoon Pivot (resolved with user)
- **Aesthetic**: 90s-cartoon / Fall Guys / Among Us — candy-color buildings (per-building palette hash), bright skies, vivid crowd shirts, rounded chunky shapes. Photorealism (Google Street View / Maps 3D data) is legally unusable; the identity is *colorful Dhaka*, with REAL data underneath: real street layouts, real building footprints & heights, and **real English names** from OSM (shops, schools, hospitals, banks, named buildings) on signboards and rooftop title boards.
- **Street layout**: the player walks the footpath; the **traffic road runs on the LEFT** with dashed lanes and a constant **oncoming vehicle stream** (bus/CNG/rickshaw/bike, 8–16 m/s) — the vehicular mirror of the oncoming crowd. Buildings/stalls/props dress the RIGHT.
- **Road crossing = Crossy-Roads minigame**: arriving at a major road opens a top-down 2D lane-hopper (swipe/tap or arrows; lanes & speed scale with the road's traffic stat 3–7 lanes). Reach the far footpath = bonus and the run continues past the road; get hit = damage + knocked back to try again; the overbridge button inside the minigame is the safe skip (costs stamina, no bonus).
