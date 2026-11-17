/**
 * Engine and six-speed automatic gearbox for the rear-wheel-drive GT.
 *
 * `Powertrain` is the single model: the simulation steps it at the fixed physics rate, applies
 * the drive force it returns to the rear wheels and publishes its rpm and gear as telemetry.
 */

export const IDLE_RPM = 900;
export const REDLINE_RPM = 7200;

/** Engine speed the torque converter lets the engine reach at full throttle from rest. */
export const STALL_RPM = 3000;

/** Forward gear ratios, first to sixth. */
export const GEAR_RATIOS: readonly number[] = [3.4, 2.3, 1.65, 1.27, 1.03, 0.84];
export const REVERSE_RATIO = 3.2;
export const FINAL_DRIVE = 3.7;
export const TOP_GEAR = GEAR_RATIOS.length;

/** Share of crankshaft torque that reaches the tyres. */
export const DRIVELINE_EFFICIENCY = 0.88;
export const WHEEL_RADIUS = 0.36;

/** Electronic speed limiter, m/s (240 km/h). */
export const SPEED_LIMIT = 240 / 3.6;
/** Reverse is limited to a walking-pace manoeuvre speed, m/s. */
export const REVERSE_SPEED_LIMIT = 9;

/** Minimum time between automatic shifts, seconds. */
export const SHIFT_INTERVAL = 0.5;
/** Ignition cut while the gearbox changes ratio, seconds. */
export const SHIFT_CUT_TIME = 0.15;
/** Share of torque delivered during the shift cut. */
export const SHIFT_CUT_TORQUE = 0.3;

/** Engine drag torque at the redline when the throttle is closed, N·m. */
const ENGINE_BRAKE_TORQUE = 45;
const MOVING_SPEED = 0.5;
const PEDAL_DEADZONE = 0.05;
const KICKDOWN_THROTTLE = 0.95;
const KICKDOWN_MAX_RPM = 4000;
const KICKDOWN_TARGET_RPM = 5800;
const LIMITER_BAND = 1.5;

/** Full-load torque curve as (rpm, N·m) points; linear in between. */
const TORQUE_CURVE: readonly (readonly [number, number])[] = [
  [IDLE_RPM, 155],
  [2000, 215],
  [3500, 258],
  [4500, 270],
  [5500, 262],
  [6500, 238],
  [REDLINE_RPM, 205],
];

const RADIANS_TO_RPM = 60 / (2 * Math.PI);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Full-load engine torque at `rpm`, N·m. Zero above the redline (rev limiter). */
export function torqueAt(rpm: number): number {
  if (rpm > REDLINE_RPM) return 0;
  if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1];
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    const [rpmHigh, torqueHigh] = TORQUE_CURVE[i];
    if (rpm <= rpmHigh) {
      const [rpmLow, torqueLow] = TORQUE_CURVE[i - 1];
      return lerp(torqueLow, torqueHigh, (rpm - rpmLow) / (rpmHigh - rpmLow));
    }
  }
  return TORQUE_CURVE[TORQUE_CURVE.length - 1][1];
}

/** Overall ratio between crankshaft and wheel for a gear (-1 is reverse). */
export function overallRatio(gear: number): number {
  if (gear < 0) return REVERSE_RATIO * FINAL_DRIVE;
  const index = Math.min(TOP_GEAR, Math.max(1, gear)) - 1;
  return GEAR_RATIOS[index] * FINAL_DRIVE;
}

/** Engine speed when the driveline is locked to the road, rpm. */
export function lockedRpm(speed: number, gear: number): number {
  return (Math.abs(speed) / WHEEL_RADIUS) * overallRatio(gear) * RADIANS_TO_RPM;
}

/**
 * Engine speed including torque-converter slip: from rest the engine flares towards the
 * stall speed with throttle, then locks to road speed once that is higher.
 */
export function engineRpm(speed: number, gear: number, throttle: number): number {
  const converter = IDLE_RPM + clamp01(throttle) * (STALL_RPM - IDLE_RPM);
  return Math.min(REDLINE_RPM, Math.max(converter, lockedRpm(speed, gear)));
}

/** Locked rpm above which the gearbox changes up, rising with throttle. */
export function upshiftRpm(throttle: number): number {
  return lerp(2600, 6700, clamp01(throttle));
}

/** Locked rpm below which the gearbox changes down, rising with throttle. */
export function downshiftRpm(throttle: number): number {
  return lerp(1200, 3000, clamp01(throttle));
}

