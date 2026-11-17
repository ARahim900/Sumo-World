import type { Snapshot } from './types';

/**
 * HUD state before the runtime is ready. Kept free of three/Rapier imports so the page can
 * render its menu without pulling the game bundle into the initial chunk.
 */
export const initialSnapshot: Snapshot = {
  ready: false,
  paused: true,
  driving: false,
  mission: 'enter',
  speed: 0,
  distance: 128,
  hold: 0,
  prompt: '',
  notice: '',
  x: 7,
  z: 24,
  yaw: Math.PI,
  rain: true,
  sound: false,
  firstPerson: false,
  fps: 0,
  quality: 'high',
  weather: 'drizzle',
  weatherSetting: 'drizzle',
  lowMotion: false,
  rpm: 0,
  gear: 0,
};
