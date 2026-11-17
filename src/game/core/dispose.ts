import * as T from 'three';

/** Disposes every geometry, material and material texture found under `root`. */
export function disposeTree(root: T.Object3D): void {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();

  root.traverse(object => {
    if (object instanceof T.Mesh || object instanceof T.Points || object instanceof T.LineSegments) {
      geometries.add(object.geometry);
      const list: T.Material[] = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) materials.add(material);
    }
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof T.Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
}
