import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropBox, Tier } from './cityLayout';

const WHITE = new T.Color(1, 1, 1);

/** Facade texture tile size in metres: roughly 11 window bays wide and 7 storeys tall. */
export const FACADE_TILE_U = 33;
export const FACADE_TILE_V = 22;

/** UV of a dark panel texel in the facade image, used for flat roofs. */
const ROOF_UV: readonly [number, number] = [0.01, 0.995];

type Vec3 = readonly [number, number, number];

/**
 * Collects static pieces that share one material and merges them into a single geometry, so a
 * whole class of objects costs one draw call. Every piece carries position, normal, uv and a
 * linear RGB `color` attribute (neon brightness, window tint), and is stored relative to
 * `origin` so the merged mesh can be placed and culled as one chunk.
 */
export class GeometryBatch {
  private readonly pieces: T.BufferGeometry[] = [];

  constructor(
    private readonly originX = 0,
    private readonly originZ = 0,
  ) {}

  get size(): number {
    return this.pieces.length;
  }

  /** Adds an axis-aligned box given by its centre and size, optionally rotated around +Y. */
  box(box: PropBox, colour: T.Color = WHITE, yaw = 0): void {
    const geometry = new T.BoxGeometry(box.w, box.h, box.d);
    if (yaw !== 0) geometry.rotateY(yaw);
    geometry.translate(box.x - this.originX, box.y, box.z - this.originZ);
    this.add(geometry, colour);
  }

  /**
   * Adds the four walls of a tier with world-space facade UVs that wrap continuously around
   * the perimeter (so windows turn the corner), plus a flat roof sampling a dark panel texel.
   * `uvScale` stretches the facade tile so storeys and bays vary in size between buildings.
   */
  walls(tier: Tier, uOffset: number, colour: T.Color, uvScale = 1, roof = true): void {
    const x0 = tier.x - tier.w / 2;
    const x1 = tier.x + tier.w / 2;
    const z0 = tier.z - tier.d / 2;
    const z1 = tier.z + tier.d / 2;
    const { y0, y1 } = tier;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let perimeter = uOffset;
    const tileU = FACADE_TILE_U * uvScale;
    const tileV = FACADE_TILE_V * uvScale;

    const quad = (corners: readonly Vec3[], normal: Vec3, faceUvs: readonly number[]) => {
      const base = positions.length / 3;
      for (const corner of corners) {
        positions.push(corner[0] - this.originX, corner[1], corner[2] - this.originZ);
        normals.push(normal[0], normal[1], normal[2]);
      }
      uvs.push(...faceUvs);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    const wall = (a: Vec3, b: Vec3, length: number, normal: Vec3) => {
      const u0 = perimeter / tileU;
      const u1 = (perimeter + length) / tileU;
      const v0 = y0 / tileV;
      const v1 = y1 / tileV;
      quad(
        [
          [a[0], y0, a[2]],
          [b[0], y0, b[2]],
          [b[0], y1, b[2]],
          [a[0], y1, a[2]],
        ],
        normal,
        [u0, v0, u1, v0, u1, v1, u0, v1],
      );
      perimeter += length;
    };

    wall([x0, 0, z1], [x1, 0, z1], tier.w, [0, 0, 1]);
    wall([x1, 0, z1], [x1, 0, z0], tier.d, [1, 0, 0]);
    wall([x1, 0, z0], [x0, 0, z0], tier.w, [0, 0, -1]);
    wall([x0, 0, z0], [x0, 0, z1], tier.d, [-1, 0, 0]);
    if (roof) {
      const [u, v] = ROOF_UV;
      quad(
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
        [0, 1, 0],
        [u, v, u, v, u, v, u, v],
      );
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.add(geometry, colour);
  }

  /** Adds an upright rectangle facing +Z before rotation, with UVs remapped to an atlas cell. */
  panel(
    centre: Vec3,
    width: number,
    height: number,
    yaw: number,
    roll: number,
    uvRect: readonly [number, number, number, number],
  ): void {
    const geometry = new T.PlaneGeometry(width, height);
    const uv = geometry.getAttribute('uv');
    const [u0, v0, u1, v1] = uvRect;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
    if (roll !== 0) geometry.rotateZ(roll);
    if (yaw !== 0) geometry.rotateY(yaw);
    geometry.translate(centre[0] - this.originX, centre[1], centre[2] - this.originZ);
    this.add(geometry, WHITE);
  }

  /** Merges every piece into one geometry and frees the pieces; null when the batch is empty. */
  build(): T.BufferGeometry | null {
    if (this.pieces.length === 0) return null;
    const merged = mergeGeometries(this.pieces, false);
    for (const piece of this.pieces) piece.dispose();
    this.pieces.length = 0;
    if (!merged) throw new Error('City geometry pieces have mismatched attributes.');
    merged.computeBoundingSphere();
    return merged;
  }

  private add(geometry: T.BufferGeometry, colour: T.Color): void {
    const count = geometry.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colours[i * 3] = colour.r;
      colours[i * 3 + 1] = colour.g;
      colours[i * 3 + 2] = colour.b;
    }
    geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
    this.pieces.push(geometry);
  }
}
