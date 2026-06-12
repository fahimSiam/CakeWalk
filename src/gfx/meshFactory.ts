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
 * ~1.7 m tall cartoon person (Sims-ish proportions: big head, expressive
 * face), origin at feet. Clothes (torso, sleeves) are tinted by instance
 * color; skin/hair/pants stay fixed so one instanced mesh still reads as
 * varied people. Mesh forward is +Z.
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

  const WHITE = new Color('#ffffff');
  const EYE_WHITE = new Color('#f4f0e8');
  const PUPIL = new Color('#221a12');
  const MOUTH = new Color('#9a5a48');

  // --- Head (cartoon-big) + neck, limb 0 (bobs with torso) ---
  add(0.36, 0.34, 0.32, 0, 1.5, 0, 0, SKIN); // head
  add(0.14, 0.08, 0.14, 0, 1.3, 0, 0, SKIN); // neck
  // Hair: cap + back + sideburns frame the face.
  add(0.39, 0.12, 0.35, 0, 1.69, -0.01, 0, HAIR);
  add(0.38, 0.26, 0.08, 0, 1.55, -0.16, 0, HAIR);
  add(0.05, 0.16, 0.3, -0.185, 1.58, -0.02, 0, HAIR);
  add(0.05, 0.16, 0.3, 0.185, 1.58, -0.02, 0, HAIR);
  // Ears.
  add(0.04, 0.09, 0.07, -0.2, 1.49, 0.0, 0, SKIN);
  add(0.04, 0.09, 0.07, 0.2, 1.49, 0.0, 0, SKIN);
  // Face: white eyes with pupils, brows, nose, mouth.
  add(0.09, 0.07, 0.02, -0.085, 1.54, 0.165, 0, EYE_WHITE);
  add(0.09, 0.07, 0.02, 0.085, 1.54, 0.165, 0, EYE_WHITE);
  add(0.04, 0.045, 0.025, -0.075, 1.535, 0.168, 0, PUPIL);
  add(0.04, 0.045, 0.025, 0.075, 1.535, 0.168, 0, PUPIL);
  add(0.1, 0.025, 0.02, -0.085, 1.6, 0.165, 0, HAIR); // brows
  add(0.1, 0.025, 0.02, 0.085, 1.6, 0.165, 0, HAIR);
  add(0.05, 0.07, 0.05, 0, 1.46, 0.17, 0, SKIN); // nose
  add(0.11, 0.03, 0.02, 0, 1.39, 0.165, 0, MOUTH);

  // --- Torso (shirt — tinted), slightly tapered look via two stacked boxes ---
  add(0.46, 0.34, 0.26, 0, 1.1, 0, 0, WHITE, true);
  add(0.42, 0.22, 0.24, 0, 0.84, 0, 0, WHITE, true);

  // --- Legs (pants), pivot at hip y≈0.78 ---
  add(0.17, 0.74, 0.2, -0.12, 0.37, 0, 1, PANTS);
  add(0.17, 0.74, 0.2, 0.12, 0.37, 0, 2, PANTS);
  // Shoes.
  add(0.18, 0.08, 0.28, -0.12, 0.04, 0.03, 1, HAIR);
  add(0.18, 0.08, 0.28, 0.12, 0.04, 0.03, 2, HAIR);

  // --- Arms: sleeves (tinted) + skin hands, pivot at shoulder y≈1.2 ---
  add(0.12, 0.42, 0.16, -0.3, 1.04, 0, 3, WHITE, true);
  add(0.1, 0.16, 0.13, -0.3, 0.76, 0, 3, SKIN);
  add(0.12, 0.42, 0.16, 0.3, 1.04, 0, 4, WHITE, true);
  add(0.1, 0.16, 0.13, 0.3, 0.76, 0, 4, SKIN);

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

/** Cycle rickshaw — Dhaka's icon. Used parked roadside and in traffic. */
export function buildRickshawGeometry(): BufferGeometry {
  const body = new BoxGeometry(0.9, 0.5, 1.6);
  body.translate(0, 0.55, 0);
  const seat = new BoxGeometry(0.85, 0.45, 0.6);
  seat.translate(0, 1.0, -0.4);
  const canopy = new BoxGeometry(0.95, 0.08, 0.8);
  canopy.translate(0, 1.55, -0.35);
  const wheelL = new BoxGeometry(0.08, 0.7, 0.7);
  wheelL.translate(-0.48, 0.35, -0.3);
  const wheelR = new BoxGeometry(0.08, 0.7, 0.7);
  wheelR.translate(0.48, 0.35, -0.3);
  const frontWheel = new BoxGeometry(0.08, 0.6, 0.6);
  frontWheel.translate(0, 0.3, 0.75);
  const handle = new BoxGeometry(0.6, 0.06, 0.06);
  handle.translate(0, 1.0, 0.55);
  return mergeGeometries(
    [
      paintColored(body, new Color('#3a6fb5')),
      paintColored(seat, new Color('#b03a4a')),
      paintColored(canopy, new Color('#e0c46a')),
      paintColored(wheelL, new Color('#2a2a2a')),
      paintColored(wheelR, new Color('#2a2a2a')),
      paintColored(frontWheel, new Color('#2a2a2a')),
      paintColored(handle, new Color('#555')),
    ],
    false,
  );
}

/** CNG auto-rickshaw: the green three-wheeler cage. */
export function buildCngGeometry(): BufferGeometry {
  const body = new BoxGeometry(1.25, 1.1, 2.3);
  body.translate(0, 0.85, 0);
  const windshield = new BoxGeometry(1.1, 0.5, 0.06);
  windshield.translate(0, 1.15, 1.16);
  const roof = new BoxGeometry(1.3, 0.08, 2.0);
  roof.translate(0, 1.46, -0.1);
  const wheelF = new BoxGeometry(0.14, 0.5, 0.5);
  wheelF.translate(0, 0.25, 1.0);
  const wheelL = new BoxGeometry(0.14, 0.55, 0.55);
  wheelL.translate(-0.62, 0.28, -0.7);
  const wheelR = new BoxGeometry(0.14, 0.55, 0.55);
  wheelR.translate(0.62, 0.28, -0.7);
  return mergeGeometries(
    [
      paintColored(body, new Color('#2e7d4f')),
      paintColored(windshield, new Color('#a8c8e0')),
      paintColored(roof, new Color('#256640')),
      paintColored(wheelF, new Color('#222')),
      paintColored(wheelL, new Color('#222')),
      paintColored(wheelR, new Color('#222')),
    ],
    false,
  );
}

export function paintColored(geo: BufferGeometry, color: Color): BufferGeometry {
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