/**
 * The forward gear the automatic wants next, at most one step from `gear`. The up and down
 * thresholds are spaced so that a shift never lands beyond the opposite threshold.
 */
export function selectGear(gear: number, speed: number, throttle: number): number {
  const current = Math.min(TOP_GEAR, Math.max(1, gear));
  const rpm = lockedRpm(speed, current);
  if (current < TOP_GEAR && rpm > upshiftRpm(throttle)) return current + 1;
  if (current > 1 && rpm < downshiftRpm(throttle)) return current - 1;
  if (
    current > 1 &&
    throttle >= KICKDOWN_THROTTLE &&
    rpm < KICKDOWN_MAX_RPM &&
    lockedRpm(speed, current - 1) < KICKDOWN_TARGET_RPM
  ) {
    return current - 1;
  }
  return current;
}

/**
 * Gear as published in telemetry: -1 reverse, 0 when standing still with no demand,
 * otherwise the engaged forward gear.
 */
export function displayGear(gear: number, signedSpeed: number, demand: number, reverse: boolean): number {
  if (reverse || signedSpeed < -MOVING_SPEED) return -1;
  if (Math.abs(signedSpeed) <= MOVING_SPEED && demand < PEDAL_DEADZONE) return 0;
  return gear;
}

/** Tractive force at the contact patch for a crankshaft torque in a gear, N. */
export function wheelForce(torque: number, gear: number): number {
  return (torque * overallRatio(gear) * DRIVELINE_EFFICIENCY) / WHEEL_RADIUS;
}

/** Throttle multiplier that fades power out as speed approaches `limit`. */
function limiterFactor(speed: number, limit: number): number {
  return clamp01((limit - Math.abs(speed)) / LIMITER_BAND);
}

export interface PowertrainInput {
  /** Speed along the car's forward axis, m/s. */
  signedSpeed: number;
  /** 0..1 drive demand: the throttle in a forward gear, the reverse pedal in reverse. */
  demand: number;
  /** True when reverse is selected. */
  reverse: boolean;
}

/** Stateful engine and automatic gearbox, stepped at the physics rate. */
export class Powertrain {
  rpm = IDLE_RPM;
  /** Engaged forward gear, 1..TOP_GEAR; back to first whenever reverse is engaged or released. */
  gear = 1;
  reverse = false;
  /** True for one step after the gearbox changed ratio. */
  shifted = false;
  private sinceShift = SHIFT_INTERVAL;
  private cut = 0;

  /** Advances the engine by `dt` and returns the total drive force at the rear tyres, N. */
  step(dt: number, input: PowertrainInput): number {
    const demand = clamp01(input.demand);
    const speed = input.signedSpeed;
    this.shifted = false;
    this.sinceShift += dt;
    this.cut = Math.max(0, this.cut - dt);

    if (input.reverse !== this.reverse) {
      this.reverse = input.reverse;
      this.gear = 1;
    }

    if (this.reverse) {
      this.rpm = engineRpm(speed, -1, demand);
      const torque = torqueAt(this.rpm) * demand * limiterFactor(speed, REVERSE_SPEED_LIMIT);
      return torque > 0 ? -wheelForce(torque, -1) : 0;
    }

    const target = selectGear(this.gear, speed, demand);
    if (target !== this.gear && this.sinceShift >= SHIFT_INTERVAL) {
      this.gear = target;
      this.sinceShift = 0;
      this.cut = SHIFT_CUT_TIME;
      this.shifted = true;
    }

    this.rpm = engineRpm(speed, this.gear, demand);
    if (demand < PEDAL_DEADZONE) {
      if (speed <= MOVING_SPEED * 2) return 0;
      return -wheelForce(ENGINE_BRAKE_TORQUE * (this.rpm / REDLINE_RPM), this.gear);
    }

    const cutFactor = this.cut > 0 ? SHIFT_CUT_TORQUE : 1;
    const locked = lockedRpm(speed, this.gear);
    const torque = locked >= REDLINE_RPM ? 0 : torqueAt(this.rpm) * demand * cutFactor;
    return wheelForce(torque * limiterFactor(speed, SPEED_LIMIT), this.gear);
  }

  /** Gear for telemetry; see `displayGear`. */
  telemetryGear(signedSpeed: number, demand: number): number {
    return displayGear(this.gear, signedSpeed, demand, this.reverse);
  }

  reset(): void {
    this.rpm = IDLE_RPM;
    this.gear = 1;
    this.reverse = false;
    this.shifted = false;
    this.sinceShift = SHIFT_INTERVAL;
    this.cut = 0;
  }
}
