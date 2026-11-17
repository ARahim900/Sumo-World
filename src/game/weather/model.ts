import type { WeatherKind, WeatherSetting, WeatherState } from '../core/types';
import { Lightning, type ThunderListener } from './lightning';
import {
  DEFAULT_WEATHER,
  gripFor,
  hexToRgb,
  lerp,
  presetFor,
  weatherFor,
  type Rgb,
} from './presets';
import { between, createRandom, type RandomSource } from './random';

/** Seconds a menu-chosen weather change takes to blend in. */
export const MANUAL_TRANSITION = 4;
/** Seconds an automatic weather change takes to blend in. */
export const AUTO_TRANSITION = 12;

/** Wetness gained per second under full rain (soaked from dry in eight seconds). */
const WET_RATE = 1 / 8;
/** Share of WET_RATE that still applies without rain, so fog slowly dampens the road. */
const DAMP_SHARE = 0.25;
/** Wetness lost per second while drying. */
const DRY_RATE = 1 / 45;
/** Puddle depth gained per second under full rain. */
const PUDDLE_FILL_RATE = 1 / 25;
/** Puddle depth lost per second while draining. */
const PUDDLE_DRAIN_RATE = 1 / 90;

/** Gusts swing wind speed by up to this share of the base wind. */
const GUST_STRENGTH = 0.35;
/** Gusts also veer the wind by up to this many radians. */
const GUST_VEER = 0.12;
/** Lightning starts once storm rain has built past this density. */
const LIGHTNING_RAIN = 0.6;

/** How long auto mode holds each kind, seconds. */
const AUTO_HOLD: Record<WeatherKind, readonly [number, number]> = {
  clear: [50, 100],
  drizzle: [45, 90],
  storm: [30, 60],
  fog: [40, 80],
};

