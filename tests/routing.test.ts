import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RouteGraph } from '@/routing/RouteGraph';
import { Rng } from '@/core/Rng';
import { SplineCorridor } from '@/world/SplineCorridor';
import type { BakedArea } from '@/world/levelTypes';

const area = JSON.parse(
  readFileSync(resolve(__dirname, '../public/levels/dhanmondi.json'), 'utf8'),
) as BakedArea;

describe('baked Dhanmondi data', () => {
  it('has substantial real content', () => {
    expect(area.roads.length).toBeGreaterThan(300);
    expect(area.buildings.length).toBeGreaterThan(2000);
    expect(area.graph.nodes.length).toBeGreaterThan(300);
    expect(area.graph.edges.length).toBeGreaterThan(400);
    expect(area.attribution).toContain('OpenStreetMap');
  });

  it('edges have 1-5 stats and consistent endpoints', () => {
    for (const e of area.graph.edges.slice(0, 200)) {
      expect(e.stats.crowd).toBeGreaterThanOrEqual(1);
      expect(e.stats.crowd).toBeLessThanOrEqual(5);
      expect(e.stats.traffic).toBeGreaterThanOrEqual(1);
      expect(e.stats.traffic).toBeLessThanOrEqual(5);
      expect(e.a).toBeLessThan(area.graph.nodes.length);
      expect(e.b).toBeLessThan(area.graph.nodes.length);
      expect(e.pts.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('RouteGraph', () => {
  const graph = new RouteGraph(area);

  it('pickEndpoints is seeded-deterministic and within the length band', () => {
    const e1 = graph.pickEndpoints(new Rng(42).stream('route'));
    const e2 = graph.pickEndpoints(new Rng(42).stream('route'));
    expect(e1).toEqual(e2);
    const routes = graph.findRoutes(e1.a, e1.b);
    expect(routes[0]!.lengthM).toBeGreaterThanOrEqual(400);
  });

  it('finds multiple diverse routes', () => {
    const { a, b } = graph.pickEndpoints(new Rng(7).stream('route'));
    const routes = graph.findRoutes(a, b);
    expect(routes.length).toBeGreaterThanOrEqual(2);
    // Diverse = not the identical edge sets.
    const keys = routes.map((r) => r.edgePath.join(','));
    expect(new Set(keys).size).toBe(keys.length);
    // Continuous polyline: consecutive points connect (long straight road
    // segments are legitimate after Douglas-Peucker, so the bound is loose —
    // a disconnect would show up as a multi-hundred-meter jump).
    for (const r of routes) {
      for (let i = 1; i < r.pts.length; i++) {
        const d = Math.hypot(r.pts[i]![0] - r.pts[i - 1]![0], r.pts[i]![1] - r.pts[i - 1]![1]);
        expect(d).toBeLessThan(400);
      }
    }
  });

  it('route stats are aggregated into 1-5 ranges', () => {
    const { a, b } = graph.pickEndpoints(new Rng(99).stream('route'));
    for (const r of graph.findRoutes(a, b)) {
      expect(r.crowd).toBeGreaterThanOrEqual(1);
      expect(r.crowd).toBeLessThanOrEqual(5);
      expect(r.pickpocket).toBeGreaterThanOrEqual(1);
      expect(r.pickpocket).toBeLessThanOrEqual(5);
      expect(r.crossings).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('SplineCorridor', () => {
  it('walks the full route length with sane world output', () => {
    const { a, b } = new RouteGraph(area).pickEndpoints(new Rng(5).stream('route'));
    const route = new RouteGraph(area).findRoutes(a, b)[0]!;
    const corridor = new SplineCorridor(route.pts);
    expect(corridor.length).toBeGreaterThan(route.lengthM * 0.8);
    const pose = { x: 0, z: 0, dirX: 0, dirZ: 0 };
    for (let s = 0; s <= corridor.length; s += corridor.length / 50) {
      corridor.toWorld(s, 0, pose);
      expect(Number.isFinite(pose.x)).toBe(true);
      expect(Math.hypot(pose.dirX, pose.dirZ)).toBeCloseTo(1, 1);
    }
    // closestS inverts toWorld approximately.
    corridor.toWorld(corridor.length / 2, 0, pose);
    expect(corridor.closestS(pose.x, pose.z)).toBeCloseTo(corridor.length / 2, -1);
  });
});
