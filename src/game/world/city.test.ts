import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { blocks } from '../content';
import {
  BUILDING_SIGN_CELLS,
  CHUNK_GRID,
  CROSSING_OFFSET,
  NearestPoints,
  ROAD_HALF_WIDTH,
  STREET_LINES,
  WINDOW_TINTS,
  benches,
  bollards,
  chunkCentre,
  chunkIndexFor,
  crossingStripes,
  hash01,
  laneDashes,
  lampPosts,
  lodDistances,
  planBuilding,
} from './cityLayout';
import { SIGNS, TERMINAL_SIGN_CELL } from './cityTextures';
import { GeometryBatch } from './geometryBatch';
import { wetSurfaceTargets } from './wetSurface';

const EPSILON = 1e-9;

function insideAnyBuilding(x: number, z: number): boolean {
  return blocks.some(b => Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2);
}

function distanceToStreet(value: number): number {
  return Math.min(...STREET_LINES.map(line => Math.abs(value - line)));
}

test('every building keeps a full-footprint ground tier and tops out at the collider height', () => {
  blocks.forEach((block, index) => {
    const plan = planBuilding(block, index);
    const ground = plan.tiers[0];
    assert.equal(ground.y0, 0);
    assert.ok(Math.abs(ground.w - block.w) < EPSILON && Math.abs(ground.d - block.d) < EPSILON);
    assert.ok(Math.abs(ground.x - block.x) < EPSILON && Math.abs(ground.z - block.z) < EPSILON);
    assert.ok(ground.y1 >= Math.min(block.h, 7.5), `ground tier of block ${index} is too low for signs`);
    const top = Math.max(...plan.tiers.map(t => t.y1));
    assert.ok(Math.abs(top - block.h) < EPSILON, `block ${index} top ${top} != ${block.h}`);
  });
});

test('upper tiers, rooftop plant and signs stay within the physics footprint', () => {
  blocks.forEach((block, index) => {
    const plan = planBuilding(block, index);
    for (const tier of plan.tiers) {
      assert.ok(tier.y1 > tier.y0);
      assert.ok(tier.x - tier.w / 2 >= block.x - block.w / 2 - EPSILON);
      assert.ok(tier.x + tier.w / 2 <= block.x + block.w / 2 + EPSILON);
      assert.ok(tier.z - tier.d / 2 >= block.z - block.d / 2 - EPSILON);
      assert.ok(tier.z + tier.d / 2 <= block.z + block.d / 2 + EPSILON);
    }
    for (const unit of plan.rooftop) {
      assert.ok(Math.abs(unit.x - block.x) <= block.w / 2 && Math.abs(unit.z - block.z) <= block.d / 2);
    }
    for (const sign of plan.signs) {
      assert.ok(sign.cell >= 0 && sign.cell < BUILDING_SIGN_CELLS);
      assert.ok(sign.y - sign.height / 2 > 2, 'signs hang above head height');
    }
    assert.ok(plan.windowTint >= 0 && plan.windowTint < WINDOW_TINTS);
  });
});

test('building plans are deterministic and silhouettes vary', () => {
  const first = blocks.map(planBuilding);
  const second = blocks.map(planBuilding);
  assert.deepEqual(first, second);
  const tierCounts = new Set(first.map(plan => plan.tiers.length));
  assert.ok(tierCounts.size >= 3, 'expected slabs, podium towers and stepped towers');
  assert.equal(hash01(5, 9), hash01(5, 9));
  assert.notEqual(hash01(5, 9), hash01(6, 9));
});

test('the sign atlas has one cell per building sign plus the terminal', () => {
  assert.equal(SIGNS.length, BUILDING_SIGN_CELLS + 1);
  assert.equal(TERMINAL_SIGN_CELL, BUILDING_SIGN_CELLS);
});

test('lamp posts stand on pavements, clear of buildings and intersections', () => {
  const lamps = lampPosts();
  assert.ok(lamps.length > 100);
  for (const lamp of lamps) {
    assert.ok(!insideAnyBuilding(lamp.x, lamp.z), `lamp at ${lamp.x}, ${lamp.z} is inside a tower`);
    const head = Math.hypot(lamp.headX - lamp.x, lamp.headZ - lamp.z);
    assert.ok(Math.abs(head - 1) < EPSILON, 'lamp head reaches one metre over the road');
    const onNorthSouth = lamp.headX !== lamp.x;
    const across = onNorthSouth ? lamp.x : lamp.z;
    const along = onNorthSouth ? lamp.z : lamp.x;
    assert.ok(distanceToStreet(across) > ROAD_HALF_WIDTH, 'pole stands off the carriageway');
    assert.ok(distanceToStreet(along) >= ROAD_HALF_WIDTH + 2, 'pole is not inside an intersection');
    const reference = new T.Vector3(-1, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), lamp.yaw);
    assert.ok(Math.abs(reference.x - (lamp.headX - lamp.x)) < 1e-6);
    assert.ok(Math.abs(reference.z - (lamp.headZ - lamp.z)) < 1e-6);
  }
  for (const bench of benches(lamps)) assert.ok(!insideAnyBuilding(bench.x, bench.z));
  for (const bollard of bollards()) assert.ok(!insideAnyBuilding(bollard.x, bollard.z));
});

