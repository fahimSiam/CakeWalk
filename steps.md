# CakeWalk — Project Steps

> Living task tracker. **Update after every completed task.** Brief on purpose — see `idea.md` (Rev 4) for full design, `next_steps.md` (written at the end) for publishing.
> **Stack (locked)**: TypeScript + Three.js + Vite + Capacitor. Procedural low-poly art, WebAudio synth audio, real OSM Dhaka data baked to JSON, local-first services.

## Status Legend
`[x]` done · `[~]` in progress · `[ ]` todo

---

## Phase 0 — Planning & Docs ✅
- [x] `idea.md` design doc (Rev 4: all reviewer fixes + user features + decisions locked)
- [x] Two reviewer-agent passes, all findings applied
- [x] User sign-off: Mohammadpur = high-pocketmar area; Sand Watch in MVP; generous energy; ALL features in MVP (nothing deferred)
- [x] Stack decision: Three.js + Capacitor (Unity not available/testable in dev env), procedural art, OSM maps, local-first services
- [x] Overpass API verified reachable (needs User-Agent header)

## M0 — Scaffold ✅
- [x] npm project: Vite + TS strict + Three.js + vitest + Playwright + Capacitor deps
- [x] Core: GameLoop (fixed 30 Hz sim + interpolated render), EventBus (typed), Rng (seeded streams + snapshot/restore), StateMachine, SaveSystem (versioned migrations)
- [x] Debug overlay (FPS/tick/draws, `?debug=1` or backtick) + `window.__cakewalk` test hook; flat-shaded smoke scene renders
- [x] 16 vitest tests + Playwright smoke (system Chrome channel — bundled Chromium unsupported on this OS) all green

## M1 — Graybox Run (fun gate) ✅
- [x] 500 m graybox corridor (Corridor interface: sim runs in s/t path coords; M3 swaps in OSM spline), chase cam, results screen + free retry
- [x] Input: keyboard (A/D, W, S, Space, Q/E, Q+E duck, F stare, M phone, R sand watch, G sit) + touch (left-drag drift, right hold sprint/drag-down shuffle/tap jump/flick dips, HUD 👀+🗺 buttons)
- [x] Player: analog drift, 3 speed tiers w/ smooth accel, jump arc, dips + full duck (pose-based hitbox + band clearing), health w/ bump cooldown, stamina w/ exhaustion lock + rest recovery; snapshot/restore ready
- [x] Crowd v1: SoA pool (220 cap), flow-direction param, 8 archetypes (uncle/commuters/delivery/hawker/head-load HIGH-band/luggage/phone-stopper), spatial-hash separation, panic system (bark ripple ready), bump bands, despawn/respawn; snapshot/restore + determinism tests
- [x] Near-miss combo (once per agent) + Cakewalk meter (fill → 8 s 2x) + taka (distance + near-miss, multiplier)
- [x] 34 unit tests + 2 e2e tests green; screenshot verified; sim 0.1 ms/tick @ 120 agents
- [~] 🎯 Fun gate: NEEDS USER PLAYTEST — `npm run dev` then keyboard play

## M2 — Procedural Art ✅
- [x] gfx/meshFactory: low-poly person (~180 tris, limbId + tint attrs, clothes take instanceColor, skin/hair/pants fixed), head-load sack, basket, luggage props
- [x] Shader walk cycle injected into MeshLambertMaterial (limb shear around hip/shoulder pivots + torso bob; instanced aPhase/aSwing attrs, player uses uniforms; panic = bigger swing). NOTE: three's vColor is vec4 now — custom color_vertex chunk handles it
- [x] PlayerAvatar (tinted outfit, pose transforms: dip rotate, duck squash, jump arc) + instanced blob shadows; 5 draw calls for entire crowd
- [x] Screenshot verified: reads as a proper Crossy-Road-style street crowd

