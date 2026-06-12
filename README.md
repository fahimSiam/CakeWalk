# CakeWalk 🚶‍♂️

> *Everyone in Dhaka is going one way. You're going the other.*

A cross-platform (iOS/Android) walking simulator set in **real, OSM-derived replica streets of Dhaka**. It's the final days before Eid-ul-Adha — the whole city is rushing to the bus terminals and launch ghats to get home. You're the only one walking against the flow, toward *your* home.

Dodge the crowd with analog drift, shoulder dips and full ducks. Read the street to spot **pocketmars** (they're the ones walking *your* way…). Cross Dhaka traffic as a high-risk minigame — or take the overbridge like a coward. Refuel at cha dokans. Grab mangoes off street trees. Survive the escaped Qurbani cow stampede. And when it all goes wrong: turn the **Sand Watch** and rewind time.

## Tech

- **TypeScript + Three.js + Vite**, wrapped with **Capacitor** for native iOS/Android
- 100% procedural art (flat-shaded low-poly, zero asset files) & WebAudio-synthesized sound
- Real map data: OpenStreetMap → offline bake pipeline → 6 playable Dhaka areas
  (Dhanmondi, Uttara, Bashundhara R/A, Mohammadpur, Puran Dhaka, Gulistan/Motijheel)
- Deterministic 30 Hz sim with full-state snapshots → 6-second time rewind, daily
  shared routes (Wordle-style), and ghost racing — all without a server

## Run it

```bash
npm install
npm run dev        # → http://localhost:5173
npm test           # unit tests (sim determinism, economy, routing)
npm run e2e        # Playwright end-to-end
```

Keyboard (dev): `A/D` drift · `W` sprint · `S` shuffle · `Space` jump · `Q/E` shoulder dips (`Q+E` duck) · `F` stare-down · `M` phone check · `G` sit · `R` sand watch · `B` overbridge · `` ` `` debug overlay

Android: see `next_steps.md` (debug APK builds on this machine today).

## Project docs

- **`idea.md`** — full game design document
- **`steps.md`** — living build tracker (every milestone logged)
- **`next_steps.md`** — publishing guide (stores, AdMob/Firebase wiring, soft launch)

## License & data

Code: see `LICENSE`. Map data in `public/levels/` and `data/raw/` is derived from
**© OpenStreetMap contributors** and remains under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
