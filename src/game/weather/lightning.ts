import { between, type RandomSource } from './random';

/** A thunderclap, delivered once its sound has travelled from the strike. */
export interface ThunderEvent {
  /** Distance from the player to the strike, metres. */
  distance: number;
  /** 0..1 how loud the clap should be; nearer strikes are louder. */
  loudness: number;
}

export type ThunderListener = (event: ThunderEvent) => void;

const SPEED_OF_SOUND = 343;
const MIN_DISTANCE = 400;
const MAX_DISTANCE = 3000;

/** Delay before the first strike once a storm builds, seconds. */
const FIRST_STRIKE: readonly [number, number] = [2, 6];
/**
 * Gap between strikes, seconds. Each strike is at most two pulses inside half a second, so
 * this keeps the flash rate well under the three-flashes-per-second photosensitivity limit.
 */
const STRIKE_GAP: readonly [number, number] = [7, 20];
const SECOND_PULSE_CHANCE = 0.6;
const SECOND_PULSE_DELAY: readonly [number, number] = [0.28, 0.42];

const ATTACK = 0.04;
const DECAY = 0.12;
/** Reduced-motion strikes are a single, slow, dim glow instead of a sharp double flash. */
const REDUCED_PEAK = 0.35;
const REDUCED_ATTACK = 0.18;
const REDUCED_DECAY = 0.45;
const SILENT = 0.004;
const MAX_PENDING = 4;

interface Pulse {
  start: number;
  peak: number;
}

interface PendingThunder {
  remaining: number;
  distance: number;
  loudness: number;
}

/** Brightness of one flash pulse `t` seconds after it starts. */
export function pulseIntensity(t: number, peak: number, attack: number, decay: number): number {
  if (t < 0) return 0;
  if (t < attack) return (peak * t) / attack;
  return peak * Math.exp(-(t - attack) / decay);
}

/** Seconds for thunder to reach the listener from a strike `distance` metres away. */
export function thunderDelay(distance: number): number {
  return distance / SPEED_OF_SOUND;
}

/** 0..1 loudness for a strike `distance` metres away. */
export function thunderLoudness(distance: number): number {
  return Math.min(1, Math.max(0.2, 1.15 - distance / MAX_DISTANCE));
}

/**
 * Schedules lightning strikes while a storm is active, produces the flash envelope and
 * delivers each thunderclap after the sound's travel time. Pure logic: no rendering or audio.
 */
export class Lightning {
  /** Current 0..1 flash brightness. */
  intensity = 0;
  private clock = 0;
  private armed = false;
  private untilStrike = 0;
  private attack = ATTACK;
  private decay = DECAY;
  private readonly pulses: Pulse[] = [
    { start: 0, peak: 0 },
    { start: 0, peak: 0 },
  ];
  private pulseCount = 0;
  private readonly pending: PendingThunder[] = [];

  constructor(private readonly random: RandomSource) {
    for (let i = 0; i < MAX_PENDING; i++) this.pending.push({ remaining: 0, distance: 0, loudness: 0 });
  }

  /** Number of thunderclaps still travelling. */
  get pendingThunder(): number {
    return this.pending.filter(item => item.remaining > 0).length;
  }

  /**
   * Advances the storm by `dt` seconds. `active` arms strikes; `reduceFlashes` caps the flash
   * for players who asked for less motion. Returns the flash brightness.
   */
  update(dt: number, active: boolean, reduceFlashes: boolean, onThunder?: ThunderListener): number {
    if (dt <= 0) return this.intensity;
    this.clock += dt;
    this.deliverThunder(dt, onThunder);

    if (!active) {
      this.armed = false;
    } else {
      if (!this.armed) {
        this.armed = true;
        this.untilStrike = between(this.random, FIRST_STRIKE[0], FIRST_STRIKE[1]);
      }
      this.untilStrike -= dt;
      if (this.untilStrike <= 0) {
        this.strike(reduceFlashes);
        this.untilStrike = between(this.random, STRIKE_GAP[0], STRIKE_GAP[1]);
      }
    }

    this.intensity = this.envelope();
    if (reduceFlashes) this.intensity = Math.min(this.intensity, REDUCED_PEAK);
    return this.intensity;
  }

  /** Forces a strike now. Used by tests and by the storm scheduler. */
  strike(reduceFlashes: boolean): void {
    const distance = between(this.random, MIN_DISTANCE, MAX_DISTANCE);
    const closeness = 1 - (distance - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE);
    const peak = between(this.random, 0.7, 1) * (0.6 + 0.4 * closeness);

    if (reduceFlashes) {
      this.attack = REDUCED_ATTACK;
      this.decay = REDUCED_DECAY;
      this.setPulse(0, this.clock, Math.min(peak, REDUCED_PEAK));
      this.pulseCount = 1;
    } else {
      this.attack = ATTACK;
      this.decay = DECAY;
      this.setPulse(0, this.clock, peak);
      this.pulseCount = 1;
      if (this.random() < SECOND_PULSE_CHANCE) {
        const delay = between(this.random, SECOND_PULSE_DELAY[0], SECOND_PULSE_DELAY[1]);
        this.setPulse(1, this.clock + delay, peak * between(this.random, 0.55, 0.85));
        this.pulseCount = 2;
      }
    }
    this.queueThunder(distance);
  }

  reset(): void {
    this.intensity = 0;
    this.clock = 0;
    this.armed = false;
    this.untilStrike = 0;
    this.pulseCount = 0;
    for (const item of this.pending) item.remaining = 0;
  }

  private setPulse(index: number, start: number, peak: number): void {
    this.pulses[index].start = start;
    this.pulses[index].peak = peak;
  }

  private envelope(): number {
    let value = 0;
    let finished = true;
    for (let i = 0; i < this.pulseCount; i++) {
      const pulse = this.pulses[i];
      const t = this.clock - pulse.start;
      const brightness = pulseIntensity(t, pulse.peak, this.attack, this.decay);
      value = Math.max(value, brightness);
      if (t < this.attack || brightness > SILENT) finished = false;
    }
    if (finished) {
      this.pulseCount = 0;
      return 0;
    }
    return value;
  }

  private queueThunder(distance: number): void {
    let slot = this.pending.find(item => item.remaining <= 0);
    // With strikes at least seven seconds apart this never fills; if it did, replace the
    // clap closest to arriving rather than losing the newest strike.
    slot ??= this.pending.reduce((a, b) => (a.remaining < b.remaining ? a : b));
    slot.remaining = thunderDelay(distance);
    slot.distance = distance;
    slot.loudness = thunderLoudness(distance);
  }

  private deliverThunder(dt: number, onThunder?: ThunderListener): void {
    for (const item of this.pending) {
      if (item.remaining <= 0) continue;
      item.remaining -= dt;
      if (item.remaining <= 0) {
        item.remaining = 0;
        onThunder?.({ distance: item.distance, loudness: item.loudness });
      }
    }
  }
}
