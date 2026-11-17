import * as T from 'three';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';

/** Half-width of the rain volume that travels with the camera focus. */
const SPREAD = 35;
const HEIGHT = 35;
const FALL_SPEED = 19;
const STREAK_X = 0.12;
const STREAK_Y = 0.65;

/** Rain drawn as short line streaks in a box that follows the player or car. */
export class RainSystem implements GameSystem {
  readonly name = 'rain';
  private readonly geometry = new T.BufferGeometry();
  private readonly material = new T.LineBasicMaterial({
    color: '#83b7da',
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  private readonly mesh = new T.LineSegments(this.geometry, this.material);
  private positions = new Float32Array(0);
  private count = 0;
  private scene?: T.Scene;

  init(context: SystemInitContext): void {
    this.allocate(context.quality.rainParticles);
    this.mesh.frustumCulled = false;
    this.scene = context.scene;
    context.scene.add(this.mesh);
  }

  update(dt: number, frame: FrameContext): void {
    if (frame.quality.rainParticles !== this.count) this.allocate(frame.quality.rainParticles);

    const density = frame.weather.rainDensity;
    this.mesh.visible = density > 0;
    this.geometry.setDrawRange(0, Math.floor(this.count * Math.min(1, density)) * 2);
    if (frame.paused) return;

    this.mesh.position.set(frame.focus.x, 0, frame.focus.z);
    if (density > 0) this.fall(dt);
    this.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.scene?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  private fall(dt: number): void {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 6) {
      p[i + 1] -= dt * FALL_SPEED;
      if (p[i + 1] < 0) p[i + 1] = HEIGHT;
      p[i + 3] = p[i] + STREAK_X;
      p[i + 4] = p[i + 1] + STREAK_Y;
      p[i + 5] = p[i + 2];
    }
  }

  private allocate(count: number): void {
    // Releasing the old GPU buffer lets three rebuild bindings for the resized attribute.
    if (this.count > 0) this.geometry.dispose();
    this.count = count;
    this.positions = new Float32Array(count * 6);
    const p = this.positions;
    for (let i = 0; i < p.length; i += 6) {
      p[i] = Math.random() * SPREAD * 2 - SPREAD;
      p[i + 1] = Math.random() * HEIGHT;
      p[i + 2] = Math.random() * SPREAD * 2 - SPREAD;
      p[i + 3] = p[i] + STREAK_X;
      p[i + 4] = p[i + 1] + STREAK_Y;
      p[i + 5] = p[i + 2];
    }
    this.geometry.setAttribute('position', new T.BufferAttribute(p, 3));
  }
}
