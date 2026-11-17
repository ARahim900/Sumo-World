/**
 * Pure, allocation-free logic behind the car visual: body lean from telemetry and lamp levels.
 * Kept free of three.js so it can be unit-tested in Node.
 */
import type { VehicleTelemetry } from '../core/types';

/** Distance between the front and rear axles, metres (matches the physics wheel anchors). */
export const WHEELBASE = 2.8;

/** Radians of pitch per m/s² of longitudinal acceleration (about 1.5 degrees at 1 g). */
const PITCH_PER_ACCEL = 0.0027;
/** Radians of roll per m/s² of lateral acceleration (about 3 degrees at 1 g). */
const ROLL_PER_ACCEL = 0.0055;
export const MAX_PITCH = 0.045;
export const MAX_ROLL = 0.06;
/** Raw acceleration is clamped so a teleport (recover, restart) cannot kick the body. */
const MAX_ACCEL = 30;
const ACCEL_FILTER_TIME = 0.12;
const LEAN_RESPONSE_TIME = 0.14;

export interface BodyLean {
  /** Rotation about the car's X axis; positive dips the nose. */
  pitch: number;
  /** Rotation about the car's Z axis; positive raises the +X side. */
  roll: number;
  /** Filtered longitudinal acceleration, m/s². */
  accel: number;
  lastSpeed: number;
  primed: boolean;
}

export function createBodyLean(): BodyLean {
  return { pitch: 0, roll: 0, accel: 0, lastSpeed: 0, primed: false };
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Frame-rate independent blend factor for an exponential approach with time constant `tau`. */
function approach(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

/**
 * Lateral acceleration from the bicycle model, m/s². Positive steering turns towards +X, so a
 * positive result means the car is being pushed towards +X.
 */
export function lateralAcceleration(signedSpeed: number, steering: number): number {
  return (signedSpeed * signedSpeed * Math.tan(steering)) / WHEELBASE;
}

/**
 * Advances the body lean by `dt` seconds. The body dives under braking, squats under power and
 * rolls towards the outside of a turn. A non-positive `dt` (paused) leaves it unchanged.
 */
export function stepBodyLean(lean: BodyLean, signedSpeed: number, steering: number, dt: number): void {
  if (dt <= 0) return;
  if (!lean.primed) {
    lean.lastSpeed = signedSpeed;
    lean.primed = true;
  }
  const rawAccel = clamp((signedSpeed - lean.lastSpeed) / dt, MAX_ACCEL);
  lean.lastSpeed = signedSpeed;
  lean.accel += (rawAccel - lean.accel) * approach(dt, ACCEL_FILTER_TIME);

  const targetPitch = clamp(-lean.accel * PITCH_PER_ACCEL, MAX_PITCH);
  const targetRoll = clamp(lateralAcceleration(signedSpeed, steering) * ROLL_PER_ACCEL, MAX_ROLL);
  const blend = approach(dt, LEAN_RESPONSE_TIME);
  lean.pitch += (targetPitch - lean.pitch) * blend;
  lean.roll += (targetRoll - lean.roll) * blend;
}

/** Emissive intensities for the three lamp groups. */
export interface LightLevels {
  front: number;
  rear: number;
  reverse: number;
}

export const LAMP_INTENSITY = {
  front: 7,
  tail: 2.2,
  brake: 9,
  reverse: 5,
} as const;

const PEDAL_THRESHOLD = 0.05;
const MOVING_THRESHOLD = 0.3;

/**
 * Service braking as the physics applies it: the brake pedal slows a car rolling forwards (or
 * holds it at a standstill), while the throttle slows a car rolling backwards. Brake held while
 * already reversing drives the car backwards instead, so it does not light the brake lamps.
 */
export function isBraking(telemetry: Readonly<VehicleTelemetry>): boolean {
  const pedalBrake = telemetry.brake > PEDAL_THRESHOLD && telemetry.signedSpeed > -MOVING_THRESHOLD;
  const throttleBrake = telemetry.throttle > PEDAL_THRESHOLD && telemetry.signedSpeed < -MOVING_THRESHOLD;
  return pedalBrake || throttleBrake;
}

export function isReversing(telemetry: Readonly<VehicleTelemetry>): boolean {
  return telemetry.gear < 0;
}

/** Writes lamp intensities for this frame into `out` and returns it. */
export function lightLevels(
  telemetry: Readonly<VehicleTelemetry>,
  lightsOn: boolean,
  out: LightLevels,
): LightLevels {
  const braking = isBraking(telemetry);
  out.front = lightsOn ? LAMP_INTENSITY.front : 0;
  out.rear = braking ? LAMP_INTENSITY.brake : lightsOn ? LAMP_INTENSITY.tail : 0;
  out.reverse = isReversing(telemetry) ? LAMP_INTENSITY.reverse : 0;
  return out;
}
