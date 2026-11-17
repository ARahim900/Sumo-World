/**
 * Pure force models for the GT: aerodynamics, rolling resistance, brakes and tyre grip.
 * Physics applies them every fixed step; keeping them free of Rapier makes them testable.
 */

export const AIR_DENSITY = 1.225;
/** Drag coefficient times frontal area, m². */
export const DRAG_AREA = 0.3 * 2.1;
/** Lift coefficient times area, m²; positive pushes the car down. */
export const DOWNFORCE_AREA = 0.35;
/** Share of downforce on the front axle; the rest goes to the rear for high-speed stability. */
export const DOWNFORCE_FRONT_SHARE = 0.45;
export const ROLLING_RESISTANCE = 0.013;
export const GRAVITY = 9.81;

/** Peak longitudinal tyre friction coefficient on dry tarmac. */
export const LONGITUDINAL_GRIP = 1.2;
/**
 * Share of a driven tyre's longitudinal grip that traction control lets the engine use. The
 * reserve keeps lateral grip available, so full throttle cannot break the rear loose.
 */
export const TRACTION_CONTROL_SHARE = 0.85;
/**
 * Friction-slip value handed to the ray-cast vehicle on dry tarmac once moving. It is not a
 * pure lateral coefficient: Rapier's ray-cast vehicle (a port of Bullet's) caps the combined
 * tyre impulse with it, weighting the forward impulse by 0.5. Drive and brake impulses, which
 * `tractionLimit` already caps at `LONGITUDINAL_GRIP`, therefore eat into it, and
 * `frictionCircleShare` trims it again for the same use. That double count is tuning, kept
 * small by the `MIN_CIRCLE_SHARE` floor. When coasting the cornering limit is about
 * `LATERAL_GRIP` times the weather grip (about 1.41 in drizzle).
 */
export const LATERAL_GRIP = 1.6;
/**
 * Rear lateral grip relative to the front. The GT runs wider rear tyres, so at the limit the
 * front lets go first and the car understeers rather than spinning; the handbrake still
 * breaks the rear loose for a drift.
 */
export const REAR_LATERAL_BIAS = 1.15;
/**
 * Lateral friction at parking pace: the prototype's value, which keeps manoeuvring and
 * launches planted. It blends to `LATERAL_GRIP` between the two speeds below.
 */
export const PARKING_LATERAL_GRIP = 3.5;
const PARKING_GRIP_SPEED = 1;
const MOVING_GRIP_SPEED = 5;

/** Total service-brake force at full pedal, N; more than the tyres can carry, so ABS limits it. */
export const BRAKE_FORCE = 15000;
/** Share of service-brake force sent to the front axle. */
export const BRAKE_FRONT_BIAS = 0.65;
/** Locked rear tyres slide at this share of their peak longitudinal grip. */
export const HANDBRAKE_GRIP = 0.9;
/** Rear lateral grip multiplier while the handbrake is held. */
export const HANDBRAKE_LATERAL = 0.5;

/** Slip angle of peak lateral force, radians. */
export const PEAK_SLIP_ANGLE = 0.12;
/** Slip angle by which the tyre is fully sliding, radians. */
export const SLIDE_SLIP_ANGLE = 0.45;
/** Lateral grip left when fully sliding, as a share of peak. */
export const SLIDE_GRIP = 0.8;

/** Below this speed tyres keep full grip, so the car stays docile when parking or launching. */
const GRIP_FADE_START = 4;
const GRIP_FADE_END = 12;
/** Lowest rear lateral grip share left when traction uses the whole friction budget. */
export const MIN_CIRCLE_SHARE = 0.78;
const ROLLING_FADE_SPEED = 0.5;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** 0 at low speed, 1 once tyre slip effects are fully active. */
function speedBlend(speed: number): number {
  return clamp01((speed - GRIP_FADE_START) / (GRIP_FADE_END - GRIP_FADE_START));
}

/** Aerodynamic drag magnitude, 0.5·ρ·Cd·A·v², N. */
export function aeroDrag(speed: number): number {
  return 0.5 * AIR_DENSITY * DRAG_AREA * speed * speed;
}

/** Aerodynamic downforce magnitude, 0.5·ρ·Cl·A·v², N. */
export function downforce(speed: number): number {
  return 0.5 * AIR_DENSITY * DOWNFORCE_AREA * speed * speed;
}

/** Rolling resistance magnitude, faded to zero at rest so a parked car does not creep, N. */
export function rollingResistance(mass: number, speed: number): number {
  return ROLLING_RESISTANCE * mass * GRAVITY * clamp01(Math.abs(speed) / ROLLING_FADE_SPEED);
}

/** Service-brake force demanded at one wheel before the grip limit, N. */
export function brakeDemand(pedal: number, front: boolean): number {
  const share = front ? BRAKE_FRONT_BIAS : 1 - BRAKE_FRONT_BIAS;
  return (clamp01(pedal) * BRAKE_FORCE * share) / 2;
}

/** Peak lateral friction for the current speed on dry tarmac, before weather and slip. */
export function baseLateralGrip(speed: number): number {
  const moving = clamp01((speed - PARKING_GRIP_SPEED) / (MOVING_GRIP_SPEED - PARKING_GRIP_SPEED));
  return PARKING_LATERAL_GRIP + (LATERAL_GRIP - PARKING_LATERAL_GRIP) * moving;
}

/** Longitudinal force one tyre can carry under `load` newtons, N. */
export function tractionLimit(load: number, grip: number): number {
  return LONGITUDINAL_GRIP * grip * Math.max(0, load);
}

/**
 * Lateral grip share for a tyre at `slipTan` (tangent of its slip angle). Grip holds up to
 * the peak slip angle and falls to `SLIDE_GRIP` once sliding, which is what lets a drift
 * hold once started. The fall-off is faded out at low speed.
 */
export function lateralGripShare(slipTan: number, speed: number): number {
  const angle = Math.atan(Math.abs(slipTan));
  const sliding = smoothstep((angle - PEAK_SLIP_ANGLE) / (SLIDE_SLIP_ANGLE - PEAK_SLIP_ANGLE));
  const loss = (1 - SLIDE_GRIP) * sliding * speedBlend(speed);
  return 1 - loss;
}

/**
 * Friction-circle share of lateral grip left once a tyre is using `usage` (0..1) of its
 * longitudinal grip for traction or braking. Faded out at low speed so full throttle from
 * rest cannot swing the tail out.
 */
export function frictionCircleShare(usage: number, speed: number): number {
  const used = clamp01(usage);
  const remaining = Math.max(MIN_CIRCLE_SHARE, Math.sqrt(1 - used * used));
  return 1 - (1 - remaining) * speedBlend(speed);
}

/** Body slip angle at which the drift assist starts to resist further rotation, radians. */
export const DRIFT_ASSIST_START = 0.5;
/** Body slip angle at which the drift assist reaches full strength, radians. */
export const DRIFT_ASSIST_FULL = 1.0;

/**
 * 0..1 strength of the drift assist for the body's slip angle (lateral over forward speed at
 * the centre of mass). It only acts once the car is well sideways, so a drift can be held
 * with counter-steer without the car spinning round.
 */
export function driftAssistShare(lateralSpeed: number, forwardSpeed: number, speed: number): number {
  const angle = Math.atan2(Math.abs(lateralSpeed), Math.abs(forwardSpeed));
  const excess = smoothstep((angle - DRIFT_ASSIST_START) / (DRIFT_ASSIST_FULL - DRIFT_ASSIST_START));
  return excess * speedBlend(speed);
}
