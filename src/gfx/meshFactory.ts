/**
 * Procedural low-poly mesh factory. All art in CakeWalk is generated here —
 * zero external assets. Flat-shaded boxes, vertex colors, Crossy-Road vibe.
 *
 * Person geometry carries two extra vertex attributes consumed by the walk
 * shader (walkShader.ts):
 *   limbId : 0 torso/head, 1 left leg, 2 right leg, 3 left arm, 4 right arm
 *   tint   : 1 = multiply by instance color (clothes), 0 = keep base color
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SKIN = new Color('#c98e63');
const HAIR = new Color('#2b2118');
const PANTS = new Color('#494e57');

interface Part {
  geo: BoxGeometry;
  limbId: number;
  color: Color;
  /** Clothes regions get tint=1 and are recolored per instance. */
  tinted: boolean;
}

function paintPart(part: Part): BufferGeometry {
  const geo = part.geo;
  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  const limb = new Float32Array(count);
  const tint = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = part.color.r;
    colors[i * 3 + 1] = part.color.g;
    colors[i * 3 + 2] = part.color.b;
    limb[i] = part.limbId;
    tint[i] = part.tinted ? 1 : 0;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('limbId', new BufferAttribute(limb, 1));
  geo.setAttribute('tint', new BufferAttribute(tint, 1));
  return geo;
}

/**
 * ~1.7 m tall blocky person, origin at feet. ~180 tris.
 * Clothes (torso, legs upper) are tinted by instance color; skin/hair/pants
 * stay fixed so one instanced mesh still reads as varied people.
 */
export function buildPersonGeometry(): BufferGeometry {
  const parts: Part[] = [];
  const add = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    limbId: number,
    color: Color,
    tinted = false,
  ) => {
    const geo = new BoxGeometry(w, h, d);
    geo.translate(x, y, z);
    parts.push({ geo, limbId, color, tinted });
  };

  // Head + hair cap (limb 0 — bobs with torso).
  add(0.26, 0.26, 0.24, 0, 1.52, 0, 0, SKIN);
  add(0.28, 0.1, 0.26, 0, 1.69, -0.01, 0, HAIR);
  // Torso (shirt — tinted).
  add(0.46, 0.55, 0.26, 0, 1.1, 0, 0, new Color('#ffffff'), true);
  // Legs: upper (pants), lower (pants darker = same), pivot at hip y≈0.82.
  add(0.18, 0.82, 0.2, -0.13, 0.41, 0, 1, PANTS);
  add(0.18, 0.82, 0.2, 0.13, 0.41, 0, 2, PANTS);
  // Arms: shirt sleeves upper + skin hands, pivot at shoulder y≈1.32.
  add(0.12, 0.52, 0.16, -0.3, 1.1, 0, 3, new Color('#ffffff'), true);
  add(0.1, 0.14, 0.14, -0.3, 0.78, 0, 3, SKIN);
  add(0.12, 0.52, 0.16, 0.3, 1.1, 0, 4, new Color('#ffffff'), true);
  add(0.1, 0.14, 0.14, 0.3, 0.78, 0, 4, SKIN);

  const merged = mergeGeometries(parts.map(paintPart), false);
  merged.computeVertexNormals();
  return merged;
}

/** Head-load sack carried by exodus travellers (band HIGH). */
export function buildHeadLoadGeometry(): BufferGeometry {
  const sack = new BoxGeometry(1.05, 0.4, 0.55);
  sack.translate(0, 1.98, 0);
  return paintColored(sack, new Color('#c2a368'));
}

/** Hawker's flat basket. */
export function buildBasketGeometry(): BufferGeometry {
  const basket = new BoxGeometry(0.9, 0.16, 0.9);
  basket.translate(0, 1.86, 0);
  return paintColored(basket, new Color('#a8742f'));
}

/** Trolley bag dragged behind (Eid exodus). */
export function buildLuggageGeometry(): BufferGeometry {
  const bag = new BoxGeometry(0.42, 0.62, 0.3);
  bag.translate(0.42, 0.31, 0.34);
  return paintColored(bag, new Color('#6d3b8e'));
}

export function paintColored(geo: BoxGeometry, color: Color): BufferGeometry {
  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  const limb = new Float32Array(count); // limb 0: bob with body
  const tint = new Float32Array(count); // never instance-tinted
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('limbId', new BufferAttribute(limb, 1));
  geo.setAttribute('tint', new BufferAttribute(tint, 1));
  return geo;
}
