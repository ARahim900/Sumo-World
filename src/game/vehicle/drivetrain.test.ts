import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_RPM,
  Powertrain,
  REDLINE_RPM,
  REVERSE_SPEED_LIMIT,
  SHIFT_CUT_TIME,
  SHIFT_INTERVAL,
  SPEED_LIMIT,
  TOP_GEAR,
  downshiftRpm,
  engineRpm,
  lockedRpm,
  selectGear,
  torqueAt,
  upshiftRpm,
} from './drivetrain';

const STEP = 1 / 60;

test('torque curve peaks in the mid range and the limiter cuts above the redline', () => {
  const idle = torqueAt(IDLE_RPM);
  const mid = torqueAt(4500);
  const top = torqueAt(REDLINE_RPM);
  assert.ok(mid > idle);
  assert.ok(mid > top);
  assert.equal(torqueAt(REDLINE_RPM + 1), 0);
  assert.equal(torqueAt(0), idle);
});

test('engine rpm flares from rest with throttle and never passes the redline', () => {
  assert.equal(engineRpm(0, 1, 0), IDLE_RPM);
  assert.ok(engineRpm(0, 1, 1) > 2500);
  assert.equal(engineRpm(200, 1, 1), REDLINE_RPM);
  assert.ok(lockedRpm(20, 2) > lockedRpm(20, 3));
});

test('shift thresholds leave a gap so a shift never triggers the opposite shift', () => {
  for (let gear = 1; gear <= TOP_GEAR; gear++) {
    for (let throttle = 0; throttle <= 1.0001; throttle += 0.1) {
      for (let speed = 0; speed <= 80; speed += 0.25) {
        const next = selectGear(gear, speed, throttle);
        assert.ok(Math.abs(next - gear) <= 1);
        if (next !== gear) {
          assert.notEqual(
            selectGear(next, speed, throttle),
            gear,
            `gear ${gear} -> ${next} at ${speed} m/s, throttle ${throttle.toFixed(1)} would shift straight back`,
          );
        }
      }
    }
  }
  assert.ok(upshiftRpm(1) > upshiftRpm(0));
  assert.ok(downshiftRpm(1) > downshiftRpm(0));
});

test('powertrain upshifts, respects the shift interval and cuts torque during a shift', () => {
  const powertrain = new Powertrain();
  const speedFor = (rpm: number, gear: number) => (rpm / lockedRpm(1, gear));
  const beforeShift = powertrain.step(STEP, { signedSpeed: speedFor(5000, 1), demand: 1, reverse: false });
  assert.equal(powertrain.gear, 1);

  const shiftSpeed = speedFor(6900, 1);
  const duringCut = powertrain.step(STEP, { signedSpeed: shiftSpeed, demand: 1, reverse: false });
  assert.equal(powertrain.gear, 2);
  assert.equal(powertrain.shifted, true);
  assert.ok(duringCut < beforeShift * 0.5);

  powertrain.step(STEP, { signedSpeed: speedFor(6900, 2), demand: 1, reverse: false });
  assert.equal(powertrain.gear, 2, 'a second shift must wait for the shift interval');

  let afterCut = 0;
  const steps = Math.ceil(Math.max(SHIFT_INTERVAL, SHIFT_CUT_TIME) / STEP) + 1;
  for (let i = 0; i < steps; i++) {
    afterCut = powertrain.step(STEP, { signedSpeed: speedFor(4500, 2), demand: 1, reverse: false });
  }
  assert.equal(powertrain.gear, 2);
  assert.ok(afterCut > duringCut * 2);
});

test('powertrain engine-brakes when coasting and limits top and reverse speed', () => {
  const powertrain = new Powertrain();
  assert.ok(powertrain.step(STEP, { signedSpeed: 20, demand: 0, reverse: false }) < 0);
  assert.equal(powertrain.step(STEP, { signedSpeed: 0, demand: 0, reverse: false }), 0);

  powertrain.reset();
  powertrain.gear = TOP_GEAR - 1;
  assert.equal(powertrain.step(STEP, { signedSpeed: SPEED_LIMIT + 0.1, demand: 1, reverse: false }), 0);

  powertrain.reset();
  assert.ok(powertrain.step(STEP, { signedSpeed: 0, demand: 1, reverse: true }) < 0);
  assert.equal(powertrain.telemetryGear(-2, 1), -1);
  assert.equal(powertrain.step(STEP, { signedSpeed: -REVERSE_SPEED_LIMIT, demand: 1, reverse: true }), 0);
});
