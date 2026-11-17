import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation } from '../physics';
import {
  CAR_MATERIAL_ROLES,
  CAR_MODEL_URL,
  REQUIRED_NODES,
  WHEEL_KEYS,
  flakeNormalData,
  isCarMaterialRole,
  materialTierFor,
  wheelKey,
} from './carAsset';

const MODEL_PATH = join(process.cwd(), 'public', CAR_MODEL_URL);
const MAX_MODEL_BYTES = 1.5 * 1024 * 1024;

interface GltfNode {
  name?: string;
  translation?: [number, number, number];
  scale?: [number, number, number];
}

interface GltfDocument {
  nodes: GltfNode[];
  materials: { name?: string }[];
  images?: unknown[];
}

/** Reads the JSON chunk of a binary glTF file. */
function readGlb(path: string): GltfDocument {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString('latin1', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('latin1', 16, 20), 'JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength)) as GltfDocument;
}

test('car model is a small glTF with every named part and material role', () => {
  assert.ok(statSync(MODEL_PATH).size < MAX_MODEL_BYTES);
  const gltf = readGlb(MODEL_PATH);
  const nodeNames = new Set(gltf.nodes.map(node => node.name));
  for (const name of REQUIRED_NODES) assert.ok(nodeNames.has(name), `missing node ${name}`);
  const materialNames = gltf.materials.map(material => material.name ?? '');
  for (const role of CAR_MATERIAL_ROLES) assert.ok(materialNames.includes(role), `missing ${role}`);
  assert.ok(materialNames.every(isCarMaterialRole));
  assert.equal((gltf.images ?? []).length, 0, 'the model should carry no textures');
});

test('modelled wheel hubs sit on the physics wheel anchors at rest', async () => {
  const gltf = readGlb(MODEL_PATH);
  const sim = await Simulation.create();
  try {
    for (const anchor of sim.wheelAnchors) {
      const key = wheelKey(anchor.x, anchor.z);
      for (const prefix of ['wheel', 'caliper']) {
        const node = gltf.nodes.find(candidate => candidate.name === `${prefix}_${key}`);
        assert.ok(node?.translation, `${prefix}_${key} needs a hub translation`);
        const [x, y, z] = node.translation;
        assert.ok(Math.abs(x - anchor.x) < 1e-3);
        assert.ok(Math.abs(z - anchor.z) < 1e-3);
        // Hub height at rest: the anchor minus a partly compressed suspension.
        assert.ok(y < anchor.y - 0.2 && y > anchor.y - 0.32, `${prefix}_${key} hub height ${y}`);
        const mirrored = (node.scale?.[0] ?? 1) < 0;
        assert.equal(mirrored, anchor.x < 0, `${prefix}_${key} must face outwards`);
      }
    }
  } finally {
    sim.dispose();
  }
});

test('wheel keys name corners for a car facing +Z', () => {
  assert.equal(wheelKey(0.89, 1.42), 'fl');
  assert.equal(wheelKey(-0.89, 1.42), 'fr');
  assert.equal(wheelKey(0.89, -1.38), 'rl');
  assert.equal(wheelKey(-0.89, -1.38), 'rr');
  assert.deepEqual([...WHEEL_KEYS].sort(), ['fl', 'fr', 'rl', 'rr']);
});

test('quality presets map to material tiers', () => {
  assert.equal(materialTierFor('low'), 'basic');
  assert.equal(materialTierFor('medium'), 'physical');
  assert.equal(materialTierFor('high'), 'physical');
  assert.equal(materialTierFor('ultra'), 'transmissive');
});

test('flake normals are deterministic, unit length and mostly facing out', () => {
  const size = 16;
  const first = flakeNormalData(size, 7);
  assert.deepEqual(first, flakeNormalData(size, 7));
  assert.notDeepEqual(first, flakeNormalData(size, 8));
  for (let i = 0; i < size * size; i++) {
    const [x, y, z] = [0, 1, 2].map(c => (first[i * 4 + c] / 255) * 2 - 1);
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 0.02);
    assert.ok(z > 0.75);
    assert.equal(first[i * 4 + 3], 255);
  }
});
