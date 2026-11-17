import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { box, glow, surface } from '../core/primitives';
import type { CarVisual, CarVisualState } from '../core/types';

export type { CarVisual, CarVisualState } from '../core/types';

function createWheel(black: T.Material): T.Group {
  const pivot = new T.Group();
  const tyre = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, 0.23, 24), surface('#08090c', 0.85));
  tyre.rotation.z = Math.PI / 2;
  pivot.add(tyre);

  for (const side of [-1, 1]) {
    const rim = new T.Mesh(
      new T.CylinderGeometry(0.245, 0.245, 0.012, 16),
      surface('#a3aab0', 0.22, 0.95),
    );
    rim.rotation.z = Math.PI / 2;
    rim.position.x = side * 0.123;
    pivot.add(rim);

    const hub = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.016, 12), black);
    hub.rotation.z = Math.PI / 2;
    hub.position.x = side * 0.134;
    pivot.add(hub);

    for (let k = 0; k < 5; k++) {
      const spoke = box(pivot, [0.02, 0.04, 0.4], [side * 0.135, 0, 0], black);
      spoke.rotation.x = (k * Math.PI) / 5;
    }
  }
  return pivot;
}

/** Builds the original procedural coupe used as the player's car. */
export function createCar(): CarVisual {
  const group = new T.Group();
  const paint = new T.MeshPhysicalMaterial({
    color: '#71838c',
    metalness: 0.85,
    roughness: 0.23,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
  const black = surface('#080d16', 0.3, 0.6);
  const glass = surface('#071521', 0.1, 0.85);

  const body = new T.Mesh(new RoundedBoxGeometry(1.87, 0.53, 4.15, 3, 0.12), paint);
  body.position.y = 0.04;
  body.castShadow = true;
  group.add(body);

  // A tapered cabin gives the original coupe a continuous roof and windscreen silhouette.
  const shape = new T.Shape();
  shape.moveTo(-1.15, 0.26);
  shape.lineTo(-0.65, 0.85);
  shape.lineTo(0.45, 0.84);
  shape.lineTo(1.12, 0.27);
  shape.closePath();
  const cabin = new T.Mesh(
    new T.ExtrudeGeometry(shape, {
      depth: 1.52,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.04,
      bevelSegments: 2,
      steps: 1,
    }),
    glass,
  );
  cabin.rotation.y = -Math.PI / 2;
  cabin.position.x = 0.76;
  group.add(cabin);

  box(group, [1.48, 0.06, 1.15], [0, 0.86, -0.1], paint);
  box(group, [1.94, 0.14, 0.18], [0, -0.13, 2.03], black);
  box(group, [1.92, 0.14, 0.18], [0, -0.13, -2.04], black);
  box(group, [1.72, 0.06, 0.24], [0, 0.38, -1.88], black);
  for (let i = 0; i < 5; i++) {
    box(group, [1.3, 0.025, 0.035], [0, 0.3, -1.15 - i * 0.12], black);
  }
  box(group, [0.64, 0.14, 0.03], [0, -0.08, -2.14], surface('#ced4d8'));
  box(group, [1.65, 0.055, 0.055], [0, 0.14, -2.09], glow('#ff284b', 5));

  for (const side of [-1, 1]) {
    box(group, [0.62, 0.055, 0.06], [side * 0.54, 0.15, 2.09], glow('#c4f6ff', 7));
    box(group, [0.035, 0.045, 2.4], [side * 0.944, -0.18, -0.1], glow('#6cdeee', 2));
    box(group, [0.23, 0.12, 0.25], [side * 1.01, 0.43, 0.55], paint);
    box(group, [0.035, 0.045, 0.23], [side * 0.95, 0.28, -0.25], black);
    box(group, [0.16, 0.12, 0.3], [side * 0.62, -0.19, -2.11], black);
  }

  const wheels: T.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = createWheel(black);
    group.add(pivot);
    wheels.push(pivot);
  }

  const lamps: T.Light[] = [];
  for (const x of [-0.65, 0.65]) {
    const light = new T.SpotLight('#c4eaff', 70, 42, 0.48, 0.6, 1.1);
    light.position.set(x, 0.2, 2);
    light.target.position.set(x, -1, 22);
    group.add(light, light.target);
    lamps.push(light);
  }
  const under = new T.PointLight('#19d9df', 7, 5, 1.8);
  under.position.set(0, -0.3, 0);
  group.add(under);
  lamps.push(under);

  return {
    group,
    wheels,
    setLights(on: boolean) {
      for (const lamp of lamps) lamp.visible = on;
    },
    update(state: CarVisualState) {
      group.position.copy(state.pose.position);
      group.quaternion.copy(state.pose.quaternion);
      for (let i = 0; i < wheels.length; i++) {
        const wheel = wheels[i];
        const data = state.wheels[i];
        wheel.position.copy(data.anchor);
        wheel.position.y -= data.suspensionLength;
        wheel.rotation.set(data.rotation, data.steering, 0, 'YXZ');
      }
    },
  };
}
