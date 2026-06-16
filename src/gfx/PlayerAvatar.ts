/**
 * The player's visible body. Loads a rigged, animated CC0 character GLB
 * (public/models/character-hero.glb) and crossfades its Walking / Running /
 * Jump / Sitting / Idle clips to match the sim state. Until the model streams
 * in — or if it fails to load — a procedural person stands in, so the game is
 * never bodyless and works offline.
 */
import {
  AnimationAction,
  AnimationMixer,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  Scene,
} from 'three';
import { buildPersonGeometry } from './meshFactory';
import { applyWalkShader } from './walkShader';
import { loadCharacterModel, PEOPLE_MODELS, type ClipRole } from './models';
import { bendObject, type BendUniforms } from './worldBend';
import { Player, Pose } from '@/player/Player';
import type { Corridor, PathPose } from '@/world/Corridor';

/** Player stands ~1.7 m tall in world units. */
const AVATAR_HEIGHT = 1.7;
/** The player's GLB — same Quaternius roster the crowd draws from, so the
 *  whole cast is one art style. PEOPLE_MODELS[0] is the default. */
const PLAYER_MODEL = PEOPLE_MODELS[0];

/** Recolor the clothes (tint=1) region of a person geometry in place. */
export function tintClothes(geo: BufferGeometry, color: Color): void {
  const tint = geo.getAttribute('tint');
  const colors = geo.getAttribute('color');
  for (let i = 0; i < tint.count; i++) {
    if (tint.getX(i) === 1) {
      colors.setXYZ(i, color.r, color.g, color.b);
    }
  }
  colors.needsUpdate = true;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class PlayerAvatar {
  readonly group = new Group();
  /** Inner holder that carries dip-tilt / duck-squash / jump-lift, leaving the
   *  group free for world position + facing. */
  private holder = new Group();
  private uniforms: {
    uPhase: { value: number };
    uSwing: { value: number };
    uSit: { value: number };
  };
  /** Procedural fallback body (shown until/unless the GLB is ready). */
  private proc: Mesh;
  private shadow: Mesh;
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };
  private readonly accent: Color;
  private readonly bend?: BendUniforms;

  // GLB state (populated once the model resolves).
  private rig: Object3D | null = null;
  /** Lower-spine bone — leaned so dips/duck bend only the upper body. */
  private spine: Object3D | null = null;
  private leanZ = 0; // eased side-lean (dip) applied to the spine
  private duckX = 0; // eased forward-bend (duck) applied to the spine
  private mixer: AnimationMixer | null = null;
  private actions: Partial<Record<ClipRole, AnimationAction>> = {};
  private current: ClipRole | null = null;
  /** Per-instance cloned GLB materials — the only GLB resources we own/dispose
   *  (geometry + the source's materials belong to the shared cache). */
  private owned: MeshStandardMaterial[] = [];

  constructor(scene: Scene, outfitColor = '#e8a33d', bend?: BendUniforms) {
    this.accent = new Color(outfitColor);
    this.bend = bend;
    this.group.add(this.holder);

    const geo = buildPersonGeometry();
    tintClothes(geo, this.accent);
    const mat = new MeshLambertMaterial({ flatShading: true });
    this.uniforms = applyWalkShader(mat, 'single').uniforms;
    this.proc = new Mesh(geo, mat);
    this.holder.add(this.proc);

    const shadowGeo = new CircleGeometry(0.42, 10);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new Mesh(
      shadowGeo,
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
    );
    this.group.add(this.shadow);
    scene.add(this.group);

    void this.loadRig();
  }

  private async loadRig(): Promise<void> {
    const model = await loadCharacterModel(PLAYER_MODEL);
    if (!model) return; // keep the procedural fallback
    const { root } = model.spawn(AVATAR_HEIGHT);

    // Recolour the shirt toward the equipped-outfit accent so cosmetics read,
    // cloning every material so we never mutate the shared cached source. Track
    // the clones so dispose() frees only these (never the shared geometry or
    // the source's materials).
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const m = mesh.material;
      if (m instanceof MeshStandardMaterial) {
        const c = m.clone();
        if (/shirt/i.test(m.name)) c.color.copy(this.accent);
        mesh.material = c;
        this.owned.push(c);
      }
    });
    if (this.bend) bendObject(root, this.bend);

    this.rig = root;
    // Lower-spine bone for upper-body lean (Quaternius HumanArmature naming,
    // with fallbacks for other rigs).
    this.spine =
      root.getObjectByName('Abdomen') ??
      root.getObjectByName('Spine') ??
      root.getObjectByName('Torso') ??
      null;
    this.holder.add(root);
    this.proc.visible = false;

    this.mixer = new AnimationMixer(root);
    for (const role of ['idle', 'walk', 'run', 'jump', 'sit'] as ClipRole[]) {
      const clip = model.clip(role);
      if (clip) this.actions[role] = this.mixer.clipAction(clip);
    }
    this.play('idle', 0);
  }

  /** Crossfade to a role's clip (no-op if already current or missing). */
  private play(role: ClipRole, fade = 0.25): void {
    if (!this.mixer || this.current === role) return;
    const next = this.actions[role];
    if (!next) return;
    next.reset().fadeIn(fade).play();
    const prev = this.current ? this.actions[this.current] : undefined;
    if (prev && prev !== next) prev.fadeOut(fade);
    this.current = role;
  }

  /**
   * @param s,t interpolated path position for this frame.
   * @param sitTarget when resting: world bench point + facing yaw — the
   *        avatar eases over, turns to face the street, and folds into a sit.
   */
  update(
    player: Player,
    s: number,
    t: number,
    corridor: Corridor,
    sitTarget: { x: number; z: number; yaw: number } | null = null,
    frameDt = 1 / 60,
  ): void {
    corridor.toWorld(s, t, this.pose);
    const sitting = sitTarget !== null;
    // Ease the sit pose in/out (procedural shader folds the legs as uSit rises).
    const target = sitting ? 1 : 0;
    this.uniforms.uSit.value += (target - this.uniforms.uSit.value) * Math.min(1, frameDt * 7);
    if (this.uniforms.uSit.value < 0.01) this.uniforms.uSit.value = 0;

    if (sitting) {
      const k = Math.min(1, frameDt * 6);
      this.group.position.x += (sitTarget.x - this.group.position.x) * k;
      this.group.position.z += (sitTarget.z - this.group.position.z) * k;
      this.group.rotation.y = lerpAngle(this.group.rotation.y, sitTarget.yaw, k);
    } else {
      this.group.position.set(this.pose.x, 0, this.pose.z);
      // Face along +s (the player's walking direction).
      this.group.rotation.y = Math.atan2(this.pose.dirX, this.pose.dirZ);
    }

    // Jump-lift applies to both body variants.
    this.holder.position.y = player.y;
    const dipL = player.pose === Pose.DipLeft;
    const dipR = player.pose === Pose.DipRight;
    const duck = player.pose === Pose.Duck;
    // Ease the upper-body lean/bend targets (applied to the spine bone below for
    // the GLB; to the whole holder for the procedural fallback).
    const k = Math.min(1, frameDt * 12);
    this.leanZ += ((dipL ? 0.42 : dipR ? -0.42 : 0) - this.leanZ) * k;
    this.duckX += ((duck ? 0.8 : 0) - this.duckX) * k;
    if (this.rig) {
      this.holder.rotation.z = 0;
      this.holder.scale.y = 1;
    } else {
      this.holder.rotation.z = dipL ? 0.24 : dipR ? -0.24 : 0;
      this.holder.scale.y = duck ? 0.6 : 1;
    }

    this.shadow.position.y = 0.02;
    this.shadow.scale.setScalar(1 - player.y * 0.3);

    // Procedural fallback walk cycle.
    this.uniforms.uPhase.value = player.walkPhase;
    this.uniforms.uSwing.value =
      player.resting || player.phoneLocked ? 0 : player.speed > 0.2 ? 0.38 : 0.05;

    // GLB clip selection + playback.
    if (this.mixer && this.rig) {
      const role: ClipRole = sitting
        ? 'sit'
        : player.y > 0.05
          ? 'jump'
          : player.phoneLocked || player.speed < 0.2
            ? 'idle'
            : player.speed > 4.6
              ? 'run'
              : 'walk';
      this.play(role);
      // Sync stride to ground speed so feet don't skate (clips authored at a
      // nominal pace; scale around it, clamped so it never looks frantic).
      const moving = role === 'walk' || role === 'run';
      const nominal = role === 'run' ? 6.2 : 3.0;
      const act = this.actions[role];
      if (act) act.timeScale = moving ? Math.min(1.8, Math.max(0.5, player.speed / nominal)) : 1;
      this.mixer.update(frameDt);
      // After the clip poses the skeleton, add the upper-body lean on top so a
      // dip/duck bends the torso (not the whole body at 45°).
      if (this.spine) {
        this.spine.rotation.z += this.leanZ;
        this.spine.rotation.x += this.duckX;
      }
    }
  }

  dispose(scene: Scene): void {
    scene.remove(this.group);
    this.mixer?.stopAllAction();
    // Free only our per-instance cloned materials. The GLB geometry and the
    // source's materials are shared via the cache and must outlive this run.
    for (const m of this.owned) m.dispose();
    this.proc.geometry.dispose();
    (this.proc.material as MeshLambertMaterial).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as MeshBasicMaterial).dispose();
  }
}
