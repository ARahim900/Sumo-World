/**
 * Pure layout rules for the district: where streets, lamps, road markings, street furniture
 * and building silhouettes go. Nothing here touches three.js or the DOM, so it is unit tested
 * in node and can be read by physics if props ever gain colliders.
 */
import type { Block } from '../content';

/** Centre lines of the north-south and east-west streets (the same values on both axes). */
export const STREET_LINES: readonly number[] = [-180, -120, -60, 0, 60, 120, 180];

/** Half the carriageway width; pavements start just beyond it. */
export const ROAD_HALF_WIDTH = 8;

/** Half the edge length of each square pavement block. */
export const PAVEMENT_HALF = 22;

/** Centres of the 6 x 6 pavement blocks on each axis. */
export const BLOCK_CENTRES: readonly number[] = [-150, -90, -30, 30, 90, 150];

/** Distance from a street's centre line to its lamp poles. */
export const LAMP_OFFSET = 9;

/** Lamp spacing along a street. */
export const LAMP_SPACING = 24;

/** Height of a lamp head above the ground. */
export const LAMP_HEAD_HEIGHT = 5.93;

/** Lamps, markings and furniture stay inside this half-extent (the perimeter wall is at 199). */
export const DISTRICT_HALF = 192;

/** Distance from an intersection centre to the middle of its zebra crossings. */
export const CROSSING_OFFSET = 10;

export type NeonColour = 'cyan' | 'pink';

export type StreetAxis = 'x' | 'z';

export interface LampPost {
  /** Pole base position. */
  x: number;
  z: number;
  /** Lamp head position (the arm reaches back over the carriageway). */
  headX: number;
  headZ: number;
  /** Rotation around +Y that turns the reference lamp (arm pointing to -X) into this one. */
  yaw: number;
  colour: NeonColour;
}

/** A flat road marking: centre and size on the ground plane. */
export interface Marking {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
}

/** A centre-anchored box. */
export interface PropBox {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

/** A small prop on the ground: position and rotation around +Y. */
export interface GroundProp {
  x: number;
  z: number;
  yaw: number;
}

/** One stacked prism of a building: footprint centre, size and vertical span. */
export interface Tier {
  x: number;
  z: number;
  w: number;
  d: number;
  y0: number;
  y1: number;
}

export interface NeonTrim {
  box: PropBox;
  colour: NeonColour;
}

/** A sign panel: centre, size, rotation and which atlas cell it shows. */
export interface SignPlacement {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  /** Rotation around +Y; 0 faces +Z. */
  yaw: number;
  /** Rotation around the panel normal, for vertical blade signs. */
  roll: number;
  cell: number;
}

export interface BuildingPlan {
  /** Ground tier first; its footprint always matches the physics collider. */
  tiers: Tier[];
  /** Parapets and ledges at the top of each tier. */
  caps: PropBox[];
  /** Plant rooms, water tanks and antenna masts on the roof. */
  rooftop: PropBox[];
  neon: NeonTrim[];
  signs: SignPlacement[];
  /** Index into the window colour palette. */
  windowTint: number;
  /** Window brightness multiplier, around 1. */
  windowLevel: number;
  /** Horizontal facade texture offset in metres so neighbouring towers do not line up. */
  uOffset: number;
}

/** Number of window palette entries the plan may index. */
export const WINDOW_TINTS = 4;

/** Distinct fictional sign cells in the atlas available to buildings. */
export const BUILDING_SIGN_CELLS = 7;

const MIN_GROUND_TIER = 7.5;

/** Deterministic 0..1 hash so the layout never consumes the shared content RNG. */
export function hash01(index: number, salt: number): number {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function nearestStreetDistance(value: number): number {
  let best = Infinity;
  for (const line of STREET_LINES) best = Math.min(best, Math.abs(value - line));
  return best;
}

/** Lamp posts lining every street, skipping intersections and the far side of perimeter streets. */
export function lampPosts(): LampPost[] {
  const lamps: LampPost[] = [];
  for (const axis of ['z', 'x'] as const) {
    // East-west lamps are staggered half a spacing so corners do not double up.
    const start = axis === 'z' ? -180 : -168;
    for (const line of STREET_LINES) {
      for (const side of [-1, 1]) {
        const across = line + side * LAMP_OFFSET;
        if (Math.abs(across) > DISTRICT_HALF - 4) continue;
        for (let along = start; along <= 180; along += LAMP_SPACING) {
          if (nearestStreetDistance(along) < ROAD_HALF_WIDTH + 2) continue;
          const headAcross = across - side;
          const colour: NeonColour = side < 0 ? 'cyan' : 'pink';
          if (axis === 'z') {
            lamps.push({ x: across, z: along, headX: headAcross, headZ: along, yaw: side > 0 ? 0 : Math.PI, colour });
          } else {
            lamps.push({
              x: along,
              z: across,
              headX: along,
              headZ: headAcross,
              yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
              colour,
            });
          }
        }
      }
    }
  }
  return lamps;
}

/** Kerbside benches beside every other lamp, in the strip between the kerb and the frontages. */
export function benches(lamps: readonly LampPost[]): GroundProp[] {
  const props: GroundProp[] = [];
  for (let i = 0; i < lamps.length; i += 2) {
    const lamp = lamps[i];
    const awayX = lamp.x - lamp.headX;
    const awayZ = lamp.z - lamp.headZ;
    if (awayX !== 0) props.push({ x: lamp.x - awayX * 0.45, z: lamp.z + 3, yaw: 0 });
    else props.push({ x: lamp.x + 3, z: lamp.z - awayZ * 0.45, yaw: Math.PI / 2 });
  }
  return props;
}

/** Short bollards guarding each pavement corner. */
export function bollards(): GroundProp[] {
  const props: GroundProp[] = [];
  const inset = PAVEMENT_HALF - 0.6;
  for (const cx of BLOCK_CENTRES) {
    for (const cz of BLOCK_CENTRES) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          for (const step of [2.5, 4.5]) {
            props.push({ x: cx + sx * inset, z: cz + sz * (inset - step), yaw: 0 });
            props.push({ x: cx + sx * (inset - step), z: cz + sz * inset, yaw: 0 });
          }
        }
      }
    }
  }
  return props;
}

