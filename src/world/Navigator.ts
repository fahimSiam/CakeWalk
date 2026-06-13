/**
 * Turn-by-turn navigation over the OSM graph (idea.md Rev 8).
 *
 * The player walks the straight corridor; at each real junction the run pops a
 * quick "which way?" minigame. This class finds those junctions along the
 * chosen route, classifies every branch as left / straight / right, tags each
 * with a nearby landmark name (navigate by the buildings you memorised), and
 * re-plans the route to the destination when the player picks a different road.
 */
import type { BakedArea, Vec2 } from './levelTypes';
import type { SplineCorridor } from './SplineCorridor';
import type { RouteGraph, RouteOption } from '@/routing/RouteGraph';

export type TurnDir = 'left' | 'straight' | 'right';

export interface TurnBranch {
  edge: number;
  toNode: number;
  dir: TurnDir;
  /** Signed turn angle in radians (for ordering / debugging). */
  angle: number;
  /** True if this branch keeps you on the currently-planned route. */
  marked: boolean;
  /** A real building/POI name a little way down this road, or undefined. */
  landmark?: string;
}

export interface DecisionPoint {
  /** Along-route distance (matches the straight corridor's s). */
  s: number;
  node: number;
  branches: TurnBranch[];
  markedEdge: number;
  /** Set once the player has answered this junction. */
  consumed: boolean;
}

const STRAIGHT_CONE = (25 * Math.PI) / 180; // within ±25° of ahead = "straight"

export class Navigator {
  readonly decisionPoints: DecisionPoint[] = [];
  private dest: number;

  constructor(
    private area: BakedArea,
    private graph: RouteGraph,
    route: RouteOption,
    projector: SplineCorridor,
    length: number,
  ) {
    const { nodes, edges } = area.graph;
    this.dest = route.nodePath[route.nodePath.length - 1]!;

    for (let i = 1; i < route.nodePath.length - 1; i++) {
      const node = route.nodePath[i]!;
      const arrivalEdge = route.edgePath[i - 1]!;
      const markedEdge = route.edgePath[i]!;
      const others = this.graph.neighbors(node).filter((n) => n.edge !== arrivalEdge);
      if (others.length < 2) continue; // a bend, not a junction — no real choice

      const s = projector.closestS(nodes[node]!.pos[0], nodes[node]!.pos[1]);
      if (s < 20 || s > length - 20) continue;

      // Player's heading arriving into the node = opposite of the arrival
      // edge's direction leaving the node.
      const leave = edgeDirAtNode(edges[arrivalEdge]!.pts, edges[arrivalEdge]!.a === node);
      const heading: Vec2 = [-leave[0], -leave[1]];

      const branches: TurnBranch[] = others.map((o) => {
        const e = edges[o.edge]!;
        const out = edgeDirAtNode(e.pts, e.a === node);
        const angle = signedAngle(heading, out);
        const dir: TurnDir =
          Math.abs(angle) < STRAIGHT_CONE ? 'straight' : angle > 0 ? 'left' : 'right';
        const branch: TurnBranch = { edge: o.edge, toNode: o.to, dir, angle, marked: o.edge === markedEdge };
        const landmark = this.landmarkAlong(e.pts, e.a === node);
        if (landmark) branch.landmark = landmark;
        return branch;
      });
      // Order them left → straight → right for a natural button layout.
      branches.sort((a, b) => b.angle - a.angle);

      this.decisionPoints.push({ s, node, branches, markedEdge, consumed: false });
    }
    this.decisionPoints.sort((a, b) => a.s - b.s);
    // Merge junctions closer than 22 m so popups don't chain.
    let prevS = -Infinity;
    const filtered = this.decisionPoints.filter((dp) => {
      if (dp.s - prevS < 22) return false;
      prevS = dp.s;
      return true;
    });
    this.decisionPoints.length = 0;
    this.decisionPoints.push(...filtered);
  }

  /** Re-plan the route after the player takes `branch` at decision `dp`. */
  replan(dp: DecisionPoint, branch: TurnBranch): RouteOption | null {
    const rest = this.graph.shortestNodePath(branch.toNode, this.dest);
    if (!rest) return null;
    // rest.nodePath[0] === branch.toNode.
    const nodePath = [dp.node, ...rest.nodePath];
    const edgePath = [branch.edge, ...rest.edgePath];
    return this.graph.describeRoute(nodePath, edgePath);
  }

  /** Nearest named building/POI within ~55 m of a point ~25 m down the road. */
  private landmarkAlong(pts: Vec2[], fromA: boolean): string | undefined {
    const probe = pointAlong(pts, fromA, 25);
    let best: string | undefined;
    let bestD = 55 * 55;
    const consider = (pos: Vec2, name?: string): void => {
      if (!name) return;
      const d = (pos[0] - probe[0]) ** 2 + (pos[1] - probe[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    };
    for (const poi of this.area.pois) consider(poi.pos, poi.name);
    for (const b of this.area.buildings) if (b.name) consider(centroid(b.footprint), b.name);
    return best;
  }
}

/** Unit direction the edge heads when LEAVING the given node. */
function edgeDirAtNode(pts: Vec2[], atA: boolean): Vec2 {
  if (atA) return unit(pts[0]!, pts[1] ?? pts[0]!);
  const n = pts.length;
  return unit(pts[n - 1]!, pts[n - 2] ?? pts[n - 1]!);
}

/** A point `dist` metres along the edge starting from the given end. */
function pointAlong(pts: Vec2[], fromA: boolean, dist: number): Vec2 {
  const ordered = fromA ? pts : [...pts].reverse();
  let acc = 0;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1]!;
    const b = ordered[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + seg >= dist) {
      const f = (dist - acc) / (seg || 1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    acc += seg;
  }
  return ordered[ordered.length - 1]!;
}

function unit(from: Vec2, to: Vec2): Vec2 {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

/** Signed angle from a to b (radians), positive = left turn in our XZ frame. */
function signedAngle(a: Vec2, b: Vec2): number {
  const dot = a[0] * b[0] + a[1] * b[1];
  const cross = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(cross, dot);
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
