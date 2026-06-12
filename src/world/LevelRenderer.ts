/**
 * Builds the visible world for a run from baked OSM data: real road ribbons,
 * extruded real building footprints, water/parks, and street props placed at
 * real POI positions. Only geometry within reach of the chosen route is
 * built (the rest of the area never costs a triangle).
 *
 * In Dhaka fashion, the player walks ON the street — the corridor follows
 * the road centerline and a lighter "walking ribbon" marks the route.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Shape,
  ShapeGeometry,
  Vector3,
  BoxGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BakedArea, BakedPoi, Vec2 } from './levelTypes';
import { buildRickshawGeometry, paintColored } from '@/gfx/meshFactory';
import {
  FACADE_FOR_KIND,
  ROOF_TINT,
  facadeMaterial,
  makeSignboard,
  type FacadeStyle,
} from '@/gfx/facades';

const BUILD_RADIUS = 130;

// Brighter than before: these now MULTIPLY the facade texture.
const KIND_COLORS: Record<string, Color> = {
  residential: new Color('#d9c9ae'),
  commercial: new Color('#b9c4d6'),
  mosque: new Color('#abdcc0'),
  market: new Color('#e0b48e'),
  landmark: new Color('#ecdcb8'),
};

export interface PlacedProp {
  kind: BakedPoi['kind'];
  x: number;
  z: number;
  name?: string;
}

export class LevelRenderer {
  readonly group = new Group();
  readonly props: PlacedProp[] = [];
  readonly routeRef: Vec2[];

  constructor(scene: Scene, area: BakedArea, routePts: Vec2[]) {
    this.routeRef = routePts;
    const near = makeRouteDistance(routePts);

    this.addGround(routePts);
    this.addRoads(area, near);
    this.addRouteRibbon(routePts);
    this.addPolys(area.water, '#5b8aa6', 0.02);
    this.addPolys(area.parks, '#7d9e6a', 0.01);
    this.addBuildings(area, near);
    this.addProps(area, near);
    this.addSignboards(area, routePts);
    scene.add(this.group);
  }

  dispose(scene: Scene): void {
    scene.remove(this.group);
    this.group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      }
    });
  }

  private addGround(routePts: Vec2[]): void {
    // One big neutral plane centered on the route.
    let cx = 0;
    let cz = 0;
    for (const p of routePts) {
      cx += p[0];
      cz += p[1];
    }
    cx /= routePts.length;
    cz /= routePts.length;
    const ground = new Mesh(
      new PlaneGeometry(3000, 3000),
      new MeshLambertMaterial({ color: '#a39377' }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.05, cz);
    this.group.add(ground);
  }

  private addRoads(area: BakedArea, near: (p: Vec2) => boolean): void {
    const geos: BufferGeometry[] = [];
    for (const road of area.roads) {
      if (!road.pts.some(near)) continue;
      const color =
        road.class === 'major' ? '#4d4a45' : road.class === 'minor' ? '#5d5952' : '#8a8274';
      const g = ribbon(road.pts, road.width, 0.0, new Color(color));
      if (g) geos.push(g);
    }
    if (geos.length) {
      this.group.add(
        new Mesh(
          mergeGeometries(geos, false),
          new MeshLambertMaterial({ vertexColors: true }),
        ),
      );
    }
  }

  private addRouteRibbon(routePts: Vec2[]): void {
    const g = ribbon(routePts, 7.6, 0.03, new Color('#9b9484'));
    if (g) this.group.add(new Mesh(g, new MeshLambertMaterial({ vertexColors: true })));
  }

  private addPolys(polys: Vec2[][], color: string, y: number): void {
    const geos: BufferGeometry[] = [];
    for (const poly of polys) {
      if (poly.length < 3) continue;
      const shape = new Shape();
      shape.moveTo(poly[0]![0], -poly[0]![1]);
      for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i]![0], -poly[i]![1]);
      const geo = new ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, y, 0);
      geos.push(geo);
    }
    if (geos.length) {
      this.group.add(
        new Mesh(
          mergeGeometries(geos, false),
          new MeshLambertMaterial({ color, side: DoubleSide }),
        ),
      );
    }
  }

  private addBuildings(area: BakedArea, near: (p: Vec2) => boolean): void {
    // Walls grouped by facade style (textured), roofs merged separately
    // (a tiling window texture on a roof would look broken).
    const wallsByStyle = new Map<FacadeStyle, BufferGeometry[]>();
    const roofGeos: BufferGeometry[] = [];
    for (const b of area.buildings) {
      const c = centroid(b.footprint);
      if (!near(c)) continue;
      const { walls, roof } = extrudeFootprint(b.footprint, b.height);
      paintGeometry(walls, KIND_COLORS[b.kind] ?? KIND_COLORS.residential!);
      paintGeometry(roof, ROOF_TINT);
      const style = FACADE_FOR_KIND[b.kind] ?? 'residential';
      let list = wallsByStyle.get(style);
      if (!list) wallsByStyle.set(style, (list = []));
      list.push(walls);
      roofGeos.push(roof);
    }
    for (const [style, geos] of wallsByStyle) {
      const merged = mergeGeometries(geos, false);
      merged.computeVertexNormals();
      this.group.add(new Mesh(merged, facadeMaterial(style)));
    }
    if (roofGeos.length) {
      const merged = mergeGeometries(roofGeos, false);
      merged.computeVertexNormals();
      this.group.add(
        new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })),
      );
    }
  }

  /** Real OSM shop/POI names on signboards beside the route (Dhaka's wall of signage). */
  private addSignboards(area: BakedArea, routePts: Vec2[]): void {
    const named = area.pois.filter(
      (p) =>
        p.name &&
        (p.kind === 'shop' || p.kind === 'market' || p.kind === 'chaDokan' || p.kind === 'school' || p.kind === 'mosque'),
    );
    let count = 0;
    for (const poi of named) {
      if (count >= 36) break;
      const { dist, dirX, dirZ } = nearestOnRoute(poi.pos, routePts);
      if (dist > 16) continue;
      const sign = makeSignboard(poi.name!, count);
      sign.position.set(poi.pos[0], 2.7 + (count % 3) * 0.35, poi.pos[1]);
      // Face along the street so it reads while walking past.
      sign.rotation.y = Math.atan2(dirX, dirZ) + Math.PI / 2;
      this.group.add(sign);
      count++;
    }
  }

  private addProps(area: BakedArea, near: (p: Vec2) => boolean): void {
    const byKind = new Map<string, Vec2[]>();
    for (const poi of area.pois) {
      if (!near(poi.pos)) continue;
      // Only props close to the walking line matter (PROP_RADIUS pass below).
      let list = byKind.get(poi.kind);
      if (!list) byKind.set(poi.kind, (list = []));
      list.push(poi.pos);
      if (
        poi.kind === 'chaDokan' ||
        poi.kind === 'busStop' ||
        poi.kind === 'tree' ||
        poi.kind === 'dustbin'
      ) {
        this.props.push({ kind: poi.kind, x: poi.pos[0], z: poi.pos[1], ...(poi.name ? { name: poi.name } : {}) });
      }
    }

    const instanced = (positions: Vec2[], geo: BufferGeometry, ry = 0): void => {
      if (!positions.length) return;
      const mesh = new InstancedMesh(
        geo,
        new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
        positions.length,
      );
      const m = new Matrix4();
      const q = new Quaternion();
      positions.forEach((p, i) => {
        q.setFromAxisAngle(new Vector3(0, 1, 0), ry + ((p[0] * 7 + p[1] * 13) % 6));
        m.compose(new Vector3(p[0], 0, p[1]), q, new Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
      });
      this.group.add(mesh);
    };

    instanced(byKind.get('tree') ?? [], treeGeometry());
    instanced(byKind.get('dustbin') ?? [], dustbinGeometry());
    instanced(byKind.get('chaDokan') ?? [], chaDokanGeometry());
    instanced(byKind.get('busStop') ?? [], busStopGeometry());
    this.addStreetClutter(this.routeRef);
  }

  /**
   * Deterministic street clutter beside the walking line so Dhaka never
   * feels empty: parked rickshaws (~45 m) and utility poles (~28 m),
   * alternating sides, offset just past the corridor edge.
   */
  private addStreetClutter(route: Vec2[]): void {
    const rickshaws: { pos: Vec2; angle: number }[] = [];
    const poles: { pos: Vec2; angle: number }[] = [];
    walkAlong(route, 45, 17, (pos, normal, k) => {
      const side = k % 2 === 0 ? 1 : -1;
      rickshaws.push({
        pos: [pos[0] + normal[0] * 4.3 * side, pos[1] + normal[1] * 4.3 * side],
        angle: Math.atan2(normal[0], normal[1]) + (side > 0 ? 0.4 : -0.4),
      });
    });
    walkAlong(route, 28, 9, (pos, normal, k) => {
      const side = k % 2 === 0 ? -1 : 1;
      poles.push({
        pos: [pos[0] + normal[0] * 3.6 * side, pos[1] + normal[1] * 3.6 * side],
        angle: 0,
      });
    });

    const place = (items: { pos: Vec2; angle: number }[], geo: BufferGeometry): void => {
      if (!items.length) return;
      const mesh = new InstancedMesh(
        geo,
        new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
        items.length,
      );
      const m = new Matrix4();
      const q = new Quaternion();
      items.forEach((it, i) => {
        q.setFromAxisAngle(new Vector3(0, 1, 0), it.angle);
        m.compose(new Vector3(it.pos[0], 0, it.pos[1]), q, new Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
      });
      this.group.add(mesh);
    };
    place(rickshaws, buildRickshawGeometry());
    place(poles, utilityPoleGeometry());
  }
}

/** Walk a polyline emitting a point+normal every `spacing` meters. */
function walkAlong(
  pts: Vec2[],
  spacing: number,
  phase: number,
  emit: (pos: Vec2, normal: Vec2, index: number) => void,
): void {
  let acc = -phase;
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < 0.01) continue;
    const dx = (b[0] - a[0]) / segLen;
    const dz = (b[1] - a[1]) / segLen;
    let d = spacing - ((acc % spacing) + spacing) % spacing;
    while (d <= segLen) {
      emit([a[0] + dx * d, a[1] + dz * d], [-dz, dx], k++);
      d += spacing;
    }
    acc += segLen;
  }
}