/** Dashed centre lines, kept clear of intersections and crossings. */
export function laneDashes(): Marking[] {
  const dashes: Marking[] = [];
  const clearance = CROSSING_OFFSET + 3;
  for (const line of STREET_LINES) {
    for (let along = -190.5; along <= 190.5; along += 9) {
      if (nearestStreetDistance(along) < clearance) continue;
      dashes.push({ x: line, z: along, sizeX: 0.12, sizeZ: 3 });
      dashes.push({ x: along, z: line, sizeX: 3, sizeZ: 0.12 });
    }
  }
  return dashes;
}

/** Zebra crossings on every approach to every intersection inside the perimeter. */
export function crossingStripes(): Marking[] {
  const stripes: Marking[] = [];
  for (const sx of STREET_LINES) {
    for (const sz of STREET_LINES) {
      for (const side of [-1, 1]) {
        const alongZ = sz + side * CROSSING_OFFSET;
        if (Math.abs(alongZ) <= DISTRICT_HALF - 4) {
          for (let i = -5; i <= 5; i++) stripes.push({ x: sx + i * 1.1, z: alongZ, sizeX: 0.55, sizeZ: 2.7 });
        }
        const alongX = sx + side * CROSSING_OFFSET;
        if (Math.abs(alongX) <= DISTRICT_HALF - 4) {
          for (let i = -5; i <= 5; i++) stripes.push({ x: alongX, z: sz + i * 1.1, sizeX: 2.7, sizeZ: 0.55 });
        }
      }
    }
  }
  return stripes;
}

/** Kerb neon strips along the four edges of every pavement block. */
export function kerbStrips(): NeonTrim[] {
  const trims: NeonTrim[] = [];
  for (const x of BLOCK_CENTRES) {
    for (const z of BLOCK_CENTRES) {
      for (const s of [-1, 1]) {
        trims.push({
          box: { x, y: 0.115, z: z + s * PAVEMENT_HALF, w: 44, h: 0.035, d: 0.12 },
          colour: s > 0 ? 'cyan' : 'pink',
        });
        trims.push({
          box: { x: x + s * PAVEMENT_HALF, y: 0.115, z, w: 0.12, h: 0.035, d: 44 },
          colour: s > 0 ? 'pink' : 'cyan',
        });
      }
    }
  }
  return trims;
}

function tier(block: Block, scaleW: number, scaleD: number, shiftX: number, shiftZ: number, y0: number, y1: number): Tier {
  const w = block.w * scaleW;
  const d = block.d * scaleD;
  const maxShiftX = (block.w - w) / 2;
  const maxShiftZ = (block.d - d) / 2;
  return {
    x: block.x + shiftX * maxShiftX,
    z: block.z + shiftZ * maxShiftZ,
    w,
    d,
    y0,
    y1,
  };
}

