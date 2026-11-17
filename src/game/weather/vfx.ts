import * as T from 'three';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';

const PARTICLES = 90;
const REAR_WHEELS = [2, 3] as const;
const MIN_SPEED = 5;
const RISE_SPEED = 0.4;
/** Share of the wind speed that spray picks up while it hangs in the air. */
const WIND_DRIFT = 0.6;
const HIDDEN_Y = -20;
const BASE_OPACITY = 0.2;
const SPRITE_SIZE = 32;

/** Soft round puff used as the spray's alpha map, so particles are not drawn as hard squares. */
function createPuffTexture(): T.DataTexture {
  const data = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE * 4);
  const half = SPRITE_SIZE / 2;
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
      const falloff = Math.max(0, 1 - d);
      const value = Math.round(255 * falloff * falloff);
      data.set([value, value, value, 255], (y * SPRITE_SIZE + x) * 4);
    }
  }
  const texture = new T.DataTexture(data, SPRITE_SIZE, SPRITE_SIZE);
  texture.needsUpdate = true;
  return texture;
}

/** 0..1 how much spray to emit, or 0 when the car is not throwing any up. */
export function sprayAmount(
  driving: boolean,
  speed: number,
  handbrake: boolean,
  wetness: number,
): number {
  if (!driving || speed <= MIN_SPEED) return 0;
  if (handbrake) return 1;
  return Math.min(1, Math.max(0, wetness));
}

/** Tyre spray and handbrake smoke puffed from the rear wheels' contact points. */
export class SprayVfx implements GameSystem {
  readonly name = 'spray';
  private readonly positions = new Float32Array(PARTICLES * 3);
  private readonly ages = new Float32Array(PARTICLES);
  private readonly geometry = new T.BufferGeometry();
  private readonly puff = createPuffTexture();
  private readonly material = new T.PointsMaterial({
    color: '#bdc5da',
    size: 0.7,
    alphaMap: this.puff,
    transparent: true,
    opacity: BASE_OPACITY,
    depthWrite: false,
  });
  private readonly points = new T.Points(this.geometry, this.material);
  private next = 0;
  private scene?: T.Scene;

  init(context: SystemInitContext): void {
    this.geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3));
    this.points.frustumCulled = false;
    this.scene = context.scene;
    context.scene.add(this.points);
  }

  update(dt: number, frame: FrameContext): void {
    if (frame.paused) return;

    const { vehicle, weather } = frame;
    const amount = sprayAmount(frame.driving, vehicle.speed, vehicle.handbrake, weather.wetness);
    if (amount > 0) {
      for (const index of REAR_WHEELS) {
        const wheel = frame.wheels[index];
        if (!wheel.inContact) continue;
        const slot = this.next++ % PARTICLES;
        this.positions[slot * 3] = wheel.contactPoint.x;
        this.positions[slot * 3 + 1] = wheel.contactPoint.y + 0.1;
        this.positions[slot * 3 + 2] = wheel.contactPoint.z;
        this.ages[slot] = 1;
      }
    }
    // A merely damp road throws a lighter mist; drizzle and wetter keep the original opacity.
    if (amount > 0) this.material.opacity = BASE_OPACITY * Math.min(1, 0.45 + 0.8 * amount);

    const driftX = weather.windX * WIND_DRIFT * dt;
    const driftZ = weather.windZ * WIND_DRIFT * dt;
    for (let i = 0; i < PARTICLES; i++) {
      this.ages[i] -= dt;
      if (this.ages[i] > 0) {
        this.positions[i * 3] += driftX;
        this.positions[i * 3 + 1] += dt * RISE_SPEED;
        this.positions[i * 3 + 2] += driftZ;
      } else {
        this.positions[i * 3 + 1] = HIDDEN_Y;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.scene?.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    this.puff.dispose();
  }
}
