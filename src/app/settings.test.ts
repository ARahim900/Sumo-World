import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_KEY,
  debugRequested,
  defaultSettings,
  formatGear,
  isTouchOnly,
  loadProgress,
  loadSettings,
  parseSettings,
  rpmFraction,
  saveSettings,
  weatherLabel,
  type GameSettings,
} from './settings';

const fallback = defaultSettings();

test('defaults match the runtime defaults and honour reduced motion', () => {
  assert.deepEqual(fallback, {
    quality: 'medium',
    adaptiveResolution: true,
    weather: 'drizzle',
    lowMotion: false,
    sound: false,
  });
  assert.equal(defaultSettings(true).lowMotion, true);
});

test('parseSettings keeps valid fields and replaces invalid ones', () => {
  const raw = JSON.stringify({
    quality: 'ultra',
    adaptiveResolution: 'off',
    weather: 'tornado',
    lowMotion: true,
    sound: 'yes',
  });
  assert.deepEqual(parseSettings(raw, fallback), {
    quality: 'ultra',
    adaptiveResolution: true,
    weather: 'drizzle',
    lowMotion: true,
    sound: false,
  });
  assert.equal(parseSettings(JSON.stringify({ weather: 'auto' }), fallback).weather, 'auto');
  assert.equal(parseSettings(JSON.stringify({ adaptiveResolution: false }), fallback).adaptiveResolution, false);
});

test('parseSettings falls back on missing, malformed or non-object data', () => {
  assert.deepEqual(parseSettings(null, fallback), fallback);
  assert.deepEqual(parseSettings('{not json', fallback), fallback);
  assert.deepEqual(parseSettings('42', fallback), fallback);
  assert.deepEqual(parseSettings('null', fallback), fallback);
  assert.notEqual(parseSettings(null, fallback), fallback, 'returns a copy, not the fallback itself');
});

test('load and save round-trip through storage and survive storage that throws', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const chosen: GameSettings = {
    quality: 'low',
    adaptiveResolution: false,
    weather: 'fog',
    lowMotion: true,
    sound: true,
  };
  assert.equal(saveSettings(storage, chosen), true);
  assert.ok(values.has(SETTINGS_KEY));
  assert.deepEqual(loadSettings(storage, fallback), chosen);

  const blocked = {
    getItem: (): string | null => {
      throw new Error('SecurityError');
    },
    setItem: (): void => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.deepEqual(loadSettings(blocked, fallback), fallback);
  assert.equal(saveSettings(blocked, chosen), false);
  assert.deepEqual(loadSettings(null, fallback), fallback);
  assert.equal(saveSettings(null, chosen), false);
});

test('gear and rpm formatting for the HUD', () => {
  assert.equal(formatGear(-1), 'R');
  assert.equal(formatGear(0), 'N');
  assert.equal(formatGear(3), '3');
  assert.equal(rpmFraction(3600, 7200), 0.5);
  assert.equal(rpmFraction(9000, 7200), 1);
  assert.equal(rpmFraction(-10, 7200), 0);
  assert.equal(rpmFraction(Number.NaN, 7200), 0);
  assert.equal(rpmFraction(1000, 0), 0);
});

test('labels, debug query and loading progress', () => {
  assert.equal(weatherLabel('auto'), 'Auto');
  assert.equal(weatherLabel('storm'), 'Storm');
  assert.equal(debugRequested('?debug'), true);
  assert.equal(debugRequested('?debug=1'), true);
  assert.equal(debugRequested('?debug=false'), false);
  assert.equal(debugRequested('?debug=0'), false);
  assert.equal(debugRequested('?view=map'), false);
  assert.equal(loadProgress('download'), 0);
  assert.equal(loadProgress('ready'), 1);
  assert.ok(loadProgress('graphics') < loadProgress('city'));
});

test('touch-only detection needs a coarse pointer and no fine pointer', () => {
  const phone = (query: string) => query === '(pointer: coarse)';
  const laptop = (query: string) => query === '(any-pointer: fine)';
  const tabletWithMouse = () => true;
  assert.equal(isTouchOnly(phone), true);
  assert.equal(isTouchOnly(laptop), false);
  assert.equal(isTouchOnly(tabletWithMouse), false);
});
