/**
 * Time-of-day & weather variants (idea.md §6.5). Seeded per run: changes the
 * light, the sky, and the rules — noon heat drains stamina faster, rain is
 * slippery (umbrella item negates the player's penalty; the crowd's
 * umbrellas make everyone effectively wider), evening is rush hour.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Points,
  PointsMaterial,
  Scene,
} from 'three';
import type { RngStream } from '@/core/Rng';

export type TimeOfDay = 'morning' | 'noon' | 'evening';
export type Weather = 'clear' | 'rain';

export interface AtmosphereMods {
  timeOfDay: TimeOfDay;
  weather: Weather;
  /** Multiplier on stamina drain (noon heat). */
  staminaDrainMul: number;
  /** Multiplier on player speed (rain without umbrella). */
  playerSpeedMul: number;
  /** Multiplier on crowd density (evening rush). */
  crowdDensityMul: number;
  /** Added to every agent's hitbox half-width (rain umbrellas). */
  agentWidthAdd: number;
}

// Rev 6 cartoon palette: bright, saturated, Fall-Guys-cheerful skies.
const PALETTES: Record<TimeOfDay, { sky: string; fogNear: number; hemi: number; sun: number }> = {
  morning: { sky: '#ffe3b3', fogNear: 40, hemi: 1.15, sun: 1.05 },
  noon: { sky: '#9fd9f0', fogNear: 50, hemi: 1.3, sun: 1.35 },
  evening: { sky: '#ffb27d', fogNear: 34, hemi: 0.95, sun: 0.95 },
};

export function rollAtmosphere(rng: RngStream, hasUmbrella: boolean): AtmosphereMods {
  const timeOfDay = rng.weighted<TimeOfDay>(['morning', 'noon', 'evening'], [3, 3, 4]);
  const weather = rng.weighted<Weather>(['clear', 'rain'], [7, 3]);
  return {
    timeOfDay,
    weather,
    staminaDrainMul: timeOfDay === 'noon' ? 1.3 : 1,
    playerSpeedMul: weather === 'rain' && !hasUmbrella ? 0.88 : 1,
    crowdDensityMul: timeOfDay === 'evening' ? 1.25 : 1,
    agentWidthAdd: weather === 'rain' ? 0.12 : 0,
  };
}

export interface AtmosphereHandle {
  frame(frameDt: number): void;
  dispose(): void;
}

/** Applies sky/fog colors and adds rain particles. Returns frame/dispose handle. */
export function dressScene(
  scene: Scene,
  mods: AtmosphereMods,
  followTarget: () => { x: number; z: number },
): AtmosphereHandle {
  const pal = PALETTES[mods.timeOfDay];
  const sky = new Color(pal.sky);
  if (mods.weather === 'rain') sky.lerp(new Color('#7d848c'), 0.45);
  scene.background = sky;
  scene.fog = new Fog(sky, mods.weather === 'rain' ? pal.fogNear * 0.7 : pal.fogNear, 130);

  if (mods.weather !== 'rain') return { frame: () => {}, dispose: () => {} };

  // Rain: a recycling box of falling points around the player.
  const COUNT = 600;
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 60;
    pos[i * 3 + 1] = Math.random() * 25;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  const rain = new Points(
    geo,
    new PointsMaterial({ color: 0xaabbcc, size: 0.08, transparent: true, opacity: 0.6 }),
  );
  rain.frustumCulled = false;
  scene.add(rain);

  return {
    frame(frameDt: number) {
      const target = followTarget();
      rain.position.set(target.x, 0, target.z);
      const arr = geo.attributes.position!.array as Float32Array;
      for (let i = 0; i < COUNT; i++) {
        arr[i * 3 + 1]! -= 18 * frameDt;
        if (arr[i * 3 + 1]! < 0) arr[i * 3 + 1] = 25;
      }
      geo.attributes.position!.needsUpdate = true;
    },
    dispose() {
      scene.remove(rain);
      geo.dispose();
      (rain.material as PointsMaterial).dispose();
    },
  };
}
