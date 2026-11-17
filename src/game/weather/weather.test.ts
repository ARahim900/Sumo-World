import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WeatherKind } from '../core/types';
import { Lightning, pulseIntensity, thunderDelay, thunderLoudness, type ThunderEvent } from './lightning';
import {
  AUTO_NEXT,
  AUTO_TRANSITION,
  MANUAL_TRANSITION,
  WeatherModel,
  gustFactor,
  moveTowards,
  nextAutoKind,
  smoothstep,
} from './model';
import { activeCount, fallSpeed, lensSpawnRate, streakLength, wrap, MAX_STREAK } from './rainMath';
import { createRandom } from './random';
import { thunderVoice } from './thunder';
import { sprayAmount } from './vfx';
import {
  DEFAULT_WEATHER,
  WEATHER_KINDS,
  WeatherSystem,
  applyWeather,
  gripFor,
  toggledRainKind,
  weatherFor,
} from './weather';

const FRAME = 1 / 60;

/** Reads the kind through a call so assertion narrowing on earlier reads does not stick. */
const kindOf = (model: WeatherModel): WeatherKind => model.state.kind;

function run(model: WeatherModel, seconds: number, reduceFlashes = false, onThunder?: (e: ThunderEvent) => void): void {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i++) model.update(FRAME, reduceFlashes, onThunder);
}

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

test('grip follows the brief: dry 1, soaked about 0.8, storm about 0.7', () => {
  assert.equal(gripFor(0, 0), 1);
  assert.equal(gripFor(0.7, 0.3), 0.88);
  assert.ok(Math.abs(gripFor(1, 0) - 0.8) < 1e-9);
  const storm = weatherFor('storm').gripFactor;
  assert.ok(storm > 0.68 && storm < 0.75, `storm grip ${storm}`);
  let previous = Infinity;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const grip = gripFor(w, w);
    assert.ok(grip <= previous, 'grip must not rise as the road gets wetter');
    previous = grip;
  }
});

test('applyWeather updates in place and the legacy rain toggle follows the target kind', () => {
  const state = weatherFor('drizzle');
  assert.equal(applyWeather(state, 'storm'), state);
  assert.equal(state.kind, 'storm');
  assert.equal(toggledRainKind(state), 'clear');
  assert.equal(toggledRainKind(weatherFor('clear')), 'drizzle');
  assert.equal(toggledRainKind(weatherFor('fog')), 'drizzle');
});

test('helpers ease and step exactly onto their targets', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);
  assert.equal(moveTowards(0.68, 0.7, 0.05), 0.7);
  assert.equal(moveTowards(0, 1, 0.25), 0.25);
  assert.equal(moveTowards(1, 0, 0.25), 0.75);
  for (let t = 0; t < 600; t += 0.37) {
    const gust = gustFactor(t);
    assert.ok(gust >= 0.65 && gust <= 1.35);
  }
});

test('the model starts settled in the default weather', () => {
  const model = new WeatherModel(createRandom(1));
  const expected = weatherFor(DEFAULT_WEATHER);
  assert.equal(model.setting, DEFAULT_WEATHER);
  assert.equal(model.transitioning, false);
  assert.equal(model.state.kind, expected.kind);
  assert.equal(model.state.rainDensity, expected.rainDensity);
  assert.equal(model.state.gripFactor, 0.88);
  run(model, 5);
  assert.equal(model.state.rainDensity, 1);
  assert.equal(model.state.gripFactor, 0.88);
  assert.equal(model.state.lightning, 0);
});

test('a manual change blends rain and fog over a few seconds, then the road dries slowly', () => {
  const model = new WeatherModel(createRandom(2));
  const state = model.state;
  model.setSetting('clear');
  assert.equal(state.kind, 'clear');
  assert.equal(state.rainDensity, 1, 'nothing changes until time passes');

  let previousRain = state.rainDensity;
  let largestStep = 0;
  const frames = Math.round(MANUAL_TRANSITION / FRAME);
  for (let i = 0; i < frames; i++) {
    model.update(FRAME, false);
    largestStep = Math.max(largestStep, Math.abs(state.rainDensity - previousRain));
    assert.ok(state.rainDensity <= previousRain, 'rain must fade monotonically');
    previousRain = state.rainDensity;
  }
  assert.ok(largestStep < 0.02, `rain jumped by ${largestStep} in one frame`);
  run(model, 0.1);
  assert.equal(state.rainDensity, 0);
  assert.equal(model.transitioning, false);
  assert.ok(state.wetness > 0.4, 'the road is still wet straight after the rain stops');
  assert.ok(state.gripFactor < 1);

  run(model, 60);
  assert.equal(state.wetness, 0);
  assert.equal(state.puddles, 0);
  assert.equal(state.gripFactor, 1);
});

