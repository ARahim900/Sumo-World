import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { MOON_DIRECTION, snapToShadowTexel } from './lighting';
import {
  BASE_ENVIRONMENT_INTENSITY,
  BASE_EXPOSURE,
  BASE_HEMISPHERE_INTENSITY,
  environmentIntensityFor,
  exposureFor,
  hemisphereIntensityFor,
  marchGrowth,
  reflectionStrengthFor,
} from './look';

const DRY = { wetness: 0, puddles: 0, lightning: 0 };
const SOAKED = { wetness: 1, puddles: 1, lightning: 0 };

test('dry, calm weather keeps the base exposure and light levels', () => {
  assert.equal(exposureFor(DRY), BASE_EXPOSURE);
  assert.equal(environmentIntensityFor(DRY), BASE_ENVIRONMENT_INTENSITY);
  assert.equal(hemisphereIntensityFor(DRY), BASE_HEMISPHERE_INTENSITY);
  assert.equal(reflectionStrengthFor(DRY), 0);
});

test('wetness dims exposure slightly and strengthens reflections', () => {
  assert.ok(exposureFor(SOAKED) < BASE_EXPOSURE);
  assert.ok(exposureFor(SOAKED) > BASE_EXPOSURE * 0.85);
  assert.ok(environmentIntensityFor(SOAKED) > BASE_ENVIRONMENT_INTENSITY);
  assert.equal(reflectionStrengthFor(SOAKED), 1);
  assert.ok(reflectionStrengthFor({ wetness: 1, puddles: 0, lightning: 0 }) < 1);
});

test('lightning flashes raise exposure and skylight', () => {
  const flash = { wetness: 0, puddles: 0, lightning: 1 };
  assert.ok(exposureFor(flash) > BASE_EXPOSURE * 2);
  assert.ok(hemisphereIntensityFor(flash) > BASE_HEMISPHERE_INTENSITY * 2);
});

test('out-of-range weather values are clamped', () => {
  const wild = { wetness: 3, puddles: -2, lightning: -1 };
  assert.equal(exposureFor(wild), exposureFor({ wetness: 1, puddles: 0, lightning: 0 }));
  assert.equal(reflectionStrengthFor(wild), 0.6);
});

test('march growth makes the geometric steps cover the requested distance', () => {
  for (const steps of [12, 16, 24]) {
    const growth = marchGrowth(steps, 0.2, 60);
    let covered = 0;
    let step = 0.2;
    for (let i = 0; i < steps; i++) {
      covered += step;
      step *= growth;
    }
    assert.ok(Math.abs(covered - 60) < 1e-6, `${steps} steps covered ${covered}`);
  }
  assert.equal(marchGrowth(1, 0.2, 60), 1);
  assert.equal(marchGrowth(10, 10, 60), 1);
});

test('shadow focus snapping stays within one texel and is stable inside a texel', () => {
  const texel = 0.05;
  const focus = new Vector3(12.34, 0.5, -7.81);
  const snapped = snapToShadowTexel(focus, MOON_DIRECTION, texel, new Vector3());
  const offset = snapped.clone().sub(focus);
  assert.ok(Math.abs(offset.dot(MOON_DIRECTION)) < 1e-9, 'depth along the light is unchanged');
  assert.ok(offset.length() <= texel * Math.SQRT1_2 + 1e-9);

  const again = snapToShadowTexel(snapped, MOON_DIRECTION, texel, new Vector3());
  assert.ok(again.distanceTo(snapped) < 1e-9, 'snapping is idempotent');

  const nudged = snapped.clone().addScaledVector(MOON_DIRECTION, 3);
  const nudgedSnap = snapToShadowTexel(nudged, MOON_DIRECTION, texel, new Vector3());
  assert.ok(nudgedSnap.distanceTo(nudged) < 1e-9, 'moving along the light never shifts the grid');
});
