/**
 * Loads and caches baked area JSON from public/levels/.
 */
import type { BakedArea } from './levelTypes';

const cache = new Map<string, BakedArea>();

export async function loadArea(id: string): Promise<BakedArea> {
  const hit = cache.get(id);
  if (hit) return hit;
  const res = await fetch(`${import.meta.env.BASE_URL}levels/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load area ${id}: ${res.status}`);
  const area = (await res.json()) as BakedArea;
  cache.set(id, area);
  return area;
}
