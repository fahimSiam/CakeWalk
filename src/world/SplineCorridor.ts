/**
 * Corridor along a baked route polyline. The run happens on the footpath
 * beside the road centerline: we offset the centerline by a fixed lateral
 * shift and give the player a walkable band around it.
 */
import type { Vec2 } from './levelTypes';
import type { Corridor, PathPose } from './Corridor';

export class SplineCorridor implements Corridor {
  readonly length: number;
  private cum: Float32Array; // cumulative length at each vertex
  private pts: Vec2[];
  /** Smoothed unit tangent at each vertex (average of adjacent segments). */
  private tanX: Float32Array;
  private tanZ: Float32Array;

  constructor(
    pts: Vec2[],
    private half = 3.2,
  ) {
    // De-duplicate zero-length segments (graph joints repeat points).
    this.pts = pts.filter(
      (p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) > 0.05,
    );
    const n = this.pts.length;
    this.cum = new Float32Array(n);
    let acc = 0;
    for (let i = 1; i < n; i++) {
      acc += Math.hypot(this.pts[i]![0] - this.pts[i - 1]![0], this.pts[i]![1] - this.pts[i - 1]![1]);
      this.cum[i] = acc;
    }
    this.length = acc;
    // Per-vertex tangents: interpolating these inside segments turns hard
    // polyline corners into smooth direction changes (no more facing snaps).
    this.tanX = new Float32Array(n);
    this.tanZ = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const prev = this.pts[Math.max(0, i - 1)]!;
      const next = this.pts[Math.min(n - 1, i + 1)]!;
      const dx = next[0] - prev[0];
      const dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      this.tanX[i] = dx / len;
      this.tanZ[i] = dz / len;
    }
  }

  halfWidth(_s: number): number {
    return this.half;
  }

  toWorld(s: number, t: number, out: PathPose): PathPose {
    const clamped = Math.max(0, Math.min(s, this.length - 0.001));
    // Binary search the segment containing s.
    let lo = 0;
    let hi = this.pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= clamped) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo]!;
    const b = this.pts[hi]!;
    const segLen = this.cum[hi]! - this.cum[lo]! || 1;
    const f = (clamped - this.cum[lo]!) / segLen;
    // Smoothed direction: blend vertex tangents across the segment.
    let dirX = this.tanX[lo]! + (this.tanX[hi]! - this.tanX[lo]!) * f;
    let dirZ = this.tanZ[lo]! + (this.tanZ[hi]! - this.tanZ[lo]!) * f;
    const dLen = Math.hypot(dirX, dirZ) || 1;
    dirX /= dLen;
    dirZ /= dLen;
    // Lateral normal (right of walking direction).
    const nx = -dirZ;
    const nz = dirX;
    out.x = a[0] + (b[0] - a[0]) * f + nx * t;
    out.z = a[1] + (b[1] - a[1]) * f + nz * t;
    out.dirX = dirX;
    out.dirZ = dirZ;
    return out;
  }

  /** Distance s of the closest point on the corridor to a world position. */
  closestS(x: number, z: number): number {
    let bestS = 0;
    let bestD = Infinity;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1]!;
      const b = this.pts[i]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lenSq = dx * dx + dz * dz;
      let f = lenSq === 0 ? 0 : ((x - a[0]) * dx + (z - a[1]) * dz) / lenSq;
      f = Math.max(0, Math.min(1, f));
      const px = a[0] + f * dx - x;
      const pz = a[1] + f * dz - z;
      const d = px * px + pz * pz;
      if (d < bestD) {
        bestD = d;
        bestS = this.cum[i - 1]! + Math.sqrt(lenSq) * f;
      }
    }
    return bestS;
  }
}
