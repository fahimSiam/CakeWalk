# CakeWalk — Publishing Guide (next steps)

The game is **complete and playable** right now: `npm install && npm run dev` → http://localhost:5173. All features are local-first; this guide covers everything between here and the App Store / Play Store.

---

## 0. Play it first

```bash
npm run dev          # play in browser (keyboard: A/D drift, W sprint, S shuffle,
                     # Space jump, Q/E shoulder dips, Q+E duck, F stare, M phone,
                     # G sit, R sand watch, B overbridge, ` debug overlay)
npm test             # 74 unit tests (sim, rewind determinism, economy, routing)
npm run e2e          # 6 Playwright tests (needs Chrome installed)
```

Dev URL params: `?ftue=0` skip tutorial · `?area=gulistan&seed=5` jump to an area · `?graybox=1` test corridor · `?sandwatch=1` grant the watch · `?debug=1` perf overlay.

---

## 1. Android (you can do this today, on this machine)

Android Studio + SDK are already installed. The native project is in `android/` (icons & splash already generated).

```bash
npm run build && npx cap sync
cd android
JAVA_HOME=/snap/android-studio/current/jbr ./gradlew assembleDebug   # debug APK
# → android/app/build/outputs/apk/debug/app-debug.apk — install on any phone
```

**This is the moment for the touch-feel pass**: play on a real device and tune
`src/player/Input.ts` constants (`TAP_MS`, `FLICK_PX_PER_MS`, drag sensitivity) until drift/dip/duck feel right. Everything else was designed for this but only a thumb can sign off.

**Release build (Play Store):**
1. Create a keystore (KEEP IT SAFE — losing it means losing the app identity):
   `keytool -genkey -v -keystore cakewalk.keystore -alias cakewalk -keyalg RSA -keysize 2048 -validity 10000`
2. Configure signing in `android/app/build.gradle` (`signingConfigs.release`).
3. `./gradlew bundleRelease` → upload the `.aab` in Play Console.

## 2. iOS (needs a Mac)

The native project is in `ios/`. On a Mac with Xcode:
```bash
npm install && npm run build && npx cap sync ios && npx cap open ios
```
Set your Apple Developer team in Signing & Capabilities, pick a device, Run. Archive → Distribute for TestFlight/App Store. (Apple Developer Program: $99/yr.)

## 3. Store accounts & listings

- **Google Play Console** ($25 one-time) · **Apple Developer** ($99/yr).
- App ID is `ai.agentsense.cakewalk` (change in `capacitor.config.ts` *before* first upload if you want a different one — it's permanent).
- **Required: privacy policy URL** (both stores). The game stores everything locally today; say so. Update it when Firebase/AdMob arrive.
- **Required: OSM attribution** in both store descriptions AND in-app (already in Settings + route screen): *"Map data © OpenStreetMap contributors, available under the Open Database License."* The baked `public/levels/*.json` files are ODbL derivative databases — keep them under ODbL (a `LICENSE-DATA` note in the repo is wise).
- Age rating questionnaires: no violence beyond cartoon bumps; simulated-gambling = NO; user-generated content = NO.

## 4. Real ads (AdMob) — replaces the simulated ad screen

1. Create an AdMob account + app, create **3 rewarded ad units**: `energy-refill`, `taka-doubler`, `revive`.
2. `npm install @capacitor-community/admob && npx cap sync`
3. Write `AdMobAds implements IAds` (the interface in `src/services/index.ts`) calling `AdMob.prepareRewardVideoAd` / `showRewardVideoAd`, mapping placement → ad unit ID.
4. Swap it in at `createLocalServices()` in `src/services/index.ts` (one line).
5. Add the AdMob App ID to `android/app/src/main/AndroidManifest.xml` and `ios/App/App/Info.plist` per the plugin README. Test with Google's test ad units first.

## 5. Real backend (Firebase) — replaces local leaderboards/save

1. Create a Firebase project; add Android + iOS apps; download config files into the native projects.
2. Anonymous Auth + Firestore:
   - `FirebaseLeaderboard implements ILeaderboard` — collection `boards/{boardId}/entries`, top-N query. The daily board id is already `daily-YYYY-MM-DD`.
   - Cloud save: mirror the save blob to `users/{uid}` on `SaveSystem.flush()` (add a `CloudSave` decorator over the existing local save — interface already isolates it).
   - Ghosts: store the packed keyframe arrays (already compact `number[]`) per board; download a friend's best for ghost racing.
3. Firestore security rules: entries write-once per uid/day, score sanity caps (server-side max plausible taka ≈ route length × multiplier ceiling).
4. `IAnalytics` → Firebase Analytics: the `track()` calls are already in place.

## 6. Soft launch plan (from idea.md)

1. **Closed testing** (Play Console internal track): friends + family, 2 weeks. Watch: tutorial completion rate, runs/session, where players die, energy starvation.
2. **BD-only open soft launch**: geofence to Bangladesh in Play Console. Tune with remote-config-style constants (consider moving the numbers in `Energy.ts`, `archetypes.ts`, `PickpocketSystem.ts` constants into a fetched JSON for live tuning).
3. **Global launch** framed as "walk the real streets of Dhaka."
4. Marketing assets that match the game's virality design: clip the Sand Watch rewind and stampede survivals (designed to look good vertical); the daily share card already brands itself.

## 7. Post-launch backlog (designed-in, not yet built)

- Seasonal events: Eid-ul-Fitr reversed-flow event (crowd sim already has the `flowDirection` parameter and the "Shadow" tell is specced in idea.md §2.6), Pohela Boishakh cosmetics, monsoon flooding.
- "Local Legend" weekly per-area leaderboards (needs Firebase, board ids like `weekly-{area}-{isoWeek}`).
- Friend ghosts on the daily (needs Firebase ghosts above).
- Season pass cosmetic track; more outfits (palette entries in `src/meta/progression.ts`).
- Play Asset Delivery if more cities/areas push the bundle over ~150 MB (currently the whole web bundle is ~1.2 MB + 9 MB levels — nowhere close).
- iOS haptics on bumps/near-misses (`@capacitor/haptics` is installed; wire to `bump`/`nearMiss` events).

## 8. Repo conventions (for whoever joins)

- `steps.md` = living tracker, updated every task. `idea.md` = design truth.
- Sim code (`crowd/`, `player/`, `traffic/`, `pickpocket/`, `items/`, `director/`, `economy/RunScore`) is renderer-free, uses seeded RNG streams only (no `Math.random`), and every system implements `snapshot/restore` — **keep it that way or the Sand Watch desyncs.** New sim state must be added to the snapshot. The rewind determinism test (`tests/rewind.test.ts`) will catch violations.
- Re-bake levels after editing the pipeline: `npm run osm:fetch && npm run osm:bake` (raw responses are cached in `data/raw/`).
