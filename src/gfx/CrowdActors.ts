/**
 * Renders the crowd as animated Quaternius people — the SAME GLB humans the
 * player is, so the whole cast shares one cohesive art style (no procedural
 * beans, nothing that pops between styles).
 *
 * Performance: a fixed pool of skinned actors (default ~26) is bound each frame
 * to the crowd agents nearest the player — the only ones the camera sees. Far
 * agents still exist in the sim (collisions etc.) but aren't drawn. Each pool
 * slot keeps a fixed model variant + clothing tint so its look is stable; a
 * slot only changes identity when it re-binds to a new agent at the far edge of
 * view, where it isn't noticeable.
 */
import {
  AnimationAction,
  AnimationMixer,
  BufferGeometry,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { loadPeople, loadVehicleModel, type ClipRole, type SkinnedModel } from './models';
import { applyWorldBend, bendObject, type BendUniforms } from './worldBend';
import type { CrowdSystem } from '@/crowd/CrowdSystem';
import { AgentState, MAX_AGENTS } from '@/crowd/CrowdSystem';
import { ARCHETYPES } from '@/crowd/archetypes';
import type { Corridor, PathPose } from '@/world/Corridor';

const PERSON_HEIGHT = 1.7;
/** Draw band ahead of the player. Starts ~2 m out so a crowd actor never lands
 *  on the player's own position and occludes the player avatar. */
const NEAR = 2.0;
const FAR = 34;
/** Bright clothing tints for crowd variety. */
const TINTS = [
  '#4f8fe8', '#ff8a5b', '#3ecf8e', '#b48aff', '#ffd24d', '#ff6f9e',
  '#46c4d6', '#e8527a', '#5aa9ff', '#9a6bff', '#2fc4b2', '#ff9d3d',
  '#8fa05c', '#c98a4a',
];

interface Slot {
  wrapper: Group;
  mixer: AnimationMixer;
  actions: Partial<Record<ClipRole, AnimationAction>>;
  current: ClipRole | null;
  shadow: Mesh;
  agent: number;
  phase: number;
}

export class CrowdActors {
  private holder = new Group();
  private slots: Slot[] = [];
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private ready = false;
  private disposed = false;
  // Reused scratch to avoid per-frame allocation in the render hot path.
  private candIdx: number[] = [];
  private candDist: number[] = [];
  private chosen = new Int8Array(MAX_AGENTS);
  private bound = new Int8Array(MAX_AGENTS);
  /** Per-instance cloned materials — the only material resources we own. */
  private owned: Material[] = [];
  // Carried loads, drawn as two instanced meshes on the agents that carry them:
  // head boxes (duck under, HIGH band) and ground crates (jump over, LOW band).
  private headProp: InstancedMesh | null = null;
  private groundProp: InstancedMesh | null = null;
  private propM = new Matrix4();
  private propQ = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private propPos = new Vector3();
  private propScl = new Vector3();
  private ownedGeo: BufferGeometry[] = [];

  constructor(
    private scene: Scene,
    private crowd: CrowdSystem,
    private corridor: Corridor,
    private count = 26,
    private bend?: BendUniforms,
  ) {
    scene.add(this.holder);
    void this.load();
  }

  private async load(): Promise<void> {
    const models = (await loadPeople()).filter((m): m is SkinnedModel => m !== null);
    if (!models.length || this.disposed) return; // bailed out during the fetch
    const shadowGeo = new CircleGeometry(0.32, 10);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2 });

    for (let i = 0; i < this.count; i++) {
      const model = models[i % models.length]!;
      const { root } = model.spawn(PERSON_HEIGHT);
      const tint = new Color(TINTS[i % TINTS.length]);
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material;
        if (m instanceof MeshStandardMaterial) {
          // Recolour the shirt for variety; clone every material so we never
          // mutate the shared cached source, and track the clone so dispose()
          // frees only what we own.
          const c = m.clone();
          if (/shirt/i.test(m.name)) c.color.copy(tint);
          mesh.material = c;
          this.owned.push(c);
        }
      });
      if (this.bend) bendObject(root, this.bend);

      const wrapper = new Group();
      wrapper.add(root);
      wrapper.visible = false;
      this.holder.add(wrapper);

      const mixer = new AnimationMixer(root);
      const actions: Partial<Record<ClipRole, AnimationAction>> = {};
      for (const role of ['idle', 'walk', 'run'] as ClipRole[]) {
        const clip = model.clip(role);
        if (clip) actions[role] = mixer.clipAction(clip);
      }
      const shadow = new Mesh(shadowGeo, shadowMat);
      shadow.visible = false;
      this.holder.add(shadow);

      this.slots.push({ wrapper, mixer, actions, current: null, shadow, agent: -1, phase: Math.random() * 2 });
    }

    this.headProp = await this.makeProp('props/boxes', true, 0.6);
    this.groundProp = await this.makeProp('props/crate', false, 0.85);
    this.ready = true;
  }

  /** Build an instanced carried-load mesh from a flattened prop GLB, scaled to
   *  `size` metres and world-bent. Capacity = pool size (only a few show). */
  private async makeProp(name: string, flat: boolean, size: number): Promise<InstancedMesh | null> {
    const model = await loadVehicleModel(name, flat);
    if (!model || this.disposed) return null;
    const geo = model.geometry.clone();
    geo.scale(size, size, size); // normalised length 1 → real size, grounded
    const mat = (model.material as Material).clone();
    if (this.bend) applyWorldBend(mat, this.bend);
    const mesh = new InstancedMesh(geo, mat, this.count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.ownedGeo.push(geo);
    this.owned.push(mat);
    this.holder.add(mesh);
    return mesh;
  }

  private play(slot: Slot, role: ClipRole, fade = 0.2): void {
    if (slot.current === role) return;
    const next = slot.actions[role];
    if (!next) return;
    next.reset().fadeIn(fade).play();
    const prev = slot.current ? slot.actions[slot.current] : undefined;
    if (prev && prev !== next) prev.fadeOut(fade);
    slot.current = role;
  }

  /** Bind the nearest agents to slots and drive their pose + animation. */
  update(playerS: number, frameDt: number): void {
    if (!this.ready) return;
    const { crowd } = this;

    // Gather in-band agents nearest-first (reused scratch arrays, simple
    // insertion into the small `count`-sized nearest list).
    this.candIdx.length = 0;
    this.candDist.length = 0;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (crowd.state[i] === AgentState.Inactive) continue;
      const d = crowd.s[i]! - playerS;
      if (d < NEAR || d > FAR) continue;
      this.candIdx.push(i);
      this.candDist.push(Math.abs(d));
    }
    // Partial selection of the `count` nearest (count is small; a light
    // selection sort over just the needed prefix is cheap and allocation-free).
    const n = this.candIdx.length;
    const take = Math.min(this.count, n);
    for (let a = 0; a < take; a++) {
      let min = a;
      for (let b = a + 1; b < n; b++) if (this.candDist[b]! < this.candDist[min]!) min = b;
      if (min !== a) {
        const td = this.candDist[a]!; this.candDist[a] = this.candDist[min]!; this.candDist[min] = td;
        const ti = this.candIdx[a]!; this.candIdx[a] = this.candIdx[min]!; this.candIdx[min] = ti;
      }
    }
    this.chosen.fill(0);
    for (let a = 0; a < take; a++) this.chosen[this.candIdx[a]!] = 1;

    // Release slots whose agent left the chosen set; track which agents stay
    // bound so we don't double-assign (allocation-free via the `bound` flags).
    this.bound.fill(0);
    for (const slot of this.slots) {
      if (slot.agent >= 0 && this.chosen[slot.agent] !== 1) slot.agent = -1;
      if (slot.agent >= 0) this.bound[slot.agent] = 1;
    }
    // Assign chosen agents that aren't already bound to a free slot.
    let s = 0;
    for (let a = 0; a < take; a++) {
      const i = this.candIdx[a]!;
      if (this.bound[i] === 1) continue;
      while (s < this.slots.length && this.slots[s]!.agent >= 0) s++;
      if (s >= this.slots.length) break;
      this.slots[s]!.agent = i;
      this.bound[i] = 1;
    }

    const facing = crowd.config.flowDirection;
    let hCount = 0;
    let gCount = 0;
    for (const slot of this.slots) {
      if (slot.agent < 0) {
        slot.wrapper.visible = false;
        slot.shadow.visible = false;
        continue;
      }
      const i = slot.agent;
      this.corridor.toWorld(crowd.s[i]!, crowd.t[i]!, this.pose);
      const arch = ARCHETYPES[crowd.archetype[i]!]!;
      const yaw = Math.atan2(this.pose.dirX * facing, this.pose.dirZ * facing);
      slot.wrapper.visible = true;
      slot.wrapper.position.set(this.pose.x, 0, this.pose.z);
      slot.wrapper.rotation.set(0, yaw, 0);
      slot.wrapper.scale.setScalar(arch.scale);
      slot.shadow.visible = true;
      slot.shadow.position.set(this.pose.x, 0.02, this.pose.z);

      // Carried load on the matching archetype: a box stack on the head
      // (duck/dip under) or a crate at their feet (jump over).
      if (arch.id === 'headLoadCarrier' && this.headProp) {
        this.propQ.setFromAxisAngle(this.up, yaw);
        this.propPos.set(this.pose.x, 1.72 * arch.scale, this.pose.z);
        this.propScl.setScalar(arch.scale);
        this.propM.compose(this.propPos, this.propQ, this.propScl);
        this.headProp.setMatrixAt(hCount++, this.propM);
      } else if (arch.id === 'luggageDragger' && this.groundProp) {
        this.propQ.setFromAxisAngle(this.up, yaw);
        this.propPos.set(this.pose.x, 0, this.pose.z);
        this.propScl.setScalar(arch.scale);
        this.propM.compose(this.propPos, this.propQ, this.propScl);
        this.groundProp.setMatrixAt(gCount++, this.propM);
      }

      const speed = crowd.speed[i]!;
      const role: ClipRole = speed < 0.15 ? 'idle' : speed > 2.4 ? 'run' : 'walk';
      this.play(slot, role);
      const act = slot.actions[role];
      if (act) act.timeScale = role === 'idle' ? 1 : Math.min(1.7, Math.max(0.6, speed / 1.4));
      slot.mixer.update(frameDt * (1 + slot.phase * 0.03));
    }
    if (this.headProp) {
      this.headProp.count = hCount;
      this.headProp.instanceMatrix.needsUpdate = true;
    }
    if (this.groundProp) {
      this.groundProp.count = gCount;
      this.groundProp.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.scene.remove(this.holder);
    for (const slot of this.slots) slot.mixer.stopAllAction();
    // Free only the per-slot cloned materials we own; the GLB geometry and the
    // source's materials are shared via the cache and must outlive this run.
    for (const m of this.owned) m.dispose();
    this.owned = [];
    // The prop geometries are our own scaled clones — free them.
    for (const g of this.ownedGeo) g.dispose();
    this.ownedGeo = [];
    if (this.slots[0]) {
      this.slots[0].shadow.geometry.dispose();
      (this.slots[0].shadow.material as MeshBasicMaterial).dispose();
    }
    this.slots = [];
  }
}
