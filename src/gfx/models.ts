/**
 * Loader for the few real 3D assets we ship: Kenney's MIT-licensed vehicle
 * models (public/models/, see LICENSE-kenney.txt). Each GLB is flattened
 * into ONE geometry + its colormap material so traffic can stay instanced —
 * one draw call per vehicle kind.
 *
 * Everything else in the game remains procedural; these are the "hero"
 * shapes where handmade models visibly beat boxes.
 */
import type { BufferGeometry, Material } from 'three';
import { Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface LoadedModel {
  geometry: BufferGeometry;
  material: Material;
  /** Model length along +Z after normalization (= 1). Scale by desired length. */
  unit: true;
  /** Normalized width (x) and height (y) relative to length, so the renderer
   *  can scale non-uniformly to a kind's real width/height (no fat trucks). */
  sx: number;
  sy: number;
}

const cache = new Map<string, Promise<LoadedModel | null>>();
const loader = new GLTFLoader();

export function loadVehicleModel(name: string): Promise<LoadedModel | null> {
  let p = cache.get(name);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
      .then((gltf) => {
        const geos: BufferGeometry[] = [];
        let material: Material | null = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((obj) => {
          const mesh = obj as Mesh;
          if (!mesh.isMesh) return;
          const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          // Keep only the attributes every primitive shares so merging works.
          for (const attr of Object.keys(g.attributes)) {
            if (!['position', 'normal', 'uv'].includes(attr)) g.deleteAttribute(attr);
          }
          geos.push(g.toNonIndexed());
          if (!material) material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
        });
        if (!geos.length || !material) return null;
        const merged = mergeGeometries(geos, false);
        if (!merged) return null;
        // Normalize: centered on x/z, grounded at y=0, length 1 along +Z
        // (rotate if the long horizontal axis is X).
        merged.computeBoundingBox();
        let box = merged.boundingBox!;
        let size = box.getSize(new Vector3());
        if (size.x > size.z) {
          merged.rotateY(Math.PI / 2);
          merged.computeBoundingBox();
          box = merged.boundingBox!;
          size = box.getSize(new Vector3());
        }
        const center = box.getCenter(new Vector3());
        merged.translate(-center.x, -box.min.y, -center.z);
        merged.scale(1 / size.z, 1 / size.z, 1 / size.z);
        return {
          geometry: merged,
          material,
          unit: true as const,
          sx: size.x / size.z,
          sy: size.y / size.z,
        };
      })
      .catch(() => null); // missing model → caller keeps its procedural fallback
    cache.set(name, p);
  }
  return p;
}
