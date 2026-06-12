/**
 * Bobbing billboard above the nearest cha dokan / bus stop while the player
 * is in sitting range — the visual cue that the 🪑 button will work here.
 */
import { CanvasTexture, Scene, Sprite, SpriteMaterial } from 'three';

function emojiTexture(emoji: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  // Soft round backing so it reads against any street.
  g.fillStyle = 'rgba(20,14,6,0.78)';
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#e8a33d';
  g.lineWidth = 6;
  g.stroke();
  g.font = '64px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 64, 70);
  return new CanvasTexture(canvas);
}

export class RestMarker {
  private chaSprite: Sprite;
  private benchSprite: Sprite;
  private time = 0;

  constructor(scene: Scene) {
    this.chaSprite = new Sprite(
      new SpriteMaterial({ map: emojiTexture('☕'), depthTest: false, transparent: true }),
    );
    this.benchSprite = new Sprite(
      new SpriteMaterial({ map: emojiTexture('🪑'), depthTest: false, transparent: true }),
    );
    for (const s of [this.chaSprite, this.benchSprite]) {
      s.scale.set(1.5, 1.5, 1);
      s.visible = false;
      s.renderOrder = 5;
      scene.add(s);
    }
  }

  update(
    frameDt: number,
    target: { kind: 'chaDokan' | 'busStop'; x: number; z: number } | null,
  ): void {
    this.time += frameDt;
    this.chaSprite.visible = target?.kind === 'chaDokan';
    this.benchSprite.visible = target?.kind === 'busStop';
    if (!target) return;
    const sprite = target.kind === 'chaDokan' ? this.chaSprite : this.benchSprite;
    sprite.position.set(target.x, 3.1 + Math.sin(this.time * 3.5) * 0.18, target.z);
  }

  dispose(scene: Scene): void {
    for (const s of [this.chaSprite, this.benchSprite]) {
      scene.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
  }
}