function silhouette(block: Block, index: number): Tier[] {
  const h = block.h;
  const r = (salt: number) => hash01(index, salt);
  switch (block.style) {
    case 1: {
      const podium = Math.min(h, MIN_GROUND_TIER + r(1) * 4);
      if (h - podium < 6) return [tier(block, 1, 1, 0, 0, 0, h)];
      const scale = 0.7 + r(2) * 0.12;
      return [
        tier(block, 1, 1, 0, 0, 0, podium),
        tier(block, scale, scale, r(3) * 2 - 1, r(4) * 2 - 1, podium, h),
      ];
    }
    case 2: {
      const first = Math.max(MIN_GROUND_TIER, h * 0.55);
      if (h < 30) {
        return [tier(block, 1, 1, 0, 0, 0, first), tier(block, 0.78, 0.78, 0, 0, first, h)];
      }
      const second = h * 0.8;
      return [
        tier(block, 1, 1, 0, 0, 0, first),
        tier(block, 0.8, 0.8, 0, 0, first, second),
        tier(block, 0.58, 0.58, 0, 0, second, h),
      ];
    }
    case 3: {
      const podium = Math.min(h, MIN_GROUND_TIER + r(5) * 3);
      if (h - podium < 10) return [tier(block, 1, 1, 0, 0, 0, h)];
      const side = r(6) < 0.5 ? -1 : 1;
      const twin = podium + (h - podium) * (0.5 + r(7) * 0.2);
      return [
        tier(block, 1, 1, 0, 0, 0, podium),
        tier(block, 0.5, 0.86, side, 0, podium, h),
        tier(block, 0.4, 0.7, -side, r(8) * 2 - 1, podium, twin),
      ];
    }
    default:
      return [tier(block, 1, 1, 0, 0, 0, h)];
  }
}

function tallest(tiers: readonly Tier[]): Tier {
  let best = tiers[0];
  for (const t of tiers) if (t.y1 > best.y1) best = t;
  return best;
}

function rooftopFor(top: Tier, index: number): PropBox[] {
  const boxes: PropBox[] = [];
  const count = 1 + Math.floor(hash01(index, 20) * 3);
  const margin = 1.6;
  for (let i = 0; i < count; i++) {
    const w = Math.min(top.w - margin * 2, 2.4 + hash01(index, 21 + i) * 2.2);
    const d = Math.min(top.d - margin * 2, 2.4 + hash01(index, 31 + i) * 2.2);
    const h = 1.1 + hash01(index, 41 + i) * 1.4;
    if (w <= 0.5 || d <= 0.5) continue;
    const spanX = (top.w - w) / 2 - margin;
    const spanZ = (top.d - d) / 2 - margin;
    boxes.push({
      x: top.x + (hash01(index, 51 + i) * 2 - 1) * Math.max(0, spanX),
      y: top.y1 + h / 2,
      z: top.z + (hash01(index, 61 + i) * 2 - 1) * Math.max(0, spanZ),
      w,
      h,
      d,
    });
  }
  return boxes;
}

