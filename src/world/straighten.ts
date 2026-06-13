/**
 * "Unroll" the real curved route into a dead-straight corridor (idea.md Rev 8).
 *
 * The whole run is played on a StraightCorridor, where toWorld(s, t) = (t, -s):
 * the path runs straight along -Z and t is the lateral offset. To make the real
 * OSM world line up with that, we map every world point through
 *   unroll(p) = (lateralOffsetFromRoute, -distanceAlongRoute)
 * so buildings, shops and props keep their real along-route ORDER and spacing,
 * but the road never bends. The result: the player always walks straight, and
 * curves in the real city simply don't exist on screen (Subway-Surfers style).
 */
import type { BakedArea, Vec2 } from './levelTypes';
import type { SplineCorridor } from './SplineCorridor';
import type { PathPose } from './Corridor';

const tmp: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };

/** Map a world point to straight-corridor space using the real route. */
export function unrollPoint(p: Vec2, projector: SplineCorridor): Vec2 {
  const s = projector.closestS(p[0], p[1]);
  projector.toWorld(s, 0, tmp);
  // Lateral = projection on the right normal (-dirZ, dirX).
  const lat = (p[0] - tmp.x) * -tmp.dirZ + (p[1] - tmp.z) * tmp.dirX;
  return [lat, -s];
}

/** The route's own polyline, unrolled → a straight line down -Z. */
export function straightRoute(routePts: Vec2[], projector: SplineCorridor): Vec2[] {
  return routePts.map((v) => unrollPoint(v, projector));
}

/**
 * A copy of the baked area with every building footprint and POI unrolled into
 * straight-corridor space. Real roads / water / parks can't meaningfully
 * straighten (they'd warp), so they're dropped — the footpath + left road band
 * that LevelRenderer draws along the straight route stand in for them.
 */
export function straightenArea(area: BakedArea, projector: SplineCorridor): BakedArea {
  return {
    ...area,
    roads: [],
    water: [],
    parks: [],
    buildings: area.buildings.map((b) => ({
      ...b,
      footprint: b.footprint.map((v) => unrollPoint(v, projector)),
    })),
    pois: area.pois.map((p) => ({ ...p, pos: unrollPoint(p.pos, projector) })),
  };
}
