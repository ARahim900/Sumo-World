/** A source of uniformly distributed numbers in [0, 1). */
export type RandomSource = () => number;

/**
 * Small seeded generator (mulberry32). Weather logic takes a RandomSource so tests can replay
 * the exact same sequence of strikes and auto-weather changes.
 */
export function createRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random number in [min, max). */
export function between(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random();
}
