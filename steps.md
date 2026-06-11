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

## M2 — Procedural Art
- [ ] gfx/meshFactory: low-poly flat-shaded people (limbId attribute, palette variants), player, props
- [ ] Shader-injected walk cycle on InstancedMesh (per-instance phase/speed/variant)
- [ ] Blob shadows, ground/footpath materials, sky/fog

## M3 — OSM Pipeline + Dhanmondi
- [ ] tools/osm: fetch (Overpass, cached raw → data/raw/), bake (project → simplify → footpath synthesis → buildings → POIs → route graph) → public/levels/dhanmondi.json
- [ ] world/: level loader, chunk streaming, buildings, water/parks, landmark labels, props from POIs (cha dokan, trees, dustbins, bus stops)
- [ ] routing/: seeded A→B (600–1800 m), k-diverse paths (penalty Dijkstra), per-route stats
- [ ] RouteSelect screen: canvas area map + route cards (crowd/traffic/crossings/cha/pickpocket/distance)
- [ ] ODbL attribution (in level JSON + menu/settings screen)

## M4 — Systems & Minigames
- [ ] Road-crossing minigame: traffic waves (bus/CNG/rickshaw/bike), gap commit, median freeze, overbridge alternative
- [ ] Pocketmar: tells (Turn + innocent same-direction walkers, Drift, micro-tells), suspicion scoring, Stare-Down (snap-target, 2.5 s CD), theft, glasses powerup, seated-theft tell, readability assist
- [ ] Phone-check: stop + own-map overlay, blind window, 20% theft cap
- [ ] Cha dokan / bus-stop rest (sit → stamina/health regen + seated theft risk)
- [ ] Fruit trees (jump-grab → points/health)
- [ ] Street life: sleeping dogs (bark-panic ripple), darting cats (stumble), dustbin smell clouds
- [ ] Director: frustration budget caps, hawker/mama micro-events

## M5 — Sand Watch
- [ ] Snapshot/restore on every sim system (SoA slabs + RNG streams), 180-frame ring buffer
- [ ] Rewind playback: sepia pass, sand particles, reversed whoosh, slow-mo exit
- [ ] vitest: rewind determinism via state hashing

## M6 — Economy & Meta
- [ ] Wallet, shop, powerups (glasses/shoes/umbrella/headphones/Sand Watch), cosmetic outfits (palette swaps: lungi, panjabi, school, office)
- [ ] 5-star criteria (tutorial unrated; rewind voids theft), area unlock chain
- [ ] Energy (free retries; generous: 8 runs/bar, ~12 min recharge; simulated rewarded-ad refill)
- [ ] Streaks, missions, Ajker Rasta daily (date-seeded, Sand Watch off, share card), ghost runs (seeded routes), local leaderboards
- [ ] Save schema migrations live

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
