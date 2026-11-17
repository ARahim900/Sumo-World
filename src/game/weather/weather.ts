import type {
  GameSystem,
  WeatherKind,
  WeatherSetting,
  WeatherState,
} from '../core/types';

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'drizzle', 'storm', 'fog'];

/** 'drizzle' reproduces the original prototype's rain, fog and wet grip. */
export const DEFAULT_WEATHER: WeatherKind = 'drizzle';

const PRESETS: Record<WeatherKind, Omit<WeatherState, 'kind'>> = {
  clear: {
    rainDensity: 0,
    wetness: 0,
    puddles: 0,
    fogDensity: 0.006,
    windX: 0,
    windZ: 0,
    gripFactor: 1,
    lightning: 0,
  },
  drizzle: {
    rainDensity: 1,
    wetness: 0.7,
    puddles: 0.3,
    fogDensity: 0.006,
    windX: 0,
    windZ: 0,
    gripFactor: 0.88,
    lightning: 0,
  },
  storm: {
    rainDensity: 1,
    wetness: 1,
    puddles: 0.8,
    fogDensity: 0.009,
    windX: 3,
    windZ: -1.5,
    gripFactor: 0.78,
    lightning: 0,
  },
  fog: {
    rainDensity: 0,
    wetness: 0.3,
    puddles: 0,
    fogDensity: 0.02,
    windX: 0,
    windZ: 0,
    gripFactor: 0.95,
    lightning: 0,
  },
};

/** Returns a fresh, caller-owned weather state for a fixed kind. */
export function weatherFor(kind: WeatherKind): WeatherState {
  return { kind, ...PRESETS[kind] };
}

/** Copies the preset for `kind` into an existing state object without allocating. */
export function applyWeather(target: WeatherState, kind: WeatherKind): WeatherState {
  return Object.assign(target, PRESETS[kind], { kind });
}

/** The kind the HUD menu's legacy rain toggle should switch to. */
export function toggledRainKind(current: WeatherState): WeatherKind {
  return current.rainDensity > 0 ? 'clear' : DEFAULT_WEATHER;
}

/**
 * Weather source of truth. Placeholder behaviour: fixed kinds snap instantly and 'auto'
 * holds the current kind. The weather team adds transitions, auto cycling and lightning.
 */
export class WeatherSystem implements GameSystem {
  readonly name = 'weather';
  readonly state: WeatherState = weatherFor(DEFAULT_WEATHER);
  private current: WeatherSetting = DEFAULT_WEATHER;

  get setting(): WeatherSetting {
    return this.current;
  }

  setWeather(setting: WeatherSetting): void {
    this.current = setting;
    if (setting !== 'auto') applyWeather(this.state, setting);
  }

  /** Nothing to build yet: the placeholder has no visuals of its own. */
  init(): void {}

  /** Fixed kinds and 'auto' are both static in the placeholder, so there is nothing to advance. */
  update(): void {}

  dispose(): void {
    applyWeather(this.state, DEFAULT_WEATHER);
    this.current = DEFAULT_WEATHER;
  }
}
