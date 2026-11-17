import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { neutral } from '../content';
import { DEFAULT_GRIP, Simulation } from '../physics';
import type { VehicleTelemetry, WheelState } from './types';

const settle = (s: Simulation) => {
  for (let n = 0; n < 120; n++) s.step(neutral());
};

const telemetry = (): VehicleTelemetry => ({
  speed: 0,
  signedSpeed: 0,
  rpm: 0,
  gear: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  slip: [0, 0, 0, 0],
});

const wheel = (): WheelState => ({
  anchor: new Vector3(),
  suspensionLength: 0,
  rotation: 0,
  steering: 0,
  inContact: false,
  contactPoint: new Vector3(),
});

test('grip comes from the weather setter and scales tyre friction', async () => {
  const s = await Simulation.create();
  try {
    assert.equal(s.gripFactor, DEFAULT_GRIP);
    s.setGripFactor(0.5);
    s.step(neutral());
    assert.equal(s.gripFactor, 0.5);
    assert.ok(Math.abs((s.vehicle.wheelFrictionSlip(0) ?? 0) - 3.5 * 0.5) < 1e-6);
  } finally {
    s.dispose();
  }
});

test('wheel state reports grounded contact for a parked car', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    for (let i = 0; i < 4; i++) {
      const state = wheel();
      s.readWheel(i, state);
      assert.ok(state.inContact);
      assert.ok(state.contactPoint.y < 0.5);
      assert.ok(state.anchor.equals(s.wheelAnchors[i]));
      assert.ok(state.suspensionLength > 0);
    }
  } finally {
    s.dispose();
  }
});

test('telemetry mirrors driver input and reports finite slip', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    s.interact();
    for (let n = 0; n < 60; n++) s.step({ ...neutral(), throttle: 1, steer: 0.5, handbrake: true });
    const out = telemetry();
    s.readTelemetry(out);
    assert.equal(out.throttle, 1);
    assert.equal(out.handbrake, true);
    assert.equal(out.speed, s.speed);
    assert.ok(out.slip.every(value => Number.isFinite(value) && value >= 0));
    assert.ok(out.slip.some(value => value > 0));
  } finally {
    s.dispose();
  }
});
