import * as T from 'three';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';
import { LensDrops } from './lensDrops';
import { createRandom, type RandomSource } from './random';
import { MAX_CAMERA_SPEED, MAX_STREAK, SHUTTER, activeCount, fallSpeed, wrap } from './rainMath';
import { SplashField } from './splashes';

/** Half-width of the rain volume, metres. */
const SPREAD = 34;
const BOX_HEIGHT = 30;
/** The volume is centred this far above the camera, so few drops are wasted under the road. */
const LIFT = 9;
/** ...and this far ahead of it, so drops fill the view instead of the space behind the lens. */
const LEAD = 14;
/** Streak thickness in metres; the shader never draws it thinner than one pixel. */
const STREAK_WIDTH = 0.012;
const FADE_START = 22;
const FADE_END = 34;
const RAIN_COLOUR = '#8fbfe0';
const RAIN_OPACITY = 0.55;
/** Higher values let the streak stretch follow camera speed changes faster. */
const VELOCITY_SMOOTHING = 10;

const STREAK_VERTEX = /* glsl */ `
  uniform vec3 uCentre;
  uniform vec3 uBox;
  uniform vec3 uOffset;
  uniform vec3 uVelocity;
  uniform float uShutter;
  uniform float uMaxLength;
  uniform float uWidth;
  uniform vec2 uResolution;
  uniform vec2 uFade;

  attribute vec4 aSeed;

  varying float vAlpha;
  varying float vAlong;
  varying float vSide;

  void main() {
    // Each drop is fixed in world space; the volume only decides which wrapped copy is drawn.
    vec3 boxMin = uCentre - 0.5 * uBox;
    vec3 head = boxMin + mod(aSeed.xyz * uBox + uOffset - boxMin, uBox);

    float speed = length(uVelocity);
    vec3 direction = speed > 0.001 ? uVelocity / speed : vec3(0.0, -1.0, 0.0);
    float streak = min(uMaxLength, speed * uShutter) * (0.7 + 0.6 * aSeed.w);
    vec3 tail = head - direction * streak;

    mat4 viewProjection = projectionMatrix * viewMatrix;
    vec4 clipHead = viewProjection * vec4(head, 1.0);
    vec4 clipTail = viewProjection * vec4(tail, 1.0);
    if (clipHead.w < 0.2 || clipTail.w < 0.2) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vAlpha = 0.0;
      return;
    }

    // Expand the ribbon sideways in screen space so it stays at least one pixel wide.
    vec2 screenHead = clipHead.xy / clipHead.w * uResolution;
    vec2 screenTail = clipTail.xy / clipTail.w * uResolution;
    vec2 axis = screenHead - screenTail;
    float axisLength = length(axis);
    axis = axisLength > 0.0001 ? axis / axisLength : vec2(0.0, 1.0);
    vec2 normal = vec2(-axis.y, axis.x);

    vec4 clip = mix(clipTail, clipHead, position.y);
    float pixelWidth = uWidth * projectionMatrix[1][1] * uResolution.y * 0.5 / clip.w;
    clip.xy += normal * position.x * max(pixelWidth, 1.0) / uResolution * clip.w;
    gl_Position = clip;

    float distanceToCamera = distance(head, cameraPosition);
    float coverage = clamp(pixelWidth, 0.35, 1.0);
    float farFade = 1.0 - smoothstep(uFade.x, uFade.y, distanceToCamera);
    float nearFade = smoothstep(0.3, 1.5, distanceToCamera);
    vAlpha = coverage * farFade * nearFade * (0.6 + 0.6 * aSeed.w);
    vAlong = position.y;
    vSide = position.x;
  }
`;

const STREAK_FRAGMENT = /* glsl */ `
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uFlash;

  varying float vAlpha;
  varying float vAlong;
  varying float vSide;

  void main() {
    float alpha = uOpacity * vAlpha * mix(0.25, 1.0, vAlong) * (1.0 - 0.5 * abs(vSide));
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColour * (1.0 + 3.0 * uFlash), alpha);
  }
`;

type StreakMesh = T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;

