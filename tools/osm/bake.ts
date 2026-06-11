/**
 * Bake raw Overpass JSON into the runtime level format.
 *
 *   raw OSM → project to local meters → classify+simplify roads →
 *   intersection graph with per-edge gameplay stats → buildings → POIs
 *   (+ synthesized cha dokans/dustbins/trees where OSM is sparse) →
 *   public/levels/<area>.json
 *
 * Deterministic: synthesis uses a hash of way ids, no Math.random.
 * Usage: npm run osm:bake [-- areaId ...]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AREAS, type AreaDef } from './areas';
import { makeProjector, polylineLength, pointToPolyline, ringArea, simplify, dist } from './geometry';
import type {
  BakedArea,
  BakedBuilding,
  BakedPoi,
  BakedRoad,
  GraphEdge,
  GraphNode,
  RoadClass,
  Vec2,
} from '../../src/world/levelTypes';
import { OSM_ATTRIBUTION } from '../../src/world/levelTypes';

interface OsmElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

const RAW_DIR = resolve(import.meta.dirname, '../../data/raw');
const OUT_DIR = resolve(import.meta.dirname, '../../public/levels');

const MAJOR = new Set(['trunk', 'primary', 'secondary']);
const MINOR = new Set(['tertiary', 'residential', 'living_street', 'unclassified', 'service']);
const FOOT = new Set(['footway', 'path', 'pedestrian']);
const ROAD_WIDTH: Record<string, number> = {
  trunk: 18,
  primary: 16,
  secondary: 12,
  tertiary: 9,
  residential: 6,
  living_street: 5,
  unclassified: 5.5,
  service: 4.5,
  footway: 2.5,
  path: 2,
  pedestrian: 4,
};

const round1 = (v: number): number => Math.round(v * 10) / 10;
const rv = (p: Vec2): Vec2 => [round1(p[0]), round1(p[1])];

function classify(hw: string): RoadClass | null {
  if (MAJOR.has(hw)) return 'major';
  if (MINOR.has(hw)) return 'minor';
  if (FOOT.has(hw)) return 'footway';
  return null;
}

function bakeArea(area: AreaDef): void {
  const raw = JSON.parse(readFileSync(resolve(RAW_DIR, `${area.id}.json`), 'utf8')) as {
    elements: OsmElement[];
  };
  const [s, w, n, e] = area.bbox;
  const lat0 = (s + n) / 2;
  const lon0 = (w + e) / 2;
  const proj = makeProjector(lat0, lon0);
  const min = proj(n, w);
  const max = proj(s, e);
  const bbox: [number, number, number, number] = [min[0], min[1], max[0], max[1]];

  // ---- Roads (+ node-id usage for the graph) ----
  const roads: BakedRoad[] = [];
  const roadWays: { el: OsmElement; cls: RoadClass; pts: Vec2[] }[] = [];
  const nodeUse = new Map<number, number>();
  for (const el of raw.elements) {
    if (el.type !== 'way' || !el.tags?.highway || !el.geometry || !el.nodes) continue;
    const cls = classify(el.tags.highway);
    if (!cls) continue;
    const pts = el.geometry.map((g) => proj(g.lat, g.lon));
    roadWays.push({ el, cls, pts });
    for (const nid of el.nodes) nodeUse.set(nid, (nodeUse.get(nid) ?? 0) + 1);
    roads.push({
      id: el.id,
      class: cls,
      width: ROAD_WIDTH[el.tags.highway] ?? 6,
      pts: simplify(pts, 1.5).map(rv),
      ...(el.tags.name ? { name: el.tags.name } : {}),
    });
  }

  // ---- POIs ----
  const pois: BakedPoi[] = [];
  const addPoi = (kind: BakedPoi['kind'], pos: Vec2, name?: string, nameBn?: string): void => {
    if (pos[0] < bbox[0] || pos[0] > bbox[2] || pos[1] < bbox[1] || pos[1] > bbox[3]) return;
    pois.push({ kind, pos: rv(pos), ...(name ? { name } : {}), ...(nameBn ? { nameBn } : {}) });
  };
  for (const el of raw.elements) {
    const t = el.tags;
    if (!t) continue;
    const pos: Vec2 | null =
      el.type === 'node' && el.lat !== undefined
        ? proj(el.lat, el.lon!)
        : el.geometry
          ? centroid(el.geometry.map((g) => proj(g.lat, g.lon)))
          : null;
    if (!pos) continue;
    const name = t.name ?? t['name:en'];
    const nameBn = t['name:bn'];
    if (t.amenity === 'cafe' || t.shop === 'tea' || t.amenity === 'fast_food') {
      addPoi('chaDokan', pos, name, nameBn);
    } else if (t.amenity === 'place_of_worship') {
      addPoi('mosque', pos, name, nameBn);
    } else if (t.amenity === 'marketplace' || t.shop === 'mall' || t.amenity === 'bus_station') {
      addPoi('market', pos, name, nameBn);
    } else if (t.highway === 'bus_stop') {
      addPoi('busStop', pos, name, nameBn);
    } else if (t.amenity === 'school' || t.amenity === 'college' || t.amenity === 'university') {
      addPoi('school', pos, name, nameBn);
    } else if (t.historic || (t.tourism === 'attraction' && name)) {
      addPoi('landmark', pos, name, nameBn);
    } else if (t.natural === 'tree') {
      addPoi('tree', pos);
    }
  }

  // ---- Buildings ----
  const buildings: BakedBuilding[] = [];
  for (const el of raw.elements) {
    if (el.type !== 'way' || !el.tags?.building || !el.geometry) continue;
    let fp = el.geometry.map((g) => proj(g.lat, g.lon));
    if (fp.length > 3 && dist(fp[0]!, fp[fp.length - 1]!) < 0.5) fp = fp.slice(0, -1);
    fp = simplify(fp, 1.0);
    if (fp.length < 3) continue;
    const area2 = Math.abs(ringArea(fp));
    if (area2 < 25) continue; // skip sheds
    const c = centroid(fp);
    if (c[0] < bbox[0] || c[0] > bbox[2] || c[1] < bbox[1] || c[1] > bbox[3]) continue;
    const t = el.tags;
    const levels = parseInt(t['building:levels'] ?? '', 10);
    const height = Number.isFinite(levels)
      ? Math.min(levels, 14) * 3
      : 6 + (hash(el.id) % 4) * 3; // 2-5 storeys, deterministic
    const kind: BakedBuilding['kind'] =
      t.amenity === 'place_of_worship' || t.building === 'mosque'
        ? 'mosque'
        : t.shop || t.building === 'commercial' || t.building === 'retail'
          ? 'commercial'
          : t.historic || (t.name && area2 > 800)
            ? 'landmark'
            : t.amenity === 'marketplace'
              ? 'market'
              : 'residential';
    buildings.push({
      footprint: fp.map(rv),
      height: round1(height),
      kind,
      ...(t.name ? { name: t.name } : {}),
    });
  }

  // ---- Water & parks ----
  const water: Vec2[][] = [];
  const parks: Vec2[][] = [];
  for (const el of raw.elements) {
    if (el.type !== 'way' || !el.geometry || !el.tags) continue;
    const poly = simplify(
      el.geometry.map((g) => proj(g.lat, g.lon)),
      2,
    ).map(rv);
    if (poly.length < 3) continue;
    if (el.tags.natural === 'water' || el.tags.waterway === 'riverbank') water.push(poly);
    else if (el.tags.leisure === 'park' || el.tags.leisure === 'garden') parks.push(poly);
  }

  // ---- Graph: intersections where road ways share node ids ----
  const nodeIndex = new Map<number, number>(); // osm node id -> GraphNode idx
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const majorNodeIds = new Set<number>();
  for (const rw of roadWays) {
    if (rw.cls === 'major') for (const nid of rw.el.nodes!) majorNodeIds.add(nid);
  }
  const isIntersection = (nid: number, idx: number, count: number): boolean =>
    idx === 0 || idx === count - 1 || (nodeUse.get(nid) ?? 0) >= 2;

  for (const rw of roadWays) {
    if (rw.cls === 'footway' && polylineLength(rw.pts) < 20) continue;
    const ids = rw.el.nodes!;
    let segStart = 0;
    for (let i = 1; i < ids.length; i++) {
      if (!isIntersection(ids[i]!, i, ids.length)) continue;
      const pts = rw.pts.slice(segStart, i + 1);
      const lengthM = polylineLength(pts);
      if (lengthM >= 8) {
        const aIdx = ensureNode(ids[segStart]!, pts[0]!);
        const bIdx = ensureNode(ids[i]!, pts[pts.length - 1]!);
        if (aIdx !== bIdx) {
          edges.push({
            a: aIdx,
            b: bIdx,
            roadId: rw.el.id,
            pts: simplify(pts, 1.5).map(rv),
            stats: { lengthM: round1(lengthM), crowd: 0, traffic: 0, chaDokan: 0, pickpocket: 0 },
          });
        }
      }
      segStart = i;
    }
  }
  function ensureNode(nid: number, pos: Vec2): number {
    let idx = nodeIndex.get(nid);
    if (idx === undefined) {
      idx = nodes.length;
      nodeIndex.set(nid, idx);
      nodes.push({ id: nid, pos: rv(pos), majorCrossing: false });
    }
    return idx;
  }
  // Mark crossings: a node shared by a major way and any other way.
  for (const node of nodes) {
    if (majorNodeIds.has(node.id) && (nodeUse.get(node.id) ?? 0) >= 2) node.majorCrossing = true;
  }

  // ---- Edge gameplay stats from location types (idea.md §3.2) ----
  const chaPois = pois.filter((p) => p.kind === 'chaDokan');
  const riskPois = pois.filter((p) => p.kind === 'market' || p.kind === 'busStop');
  const shopDensityPois = pois.filter((p) => p.kind === 'chaDokan' || p.kind === 'market');
  const roadClass = new Map(roadWays.map((rw) => [rw.el.id, rw.cls]));
  const hwName = new Map(roadWays.map((rw) => [rw.el.id, rw.el.tags!.highway!]));
  for (const edge of edges) {
    const cls = roadClass.get(edge.roadId)!;
    const hw = hwName.get(edge.roadId)!;
    edge.stats.traffic =
      cls === 'major'
        ? hw === 'trunk' || hw === 'primary'
          ? 5
          : 4
        : hw === 'tertiary'
          ? 3
          : cls === 'footway'
            ? 1
            : 2;
    const nearShops = countNear(shopDensityPois, edge.pts, 60);
    edge.stats.crowd = clamp1to5(
      Math.round((cls === 'major' ? 3 : cls === 'minor' ? 2 : 1.5) + nearShops * 0.4) *
        area.tuning.crowd,
    );
    edge.stats.traffic = clamp1to5(edge.stats.traffic * area.tuning.traffic);
    edge.stats.chaDokan = countNear(chaPois, edge.pts, 45);
    edge.stats.pickpocket = clamp1to5(
      (1 + countNear(riskPois, edge.pts, 110) * 1.5) * area.tuning.pickpocket,
    );
  }

  // ---- Synthesized props where OSM is sparse (deterministic) ----
  synthesizeAlongRoads(roads, chaPois, pois, 'chaDokan', 160, 120);
  synthesizeAlongRoads(roads, pois.filter((p) => p.kind === 'dustbin'), pois, 'dustbin', 95, 60);
  synthesizeAlongRoads(roads, pois.filter((p) => p.kind === 'tree'), pois, 'tree', 70, 35);

  const baked: BakedArea = {
    id: area.id,
    nameEn: area.nameEn,
    nameBn: area.nameBn,
    origin: { lat: lat0, lon: lon0 },
    bbox,
    roads,
    buildings,
    pois,
    water,
    parks,
    graph: { nodes, edges },
    attribution: OSM_ATTRIBUTION,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(baked);
  writeFileSync(resolve(OUT_DIR, `${area.id}.json`), json);
  console.log(
    `[bake] ${area.id}: ${roads.length} roads, ${buildings.length} buildings, ${pois.length} pois, ` +
      `graph ${nodes.length}n/${edges.length}e, ${(json.length / 1024).toFixed(0)} KB`,
  );
}

/** Drop synthetic POIs every `spacing` m along minor roads when no real one is within `clearance`. */
function synthesizeAlongRoads(
  roads: BakedRoad[],
  existing: BakedPoi[],
  pois: BakedPoi[],
  kind: BakedPoi['kind'],
  spacing: number,
  clearance: number,
): void {
  for (const road of roads) {
    if (road.class !== 'minor') continue;
    const len = polylineLength(road.pts);
    // Deterministic phase per road so placements don't align across roads.
    for (let d = (hash(road.id) % spacing) + 20; d < len - 10; d += spacing) {
      const [pos, normal] = pointAlong(road.pts, d);
      const side = hash(road.id + d) % 2 === 0 ? 1 : -1;
      const off: Vec2 = [
        pos[0] + normal[0] * (road.width / 2 + 1.2) * side,
        pos[1] + normal[1] * (road.width / 2 + 1.2) * side,
      ];
      if (existing.some((p) => dist(p.pos, off) < clearance)) continue;
      pois.push({ kind, pos: rv(off) });
      existing.push(pois[pois.length - 1]!);
    }
  }
}

function pointAlong(pts: Vec2[], d: number): [Vec2, Vec2] {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1]!, pts[i]!);
    if (acc + seg >= d && seg > 0) {
      const dx = (pts[i]![0] - pts[i - 1]![0]) / seg;
      const dz = (pts[i]![1] - pts[i - 1]![1]) / seg;
      return [
        [pts[i - 1]![0] + dx * (d - acc), pts[i - 1]![1] + dz * (d - acc)],
        [-dz, dx],
      ];
    }
    acc += seg;
  }
  return [pts[pts.length - 1]!, [0, 1]];
}

function countNear(pois: { pos: Vec2 }[], pts: Vec2[], radius: number): number {
  let count = 0;
  for (const p of pois) if (pointToPolyline(p.pos, pts) < radius) count++;
  return count;
}

function centroid(pts: Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

function clamp1to5(v: number): number {
  return Math.max(1, Math.min(5, Math.round(v)));
}

function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = requested.length ? AREAS.filter((a) => requested.includes(a.id)) : AREAS;
for (const area of targets) bakeArea(area);
