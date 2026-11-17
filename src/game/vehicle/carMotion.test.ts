import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VehicleTelemetry } from '../core/types';
import {
  LAMP_INTENSITY,
  MAX_PITCH,
  MAX_ROLL,
  createBodyLean,
  isBraking,
  lateralAcceleration,
  lightLevels,
  stepBodyLean,
  type BodyLean,
  type LightLevels,
} from './carMotion';

const FRAME = 1 / 60;

const telemetry = (overrides: Partial<VehicleTelemetry> = {}): VehicleTelemetry => ({
  speed: 0,
  signedSpeed: 0,
  rpm: 900,
  gear: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  slip: [0, 0, 0, 0],
  ...overrides,
});

/** Runs the lean filter over a speed profile sampled once per frame. */
function drive(lean: BodyLean, speeds: (frame: number) => number, frames: number, steering = 0): void {
  for (let n = 0; n < frames; n++) stepBodyLean(lean, speeds(n), steering, FRAME);
}

test('body dives under braking and squats under acceleration', () => {
  const braking = createBodyLean();
  drive(braking, n => 30 - n * 0.15, 60);
  assert.ok(braking.pitch > 0.01, `nose should dip, got ${braking.pitch}`);

  const accelerating = createBodyLean();
  drive(accelerating, n => n * 0.08, 60);
  assert.ok(accelerating.pitch < -0.005, `nose should lift, got ${accelerating.pitch}`);
});

test('body rolls towards the outside of a turn and settles when cruising straight', () => {
  const lean = createBodyLean();
  drive(lean, () => 20, 90, 0.2);
  assert.ok(lateralAcceleration(20, 0.2) > 0);
  assert.ok(lean.roll > 0.02, `turning towards +X should raise the +X side, got ${lean.roll}`);

  drive(lean, () => 20, 240, 0);
  assert.ok(Math.abs(lean.roll) < 1e-3);
  assert.ok(Math.abs(lean.pitch) < 1e-3);
});

test('lean stays bounded through a teleport and ignores paused frames', () => {
  const lean = createBodyLean();
  drive(lean, () => 45, 30, 0.45);
  stepBodyLean(lean, 0, 0, FRAME);
  for (let n = 0; n < 120; n++) {
    stepBodyLean(lean, 0, 0, FRAME);
    assert.ok(Math.abs(lean.pitch) <= MAX_PITCH + 1e-9);
    assert.ok(Math.abs(lean.roll) <= MAX_ROLL + 1e-9);
  }

  const frozen = { ...lean };
  stepBodyLean(lean, 30, 0.3, 0);
  assert.deepEqual(lean, frozen);
});

test('brake lamps follow service braking, not reverse drive', () => {
  assert.equal(isBraking(telemetry({ brake: 1, signedSpeed: 12, gear: 1 })), true);
  assert.equal(isBraking(telemetry({ brake: 1, signedSpeed: 0 })), true);
  assert.equal(isBraking(telemetry({ brake: 1, signedSpeed: -3, gear: -1 })), false);
  assert.equal(isBraking(telemetry({ throttle: 1, signedSpeed: -3, gear: -1 })), true);
  assert.equal(isBraking(telemetry({ throttle: 1, signedSpeed: 8, gear: 1 })), false);
});

test('lamp levels combine headlights, tail, brake and reverse', () => {
  const out: LightLevels = { front: -1, rear: -1, reverse: -1 };
  assert.deepEqual(lightLevels(telemetry({ gear: 1, signedSpeed: 10 }), true, out), {
    front: LAMP_INTENSITY.front,
    rear: LAMP_INTENSITY.tail,
    reverse: 0,
  });
  lightLevels(telemetry({ brake: 1, signedSpeed: 10, gear: 1 }), true, out);
  assert.equal(out.rear, LAMP_INTENSITY.brake);
  lightLevels(telemetry({ brake: 1, signedSpeed: -2, gear: -1 }), true, out);
  assert.equal(out.reverse, LAMP_INTENSITY.reverse);
  assert.equal(out.rear, LAMP_INTENSITY.tail);
  assert.deepEqual(lightLevels(telemetry(), false, out), { front: 0, rear: 0, reverse: 0 });
});
