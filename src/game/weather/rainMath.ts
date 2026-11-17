/** Seconds of simulated shutter: streak length is the distance a drop moves in this time. */
export const SHUTTER = 0.034;
/** Longest streak drawn, metres, so very fast driving does not turn rain into laser beams. */
export const MAX_STREAK = 2.4;
/** Fastest camera speed trusted for streak stretch; larger jumps are teleports (recover, restart). */
export const MAX_CAMERA_SPEED = 80;

/** How many of `budget` particles to draw at a 0..1 `density`. */
export function activeCount(budget: number, density: number): number {
  return Math.floor(Math.max(0, budget) * Math.min(1, Math.max(0, density)));
}

/** Streak length for a drop moving at `relativeSpeed` m/s relative to the camera. */
export function streakLength(relativeSpeed: number): number {
  return Math.min(MAX_STREAK, Math.abs(relativeSpeed) * SHUTTER);
}

/**
 * Wraps an accumulated drift into [0, size). The shader adds drift to each drop's seed and
 * wraps again, so keeping the uniform small preserves float precision in long sessions.
 */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** Fall speed of rain streaks, m/s. Harder, wind-driven rain falls faster. */
export function fallSpeed(windSpeed: number): number {
  return 19 + 5 * Math.min(1, windSpeed / 6);
}

/** Lens drops landing per second for a rain density and camera speed. */
export function lensSpawnRate(density: number, speed: number): number {
  if (density <= 0) return 0;
  return 1.4 * density * (1 + Math.min(speed, 40) * 0.04);
}
