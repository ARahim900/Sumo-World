import * as T from 'three';
import type { FrameContext } from '../core/types';
import { between, createRandom } from './random';
import { lensSpawnRate } from './rainMath';

const MAX_DROPS = 28;
const FADE_IN = 0.15;
const FADE_OUT = 1.2;
/** Drop radius range in normalised screen height units (1 = half the screen height). */
const RADIUS: readonly [number, number] = [0.012, 0.034];
const LIFE: readonly [number, number] = [2.5, 6];
/** Seconds a drop clings before it starts to run down the lens. */
const CLING: readonly [number, number] = [0.4, 2.5];
/** Run-down speed for the largest drops, screen height units per second. */
const RUN_SPEED = 0.09;
/** Above this camera speed, airflow pushes drops outward from the centre of view. */
const AIRFLOW_SPEED = 12;
const AIRFLOW_PUSH = 0.03;
const RENDER_ORDER = 1000;

const LENS_VERTEX = /* glsl */ `
  uniform float uAspect;

  attribute vec4 aDrop;

  varying vec2 vUv;
  varying float vAlpha;

  void main() {
    vUv = position.xy;
    vAlpha = aDrop.w;
    if (aDrop.w <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // Drawn straight in clip space: the quad ignores the camera and sits on the lens.
    vec2 offset = position.xy * aDrop.z * vec2(1.0 / uAspect, 1.15);
    gl_Position = vec4(aDrop.xy + offset, 0.0, 1.0);
  }
`;

const LENS_FRAGMENT = /* glsl */ `
  uniform float uFlash;

  varying vec2 vUv;
  varying float vAlpha;

  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float body = 1.0 - smoothstep(0.7, 1.0, d);
    float rim = smoothstep(0.62, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
    float highlight = 1.0 - smoothstep(0.0, 0.32, length(vUv - vec2(-0.32, 0.38)));
    float shadow = smoothstep(0.2, 0.9, dot(vUv, vec2(0.45, -0.75)));
    vec3 tint = mix(vec3(0.04, 0.07, 0.11), vec3(0.72, 0.84, 1.0), highlight + 0.35 * rim);
    float alpha = (0.08 * body + 0.28 * rim + 0.55 * highlight + 0.18 * shadow * body) * vAlpha;
    gl_FragColor = vec4(tint * (1.0 + 2.0 * uFlash), alpha);
  }
`;

interface Drop {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  age: number;
  life: number;
  cling: number;
  vx: number;
  vy: number;
}

type LensMesh = T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;

/**
 * Raindrops sitting on the camera lens: a handful of clip-space quads, so the cost is a
 * single tiny draw call. Off on the low preset and whenever no rain is falling.
 */
export class LensDrops {
  private readonly random = createRandom(0x1e25);
  private readonly data = new Float32Array(MAX_DROPS * 4);
  private readonly attribute = new T.InstancedBufferAttribute(this.data, 4).setUsage(T.DynamicDrawUsage);
  private readonly drops: Drop[] = [];
  private readonly material = new T.ShaderMaterial({
    vertexShader: LENS_VERTEX,
    fragmentShader: LENS_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uAspect: { value: 1 },
      uFlash: { value: 0 },
    },
  });
  private readonly mesh: LensMesh;
  private spawnDebt = 0;
  private scene?: T.Scene;

  constructor() {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('aDrop', this.attribute);
    geometry.instanceCount = MAX_DROPS;
    this.mesh = new T.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER;
    this.mesh.name = 'lens-drops';
    for (let i = 0; i < MAX_DROPS; i++) {
      this.drops.push({ active: false, x: 0, y: 0, radius: 0, age: 0, life: 0, cling: 0, vx: 0, vy: 0 });
    }
  }

  init(scene: T.Scene): void {
    this.scene = scene;
    scene.add(this.mesh);
  }

  /** `cameraSpeed` is the camera's own speed in m/s. */
  update(dt: number, frame: FrameContext, cameraSpeed: number): void {
    const enabled = frame.quality.preset !== 'low';
    const density = frame.weather.rainDensity;
    this.material.uniforms.uAspect.value = frame.camera.aspect;
    this.material.uniforms.uFlash.value = frame.weather.lightning;

    if (!enabled) {
      this.clear();
      return;
    }
    if (dt <= 0) return;

    this.spawnDebt += lensSpawnRate(density, cameraSpeed) * dt;
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      this.spawn();
    }

    let visible = false;
    for (let i = 0; i < MAX_DROPS; i++) {
      const drop = this.drops[i];
      if (drop.active) this.advance(drop, dt, cameraSpeed);
      const alpha = drop.active ? this.alphaOf(drop) : 0;
      this.data[i * 4] = drop.x;
      this.data[i * 4 + 1] = drop.y;
      this.data[i * 4 + 2] = drop.radius;
      this.data[i * 4 + 3] = alpha;
      visible ||= alpha > 0;
    }
    this.attribute.needsUpdate = true;
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.scene?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene = undefined;
  }

  private spawn(): void {
    const drop = this.drops.find(item => !item.active);
    if (!drop) return;
    const random = this.random;
    drop.active = true;
    drop.x = between(random, -0.95, 0.95);
    drop.y = between(random, -0.9, 0.95);
    drop.radius = between(random, RADIUS[0], RADIUS[1]);
    drop.age = 0;
    drop.life = between(random, LIFE[0], LIFE[1]);
    drop.cling = between(random, CLING[0], CLING[1]);
    drop.vx = 0;
    drop.vy = 0;
  }

  private advance(drop: Drop, dt: number, cameraSpeed: number): void {
    drop.age += dt;
    drop.vx = 0;
    drop.vy = 0;
    if (drop.age > drop.cling) {
      // Heavier drops run faster; a little sideways wander keeps the trails organic.
      const size = drop.radius / RADIUS[1];
      drop.vy = -RUN_SPEED * size * size;
      drop.vx = 0.01 * Math.sin(drop.age * 3 + drop.radius * 400);
    }
    if (cameraSpeed > AIRFLOW_SPEED) {
      const push = (cameraSpeed - AIRFLOW_SPEED) * AIRFLOW_PUSH;
      drop.vx += drop.x * push;
      drop.vy += Math.max(0, drop.y + 0.3) * push;
    }
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    if (drop.age >= drop.life || Math.abs(drop.x) > 1.1 || Math.abs(drop.y) > 1.1) drop.active = false;
  }

  private alphaOf(drop: Drop): number {
    const fadeIn = Math.min(1, drop.age / FADE_IN);
    const fadeOut = Math.min(1, Math.max(0, (drop.life - drop.age) / FADE_OUT));
    return fadeIn * fadeOut;
  }

  private clear(): void {
    if (!this.mesh.visible) return;
    for (const drop of this.drops) drop.active = false;
    this.data.fill(0);
    this.attribute.needsUpdate = true;
    this.mesh.visible = false;
    this.spawnDebt = 0;
  }
}
