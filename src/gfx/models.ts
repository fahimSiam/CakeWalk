/**
 * Loader for the few real 3D assets we ship: Kenney's MIT-licensed vehicle
 * models (public/models/, see LICENSE-kenney.txt). Each GLB is flattened
 * into ONE geometry + its colormap material so traffic can stay instanced —
 * one draw call per vehicle kind.
 *
 * Everything else in the game remains procedural; these are the "hero"
 * shapes where handmade models visibly beat boxes.
 */
import type { AnimationClip, BufferGeometry, Material, Object3D } from 'three';
import { Box3, BufferAttribute, Color, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

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

/**
 * @param flatColors bake each part's flat material colour into a per-vertex
 *   `color` attribute and return a single vertexColors material. Use for
 *   multi-material untextured models (the Quaternius cars: body / wheels /
 *   windows in different colours) so they survive the merge-to-one-mesh that
 *   keeps traffic instanced. Leave false for Kenney's single-texture models.
 */
export function loadVehicleModel(name: string, flatColors = false): Promise<LoadedModel | null> {
  const key = flatColors ? `${name}#flat` : name;
  let p = cache.get(key);
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
          const partMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material;
          // Keep only the attributes every primitive shares so merging works.
          for (const attr of Object.keys(g.attributes)) {
            if (!['position', 'normal', 'uv'].includes(attr)) g.deleteAttribute(attr);
          }
          if (flatColors) {
            // Stamp this part's solid colour onto its vertices and drop uv, so
            // all parts can merge into one vertex-coloured mesh.
            g.deleteAttribute('uv');
            const col = (partMat as { color?: Color }).color ?? new Color(0xffffff);
            const n = g.getAttribute('position').count;
            const arr = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
              arr[i * 3] = col.r;
              arr[i * 3 + 1] = col.g;
              arr[i * 3 + 2] = col.b;
            }
            g.setAttribute('color', new BufferAttribute(arr, 3));
          }
          geos.push(g.toNonIndexed());
          if (!material) material = flatColors
            ? new MeshLambertMaterial({ vertexColors: true, flatShading: true })
            : partMat;
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

/**
 * A rigged, animated character GLB loaded ONCE and cloned per instance.
 *
 * Unlike loadVehicleModel (which flattens to a single static geometry for
 * instancing), characters need their skeleton + animation clips intact, so we
 * keep the scene graph and hand out skeleton-aware clones. Cheap enough for a
 * handful of "hero" actors (player + a few foreground NPCs); the 200-agent
 * background crowd stays procedural-instanced.
 */
export interface SkinnedModel {
  /** Make an independent, separately-animatable copy, grounded at y=0 and
   *  scaled so the character stands `targetHeight` metres tall. */
  spawn(targetHeight: number): { root: Object3D; clips: AnimationClip[] };
  /** Resolve a logical clip ("walk"/"run"/"idle"/"jump"/"sit") to a real clip
   *  on this model, matched case-insensitively by name prefix so the GLB can be
   *  swapped for another rig without touching gameplay code. */
  clip(role: ClipRole): AnimationClip | null;
}

/** The cohesive Quaternius "Animated Humans" roster (one shared rig). Index 0
 *  is the default player model; the crowd spreads across all of them. */
export const PEOPLE_MODELS = [
  'characters/man',
  'characters/man-suit',
  'characters/woman',
  'characters/woman-casual',
  'characters/woman-dress',
] as const;

/** Load every people variant once (cached); nulls for any that fail to load. */
export function loadPeople(): Promise<(SkinnedModel | null)[]> {
  return Promise.all(PEOPLE_MODELS.map((n) => loadCharacterModel(n)));
}

/** A static, multi-material prop (e.g. a textured tree) kept as a real scene
 *  graph so its materials survive — cloned per placement. */
export interface PropModel {
  /** Clone the prop, grounded at y=0 and scaled to `targetHeight` metres. */
  spawn(targetHeight: number): Object3D;
}

const propCache = new Map<string, Promise<PropModel | null>>();

export function loadPropModel(name: string): Promise<PropModel | null> {
  let p = propCache.get(name);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
      .then((gltf) => {
        const source = gltf.scene;
        source.updateMatrixWorld(true);
        const baseBox = new Box3().setFromObject(source);
        const baseHeight = Math.max(0.001, baseBox.max.y - baseBox.min.y);
        return {
          spawn(targetHeight: number) {
            const root = source.clone(true);
            // Object3D.clone() shares geometry + materials with the cached
            // source; deep-clone them so each placement OWNS its resources and
            // can be safely disposed / world-bent without corrupting the cache
            // that the next run re-spawns from.
            root.traverse((o) => {
              const mesh = o as Mesh;
              if (!mesh.isMesh) return;
              mesh.geometry = mesh.geometry.clone();
              mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map((m) => m.clone())
                : mesh.material.clone();
            });
            const s = targetHeight / baseHeight;
            root.scale.setScalar(s);
            root.updateMatrixWorld(true);
            const box = new Box3().setFromObject(root);
            root.position.x -= (box.min.x + box.max.x) / 2;
            root.position.z -= (box.min.z + box.max.z) / 2;
            root.position.y -= box.min.y;
            return root;
          },
        } satisfies PropModel;
      })
      .catch(() => null);
    propCache.set(name, p);
  }
  return p;
}

