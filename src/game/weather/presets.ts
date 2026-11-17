import type { WeatherKind, WeatherState } from '../core/types';

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'drizzle', 'storm', 'fog'];

/** 'drizzle' reproduces the original prototype's rain, fog and wet grip. */
export const DEFAULT_WEATHER: WeatherKind = 'drizzle';

/** sRGB colour with 0..1 channels. */
export type Rgb = [number, number, number];

/** The settled values a weather kind transitions towards. */
export interface WeatherPreset {
  rainDensity: number;
  wetness: number;
  puddles: number;
  fogDensity: number;
  windX: number;
  windZ: number;
  /** Fog tint as a 0xRRGGBB sRGB value. */
  fogColour: number;
}

/** The renderer's original fog colour; clear and drizzle keep it so the default look is unchanged. */
const NIGHT_FOG = 0x101d32;

const PRESETS: Record<WeatherKind, WeatherPreset> = {
  clear: {
    rainDensity: 0,
    wetness: 0,
    puddles: 0,
    fogDensity: 0.006,
    windX: 0.6,
    windZ: 0.2,
    fogColour: NIGHT_FOG,
  },
  drizzle: {
    rainDensity: 1,
    wetness: 0.7,
    puddles: 0.3,
    fogDensity: 0.006,
    windX: 1.5,
    windZ: 0.4,
    fogColour: NIGHT_FOG,
  },
  storm: {
    rainDensity: 1,
    wetness: 1,
    puddles: 0.85,
    fogDensity: 0.01,
    windX: 5.5,
    windZ: -2.5,
    fogColour: 0x0b1424,
  },
  fog: {
    rainDensity: 0,
    wetness: 0.35,
    puddles: 0,
    fogDensity: 0.026,
    windX: 0.3,
    windZ: 0.1,
    fogColour: 0x3e4a63,
  },
};

/** Grip against road wetness: dry tarmac, the original drizzle value, then soaked. */
const GRIP_CURVE: readonly { wetness: number; grip: number }[] = [
  { wetness: 0, grip: 1 },
  { wetness: 0.7, grip: 0.88 },
  { wetness: 1, grip: 0.8 },
];

/** Standing water below this level does not reduce grip further. */
const PUDDLE_GRIP_START = 0.3;
/** Extra grip lost when the road is fully flooded. */
const PUDDLE_GRIP_PENALTY = 0.1;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Interpolation that returns exactly `b` at t = 1, so settled values match presets exactly. */
export function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** Tyre grip multiplier for a road surface state. */
export function gripFor(wetness: number, puddles: number): number {
  const w = clamp01(wetness);
  let grip = GRIP_CURVE[GRIP_CURVE.length - 1].grip;
  for (let i = 1; i < GRIP_CURVE.length; i++) {
    const from = GRIP_CURVE[i - 1];
    const to = GRIP_CURVE[i];
    if (w <= to.wetness) {
      grip = lerp(from.grip, to.grip, (w - from.wetness) / (to.wetness - from.wetness));
      break;
    }
  }
  const standing = Math.max(0, clamp01(puddles) - PUDDLE_GRIP_START) / (1 - PUDDLE_GRIP_START);
  return grip - PUDDLE_GRIP_PENALTY * standing;
}

export function presetFor(kind: WeatherKind): Readonly<WeatherPreset> {
  return PRESETS[kind];
}

/** Splits a 0xRRGGBB value into 0..1 sRGB channels, writing into `out`. */
export function hexToRgb(hex: number, out: Rgb): Rgb {
  out[0] = ((hex >> 16) & 0xff) / 255;
  out[1] = ((hex >> 8) & 0xff) / 255;
  out[2] = (hex & 0xff) / 255;
  return out;
}

/** Copies the settled preset for `kind` into an existing state object without allocating. */
export function applyWeather(target: WeatherState, kind: WeatherKind): WeatherState {
  const preset = PRESETS[kind];
  target.kind = kind;
  target.rainDensity = preset.rainDensity;
  target.wetness = preset.wetness;
  target.puddles = preset.puddles;
  target.fogDensity = preset.fogDensity;
  target.windX = preset.windX;
  target.windZ = preset.windZ;
  target.gripFactor = gripFor(preset.wetness, preset.puddles);
  target.lightning = 0;
  return target;
}

/** Returns a fresh, caller-owned, settled weather state for a fixed kind. */
export function weatherFor(kind: WeatherKind): WeatherState {
  return applyWeather(
    {
      kind,
      rainDensity: 0,
      wetness: 0,
      puddles: 0,
      fogDensity: 0,
      windX: 0,
      windZ: 0,
      gripFactor: 1,
      lightning: 0,
    },
    kind,
  );
}

/** The kind the HUD menu's legacy rain toggle should switch to. */
export function toggledRainKind(current: Pick<WeatherState, 'kind'>): WeatherKind {
  return presetFor(current.kind).rainDensity > 0 ? 'clear' : DEFAULT_WEATHER;
}
