/**
 * Pocketmars rendered as the SAME animated Quaternius people as the crowd — so
 * they truly blend in (that's the whole point: you can't tell who's a thief).
 * A fixed pool, one skinned actor per pocketmar index, so identity is stable
 * while you track and stare one down. When a thief is telegraphed (turned /
 * striking, or revealed by glasses) its shirt bleeds red.
 */
import {
  AnimationAction,
  AnimationMixer,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
} from 'three';
import { loadPeople, type SkinnedModel } from './models';
import { bendObject, type BendUniforms } from './worldBend';
import { MAX_POCKETMARS, PickpocketSystem, PmState } from '@/pickpocket/PickpocketSystem';
import type { Corridor, PathPose } from '@/world/Corridor';

const HEIGHT = 1.7;
const PLAIN = new Color('#6a6f60'); // blends into the crowd
const REVEALED = new Color('#ff5a3c'); // telegraphed / glasses-revealed

interface Slot {
  wrapper: Group;
  mixer: AnimationMixer;
  walk: AnimationAction | null;
  shirts: MeshStandardMaterial[];
  shadow: Mesh;
}

export class PickpocketRenderer {
  private holder = new Group();
  private slots: Slot[] = [];
  private owned: MeshStandardMaterial[] = [];
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private ready = false;
  private disposed = false;
  private tmp = new Color();

  constructor(
    scene: Scene,
    private pm: PickpocketSystem,
    private corridor: Corridor,
    private bend?: BendUniforms,
  ) {
    scene.add(this.holder);
    void this.load();
  }

  private async load(): Promise<void> {
    const models = (await loadPeople()).filter((m): m is SkinnedModel => m !== null);
    if (!models.length || this.disposed) return; // bailed out during the fetch
    const shadowGeo = new CircleGeometry(0.34, 10);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });

    for (let i = 0; i < MAX_POCKETMARS; i++) {
      const model = models[i % models.length]!;
      const { root } = model.spawn(HEIGHT);
      const shirts: MeshStandardMaterial[] = [];
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material;
        if (m instanceof MeshStandardMaterial) {
          const c = m.clone();
          mesh.material = c;
          this.owned.push(c);
          if (/shirt/i.test(m.name)) shirts.push(c);
        }
      });
      if (this.bend) bendObject(root, this.bend);

      const wrapper = new Group();
      wrapper.add(root);
      wrapper.visible = false;
      this.holder.add(wrapper);

      const mixer = new AnimationMixer(root);
      const walkClip = model.clip('walk');
      const walk = walkClip ? mixer.clipAction(walkClip) : null;
      walk?.play();

      const shadow = new Mesh(shadowGeo, shadowMat);
      shadow.visible = false;
      this.holder.add(shadow);

      this.slots.push({ wrapper, mixer, walk, shirts, shadow });
    }
    this.ready = true;
  }

  render(frameDt = 1 / 60): void {
    if (!this.ready) return;
    const pm = this.pm;
    for (let i = 0; i < MAX_POCKETMARS; i++) {
      const slot = this.slots[i]!;
      if (pm.state[i] === PmState.Inactive) {
        slot.wrapper.visible = false;
        slot.shadow.visible = false;
        continue;
      }
      this.corridor.toWorld(pm.s[i]!, pm.t[i]!, this.pose);
      // Disguised thieves walk with the flow; turned/striking face the player.
      const facing = pm.state[i] === PmState.Disguised ? -1 : 1;
      slot.wrapper.visible = true;
      slot.wrapper.position.set(this.pose.x, 0, this.pose.z);
      slot.wrapper.rotation.set(0, Math.atan2(this.pose.dirX * facing, this.pose.dirZ * facing), 0);
      slot.shadow.visible = true;
      slot.shadow.position.set(this.pose.x, 0.02, this.pose.z);

      // Reveal: glasses expose real thieves outright; otherwise suspicion bleeds
      // colour in only when fully telegraphed (Striking).
      const reveal =
        pm.glassesActive && pm.innocent[i] === 0
          ? 1
          : pm.state[i] === PmState.Striking
            ? Math.min(1, pm.suspicion[i]!)
            : 0;
      this.tmp.copy(reveal > 0 ? REVEALED : PLAIN);
      if (reveal > 0 && reveal < 1) this.tmp.lerp(PLAIN, 1 - reveal);
      for (const s of slot.shirts) s.color.copy(this.tmp);

      slot.walk && (slot.walk.timeScale = 1);
      slot.mixer.update(frameDt);
    }
  }

  dispose(scene: Scene): void {
    this.disposed = true;
    scene.remove(this.holder);
    for (const slot of this.slots) slot.mixer.stopAllAction();
    for (const m of this.owned) m.dispose();
    this.owned = [];
    if (this.slots[0]) {
      this.slots[0].shadow.geometry.dispose();
      (this.slots[0].shadow.material as MeshBasicMaterial).dispose();
    }
    this.slots = [];
  }
}
