import { test } from 'node:test';
import assert from 'node:assert/strict';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Simulation } from './physics';
import { neutral, arrivalEligible, STEP, type Intent } from './content';
import type { VehicleTelemetry } from './core/types';
import { REDLINE_RPM, SPEED_LIMIT, TOP_GEAR } from './vehicle/drivetrain';
import { weatherFor } from './weather/weather';

const KMH = 1 / 3.6;
const DRY = weatherFor('clear').gripFactor;
const DRIZZLE = weatherFor('drizzle').gripFactor;
const STORM = weatherFor('storm').gripFactor;

const settle = (s: Simulation) => {
  for (let n = 0; n < 120; n++) s.step(neutral());
};

const drive = (overrides: Partial<Intent>): Intent => ({ ...neutral(), ...overrides });

/**
 * A simulation with the car parked on the long north–south avenue at x = 0, already driving.
 * The avenue is clear from wall to wall, so `treadmill` can loop the car along it.
 */
async function avenue(grip: number) {
  const s = await Simulation.create();
  s.setGripFactor(grip);
  s.car.setTranslation({ x: 0, y: 0.95, z: 170 }, true);
  settle(s);
  s.driving = true;
  s.player.setEnabled(false);
  s.car.wakeUp();
  return s;
}

/** Moves the car back up the avenue, keeping its velocity, before it reaches the far wall. */
function treadmill(s: Simulation) {
  const p = s.car.translation();
  if (p.z < -170) s.car.setTranslation({ x: p.x, y: p.y, z: p.z + 340 }, true);
}

/** Moves the car to the opposite side of the open pad, keeping its velocity, before a wall. */
function wrapPad(s: Simulation) {
  const p = s.car.translation();
  const x = p.x > 170 ? p.x - 340 : p.x < -170 ? p.x + 340 : p.x;
  const z = p.z > 170 ? p.z - 340 : p.z < -170 ? p.z + 340 : p.z;
  if (x !== p.x || z !== p.z) s.car.setTranslation({ x, y: p.y, z }, true);
}

/** Body slip angle at the centre of mass: lateral against forward velocity, radians. */
function bodySlip(s: Simulation) {
  const rotation = new Quaternion().copy(s.car.rotation());
  const velocity = new Vector3().copy(s.car.linvel());
  const forward = new Vector3(0, 0, 1).applyQuaternion(rotation);
  const side = new Vector3(1, 0, 0).applyQuaternion(rotation);
  return Math.atan2(Math.abs(velocity.dot(side)), Math.abs(velocity.dot(forward)));
}

/** Removes every building so manoeuvres can be tested on an open skid pad. */
function clearBuildings(s: Simulation) {
  const buildings: RAPIER.Collider[] = [];
  s.world.forEachCollider(collider => {
    if (collider.parent() === null && collider.translation().y > 3) buildings.push(collider);
  });
  for (const collider of buildings) s.world.removeCollider(collider, false);
}

/** Sets the car moving forward (towards -Z) at `speed` m/s and lets the suspension settle. */
function launchAt(s: Simulation, speed: number) {
  s.car.setLinvel({ x: 0, y: 0, z: -speed }, true);
  for (let n = 0; n < 3; n++) s.step(neutral());
  s.car.setLinvel({ x: 0, y: 0, z: -speed }, true);
}

/** Cosine of the angle between the car's up axis and world up. */
function uprightness(s: Simulation) {
  const q = s.car.rotation();
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

function telemetry(): VehicleTelemetry {
  return {
    speed: 0,
    signedSpeed: 0,
    rpm: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    slip: [0, 0, 0, 0],
  };
}

async function brakingDistance(grip: number) {
  const s = await avenue(grip);
  try {
    launchAt(s, 100 * KMH);
    const start = s.car.translation().z;
    for (let n = 0; n < 600 && s.speed > 0.3; n++) s.step(drive({ brake: 1 }));
    return start - s.car.translation().z;
  } finally {
    s.dispose();
  }
}

test('player grounds, enters once and exits safely', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    assert.ok(s.grounded);
    assert.ok(s.canEnter());
    assert.equal(s.interact(), true);
    assert.equal(s.driving, true);
    assert.equal(s.player.isEnabled(), false);
    assert.equal(s.mission, 'drive');
    assert.equal(s.interact(), true);
    assert.equal(s.driving, false);
    assert.equal(s.player.isEnabled(), true);
  } finally {
    s.dispose();
  }
});