function createStreakGeometry(count: number, random: RandomSource): T.InstancedBufferGeometry {
  const geometry = new T.InstancedBufferGeometry();
  // x is the side of the ribbon (-1 or 1); y runs from the tail (0) to the head (1).
  geometry.setAttribute('position', new T.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  geometry.setAttribute('aSeed', new T.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = 0;
  return geometry;
}

/**
 * GPU rain. Streaks are instanced ribbons animated entirely in the vertex shader: the CPU
 * only advances a few uniforms per frame. Streaks slant with the wind and stretch with the
 * camera's own speed. The system also owns the ground splashes and the lens drops.
 */
export class RainSystem implements GameSystem {
  readonly name = 'rain';
  private readonly random = createRandom(0x7a11);
  private readonly material = new T.ShaderMaterial({
    vertexShader: STREAK_VERTEX,
    fragmentShader: STREAK_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    uniforms: {
      uCentre: { value: new T.Vector3() },
      uBox: { value: new T.Vector3(SPREAD * 2, BOX_HEIGHT, SPREAD * 2) },
      uOffset: { value: new T.Vector3() },
      uVelocity: { value: new T.Vector3(0, -19, 0) },
      uShutter: { value: SHUTTER },
      uMaxLength: { value: MAX_STREAK },
      uWidth: { value: STREAK_WIDTH },
      uResolution: { value: new T.Vector2(1, 1) },
      uFade: { value: new T.Vector2(FADE_START, FADE_END) },
      uColour: { value: new T.Color(RAIN_COLOUR) },
      uOpacity: { value: RAIN_OPACITY },
      uFlash: { value: 0 },
    },
  });
  private readonly mesh: StreakMesh = new T.Mesh(createStreakGeometry(0, this.random), this.material);
  private readonly splashes = new SplashField();
  private readonly lens = new LensDrops();
  private count = 0;
  private scene?: T.Scene;
  private renderer?: T.WebGLRenderer;
  private driftX = 0;
  private driftZ = 0;
  private fallen = 0;
  private hasLastCamera = false;
  private readonly lastCamera = new T.Vector3();
  private readonly rawVelocity = new T.Vector3();
  private readonly cameraVelocity = new T.Vector3();
  private readonly forward = new T.Vector3();

  init(context: SystemInitContext): void {
    this.scene = context.scene;
    this.renderer = context.renderer;
    this.allocate(context.quality.rainParticles);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'rain-streaks';
    context.scene.add(this.mesh);
    this.splashes.init(context.scene, context.quality.rainParticles);
    this.lens.init(context.scene);
  }

  update(dt: number, frame: FrameContext): void {
    if (frame.quality.rainParticles !== this.count) {
      this.allocate(frame.quality.rainParticles);
      this.splashes.resize(frame.quality.rainParticles);
    }

    const weather = frame.weather;
    const density = weather.rainDensity;
    const camera = frame.camera;
    this.trackCamera(dt, camera.position);

    const fall = fallSpeed(Math.hypot(weather.windX, weather.windZ));
    if (dt > 0) {
      this.driftX = wrap(this.driftX + weather.windX * dt, SPREAD * 2);
      this.driftZ = wrap(this.driftZ + weather.windZ * dt, SPREAD * 2);
      this.fallen = wrap(this.fallen + fall * dt, BOX_HEIGHT);
    }

    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();

    this.mesh.visible = density > 0;
    this.mesh.geometry.instanceCount = activeCount(this.count, density);

    const uniforms = this.material.uniforms;
    uniforms.uCentre.value.copy(camera.position).addScaledVector(this.forward, LEAD).setY(camera.position.y + LIFT);
    uniforms.uOffset.value.set(this.driftX, -this.fallen, this.driftZ);
    uniforms.uVelocity.value.set(weather.windX, -fall, weather.windZ).sub(this.cameraVelocity);
    uniforms.uFlash.value = weather.lightning;
    if (this.renderer) this.renderer.getDrawingBufferSize(uniforms.uResolution.value);

    this.splashes.update(dt, frame, this.forward);
    this.lens.update(dt, frame, this.cameraVelocity.length());
  }

  dispose(): void {
    this.scene?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.splashes.dispose();
    this.lens.dispose();
    this.scene = undefined;
  }

  /** Smoothed camera velocity, used to stretch streaks into motion blur. */
  private trackCamera(dt: number, position: T.Vector3): void {
    if (dt <= 0) return;
    if (this.hasLastCamera) {
      this.rawVelocity.subVectors(position, this.lastCamera).divideScalar(dt);
      if (this.rawVelocity.length() > MAX_CAMERA_SPEED) this.rawVelocity.set(0, 0, 0);
      this.cameraVelocity.lerp(this.rawVelocity, 1 - Math.exp(-dt * VELOCITY_SMOOTHING));
    }
    this.lastCamera.copy(position);
    this.hasLastCamera = true;
  }

  private allocate(count: number): void {
    // A resized instanced attribute needs a fresh geometry so three rebuilds its GPU buffers.
    this.mesh.geometry.dispose();
    this.mesh.geometry = createStreakGeometry(count, this.random);
    this.count = count;
  }
}