/** Turns a physics block into a varied, deterministic building silhouette with trim and signage. */
export function planBuilding(block: Block, index: number): BuildingPlan {
  const tiers = silhouette(block, index);
  const top = tallest(tiers);
  const neonColour: NeonColour = block.style % 2 ? 'pink' : 'cyan';

  const caps: PropBox[] = tiers.map(t => ({
    x: t.x,
    y: t.y1 + 0.15,
    z: t.z,
    w: t.w + 0.3,
    h: 0.3,
    d: t.d + 0.3,
  }));

  const rooftop = rooftopFor(top, index);
  const neon: NeonTrim[] = [];
  const ground = tiers[0];
  neon.push({
    box: { x: ground.x - ground.w / 2 - 0.03, y: ground.y1 / 2, z: ground.z + ground.d / 2, w: 0.12, h: ground.y1, d: 0.12 },
    colour: neonColour,
  });
  if (top !== ground) {
    const height = top.y1 - top.y0;
    neon.push({
      box: { x: top.x + top.w / 2 + 0.03, y: top.y0 + height / 2, z: top.z + top.d / 2, w: 0.12, h: height, d: 0.12 },
      colour: neonColour,
    });
  }
  if (index % 3 === 0) {
    const bandY = block.h * 0.75;
    const host = tiers.find(t => t.y0 <= bandY && t.y1 >= bandY) ?? top;
    neon.push({ box: { x: host.x, y: bandY, z: host.z, w: host.w + 0.2, h: 0.18, d: host.d + 0.2 }, colour: neonColour });
  }
  if (index % 4 === 0) {
    const mastX = top.x + top.w * 0.25;
    const mastZ = top.z - top.d * 0.2;
    rooftop.push({ x: mastX, y: top.y1 + 4, z: mastZ, w: 0.09, h: 8, d: 0.09 });
    neon.push({ box: { x: mastX, y: top.y1 + 8.1, z: mastZ, w: 0.2, h: 0.3, d: 0.2 }, colour: 'pink' });
  }

  const signs: SignPlacement[] = [];
  if (index % 3 === 0) {
    signs.push({
      x: block.x,
      y: 5.5,
      z: block.z + block.d / 2 + 0.03,
      width: 8,
      height: 2,
      yaw: 0,
      roll: 0,
      cell: index % BUILDING_SIGN_CELLS,
    });
  }
  if (index % 5 === 1) {
    const centre = Math.max(5.2, Math.min(ground.y1 - 2.6, 9));
    signs.push({
      x: block.x + block.w / 2 + 0.03,
      y: centre,
      z: block.z + block.d * 0.2,
      width: 4.4,
      height: 1.1,
      yaw: Math.PI / 2,
      roll: Math.PI / 2,
      cell: (index + 3) % BUILDING_SIGN_CELLS,
    });
  }

  const dim = hash01(index, 70) < 0.2;
  return {
    tiers,
    caps,
    rooftop,
    neon,
    signs,
    windowTint: Math.floor(hash01(index, 71) * WINDOW_TINTS),
    windowLevel: dim ? 0.45 : 0.8 + hash01(index, 72) * 0.5,
    uOffset: hash01(index, 73) * 40,
  };
}

/** Edge length of one culling/LOD chunk: one pavement block and its four towers. */
export const CHUNK_SIZE = 60;
export const CHUNK_GRID = BLOCK_CENTRES.length;

/** Chunk index (row-major, 0..CHUNK_GRID^2-1) containing a world position. */
export function chunkIndexFor(x: number, z: number): number {
  const clampCell = (value: number) =>
    Math.min(CHUNK_GRID - 1, Math.max(0, Math.round((value - BLOCK_CENTRES[0]) / CHUNK_SIZE)));
  return clampCell(z) * CHUNK_GRID + clampCell(x);
}

/** Centre of a chunk on the ground plane. */
export function chunkCentre(index: number): { x: number; z: number } {
  return {
    x: BLOCK_CENTRES[index % CHUNK_GRID],
    z: BLOCK_CENTRES[Math.floor(index / CHUNK_GRID)],
  };
}

export interface LodDistances {
  /** Beyond this distance from a chunk centre, rooftop and ledge detail is dropped. */
  detail: number;
  /** Beyond this distance a chunk is not drawn at all. */
  cull: number;
}

/** Chunk LOD switch distances for a camera far plane, keeping every visible chunk drawn. */
export function lodDistances(drawDistance: number): LodDistances {
  const chunkRadius = CHUNK_SIZE * Math.SQRT1_2;
  return {
    detail: Math.min(140, Math.max(80, drawDistance * 0.2)),
    cull: drawDistance + chunkRadius + 4,
  };
}

/** Finds the k nearest points to a position without allocating per call. */
export class NearestPoints {
  private readonly indices: number[];
  private readonly distances: number[];

  constructor(readonly count: number) {
    this.indices = new Array<number>(count).fill(-1);
    this.distances = new Array<number>(count).fill(Infinity);
  }

  /** Returns indices of the nearest points, closest first; unused slots are -1. */
  find(xs: ArrayLike<number>, zs: ArrayLike<number>, x: number, z: number): readonly number[] {
    const { indices, distances, count } = this;
    indices.fill(-1);
    distances.fill(Infinity);
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - x;
      const dz = zs[i] - z;
      const distance = dx * dx + dz * dz;
      if (distance >= distances[count - 1]) continue;
      let slot = count - 1;
      while (slot > 0 && distances[slot - 1] > distance) {
        distances[slot] = distances[slot - 1];
        indices[slot] = indices[slot - 1];
        slot--;
      }
      distances[slot] = distance;
      indices[slot] = i;
    }
    return indices;
  }
}
