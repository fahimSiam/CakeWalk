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
import { loadPropModel } from '@/gfx/models';
import { bendObject, type BendUniforms } from '@/gfx/worldBend';
import {
  FACADE_FOR_KIND,
  facadeTexture,
  makeSignboard,
  type FacadeStyle,
} from '@/gfx/facades';
import { MeshBasicMaterial } from 'three';

const BUILD_RADIUS = 130;

// Rev 7: 2D facade wall, one signature color per building TYPE so the street
// reads at a glance (hospital red, school blue, mosque green, …).
// Softer, cohesive cartoon palette (matches the muted Quaternius art) — still
// one signature hue per building TYPE but no neon.
const TYPE_COLOR: Record<string, Color> = {
  hospital: new Color('#e08071'),
  school: new Color('#6a93c7'),
  mosque: new Color('#5bb98e'),
  market: new Color('#e0a95e'),
  shop: new Color('#d9b566'),
  landmark: new Color('#9a86c2'),
  commercial: new Color('#6fb1bd'),
  residential: new Color('#d6a98f'),
};

// Facade texture style per enriched POI type (building kinds use FACADE_FOR_KIND).
const STYLE_FOR_TYPE: Record<string, FacadeStyle> = {
  hospital: 'commercial',
  school: 'commercial',
  shop: 'shutter',
  market: 'shutter',
  mosque: 'plain',
  landmark: 'plain',
};

/** Upright facade billboard facing +Z, bottom at y=0, UVs tiled by storey/bay. */
function facadeQuad(w: number, h: number): BufferGeometry {
  const g = new PlaneGeometry(w, h);
  g.translate(0, h / 2, 0);
  const u = w / BAY_M;
  const v = h / STOREY_M;
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  return g;
}

export interface PlacedProp {
  kind: BakedPoi['kind'];
  x: number;
  z: number;
  name?: string;
}

/** A seatable rest spot placed exactly where the player can reach it. */
export interface RestStall {
  kind: 'chaDokan' | 'busStop';
  x: number;
  z: number;
  /** Y rotation so the bench faces the street. */
  angle: number;
}

/** An intersection (road crossing or route junction) along the route — where
 *  the walkway breaks, a cross-road cuts across, and a warning sign stands. */
export interface IntersectionMark {
  s: number;
  kind: 'crossing' | 'turn';
  /** World centre + route tangent (dirX,dirZ) of the intersection. */
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

/** Half-length (m) of the gap the walkway opens for an intersection. */
const CHOURASTA_HALF = 5.0;

export class LevelRenderer {
  readonly group = new Group();
  readonly props: PlacedProp[] = [];
  readonly routeRef: Vec2[];

  constructor(
    scene: Scene,
    area: BakedArea,
    routePts: Vec2[],
    restStalls: RestStall[] = [],
    private bend?: BendUniforms,
    private intersections: IntersectionMark[] = [],
  ) {
    this.routeRef = routePts;
    const near = makeRouteDistance(routePts);

    this.addGround(routePts);
    this.addRoads(area, near);
    this.addRouteRibbon(routePts);
    this.addChourastas();
    this.addPolys(area.water, '#5fb0d8', 0.02);
    this.addPolys(area.parks, '#8fd06a', 0.01);
    this.addFacadeWall(area, routePts);
    this.addProps(area, near);
    this.addRestStalls(restStalls);
    scene.add(this.group);
  }

