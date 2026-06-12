/**
 * Fetch raw OSM data per area from Overpass and cache to data/raw/.
 * Cached responses are committed so builds are reproducible without network.
 *
 * Usage: npm run osm:fetch [-- areaId ...]   (default: all areas)
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AREAS } from './areas';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const RAW_DIR = resolve(import.meta.dirname, '../../data/raw');

function buildQuery(bbox: [number, number, number, number]): string {
  const b = bbox.join(',');
  return `
[out:json][timeout:120][bbox:${b}];
(
  way[highway~"^(primary|secondary|trunk|tertiary|residential|living_street|unclassified|service|footway|path|pedestrian)$"];
  way[building];
  node[amenity~"^(marketplace|cafe|restaurant|fast_food|place_of_worship|bus_station|school|college|university|hospital|clinic|pharmacy|bank)$"];
  way[amenity~"^(hospital|school|college|university)$"];
  node[shop];
  node[highway=bus_stop];
  node[historic];
  way[historic];
  way[leisure~"^(park|garden)$"];
  way[natural=water];
  way[waterway=riverbank];
  node[natural=tree];
);
out body geom;
`;
}

async function fetchArea(id: string, bbox: [number, number, number, number]): Promise<void> {
  const out = resolve(RAW_DIR, `${id}.json`);
  if (existsSync(out) && !process.argv.includes('--force')) {
    console.log(`[skip] ${id} (cached; use --force to refetch)`);
    return;
  }
  console.log(`[fetch] ${id} ...`);
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: {
      'User-Agent': 'CakeWalk-OSM-Pipeline/1.0 (dev@agentsense.ai)',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'data=' + encodeURIComponent(buildQuery(bbox)),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} for ${id}: ${await res.text()}`);
  const json = (await res.json()) as { elements: unknown[] };
  writeFileSync(out, JSON.stringify(json));
  console.log(`[done] ${id}: ${json.elements.length} elements`);
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = requested.length ? AREAS.filter((a) => requested.includes(a.id)) : AREAS;

mkdirSync(RAW_DIR, { recursive: true });
for (const area of targets) {
  await fetchArea(area.id, area.bbox);
  // Be polite to the public Overpass instance.
  if (targets.length > 1) await new Promise((r) => setTimeout(r, 5000));
}