## M3 — OSM Pipeline + Dhanmondi ✅
- [x] tools/osm: fetch.ts (Overpass w/ UA header, cached raw committed), bake.ts (project → classify+DP-simplify → intersection graph from shared node ids → buildings (real footprints, levels→height) → POIs (real cha dokans/mosques/markets/bus stops/trees + deterministic synthesis where sparse) → per-edge stats from location types) → public/levels/dhanmondi.json (639 roads, 7.8k buildings, 2.1k POIs, 1034n/1238e graph, 1.3 MB)
- [x] world/: levelStore (fetch+cache), LevelRenderer (route-proximity filtered: road ribbons, extruded real buildings vertex-colored by kind, water/parks, instanced props: trees/dustbins/cha dokan stalls/bus stops), SplineCorridor (s/t over route polyline, closestS)
- [x] routing/RouteGraph: seeded A→B in 500–1700 m band, k=4 diverse paths (penalty Dijkstra ×1.7), per-route cards stats (crowd/traffic/pickpocket/cha/crossings)
- [x] RouteSelect screen: real canvas map (roads/water/parks/landmark labels/A/B/4 colored routes) + stat cards + start; ODbL attribution shown
- [x] Run drives through real Dhanmondi (route corridor, crowd density from route stats, finish gate at B); chase cam fixed for arbitrary path directions
- [x] 40 unit + 3 e2e tests green; route-select + in-run screenshots verified
- [ ] (deferred to M8 perf pass) chunk streaming — current route-radius filter holds 53k tris / 16 draws

## M4 — Systems & Minigames ✅
- [x] Road-crossing minigame: zones at majorCrossing route nodes, perpendicular vehicle waves (bus/CNG/rickshaw/weaving bike) in path coords, hit = damage + knockback, direct-cross bonus = 15×difficulty, overbridge button (auto-walk lift, safe, zero bonus); instanced vehicle renderer (1 draw call)
- [x] Pocketmar: Disguised→Turn→Drift→Strike→Flee lifecycle, 25% innocent same-direction walkers, suspicion scoring, Stare-Down snap-target in facing cone (2.5 s CD; spotted = +10 & flee, innocent = combo halved), phone-locked steal = 20% cap, seated-theft 1 s tell (stare to shoo), glasses reveal flag (shop in M6); renderer blends them into crowd, reveals on Strike/glasses
- [x] Phone-check: 2.5 s min/1 s cancel, blind+stationary, own-map canvas overlay from baked data (live position, route, destination — zero Google assets)
- [x] Cha dokan (heal+stamina) / bus stop (stamina) rest, contextual 🪑 button, auto-stand when full
- [x] Fruit trees: jump-grab at real OSM tree positions → +12 taka +6 HP, once per tree
- [x] Street life: dogs (low obstacle; sprint near = bark + crowd panic), darting cats (combo break), dustbins (obstacle + smell-cloud crowd swerve)
- [x] Director: pickpocket suppression after heavy bump 6 s / theft 12 s / bark 8 s; micro-events (hawker/directions/cha offer w/ brief slow)
- [x] All systems snapshot/restore-ready; 55 unit + 3 e2e green

## M5 — Sand Watch ✅
- [x] Snapshot/restore on every sim system + RNG stream states; 180-frame Float64 ring buffer (~2.3 MB preallocated, zero GC). Two determinism bugs caught & fixed by tests: crowd freeCursor wasn't snapshotted; capture must run AFTER event flush (handlers mutate sim state)
- [x] SandWatch item: charge per 400 m walked, one charge, disabled on daily; backwards visual scrub (1.5 s) → restore oldest frame → 0.4× slow-mo recovery; HUD ⏳ button w/ conic charge ring (`?sandwatch=1` for dev)
- [x] RewindFx: sepia via CSS filter on the WebGL canvas + golden sand-grain canvas overlay converging on the watch; color snaps back at the landing
- [x] vitest: state-hash equality across restore+replay, divergence with different inputs, charge/activation rules, full-buffer rewind distance, daily-disabled (60 tests green; audio whoosh lands with M8 audio pass)

