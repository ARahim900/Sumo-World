import * as T from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { marchGrowth } from './look';

const FULLSCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Cheap per-pixel noise (Jimenez 2014) used for dithering and ray jitter. */
const NOISE_GLSL = /* glsl */ `
  float interleavedGradientNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }
`;

function scaledSize(size: number, scale: number): number {
  return Math.max(1, Math.round(size * scale));
}

/**
 * Renders the scene. When `captureDepth` is set it renders into an owned target with a depth
 * texture (for ambient occlusion and reflections) and copies the colour into the chain;
 * otherwise it renders straight into the composer's read buffer like RenderPass.
 */
export class ScenePass extends Pass {
  readonly target: T.WebGLRenderTarget;
  private capture = false;
  private readonly copyMaterial: T.ShaderMaterial;
  private readonly copyQuad: FullScreenQuad;

  constructor(
    private readonly scene: T.Scene,
    private readonly camera: T.Camera,
  ) {
    super();
    this.needsSwap = false;
    const depthTexture = new T.DepthTexture(1, 1);
    depthTexture.type = T.UnsignedIntType;
    this.target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, depthTexture });
    this.target.texture.name = 'ScenePass.colour';
    this.copyMaterial = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.copyQuad = new FullScreenQuad(this.copyMaterial);
  }

  get captureDepth(): boolean {
    return this.capture;
  }

  set captureDepth(value: boolean) {
    this.capture = value;
    this.needsSwap = value;
  }

  get depthTexture(): T.DepthTexture {
    const texture = this.target.depthTexture;
    if (!texture) throw new Error('ScenePass target lost its depth texture.');
    return texture;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget): void {
    if (!this.capture) {
      renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
      renderer.render(this.scene, this.camera);
      return;
    }
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    this.copyMaterial.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copyQuad.render(renderer);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.copyMaterial.dispose();
    this.copyQuad.dispose();
  }
}

const AO_UPSAMPLE_FRAGMENT = /* glsl */ `
  #include <packing>
  uniform float intensity;
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 aoSize;
  uniform float cameraNear;
  uniform float cameraFar;
  varying vec2 vUv;

  float viewDepth(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
  }

  void main() {
    float centre = viewDepth(vUv);
    vec2 texel = vUv * aoSize - 0.5;
    vec2 base = floor(texel);
    vec2 f = texel - base;
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        vec2 corner = vec2(float(x), float(y));
        vec2 uv = (base + corner + 0.5) / aoSize;
        vec2 bilinear = mix(1.0 - f, f, corner);
        float relative = abs(viewDepth(uv) - centre) / max(centre, 1e-3);
        float weight = bilinear.x * bilinear.y / (0.01 + relative);
        sum += texture2D(tDiffuse, uv) * weight;
        total += weight;
      }
    }
    vec4 ao = total > 1e-5 ? sum / total : texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(mix(vec3(1.0), ao.rgb, intensity), ao.a);
  }
`;

/**
 * GTAO computed at a fraction of the render size. The stock blend upsamples bilinearly, which
 * bleeds occlusion across silhouettes (dark halos around the car against the sky); this blend
 * weights the four nearest AO texels by how close their full-resolution depth is to the pixel's.
 */
export class ScaledGTAOPass extends GTAOPass {
  private resolutionScale = 1;
  private fullWidth = 1;
  private fullHeight = 1;

  constructor(
    scene: T.Scene,
    private readonly viewCamera: T.PerspectiveCamera,
  ) {
    super(scene, viewCamera);
    const blend = this.blendMaterial;
    blend.uniforms.tDepth = { value: null };
    blend.uniforms.aoSize = { value: new T.Vector2(1, 1) };
    blend.uniforms.cameraNear = { value: viewCamera.near };
    blend.uniforms.cameraFar = { value: viewCamera.far };
    blend.fragmentShader = AO_UPSAMPLE_FRAGMENT;
    blend.needsUpdate = true;
  }

  render(
    renderer: T.WebGLRenderer,
    writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const uniforms = this.blendMaterial.uniforms;
    uniforms.tDepth.value = this.depthTexture;
    uniforms.aoSize.value.set(this.width, this.height);
    uniforms.cameraNear.value = this.viewCamera.near;
    uniforms.cameraFar.value = this.viewCamera.far;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  setResolutionScale(scale: number): void {
    if (scale === this.resolutionScale) return;
    this.resolutionScale = scale;
    this.setSize(this.fullWidth, this.fullHeight);
  }

  setSize(width: number, height: number): void {
    this.fullWidth = width;
    this.fullHeight = height;
    super.setSize(scaledSize(width, this.resolutionScale), scaledSize(height, this.resolutionScale));
  }
}

/** Bloom whose mip chain tracks the render size times a preset scale. */
export class ScaledBloomPass extends UnrealBloomPass {
  private resolutionScale = 1;
  private fullWidth = 1;
  private fullHeight = 1;

