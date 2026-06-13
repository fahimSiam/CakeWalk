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

## M7 — All Areas + Theming ✅
- [x] All 6 areas fetched + baked from real OSM (uttara 1.3 MB, bashundhara 1.2, mohammadpur 2.0, puran_dhaka 2.3, gulistan 1.1); per-area tuning multipliers baked into edge stats (crowd/traffic/pickpocket per idea.md §3.2)
- [x] Atmosphere: seeded time-of-day (morning/noon/evening) × weather (clear/rain): noon = +30% stamina drain, evening = +25% crowd, rain = player slow (umbrella negates) + crowd umbrellas widen hitboxes + sky/fog palettes + rain particle field
- [x] Eid theming: led Qurbani cows (slow wide walls in the exodus flow), Director-scheduled **escaped-cow stampede** (3 fast cows, crowd panic, ৳80 survival bonus, hit = 35 dmg + voids bonus), low-poly cow renderer; luggage/head-load crowd already in archetype mix
- [x] All cow/atmosphere state snapshot-covered for rewind; 74 unit + 5 e2e green (all areas runnable)

## M8 — FTUE, Audio, i18n, Polish ✅
- [x] FTUE: first launch auto-starts a fixed-seed Dhanmondi tutorial run (low crowd, no organic pocketmars) — 6 teaching toasts by distance (drift/dip/duck/sprint/jump/cha) + scripted small first theft w/ explanation + finale; unrated, sets ftueDone (`?ftue=0` skips for dev)
- [x] WebAudio synth soundscape (zero audio assets): brown-noise city rumble, periodic detuned-saw horns, rickshaw-bell near-miss ping, bump/vehicle thuds, theft/spotted stings, fruit pluck, bark, stampede sub-rumble, cakewalk chime, rewind whoosh+heartbeat; rain noise layer; honors audio setting, autoplay-safe
- [x] i18n: en + bn dictionaries for all run toasts/tutorial/results labels; menu language toggle live-switches; Bangla via system font stack
- [x] Perf: adaptive pixelRatio (2→1.5→1.25→1 on sustained >22 ms frames, recovers with headroom); share cards landed in M6
- [x] 74 unit + 6 e2e green

## M9 — Packaging + Publishing Guide
- [x] Capacitor android/ + ios/ shells added & synced; procedural app icon (headless-Chrome-rendered SVG) → 61 Android + 4 iOS assets via @capacitor/assets
- [x] **Android debug APK builds clean** (7.7 MB) using Android Studio's bundled JDK: `cd android && JAVA_HOME=/snap/android-studio/current/jbr ./gradlew assembleDebug`
- [x] `next_steps.md` written: device touch-tuning, keystore/release builds, store listings + ODbL credit, AdMob/Firebase adapter wiring, BD soft launch, post-launch backlog
- [x] Reviewer agent final full review done — 3 CRITICAL (dead tutorial theft, daily-retry leaderboard bypass, fail-bank infinite farming), 3 HIGH (HUD touch double-fire, GPU leaks per run, save-migration null crash), 4 MEDIUM, lows

## M10 — Review Fixes + User Feedback (Rev 5) ✅
- [x] C1 tutorial theft staged once (was re-pinned out of range every tick) · C2 retry hidden on daily (leaderboard integrity) · C3 failed runs bank 25% taka, missions on success only (kills die-retry farming)
- [x] H1 HUD touchstart preventDefault (synthetic click double-fired sit/phone) · H2 GPU disposal: graybox/gate via owned-resource registry, rain via AtmosphereHandle.dispose · H3 save migration structural validation (null/array masquerade no longer bricks boot)
- [x] M1 summary+elapsed snapshotted in rewind buffer · M2 bake drops ways with nodes/geometry mismatch (logged) · M3 routeSelect generation guard vs async race · M4 airborne (overbridge) immune to crowd/cow/dog/cat/dustbin
- [x] LOW: min-steal respects cap, overbridge accepted across whole prompt window (timer scales w/ remaining distance), cat instancing = MAX_CATS + dog DynamicDrawUsage, simulated ad has cancel→false path
- [x] Home page v2: ▶ PLAY reveals map picker (flow: map → random A/B → route puzzle → run), 🕘 History (last 10 runs w/ area/taka/stars), 🕹 Controls guide (touch+keyboard table + tips), UI click sounds
- [x] Gradual difficulty: density ramps 45%→100% over first 80 m, newcomer ×0.7 until 5⭐, softer base (30+crowd×22, cap 170), tutorial 45
- [x] Faces: eyes + mouth on the shared person geometry (crowd/pocketmars/player/ghost all inherit)
- [x] Roadside life: tree 42 m/dustbin 70 m/cha 120 m synthesis (re-baked, ~50% more POIs) + parked rickshaws (~45 m) and utility poles (~28 m) alternating sides along every route
- [x] Action sounds: jump blip, cha sip+clink, results jingle (success/fail variants), menu click
- [x] 74 unit + 6 e2e green; menu/run screenshots verified

