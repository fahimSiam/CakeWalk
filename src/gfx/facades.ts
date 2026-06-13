/**
 * Procedurally drawn facade textures + signboards — the "real Dhaka
 * roadside" pass. One canvas tile = one storey × three bays, repeated
 * across each wall via UVs, multiplied by per-building vertex tint.
 * Signboards render real OSM shop/POI names (Bengali included).
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

export type FacadeStyle = 'residential' | 'commercial' | 'shutter' | 'plain';

const cache = new Map<FacadeStyle, CanvasTexture>();

export function facadeTexture(style: FacadeStyle): CanvasTexture {
  let tex = cache.get(style);
  if (tex) return tex;
  const SIZE = 192;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d')!;
  // Base wall: near-white so vertex colors set the actual hue; subtle grime.
  g.fillStyle = '#efe9df';
  g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = 'rgba(120,100,80,0.08)';
  for (let i = 0; i < 14; i++) {
    g.fillRect((i * 37) % SIZE, (i * 53) % SIZE, 22, 9);
  }

  const bay = SIZE / 3;
  if (style === 'residential') {
    // Windows with frames + a thin balcony rail line under each row.
    for (let b = 0; b < 3; b++) {
      const x = b * bay + bay * 0.24;
      g.fillStyle = '#6f6658';
      g.fillRect(x - 3, 38, bay * 0.52 + 6, 66);
      g.fillStyle = '#3d4a55';
      g.fillRect(x, 41, bay * 0.52, 60);
      g.strokeStyle = '#8a8a85';
      g.lineWidth = 2;
      g.strokeRect(x, 41, bay * 0.52, 60);
      g.beginPath();
      g.moveTo(x + bay * 0.26, 41);
      g.lineTo(x + bay * 0.26, 101);
      g.stroke();
    }
    g.fillStyle = '#7a7268';
    g.fillRect(0, 122, SIZE, 6); // balcony slab line
    for (let i = 0; i < 24; i++) {
      g.fillRect(i * 8 + 2, 110, 2, 12); // rail bars
    }
  } else if (style === 'commercial') {
    // Big glass band + AC units.
    g.fillStyle = '#46606e';
    g.fillRect(10, 30, SIZE - 20, 80);
    g.strokeStyle = '#9fb0ba';
    g.lineWidth = 3;
    g.strokeRect(10, 30, SIZE - 20, 80);
    for (let i = 1; i < 4; i++) {
      g.beginPath();
      g.moveTo(10 + ((SIZE - 20) / 4) * i, 30);
      g.lineTo(10 + ((SIZE - 20) / 4) * i, 110);
      g.stroke();
    }
    g.fillStyle = '#c9c4ba';
    g.fillRect(SIZE - 46, 128, 30, 20); // AC unit
    g.fillStyle = '#8a857c';
    g.fillRect(SIZE - 44, 132, 26, 3);
  } else if (style === 'shutter') {
    // Corrugated shop shutters, the bazaar look.
    for (let b = 0; b < 3; b++) {
      const x = b * bay + 6;
      g.fillStyle = ['#9a6f4a', '#7d8a93', '#a08a52'][b]!;
      g.fillRect(x, 26, bay - 12, 132);
      g.strokeStyle = 'rgba(40,30,20,0.35)';
      g.lineWidth = 2;
      for (let yy = 32; yy < 156; yy += 9) {
        g.beginPath();
        g.moveTo(x, yy);
        g.lineTo(x + bay - 12, yy);
        g.stroke();
      }
      g.fillStyle = 'rgba(30,22,14,0.5)';
      g.fillRect(x + (bay - 12) / 2 - 8, 148, 16, 6); // handle
    }
  } else {
    // Plain plaster with faint banding (mosques, landmarks).
    g.fillStyle = 'rgba(130,115,95,0.12)';
    g.fillRect(0, 56, SIZE, 8);
    g.fillRect(0, 150, SIZE, 10);
  }

  tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  cache.set(style, tex);
  return tex;
}

export const FACADE_FOR_KIND: Record<string, FacadeStyle> = {
  residential: 'residential',
  commercial: 'commercial',
  market: 'shutter',
  mosque: 'plain',
  landmark: 'plain',
};

const SIGN_PALETTES = [
  { bg: '#b03a2e', fg: '#ffe9a8' },
  { bg: '#1d5c43', fg: '#ffffff' },
  { bg: '#1f3f6e', fg: '#ffd34a' },
  { bg: '#c2851f', fg: '#1a1208' },
  { bg: '#5b2d7a', fg: '#ffffff' },
];

/** A signboard with a real (OSM) name; `big` = building/institution title. */
export function makeSignboard(name: string, seed: number, big = false): Mesh {
  const pal = SIGN_PALETTES[seed % SIGN_PALETTES.length]!;
  const canvas = document.createElement('canvas');
  canvas.width = big ? 384 : 256;
  canvas.height = 72;
  const g = canvas.getContext('2d')!;
  g.fillStyle = pal.bg;
  g.fillRect(0, 0, canvas.width, 72);
  g.strokeStyle = pal.fg;
  g.lineWidth = 4;
  g.strokeRect(4, 4, canvas.width - 8, 64);
  g.fillStyle = pal.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const max = big ? 30 : 22;
  const label = name.length > max ? name.slice(0, max - 1) + '…' : name;
  g.font = `bold ${label.length > 16 ? 22 : 28}px system-ui, 'Noto Sans Bengali', sans-serif`;
  g.fillText(label, canvas.width / 2, 38);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return new Mesh(
    new PlaneGeometry(big ? 4.4 : 2.6, big ? 0.84 : 0.74),
    new MeshBasicMaterial({ map: tex, side: DoubleSide }),
  );
}

/**
 * A building's name painted FLAT on the footpath in front of it (Rev 8 — easier
 * to read while walking than a vertical board). Returns a ground-lying plane.
 */
export function makeFloorLabel(name: string, seed: number): Mesh {
  const pal = SIGN_PALETTES[seed % SIGN_PALETTES.length]!;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  // Rounded plaque so it reads as painted-on signage, not a floating label.
  g.fillStyle = pal.bg;
  roundRect(g, 6, 18, 500, 92, 18);
  g.fill();
  g.strokeStyle = pal.fg;
  g.lineWidth = 5;
  roundRect(g, 6, 18, 500, 92, 18);
  g.stroke();
  g.fillStyle = pal.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const label = name.length > 26 ? name.slice(0, 25) + '…' : name;
  g.font = `bold ${label.length > 18 ? 36 : 46}px system-ui, 'Noto Sans Bengali', sans-serif`;
  g.fillText(label, 256, 66);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(5.0, 1.25),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2; // lie flat, text facing up
  mesh.renderOrder = 2; // sit above the footpath tiles
  return mesh;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Lambert material for textured facade walls (vertex tint × texture). */
export function facadeMaterial(style: FacadeStyle): MeshLambertMaterial {
  return new MeshLambertMaterial({
    map: facadeTexture(style),
    vertexColors: true,
  });
}

export const ROOF_TINT = new Color('#9a9183');
