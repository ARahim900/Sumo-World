import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CarMaterialRole } from './carAsset';
import type { CarMaterials } from './carMaterials';

type Triple = readonly [number, number, number];

/** A mesh plus the material role it was built with, so the car can re-skin it per tier. */
export type MaterialBinding = readonly [T.Mesh, CarMaterialRole];

export interface ProceduralCar {
  body: T.Group;
  /** Rolling wheel parts, one group per wheel, centred on the hub. */
  wheels: T.Group[];
  bindings: MaterialBinding[];
}

/**
 * The original primitive coupe, kept as the fallback when the glTF model cannot load. It owns
 * its geometries (none are shared with the city), so it can be disposed on its own.
 */
export function createProceduralCar(materials: CarMaterials): ProceduralCar {
  const bindings: MaterialBinding[] = [];
  const unitBox = new T.BoxGeometry(1, 1, 1);

  const mesh = (geometry: T.BufferGeometry, role: CarMaterialRole): T.Mesh => {
    const created = new T.Mesh(geometry, materials.get(role));
    bindings.push([created, role]);
    return created;
  };
  const box = (parent: T.Object3D, size: Triple, position: Triple, role: CarMaterialRole): T.Mesh => {
    const created = mesh(unitBox, role);
    created.scale.set(size[0], size[1], size[2]);
    created.position.set(position[0], position[1], position[2]);
    parent.add(created);
    return created;
  };

  const body = new T.Group();
  const shell = mesh(new RoundedBoxGeometry(1.87, 0.53, 4.15, 3, 0.12), 'body');
  shell.position.y = 0.04;
  body.add(shell);

  // A tapered cabin gives the coupe a continuous roof and windscreen silhouette.
  const profile = new T.Shape();
  profile.moveTo(-1.15, 0.26);
  profile.lineTo(-0.65, 0.85);
  profile.lineTo(0.45, 0.84);
  profile.lineTo(1.12, 0.27);
  profile.closePath();
  const cabin = mesh(
    new T.ExtrudeGeometry(profile, {
      depth: 1.52,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.04,
      bevelSegments: 2,
      steps: 1,
    }),
    'glass',
  );
  cabin.rotation.y = -Math.PI / 2;
  cabin.position.x = 0.76;
  body.add(cabin);

  box(body, [1.48, 0.06, 1.15], [0, 0.86, -0.1], 'body');
  box(body, [1.94, 0.14, 0.18], [0, -0.13, 2.03], 'trim');
  box(body, [1.92, 0.14, 0.18], [0, -0.13, -2.04], 'trim');
  box(body, [1.72, 0.06, 0.24], [0, 0.38, -1.88], 'trim');
  for (let i = 0; i < 5; i++) {
    box(body, [1.3, 0.025, 0.035], [0, 0.3, -1.15 - i * 0.12], 'trim');
  }
  box(body, [0.64, 0.14, 0.03], [0, -0.08, -2.14], 'chrome');
  box(body, [1.65, 0.055, 0.055], [0, 0.14, -2.09], 'lights_rear');
  for (const side of [-1, 1]) {
    box(body, [0.62, 0.055, 0.06], [side * 0.54, 0.15, 2.09], 'lights_front');
    box(body, [0.18, 0.05, 0.04], [side * 0.5, -0.08, -2.12], 'lights_reverse');
    box(body, [0.23, 0.12, 0.25], [side * 1.01, 0.43, 0.55], 'body');
    box(body, [0.035, 0.045, 0.23], [side * 0.95, 0.28, -0.25], 'trim');
    box(body, [0.16, 0.12, 0.3], [side * 0.62, -0.19, -2.11], 'trim');
  }

  const tyreGeometry = new T.CylinderGeometry(0.36, 0.36, 0.23, 24);
  const rimGeometry = new T.CylinderGeometry(0.245, 0.245, 0.012, 16);
  const hubGeometry = new T.CylinderGeometry(0.09, 0.09, 0.016, 12);
  const wheels: T.Group[] = [];
  for (let w = 0; w < 4; w++) {
    const wheel = new T.Group();
    const tyre = mesh(tyreGeometry, 'tyre');
    tyre.rotation.z = Math.PI / 2;
    wheel.add(tyre);
    for (const side of [-1, 1]) {
      const rim = mesh(rimGeometry, 'rim');
      rim.rotation.z = Math.PI / 2;
      rim.position.x = side * 0.123;
      wheel.add(rim);
      const hub = mesh(hubGeometry, 'trim');
      hub.rotation.z = Math.PI / 2;
      hub.position.x = side * 0.134;
      wheel.add(hub);
      for (let k = 0; k < 5; k++) {
        const spoke = box(wheel, [0.02, 0.04, 0.4], [side * 0.135, 0, 0], 'trim');
        spoke.rotation.x = (k * Math.PI) / 5;
      }
    }
    wheels.push(wheel);
  }

  return { body, wheels, bindings };
}
