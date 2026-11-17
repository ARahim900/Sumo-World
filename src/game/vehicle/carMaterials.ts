import * as T from 'three';
import { flakeNormalData, type CarMaterialRole, type MaterialTier } from './carAsset';
import type { LightLevels } from './carMotion';

/** "Nocturne blue" metallic, the car's original paint. */
const PAINT = '#1b4a6b';
const FLAKE_SIZE = 128;
const FLAKE_SEED = 0x5a3f;
/** Flake texture repeats per UV unit; the model's UVs are 0.5 m per unit. */
const FLAKE_REPEAT = 3;

function flakeTexture(): T.DataTexture {
  const texture = new T.DataTexture(flakeNormalData(FLAKE_SIZE, FLAKE_SEED), FLAKE_SIZE, FLAKE_SIZE);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(FLAKE_REPEAT, FLAKE_REPEAT);
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function standard(parameters: T.MeshStandardMaterialParameters): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial(parameters);
}

function paint(tier: MaterialTier, flake: T.Texture | null): T.MeshStandardMaterial {
  if (tier === 'basic' || flake === null) {
    return standard({ color: PAINT, metalness: 0.6, roughness: 0.3, envMapIntensity: 1.2 });
  }
  // Rough metallic base with flake normals, under a mirror-smooth clearcoat that ignores them.
  return new T.MeshPhysicalMaterial({
    color: PAINT,
    metalness: 0.75,
    roughness: 0.42,
    normalMap: flake,
    normalScale: new T.Vector2(0.22, 0.22),
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.35,
  });
}

function glass(tier: MaterialTier): T.MeshStandardMaterial {
  if (tier === 'basic') {
    return standard({
      color: '#0a141c',
      metalness: 0.25,
      roughness: 0.08,
      transparent: true,
      opacity: 0.86,
    });
  }
  if (tier === 'transmissive') {
    return new T.MeshPhysicalMaterial({
      color: '#a9c2d0',
      metalness: 0,
      roughness: 0.03,
      transmission: 0.9,
      thickness: 0.005,
      ior: 1.5,
      attenuationColor: new T.Color('#1f3a48'),
      attenuationDistance: 0.35,
      envMapIntensity: 1.5,
    });
  }
  return new T.MeshPhysicalMaterial({
    color: '#081119',
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: 0.74,
    envMapIntensity: 1.6,
    depthWrite: false,
  });
}

function caliper(tier: MaterialTier): T.MeshStandardMaterial {
  if (tier === 'basic') return standard({ color: '#ffb21e', roughness: 0.4, metalness: 0.1 });
  return new T.MeshPhysicalMaterial({
    color: '#ffb21e',
    roughness: 0.35,
    metalness: 0.1,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
  });
}

function lamp(color: T.ColorRepresentation, glowColor: T.ColorRepresentation): T.MeshStandardMaterial {
  return standard({ color, emissive: glowColor, emissiveIntensity: 0, roughness: 0.2 });
}

/**
 * The car's material set for one quality tier. Meshes look their material up by role, so the
 * whole car can switch tier by re-binding meshes to a new set.
 */
export class CarMaterials {
  readonly tier: MaterialTier;
  private readonly flake: T.DataTexture | null;
  private readonly byRole: Record<CarMaterialRole, T.MeshStandardMaterial>;

  constructor(tier: MaterialTier) {
    this.tier = tier;
    this.flake = tier === 'basic' ? null : flakeTexture();
    this.byRole = {
      body: paint(tier, this.flake),
      glass: glass(tier),
      trim: standard({ color: '#0b0d10', roughness: 0.45, metalness: 0.3 }),
      chrome: standard({ color: '#c9d1d8', roughness: 0.12, metalness: 1 }),
      interior: standard({ color: '#15171b', roughness: 0.85, metalness: 0 }),
      lights_front: lamp('#e8fbff', '#c4f6ff'),
      lights_rear: lamp('#3a0710', '#ff1a3d'),
      lights_reverse: lamp('#d8dde2', '#f2f7ff'),
      tyre: standard({ color: '#0d0e10', roughness: 0.88, metalness: 0 }),
      rim: standard({ color: '#3b4148', roughness: 0.28, metalness: 1 }),
      disc: standard({ color: '#6d7176', roughness: 0.45, metalness: 1 }),
      caliper: caliper(tier),
    };
  }

  get(role: CarMaterialRole): T.MeshStandardMaterial {
    return this.byRole[role];
  }

  setLightLevels(levels: Readonly<LightLevels>): void {
    this.byRole.lights_front.emissiveIntensity = levels.front;
    this.byRole.lights_rear.emissiveIntensity = levels.rear;
    this.byRole.lights_reverse.emissiveIntensity = levels.reverse;
  }

  dispose(): void {
    for (const material of Object.values(this.byRole)) material.dispose();
    this.flake?.dispose();
  }
}
