#!/usr/bin/env node
/**
 * Downloads the game's 3D art (CC0) from Poly Pizza's public CDN.
 *
 * Poly Pizza serves each model's binary glTF at https://static.poly.pizza/<uuid>.glb;
 * the <uuid> is embedded in the model's /m/<id> page. We resolve id → uuid →
 * download, saving into public/models/<category>/<name>.glb. Re-runnable: skips
 * files already present unless FORCE=1.
 *
 * Sources (all CC0 / public domain, no attribution required):
 *   - Characters / animals / trees / street: Quaternius  (https://poly.pizza/u/Quaternius)
 *   - Cars: "Cars Bundle"                                (https://poly.pizza/bundle/Cars-Bundle-FE5IWe6OMk)
 *
 * Usage: node tools/assets/fetch.mjs
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'public/models');

/** category → [name, polyPizzaModelId][] */
const MANIFEST = {
  // Quaternius "Animated Humans" — all share one "HumanArmature" rig with
  // flat (untextured, tintable) materials and Walk/Run/Idle/Jump/Sitting clips,
  // so the player and the whole crowd are one cohesive art style.
  characters: [
    ['man', 'fjHyMd5Wxw'],
    ['man-suit', 'mQnGoME1ez'],
    ['woman', 'AQsd9ngvKU'],
    ['woman-casual', 'jpKRgGDxhk'],
    ['woman-dress', 'zMyPlQXBzq'],
  ],
  // Poly Pizza "Cars Bundle".
  cars: [
    ['car-1', 'Cz6yDaUcM9'],
    ['car-2', 'unqqkULtRU'],
    ['suv', 'xsMtZhBkxL'],
    ['taxi', 'x43lOScTpN'],
    ['police', 'BwwnUrWGmV'],
    ['sports-1', '1mkmFkAz5v'],
    ['sports-2', 'OyqKvX9xNh'],
  ],
  animals: [
    ['cow', '26zM1outCr'],
    ['cat', 'qKICY6xla2'],
    ['dog', '2kUk0QqpCg'],
  ],
  nature: [
    ['tree-1', 'aVOxaHRPWe'],
    ['palm', 'DsrrAYmucG'],
    ['bush', 'EoTERLq3z2'],
  ],
  street: [
    ['street-straight', 'UA4axT3nIQ'],
    ['street-light', '0lxF8Dl1jU'],
  ],
  // Carried loads for the crowd: head-loads (duck under) + ground luggage (jump).
  props: [
    ['boxes', 'bs6ikOeTrR'], // cardboard boxes — head load
    ['sack', 'LW3jwpPfiN'], // sack — head load
    ['crate', 'CnMGEDwg8s'], // crate — ground/jump obstacle
    ['bag', 'VRfAODZ0Xk'], // bag — ground/jump obstacle
  ],
};

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveGlbUrl(id) {
  const page = await fetch(`https://poly.pizza/m/${id}`, {
    headers: { 'User-Agent': 'CakeWalk-asset-fetch' },
  }).then((r) => r.text());
  const m = page.match(/https:\/\/static\.poly\.pizza\/[a-f0-9-]+\.glb/i);
  if (!m) throw new Error(`no GLB url on page for ${id}`);
  return m[0];
}

async function main() {
  const force = process.env.FORCE === '1';
  let ok = 0;
  let skip = 0;
  for (const [category, items] of Object.entries(MANIFEST)) {
    const dir = resolve(OUT, category);
    await mkdir(dir, { recursive: true });
    for (const [name, id] of items) {
      const dest = resolve(dir, `${name}.glb`);
      if (!force && (await exists(dest))) {
        skip++;
        continue;
      }
      const url = await resolveGlbUrl(id);
      const buf = Buffer.from(await fetch(url, { headers: { Referer: 'https://poly.pizza/' } }).then((r) => r.arrayBuffer()));
      if (buf.subarray(0, 4).toString() !== 'glTF') throw new Error(`bad GLB for ${name} (${id})`);
      await writeFile(dest, buf);
      ok++;
      console.log(`  ✓ ${category}/${name}.glb  (${(buf.length / 1024) | 0} KB)`);
    }
  }
  console.log(`\nDone: ${ok} downloaded, ${skip} already present.`);
}

main().catch((e) => {
  console.error('asset fetch failed:', e.message);
  process.exit(1);
});
