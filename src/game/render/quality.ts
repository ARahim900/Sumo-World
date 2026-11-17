import type { QualityPreset, QualitySettings } from '../core/types';

export const QUALITY_PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/**
 * Medium is the first-launch preset: high costs roughly twice the frame time, which integrated
 * laptop GPUs cannot sustain at 60 fps. Adaptive resolution covers what medium still misses.
 */
export const DEFAULT_QUALITY: QualityPreset = 'medium';

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
    pixelRatioCap: 1,
    shadows: true,
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
  ultra: { shadowExtent: 70, bloomScale: 1, aoScale: 0.5, aoSamples: 16, reflectionSteps: 24 },
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
  /** Seconds to wait before trying to drop again after a drop that did not help. */
  noGainHold: number;
  /** Upper bound for noGainHold after repeated drops that did not help. */
  maxNoGainHold: number;
}

const ADAPTIVE_DEFAULTS: AdaptiveResolutionOptions = {
  enabled: true,
  budgetMs: 1000 / 60,
  minScale: 0.6,
  step: 0.1,
  interval: 0.5,
  recoverDelay: 2,
  maxRecoverDelay: 16,
  noGainHold: 15,
  maxNoGainHold: 120,
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
/** Seconds at the floor before judging whether dropping resolution helped. */
const VERIFY = 1.5;
/**
 * The floor must cut average frame time by at least this share to count as a gain. The floor
 * renders about a third of the pixels, so a GPU-bound frame improves far more than this.
 */
const MIN_GAIN = 0.1;

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lowers render resolution when frames run over budget and probes a higher one after a period
 * of steady frames. Failed probes double the wait (up to maxRecoverDelay) so a scene that sits on
 * the edge does not flicker between resolutions.
 *
 * Frame time comes from requestAnimationFrame, so it also includes CPU time and any refresh cap
 * (a 30 Hz battery-saver mode, for example). Dropping resolution cannot help those frames. A run
 * of drops is therefore treated as a trial: if it reaches the floor without cutting frame time by
 * MIN_GAIN, the scale returns to where the trial started and drops pause for noGainHold seconds
 * (doubling up to maxNoGainHold). Intermediate steps are not judged, because frame time is
 * quantised to the display refresh and a single step often shows no change.
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
  private trial: { scale: number; average: number } | null = null;
  private sinceDrop = 0;
  private hold = 0;
  private holdLength: number;

  constructor(options: Partial<AdaptiveResolutionOptions> = {}) {
    this.options = { ...ADAPTIVE_DEFAULTS, ...options };
    this.enabled = this.options.enabled;
    this.average = this.options.budgetMs;
    this.delay = this.options.recoverDelay;
    this.holdLength = this.options.noGainHold;
  }

  /** Current wait, in seconds, before the next attempt to raise the scale. */
  get recoverDelay(): number {
    return this.delay;
  }

  /** Seconds left before over-budget frames may lower the scale again (0 when free to drop). */
  get dropHold(): number {
    return this.hold;
  }

  /** Feeds one frame time (seconds) and returns the resolution scale to use. */
  update(dt: number): number {
    if (!this.enabled || dt <= 0) return this.scale;
    const { budgetMs, interval, recoverDelay } = this.options;

    this.average += (dt * 1000 - this.average) * SMOOTHING;
    this.elapsed += dt;
    this.sinceRaise += dt;
    this.sinceDrop += dt;
    this.hold = Math.max(0, this.hold - dt);
    this.steady = this.average <= budgetMs * ON_BUDGET ? this.steady + dt : 0;
    if (this.elapsed < interval) return this.scale;
    this.elapsed = 0;

    if (this.average > budgetMs * OVER_BUDGET) {
      this.overBudget();
      return this.scale;
    }

    this.trial = null;
    if (this.probing && this.sinceRaise >= PROBATION) {
      this.probing = false;
      this.delay = recoverDelay;
    }
    if (this.scale < 1 && this.steady >= this.delay) {
      this.scale = roundScale(Math.min(1, this.scale + this.options.step));
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
    this.trial = null;
    this.sinceDrop = 0;
    this.hold = 0;
    this.holdLength = this.options.noGainHold;
  }

  private overBudget(): void {
    const { minScale, step, maxRecoverDelay, maxNoGainHold } = this.options;
    this.steady = 0;

    if (this.scale > minScale && this.hold === 0) {
      this.trial ??= { scale: this.scale, average: this.average };
      this.scale = roundScale(Math.max(minScale, this.scale - step));
      this.sinceDrop = 0;
      const failedProbe = this.probing && this.sinceRaise < PROBATION;
      if (failedProbe) this.delay = Math.min(maxRecoverDelay, this.delay * 2);
      this.probing = false;
      return;
    }

    this.probing = false;
    const trial = this.trial;
    if (!trial || this.scale > minScale || this.sinceDrop < VERIFY) return;

    this.trial = null;
    if (this.average < trial.average * (1 - MIN_GAIN)) return;
    this.scale = trial.scale;
    this.hold = this.holdLength;
    this.holdLength = Math.min(maxNoGainHold, this.holdLength * 2);
  }
}
