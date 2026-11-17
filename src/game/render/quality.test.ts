import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolution, DEFAULT_QUALITY, QUALITY_PRESETS, pixelRatioFor, qualitySettings } from './quality';

test('default preset reproduces the original renderer settings', () => {
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
  }
  const copy = qualitySettings('low');
  copy.rainParticles = 1;
  assert.equal(qualitySettings('low').rainParticles, 600);
});

test('pixel ratio is capped by the preset and scaled by adaptive resolution', () => {
  const high = qualitySettings('high');
  assert.equal(pixelRatioFor(3, high), 1.5);
  assert.equal(pixelRatioFor(1, high), 1);
  assert.equal(pixelRatioFor(2, high, 0.5), 0.75);
});

test('adaptive resolution stays at full scale while disabled', () => {
  const adaptive = new AdaptiveResolution();
  for (let i = 0; i < 300; i++) assert.equal(adaptive.update(0.1), 1);
});

test('adaptive resolution lowers scale under load, respects the floor and recovers', () => {
  const adaptive = new AdaptiveResolution({ minScale: 0.6, step: 0.1, interval: 0.5 });
  adaptive.enabled = true;
  for (let i = 0; i < 200; i++) adaptive.update(0.05);
  assert.ok(Math.abs(adaptive.scale - 0.6) < 1e-9);
  for (let i = 0; i < 2000; i++) adaptive.update(0.005);
  assert.equal(adaptive.scale, 1);
  adaptive.scale = 0.7;
  adaptive.reset();
  assert.equal(adaptive.scale, 1);
});
