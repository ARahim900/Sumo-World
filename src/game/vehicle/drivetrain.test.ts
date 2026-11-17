import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Drivetrain, IDLE_RPM, REDLINE_RPM } from './drivetrain';

test('placeholder drivetrain idles in neutral and selects drive or reverse', () => {
  const drivetrain = new Drivetrain();
  drivetrain.update(0, 0);
  assert.equal(drivetrain.gear, 0);
  assert.equal(drivetrain.rpm, IDLE_RPM);
  drivetrain.update(0, 1);
  assert.equal(drivetrain.gear, 1);
  drivetrain.update(-3, 0);
  assert.equal(drivetrain.gear, -1);
  assert.ok(drivetrain.rpm > IDLE_RPM);
});

test('placeholder rpm rises with speed and never passes the redline', () => {
  const drivetrain = new Drivetrain();
  drivetrain.update(10, 1);
  const slow = drivetrain.rpm;
  drivetrain.update(30, 1);
  assert.ok(drivetrain.rpm > slow);
  drivetrain.update(200, 1);
  assert.equal(drivetrain.rpm, REDLINE_RPM);
  drivetrain.reset();
  assert.equal(drivetrain.gear, 0);
  assert.equal(drivetrain.rpm, IDLE_RPM);
});
