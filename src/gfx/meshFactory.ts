/**
 * Procedural low-poly mesh factory. All art in CakeWalk is generated here —
 * zero external assets. Flat-shaded boxes, vertex colors, Crossy-Road vibe.
 *
 * Person geometry carries two extra vertex attributes consumed by the walk
 * shader (walkShader.ts):
 *   limbId : 0 torso/head, 1 left leg, 2 right leg, 3 left arm, 4 right arm
 *   tint   : 1 = multiply by instance color (clothes), 0 = keep base color
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SKIN = new Color('#d39a6a');
const HAIR = new Color('#2b2118');

/** Tag any geometry with the per-vertex attributes the walk shader reads. */
function paintPart(geo: BufferGeometry, limbId: number, color: Color, tinted: boolean): BufferGeometry {
  // Drop uv so every part merges with the same attribute set.
  geo.deleteAttribute('uv');
  const count = geo.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  const limb = new Float32Array(count);
  const tint = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    limb[i] = limbId;
    tint[i] = tinted ? 1 : 0;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.setAttribute('limbId', new BufferAttribute(limb, 1));
  geo.setAttribute('tint', new BufferAttribute(tint, 1));
  return geo;
}

/**
 * Chunky cartoon character (Fall-Guys / Among-Us bean): a big round head, a
 * fat rounded costume body tinted by instance color, stubby capsule limbs and
 * a simple two-eyed face. Origin at feet, ~1.75 m tall, forward = +Z. Limb
 * pivots (legs 0.5 m, shoulders 1.2 m) match walkShader's HIP_Y/SHOULDER_Y.
 */
export function buildPersonGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, l: number, c: Color, t = false) => {
    const g = new BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(paintPart(g, l, c, t));
  };
  const cap = (r: number, len: number, x: number, y: number, l: number, c: Color, t = false) => {
    const g = new CapsuleGeometry(r, len, 2, 6);
    g.translate(x, y, 0);
    parts.push(paintPart(g, l, c, t));
  };
  const sphere = (r: number, x: number, y: number, z: number, l: number, c: Color, seg = 6) => {
    const g = new SphereGeometry(r, seg, Math.max(4, seg - 2));
    g.translate(x, y, z);
    parts.push(paintPart(g, l, c, false));
  };

  const WHITE = new Color('#ffffff');
  const EYE_WHITE = new Color('#fbfaf6');
  const PUPIL = new Color('#241c14');

  // --- Stubby legs (capsules), pivot at hip y≈0.5 ---
  cap(0.13, 0.2, -0.15, 0.23, 1, new Color('#3c424b'));
  cap(0.13, 0.2, 0.15, 0.23, 2, new Color('#3c424b'));
  box(0.22, 0.1, 0.3, -0.15, 0.05, 0.05, 1, HAIR); // shoes
  box(0.22, 0.1, 0.3, 0.15, 0.05, 0.05, 2, HAIR);

  // --- Fat rounded costume body (tinted), the bean ---
  const body = new CapsuleGeometry(0.34, 0.18, 3, 10);
  body.translate(0, 0.9, 0);
  parts.push(paintPart(body, 0, WHITE, true));

  // --- Big round head + face ---
  sphere(0.31, 0, 1.48, 0, 0, SKIN, 8);
  box(0.42, 0.16, 0.34, 0, 1.7, -0.02, 0, HAIR); // cartoon hair cap
  box(0.36, 0.2, 0.06, 0, 1.5, -0.27, 0, HAIR); // back hair
  // Big cartoon eyes.
  sphere(0.1, -0.12, 1.5, 0.24, 0, EYE_WHITE, 6);
  sphere(0.1, 0.12, 1.5, 0.24, 0, EYE_WHITE, 6);
  box(0.05, 0.07, 0.04, -0.12, 1.5, 0.32, 0, PUPIL);
  box(0.05, 0.07, 0.04, 0.12, 1.5, 0.32, 0, PUPIL);

  // --- Stubby arms (capsules, tinted) + little hands, pivot shoulder y≈1.2 ---
  cap(0.1, 0.16, -0.42, 1.0, 3, WHITE, true);
  cap(0.1, 0.16, 0.42, 1.0, 4, WHITE, true);
  sphere(0.1, -0.42, 0.82, 0, 3, SKIN, 6);
  sphere(0.1, 0.42, 0.82, 0, 4, SKIN, 6);

  const merged = mergeGeometries(parts, false);
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

/** CNG auto-rickshaw: the bright green three-wheeler cage with yellow roof. */
export function buildCngGeometry(): BufferGeometry {
  const body = new BoxGeometry(1.25, 1.1, 2.3);
  body.translate(0, 0.85, 0);
  const skirt = new BoxGeometry(1.32, 0.4, 2.34);
  skirt.translate(0, 0.5, 0);
  const windshield = new BoxGeometry(1.1, 0.5, 0.06);
  windshield.translate(0, 1.15, 1.16);
  const roof = new BoxGeometry(1.32, 0.12, 2.0);
  roof.translate(0, 1.47, -0.1);
  const headL = new BoxGeometry(0.18, 0.18, 0.1);
  headL.translate(-0.4, 0.7, 1.18);
  const headR = new BoxGeometry(0.18, 0.18, 0.1);
  headR.translate(0.4, 0.7, 1.18);
  const wheelF = new BoxGeometry(0.16, 0.5, 0.5);
  wheelF.translate(0, 0.25, 1.0);
  const wheelL = new BoxGeometry(0.16, 0.55, 0.55);
  wheelL.translate(-0.62, 0.28, -0.7);
  const wheelR = new BoxGeometry(0.16, 0.55, 0.55);
  wheelR.translate(0.62, 0.28, -0.7);
  return mergeGeometries(
    [
      paintColored(body, new Color('#2ec24c')),
      paintColored(skirt, new Color('#1f8f38')),
      paintColored(windshield, new Color('#bfe3f5')),
      paintColored(roof, new Color('#ffd23e')),
      paintColored(headL, new Color('#fff3b0')),
      paintColored(headR, new Color('#fff3b0')),
      paintColored(wheelF, new Color('#1b1b1b')),
      paintColored(wheelL, new Color('#1b1b1b')),
      paintColored(wheelR, new Color('#1b1b1b')),
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