// ---------- geometry helpers ----------

function makeRouteDistance(routePts: Vec2[]): (p: Vec2) => boolean {
  // Coarse spatial grid over route points for O(1) proximity checks.
  const cell = BUILD_RADIUS;
  const grid = new Set<string>();
  for (const p of routePts) {
    const gx = Math.floor(p[0] / cell);
    const gz = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) grid.add(`${gx + dx},${gz + dz}`);
    }
  }
  return (p: Vec2) => grid.has(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`);
}

function ribbon(pts: Vec2[], width: number, y: number, color: Color): BufferGeometry | null {
  const filtered = pts.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) > 0.05,
  );
  if (filtered.length < 2) return null;
  const half = width / 2;
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const prev = filtered[Math.max(0, i - 1)]!;
    const next = filtered[Math.min(filtered.length - 1, i + 1)]!;
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const p = filtered[i]!;
    verts.push(p[0] - -dz * half, y, p[1] - dx * half, p[0] + -dz * half, y, p[1] + dx * half);
    if (i > 0) {
      const base = (i - 1) * 2;
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  paintGeometry(geo, color);
  return geo;
}

const STOREY_M = 3.0; // texture tile = one storey
const BAY_M = 9.6; // tile width = 3 bays ≈ 3.2 m each

function extrudeFootprint(fp: Vec2[], height: number): { walls: BufferGeometry; roof: BufferGeometry } {
  // Walls with facade UVs: u tiles along each wall's length, v by storey.
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i]!;
    const b = fp[(i + 1) % fp.length]!;
    const base = verts.length / 3;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = len / BAY_M;
    const v = height / STOREY_M;
    verts.push(a[0], 0, a[1], b[0], 0, b[1], b[0], height, b[1], a[0], height, a[1]);
    uvs.push(0, 0, u, 0, u, v, 0, v);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const walls = new BufferGeometry();
  walls.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  walls.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  walls.setIndex(idx);

  // Roof via earcut (Shape uses XY; map z → -y then rotate).
  const shape = new Shape();
  shape.moveTo(fp[0]![0], -fp[0]![1]);
  for (let i = 1; i < fp.length; i++) shape.lineTo(fp[i]![0], -fp[i]![1]);
  const roof = new ShapeGeometry(shape);
  roof.rotateX(-Math.PI / 2);
  roof.translate(0, height, 0);
  // Attribute sets must match exactly within each merge group.
  roof.deleteAttribute('uv');
  roof.deleteAttribute('normal');

  return { walls: walls.toNonIndexed(), roof: roof.toNonIndexed() };
}

/** Distance + local direction of the closest route segment to a point. */
function nearestOnRoute(p: Vec2, pts: Vec2[]): { dist: number; dirX: number; dirZ: number } {
  let best = { dist: Infinity, dirX: 0, dirZ: 1 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 0.01) continue;
    let f = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lenSq;
    f = Math.max(0, Math.min(1, f));
    const px = a[0] + f * dx - p[0];
    const pz = a[1] + f * dz - p[1];
    const d = Math.hypot(px, pz);
    if (d < best.dist) {
      const len = Math.sqrt(lenSq);
      best = { dist: d, dirX: dx / len, dirZ: dz / len };
    }
  }
  return best;
}

function paintGeometry(geo: BufferGeometry, color: Color): void {
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
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

function treeGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.12, 0.18, 1.6, 5);
  trunk.translate(0, 0.8, 0);
  const trunkG = paintColored(trunk, new Color('#6e4f2f'));
  const crown = new CylinderGeometry(0.1, 1.5, 2.6, 6);
  crown.translate(0, 3.0, 0);
  const crownG = paintColored(crown, new Color('#5f8f4a'));
  return mergeGeometries([trunkG, crownG], false);
}

function dustbinGeometry(): BufferGeometry {
  const bin = new BoxGeometry(0.7, 0.9, 0.7);
  bin.translate(0, 0.45, 0);
  return paintColored(bin, new Color('#3f6f56'));
}

function chaDokanGeometry(): BufferGeometry {
  const stall = new BoxGeometry(2.2, 1.9, 1.4);
  stall.translate(0, 0.95, 0);
  const stallG = paintColored(stall, new Color('#8a6a3a'));
  const awning = new BoxGeometry(2.8, 0.1, 2.0);
  awning.translate(0, 2.0, 0.3);
  const awningG = paintColored(awning, new Color('#b8473d'));
  const bench = new BoxGeometry(2.0, 0.35, 0.45);
  bench.translate(0, 0.18, 1.35);
  const benchG = paintColored(bench, new Color('#7a5c3a'));
  return mergeGeometries([stallG, awningG, benchG], false);
}


function utilityPoleGeometry(): BufferGeometry {
  const pole = new CylinderGeometry(0.09, 0.12, 6.5, 5);
  pole.translate(0, 3.25, 0);
  const crossarm = new BoxGeometry(1.6, 0.08, 0.08);
  crossarm.translate(0, 5.9, 0);
  const crossarm2 = new BoxGeometry(1.2, 0.08, 0.08);
  crossarm2.translate(0, 5.4, 0);
  return mergeGeometries(
    [
      paintColored(pole, new Color('#6e655a')),
      paintColored(crossarm, new Color('#4a443c')),
      paintColored(crossarm2, new Color('#4a443c')),
    ],
    false,
  );
}

function busStopGeometry(): BufferGeometry {
  const pole = new BoxGeometry(0.12, 2.6, 0.12);
  pole.translate(-1.2, 1.3, 0);
  const poleG = paintColored(pole, new Color('#666c74'));
  const pole2 = new BoxGeometry(0.12, 2.6, 0.12);
  pole2.translate(1.2, 1.3, 0);
  const pole2G = paintColored(pole2, new Color('#666c74'));
  const roof = new BoxGeometry(3.0, 0.12, 1.4);
  roof.translate(0, 2.6, 0);
  const roofG = paintColored(roof, new Color('#9e3d3d'));
  const bench = new BoxGeometry(2.6, 0.35, 0.5);
  bench.translate(0, 0.45, 0.2);
  const benchG = paintColored(bench, new Color('#7a6f5a'));
  return mergeGeometries([poleG, pole2G, roofG, benchG], false);
}
