/**
 * Runtime route graph over baked OSM data: seeded A→B generation and
 * k-diverse path finding (penalty-based iterative Dijkstra), with per-route
 * gameplay stats for the route-select cards (idea.md §3.3).
 */
import type { BakedArea, EdgeStats, GraphEdge, Vec2 } from '@/world/levelTypes';
import type { RngStream } from '@/core/Rng';

export interface RouteOption {
  /** Node indices A → B. */
  nodePath: number[];
  /** Edge indices along the path. */
  edgePath: number[];
  /** Concatenated centerline A → B. */
  pts: Vec2[];
  lengthM: number;
  /** Aggregated 1-5 stats for the route card. */
  crowd: number;
  traffic: number;
  pickpocket: number;
  chaDokan: number;
  crossings: number;
}

const K_ROUTES = 4;
const PENALTY = 1.7;
const MIN_LEN = 500;
const MAX_LEN = 1700;

interface Adj {
  edge: number;
  to: number;
  cost: number;
}

export class RouteGraph {
  private adj: Adj[][];

  constructor(private area: BakedArea) {
    this.adj = area.graph.nodes.map(() => []);
    area.graph.edges.forEach((e, i) => {
      this.adj[e.a]!.push({ edge: i, to: e.b, cost: e.stats.lengthM });
      this.adj[e.b]!.push({ edge: i, to: e.a, cost: e.stats.lengthM });
    });
  }

  /** Seeded A→B in the main connected component, within a length band. */
  pickEndpoints(rng: RngStream, lengthBias = 1): { a: number; b: number } {
    const n = this.area.graph.nodes.length;
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = rng.int(0, n - 1);
      if (this.adj[a]!.length === 0) continue;
      const dist = this.dijkstra(a);
      const minL = MIN_LEN * lengthBias;
      const maxL = MAX_LEN * lengthBias;
      const candidates: number[] = [];
      for (let i = 0; i < n; i++) {
        if (dist[i]! >= minL && dist[i]! <= maxL) candidates.push(i);
      }
      if (candidates.length > 3) return { a, b: candidates[rng.int(0, candidates.length - 1)]! };
    }
    // Degenerate graph fallback: farthest reachable pair from node 0.
    const dist = this.dijkstra(0);
    let best = 0;
    let bestD = 0;
    for (let i = 0; i < n; i++) {
      if (dist[i]! < Infinity && dist[i]! > bestD) {
        bestD = dist[i]!;
        best = i;
      }
    }
    return { a: 0, b: best };
  }

  /** Edges incident to a node: {edge index, neighbour node}. */
  neighbors(node: number): { edge: number; to: number }[] {
    return (this.adj[node] ?? []).map((a) => ({ edge: a.edge, to: a.to }));
  }

  /** Shortest unpenalized node/edge path a→b (for re-planning after a turn). */
  shortestNodePath(a: number, b: number): { nodePath: number[]; edgePath: number[] } | null {
    return this.shortestPath(a, b, new Map());
  }

  /** Build a full RouteOption (pts + stats) from a node/edge path. */
  describeRoute(nodePath: number[], edgePath: number[]): RouteOption {
    return this.describe(nodePath, edgePath);
  }

  /** Up to K diverse routes A→B via penalty-based iterative Dijkstra. */
  findRoutes(a: number, b: number): RouteOption[] {
    const penalties = new Map<number, number>();
    const found: RouteOption[] = [];
    const seen = new Set<string>();
    for (let k = 0; k < K_ROUTES + 2 && found.length < K_ROUTES; k++) {
      const path = this.shortestPath(a, b, penalties);
      if (!path) break;
      const key = path.edgePath.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        found.push(this.describe(path.nodePath, path.edgePath));
      }
      for (const e of path.edgePath) {
        penalties.set(e, (penalties.get(e) ?? 1) * PENALTY);
      }
    }
    // Sort: shortest first; the brutal-short vs safe-long spread emerges
    // naturally from stats shown on cards.
    return found.sort((x, y) => x.lengthM - y.lengthM);
  }

  private describe(nodePath: number[], edgePath: number[]): RouteOption {
    const { edges, nodes } = this.area.graph;
    const pts: Vec2[] = [];
    let lengthM = 0;
    const agg = { crowd: 0, traffic: 0, pickpocket: 0 };
    let chaDokan = 0;
    let crossings = 0;
    edgePath.forEach((ei, i) => {
      const e = edges[ei]!;
      const forward = e.a === nodePath[i];
      const seg = forward ? e.pts : [...e.pts].reverse();
      pts.push(...(i === 0 ? seg : seg.slice(1)));
      lengthM += e.stats.lengthM;
      agg.crowd += e.stats.crowd * e.stats.lengthM;
      agg.traffic += e.stats.traffic * e.stats.lengthM;
      agg.pickpocket += e.stats.pickpocket * e.stats.lengthM;
      chaDokan += e.stats.chaDokan;
    });
    for (const ni of nodePath.slice(1, -1)) {
      if (nodes[ni]!.majorCrossing) crossings++;
    }
    return {
      nodePath,
      edgePath,
      pts,
      lengthM: Math.round(lengthM),
      crowd: Math.round(agg.crowd / lengthM),
      traffic: Math.round(agg.traffic / lengthM),
      pickpocket: Math.round(agg.pickpocket / lengthM),
      chaDokan,
      crossings,
    };
  }

  private shortestPath(
    a: number,
    b: number,
    penalties: Map<number, number>,
  ): { nodePath: number[]; edgePath: number[] } | null {
    const n = this.area.graph.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prevNode = new Int32Array(n).fill(-1);
    const prevEdge = new Int32Array(n).fill(-1);
    dist[a] = 0;
    // Binary-heap-free Dijkstra is fine at ~1k nodes.
    const visited = new Uint8Array(n);
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && dist[i]! < best) {
          best = dist[i]!;
          u = i;
        }
      }
      if (u === -1 || u === b) break;
      visited[u] = 1;
      for (const { edge, to, cost } of this.adj[u]!) {
        const c = cost * (penalties.get(edge) ?? 1);
        if (dist[u]! + c < dist[to]!) {
          dist[to] = dist[u]! + c;
          prevNode[to] = u;
          prevEdge[to] = edge;
        }
      }
    }
    if (dist[b] === Infinity) return null;
    const nodePath: number[] = [];
    const edgePath: number[] = [];
    for (let v = b; v !== -1; v = prevNode[v]!) {
      nodePath.unshift(v);
      if (prevEdge[v] !== -1) edgePath.unshift(prevEdge[v]!);
      if (v === a) break;
    }
    return { nodePath, edgePath };
  }

  private dijkstra(a: number): Float64Array {
    const n = this.area.graph.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const visited = new Uint8Array(n);
    dist[a] = 0;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && dist[i]! < best) {
          best = dist[i]!;
          u = i;
        }
      }
      if (u === -1) break;
      visited[u] = 1;
      for (const { to, cost } of this.adj[u]!) {
        if (dist[u]! + cost < dist[to]!) dist[to] = dist[u]! + cost;
      }
    }
    return dist;
  }
}

export type { EdgeStats, GraphEdge };
