import type { QualityPreset, QualitySettings } from '../core/types';

export const QUALITY_PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/** 'high' reproduces the original prototype's look exactly. */
export const DEFAULT_QUALITY: QualityPreset = 'high';

const SETTINGS: Record<QualityPreset, Omit<QualitySettings, 'preset'>> = {
  low: {
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    ssao: false,
    ssr: false,
    aa: 'none',
    rainParticles: 600,
    drawDistance: 260,
  },
  medium: {
    pixelRatioCap: 1.25,
    shadows: false,
    shadowMapSize: 1024,
    bloom: true,
    ssao: false,
    ssr: false,
    aa: 'fxaa',
    rainParticles: 1200,
    drawDistance: 400,
  },
  high: {
    pixelRatioCap: 1.5,
    shadows: false,
    shadowMapSize: 2048,
    bloom: true,
    ssao: false,
    ssr: false,
    aa: 'none',
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

/** Effective renderer pixel ratio for a device. */
export function pixelRatioFor(devicePixelRatio: number, settings: QualitySettings, scale = 1): number {
  return Math.min(devicePixelRatio, settings.pixelRatioCap) * scale;
}

export interface AdaptiveResolutionOptions {
  /** Frame-time budget in milliseconds (16.7 for 60 fps). */
  budgetMs: number;
  minScale: number;
  step: number;
  /** Seconds between adjustments, so the scale does not oscillate every frame. */
  interval: number;
}

const ADAPTIVE_DEFAULTS: AdaptiveResolutionOptions = {
  budgetMs: 1000 / 60,
  minScale: 0.6,
  step: 0.1,
  interval: 1,
};

/**
 * Lowers render resolution when frames run over budget and raises it again when there is
 * headroom. Disabled by default so the default preset renders at full resolution.
 */
export class AdaptiveResolution {
  enabled = false;
  scale = 1;
  private average: number;
  private elapsed = 0;
  private readonly options: AdaptiveResolutionOptions;

  constructor(options: Partial<AdaptiveResolutionOptions> = {}) {
    this.options = { ...ADAPTIVE_DEFAULTS, ...options };
    this.average = this.options.budgetMs;
  }

  /** Feeds one frame time (seconds) and returns the resolution scale to use. */
  update(dt: number): number {
    if (!this.enabled || dt <= 0) return this.scale;
    const { budgetMs, minScale, step, interval } = this.options;
    this.average += (dt * 1000 - this.average) * 0.1;
    this.elapsed += dt;
    if (this.elapsed < interval) return this.scale;
    this.elapsed = 0;
    if (this.average > budgetMs * 1.15) this.scale = Math.max(minScale, this.scale - step);
    else if (this.average < budgetMs * 0.8) this.scale = Math.min(1, this.scale + step);
    return this.scale;
  }

  reset(): void {
    this.scale = 1;
    this.elapsed = 0;
    this.average = this.options.budgetMs;
  }
}
