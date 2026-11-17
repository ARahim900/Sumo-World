import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdaptiveResolution,
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  pixelRatioFor,
  qualitySettings,
  renderTuning,
} from './quality';

const FRAME_60 = 1 / 60;
const FRAME_30 = 1 / 30;

function run(adaptive: AdaptiveResolution, dt: number, seconds: number): number {
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) adaptive.update(dt);
  return adaptive.scale;
}

test('default preset keeps the original resolution, bloom, draw distance and rain budget', () => {
  const high = qualitySettings(DEFAULT_QUALITY);
  assert.equal(high.preset, 'high');
  assert.equal(high.pixelRatioCap, 1.5);
  assert.equal(high.bloom, true);
  assert.equal(high.drawDistance, 550);
  assert.equal(high.rainParticles, 1800);
});

test('presets scale monotonically and return caller-owned copies', () => {
  const settings = QUALITY_PRESETS.map(qualitySettings);
  for (let i = 1; i < settings.length; i++) {
    assert.ok(settings[i].pixelRatioCap >= settings[i - 1].pixelRatioCap);
    assert.ok(settings[i].rainParticles >= settings[i - 1].rainParticles);
    assert.ok(settings[i].drawDistance >= settings[i - 1].drawDistance);
    assert.ok(settings[i].shadowMapSize >= settings[i - 1].shadowMapSize);
  }
  const copy = qualitySettings('low');
  copy.rainParticles = 1;
  assert.equal(qualitySettings('low').rainParticles, 600);
});

test('low disables shadows and screen-space effects and uses FXAA', () => {
  const low = qualitySettings('low');
  assert.equal(low.shadows, false);
  assert.equal(low.ssao, false);
  assert.equal(low.ssr, false);
  assert.equal(low.aa, 'fxaa');
  assert.equal(renderTuning('low').shadowExtent, 0);
});

test('ambient occlusion runs on high and above, reflections only on ultra', () => {
  assert.deepEqual(
    QUALITY_PRESETS.map(preset => qualitySettings(preset).ssao),
    [false, false, true, true],
  );
  assert.deepEqual(
    QUALITY_PRESETS.map(preset => qualitySettings(preset).ssr),
    [false, false, false, true],
  );
  for (const preset of QUALITY_PRESETS) {
    const settings = qualitySettings(preset);
    if (settings.ssr) assert.ok(renderTuning(preset).reflectionSteps > 0);
    if (settings.shadows) assert.ok(renderTuning(preset).shadowExtent > 0);
  }
});

test('pixel ratio is capped by the preset and only ever scaled down', () => {
  const high = qualitySettings('high');
  assert.equal(pixelRatioFor(3, high), 1.5);
  assert.equal(pixelRatioFor(1, high), 1);
  assert.equal(pixelRatioFor(2, high, 0.5), 0.75);
  assert.equal(pixelRatioFor(2, high, 1.4), 1.5);
});

test('adaptive resolution stays at full scale while disabled', () => {
  const adaptive = new AdaptiveResolution({ enabled: false });
  assert.equal(run(adaptive, 0.1, 30), 1);
});

test('adaptive resolution is enabled by default and holds full scale at 60 fps', () => {
  const adaptive = new AdaptiveResolution();
  assert.equal(adaptive.enabled, true);
  assert.equal(run(adaptive, FRAME_60, 20), 1);
});

test('adaptive resolution lowers scale under load and respects the floor', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.6, step: 0.1, interval: 0.5 });
  assert.equal(run(adaptive, 0.05, 10), 0.6);
});

test('adaptive resolution recovers on a 60 Hz display, where frames never beat 16.7 ms', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.6, recoverDelay: 2 });
  run(adaptive, FRAME_30, 5);
  assert.equal(adaptive.scale, 0.6);
  assert.equal(run(adaptive, FRAME_60, 15), 1);
});

test('a failed recovery doubles the wait before the next attempt, up to the maximum', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.8, step: 0.2, recoverDelay: 2, maxRecoverDelay: 4 });
  run(adaptive, FRAME_30, 2);
  assert.equal(adaptive.scale, 0.8);
  for (let attempt = 0; attempt < 3; attempt++) {
    while (adaptive.scale < 1) adaptive.update(FRAME_60);
    run(adaptive, FRAME_30, 1.5);
    assert.equal(adaptive.scale, 0.8);
  }
  assert.equal(adaptive.recoverDelay, 4);
});

test('a recovery that holds resets the wait to its base value', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.8, step: 0.2, recoverDelay: 2 });
  run(adaptive, FRAME_30, 2);
  while (adaptive.scale < 1) adaptive.update(FRAME_60);
  run(adaptive, FRAME_30, 1.5);
  assert.equal(adaptive.recoverDelay, 4);
  while (adaptive.scale < 1) adaptive.update(FRAME_60);
  run(adaptive, FRAME_60, 5);
  assert.equal(adaptive.recoverDelay, 2);
});

test('reset restores full scale and the base recovery delay', () => {
  const adaptive = new AdaptiveResolution();
  run(adaptive, 0.05, 5);
  assert.ok(adaptive.scale < 1);
  adaptive.reset();
  assert.equal(adaptive.scale, 1);
  assert.equal(adaptive.recoverDelay, 2);
});