test('a storm soaks the road gradually and grip falls with it', () => {
  const model = new WeatherModel(createRandom(3));
  model.reset('clear');
  const state = model.state;
  model.setSetting('storm');
  let previousGrip = state.gripFactor;
  for (let second = 0; second < 40; second++) {
    run(model, 1);
    assert.ok(state.gripFactor <= previousGrip + 1e-12, 'grip only falls while the storm builds');
    previousGrip = state.gripFactor;
    if (second === 2) assert.ok(state.wetness > 0 && state.wetness < 0.5, 'wetness rises gradually');
  }
  assert.equal(state.rainDensity, 1);
  assert.equal(state.wetness, 1);
  assert.equal(state.gripFactor, weatherFor('storm').gripFactor);
  assert.ok(state.fogDensity > weatherFor('clear').fogDensity);
  assert.ok(Math.hypot(state.windX, state.windZ) > 2, 'storms are windy');
});

test('fog thickens and tints without rain', () => {
  const model = new WeatherModel(createRandom(4));
  const start = [...model.fogColour];
  model.setSetting('fog');
  run(model, MANUAL_TRANSITION + 0.1);
  assert.equal(model.state.rainDensity, 0);
  assert.equal(model.state.fogDensity, weatherFor('fog').fogDensity);
  assert.notDeepEqual(model.fogColour, start);
  for (const channel of model.fogColour) assert.ok(channel >= 0 && channel <= 1);
});

test('choosing the kind already blending in keeps the current blend', () => {
  const model = new WeatherModel(createRandom(5));
  model.setSetting('storm');
  run(model, MANUAL_TRANSITION / 2);
  const halfway = model.state.fogDensity;
  model.setSetting('storm');
  run(model, FRAME);
  assert.ok(model.state.fogDensity >= halfway);
  assert.ok(model.transitioning);
});

test('paused frames (dt = 0) leave the weather untouched', () => {
  const model = new WeatherModel(createRandom(6));
  model.setSetting('storm');
  run(model, 1);
  const before = { ...model.state };
  for (let i = 0; i < 100; i++) model.update(0, false);
  assert.deepEqual(model.state, before);
});

test('auto holds the current kind, then cycles through natural neighbours', () => {
  const model = new WeatherModel(createRandom(7));
  model.setSetting('fog');
  run(model, MANUAL_TRANSITION);
  model.setSetting('auto');
  assert.equal(model.setting, 'auto');
  assert.equal(model.state.kind, 'fog', 'switching to auto does not jump straight away');

  const seen = new Set<WeatherKind>([kindOf(model)]);
  let previous = kindOf(model);
  let changes = 0;
  for (let second = 0; second < 3600; second++) {
    run(model, 1);
    const kind = kindOf(model);
    if (kind !== previous) {
      const allowed = AUTO_NEXT[previous].map(option => option.kind);
      assert.ok(allowed.includes(kind), `auto moved ${previous} -> ${kind}`);
      previous = kind;
      changes++;
      seen.add(kind);
    }
    assert.ok(model.state.rainDensity >= 0 && model.state.rainDensity <= 1);
  }
  assert.ok(changes >= 20, `only ${changes} changes in an hour`);
  assert.equal(seen.size, WEATHER_KINDS.length, 'every kind appears in an hour of auto weather');
  assert.ok(AUTO_TRANSITION > MANUAL_TRANSITION, 'automatic changes are slower than menu changes');
});

test('auto weather never jumps from clear straight into a storm', () => {
  const random = createRandom(8);
  for (let i = 0; i < 500; i++) {
    assert.notEqual(nextAutoKind('clear', random), 'storm');
    assert.equal(nextAutoKind('storm', random), 'drizzle');
  }
});

