import * as T from 'three';

/** One unit cube shared by every scaled box mesh. */
const boxGeometry = new T.BoxGeometry(1, 1, 1);

export type Triple = readonly [number, number, number];

/** Adds a scaled unit-cube mesh to `parent` and returns it. */
export function box(
  parent: T.Object3D,
  size: Triple,
  position: Triple,
  material: T.Material,
): T.Mesh {
  const mesh = new T.Mesh(boxGeometry, material);
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  parent.add(mesh);
  return mesh;
}

export function surface(
  color: T.ColorRepresentation,
  roughness = 0.5,
  metalness = 0.1,
): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial({ color, roughness, metalness });
}

export function glow(color: T.ColorRepresentation, intensity = 1.6): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });
}
