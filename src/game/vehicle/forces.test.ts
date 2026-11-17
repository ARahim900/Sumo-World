import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIR_DENSITY,
  BRAKE_FORCE,
  BRAKE_FRONT_BIAS,
  DRAG_AREA,
  LATERAL_GRIP,
  GRAVITY,
  LONGITUDINAL_GRIP,
  MIN_CIRCLE_SHARE,
  PARKING_LATERAL_GRIP,
  SLIDE_GRIP,
  aeroDrag,
  baseLateralGrip,
  brakeDemand,
  downforce,
  driftAssistShare,
  frictionCircleShare,
  lateralGripShare,
  rollingResistance,
  tractionLimit,
} from './forces';

test('aerodynamic drag and downforce grow with the square of speed', () => {
  assert.equal(aeroDrag(0), 0);
  assert.ok(Math.abs(aeroDrag(30) - 0.5 * AIR_DENSITY * DRAG_AREA * 900) < 1e-9);
  assert.ok(Math.abs(aeroDrag(60) / aeroDrag(30) - 4) < 1e-9);
  assert.ok(downforce(50) > downforce(25) * 3.9);
});

test('rolling resistance fades out at rest so a parked car does not creep', () => {
  assert.equal(rollingResistance(1200, 0), 0);
  assert.ok(rollingResistance(1200, 10) > 100);
  assert.equal(rollingResistance(1200, 10), rollingResistance(1200, 30));
});

test('service brakes split front and rear by the bias and grip caps traction', () => {
  const total = 2 * brakeDemand(1, true) + 2 * brakeDemand(1, false);
  assert.ok(Math.abs(total - BRAKE_FORCE) < 1e-9);
  assert.ok(Math.abs((2 * brakeDemand(1, true)) / total - BRAKE_FRONT_BIAS) < 1e-9);
  assert.equal(brakeDemand(0, true), 0);
  assert.equal(tractionLimit(4000, 1), LONGITUDINAL_GRIP * 4000);
  assert.ok(tractionLimit(4000, 0.78) < tractionLimit(4000, 1));
  assert.equal(tractionLimit(-10, 1), 0);
});

test('at part pedal the brake bias, not the grip cap, sets the front-rear split', () => {
  const staticLoad = (1200 * GRAVITY) / 4;
  const front = brakeDemand(0.3, true);
  const rear = brakeDemand(0.3, false);
  assert.ok(front < tractionLimit(staticLoad, 1) && rear < tractionLimit(staticLoad, 1));
  assert.ok(Math.abs(front / (front + rear) - BRAKE_FRONT_BIAS) < 1e-9);
});

test('base lateral grip is high at parking pace and settles to the moving value', () => {
  assert.equal(baseLateralGrip(0), PARKING_LATERAL_GRIP);
  assert.equal(baseLateralGrip(20), LATERAL_GRIP);
  const between = baseLateralGrip(3);
  assert.ok(between < PARKING_LATERAL_GRIP && between > LATERAL_GRIP);
});

test('lateral grip holds below the peak slip angle and falls once sliding at speed', () => {
  assert.equal(lateralGripShare(0.05, 20), 1);
  assert.ok(Math.abs(lateralGripShare(3, 20) - SLIDE_GRIP) < 1e-9);
  assert.equal(lateralGripShare(3, 2), 1, 'no fall-off at parking speed');
  assert.ok(lateralGripShare(0.3, 20) < 1 && lateralGripShare(0.3, 20) > SLIDE_GRIP);
});

test('traction use shrinks lateral grip only at speed, and never below the floor', () => {
  assert.equal(frictionCircleShare(0, 20), 1);
  assert.equal(frictionCircleShare(1, 2), 1);
  assert.ok(frictionCircleShare(0.6, 20) < 1);
  assert.equal(frictionCircleShare(1, 20), MIN_CIRCLE_SHARE);
});

test('drift assist only acts once the car is well sideways at speed', () => {
  assert.equal(driftAssistShare(1, 20, 20), 0);
  assert.equal(driftAssistShare(20, 1, 20), 1);
  assert.equal(driftAssistShare(20, 1, 2), 0);
  const partial = driftAssistShare(Math.tan(0.75), 1, 20);
  assert.ok(partial > 0 && partial < 1);
});
