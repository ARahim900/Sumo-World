/**
 * Shape of the Sumo GT glTF asset built by tools/car/build_car.py. Kept free of three.js so the
 * asset can be checked in Node tests.
 */
import type { QualityPreset } from '../core/types';

export const CAR_MODEL_URL = '/models/sumo-gt.glb';

export const CAR_MATERIAL_ROLES = [
  'body',
  'glass',
  'trim',
  'chrome',
  'interior',
  'lights_front',
  'lights_rear',
  'lights_reverse',
  'tyre',
  'rim',
  'disc',
  'caliper',
] as const;

export type CarMaterialRole = (typeof CAR_MATERIAL_ROLES)[number];

export function isCarMaterialRole(name: string): name is CarMaterialRole {
  return (CAR_MATERIAL_ROLES as readonly string[]).includes(name);
}

/** Wheel corner keys; "left" is +X for a car facing +Z. */
export const WHEEL_KEYS = ['fl', 'fr', 'rl', 'rr'] as const;

export type WheelKey = (typeof WHEEL_KEYS)[number];

/** Chooses the modelled corner for a wheel hub at car-local (x, z). */
export function wheelKey(x: number, z: number): WheelKey {
  const axle = z >= 0 ? 'f' : 'r';
  const side = x >= 0 ? 'l' : 'r';
  return `${axle}${side}` as WheelKey;
}

/** Body parts shown at every distance. */
export const SHELL_NODES = ['glass', 'lights_front', 'lights_rear', 'lights_reverse'] as const;

/** Body parts shown only close up; `body_lod1` replaces them in the distance. */
export const DETAIL_NODES = ['body', 'trim', 'interior'] as const;

export const LOD_NODE = 'body_lod1';

export const REQUIRED_NODES: readonly string[] = [
  ...SHELL_NODES,
  ...DETAIL_NODES,
  LOD_NODE,
  ...WHEEL_KEYS.map(key => `wheel_${key}`),
  ...WHEEL_KEYS.map(key => `caliper_${key}`),
];

/**
 * Material cost tiers. 'basic' drops clearcoat, flake and transparency tricks for weak GPUs;
 * 'transmissive' adds real glass transmission, which costs an extra opaque scene pass.
 */
export type MaterialTier = 'basic' | 'physical' | 'transmissive';

export function materialTierFor(preset: QualityPreset): MaterialTier {
  if (preset === 'low') return 'basic';
  if (preset === 'ultra') return 'transmissive';
  return 'physical';
}

/** Deterministic tangent-space normals for metallic paint flake, as RGBA bytes. */
export function flakeNormalData(size: number, seed: number, tilt = 0.55): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  let state = seed >>> 0 || 1;
  const random = (): number => {
    // xorshift32: tiny, fast and reproducible.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = 0; i < size * size; i++) {
    const x = (random() * 2 - 1) * tilt;
    const y = (random() * 2 - 1) * tilt;
    const length = Math.hypot(x, y, 1);
    data[i * 4] = Math.round(((x / length) * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round(((y / length) * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}
