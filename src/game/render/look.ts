import type { WeatherState } from '../core/types';

/** Tone-mapping exposure in dry, calm weather (the prototype's value). */
export const BASE_EXPOSURE = 1.25;
/** Image-based light strength in dry weather. */
export const BASE_ENVIRONMENT_INTENSITY = 0.9;
export const BASE_HEMISPHERE_INTENSITY = 1.2;
export const BASE_MOON_INTENSITY = 2.4;

/** Wet nights read slightly darker overall; reflections carry the highlights instead. */
const WET_EXPOSURE_DROP = 0.08;
/** A full lightning flash multiplies exposure by 1 + LIGHTNING_EXPOSURE. */
const LIGHTNING_EXPOSURE = 1.6;
const LIGHTNING_SKYLIGHT = 4;
/** Wet surfaces pick up more of the environment's neon panels. */
const WET_ENVIRONMENT_BOOST = 0.35;
/** Below this strength the reflection pass is skipped entirely. */
export const MIN_REFLECTION_STRENGTH = 0.01;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

type LookWeather = Pick<WeatherState, 'wetness' | 'puddles' | 'lightning'>;

export function exposureFor(weather: LookWeather): number {
  const wet = 1 - WET_EXPOSURE_DROP * clamp01(weather.wetness);
  const flash = 1 + LIGHTNING_EXPOSURE * clamp01(weather.lightning);
  return BASE_EXPOSURE * wet * flash;
}

export function environmentIntensityFor(weather: LookWeather): number {
  return BASE_ENVIRONMENT_INTENSITY + WET_ENVIRONMENT_BOOST * clamp01(weather.wetness);
}

export function hemisphereIntensityFor(weather: LookWeather): number {
  return BASE_HEMISPHERE_INTENSITY * (1 + LIGHTNING_SKYLIGHT * clamp01(weather.lightning));
}

/** 0..1 strength of wet-road reflections; puddles add the last 40 percent. */
export function reflectionStrengthFor(weather: LookWeather): number {
  return clamp01(weather.wetness) * (0.6 + 0.4 * clamp01(weather.puddles));
}

/**
 * Growth factor for geometric ray-march steps so that `steps` steps starting at `firstStep`
 * cover `distance`. Solved by bisection because the series has no closed-form inverse.
 */
export function marchGrowth(steps: number, firstStep: number, distance: number): number {
  if (steps <= 1 || firstStep * steps >= distance) return 1;
  const covered = (growth: number) => (firstStep * (growth ** steps - 1)) / (growth - 1);
  let low = 1.000001;
  let high = 4;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (covered(mid) < distance) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
