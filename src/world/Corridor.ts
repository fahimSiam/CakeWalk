/**
 * The playable space of a run, in path coordinates:
 *   s = distance along the route (meters), t = lateral offset (meters,
 *   negative = left of walking direction).
 * The sim runs entirely in (s, t); only rendering converts to world XZ.
 * M1 uses a straight graybox corridor; M3 swaps in an OSM footpath spline
 * behind the same interface without touching any sim code.
 */

export interface PathPose {
  x: number;
  z: number;
  /** Unit forward direction of the path at s. */
  dirX: number;
  dirZ: number;
}

export interface Corridor {
  /** Total length in meters. */
  readonly length: number;
  /** Half-width of walkable space at s (player clamps |t| to this). */
  halfWidth(s: number): number;
  /** Path coords → world (XZ plane; y is handled by entities). */
  toWorld(s: number, t: number, out: PathPose): PathPose;
}

/** M1 graybox: a straight footpath heading -Z. */
export class StraightCorridor implements Corridor {
  constructor(
    readonly length: number,
    private half: number,
  ) {}

  halfWidth(_s: number): number {
    return this.half;
  }

  toWorld(s: number, t: number, out: PathPose): PathPose {
    out.x = t;
    out.z = -s;
    out.dirX = 0;
    out.dirZ = -1;
    return out;
  }
}
