/**
 * Geometry helpers for the bake pipeline: projection, simplification,
 * polyline measurement. Shared by bake.ts and unit-tested directly.
 */
import type { Vec2 } from '../../src/world/levelTypes';

/** Equirectangular projection to local meters around an origin. */
export function makeProjector(lat0: number, lon0: number) {
  const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const mPerLat = 110540;
  return (lat: number, lon: number): Vec2 => [
    (lon - lon0) * mPerLon,
    -(lat - lat0) * mPerLat, // north → -z (three.js convention)
  ];
}

/** Douglas-Peucker polyline simplification. */
export function simplify(pts: Vec2[], epsilon: number): Vec2[] {
  if (pts.length <= 2) return pts;
  let maxDist = 0;
  let index = 0;
  const [start, end] = [pts[0]!, pts[pts.length - 1]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegment(pts[i]!, start, end);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(pts.slice(0, index + 1), epsilon);
    const right = simplify(pts.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

export function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lenSq = dx * dx + dz * dz;
  let t = lenSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a[0] + t * dx - p[0];
  const pz = a[1] + t * dz - p[1];
  return Math.sqrt(px * px + pz * pz);
}

export function polylineLength(pts: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  }
  return len;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Min distance from point to polyline. */
export function pointToPolyline(p: Vec2, pts: Vec2[]): number {
  let min = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = pointToSegment(p, pts[i - 1]!, pts[i]!);
    if (d < min) min = d;
  }
  return min;
}

/** Ring area (shoelace); used to fix winding & estimate building size. */
export function ringArea(pts: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i]![0] * pts[j]![1] - pts[j]![0] * pts[i]![1];
  }
  return area / 2;
}
