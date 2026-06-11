/**
 * The player's visible body: same procedural person geometry as the crowd,
 * walk cycle driven by uniforms, pose (dips/duck/jump) applied as transforms.
 */
import {
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Scene,
} from 'three';
import { buildPersonGeometry } from './meshFactory';
import { applyWalkShader } from './walkShader';
import { Player, Pose } from '@/player/Player';
import type { Corridor, PathPose } from '@/world/Corridor';

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

export class PlayerAvatar {
  readonly group = new Group();
  private uniforms: { uPhase: { value: number }; uSwing: { value: number } };
  private body: Mesh;
  private shadow: Mesh;
  private pose: PathPose = { x: 0, z: 0, dirX: 0, dirZ: -1 };

  constructor(scene: Scene, outfitColor = '#e8a33d') {
    const geo = buildPersonGeometry();
    tintClothes(geo, new Color(outfitColor));
    const mat = new MeshLambertMaterial({ flatShading: true });
    this.uniforms = applyWalkShader(mat, 'single').uniforms;
    this.body = new Mesh(geo, mat);
    this.group.add(this.body);

    const shadowGeo = new CircleGeometry(0.42, 10);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new Mesh(
      shadowGeo,
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
    );
    this.group.add(this.shadow);
    scene.add(this.group);
  }

  /** @param s,t interpolated path position for this frame. */
  update(player: Player, s: number, t: number, corridor: Corridor): void {
    corridor.toWorld(s, t, this.pose);
    this.group.position.set(this.pose.x, 0, this.pose.z);
    // Face along +s (the player's walking direction).
    this.group.rotation.y = Math.atan2(this.pose.dirX, this.pose.dirZ);

    this.body.position.y = player.y;
    this.shadow.position.y = 0.02;
    this.shadow.scale.setScalar(1 - player.y * 0.3);

    this.body.rotation.z =
      player.pose === Pose.DipLeft ? 0.24 : player.pose === Pose.DipRight ? -0.24 : 0;
    this.body.scale.y = player.pose === Pose.Duck ? 0.6 : 1;

    this.uniforms.uPhase.value = player.walkPhase;
    this.uniforms.uSwing.value = player.resting || player.phoneLocked ? 0 : player.speed > 0.2 ? 0.38 : 0.05;
  }

  dispose(scene: Scene): void {
    scene.remove(this.group);
    this.body.geometry.dispose();
    (this.body.material as MeshLambertMaterial).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as MeshBasicMaterial).dispose();
  }
}
