import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WEATHER, WEATHER_KINDS, WeatherSystem, applyWeather, toggledRainKind, weatherFor } from './weather';

test('default weather reproduces the original rain, fog and wet grip', () => {
  const state = weatherFor(DEFAULT_WEATHER);
  assert.equal(state.kind, 'drizzle');
  assert.equal(state.rainDensity, 1);
  assert.equal(state.fogDensity, 0.006);
  assert.equal(state.gripFactor, 0.88);
  assert.ok(state.wetness > 0);
});

test('clear weather matches the original rain-off state', () => {
  const state = weatherFor('clear');
  assert.equal(state.rainDensity, 0);
  assert.equal(state.wetness, 0);
  assert.equal(state.gripFactor, 1);
  assert.equal(state.fogDensity, 0.006);
});

test('every kind stays inside the documented ranges', () => {
  for (const kind of WEATHER_KINDS) {
    const state = weatherFor(kind);
    for (const value of [state.rainDensity, state.wetness, state.puddles, state.lightning]) {
      assert.ok(value >= 0 && value <= 1, `${kind} has a 0..1 field out of range`);
    }
    assert.ok(state.gripFactor > 0 && state.gripFactor <= 1);
    assert.ok(state.fogDensity > 0);
  }
});

test('applyWeather updates in place and the legacy rain toggle alternates', () => {
  const state = weatherFor('drizzle');
  assert.equal(applyWeather(state, 'storm'), state);
  assert.equal(state.kind, 'storm');
  assert.equal(toggledRainKind(state), 'clear');
  assert.equal(toggledRainKind(weatherFor('clear')), 'drizzle');
});

test('auto keeps the current kind until the weather team adds cycling', () => {
  const system = new WeatherSystem();
  system.setWeather('fog');
  system.setWeather('auto');
  assert.equal(system.setting, 'auto');
  assert.equal(system.state.kind, 'fog');
  system.dispose();
  assert.equal(system.state.kind, DEFAULT_WEATHER);
});
