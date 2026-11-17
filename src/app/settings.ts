import type {
  QualityPreset,
  WeatherKind,
  WeatherSetting,
} from '../game/core/types';
import { DEFAULT_QUALITY, QUALITY_PRESETS } from '../game/render/quality';
import { DEFAULT_WEATHER, WEATHER_KINDS } from '../game/weather/weather';

/** Player preferences kept between visits. */
export interface GameSettings {
  quality: QualityPreset;
  weather: WeatherSetting;
  lowMotion: boolean;
  sound: boolean;
}

export const SETTINGS_KEY = 'sumo-world:settings:v1';

export const WEATHER_SETTINGS: readonly WeatherSetting[] = ['auto', ...WEATHER_KINDS];

export function defaultSettings(prefersReducedMotion = false): GameSettings {
  return {
    quality: DEFAULT_QUALITY,
    weather: DEFAULT_WEATHER,
    lowMotion: prefersReducedMotion,
    sound: false,
  };
}

function isQuality(value: unknown): value is QualityPreset {
  return typeof value === 'string' && (QUALITY_PRESETS as readonly string[]).includes(value);
}

function isWeatherSetting(value: unknown): value is WeatherSetting {
  return typeof value === 'string' && (WEATHER_SETTINGS as readonly string[]).includes(value);
}

/**
 * Reads stored settings field by field, so a corrupt or outdated entry only loses the
 * fields that no longer make sense instead of the whole record.
 */
export function parseSettings(raw: string | null, fallback: GameSettings): GameSettings {
  if (!raw) return { ...fallback };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...fallback };
  }
  if (typeof data !== 'object' || data === null) return { ...fallback };
  const record = data as Record<string, unknown>;
  return {
    quality: isQuality(record.quality) ? record.quality : fallback.quality,
    weather: isWeatherSetting(record.weather) ? record.weather : fallback.weather,
    lowMotion: typeof record.lowMotion === 'boolean' ? record.lowMotion : fallback.lowMotion,
    sound: typeof record.sound === 'boolean' ? record.sound : fallback.sound,
  };
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/** Private browsing and blocked storage throw on access; both fall back to defaults. */
export function loadSettings(storage: ReadableStorage | null, fallback: GameSettings): GameSettings {
  if (!storage) return { ...fallback };
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY), fallback);
  } catch {
    return { ...fallback };
  }
}

/** Returns false when the browser refuses to store the settings. */
export function saveSettings(storage: WritableStorage | null, settings: GameSettings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ HUD formatting */

export function formatGear(gear: number): string {
  if (gear < 0) return 'R';
  if (gear === 0) return 'N';
  return String(Math.round(gear));
}

/** Share of the rev range used, 0 at a standstill and 1 at the redline. */
export function rpmFraction(rpm: number, redline: number): number {
  if (!Number.isFinite(rpm) || redline <= 0) return 0;
  return Math.min(1, Math.max(0, rpm / redline));
}

const WEATHER_LABELS: Record<WeatherSetting, string> = {
  auto: 'Auto',
  clear: 'Clear',
  drizzle: 'Drizzle',
  storm: 'Storm',
  fog: 'Fog',
};

export function weatherLabel(setting: WeatherSetting | WeatherKind): string {
  return WEATHER_LABELS[setting];
}

const QUALITY_LABELS: Record<QualityPreset, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

export function qualityLabel(preset: QualityPreset): string {
  return QUALITY_LABELS[preset];
}

/** True for `?debug`, `?debug=1` and `?debug=true`; `?debug=0` and `?debug=false` turn it off. */
export function debugRequested(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has('debug')) return false;
  const value = params.get('debug')?.toLowerCase() ?? '';
  return value !== '0' && value !== 'false';
}

/* ------------------------------------------------------------------ Loading */

export type LoadStage = 'download' | 'graphics' | 'city' | 'ready';

export const LOAD_STAGES: readonly LoadStage[] = ['download', 'graphics', 'city', 'ready'];

const LOAD_LABELS: Record<LoadStage, string> = {
  download: 'Downloading the game engine',
  graphics: 'Starting the graphics',
  city: 'Building the city',
  ready: 'Ready',
};

export function loadLabel(stage: LoadStage): string {
  return LOAD_LABELS[stage];
}

/** Share of loading steps finished when `stage` begins: 0 while downloading, 1 when ready. */
export function loadProgress(stage: LoadStage): number {
  return LOAD_STAGES.indexOf(stage) / (LOAD_STAGES.length - 1);
}

/* ------------------------------------------------------------------ Device */

/** A device whose only pointer is a finger, with no hover-capable pointer attached. */
export function isTouchOnly(match: (query: string) => boolean): boolean {
  return match('(pointer: coarse)') && !match('(any-pointer: fine)');
}
