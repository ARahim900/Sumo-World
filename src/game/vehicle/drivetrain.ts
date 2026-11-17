/**
 * Placeholder drivetrain: one forward ratio and a reverse, used only to report rpm and gear.
 * It does not yet feed engine force back into physics; the driving team replaces it with a
 * geared engine model behind the same `Drivetrain` shape.
 */
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7200;

/** Speed (m/s) at which the single placeholder ratio reaches the redline. */
const TOP_SPEED = 48;
const MOVING_THRESHOLD = 0.5;

export class Drivetrain {
  rpm = IDLE_RPM;
  gear = 0;

  update(signedSpeed: number, throttle: number): void {
    const moving = Math.abs(signedSpeed) > MOVING_THRESHOLD;
    if (signedSpeed < -MOVING_THRESHOLD) this.gear = -1;
    else if (moving || throttle > 0.05) this.gear = 1;
    else this.gear = 0;

    const ratio = Math.min(1, Math.abs(signedSpeed) / TOP_SPEED);
    this.rpm = IDLE_RPM + (REDLINE_RPM - IDLE_RPM) * ratio;
  }

  reset(): void {
    this.rpm = IDLE_RPM;
    this.gear = 0;
  }
}