test('lane dashes avoid intersections and crossings sit on every approach', () => {
  for (const dash of laneDashes()) {
    const along = dash.sizeZ > dash.sizeX ? dash.z : dash.x;
    assert.ok(distanceToStreet(along) >= CROSSING_OFFSET + 3);
  }
  const stripes = crossingStripes();
  assert.equal(stripes.length % 11, 0);
  const interior = STREET_LINES.filter(line => Math.abs(line) < 180).length;
  assert.ok(stripes.length >= interior * interior * 4 * 11);
});

test('chunks partition the towers four to a pavement block', () => {
  const counts = new Array<number>(CHUNK_GRID * CHUNK_GRID).fill(0);
  for (const block of blocks) {
    const index = chunkIndexFor(block.x, block.z);
    const centre = chunkCentre(index);
    assert.ok(Math.abs(block.x - centre.x) < 30 && Math.abs(block.z - centre.z) < 30);
    counts[index]++;
  }
  assert.ok(counts.every(count => count === 4));
  assert.equal(chunkIndexFor(-1000, -1000), 0);
  assert.equal(chunkIndexFor(1000, 1000), CHUNK_GRID * CHUNK_GRID - 1);
});

test('LOD distances keep every chunk inside the far plane drawn', () => {
  for (const far of [260, 400, 550]) {
    const { detail, cull } = lodDistances(far);
    assert.ok(detail >= 80 && detail <= 140);
    assert.ok(cull > far + 42, 'a chunk whose corner is inside the far plane must not be culled');
    assert.ok(detail < cull);
  }
});

test('nearest points are found closest first without reallocating', () => {
  const xs = [0, 10, -3, 7, 100];
  const zs = [0, 0, 4, 1, 100];
  const finder = new NearestPoints(3);
  const result = finder.find(xs, zs, 6, 0);
  assert.deepEqual([...result], [3, 1, 0]);
  assert.equal(finder.find(xs, zs, 99, 99), result);
  assert.deepEqual([...result], [4, 1, 3]);
  assert.deepEqual([...new NearestPoints(3).find([5], [5], 0, 0)], [0, -1, -1]);
});

test('wet surface targets clamp inputs and disable puddles when dry', () => {
  const dry = wetSurfaceTargets(0, 0);
  assert.equal(dry.wetness, 0);
  assert.equal(dry.darkening, 0);
  assert.ok(dry.puddleThreshold > 1.1, 'no noise value can reach the threshold');
  const storm = wetSurfaceTargets(1, 0.8);
  const drizzle = wetSurfaceTargets(0.7, 0.3);
  assert.ok(storm.puddleThreshold < drizzle.puddleThreshold, 'more puddles lower the threshold');
  assert.ok(storm.darkening > drizzle.darkening && storm.extraReflection > drizzle.extraReflection);
  assert.deepEqual(wetSurfaceTargets(5, 5), wetSurfaceTargets(1, 1));
  assert.deepEqual(wetSurfaceTargets(-1, -1), dry);
});

test('geometry batches merge pieces with outward-facing walls and per-piece colour', () => {
  const batch = new GeometryBatch(10, 20);
  const tint = new T.Color(0.5, 0.25, 1);
  batch.walls({ x: 10, z: 20, w: 4, d: 6, y0: 0, y1: 8 }, 0, tint);
  batch.box({ x: 10, y: 9, z: 20, w: 1, h: 1, d: 1 });
  const geometry = batch.build();
  assert.ok(geometry);
  assert.equal(batch.size, 0);
  const position = geometry.getAttribute('position');
  const colour = geometry.getAttribute('color');
  assert.equal(position.count, 5 * 4 + 24);
  assert.equal(colour.getX(0), 0.5);
  assert.equal(colour.getZ(0), 1);
  assert.equal(colour.getX(position.count - 1), 1);

  const index = geometry.getIndex();
  assert.ok(index);
  const a = new T.Vector3();
  const b = new T.Vector3();
  const c = new T.Vector3();
  const normal = geometry.getAttribute('normal');
  for (let i = 0; i < 5 * 6; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    const face = b.sub(a).cross(c.sub(a)).normalize();
    const expected = new T.Vector3().fromBufferAttribute(normal, index.getX(i));
    assert.ok(face.dot(expected) > 0.999, `triangle ${i / 3} winds against its normal`);
  }
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox);
  assert.ok(Math.abs(geometry.boundingBox.min.x + 2) < EPSILON, 'pieces are stored relative to the origin');
});