test('lightning only strikes in storms and thunder arrives after the sound delay', () => {
  const calm = new WeatherModel(createRandom(9));
  let calmFlash = 0;
  for (let i = 0; i < 60 * 120; i++) {
    calm.update(FRAME, false);
    calmFlash = Math.max(calmFlash, calm.state.lightning);
  }
  assert.equal(calmFlash, 0, 'drizzle never flashes');

  const model = new WeatherModel(createRandom(10));
  model.setSetting('storm');
  const thunder: { at: number; event: ThunderEvent }[] = [];
  const flashes: number[] = [];
  let time = 0;
  let wasLit = false;
  let peak = 0;
  for (let i = 0; i < 60 * 180; i++) {
    time += FRAME;
    model.update(FRAME, false, event => thunder.push({ at: time, event }));
    const lit = model.state.lightning > 0.05;
    if (lit && !wasLit) flashes.push(time);
    wasLit = lit;
    peak = Math.max(peak, model.state.lightning);
    assert.ok(model.state.lightning >= 0 && model.state.lightning <= 1);
  }
  assert.ok(flashes.length >= 6, `only ${flashes.length} flashes in three minutes of storm`);
  assert.ok(peak > 0.5, 'full-motion strikes are bright');
  assert.ok(thunder.length >= 5, 'thunder follows the strikes');
  for (const { event } of thunder) {
    assert.ok(event.distance >= 400 && event.distance <= 3000);
    assert.ok(event.loudness >= 0.2 && event.loudness <= 1);
  }
  for (let i = 0; i < flashes.length; i++) {
    const inOneSecond = flashes.filter(at => at >= flashes[i] && at < flashes[i] + 1).length;
    assert.ok(inOneSecond <= 3, 'never more than three flashes in any second');
  }
});

test('reduced motion caps lightning at a soft glow', () => {
  const model = new WeatherModel(createRandom(11));
  model.setSetting('storm');
  let peak = 0;
  for (let i = 0; i < 60 * 180; i++) {
    model.update(FRAME, true);
    peak = Math.max(peak, model.state.lightning);
  }
  assert.ok(peak > 0, 'storms still glow');
  assert.ok(peak <= 0.35 + 1e-9, `reduced-motion flash reached ${peak}`);
});

test('a forced strike flashes immediately and its thunder waits for the sound', () => {
  const lightning = new Lightning(createRandom(12));
  lightning.strike(false);
  assert.equal(lightning.pendingThunder, 1);
  const heard: ThunderEvent[] = [];
  let elapsed = 0;
  let peak = 0;
  while (heard.length === 0 && elapsed < 20) {
    elapsed += FRAME;
    peak = Math.max(peak, lightning.update(FRAME, false, false, event => heard.push(event)));
  }
  assert.ok(peak > 0.3);
  assert.equal(heard.length, 1);
  assert.ok(Math.abs(elapsed - thunderDelay(heard[0].distance)) < 2 * FRAME);
  assert.equal(lightning.intensity, 0, 'the flash has long faded by the time thunder arrives');
});

test('flash pulse and thunder helpers are well behaved', () => {
  assert.equal(pulseIntensity(-1, 1, 0.04, 0.12), 0);
  assert.equal(pulseIntensity(0.04, 1, 0.04, 0.12), 1);
  assert.ok(pulseIntensity(1, 1, 0.04, 0.12) < 0.001);
  assert.ok(Math.abs(thunderDelay(343) - 1) < 1e-12);
  assert.ok(thunderLoudness(400) > thunderLoudness(2500));
  const near = thunderVoice({ distance: 400, loudness: 1 });
  const far = thunderVoice({ distance: 3000, loudness: 0.2 });
  assert.ok(near.cutoff > far.cutoff && near.attack < far.attack && near.gain > far.gain);
  assert.ok(far.decay > near.decay);
});

test('rain helpers scale with density and stay bounded', () => {
  assert.equal(activeCount(1800, 1), 1800);
  assert.equal(activeCount(1800, 0.5), 900);
  assert.equal(activeCount(1800, -1), 0);
  assert.equal(activeCount(1800, 2), 1800);
  assert.ok(Math.abs(streakLength(19) - 0.646) < 1e-9, 'resting streaks match the original 0.65 m');
  assert.equal(streakLength(500), MAX_STREAK);
  assert.equal(wrap(-1, 56), 55);
  assert.equal(wrap(57, 56), 1);
  assert.ok(fallSpeed(10) > fallSpeed(0));
  assert.equal(lensSpawnRate(0, 30), 0);
  assert.ok(lensSpawnRate(1, 30) > lensSpawnRate(1, 0));
});

test('spray needs speed and a wet road or a handbrake slide', () => {
  assert.equal(sprayAmount(false, 20, true, 1), 0);
  assert.equal(sprayAmount(true, 3, true, 1), 0);
  assert.equal(sprayAmount(true, 20, true, 0), 1);
  assert.equal(sprayAmount(true, 20, false, 0), 0);
  assert.equal(sprayAmount(true, 20, false, 0.7), 0.7);
});

test('the weather system keeps one published state object and resets on dispose', () => {
  const system = new WeatherSystem(createRandom(13));
  const published = system.state;
  system.setWeather('fog');
  system.setWeather('auto');
  assert.equal(system.setting, 'auto');
  assert.equal(system.state.kind, 'fog');
  system.dispose();
  assert.equal(system.state, published);
  assert.equal(system.state.kind, DEFAULT_WEATHER);
  assert.equal(system.setting, DEFAULT_WEATHER);
});
