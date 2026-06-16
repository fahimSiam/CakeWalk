/**
 * Instanced renderers for dynamic entities beyond the crowd: pocketmars,
 * crossing vehicles, dogs and cats. Each is a small fixed pool.
 */
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCngGeometry, buildRickshawGeometry, paintColored } from './meshFactory';
import { loadVehicleModel } from './models';
import { MAX_VEHICLES, TrafficSystem, VEHICLE_KINDS } from '@/traffic/TrafficSystem';
import { StreetLife, MAX_COWS, CowState } from '@/world/StreetLife';
import type { Corridor, PathPose } from '@/world/Corridor';
import { applyWorldBend, type BendUniforms } from './worldBend';

/**
 * Replace an instanced creature's procedural geometry with a real Quaternius
 * GLB (flattened to one vertex-coloured mesh so it stays instanced), uniformly
 * scaled to `targetHeight` and rotated so its +Z forward matches the
 * procedural +X convention. Async; the placeholder shows until it loads.
 */
function swapAnimalGlb(
  mesh: InstancedMesh,
  name: string,
  targetHeight: number,
  flatColors: boolean,
  bend?: BendUniforms,
): void {
  void loadVehicleModel(name, flatColors).then((model) => {
    if (!model) return;
    const geo = model.geometry.clone();
    const s = targetHeight / model.sy;
    geo.scale(s, s, s);
    // Keep the GLB's natural +Z forward (like the cars) so the body aligns with
    // the travel direction the renderer faces it — no sideways cow.
    // Clone the cached material so bend + dispose never touch the shared source.
    const mat = (model.material as MeshLambertMaterial).clone();
    if (bend) applyWorldBend(mat, bend);
    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.material = mat;
  });
}