  dispose(scene: Scene): void {
    scene.remove(this.group);
    this.group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          // Material.dispose() does NOT free its textures — the signboards
          // (building names + junction warnings) each own a CanvasTexture map.
          (m as MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
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
    // Tessellated so the world-bend curves the ground in lock-step with the
    // finely-divided road/footpath — otherwise a 4-vertex plane stays flat and
    // the bent road appears to float above it.
    const ground = new Mesh(
      new PlaneGeometry(1400, 4000, 28, 240),
      new MeshLambertMaterial({ color: '#cdbc9c' }),
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
    // Footpath: 4 calm solid colour lanes running the whole length (simple long
    // blocks, not busy tiles), over a thin curb base.
    const base = ribbon(routePts, 8.0, 0.018, new Color('#6f6552'));
    if (base) this.group.add(new Mesh(base, new MeshLambertMaterial({ vertexColors: true })));
    this.addLaneFootpath(routePts);

    // The traffic road runs on the LEFT of the footpath: one simple, solid,
    // continuous asphalt strip (always rendered) with a dashed centre line.
    const roadCenter = offsetPolyline(routePts, -7.4);
    const road = ribbon(roadCenter, 8.0, 0.01, new Color('#41474d'));
    if (road) this.group.add(new Mesh(road, new MeshLambertMaterial({ vertexColors: true })));
    const dashGeo = new BoxGeometry(0.18, 0.02, 2.2);
    const dashes: { pos: Vec2; angle: number }[] = [];
    walkAlong(roadCenter, 6.5, 0, (pos, normal) => {
      // normal = (-dz, dx) → path direction = (normal[1], -normal[0]).
      dashes.push({ pos, angle: Math.atan2(normal[1], -normal[0]) });
    });
    if (dashes.length) {
      const mesh = new InstancedMesh(
        paintColored(dashGeo, new Color('#e8e3d8')),
        new MeshLambertMaterial({ vertexColors: true }),
        dashes.length,
      );
      const m = new Matrix4();
      const q = new Quaternion();
      dashes.forEach((d, i) => {
        q.setFromAxisAngle(new Vector3(0, 1, 0), d.angle);
        m.compose(new Vector3(d.pos[0], 0.04, d.pos[1]), q, new Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
      });
      this.group.add(mesh);
    }
  }

  /**
   * The footpath as 4 solid colour lanes running the full length of the route —
   * simple long blocks (one colour each), a calm "Crossy-Road lanes" look
   * rather than the previous busy candy checker.
   */
  private addLaneFootpath(routePts: Vec2[]): void {
    const LANES = ['#d9c79f', '#c2b083', '#cbbd96', '#a89a78'].map((c) => new Color(c));
    const WIDTH = 7.4;
    const COLS = LANES.length;
    const half = WIDTH / 2;
    const samples: { p: Vec2; n: Vec2 }[] = [];
    walkAlong(routePts, 3.0, 0, (pos, normal) => samples.push({ p: pos, n: normal }));
    if (samples.length < 2) return;

    const verts: number[] = [];
    const colors: number[] = [];
    const idx: number[] = [];
    let vi = 0;
    const pt = (s: { p: Vec2; n: Vec2 }, t: number): [number, number] => [
      s.p[0] + s.n[0] * t,
      s.p[1] + s.n[1] * t,
    ];
    for (let r = 0; r < samples.length - 1; r++) {
      const a = samples[r]!;
      const b = samples[r + 1]!;
      // Open a gap in the walkway where an intersection cuts across.
      const mx = (a.p[0] + b.p[0]) / 2;
      const mz = (a.p[1] + b.p[1]) / 2;
      if (this.intersections.some((m) => Math.hypot(m.x - mx, m.z - mz) < CHOURASTA_HALF)) continue;
      for (let c = 0; c < COLS; c++) {
        const t0 = -half + (c / COLS) * WIDTH;
        const t1 = -half + ((c + 1) / COLS) * WIDTH;
        const quad = [pt(a, t0), pt(a, t1), pt(b, t1), pt(b, t0)];
        const col = LANES[c]!; // colour by lane only → long solid stripes
        const baseI = vi;
        for (const [x, z] of quad) {
          verts.push(x, 0.03, z);
          colors.push(col.r, col.g, col.b);
          vi++;
        }
        idx.push(baseI, baseI + 1, baseI + 2, baseI, baseI + 2, baseI + 3);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.group.add(
      new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })),
    );
  }

  /**
   * Renders each intersection as a chourasta: a perpendicular asphalt cross-road
   * cutting through the (now broken) walkway, zebra stripes, and a warning
   * signboard a little before it so the player sees the junction coming.
   */
  private addChourastas(): void {
    const quad = (
      cx: number,
      cz: number,
      tx: number,
      tz: number,
      nx: number,
      nz: number,
      tHalf: number,
      n0: number,
      n1: number,
      y: number,
      color: Color,
      verts: number[],
      colors: number[],
      idx: number[],
    ): void => {
      const corners: [number, number][] = [
        [cx - tx * tHalf + nx * n0, cz - tz * tHalf + nz * n0],
        [cx + tx * tHalf + nx * n0, cz + tz * tHalf + nz * n0],
        [cx + tx * tHalf + nx * n1, cz + tz * tHalf + nz * n1],
        [cx - tx * tHalf + nx * n1, cz - tz * tHalf + nz * n1],
      ];
      const base = verts.length / 3;
      for (const [x, z] of corners) {
        verts.push(x, y, z);
        colors.push(color.r, color.g, color.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    const verts: number[] = [];
    const colors: number[] = [];
    const idx: number[] = [];
    const asphalt = new Color('#3f454b');
    const white = new Color('#e9e4d6');
    for (const m of this.intersections) {
      const tx = m.dirX;
      const tz = m.dirZ;
      const nx = -m.dirZ; // lateral (across the road)
      const nz = m.dirX;
      // Perpendicular road surface, from past the car road (left) to past the
      // walkway's right edge.
      quad(m.x, m.z, tx, tz, nx, nz, CHOURASTA_HALF, -34, 13, 0.038, asphalt, verts, colors, idx);
      // Zebra stripes across the walkway side so the crossing reads clearly.
      for (let k = 0; k < 7; k++) {
        const n = -10 + k * 3.0;
        quad(m.x, m.z, tx, tz, nx, nz, CHOURASTA_HALF * 0.82, n, n + 1.1, 0.044, white, verts, colors, idx);
      }
      this.addJunctionSign(m);
    }
    if (!idx.length) return;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.group.add(new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })));
  }

  /** A warning signboard on a post, standing on the right just before a
   *  junction and facing the approaching player. */
  private addJunctionSign(m: IntersectionMark): void {
    const label = m.kind === 'turn' ? 'JUNCTION ' : 'CROSSING ';
    const sign = makeSignboard(label, Math.round(Math.abs(m.s)), true);
    // Right edge of the walkway, ~9 m before the junction (on the player's side).
    const sx = m.x - m.dirX * 9 + -m.dirZ * 5.2;
    const sz = m.z - m.dirZ * 9 + m.dirX * 5.2;
    sign.position.set(sx, 2.5, sz);
    sign.rotation.y = Math.atan2(-m.dirX, -m.dirZ); // face the approaching player
    this.group.add(sign);
    const post = new Mesh(
      new CylinderGeometry(0.07, 0.07, 2.5, 6),
      new MeshLambertMaterial({ color: '#7a7064' }),
    );
    post.position.set(sx, 1.25, sz);
    this.group.add(post);
  }

  /**
   * Cha dokans & bus stops rendered exactly where the player can reach them
   * (RunState computes these from the seatable interaction points), so every
   * stall you see is one you can actually sit at.
   */
  private addRestStalls(stalls: RestStall[]): void {
    const cha = stalls.filter((s) => s.kind === 'chaDokan');
    const bus = stalls.filter((s) => s.kind === 'busStop');
    const place = (items: RestStall[], geo: BufferGeometry): void => {
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
        m.compose(new Vector3(it.x, 0, it.z), q, new Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
      });
      this.group.add(mesh);
    };
    place(cha, chaDokanGeometry());
    place(bus, busStopGeometry());
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

  /**
   * Buildings as a flat 2D facade wall pinned to the RIGHT edge of the
   * walkway (idea.md Rev 7). Real OSM buildings are projected onto the route,
   * laid out in along-route order, and drawn as upright textured billboards
   * colored by *type* (hospital red, school blue, mosque green, market
   * orange, shop yellow, landmark purple, commercial teal, residential pink),
   * each named one carrying an English signboard. No 3D massing = nothing can
   * occlude the player, and the type-colors read at a glance.
   */
  private addFacadeWall(area: BakedArea, routePts: Vec2[]): void {
    const cum: number[] = [0];
    for (let i = 1; i < routePts.length; i++) {
      cum[i] =
        cum[i - 1]! +
        Math.hypot(routePts[i]![0] - routePts[i - 1]![0], routePts[i]![1] - routePts[i - 1]![1]);
    }
    const project = (
      p: Vec2,
    ): { dist: number; s: number; baseX: number; baseZ: number; dx: number; dz: number } => {
      let best = { dist: Infinity, s: 0, baseX: 0, baseZ: 0, dx: 0, dz: 1 };
      for (let i = 1; i < routePts.length; i++) {
        const a = routePts[i - 1]!;
        const b = routePts[i]!;
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const l2 = ex * ex + ez * ez;
        if (l2 < 0.01) continue;
        let f = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2;
        f = Math.max(0, Math.min(1, f));
        const bx = a[0] + f * ex;
        const bz = a[1] + f * ez;
        const d = Math.hypot(bx - p[0], bz - p[1]);
        if (d < best.dist) {
          const l = Math.sqrt(l2);
          best = { dist: d, s: cum[i - 1]! + f * l, baseX: bx, baseZ: bz, dx: ex / l, dz: ez / l };
        }
      }
      return best;
    };

    const namedPois = area.pois.filter((p) => p.name && p.kind in TYPE_COLOR);

    interface Facade {
      s: number;
      x: number;
      z: number;
      angle: number;
      w: number;
      h: number;
      kind: string;
      name?: string;
    }
    const facades: Facade[] = [];
    for (const b of area.buildings) {
      const c = centroid(b.footprint);
      const pr = project(c);
      if (pr.dist > 80) continue;
      let minx = Infinity;
      let maxx = -Infinity;
      let minz = Infinity;
      let maxz = -Infinity;
      for (const v of b.footprint) {
        minx = Math.min(minx, v[0]);
        maxx = Math.max(maxx, v[0]);
        minz = Math.min(minz, v[1]);
        maxz = Math.max(maxz, v[1]);
      }
      const w = Math.max(4, Math.min(15, Math.max(maxx - minx, maxz - minz)));
      const h = Math.max(3.2, Math.min(9, b.height));
      let kind: string = b.kind;
      let name = b.name;
      // Adopt a nearby named POI's type/name (so hospitals/schools/shops show).
      let bestD = 17 * 17;
      for (const poi of namedPois) {
        const dd = (poi.pos[0] - c[0]) ** 2 + (poi.pos[1] - c[1]) ** 2;
        if (dd < bestD) {
          bestD = dd;
          kind = poi.kind;
          name = poi.name;
        }
      }
      const off = 7.2;
      const x = pr.baseX + -pr.dz * off; // right normal = (-dz, dx)
      const z = pr.baseZ + pr.dx * off;
      // On a sharp inside curve the right edge of one segment can fall onto the
      // route elsewhere and engulf the camera. If this facade lands within the
      // walkway of *any* part of the route, drop it (a gap beats an occlusion).
      if (project([x, z]).dist < 6) continue;
      const facade: Facade = { s: pr.s, x, z, angle: Math.atan2(pr.dz, -pr.dx), w, h, kind };
      if (name) facade.name = name;
      facades.push(facade);
    }
    facades.sort((a, b) => a.s - b.s);
    // Cap for perf, keeping an even spread along the route.
    const MAX = 170;
    const step = Math.max(1, Math.floor(facades.length / MAX));
    const chosen = facades.filter((_, i) => i % step === 0).slice(0, MAX);

    const byStyle = new Map<FacadeStyle, BufferGeometry[]>();
    let signs = 0;
    for (const f of chosen) {
      const style = STYLE_FOR_TYPE[f.kind] ?? FACADE_FOR_KIND[f.kind] ?? 'residential';
      const color = TYPE_COLOR[f.kind] ?? TYPE_COLOR.residential!;
      const geo = facadeQuad(f.w, f.h);
      geo.rotateY(f.angle);
      geo.translate(f.x, 0, f.z);
      paintGeometry(geo, color);
      let list = byStyle.get(style);
      if (!list) byStyle.set(style, (list = []));
      list.push(geo);
      // Name on a board standing at the footpath's right edge, IN FRONT of the
      // wall (not coplanar with it) and facing the oncoming player so it reads
      // clearly while walking. The straight corridor runs down -Z, so the
      // player approaches from +Z → the sign faces +Z (rotation.y = 0).
      if (f.name && signs < 44) {
        const big = f.h > 8 || f.kind === 'hospital' || f.kind === 'school' || f.kind === 'landmark';
        const sign = makeSignboard(f.name, signs, big);
        sign.position.set(4.0, big ? 2.0 : 1.5, f.z);
        this.group.add(sign);
        signs++;
      }
    }
    for (const [style, geos] of byStyle) {
      const merged = mergeGeometries(geos, false);
      // Unlit flat panels: bright type color × facade texture, cartoon-clean
      // and never shadowed dark regardless of which way the wall faces.
      this.group.add(
        new Mesh(
          merged,
          new MeshBasicMaterial({ map: facadeTexture(style), vertexColors: true, side: DoubleSide }),
        ),
      );
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

    const instanced = (positions: Vec2[], geo: BufferGeometry, ry = 0): InstancedMesh | null => {
      if (!positions.length) return null;
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
      return mesh;
    };

    // Cha dokans & bus stops are rendered by addRestStalls at reachable spots.
    // Roadside trees: real Quaternius tree GLBs (textured, multi-material), so
    // they're cloned at a capped set of nearest positions rather than instanced.
    this.addTreeClones(byKind.get('tree') ?? []);
    instanced(byKind.get('dustbin') ?? [], dustbinGeometry());
    this.addStreetClutter(this.routeRef);
  }

  /**
   * Place real Quaternius tree GLBs (textured, two materials so they can't be
   * merge-instanced) by cloning the model at a capped set of the positions
   * nearest the route — enough to line the street without a poly blow-up.
   */
  private addTreeClones(positions: Vec2[]): void {
    if (!positions.length) return;
    const CAP = 22;
    // Pick the positions closest to the route centre so the visible street is
    // populated; rendering every roadside POI would be hundreds of trees.
    const d = (p: Vec2): number => {
      let m = Infinity;
      for (const r of this.routeRef) m = Math.min(m, (r[0] - p[0]) ** 2 + (r[1] - p[1]) ** 2);
      return m;
    };
    const sorted = [...positions].sort((a, b) => d(a) - d(b));
    const chosen = sorted.slice(0, CAP);
    void loadPropModel('nature/tree-1').then((model) => {
      if (!model) return;
      for (const p of chosen) {
        const tree = model.spawn(5.0);
        tree.position.x = p[0];
        tree.position.z = p[1];
        tree.rotation.y = (p[0] * 7 + p[1] * 13) % 6;
        if (this.bend) bendObject(tree, this.bend);
        this.group.add(tree);
      }
    });
  }

  /**
   * Deterministic street clutter beside the walking line so Dhaka never
   * feels empty: parked rickshaws (~45 m) and utility poles (~28 m),
   * alternating sides, offset just past the corridor edge.
   */
  private addStreetClutter(route: Vec2[]): void {
    // Everything on the RIGHT (+normal): the left is the traffic road.
    const rickshaws: { pos: Vec2; angle: number }[] = [];
    const poles: { pos: Vec2; angle: number }[] = [];
    walkAlong(route, 45, 17, (pos, normal, k) => {
      rickshaws.push({
        pos: [pos[0] + normal[0] * 4.3, pos[1] + normal[1] * 4.3],
        angle: Math.atan2(normal[0], normal[1]) + (k % 2 === 0 ? 0.4 : -0.3),
      });
    });
    walkAlong(route, 28, 9, (pos, normal) => {
      poles.push({
        pos: [pos[0] + normal[0] * 3.9, pos[1] + normal[1] * 3.9],
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

/** Shift a polyline laterally by `off` meters (negative = left of travel). */
function offsetPolyline(pts: Vec2[], off: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    out.push([pts[i]![0] + -dz * off, pts[i]![1] + dx * off]);
  }
  return out;
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
