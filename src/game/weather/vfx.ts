import * as T from 'three';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';

const PARTICLES = 90;
const REAR_WHEELS = [2, 3] as const;
const MIN_SPEED = 5;
const RISE_SPEED = 0.4;
const HIDDEN_Y = -20;

/** Tyre spray and handbrake smoke puffed from the rear wheels' contact points. */
export class SprayVfx implements GameSystem {
  readonly name = 'spray';
  private readonly positions = new Float32Array(PARTICLES * 3);
  private readonly ages = new Float32Array(PARTICLES);
  private readonly geometry = new T.BufferGeometry();
  private readonly material = new T.PointsMaterial({
    color: '#bdc5da',
    size: 0.4,
    transparent: true,
    opacity: 0.2,
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

    const emitting =
      frame.driving &&
      frame.vehicle.speed > MIN_SPEED &&
      (frame.vehicle.handbrake || frame.weather.wetness > 0);
    if (emitting) {
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

    for (let i = 0; i < PARTICLES; i++) {
      this.ages[i] -= dt;
      if (this.ages[i] > 0) this.positions[i * 3 + 1] += dt * RISE_SPEED;
      else this.positions[i * 3 + 1] = HIDDEN_Y;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.scene?.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
