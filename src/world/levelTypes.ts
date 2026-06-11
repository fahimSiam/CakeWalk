/**
 * Baked level data contract between the offline OSM pipeline (tools/osm)
 * and the runtime (world/, routing/). One JSON per area, committed to the
 * repo — derived from OpenStreetMap and therefore ODbL-licensed.
 */

export type Vec2 = [number, number]; // meters, local area frame (x east, z south→negated north)

export type RoadClass = 'major' | 'minor' | 'footway';

export interface BakedRoad {
  id: number;
  class: RoadClass;
  width: number;
  pts: Vec2[];
  name?: string;
}

export interface BakedBuilding {
  footprint: Vec2[];
  height: number;
  kind: 'residential' | 'commercial' | 'mosque' | 'market' | 'landmark';
  name?: string;
}

export type PoiKind =
  | 'chaDokan'
  | 'mosque'
  | 'market'
  | 'busStop'
  | 'landmark'
  | 'school'
  | 'tree'
  | 'dustbin';

export interface BakedPoi {
  kind: PoiKind;
  pos: Vec2;
  name?: string;
  nameBn?: string;
}

export interface EdgeStats {
  lengthM: number;
  /** 1-5: pedestrian density baseline. */
  crowd: number;
  /** 1-5: vehicle traffic level (drives crossing minigame difficulty). */
  traffic: number;
  /** Cha dokan within reach of this edge. */
  chaDokan: number;
  /** 1-5: pickpocket risk from nearby markets/terminals (location types). */
  pickpocket: number;
}

export interface GraphNode {
  id: number;
  pos: Vec2;
  /** True where this intersection crosses a major road (crossing minigame). */
  majorCrossing: boolean;
}

export interface GraphEdge {
  a: number; // GraphNode index
  b: number;
  roadId: number;
  stats: EdgeStats;
  /** Centerline polyline from a to b (subset of the road's pts). */
  pts: Vec2[];
}

export interface BakedArea {
  id: string;
  nameEn: string;
  nameBn: string;
  origin: { lat: number; lon: number };
  bbox: [number, number, number, number]; // minX, minZ, maxX, maxZ (meters)
  roads: BakedRoad[];
  buildings: BakedBuilding[];
  pois: BakedPoi[];
  water: Vec2[][];
  parks: Vec2[][];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  attribution: string;
}

export const OSM_ATTRIBUTION = 'Map data © OpenStreetMap contributors (ODbL)';