test('entry requires proximity and clear line of sight', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    s.player.setTranslation({ x: 15, y: 0.9, z: 24 }, true);
    assert.equal(s.canEnter(), false);
    s.player.setTranslation({ x: 7, y: 0.9, z: 24 }, true);
    s.solid(6.2, 1, 24, 0.2, 2, 3);
    s.world.step();
    assert.equal(s.canEnter(), false);
  } finally {
    s.dispose();
  }
});

test('accelerates forwards, service brake stops and moving exit rejects', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    s.interact();
    for (let n = 0; n < 180; n++) s.step(drive({ throttle: 1 }));
    assert.ok(s.car.translation().z < 10);
    assert.ok(s.speed > 8);
    assert.equal(s.interact(), false);
    const before = s.speed;
    for (let n = 0; n < 50; n++) s.step(drive({ brake: 1 }));
    assert.ok(s.speed < before * 0.5);
  } finally {
    s.dispose();
  }
});

test('solid wall prevents high-speed pass-through', async () => {
  const s = await Simulation.create();
  try {
    s.solid(4, 2, -10, 12, 4, 1);
    settle(s);
    s.interact();
    for (let n = 0; n < 450; n++) s.step(drive({ throttle: 1 }));
    assert.ok(s.car.translation().z > -10);
  } finally {
    s.dispose();
  }
});

test('destination requires eligible vehicle, deck, low speed and continuous hold', async () => {
  assert.ok(arrivalEligible(4, 0.6, -104, 0.1, true));
  assert.equal(arrivalEligible(4, 0.6, -104, 0.1, false), false);
  assert.equal(arrivalEligible(4, 10, -104, 0.1, true), false);
  assert.equal(arrivalEligible(4, 0.6, -104, 5, true), false);
  const s = await Simulation.create();
  try {
    settle(s);
    s.interact();
    s.car.setTranslation({ x: 4, y: 0.7, z: -104 }, true);
    s.car.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let n = 0; n < 180; n++) s.step(neutral());
    assert.equal(s.mission, 'complete');
    s.recover(true);
    assert.equal(s.mission, 'enter');
    assert.equal(s.driving, false);
  } finally {
    s.dispose();
  }
});

test('holding brake stays stopped; a fresh press selects reverse', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    s.interact();
    for (let i = 0; i < 120; i++) s.step(drive({ throttle: 1 }));
    for (let i = 0; i < 180; i++) s.step(drive({ brake: 1 }));
    assert.ok(s.speed < 0.1);
    s.step(neutral());
    for (let i = 0; i < 60; i++) s.step(drive({ brake: 1 }));
    assert.ok(s.signedSpeed < -1);
  } finally {
    s.dispose();
  }
});

test('walking cannot pass through a building', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    s.player.setTranslation({ x: 8, y: 0.85, z: 20 }, true);
    s.player.setNextKinematicTranslation({ x: 8, y: 0.85, z: 20 });
    for (let i = 0; i < 180; i++) s.step(drive({ moveX: -1 }));
    assert.ok(s.player.translation().x < 12);
  } finally {
    s.dispose();
  }
});

test('blocked doors prevent exit without changing possession', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    s.interact();
    s.solid(2.1, 1, 24, 0.8, 2, 3);
    s.solid(5.9, 1, 24, 0.8, 2, 3);
    s.world.step();
    assert.equal(s.interact(), false);
    assert.equal(s.driving, true);
    assert.equal(s.player.isEnabled(), false);
  } finally {
    s.dispose();
  }
});

