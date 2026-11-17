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

/** Frame time in seconds for a given resolution scale. */
type FrameModel = (scale: number) => number;

/** CPU cost plus a GPU cost proportional to the pixel count (scale squared), in milliseconds. */
function load(cpuMs: number, gpuMs: number): FrameModel {
  return scale => (cpuMs + gpuMs * scale * scale) / 1000;
}

/** Feeds frames whose length depends on the current scale; returns the share of time at full scale. */
function simulate(adaptive: AdaptiveResolution, model: FrameModel, seconds: number): number {
  let time = 0;
  let atFull = 0;
  while (time < seconds) {
    const dt = model(adaptive.scale);
    if (adaptive.scale === 1) atFull += dt;
    adaptive.update(dt);
    time += dt;
  }
  return atFull / time;
}

const GPU_BOUND = load(2, 60);
/** Over budget at full scale, comfortably on budget at 0.8. */
const EDGE = load(2, 22);
const LIGHT = load(2, 10);

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

test('adaptive resolution lowers scale under GPU load and respects the floor', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.6, step: 0.1, interval: 0.5 });
  simulate(adaptive, GPU_BOUND, 10);
  assert.equal(adaptive.scale, 0.6);
  assert.equal(adaptive.dropHold, 0);
});

test('adaptive resolution stops lowering once frames are back on budget', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.5, step: 0.1 });
  simulate(adaptive, load(4, 30), 10);
  assert.equal(adaptive.scale, 0.7);
});

test('adaptive resolution recovers on a 60 Hz display, where frames never beat 16.7 ms', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.6, recoverDelay: 2 });
  simulate(adaptive, GPU_BOUND, 5);
  assert.equal(adaptive.scale, 0.6);
  assert.equal(run(adaptive, FRAME_60, 15), 1);
});

test('a refresh-capped 30 fps display keeps full resolution', () => {
  const adaptive = new AdaptiveResolution();
  run(adaptive, FRAME_30, 6);
  assert.equal(adaptive.scale, 1, 'the drop that did not help is undone');
  assert.ok(adaptive.dropHold > 0);
  run(adaptive, FRAME_30, 120);
  const share = simulate(adaptive, () => FRAME_30, 120);
  assert.ok(share > 0.9, `full scale for ${(share * 100).toFixed(0)}% of the time`);
});

test('a CPU-bound frame keeps full resolution', () => {
  const adaptive = new AdaptiveResolution();
  simulate(adaptive, load(30, 3), 6);
  assert.equal(adaptive.scale, 1);
  assert.ok(adaptive.dropHold > 0);
});

test('the hold after a drop that did not help doubles up to its maximum', () => {
  const adaptive = new AdaptiveResolution({ noGainHold: 4, maxNoGainHold: 8 });
  const holds: number[] = [];
  let previous = 0;
  for (let time = 0; time < 60; time += FRAME_30) {
    adaptive.update(FRAME_30);
    if (adaptive.dropHold > previous) holds.push(Math.round(adaptive.dropHold));
    previous = adaptive.dropHold;
  }
  assert.deepEqual(holds.slice(0, 4), [4, 8, 8, 8]);
});

test('a failed recovery doubles the wait before the next attempt, up to the maximum', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.8, step: 0.2, recoverDelay: 2, maxRecoverDelay: 4 });
  simulate(adaptive, EDGE, 2);
  assert.equal(adaptive.scale, 0.8);
  for (let attempt = 0; attempt < 3; attempt++) {
    while (adaptive.scale < 1) adaptive.update(EDGE(adaptive.scale));
    simulate(adaptive, EDGE, 1.5);
    assert.equal(adaptive.scale, 0.8);
  }
  assert.equal(adaptive.recoverDelay, 4);
});

test('a recovery that holds resets the wait to its base value', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.8, step: 0.2, recoverDelay: 2 });
  simulate(adaptive, EDGE, 2);
  while (adaptive.scale < 1) adaptive.update(EDGE(adaptive.scale));
  simulate(adaptive, EDGE, 1.5);
  assert.equal(adaptive.recoverDelay, 4);
  while (adaptive.scale < 1) adaptive.update(LIGHT(adaptive.scale));
  simulate(adaptive, LIGHT, 5);
  assert.equal(adaptive.scale, 1);
  assert.equal(adaptive.recoverDelay, 2);
});

test('reset restores full scale, the base recovery delay and the drop hold', () => {
  const adaptive = new AdaptiveResolution();
  simulate(adaptive, GPU_BOUND, 5);
  assert.ok(adaptive.scale < 1);
  adaptive.reset();
  assert.equal(adaptive.scale, 1);
  assert.equal(adaptive.recoverDelay, 2);
  run(adaptive, FRAME_30, 6);
  adaptive.reset();
  assert.equal(adaptive.dropHold, 0);
});

test('GPU-bound frames quantised to a 60 Hz refresh still reach a scale that fits', () => {
  const refresh = 1 / 60;
  const quantised: FrameModel = scale => Math.ceil(load(4, 30)(scale) / refresh - 1e-9) * refresh;
  const adaptive = new AdaptiveResolution();
  const share = simulate(adaptive, quantised, 20);
  assert.ok(share < 0.1, 'single steps show no change, but the floor does, so the drop is kept');
  assert.ok(adaptive.scale <= 0.7);
  assert.equal(adaptive.dropHold, 0);
});

test('ultra computes ambient occlusion at half resolution', () => {
  assert.equal(renderTuning('ultra').aoScale, 0.5);
});
