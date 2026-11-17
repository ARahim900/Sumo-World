export const SPAWN = { x: 4, y: 0.95, z: 24 };
export const DESTINATION = { x: 4, y: 0, z: -104 };
export const STEP = 1 / 60;
export interface Block { x: number; z: number; w: number; d: number; h: number; style: number }
export const blocks: Block[] = [];
let seed = 3127;
export function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
for (let x = -150; x <= 150; x += 60) for (let z = -150; z <= 150; z += 60) {
  for (const dx of [-11, 11]) for (const dz of [-11, 11]) {
    blocks.push({ x: x + dx, z: z + dz, w: 17 + random() * 3, d: 17 + random() * 3, h: 16 + random() * 62, style: Math.floor(random() * 4) });
  }
}
export interface Intent { throttle: number; brake: number; steer: number; handbrake: boolean; moveX: number; moveZ: number; sprint: boolean; jump: boolean }
export const neutral = (): Intent => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, moveX: 0, moveZ: 0, sprint: false, jump: false });
export type Mission = 'enter' | 'drive' | 'complete';
export function arrivalEligible(x: number, y: number, z: number, speed: number, driving: boolean) {
  return driving && Math.hypot(x - DESTINATION.x, z - DESTINATION.z) < 5 && y < 2 && y > 0 && speed < 1;
}