test('steering changes heading while preserving stable ground contact', async () => {
  const s = await Simulation.create();
  try {
    settle(s);
    s.interact();
    for (let i = 0; i < 90; i++) s.step(drive({ throttle: 0.5, steer: 0.4 }));
    const q = s.car.rotation();
    assert.ok(Math.abs(q.w) > 0.03);
    assert.ok(s.car.translation().y < 1.5);
    assert.ok(Number.isFinite(s.speed));
  } finally {
    s.dispose();
  }
});

test('0-100 km/h on dry tarmac takes a sane time', async () => {
  const s = await avenue(DRY);
  try {
    let time = 0;
    while (s.speed < 100 * KMH && time < 15) {
      s.step(drive({ throttle: 1 }));
      treadmill(s);
      time += STEP;
    }
    console.log(`0-100 km/h (dry): ${time.toFixed(2)} s`);
    assert.ok(time > 4 && time < 8, `0-100 km/h took ${time.toFixed(2)} s`);
  } finally {
    s.dispose();
  }
});

/**
 * At full throttle the limiter is reached in fifth, so the climb stops there; sixth is a
 * cruising overdrive that engages once the driver eases off at speed.
 */
test('top speed is limited, the gearbox upshifts and sixth engages when cruising', async () => {
  const s = await avenue(DRY);
  try {
    const gears: number[] = [];
    const out = telemetry();
    let peakRpm = 0;
    for (let n = 0; n < 45 / STEP; n++) {
      s.step(drive({ throttle: 1 }));
      treadmill(s);
      s.readTelemetry(out);
      peakRpm = Math.max(peakRpm, out.rpm);
      if (out.gear !== gears[gears.length - 1]) gears.push(out.gear);
    }
    console.log(`Top speed: ${(s.speed / KMH).toFixed(1)} km/h; gears: ${gears.join(', ')}`);
    assert.ok(s.speed <= SPEED_LIMIT + 0.5, `top speed ${(s.speed / KMH).toFixed(1)} km/h`);
    assert.ok(s.speed > 200 * KMH, `top speed ${(s.speed / KMH).toFixed(1)} km/h`);
    assert.ok(peakRpm <= REDLINE_RPM);
    assert.ok(gears.length >= 4, `gears used: ${gears.join(', ')}`);
    for (let i = 1; i < gears.length; i++) assert.equal(gears[i], gears[i - 1] + 1, 'gears climb one at a time');

    for (let n = 0; n < 3 / STEP; n++) {
      s.step(drive({ throttle: 0.3 }));
      treadmill(s);
    }
    s.readTelemetry(out);
    assert.equal(out.gear, TOP_GEAR, 'easing off at speed selects the overdrive');
  } finally {
    s.dispose();
  }
});

test('braking from 100 km/h stops shorter on dry tarmac than in the wet', async () => {
  const dry = await brakingDistance(DRY);
  const wet = await brakingDistance(STORM);
  console.log(`Braking 100-0 km/h: dry ${dry.toFixed(1)} m, wet ${wet.toFixed(1)} m`);
  assert.ok(dry < wet);
  assert.ok(dry > 25 && dry < 45, `dry braking distance ${dry.toFixed(1)} m`);
});

test('driving straight at full throttle stays straight, level and on the road', async () => {
  const s = await avenue(DRY);
  try {
    const startX = s.car.translation().x;
    let worstYawRate = 0;
    let worstTilt = 0;
    for (let n = 0; n < 20 / STEP; n++) {
      s.step(drive({ throttle: 1 }));
      treadmill(s);
      worstYawRate = Math.max(worstYawRate, Math.abs(s.car.angvel().y));
      worstTilt = Math.max(worstTilt, 1 - uprightness(s));
    }
    assert.ok(Math.abs(s.car.translation().x - startX) < 0.5);
    assert.ok(worstYawRate < 0.02);
    assert.ok(worstTilt < 0.01);
    assert.ok(s.car.translation().y < 1.2);
  } finally {
    s.dispose();
  }
});

