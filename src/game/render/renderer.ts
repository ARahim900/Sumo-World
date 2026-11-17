import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { DebugInfo, FrameContext, QualitySettings } from '../core/types';
import { createNightEnvironment } from './environment';
import { MoonLight } from './lighting';
import {
  BASE_EXPOSURE,
  MIN_REFLECTION_STRENGTH,
  environmentIntensityFor,
  exposureFor,
  hemisphereIntensityFor,
  reflectionStrengthFor,
} from './look';
import { GradePass, ScaledBloomPass, ScaledGTAOPass, ScenePass, WetReflectionPass } from './passes';
import { pixelRatioFor, renderTuning } from './quality';

const SKY = '#080f1d';
const FOG = '#101d32';

const BLOOM_STRENGTH = 0.35;
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 1;

const AO_PARAMETERS = {
  radius: 0.8,
  distanceExponent: 1,
  thickness: 1.5,
  distanceFallOff: 1,
  scale: 1.1,
} as const;
const AO_BLEND = 0.85;

/**
 * Owns the WebGL renderer, the procedural environment, the global lights and the
 * post-processing chain:
 *
 * scene -> GTAO -> wet reflections -> bloom -> output (tone map) -> grade -> SMAA / FXAA
 *
 * Passes are switched per preset. Scene content (city, car, effects) is added by other systems.
 */
export class SceneRenderer {
  readonly renderer: T.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scenePass: ScenePass;
  private readonly ambientOcclusion: ScaledGTAOPass;
  private readonly reflections: WetReflectionPass;
  private readonly bloom: ScaledBloomPass;
  private readonly smaa: SMAAPass;
  private readonly fxaa: FXAAPass;
  private readonly environment: T.WebGLRenderTarget;
  private readonly fog: T.FogExp2;
  private readonly hemisphere: T.HemisphereLight;
  private readonly moon: MoonLight;
  private quality: QualitySettings;
  private pixelRatio = 1;
  private width = 0;
  private height = 0;

  constructor(
    host: HTMLElement,
    private readonly scene: T.Scene,
    private readonly camera: T.PerspectiveCamera,
    quality: QualitySettings,
  ) {
    this.quality = quality;
    // The composer always draws the final pass as a full-screen quad, so canvas MSAA would
    // be wasted; edges are handled by SMAA or FXAA instead.
    this.renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(SKY);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = BASE_EXPOSURE;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    // The composer issues several draws per frame; counters are reset manually so
    // getDebugInfo reports the whole frame rather than the final output pass.
    this.renderer.info.autoReset = false;
    host.appendChild(this.renderer.domElement);

    this.fog = new T.FogExp2(FOG, 0.006);
    scene.fog = this.fog;
    scene.background = new T.Color(SKY);

    this.environment = createNightEnvironment(this.renderer);
    scene.environment = this.environment.texture;

    this.hemisphere = new T.HemisphereLight('#a2ceff', '#172037', 1.2);
    scene.add(this.hemisphere);
    this.moon = new MoonLight(scene);

    this.composer = new EffectComposer(this.renderer);
    this.scenePass = new ScenePass(scene, camera);
    this.ambientOcclusion = new ScaledGTAOPass(scene, camera);
    this.ambientOcclusion.setGBuffer(this.scenePass.depthTexture);
    this.ambientOcclusion.updateGtaoMaterial(AO_PARAMETERS);
    this.ambientOcclusion.blendIntensity = AO_BLEND;
    this.reflections = new WetReflectionPass(camera, this.scenePass.depthTexture);
    this.bloom = new ScaledBloomPass(new T.Vector2(1280, 720), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.smaa = new SMAAPass();
    this.fxaa = new FXAAPass();

    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.ambientOcclusion);
    this.composer.addPass(this.reflections);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new GradePass());
    this.composer.addPass(this.smaa);
    this.composer.addPass(this.fxaa);

    this.applyQuality(quality);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Pixel ratio currently in use, after the preset cap and adaptive scale. */
  get currentPixelRatio(): number {
    return this.pixelRatio;
  }

  /** Applies a preset; `scale` is the adaptive-resolution multiplier (1 = full). */
  applyQuality(quality: QualitySettings, scale = 1): void {
    this.quality = quality;
    const tuning = renderTuning(quality.preset);
    this.pixelRatio = pixelRatioFor(window.devicePixelRatio, quality, scale);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.composer.setPixelRatio(this.pixelRatio);

    this.renderer.shadowMap.enabled = quality.shadows;
    this.moon.configure(quality.shadows, quality.shadowMapSize, tuning.shadowExtent);

    this.scenePass.captureDepth = quality.ssao || quality.ssr;
    this.ambientOcclusion.enabled = quality.ssao;
    this.ambientOcclusion.setResolutionScale(tuning.aoScale);
    this.ambientOcclusion.updateGtaoMaterial({ samples: tuning.aoSamples });
    this.reflections.enabled = quality.ssr;
    if (quality.ssr) this.reflections.setSteps(tuning.reflectionSteps);
    this.bloom.enabled = quality.bloom;
    this.bloom.setResolutionScale(tuning.bloomScale);
    this.smaa.enabled = quality.aa === 'smaa';
    this.fxaa.enabled = quality.aa === 'fxaa';

    this.camera.far = quality.drawDistance;
    this.camera.updateProjectionMatrix();
    if (this.width > 0 && this.height > 0) this.setSize(this.width, this.height);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  /** Follows weather and the focus point; camera-dependent work happens inside the passes. */
  update(frame: FrameContext): void {
    const weather = frame.weather;
    this.fog.density = weather.fogDensity;
    this.renderer.toneMappingExposure = exposureFor(weather);
    this.scene.environmentIntensity = environmentIntensityFor(weather);
    this.hemisphere.intensity = hemisphereIntensityFor(weather);

    const strength = reflectionStrengthFor(weather);
    this.reflections.strength = strength;
    this.reflections.fogDensity = weather.fogDensity;
    this.reflections.enabled = this.quality.ssr && strength > MIN_REFLECTION_STRENGTH;

    this.moon.follow(frame.focus);
  }

  render(): void {
    this.renderer.info.reset();
    this.composer.render();
  }

  debugInfo(fps: number): DebugInfo {
    const { render, memory, programs } = this.renderer.info;
    return {
      fps,
      drawCalls: render.calls,
      triangles: render.triangles,
      points: render.points,
      lines: render.lines,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: programs?.length ?? 0,
    };
  }

  dispose(): void {
    this.moon.dispose();
    this.scene.remove(this.hemisphere);
    this.hemisphere.dispose();
    this.environment.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