/** Weighted kinds auto mode may move to next. Storms only build from, and ease back to, drizzle. */
export const AUTO_NEXT: Record<WeatherKind, readonly { kind: WeatherKind; weight: number }[]> = {
  clear: [
    { kind: 'drizzle', weight: 0.6 },
    { kind: 'fog', weight: 0.4 },
  ],
  drizzle: [
    { kind: 'clear', weight: 0.35 },
    { kind: 'storm', weight: 0.4 },
    { kind: 'fog', weight: 0.25 },
  ],
  storm: [{ kind: 'drizzle', weight: 1 }],
  fog: [
    { kind: 'clear', weight: 0.5 },
    { kind: 'drizzle', weight: 0.5 },
  ],
};

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Moves `current` towards `target` by at most `maxStep`, landing exactly on the target. */
export function moveTowards(current: number, target: number, maxStep: number): number {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

/** Picks the kind auto mode moves to after `current`. */
export function nextAutoKind(current: WeatherKind, random: RandomSource): WeatherKind {
  const options = AUTO_NEXT[current];
  let roll = random() * options.reduce((sum, option) => sum + option.weight, 0);
  for (const option of options) {
    roll -= option.weight;
    if (roll < 0) return option.kind;
  }
  return options[options.length - 1].kind;
}

/** Smooth 1 ± GUST_STRENGTH multiplier built from two slow, unrelated sine waves. */
export function gustFactor(time: number): number {
  return 1 + GUST_STRENGTH * (0.6 * Math.sin(time * 0.37) + 0.4 * Math.sin(time * 1.13 + 1.7));
}

interface BlendStart {
  rainDensity: number;
  fogDensity: number;
  windX: number;
  windZ: number;
  fogColour: Rgb;
}

/**
 * The weather state machine. It blends rain, fog, wind and fog colour towards the target
 * kind over a few seconds, lets the road wet and dry at physical-feeling rates, cycles kinds
 * in auto mode and runs the storm's lightning. Pure logic so it can be tested in node.
 */
export class WeatherModel {
  /** Published every frame; the object identity never changes. */
  readonly state: WeatherState = weatherFor(DEFAULT_WEATHER);
  /** Current fog tint, 0..1 sRGB. */
  readonly fogColour: Rgb = [0, 0, 0];
  readonly lightning: Lightning;
  private current: WeatherSetting = DEFAULT_WEATHER;
  private readonly from: BlendStart = { rainDensity: 0, fogDensity: 0, windX: 0, windZ: 0, fogColour: [0, 0, 0] };
  private readonly targetColour: Rgb = [0, 0, 0];
  private baseWindX = 0;
  private baseWindZ = 0;
  private progress = 1;
  private duration = MANUAL_TRANSITION;
  private untilAutoChange = 0;
  private clock = 0;

  constructor(private readonly random: RandomSource = createRandom(Date.now())) {
    this.lightning = new Lightning(random);
    this.reset();
  }

  get setting(): WeatherSetting {
    return this.current;
  }

  /** True while rain, fog and wind are still blending towards the target kind. */
  get transitioning(): boolean {
    return this.progress < 1;
  }

  /** Chooses a fixed kind or 'auto'. Fixed kinds blend in over `duration` seconds. */
  setSetting(setting: WeatherSetting, duration = MANUAL_TRANSITION): void {
    if (setting === 'auto') {
      if (this.current !== 'auto') this.untilAutoChange = this.holdFor(this.state.kind);
      this.current = 'auto';
      return;
    }
    this.current = setting;
    this.begin(setting, duration);
  }

  /**
   * Advances the weather by `dt` seconds. `reduceFlashes` dims lightning for players who
   * asked for less motion; `onThunder` hears each thunderclap when it arrives.
   */
  update(dt: number, reduceFlashes: boolean, onThunder?: ThunderListener): void {
    if (dt <= 0) return;
    this.clock += dt;
    const state = this.state;

    if (this.current === 'auto') {
      this.untilAutoChange -= dt;
      if (this.untilAutoChange <= 0) {
        const next = nextAutoKind(state.kind, this.random);
        this.begin(next, AUTO_TRANSITION);
        this.untilAutoChange = this.holdFor(next);
      }
    }

    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / this.duration);
      this.blend(smoothstep(this.progress));
    }

    const preset = presetFor(state.kind);
    const wetRate = state.wetness < preset.wetness ? WET_RATE * Math.max(state.rainDensity, DAMP_SHARE) : DRY_RATE;
    state.wetness = moveTowards(state.wetness, preset.wetness, wetRate * dt);
    const puddleRate = state.puddles < preset.puddles ? PUDDLE_FILL_RATE * state.rainDensity : PUDDLE_DRAIN_RATE;
    state.puddles = moveTowards(state.puddles, preset.puddles, puddleRate * dt);
    state.gripFactor = gripFor(state.wetness, state.puddles);

    const gust = gustFactor(this.clock);
    const veer = GUST_VEER * Math.sin(this.clock * 0.23);
    const cos = Math.cos(veer);
    const sin = Math.sin(veer);
    state.windX = (this.baseWindX * cos - this.baseWindZ * sin) * gust;
    state.windZ = (this.baseWindX * sin + this.baseWindZ * cos) * gust;

    const stormy = state.kind === 'storm' && state.rainDensity >= LIGHTNING_RAIN;
    state.lightning = this.lightning.update(dt, stormy, reduceFlashes, onThunder);
  }

  /** Jumps straight to the settled target, skipping any blend still in progress. */
  settle(): void {
    this.progress = 1;
    this.blend(1);
    const preset = presetFor(this.state.kind);
    this.state.wetness = preset.wetness;
    this.state.puddles = preset.puddles;
    this.state.gripFactor = gripFor(preset.wetness, preset.puddles);
  }

  /** Returns to a settled, fixed `kind` with no storm or auto mode in progress. */
  reset(kind: WeatherKind = DEFAULT_WEATHER): void {
    this.current = kind;
    this.clock = 0;
    this.untilAutoChange = 0;
    this.lightning.reset();
    this.state.kind = kind;
    this.captureStart();
    hexToRgb(presetFor(kind).fogColour, this.targetColour);
    this.settle();
    this.state.windX = this.baseWindX;
    this.state.windZ = this.baseWindZ;
    this.state.lightning = 0;
  }

  private begin(kind: WeatherKind, duration: number): void {
    // Asking for the kind already in place (or already blending in) keeps the current blend.
    if (kind === this.state.kind) return;
    this.captureStart();
    this.state.kind = kind;
    hexToRgb(presetFor(kind).fogColour, this.targetColour);
    this.duration = Math.max(duration, 1e-3);
    this.progress = 0;
  }

  private captureStart(): void {
    const from = this.from;
    from.rainDensity = this.state.rainDensity;
    from.fogDensity = this.state.fogDensity;
    from.windX = this.baseWindX;
    from.windZ = this.baseWindZ;
    from.fogColour[0] = this.fogColour[0];
    from.fogColour[1] = this.fogColour[1];
    from.fogColour[2] = this.fogColour[2];
  }

  private blend(t: number): void {
    const preset = presetFor(this.state.kind);
    const from = this.from;
    this.state.rainDensity = lerp(from.rainDensity, preset.rainDensity, t);
    this.state.fogDensity = lerp(from.fogDensity, preset.fogDensity, t);
    this.baseWindX = lerp(from.windX, preset.windX, t);
    this.baseWindZ = lerp(from.windZ, preset.windZ, t);
    for (let i = 0; i < 3; i++) this.fogColour[i] = lerp(from.fogColour[i], this.targetColour[i], t);
  }

  private holdFor(kind: WeatherKind): number {
    const [min, max] = AUTO_HOLD[kind];
    return between(this.random, min, max);
  }
}
