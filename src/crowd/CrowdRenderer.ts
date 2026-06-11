/**
 * Renders the crowd pool as instanced low-poly people with a shader walk
 * cycle. Draw calls: 1 body mesh + 3 prop overlays (head-loads, baskets,
 * luggage) + 1 blob-shadow mesh = 5, regardless of agent count.
 */
import {
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { AgentState, CrowdSystem, MAX_AGENTS } from './CrowdSystem';
import { ARCHETYPES } from './archetypes';
import {
  buildBasketGeometry,
  buildHeadLoadGeometry,
  buildLuggageGeometry,
  buildPersonGeometry,
} from '@/gfx/meshFactory';
import { applyWalkShader } from '@/gfx/walkShader';
import type { Corridor, PathPose } from '@/world/Corridor';

const SHIRTS: Record<string, string[]> = {
  male: ['#4a6fa5', '#7a5c43', '#3e7d5a', '#8a8f98', '#5d4a7a', '#36617a'],
  female: ['#c2577a', '#7a4a9e', '#2e8b8b', '#c27a3d', '#9e3d4a', '#3d7a9e'],
  vendor: ['#b08a3e', '#8f6f2f', '#a0522d'],
  worker: ['#6b705c', '#936639', '#7f4f24'],
};

/** Which overlay prop an archetype carries. */
const PROP: Record<string, 'headLoad' | 'basket' | 'luggage' | undefined> = {
  headLoadCarrier: 'headLoad',
  hawker: 'basket',
  luggageDragger: 'luggage',
};

export class CrowdRenderer {
  private body: InstancedMesh;
  private props: Record<'headLoad' | 'basket' | 'luggage', InstancedMesh>;
  private shadows: InstancedMesh;
  private phaseAttr: InstancedBufferAttribute;
  private swingAttr: InstancedBufferAttribute;
  private dummy = new Object3D();
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private colorCache: Color[][] = [];
  private hidden = new Matrix4().compose(
    new Vector3(0, -100, 0),
    new Quaternion(),
    new Vector3(0.001, 0.001, 0.001),
  );
  private meshes: InstancedMesh[];

  constructor(scene: Scene, private crowd: CrowdSystem, private corridor: Corridor) {
    const bodyMat = new MeshLambertMaterial({ flatShading: true });
    applyWalkShader(bodyMat, 'instanced');
    const geo = buildPersonGeometry();
    this.phaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_AGENTS), 1);
    this.swingAttr = new InstancedBufferAttribute(new Float32Array(MAX_AGENTS), 1);
    this.phaseAttr.setUsage(DynamicDrawUsage);
    this.swingAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('aPhase', this.phaseAttr);
    geo.setAttribute('aSwing', this.swingAttr);
    this.body = new InstancedMesh(geo, bodyMat, MAX_AGENTS);

    const propMat = new MeshLambertMaterial({ flatShading: true, vertexColors: true });
    this.props = {
      headLoad: new InstancedMesh(buildHeadLoadGeometry(), propMat, MAX_AGENTS),
      basket: new InstancedMesh(buildBasketGeometry(), propMat, MAX_AGENTS),
      luggage: new InstancedMesh(buildLuggageGeometry(), propMat, MAX_AGENTS),
    };

    const shadowGeo = new CircleGeometry(0.42, 10);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(
      shadowGeo,
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }),
      MAX_AGENTS,
    );

    this.meshes = [this.body, this.props.headLoad, this.props.basket, this.props.luggage, this.shadows];
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      scene.add(m);
    }

    for (const arch of ARCHETYPES) {
      this.colorCache.push((SHIRTS[arch.palette] ?? SHIRTS.male!).map((c) => new Color(c)));
    }
  }

  render(): void {
    const { crowd } = this;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (crowd.state[i] === AgentState.Inactive) {
        for (const m of this.meshes) m.setMatrixAt(i, this.hidden);
        continue;
      }
      const archIdx = crowd.archetype[i]!;
      const arch = ARCHETYPES[archIdx]!;
      this.corridor.toWorld(crowd.s[i]!, crowd.t[i]!, this.pose);

      this.dummy.position.set(this.pose.x, 0, this.pose.z);
      const facing = crowd.config.flowDirection;
      this.dummy.rotation.set(0, Math.atan2(this.pose.dirX * facing, this.pose.dirZ * facing), 0);
      this.dummy.scale.setScalar(arch.scale);
      this.dummy.updateMatrix();
      this.body.setMatrixAt(i, this.dummy.matrix);

      const prop = PROP[arch.id];
      for (const key of ['headLoad', 'basket', 'luggage'] as const) {
        this.props[key].setMatrixAt(i, prop === key ? this.dummy.matrix : this.hidden);
      }

      // Shadow hugs the ground, ignores body scale wobble.
      this.dummy.position.y = 0.02;
      this.dummy.updateMatrix();
      this.shadows.setMatrixAt(i, this.dummy.matrix);

      this.phaseAttr.setX(i, crowd.phase[i]!);
      const moving = crowd.speed[i]! > 0.05;
      this.swingAttr.setX(
        i,
        crowd.state[i] === AgentState.Panicked ? 0.55 : moving ? 0.35 : 0.04,
      );

      const colors = this.colorCache[archIdx]!;
      this.body.setColorAt(i, colors[crowd.variant[i]! % colors.length]!);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.swingAttr.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }

  dispose(scene: Scene): void {
    for (const m of this.meshes) {
      scene.remove(m);
      m.geometry.dispose();
      (m.material as MeshLambertMaterial).dispose();
    }
  }
}
