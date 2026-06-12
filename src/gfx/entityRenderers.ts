/**
 * Instanced renderers for dynamic entities beyond the crowd: pocketmars,
 * crossing vehicles, dogs and cats. Each is a small fixed pool.
 */
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPersonGeometry, paintColored } from './meshFactory';
import { applyWalkShader } from './walkShader';
import { MAX_POCKETMARS, PickpocketSystem, PmState } from '@/pickpocket/PickpocketSystem';
import { MAX_VEHICLES, TrafficSystem, VEHICLE_KINDS } from '@/traffic/TrafficSystem';
import { StreetLife } from '@/world/StreetLife';
import type { Corridor, PathPose } from '@/world/Corridor';

const HIDDEN = new Matrix4().compose(
  new Vector3(0, -100, 0),
  new Quaternion(),
  new Vector3(0.001, 0.001, 0.001),
);

export class PickpocketRenderer {
  private mesh: InstancedMesh;
  private phaseAttr: InstancedBufferAttribute;
  private swingAttr: InstancedBufferAttribute;
  private dummy = new Object3D();
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private plain = new Color('#5a5f52'); // blends into the crowd
  private revealed = new Color('#ff5a3c'); // glasses / full suspicion

  constructor(scene: Scene, private pm: PickpocketSystem, private corridor: Corridor) {
    const mat = new MeshLambertMaterial({ flatShading: true });
    applyWalkShader(mat, 'instanced');
    const geo = buildPersonGeometry();
    this.phaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_POCKETMARS), 1);
    this.swingAttr = new InstancedBufferAttribute(new Float32Array(MAX_POCKETMARS), 1);
    this.phaseAttr.setUsage(DynamicDrawUsage);
    this.swingAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('aPhase', this.phaseAttr);
    geo.setAttribute('aSwing', this.swingAttr);
    this.mesh = new InstancedMesh(geo, mat, MAX_POCKETMARS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  render(): void {
    const pm = this.pm;
    for (let i = 0; i < MAX_POCKETMARS; i++) {
      if (pm.state[i] === PmState.Inactive) {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      this.corridor.toWorld(pm.s[i]!, pm.t[i]!, this.pose);
      this.dummy.position.set(this.pose.x, 0, this.pose.z);
      // Disguised walk with the flow; turned/striking face the player's way.
      const facing = pm.state[i] === PmState.Disguised ? -1 : 1;
      this.dummy.rotation.set(0, Math.atan2(this.pose.dirX * facing, this.pose.dirZ * facing), 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.phaseAttr.setX(i, pm.phase[i]!);
      this.swingAttr.setX(i, 0.35);
      // Reveal: glasses show them outright; otherwise suspicion bleeds color
      // in only when fully telegraphed (Striking).
      const reveal =
        pm.glassesActive && pm.innocent[i] === 0
          ? 1
          : pm.state[i] === PmState.Striking
            ? Math.min(1, pm.suspicion[i]!)
            : 0;
      this.mesh.setColorAt(i, reveal > 0 ? this.revealed.clone().lerp(this.plain, 1 - reveal) : this.plain);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.swingAttr.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(scene: Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
  }
}

export class TrafficRenderer {
  private mesh: InstancedMesh;
  private dummy = new Object3D();
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private colors: Color[];

  constructor(scene: Scene, private traffic: TrafficSystem, private corridor: Corridor) {
    // One unit box scaled per vehicle kind — a single draw call for all traffic.
    const geo = new BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    this.mesh = new InstancedMesh(
      paintColored(geo, new Color('#ffffff')),
      new MeshLambertMaterial({ flatShading: true }),
      MAX_VEHICLES,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.colors = VEHICLE_KINDS.map((k) => new Color(k.color));
  }

  render(): void {
    const tr = this.traffic;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (!tr.vActive[i]) {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const kind = VEHICLE_KINDS[tr.vKind[i]!]!;
      // Vehicle space: s = its lateral (width), t = its travel axis (length).
      this.corridor.toWorld(tr.vS[i]!, tr.vT[i]!, this.pose);
      this.dummy.position.set(this.pose.x, 0, this.pose.z);
      // Travel axis is the corridor's lateral normal.
      const nx = -this.pose.dirZ;
      const nz = this.pose.dirX;
      this.dummy.rotation.set(0, Math.atan2(nx * tr.vDir[i]!, nz * tr.vDir[i]!), 0);
      this.dummy.scale.set(kind.width, kind.height, kind.length);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.colors[tr.vKind[i]!]!);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(scene: Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
  }
}

export class StreetLifeRenderer {
  private dogMesh: InstancedMesh;
  private catMesh: InstancedMesh;
  private dummy = new Object3D();
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };

  constructor(scene: Scene, private life: StreetLife, private corridor: Corridor) {
    const dogBody = new BoxGeometry(0.85, 0.3, 0.4);
    dogBody.translate(0, 0.15, 0);
    const dogHead = new BoxGeometry(0.3, 0.25, 0.3);
    dogHead.translate(0.5, 0.2, 0);
    const dogGeo = mergeGeometries(
      [paintColored(dogBody, new Color('#9a7b52')), paintColored(dogHead, new Color('#8a6b42'))],
      false,
    );
    this.dogMesh = new InstancedMesh(
      dogGeo,
      new MeshLambertMaterial({ flatShading: true, vertexColors: true }),
      32,
    );
    const catGeo = new BoxGeometry(0.5, 0.28, 0.2);
    catGeo.translate(0, 0.14, 0);
    this.catMesh = new InstancedMesh(
      paintColored(catGeo, new Color('#3a3a3a')),
      new MeshLambertMaterial({ flatShading: true, vertexColors: true }),
      4,
    );
    this.catMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (const m of [this.dogMesh, this.catMesh]) {
      m.frustumCulled = false;
      scene.add(m);
    }
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
  }

  dispose(scene: Scene): void {
    for (const m of [this.dogMesh, this.catMesh]) {
      scene.remove(m);
      m.geometry.dispose();
      (m.material as MeshLambertMaterial).dispose();
    }
  }
}