---

## Log
- **2026-06-11**: Project started. idea.md + steps.md written; reviewer pass 1 applied (Rev 2).
- **2026-06-12 (a)**: User feature batch applied (Rev 3): Eid-ul-Adha exodus storyline, pocketmar tell/Stare-Down minigame, Sand Watch animation, 5-star rating, street life. Reviewer delta-pass applied (7 fixes).
- **2026-06-12 (b)**: User locked everything: all §11 decisions (Mohammadpur high-pocketmar OK, Sand Watch in MVP, generous energy), ALL features in MVP, build the full game now. Stack chosen with user: Three.js + Capacitor + procedural art + real OSM + local-first services. idea.md reconciled to Rev 4 (restored Rev 3 content lost to stale editor buffer, kept user's Dhanmondi 2→32 + head-load/full-duck additions, updated §8 to final stack). steps.md restructured to build milestones M0–M9. Implementation plan approved; starting M0.
- **2026-06-12 (c)**: M0 done — project scaffold, core architecture (GameLoop 30 Hz fixed-step, typed EventBus, seeded Rng streams w/ snapshot, StateMachine, versioned SaveSystem, DebugOverlay + test hook). Typecheck + 16 unit tests + e2e smoke (screenshot verified) green. Note: Playwright must use `channel: 'chrome'` on this machine.
- **2026-06-12 (d)**: M1–M9 built & committed (graybox → procedural art → OSM Dhanmondi → systems/minigames → Sand Watch → economy/meta → all 6 areas + Eid theming → FTUE/audio/i18n → Capacitor packaging, Android debug APK 7.7 MB). Final reviewer pass + user playtest feedback → M10: all 3 CRITICAL + 3 HIGH + 4 MEDIUM + lows fixed; home page v2 (PLAY/history/controls), gradual difficulty, faces, roadside clutter, action sounds. next_steps.md + README written. Soak-tested (7 consecutive runs, zero errors).

## M11 — Browser UX + Cartoon Faces (user feedback round 2) ✅
- [x] Menu ALWAYS first: removed the first-launch auto-tutorial redirect; new players get a dashed "🎓 New here? Take the 2-minute tutorial" card above the daily (PLAY works immediately too)
- [x] Cartoon person v2 (Sims-readable): bigger head + neck + ears, white eyes w/ pupils, brows, nose, mouth, hair framing (cap/back/sideburns), tapered torso, shoes; walk-shader pivots retuned (hip 0.78, shoulder 1.2); shared by crowd/pocketmars/player/ghost
- [x] On-screen keyboard controls overlay during runs on non-touch devices (H toggles); map choosing flow unchanged (PLAY → map → random A/B → route puzzle)
- [x] 74 unit + 6 e2e green; menu + in-run screenshots verified

## Log (continued)
- **2026-06-12 (e)**: M11 — menu-first boot (tutorial is now an invitation, not a kidnapping), cartoon faces v2, desktop controls overlay.

## M12 — Street Realism + Feel (user feedback round 3) ✅
- [x] Smooth cornering: per-vertex tangent interpolation in SplineCorridor (no facing snaps at polyline corners) + critically-damped chase camera
- [x] Route variety: short routes denser (length factor 0.85–1.3×), long routes alternate crowded/easy sections via per-edge crowd stats (density profile normalized to route average)
- [x] Rest fixed: stalls sit OFF the walkable strip — proximity now judged along s (3.5 m) with lenient t (7.5 m), sit snaps player to the strip edge by the stall; floating ☕/🪑 bobbing marker above the active rest spot; POI capture radius 8→12 m
- [x] Wider roads: corridor half-width 2.4→3.2 m, walking ribbon 5.2→7.6 m
- [x] Audio: lo-fi synthesized background groove (bass pattern + sparse pentatonic plucks) under the city bed; stamina-empty buzz cue (staminaEmpty event now actually emitted)
- [x] Real 3D models: Kenney (MIT) truck + motorcycle GLBs for bus/bike traffic (flattened to instanced geometry + colormap texture, per-kind draw calls); detailed procedural CNG (green 3-wheeler) + cycle rickshaw in traffic; sleeping dog (snout/ears/tail/paws) and darting cat (ears/tail-up) remodeled; LICENSE-kenney.txt shipped
- [x] **Street View-feel pass (legal route — no Google assets)**: facade textures (residential windows+balconies / commercial glass+AC / bazaar shutters / plaster) tiled per storey & bay on real OSM footprints with per-kind tinting; roofs separated; **signboards with real OSM shop/POI names** (Bengali renders natively) facing the street, up to 36/route; shop POIs added to bake (re-baked all areas)
- [x] 74 unit + 6 e2e green; street/rest-marker/crossing screenshots verified

## Log (continued 2)
- **2026-06-12 (f)**: M12 — smooth corners, sectioned crowd density, rest fix + markers, wider roads, music, Kenney vehicle models + better creature models, facade textures + real shop-name signboards. Note: Google Street View / Maps 3D data is legally unusable (ToS); realism path = OSM data + procedural facades + real OSM signage.

## M13 — Sit Prompt Popup (user feedback) ✅
- [x] San Andreas-style action prompt: the moment a stall/bench is in sitting range, a bordered pill pops in (spring scale-in + glow pulse) above the buttons — "☕ Cha break [G] sit" on keyboard, "tap 🪑" on touch; disappears on leave/sit; works alongside the floating ☕/🪑 world marker
- **2026-06-12 (g)**: M13 sit prompt verified by screenshot next to a live cha dokan.

## M14 — Sitting Animation + Seated Minigame (user feedback) ✅
- [x] Real sit pose: shader fold (legs forward at hip, body sinks onto bench, arms forward "holding the cha") eased in/out via uSit uniform; avatar walks to the bench point (street side of the stall, never inside it) and turns to face the street; cinematic high three-quarter camera frames the seated character
- [x] Seated-theft minigame made visible: thief creeps toward the bench during a 1.6 s tell with a pulsing ❗ marker overhead, red alert pill ("Pocketmar reaching for your pocket!") with draining timer bar + F/👀 hint, two-tone audio alert; shoo = +5 taka, miss = -12% wallet
- **2026-06-12 (h)**: M14 verified by screenshots (sit pose at cha dokan, alert minigame mid-tell).

## M15 — Cartoon Pivot + Crossy Crossing (user feedback round 4) ✅
- [x] Candy-color art direction: per-building palette (10 candy tones by position hash; mosques/landmarks keep signature tints), bright cartoon skies (cream/cyan/peach), vivid crowd shirts
- [x] Real English names everywhere: bake prefers name:en (Latin-script heuristic), hospitals/clinics/pharmacies/banks fetched (+ school/hospital ways), refetched + re-baked all 6 areas; signboards extended to hospitals/schools/landmarks + rooftop title boards on named real buildings (up to 20/route)
- [x] Traffic rework: perpendicular crossing waves REPLACED by (a) constant oncoming stream on a left-side road (3 lanes, dashed markings, 8–16 m/s, never collides — pure dread) and (b) Crossy-Roads 2D minigame at major roads (canvas overlay, candy cars, hop grid, swipe/tap/arrows, lanes+speed scale with traffic stat; crossed = bonus + teleport past, hit = 32 dmg + knockback, overbridge skip = safe, -18 stamina)
- [x] Right-side street dressing only (rickshaws/poles); left-side rest spots excluded (across the road); road ribbon + instanced lane dashes
- [x] Traffic tests rewritten (pendingZone trigger, outcome application, stream no-collision, overbridge); minigame e2e test (opens at zone, overbridge resolves); 75 unit + 7 e2e green
- **2026-06-12 (i)**: M15 verified by screenshots (cartoon street w/ oncoming truck/CNG stream on dashed road, Crossy minigame with candy cars).

## M16 — Color/Polish/Camera Feel Pass (user feedback round 5) ✅
- [x] **Vibrant tiled footpath**: the walkway is now a grid of inset candy tiles — 4 colored columns across the width, the 6-tone palette stepping per row+column so it reads as a checkered Fall-Guys/Crossy-Roads path with dark grout showing between tiles (LevelRenderer.addTiledFootpath, DoubleSide so winding never culls it); dark grout base ribbon underneath
- [x] **Camera (Temple-Run feel)**: chase cam raised (Y 3.0→5.0) and pulled back (5.2→6.0) along the path tangent, looking 3 m ahead and slightly down, lateral lead halved — the world banks with the road and the character is no longer hidden behind buildings on curves (verified on a curvy Puran Dhaka route)
- [x] **Sit prompt actually appears** — root cause was a visible-vs-seatable mismatch: LevelRenderer rendered cha dokans anywhere in a 130 m grid on both sides, while only stalls within 12 m on the right were registered as interaction points, so most stalls you walked up to did nothing. Now stalls are rendered ONLY at the reachable interaction points (RunState.buildRestStalls → LevelRenderer.addRestStalls, bench faces the street), the POI capture radius widened (12→22 m) and snapped into the reachable right-side band (t 2.2–6.0 m), gaps >170 m filled with synthesized cha dokans (fillRestGaps → ~17 seatable stalls/route), and REST_RANGE_S widened 3.5→5.5 m. The "☕ Cha break [G] sit" pill now pops reliably (new e2e regression test)
- [x] **Brighter, less bland scene**: fog far pushed 130→200 m so colorful building rows stay visible deep into the scene; ground plane lightened; water/park polys brightened
- [x] **Polished models**: CNG remodeled (bright green body + yellow roof + headlights + skirt), Qurbani cow remodeled (pale body, brown head, ears, hump, festive pink garland collar, tail)
- [x] 75 unit + 8 e2e green (added sit-prompt regression test); screenshots verified (tiled street, sit prompt on-screen, curved-road camera)
- **2026-06-13**: M16 — vibrant tile floor, Temple-Run camera, sit-prompt visible==seatable fix + gap-fill, brighter atmosphere, polished CNG/cow. NOTE for future sessions: Playwright `npm run preview` serves the LAST `vite build` and `reuseExistingServer:true` — always `npm run build` before e2e screenshots or you'll inspect a stale dist.

## M17 — Endless-Runner Layout + Cartoon Models (user feedback round 6) ✅
- [x] **Characters → Fall-Guys/Among-Us beans**: buildPersonGeometry rebuilt as a chunky rounded bean — big round head, fat instance-tinted costume capsule body, stubby capsule limbs, big cartoon eyes; walk-shader HIP pivot moved to 0.5 m; segment counts tuned for instancing. Reads like the games the user named (Subway Surfers / Among Us / Fall Guys / REPO)
- [x] **"Straight near, curve far" world bend** (gfx/worldBend.ts): view-space vertex bend dropping geometry by depth² beyond a near straight-zone, injected into EVERY run material (chains the walk shader; patches async GLB swaps). The block under the player stays straight; the road + buildings curve and fall away in the distance (Temple-Run/Subway-Surfers). FOV 60→70 to stop portrait looming
- [x] **2D buildings on the RIGHT, colored by type**: 3D extrusion replaced by flat unlit facade billboards pinned to the right edge, projected onto the route in real along-route order, colored per TYPE (hospital red, school blue, mosque green, market orange, shop yellow, landmark purple, commercial teal, residential pink) with English OSM signboards; facades landing on the route (sharp inside curves) are skipped so nothing engulfs the camera. **Legal note: real building types/positions/names come from OpenStreetMap — Google Maps data is unusable (ToS); reiterated to user**
- [x] **Walkable high-risk road**: player left-clamp opened onto the road (Player.ROAD_REACH, asymmetric — building wall right, open road left); stepping past t≈-3.4 exposes the player to the now denser (12 cars, 4 lanes) and faster (bus 11-15, cng 12-17, bike 16-21 m/s) oncoming stream, which now collides (28 dmg + shove back). Crowd-free shortcut, but deadly
- [x] **Rest stalls on both sides**: cha dokans/bus stops snap to a reachable band on their own side (right footpath OR left edge, kept off the road); gap-filler alternates sides; bench faces back toward the walkway from either side
- [x] **A bit faster paced**: walk 2.4→3.0, jog 5.0→6.2, shuffle 1.1→1.4, lateral 3.2→3.7 m/s
- [x] 76 unit (+road-collision test, +updated walk-speed bound) + 8 e2e green; screenshots verified across seeds (clean right-buildings/left-road/colorful-path framing; on-road bus risk; worst-case curve no longer engulfs)
- **2026-06-13**: M17 — bean characters, curved-world bend, 2D type-colored right-side facades (OSM, not Google), walkable fast-car road, two-sided rest stalls, faster pacing.