export type ClipRole = 'idle' | 'walk' | 'run' | 'jump' | 'sit';

/** Logical role → candidate name fragments, tried in order (first match wins).
 *  Covers KayKit Adventurers plus three.js RobotExpressive / Mixonts naming.
 *  Specific names lead so we land on the looping locomotion clip, not a
 *  transition (e.g. "sit_chair_idle" before the generic "sit"). */
const CLIP_ALIASES: Record<ClipRole, string[]> = {
  idle: ['idle', 'standing', 'stand'],
  walk: ['walking_a', 'walking', 'walk'],
  run: ['running_a', 'running', 'jog', 'sprint', 'run'],
  jump: ['jump_idle', 'jump', 'jumping', 'walkjump', 'jump_full', 'leap'],
  sit: ['sit_chair_idle', 'sit_floor_idle', 'sitting', 'sit_chair', 'sit'],
};

/** Best name containing `frag`, preferring an exact match, then a prefix
 *  match, then any substring — so "walk" finds "Walking_A" not
 *  "Walking_Backwards". Case-insensitive. */
function bestName(names: readonly string[], frag: string): string | null {
  let prefix: string | null = null;
  let sub: string | null = null;
  for (const name of names) {
    const n = name.toLowerCase();
    if (n === frag) return name;
    if (!prefix && n.startsWith(frag)) prefix = name;
    if (!sub && n.includes(frag)) sub = name;
  }
  return prefix ?? sub;
}

/**
 * Resolve a logical role to a concrete clip name from a model's clip list,
 * trying each alias in priority order. Pure + exported so the asset can be
 * swapped for another rig (KayKit ↔ RobotExpressive ↔ Mixamo) with confidence
 * that the right locomotion clip is still picked. Falls back to the first clip.
 */
export function pickClipName(names: readonly string[], role: ClipRole): string | null {
  for (const frag of CLIP_ALIASES[role]) {
    const hit = bestName(names, frag);
    if (hit) return hit;
  }
  return names[0] ?? null;
}

/** Mesh/node names to hide on spawn — weapons and fantasy props the base
 *  KayKit Adventurer carries that don't belong on a Dhaka street. */
const HIDE_PARTS =
  /knife|crossbow|bow|quiver|arrow|throwable|sword|dagger|axe|shield|cape|staff|wand|spellbook|hood/i;

const skinnedCache = new Map<string, Promise<SkinnedModel | null>>();

export function loadCharacterModel(name: string): Promise<SkinnedModel | null> {
  let p = skinnedCache.get(name);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
      .then((gltf) => {
        const source = gltf.scene;
        const clips = gltf.animations ?? [];
        // Strip fantasy equipment (weapons, cape, etc.) from the canonical
        // source ONCE so the rig reads as an ordinary pedestrian, clones don't
        // carry it, and — crucially — the height measured below is the human's,
        // not inflated by a staff/hood poking above the head.
        const drop: Object3D[] = [];
        source.traverse((o) => {
          if (HIDE_PARTS.test(o.name)) drop.push(o);
        });
        for (const o of drop) o.removeFromParent();

        // Measure the stripped source once so every spawn can normalize height.
        source.updateMatrixWorld(true);
        const baseBox = new Box3().setFromObject(source);
        const baseHeight = Math.max(0.001, baseBox.max.y - baseBox.min.y);

        const names = clips.map((c) => c.name);
        const byRole = (role: ClipRole): AnimationClip | null => {
          const name = pickClipName(names, role);
          return clips.find((c) => c.name === name) ?? null;
        };

        return {
          spawn(targetHeight: number) {
            const root = cloneSkinned(source) as Object3D;
            const s = targetHeight / baseHeight;
            root.scale.setScalar(s);
            root.updateMatrixWorld(true);
            // Re-ground: after scaling, drop so feet sit at y=0 and center x/z.
            const box = new Box3().setFromObject(root);
            root.position.x -= (box.min.x + box.max.x) / 2;
            root.position.z -= (box.min.z + box.max.z) / 2;
            root.position.y -= box.min.y;
            return { root, clips };
          },
          clip: byRole,
        } satisfies SkinnedModel;
      })
      .catch(() => null);
    skinnedCache.set(name, p);
  }
  return p;
}
