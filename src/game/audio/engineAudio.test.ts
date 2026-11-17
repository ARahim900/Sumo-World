import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_RPM, REDLINE_RPM } from '../vehicle/drivetrain';
import {
  SHIFT_DIP_TIME,
  engineLoad,
  engineVoice,
  hissLevel,
  rainLevel,
  shiftDipGain,
  squealLevel,
} from './engineAudio';

test('engine pitch follows rpm and load opens the filter and raises the level', () => {
  const idle = engineVoice(IDLE_RPM, 0);
  const redline = engineVoice(REDLINE_RPM, 0);
  const loaded = engineVoice(IDLE_RPM, 1);
  assert.equal(idle.frequency, (IDLE_RPM / 60) * 3);
  assert.ok(redline.frequency > idle.frequency * 7);
  assert.ok(loaded.cutoff > idle.cutoff);
  assert.ok(loaded.gain > idle.gain);
  assert.ok(loaded.roar > idle.roar);
  assert.equal(engineVoice(0, 0).frequency, idle.frequency, 'pitch never drops below idle');
});

test('engine load follows the throttle forwards and the drive pedal in reverse', () => {
  assert.equal(engineLoad({ gear: 3, throttle: 0.7, brake: 0 }), 0.7);
  assert.equal(engineLoad({ gear: 2, throttle: 0, brake: 1 }), 0, 'braking forwards is no load');
  assert.equal(engineLoad({ gear: -1, throttle: 0, brake: 1 }), 1);
  assert.equal(engineLoad({ gear: 0, throttle: 0, brake: 0 }), 0);
});

test('gear changes dip the engine level briefly', () => {
  assert.ok(shiftDipGain(0) < 0.5);
  assert.ok(shiftDipGain(SHIFT_DIP_TIME / 2) > shiftDipGain(0));
  assert.equal(shiftDipGain(SHIFT_DIP_TIME), 1);
});

test('tyres squeal only when sliding above walking pace', () => {
  assert.equal(squealLevel([0.05, 0.05, 0.05, 0.05], 20, false), 0);
  assert.ok(squealLevel([0.1, 0.1, 0.6, 0.6], 20, false) > 0.5);
  assert.equal(squealLevel([2, 2, 2, 2], 1, false), 0);
  assert.equal(squealLevel([5, 5, 5, 5], 30, false), 1);
});

test('locked rear wheels squeal under the handbrake even in a straight line', () => {
  const straight = [0, 0, 0, 0];
  assert.ok(squealLevel(straight, 20, true) > 0.5);
  assert.equal(squealLevel(straight, 1, true), 0, 'silent at walking pace');
  assert.equal(squealLevel([5, 5, 5, 5], 30, true), 1, 'a full slide is louder still');
});

test('rain ambience and wet-road hiss follow the weather', () => {
  assert.equal(rainLevel(0), 0);
  assert.equal(rainLevel(1), 1);
  assert.equal(hissLevel(0, 30), 0);
  assert.equal(hissLevel(1, 0), 0);
  assert.ok(hissLevel(1, 30) > hissLevel(0.5, 30));
});
