/**
 * Curated playable zones per area (~2-3 km² each), defined as WGS84 bboxes.
 * Coordinates verified against OSM during baking; tune after data audit.
 */

export interface AreaDef {
  id: string;
  nameEn: string;
  nameBn: string;
  /** south, west, north, east */
  bbox: [number, number, number, number];
  /** Gameplay personality multipliers (idea.md §3.2). */
  tuning: {
    crowd: number;
    traffic: number;
    pickpocket: number;
    /** Average route length bias (Bashundhara endurance = longer). */
    routeLength: number;
  };
}

export const AREAS: AreaDef[] = [
  {
    id: 'dhanmondi',
    nameEn: 'Dhanmondi',
    nameBn: 'ধানমন্ডি',
    bbox: [23.736, 90.366, 23.756, 90.386],
    tuning: { crowd: 0.8, traffic: 0.8, pickpocket: 0.6, routeLength: 1.0 },
  },
  {
    id: 'uttara',
    nameEn: 'Uttara',
    nameBn: 'উত্তরা',
    bbox: [23.858, 90.39, 23.878, 90.41],
    tuning: { crowd: 0.9, traffic: 1.4, pickpocket: 0.8, routeLength: 1.1 },
  },
  {
    id: 'bashundhara',
    nameEn: 'Bashundhara R/A',
    nameBn: 'বসুন্ধরা আ/এ',
    bbox: [23.81, 90.415, 23.83, 90.435],
    tuning: { crowd: 0.6, traffic: 0.9, pickpocket: 0.5, routeLength: 1.4 },
  },
  {
    id: 'mohammadpur',
    nameEn: 'Mohammadpur',
    nameBn: 'মোহাম্মদপুর',
    bbox: [23.755, 90.35, 23.775, 90.37],
    tuning: { crowd: 1.2, traffic: 1.0, pickpocket: 1.8, routeLength: 1.0 },
  },
  {
    id: 'puran_dhaka',
    nameEn: 'Puran Dhaka',
    nameBn: 'পুরান ঢাকা',
    bbox: [23.7, 90.395, 23.72, 90.415],
    tuning: { crowd: 1.6, traffic: 1.1, pickpocket: 1.2, routeLength: 0.9 },
  },
  {
    id: 'gulistan',
    nameEn: 'Gulistan/Motijheel',
    nameBn: 'গুলিস্তান/মতিঝিল',
    bbox: [23.72, 90.405, 23.74, 90.425],
    tuning: { crowd: 1.8, traffic: 1.7, pickpocket: 1.5, routeLength: 1.0 },
  },
];

export function areaById(id: string): AreaDef {
  const a = AREAS.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown area: ${id}`);
  return a;
}