## M6 — Economy & Meta ✅
- [x] Services layer: IAds (simulated 5 s rewarded ad), ILeaderboard (local, server-shaped API), IAnalytics (noop) — real adapters slot in post-launch
- [x] Shop: glasses (3-run consumable charges), shoes (-20% stamina drain), umbrella (M7 rain), headphones (+25% meter gain), Sand Watch, 3 outfits (palette swaps applied to avatar); no pay-to-win
- [x] 5-star criteria (finish/pace-normalized-par/health>50%/untouched-wallet/streetsmart-combo≥8); rewind voids theft automatically via state restore; area chain unlock (0/3/7/12/18/24⭐, best-run stars per area)
- [x] Energy: 8/bar, 12 min recharge, free retry of the same failed run, daily always free, ad refill; menu countdown
- [x] Streaks (consecutive-day), 3 deterministic daily missions w/ taka rewards, Ajker Rasta daily (date-seed → area+route, Sand Watch off, one banked attempt, local leaderboard, ghost record/race vs translucent best), share card (canvas → native share/download), mid-run ad revive (not on daily), post-run taka doubler
- [x] MenuState home (areas/energy/streak/wallet/shop/missions/settings + ODbL attribution + language/audio toggles); 72 unit + 4 e2e green

## M7 — All Areas + Theming
- [ ] Bake Uttara, Bashundhara R/A, Mohammadpur, Puran Dhaka, Gulistan/Motijheel
- [ ] Per-area tuning (crowd/traffic/pickpocket profiles per idea.md §3.2)
- [ ] Time-of-day/weather: rain (slippery, umbrellas), noon heat, evening rush
- [ ] Eid theming: cows (moving walls), luggage/head-load crowd mix, escaped-cow stampede event

## M8 — FTUE, Audio, i18n, Polish
- [ ] FTUE: scripted first-60 s, first crossing, first theft + glasses offer; unrated
- [ ] WebAudio soundscape: rickshaw bells, horns, crowd babble, cha clinks, rain; rewind reverse audio
- [ ] i18n: full bn + en pass
- [ ] Results/share cards; perf pass (pixelRatio scaling, draw-call audit)

## M9 — Packaging + Publishing Guide
- [ ] Capacitor: add android + ios platforms, icons/splash, config, sync
- [ ] Attempt CLI Android debug build if JDK/SDK present
- [ ] Reviewer agent final full review
- [ ] Write `next_steps.md` (signing, stores, real AdMob/Firebase wiring, ODbL credit, BD soft launch)

---

## Log
- **2026-06-11**: Project started. idea.md + steps.md written; reviewer pass 1 applied (Rev 2).
- **2026-06-12 (a)**: User feature batch applied (Rev 3): Eid-ul-Adha exodus storyline, pocketmar tell/Stare-Down minigame, Sand Watch animation, 5-star rating, street life. Reviewer delta-pass applied (7 fixes).
- **2026-06-12 (b)**: User locked everything: all §11 decisions (Mohammadpur high-pocketmar OK, Sand Watch in MVP, generous energy), ALL features in MVP, build the full game now. Stack chosen with user: Three.js + Capacitor + procedural art + real OSM + local-first services. idea.md reconciled to Rev 4 (restored Rev 3 content lost to stale editor buffer, kept user's Dhanmondi 2→32 + head-load/full-duck additions, updated §8 to final stack). steps.md restructured to build milestones M0–M9. Implementation plan approved; starting M0.
- **2026-06-12 (c)**: M0 done — project scaffold, core architecture (GameLoop 30 Hz fixed-step, typed EventBus, seeded Rng streams w/ snapshot, StateMachine, versioned SaveSystem, DebugOverlay + test hook). Typecheck + 16 unit tests + e2e smoke (screenshot verified) green. Note: Playwright must use `channel: 'chrome'` on this machine.
