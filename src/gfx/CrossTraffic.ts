/**
 * Cars driving sideways across each intersection — the cross-traffic of a real
 * chourasta. Purely visual scene-dressing (the actual crossing risk is the
 * crossing minigame): a small set of GLB cars loop back and forth along the
 * perpendicular axis at every junction, in a few lanes, both directions.
 */
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { loadVehicleModel } from './models';
import { paintColored } from './meshFactory';
import { applyWorldBend, type BendUniforms } from './worldBend';
import type { IntersectionMark } from '@/world/LevelRenderer';

const CARS_PER = 4;
const RANGE = 22; // metres travelled either side of the junction centre
const CAR_LEN = 4.4;

interface CrossCar {
  cx: number;
  cz: number;
  nx: number; // travel (lateral) axis
  nz: number;
  tx: number; // route tangent (lane offset axis)
  tz: number;
  u: number; // position along the lateral axis
  speed: number;
  dir: number; // +1 / -1
  lane: number; // offset along the tangent
}

export class CrossTrafficRenderer {
  private mesh: InstancedMesh | null = null;
  private cars: CrossCar[] = [];
  private disposed = false;
  private m = new Matrix4();
  private q = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private pos = new Vector3();
  private one = new Vector3(1, 1, 1);

  constructor(scene: Scene, marks: IntersectionMark[], bend?: BendUniforms) {
    for (const mk of marks) {
      const nx = -mk.dirZ;
      const nz = mk.dirX;
      for (let j = 0; j < CARS_PER; j++) {
        this.cars.push({
          cx: mk.x,
          cz: mk.z,
          nx,
          nz,
          tx: mk.dirX,
          tz: mk.dirZ,
          u: ((j * (RANGE * 2)) / CARS_PER) - RANGE,
          speed: 6 + ((mk.s * 7 + j * 13) % 5),
          dir: j % 2 === 0 ? 1 : -1,
          lane: (j - 1) * 3.2,
        });
      }
    }
    if (!this.cars.length) return;

    const box = new BoxGeometry(1.8, 1.4, CAR_LEN);
    box.translate(0, 0.7, 0);
    this.mesh = new InstancedMesh(
      paintColored(box, new Color('#cf5b4a')),
      new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      this.cars.length,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    void loadVehicleModel('cars/suv', true).then((model) => {
      if (!model || this.disposed || !this.mesh) return;
      const geo = model.geometry.clone();
      geo.scale(CAR_LEN, CAR_LEN, CAR_LEN); // normalised length 1 → real size
      const mat = (model.material as MeshLambertMaterial).clone();
      if (bend) applyWorldBend(mat, bend);
      this.mesh.geometry.dispose();
      (this.mesh.material as MeshLambertMaterial).dispose(); // free the placeholder
      this.mesh.geometry = geo;
      this.mesh.material = mat;
    });
  }

  update(dt: number): void {
    if (!this.mesh) return;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      c.u += c.speed * c.dir * dt;
      if (c.u > RANGE) c.u -= RANGE * 2;
      else if (c.u < -RANGE) c.u += RANGE * 2;
      this.pos.set(
        c.cx + c.nx * c.u + c.tx * c.lane,
        0.0,
        c.cz + c.nz * c.u + c.tz * c.lane,
      );
      this.q.setFromAxisAngle(this.up, Math.atan2(c.nx * c.dir, c.nz * c.dir));
      this.m.compose(this.pos, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene: Scene): void {
    this.disposed = true;
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as MeshLambertMaterial).dispose();
    }
  }
}
