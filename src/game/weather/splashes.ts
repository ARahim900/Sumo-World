import * as T from 'three';
import type { FrameContext } from '../core/types';
import { createRandom } from './random';
import {
  SPLASH_CLOCK_WRAP,
  SPLASH_PERIOD,
  SPLASH_PERIOD_EIGHTHS,
  activeCount,
  wrap,
} from './rainMath';

/** One splash slot per this many rain streaks in the quality budget. */
const STREAKS_PER_SPLASH = 4;
/** Half-width of the square splash area, metres. */
const RADIUS = 14;
/** The splash area is centred this far ahead of the camera. */
const LEAD = 7;
/** Rings fade out over this many metres towards the area's edges, where they wrap round. */
const EDGE_FADE = 2.5;
const SIZE = 0.17;
/**
 * Height of the splash rings: just above the road surface, light pools and lane paint.
 * Raised pavements and kerbs hide them, so splashes stay on the open road where water pools.
 */
const GROUND = 0.045;
const COLOUR = '#9cc8e6';
const OPACITY = 0.5;

const SPLASH_VERTEX = /* glsl */ `
  uniform vec3 uCentre;
  uniform float uRadius;
  uniform float uEdgeFade;
  uniform float uTime;
  uniform float uClockWrap;
  uniform float uPeriod;
  uniform float uSize;
  uniform float uGround;
  uniform float uFogDensity;

  attribute vec4 aSeed;

  varying vec2 vUv;
  varying float vAge;
  varying float vFade;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    // Every slot replays a short life on its own period and lands somewhere new each cycle.
    float eighths = ${SPLASH_PERIOD_EIGHTHS[0].toFixed(1)}
      + floor(aSeed.w * ${(SPLASH_PERIOD_EIGHTHS[1] - SPLASH_PERIOD_EIGHTHS[0] + 1).toFixed(1)});
    float period = uPeriod * eighths / 8.0;
    float cycle = uTime / period + aSeed.x;
    float age = fract(cycle);
    // The clock wraps after a whole number of this slot's cycles; wrapping the index with it
    // keeps the landing point unchanged across the wrap.
    float cyclesPerWrap = floor(uClockWrap / period + 0.5);
    float index = mod(floor(cycle), cyclesPerWrap);

    // The landing point is fixed in world space for the whole cycle. Like the rain streaks,
    // it is wrapped into an area that follows the camera, so the ring stays where the drop hit.
    vec2 areaSize = vec2(2.0 * uRadius);
    vec2 areaMin = uCentre.xz - uRadius;
    vec2 landing = vec2(
      hash12(vec2(index, aSeed.y * 913.0)),
      hash12(vec2(aSeed.y * 371.0, index + 17.0))
    ) * areaSize;
    vec2 local = mod(landing - areaMin, areaSize);
    vec3 centre = vec3(areaMin.x + local.x, uGround, areaMin.y + local.y);

    float size = uSize * (0.6 + 0.8 * aSeed.z) * (0.3 + 0.7 * age);
    vec3 world = centre + vec3(position.x * size, 0.0, position.y * size);
    gl_Position = projectionMatrix * (viewMatrix * vec4(world, 1.0));

    // A ring that drifts out of the area reappears on the far side; fading both edges hides the jump.
    vec2 edge = smoothstep(0.0, uEdgeFade, local) * smoothstep(0.0, uEdgeFade, areaSize - local);
    float distanceToCamera = distance(world, cameraPosition);
    float fogDepth = uFogDensity * distanceToCamera;

    vUv = position.xy;
    vAge = age;
    vFade = edge.x * edge.y
      * (1.0 - smoothstep(uRadius * 0.6, uRadius * 1.1, distanceToCamera))
      * exp(-fogDepth * fogDepth);
  }
`;

const SPLASH_FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uFlash;

  varying vec2 vUv;
  varying float vAge;
  varying float vFade;

  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float ring = smoothstep(0.6, 0.82, d) * (1.0 - smoothstep(0.86, 1.0, d));
    float crown = (1.0 - smoothstep(0.0, 0.3, d)) * (1.0 - smoothstep(0.0, 0.2, vAge));
    float alpha = (ring * (1.0 - vAge) + crown) * uOpacity * vFade;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(uColour * (1.0 + 2.5 * uFlash), alpha);
  }
`;

type SplashMesh = T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;

function createSplashGeometry(count: number): T.InstancedBufferGeometry {
  const random = createRandom(0x5a1a5 + count);
  const geometry = new T.InstancedBufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  geometry.setAttribute('aSeed', new T.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = 0;
  return geometry;
}

/** Expanding ripple rings where rain hits the road, animated entirely on the GPU. */
export class SplashField {
  private readonly material = new T.ShaderMaterial({
    vertexShader: SPLASH_VERTEX,
    fragmentShader: SPLASH_FRAGMENT,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCentre: { value: new T.Vector3() },
      uRadius: { value: RADIUS },
      uEdgeFade: { value: EDGE_FADE },
      uTime: { value: 0 },
      uClockWrap: { value: SPLASH_CLOCK_WRAP },
      uPeriod: { value: SPLASH_PERIOD },
      uSize: { value: SIZE },
      uGround: { value: GROUND },
      uFogDensity: { value: 0 },
      uColour: { value: new T.Color(COLOUR) },
      uOpacity: { value: OPACITY },
      uFlash: { value: 0 },
    },
  });
  private readonly mesh: SplashMesh = new T.Mesh(createSplashGeometry(0), this.material);
  private count = 0;
  private clock = 0;
  private scene?: T.Scene;

  init(scene: T.Scene, rainParticles: number): void {
    this.scene = scene;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'rain-splashes';
    this.resize(rainParticles);
    scene.add(this.mesh);
  }

  resize(rainParticles: number): void {
    this.mesh.geometry.dispose();
    this.count = Math.floor(rainParticles / STREAKS_PER_SPLASH);
    this.mesh.geometry = createSplashGeometry(this.count);
  }

  /** `forward` is the camera's horizontal unit view direction. */
  update(dt: number, frame: FrameContext, forward: T.Vector3): void {
    const weather = frame.weather;
    this.clock = wrap(this.clock + dt, SPLASH_CLOCK_WRAP);
    this.mesh.visible = weather.rainDensity > 0;
    this.mesh.geometry.instanceCount = activeCount(this.count, weather.rainDensity);

    const uniforms = this.material.uniforms;
    uniforms.uCentre.value.copy(frame.camera.position).addScaledVector(forward, LEAD);
    uniforms.uTime.value = this.clock;
    uniforms.uFogDensity.value = weather.fogDensity;
    uniforms.uOpacity.value = OPACITY * (0.55 + 0.45 * weather.puddles);
    uniforms.uFlash.value = weather.lightning;
  }

  dispose(): void {
    this.scene?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene = undefined;
  }
}