/** Translated BoxGeometry shorthand for assembling little creatures. */
function box(w: number, h: number, d: number, x: number, y: number, z: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

const HIDDEN = new Matrix4().compose(
  new Vector3(0, -100, 0),
  new Quaternion(),
  new Vector3(0.001, 0.001, 0.001),
);

export class TrafficRenderer {
  /** One InstancedMesh per vehicle kind: bus/bike are real Kenney models
   *  (swapped in when loaded), CNG/rickshaw are detailed procedural builds. */
  private kindMeshes: InstancedMesh[] = [];
  /** Per-kind render scale (x,y,z). Procedural builds use a uniform scale; GLB
   *  models are scaled to the kind's real width/height/length (no fat trucks). */
  private kindScale: (Vector3 | null)[] = []; // null = box-style xyz scale
  private dummy = new Object3D();
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private disposed = false;

  constructor(
    scene: Scene,
    private traffic: TrafficSystem,
    private corridor: Corridor,
    private bend?: BendUniforms,
  ) {
    const mat = (): MeshLambertMaterial =>
      new MeshLambertMaterial({ flatShading: true, vertexColors: true });
    VEHICLE_KINDS.forEach((kind, ki) => {
      let geo: ReturnType<typeof buildCngGeometry>;
      let scale: Vector3 | null = null;
      if (kind.id === 'cng') {
        geo = buildCngGeometry();
        scale = new Vector3(1, 1, 1).multiplyScalar(kind.length / 2.3);
      } else if (kind.id === 'rickshaw') {
        geo = buildRickshawGeometry();
        scale = new Vector3(1, 1, 1).multiplyScalar(kind.length / 2.35);
      } else {
        // Placeholder box until the Kenney model arrives.
        const box = new BoxGeometry(1, 1, 1);
        box.translate(0, 0.5, 0);
        geo = paintColored(box, new Color(kind.color));
      }
      const mesh = new InstancedMesh(geo, mat(), MAX_VEHICLES);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.kindMeshes[ki] = mesh;
      this.kindScale[ki] = scale;

      // Real models: Kenney truck/bike (single-texture) for bus/bike; Poly
      // Pizza Quaternius cars (flat multi-material → vertex-coloured) for cars.
      const CAR_GLB: Record<string, string> = {
        car: 'cars/car-1',
        taxi: 'cars/taxi',
        suv: 'cars/suv',
      };
      const modelName =
        kind.id === 'bus' ? 'vehicle-truck-red'
        : kind.id === 'bike' ? 'vehicle-motorcycle'
        : (CAR_GLB[kind.id] ?? null);
      const flatColors = kind.id in CAR_GLB;
      if (modelName) {
        void loadVehicleModel(modelName, flatColors).then((model) => {
          if (!model || this.disposed) return;
          mesh.geometry.dispose();
          (mesh.material as MeshLambertMaterial).dispose();
          // Clone the cached geometry + material so this renderer's dispose()
          // and per-run world-bend never free/mutate the shared cached source.
          mesh.geometry = model.geometry.clone();
          mesh.material = (model.material as MeshLambertMaterial).clone();
          if (this.bend) applyWorldBend(mesh.material, this.bend);
          // Non-uniform: real width/height/length so the truck isn't a cube.
          this.kindScale[ki] = new Vector3(
            kind.width / model.sx,
            kind.height / model.sy,
            kind.length,
          );
        });
      }
    });
  }

  render(): void {
    const tr = this.traffic;
    // Reset all instances hidden, then place active ones per kind.
    const counts = new Array<number>(VEHICLE_KINDS.length).fill(0);
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (!tr.vActive[i]) continue;
      const ki = tr.vKind[i]!;
      const kind = VEHICLE_KINDS[ki]!;
      const mesh = this.kindMeshes[ki]!;
      this.corridor.toWorld(tr.vS[i]!, tr.vT[i]!, this.pose);
      this.dummy.position.set(this.pose.x, 0, this.pose.z);
      // Stream traffic drives along the road, opposite the player (-s).
      this.dummy.rotation.set(0, Math.atan2(-this.pose.dirX, -this.pose.dirZ), 0);
      const scale = this.kindScale[ki];
      if (scale != null) this.dummy.scale.copy(scale);
      else this.dummy.scale.set(kind.width, kind.height, kind.length);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(counts[ki]!++, this.dummy.matrix);
    }
    this.kindMeshes.forEach((mesh, ki) => {
      mesh.count = counts[ki]!;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(scene: Scene): void {
    this.disposed = true;
    for (const mesh of this.kindMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
    }
  }
}

export class StreetLifeRenderer {
  private dogMesh: InstancedMesh;
  private catMesh: InstancedMesh;
  private cowMesh: InstancedMesh;
  private dummy = new Object3D();
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };

  constructor(
    scene: Scene,
    private life: StreetLife,
    private corridor: Corridor,
    private bend?: BendUniforms,
  ) {
    // Low-poly Qurbani cow: pale body + brown head, horns, ears, festive
    // garland collar (cattle are decorated for Eid-ul-Adha) and a tail.
    const cowBody = new BoxGeometry(1.0, 0.85, 1.9);
    cowBody.translate(0, 1.05, 0);
    const cowHump = new BoxGeometry(0.55, 0.3, 0.5);
    cowHump.translate(0, 1.55, -0.45);
    const cowHead = new BoxGeometry(0.5, 0.5, 0.55);
    cowHead.translate(0, 1.35, 1.15);
    const cowHorns = new BoxGeometry(0.75, 0.08, 0.1);
    cowHorns.translate(0, 1.62, 1.2);
    const cowEarL = new BoxGeometry(0.18, 0.1, 0.12);
    cowEarL.translate(-0.32, 1.45, 1.1);
    const cowEarR = new BoxGeometry(0.18, 0.1, 0.12);
    cowEarR.translate(0.32, 1.45, 1.1);
    const cowGarland = new BoxGeometry(0.62, 0.14, 0.62);
    cowGarland.translate(0, 1.15, 0.9);
    const cowLegs = new BoxGeometry(0.85, 0.65, 1.6);
    cowLegs.translate(0, 0.32, 0);
    const cowTail = new BoxGeometry(0.1, 0.6, 0.1);
    cowTail.translate(0, 0.95, -0.95);
    const cowGeo = mergeGeometries(
      [
        paintColored(cowBody, new Color('#efe3cf')),
        paintColored(cowHump, new Color('#e2d3ba')),
        paintColored(cowHead, new Color('#c89a6a')),
        paintColored(cowHorns, new Color('#f4ead2')),
        paintColored(cowEarL, new Color('#b98a5c')),
        paintColored(cowEarR, new Color('#b98a5c')),
        paintColored(cowGarland, new Color('#ff7aa8')),
        paintColored(cowLegs, new Color('#8a7b66')),
        paintColored(cowTail, new Color('#8a7b66')),
      ],
      false,
    );
    this.cowMesh = new InstancedMesh(
      cowGeo,
      new MeshLambertMaterial({ flatShading: true, vertexColors: true }),
      MAX_COWS,
    );
    this.cowMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // Sleeping street dog: curled body, head on paws, snout, ears, tail.
    const FUR = new Color('#9a7b52');
    const FUR_DARK = new Color('#7c6038');
    const dogParts = [
      paintColored(box(0.85, 0.32, 0.45, 0, 0.16, 0), FUR), // body
      paintColored(box(0.34, 0.26, 0.32, 0.5, 0.16, 0.05), FUR), // head
      paintColored(box(0.16, 0.12, 0.14, 0.68, 0.1, 0.05), FUR_DARK), // snout
      paintColored(box(0.07, 0.14, 0.05, 0.45, 0.33, -0.06), FUR_DARK), // ear
      paintColored(box(0.07, 0.14, 0.05, 0.45, 0.33, 0.16), FUR_DARK), // ear
      paintColored(box(0.3, 0.1, 0.12, -0.5, 0.05, 0.18), FUR_DARK), // curled tail
      paintColored(box(0.25, 0.08, 0.12, 0.45, 0.04, 0.28), FUR), // front paws
    ];
    this.dogMesh = new InstancedMesh(
      mergeGeometries(dogParts, false),
      new MeshLambertMaterial({ flatShading: true, vertexColors: true }),
      32,
    );
    // Darting cat: lean body, head, pointed ears, raised tail.
    const CAT = new Color('#3a3a3a');
    const catParts = [
      paintColored(box(0.5, 0.22, 0.18, 0, 0.21, 0), CAT), // body
      paintColored(box(0.18, 0.18, 0.18, 0.32, 0.3, 0), CAT), // head
      paintColored(box(0.05, 0.09, 0.04, 0.36, 0.43, -0.05), CAT), // ear
      paintColored(box(0.05, 0.09, 0.04, 0.36, 0.43, 0.05), CAT), // ear
      paintColored(box(0.3, 0.05, 0.05, -0.36, 0.38, 0), CAT), // tail up
      paintColored(box(0.06, 0.12, 0.06, 0.18, 0.06, 0.06), CAT), // legs
      paintColored(box(0.06, 0.12, 0.06, -0.18, 0.06, -0.06), CAT),
    ];
    this.catMesh = new InstancedMesh(
      mergeGeometries(catParts, false),
      new MeshLambertMaterial({ flatShading: true, vertexColors: true }),
      3, // MAX_CATS
    );
    this.catMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.dogMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (const m of [this.dogMesh, this.catMesh, this.cowMesh]) {
      m.frustumCulled = false;
      scene.add(m);
    }

    // Swap the procedural placeholders for real Quaternius animal GLBs (kept
    // instanced via the flatten loader). The GLB's natural +Z forward matches
    // how the renderer faces them, so no extra rotation is baked in.
    swapAnimalGlb(this.dogMesh, 'animals/dog', 0.6, false, this.bend); // single texture
    swapAnimalGlb(this.catMesh, 'animals/cat', 0.35, false, this.bend); // single texture
    swapAnimalGlb(this.cowMesh, 'animals/cow', 1.5, true, this.bend); // 7 flat colours
  }

  render(): void {
    this.life.dogs.forEach((dog, i) => {
      if (i >= 32) return;
      this.corridor.toWorld(dog.s, dog.t, this.pose);
      this.dummy.position.set(this.pose.x, 0, this.pose.z);
      this.dummy.rotation.set(0, (dog.s * 13) % 6, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.dogMesh.setMatrixAt(i, this.dummy.matrix);
    });
    for (let i = this.life.dogs.length; i < 32; i++) this.dogMesh.setMatrixAt(i, HIDDEN);
    this.dogMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < 3; i++) {
      if (!this.life.catActive[i]) {
        this.catMesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      this.corridor.toWorld(this.life.catS[i]!, this.life.catT[i]!, this.pose);
      this.dummy.position.set(this.pose.x, 0, this.pose.z);
      const nx = -this.pose.dirZ;
      const nz = this.pose.dirX;
      this.dummy.rotation.set(0, Math.atan2(nx * this.life.catDir[i]!, nz * this.life.catDir[i]!), 0);
      this.dummy.updateMatrix();
      this.catMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.catMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MAX_COWS; i++) {
      if (this.life.cowState[i] === CowState.Inactive) {
        this.cowMesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      this.corridor.toWorld(this.life.cowS[i]!, this.life.cowT[i]!, this.pose);
      this.dummy.position.set(this.pose.x, 0, this.pose.z);
      // Cows walk toward the player (with the exodus flow).
      this.dummy.rotation.set(0, Math.atan2(-this.pose.dirX, -this.pose.dirZ), 0);
      const gallop =
        this.life.cowState[i] === CowState.Stampede
          ? 1 + Math.abs(Math.sin(this.life.cowS[i]! * 2)) * 0.08
          : 1;
      this.dummy.scale.set(1, gallop, 1);
      this.dummy.updateMatrix();
      this.cowMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.cowMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene: Scene): void {
    for (const m of [this.dogMesh, this.catMesh, this.cowMesh]) {
      scene.remove(m);
      m.geometry.dispose();
      (m.material as MeshLambertMaterial).dispose();
    }
  }
}
