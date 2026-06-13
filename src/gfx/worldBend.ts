/**
 * "Curved world" vertex bend (Temple-Run / Subway-Surfers look).
 *
 * Everything in the run is rendered in real space, but in the VERTEX shader we
 * bend each vertex downward as it recedes from the camera — in *view* space, so
 * the bend always follows wherever the camera looks. The result: the ground and
 * buildings directly under the player stay flat and straight, and the road
 * curves/falls away in the distance. A small straight zone near the camera
 * keeps the player's own block dead straight.
 *
 * One shared uniform object is mixed into every run material so the whole world
 * bends as a single coherent surface. Sprites/points are skipped (their
 * projection path differs and they sit near the player anyway).
 */
import type { Material, WebGLProgramParametersWithUniforms } from 'three';

export interface BendUniforms {
  uBendDrop: { value: number };
  uBendNear: { value: number };
}

/** Tunable globally; RunState owns the single instance for a run. */
export function makeBendUniforms(): BendUniforms {
  return {
    uBendDrop: { value: 0.0023 }, // meters dropped per (meter beyond near)^2
    uBendNear: { value: 13 }, // straight zone in front of the camera (m)
  };
}

const DECL = /* glsl */ `
  uniform float uBendDrop;
  uniform float uBendNear;
`;

/**
 * The standard three.js project_vertex chunk, re-emitted with a bend applied to
 * the view-space position before projection. Kept in sync with three's chunk
 * (batching + instancing guards) so instanced crowds/props bend identically.
 */
const BENT_PROJECT = /* glsl */ `
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    mvPosition = batchingMatrix * mvPosition;
  #endif
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  mvPosition = modelViewMatrix * mvPosition;
  float cwDepth = max( -mvPosition.z - uBendNear, 0.0 );
  mvPosition.y -= uBendDrop * cwDepth * cwDepth;
  gl_Position = projectionMatrix * mvPosition;
`;

/** Inject the bend into a shader object (chainable from other onBeforeCompile). */
export function injectBend(shader: WebGLProgramParametersWithUniforms, u: BendUniforms): void {
  Object.assign(shader.uniforms, u);
  if (shader.vertexShader.includes('uBendDrop')) return; // already bent
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${DECL}`)
    .replace('#include <project_vertex>', BENT_PROJECT);
}

/**
 * Patch a single material so its geometry bends. Chains any existing
 * onBeforeCompile (e.g. the walk shader). Idempotent per material.
 */
export function applyWorldBend(material: Material, u: BendUniforms): void {
  if (material.userData.cwBent) return;
  material.userData.cwBent = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    injectBend(shader, u);
  };
  material.needsUpdate = true;
}

/** Bend every eligible mesh material under an object (skips sprites/points). */
export function bendObject(root: { traverse(cb: (o: unknown) => void): void }, u: BendUniforms): void {
  root.traverse((obj) => {
    const o = obj as {
      isMesh?: boolean;
      isSprite?: boolean;
      isPoints?: boolean;
      material?: Material | Material[];
    };
    if (!o.isMesh || o.isSprite || o.isPoints || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) applyWorldBend(m, u);
  });
}