  setResolutionScale(scale: number): void {
    if (scale === this.resolutionScale) return;
    this.resolutionScale = scale;
    this.setSize(this.fullWidth, this.fullHeight);
  }

  setSize(width: number, height: number): void {
    this.fullWidth = width;
    this.fullHeight = height;
    super.setSize(scaledSize(width, this.resolutionScale), scaledSize(height, this.resolutionScale));
  }
}

const REFLECTION_FIRST_STEP = 0.2;
const REFLECTION_DISTANCE = 60;

const WET_REFLECTION_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform mat4 cameraProjection;
  uniform mat4 cameraProjectionInverse;
  uniform mat4 cameraWorld;
  uniform mat4 cameraView;
  uniform float cameraNear;
  uniform float strength;
  uniform float fogDensity;
  varying vec2 vUv;

  ${NOISE_GLSL}

  vec3 viewPositionAt(vec2 uv, float depth) {
    vec4 clip = vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
    vec4 view = cameraProjectionInverse * clip;
    return view.xyz / view.w;
  }

  vec2 projectToUv(vec3 viewPosition) {
    vec4 clip = cameraProjection * vec4(viewPosition, 1.0);
    return clip.xy / clip.w * 0.5 + 0.5;
  }

  float cellHash(vec2 cell) {
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 f = fract(point);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = cellHash(cell);
    float b = cellHash(cell + vec2(1.0, 0.0));
    float c = cellHash(cell + vec2(0.0, 1.0));
    float d = cellHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  bool insideScreen(vec2 uv) {
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
  }

  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    float depth = texture2D(tDepth, vUv).x;
    vec3 viewPosition = viewPositionAt(vUv, depth);
    // Derivatives must be taken before any non-uniform branch.
    vec3 viewNormal = normalize(cross(dFdx(viewPosition), dFdy(viewPosition)));
    gl_FragColor = base;
    if (depth >= 1.0) return;

    vec3 worldNormal = normalize(mat3(cameraWorld) * viewNormal);
    float floorMask = smoothstep(0.9, 0.98, worldNormal.y);
    if (floorMask <= 0.0) return;

    vec3 worldPosition = (cameraWorld * vec4(viewPosition, 1.0)).xyz;
    float puddle = smoothstep(0.45, 0.75, valueNoise(worldPosition.xz * 0.12));
    // The floor pixel is already fogged; the reflection must fade with it (FogExp2, view depth).
    float fogDepth = fogDensity * viewPosition.z;
    float wet = strength * floorMask * mix(0.45, 1.0, puddle) * exp(-fogDepth * fogDepth);
    if (wet <= 0.001) return;

    vec3 viewUp = normalize(mat3(cameraView) * vec3(0.0, 1.0, 0.0));
    vec3 incident = normalize(viewPosition);
    vec3 ray = reflect(incident, viewUp);
    float cosTheta = clamp(dot(-incident, viewUp), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);

    // Fixed per-pixel jitter: there is no temporal accumulation, so a per-frame offset would shimmer.
    float stepLength = FIRST_STEP * (0.75 + 0.5 * interleavedGradientNoise(gl_FragCoord.xy));
    float travelled = 0.0;
    float previous = 0.0;
    bool hit = false;

    for (int i = 0; i < STEPS; i++) {
      previous = travelled;
      travelled += stepLength;
      stepLength *= GROWTH;
      vec3 marchPoint = viewPosition + ray * travelled;
      if (marchPoint.z > -cameraNear) break;
      vec2 uv = projectToUv(marchPoint);
      if (!insideScreen(uv)) break;
      float sceneDepth = texture2D(tDepth, uv).x;
      if (sceneDepth >= 1.0) continue;
      float gap = viewPositionAt(uv, sceneDepth).z - marchPoint.z;
      if (gap > 0.0 && gap < 0.6 + travelled * 0.12) {
        hit = true;
        break;
      }
    }
    if (!hit) return;

    float low = previous;
    float high = travelled;
    for (int j = 0; j < 5; j++) {
      float middle = 0.5 * (low + high);
      vec3 probe = viewPosition + ray * middle;
      vec2 probeUv = projectToUv(probe);
      float probeDepth = texture2D(tDepth, probeUv).x;
      if (viewPositionAt(probeUv, probeDepth).z > probe.z) high = middle;
      else low = middle;
    }
    vec2 hitUv = projectToUv(viewPosition + ray * high);
    vec3 reflected = texture2D(tDiffuse, hitUv).rgb;

    vec2 edge = smoothstep(vec2(0.0), vec2(0.1), hitUv) * smoothstep(vec2(0.0), vec2(0.1), 1.0 - hitUv);
    float fade = edge.x * edge.y * (1.0 - smoothstep(MAX_DISTANCE * 0.6, MAX_DISTANCE, high));
    gl_FragColor.rgb = base.rgb + reflected * fresnel * wet * fade;
  }
`;

/**
 * Screen-space reflections restricted to upward-facing surfaces, which is all a flat city
 * floor needs. Strength follows wetness, and a world-space noise mask adds puddles.
 */
export class WetReflectionPass extends Pass {
  private readonly uniforms = {
    tDiffuse: { value: null as T.Texture | null },
    tDepth: { value: null as T.Texture | null },
    cameraProjection: { value: new T.Matrix4() },
    cameraProjectionInverse: { value: new T.Matrix4() },
    cameraWorld: { value: new T.Matrix4() },
    cameraView: { value: new T.Matrix4() },
    cameraNear: { value: 0.1 },
    strength: { value: 0 },
    fogDensity: { value: 0 },
  };
  private readonly material: T.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private steps = 0;

  constructor(
    private readonly camera: T.PerspectiveCamera,
    depthTexture: T.DepthTexture,
  ) {
    super();
    this.uniforms.tDepth.value = depthTexture;
    this.material = new T.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: WET_REFLECTION_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.setSteps(24);
  }

  set strength(value: number) {
    this.uniforms.strength.value = value;
  }

  /** FogExp2 density of the scene, so reflections fade with the fog over the floor. */
  set fogDensity(value: number) {
    this.uniforms.fogDensity.value = value;
  }

  /** Changes the march length; recompiles only when the count changes. */
  setSteps(steps: number): void {
    const count = Math.max(1, Math.round(steps));
    if (count === this.steps) return;
    this.steps = count;
    this.material.defines = {
      STEPS: count,
      FIRST_STEP: REFLECTION_FIRST_STEP.toFixed(4),
      GROWTH: marchGrowth(count, REFLECTION_FIRST_STEP, REFLECTION_DISTANCE).toFixed(6),
      MAX_DISTANCE: REFLECTION_DISTANCE.toFixed(1),
    };
    this.material.needsUpdate = true;
  }

  render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget): void {
    const uniforms = this.uniforms;
    uniforms.tDiffuse.value = readBuffer.texture;
    uniforms.cameraProjection.value.copy(this.camera.projectionMatrix);
    uniforms.cameraProjectionInverse.value.copy(this.camera.projectionMatrixInverse);
    uniforms.cameraWorld.value.copy(this.camera.matrixWorld);
    uniforms.cameraView.value.copy(this.camera.matrixWorldInverse);
    uniforms.cameraNear.value = this.camera.near;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

const GRADE_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float aspect;
  uniform float vignette;
  uniform float saturation;
  uniform float contrast;
  uniform vec3 shadowTint;
  uniform vec3 highlightTint;
  uniform float frame;
  varying vec2 vUv;

  ${NOISE_GLSL}

  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    vec3 colour = texel.rgb;
    float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    colour = mix(vec3(luma), colour, saturation);
    colour += shadowTint * (1.0 - smoothstep(0.0, 0.45, luma));
    colour += highlightTint * smoothstep(0.55, 1.0, luma);
    colour = (colour - 0.4) * contrast + 0.4;
    // Vertical distance is damped because the HUD's CSS scrim already darkens top and bottom.
    vec2 offset = (vUv - 0.5) * vec2(aspect, VIGNETTE_VERTICAL);
    colour *= 1.0 - vignette * smoothstep(0.4, 1.1, length(offset));
    // Half-LSB dither hides banding in the dark fog gradients.
    colour += (interleavedGradientNoise(gl_FragCoord.xy + frame) - 0.5) / 255.0;
    gl_FragColor = vec4(clamp(colour, 0.0, 1.0), texel.a);
  }
`;

/** Share of the vertical offset that counts towards the vignette. */
const VIGNETTE_VERTICAL = 0.5;

/** Display-referred colour grade, vignette and dither. Runs after OutputPass. */
export class GradePass extends Pass {
  private readonly uniforms = {
    tDiffuse: { value: null as T.Texture | null },
    aspect: { value: 16 / 9 },
    vignette: { value: 0.25 },
    saturation: { value: 1.08 },
    contrast: { value: 1.04 },
    shadowTint: { value: new T.Vector3(-0.004, 0.004, 0.016) },
    highlightTint: { value: new T.Vector3(0.014, 0.004, -0.006) },
    frame: { value: 0 },
  };
  private readonly material: T.ShaderMaterial;
  private readonly quad: FullScreenQuad;

  constructor() {
    super();
    this.material = new T.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GRADE_FRAGMENT,
      defines: { VIGNETTE_VERTICAL: VIGNETTE_VERTICAL.toFixed(2) },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width: number, height: number): void {
    this.uniforms.aspect.value = width / Math.max(1, height);
  }

  render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.frame.value = (this.uniforms.frame.value + 1) % 64;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}
