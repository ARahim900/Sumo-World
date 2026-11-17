import type { QualityPreset, QualitySettings } from '../core/types';

export const QUALITY_PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

export const DEFAULT_QUALITY: QualityPreset = 'high';

const SETTINGS: Record<QualityPreset, Omit<QualitySettings, 'preset'>> = {
  low: {
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    ssao: false,
    ssr: false,
    aa: 'fxaa',
    rainParticles: 600,
    drawDistance: 260,
  },
  medium: {
    pixelRatioCap: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    ssao: false,
    ssr: false,
    aa: 'smaa',
    rainParticles: 1200,
    drawDistance: 400,
  },
  high: {
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    ssao: true,
    ssr: false,
    aa: 'smaa',
    rainParticles: 1800,
    drawDistance: 550,
  },
  ultra: {
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 4096,
    bloom: true,
    ssao: true,
    ssr: true,
    aa: 'smaa',
    rainParticles: 3600,
    drawDistance: 550,
  },
};

/** Returns a fresh, caller-owned settings object for `preset`. */
export function qualitySettings(preset: QualityPreset): QualitySettings {
  return { preset, ...SETTINGS[preset] };
}

/**
 * Renderer-internal tuning that does not belong in the shared QualitySettings contract.
 * Resolution scales are relative to the current render size.
 */
export interface RenderTuning {
  /** Half-width of the camera-following shadow frustum, metres. */
  shadowExtent: number;
  /** Bloom mip chain size relative to the render size. */
  bloomScale: number;
  /** Ambient occlusion buffer size relative to the render size. */
  aoScale: number;
  /** Ambient occlusion samples per pixel. */
  aoSamples: number;
  /** Ray-march steps for wet-road reflections. */
  reflectionSteps: number;
}

const TUNING: Record<QualityPreset, RenderTuning> = {
  low: { shadowExtent: 0, bloomScale: 0.5, aoScale: 0.5, aoSamples: 8, reflectionSteps: 0 },
  medium: { shadowExtent: 35, bloomScale: 0.5, aoScale: 0.5, aoSamples: 8, reflectionSteps: 0 },
  high: { shadowExtent: 50, bloomScale: 0.75, aoScale: 0.5, aoSamples: 12, reflectionSteps: 0 },
  ultra: { shadowExtent: 70, bloomScale: 1, aoScale: 1, aoSamples: 16, reflectionSteps: 24 },
};

export function renderTuning(preset: QualityPreset): RenderTuning {
  return { ...TUNING[preset] };
}

/**
 * Effective renderer pixel ratio. The preset cap is applied before the adaptive scale, so the
 * result never exceeds min(devicePixelRatio, cap).
 */
export function pixelRatioFor(devicePixelRatio: number, settings: QualitySettings, scale = 1): number {
  const clampedScale = Math.min(1, Math.max(0, scale));
  return Math.min(devicePixelRatio, settings.pixelRatioCap) * clampedScale;
}

export interface AdaptiveResolutionOptions {
  enabled: boolean;
  /** Frame-time budget in milliseconds (16.7 for 60 fps). */
  budgetMs: number;
  minScale: number;
  step: number;
  /** Seconds between decisions, so the scale does not oscillate every frame. */
  interval: number;
  /** Seconds of on-budget frames required before trying a higher scale. */
  recoverDelay: number;
  /** Upper bound for the recovery delay after repeated failed recoveries. */
  maxRecoverDelay: number;
}

const ADAPTIVE_DEFAULTS: AdaptiveResolutionOptions = {
  enabled: true,
  budgetMs: 1000 / 60,
  minScale: 0.6,
  step: 0.1,
  interval: 0.5,
  recoverDelay: 2,
  maxRecoverDelay: 16,
};

/** Weight of the newest frame in the exponential moving average of frame time. */
const SMOOTHING = 0.1;
/** Average frame time above budget * OVER_BUDGET lowers the scale (about 50 fps at 60 Hz). */
const OVER_BUDGET = 1.2;
/**
 * Frames count as on budget up to budget * ON_BUDGET. Frame time is quantised to the display
 * refresh, so a 60 Hz screen never reports headroom below 16.7 ms; recovery therefore relies on
 * sustained on-budget time rather than on measured spare time.
 */
const ON_BUDGET = 1.1;
/** A drop within this many seconds of a raise means the raise failed. */
const PROBATION = 3;

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lowers render resolution when frames run over budget and probes a higher one after a period
 * of steady frames. Failed probes double the wait (up to maxRecoverDelay) so a scene that sits on
 * the edge does not flicker between resolutions.
 */
export class AdaptiveResolution {
  enabled: boolean;
  scale = 1;
  private readonly options: AdaptiveResolutionOptions;
  private average: number;
  private elapsed = 0;
  private steady = 0;
  private sinceRaise = 0;
  private probing = false;
  private delay: number;

  constructor(options: Partial<AdaptiveResolutionOptions> = {}) {
    this.options = { ...ADAPTIVE_DEFAULTS, ...options };
    this.enabled = this.options.enabled;
    this.average = this.options.budgetMs;
    this.delay = this.options.recoverDelay;
  }

  /** Current wait, in seconds, before the next attempt to raise the scale. */
  get recoverDelay(): number {
    return this.delay;
  }

  /** Feeds one frame time (seconds) and returns the resolution scale to use. */
  update(dt: number): number {
    if (!this.enabled || dt <= 0) return this.scale;
    const { budgetMs, minScale, step, interval, recoverDelay, maxRecoverDelay } = this.options;

    this.average += (dt * 1000 - this.average) * SMOOTHING;
    this.elapsed += dt;
    this.sinceRaise += dt;
    this.steady = this.average <= budgetMs * ON_BUDGET ? this.steady + dt : 0;
    if (this.elapsed < interval) return this.scale;
    this.elapsed = 0;

    if (this.average > budgetMs * OVER_BUDGET) {
      if (this.scale > minScale) {
        this.scale = roundScale(Math.max(minScale, this.scale - step));
        const failedProbe = this.probing && this.sinceRaise < PROBATION;
        if (failedProbe) this.delay = Math.min(maxRecoverDelay, this.delay * 2);
      }
      this.probing = false;
      this.steady = 0;
      return this.scale;
    }

    if (this.probing && this.sinceRaise >= PROBATION) {
      this.probing = false;
      this.delay = recoverDelay;
    }
    if (this.scale < 1 && this.steady >= this.delay) {
      this.scale = roundScale(Math.min(1, this.scale + step));
      this.steady = 0;
      this.sinceRaise = 0;
      this.probing = true;
    }
    return this.scale;
  }

  reset(): void {
    this.scale = 1;
    this.elapsed = 0;
    this.steady = 0;
    this.sinceRaise = 0;
    this.probing = false;
    this.average = this.options.budgetMs;
    this.delay = this.options.recoverDelay;
  }
}
