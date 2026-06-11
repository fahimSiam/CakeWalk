/**
 * Renders the crowd pool as InstancedMeshes. M1 uses simple box bodies with
 * per-instance color + walk bob; M2 swaps the geometry for proper low-poly
 * people with a shader walk cycle — the sim never changes.
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
import { AgentState, CrowdSystem, MAX_AGENTS } from './CrowdSystem';
import { ARCHETYPES, Band } from './archetypes';
import type { Corridor, PathPose } from '@/world/Corridor';

const PALETTES: Record<string, string[]> = {
  male: ['#4a6fa5', '#7a5c43', '#3e7d5a', '#8a8f98', '#5d4a7a'],
  female: ['#c2577a', '#7a4a9e', '#2e8b8b', '#c27a3d', '#9e3d4a'],
  vendor: ['#b08a3e', '#8f6f2f', '#a0522d'],
  worker: ['#6b705c', '#936639', '#7f4f24'],
};

export class CrowdRenderer {
  private mesh: InstancedMesh;
  private loadMesh: InstancedMesh; // head-loads / baskets / luggage overlays
  private dummy = new Object3D();
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private colorCache: Color[][] = [];
  private hidden = new Matrix4().compose(
    new Vector3(0, -100, 0),
    new Quaternion(),
    new Vector3(0.001, 0.001, 0.001),
  );

  constructor(scene: Scene, private crowd: CrowdSystem, private corridor: Corridor) {
    const body = new BoxGeometry(0.55, 1.65, 0.35);
    body.translate(0, 0.825, 0);
    this.mesh = new InstancedMesh(body, new MeshLambertMaterial({ flatShading: true }), MAX_AGENTS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    const load = new BoxGeometry(1.0, 0.35, 0.5);
    load.translate(0, 1.95, 0);
    this.loadMesh = new InstancedMesh(
      load,
      new MeshLambertMaterial({ flatShading: true, color: '#caa472' }),
      MAX_AGENTS,
    );
    this.loadMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.loadMesh.frustumCulled = false;
    scene.add(this.loadMesh);

    for (const arch of ARCHETYPES) {
      this.colorCache.push((PALETTES[arch.palette] ?? PALETTES.male!).map((c) => new Color(c)));
    }
  }

  render(): void {
    const { crowd } = this;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (crowd.state[i] === AgentState.Inactive) {
        this.mesh.setMatrixAt(i, this.hidden);
        this.loadMesh.setMatrixAt(i, this.hidden);
        continue;
      }
      const archIdx = crowd.archetype[i]!;
      const arch = ARCHETYPES[archIdx]!;
      this.corridor.toWorld(crowd.s[i]!, crowd.t[i]!, this.pose);

      const bob = Math.abs(Math.sin(crowd.phase[i]!)) * 0.06;
      this.dummy.position.set(this.pose.x, bob, this.pose.z);
      // Crowd faces its flow direction (default: toward the player → +s is
      // the player's forward, so they face -dir).
      const facing = crowd.config.flowDirection;
      this.dummy.rotation.set(0, Math.atan2(this.pose.dirX * facing, this.pose.dirZ * facing), 0);
      this.dummy.scale.setScalar(arch.scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      if (arch.band === Band.HIGH || arch.id === 'hawker') {
        this.loadMesh.setMatrixAt(i, this.dummy.matrix);
      } else {
        this.loadMesh.setMatrixAt(i, this.hidden);
      }

      const colors = this.colorCache[archIdx]!;
      this.mesh.setColorAt(i, colors[crowd.variant[i]! % colors.length]!);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.loadMesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(scene: Scene): void {
    scene.remove(this.mesh, this.loadMesh);
    this.mesh.geometry.dispose();
    this.loadMesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    (this.loadMesh.material as MeshLambertMaterial).dispose();
  }
}
