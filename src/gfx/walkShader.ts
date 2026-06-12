/**
 * Procedural walk cycle injected into MeshLambertMaterial — no bones, no
 * vertex-animation textures, works on any GLES2 WebView.
 *
 * Limbs shear around their pivot heights by sin(phase); torso/head bob.
 * Instanced meshes read per-instance `aPhase`/`aSwing` attributes (updated
 * once per frame from the crowd SoA); the player's single mesh reads
 * `uPhase`/`uSwing` uniforms instead.
 */
import type { MeshLambertMaterial, WebGLProgramParametersWithUniforms } from 'three';

// Pivot heights must match buildPersonGeometry's proportions.
const HIP_Y = 0.78;
const SHOULDER_Y = 1.2;

const COMMON_GLSL = /* glsl */ `
  attribute float limbId;
  attribute float tint;
  varying float vTint;
`;

const WALK_GLSL = /* glsl */ `
  float cwSwing = sin(cwPhase);
  if (limbId == 1.0) {
    transformed.z += cwSwing * cwAmp * max(${HIP_Y} - position.y, 0.0);
  } else if (limbId == 2.0) {
    transformed.z -= cwSwing * cwAmp * max(${HIP_Y} - position.y, 0.0);
  } else if (limbId == 3.0) {
    transformed.z -= cwSwing * cwAmp * 0.7 * max(${SHOULDER_Y} - position.y, 0.0);
  } else if (limbId == 4.0) {
    transformed.z += cwSwing * cwAmp * 0.7 * max(${SHOULDER_Y} - position.y, 0.0);
  } else {
    transformed.y += abs(cwSwing) * 0.045 * cwAmp;
  }
`;

/** Tint chunk: clothes (tint=1) take the instance color, rest keep base. */
const COLOR_VERTEX_INSTANCED = /* glsl */ `
  vColor = vec4(1.0);
  #ifdef USE_COLOR
    vColor.rgb *= color.rgb;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor.rgb = mix(vColor.rgb, vColor.rgb * instanceColor.rgb, tint);
  #endif
  vTint = tint;
`;

export function applyWalkShader(
  material: MeshLambertMaterial,
  mode: 'instanced' | 'single',
): { uniforms: { uPhase: { value: number }; uSwing: { value: number } } } {
  const uniforms = { uPhase: { value: 0 }, uSwing: { value: 0 } };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    const head =
      mode === 'instanced'
        ? `${COMMON_GLSL}\nattribute float aPhase;\nattribute float aSwing;`
        : `${COMMON_GLSL}\nuniform float uPhase;\nuniform float uSwing;`;
    const phaseExpr = mode === 'instanced' ? 'aPhase' : 'uPhase';
    const swingExpr = mode === 'instanced' ? 'aSwing' : 'uSwing';

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${head}`)
      .replace(
        '#include <color_vertex>',
        COLOR_VERTEX_INSTANCED,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nfloat cwPhase = ${phaseExpr};\nfloat cwAmp = ${swingExpr};\n${WALK_GLSL}`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying float vTint;',
    );
  };
  // vertexColors must be on for the color attribute path to exist.
  material.vertexColors = true;
  return { uniforms };
}