test('full throttle on full lock at low speed does not spin, even in the wet', async () => {
  const s = await avenue(STORM);
  try {
    s.car.setTranslation({ x: 0, y: 0.95, z: 0 }, true);
    for (let n = 0; n < 30; n++) s.step(neutral());
    let worstRearSlip = 0;
    for (let n = 0; n < 100; n++) {
      s.step(drive({ throttle: 1, steer: 1 }));
      worstRearSlip = Math.max(worstRearSlip, s.wheelSlip(2), s.wheelSlip(3));
    }
    assert.ok(worstRearSlip < 0.2, `rear slip ${worstRearSlip.toFixed(2)}`);
  } finally {
    s.dispose();
  }
});

test('holding part steer at full throttle in the wet does not spin the car', async () => {
  const cases = [
    { grip: DRIZZLE, entry: 100, steer: 0.25 },
    { grip: DRIZZLE, entry: 100, steer: 0.5 },
    { grip: STORM, entry: 50, steer: 0.25 },
    { grip: STORM, entry: 100, steer: 0.25 },
  ];
  for (const { grip, entry, steer } of cases) {
    const s = await avenue(grip);
    try {
      clearBuildings(s);
      while (s.speed < entry * KMH) {
        s.step(drive({ throttle: 1 }));
        wrapPad(s);
      }
      let worst = 0;
      for (let n = 0; n < 3 / STEP; n++) {
        s.step(drive({ throttle: 1, steer }));
        wrapPad(s);
        worst = Math.max(worst, bodySlip(s));
      }
      const degrees = (worst * 180) / Math.PI;
      assert.ok(degrees < 15, `grip ${grip}, ${entry} km/h, steer ${steer}: body slip ${degrees.toFixed(1)} deg`);
    } finally {
      s.dispose();
    }
  }
});

test('a handbrake turn starts a drift that recovers upright', async () => {
  const s = await avenue(DRY);
  try {
    clearBuildings(s);
    launchAt(s, 60 * KMH);
    const out = telemetry();
    let worstRear = 0;
    let frontAtWorst = 0;
    for (let n = 0; n < 24; n++) s.step(drive({ steer: 0.6, handbrake: true }));
    for (let n = 0; n < 80; n++) {
      s.step(drive({ steer: -0.3, throttle: 0.5 }));
      s.readTelemetry(out);
      const rear = Math.max(out.slip[2], out.slip[3]);
      if (rear > worstRear) {
        worstRear = rear;
        frontAtWorst = Math.max(out.slip[0], out.slip[1]);
      }
    }
    for (let n = 0; n < 120; n++) s.step(drive({ throttle: 0.3 }));
    assert.ok(worstRear > 0.5, `rear slip peaked at ${worstRear.toFixed(2)}`);
    assert.ok(worstRear > frontAtWorst, 'the rear steps out further than the front');
    assert.ok(uprightness(s) > 0.99);
    assert.ok(Math.abs(s.car.angvel().y) < 0.5);
    assert.ok(Math.max(s.wheelSlip(2), s.wheelSlip(3)) < 0.2, 'grip returns once the drift ends');
  } finally {
    s.dispose();
  }
});

test('telemetry reports gear, rpm and slip from the simulated powertrain', async () => {
  const s = await avenue(DRY);
  try {
    const out = telemetry();
    s.readTelemetry(out);
    assert.equal(out.gear, 0);
    for (let n = 0; n < 120; n++) s.step(drive({ throttle: 1 }));
    s.readTelemetry(out);
    assert.ok(out.gear >= 1);
    assert.ok(out.rpm > 2000 && out.rpm <= REDLINE_RPM);
    assert.equal(out.throttle, 1);
    assert.ok(out.slip.every(value => Number.isFinite(value) && value >= 0));
    s.driving = false;
    s.readTelemetry(out);
    assert.equal(out.gear, 0);
  } finally {
    s.dispose();
  }
});
