import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { DebugInfo, FrameContext, QualitySettings } from '../core/types';
import { pixelRatioFor } from './quality';

const SKY = '#080f1d';
const FOG = '#101d32';

/**
 * Owns the WebGL renderer, image-based environment, global lights and post-processing chain.
 * Scene content (city, car, effects) is added by other systems.
 */
export class SceneRenderer {
  readonly renderer: T.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly environment: T.WebGLRenderTarget;
  private readonly fog: T.FogExp2;
  private width = 0;
  private height = 0;

  constructor(
    host: HTMLElement,
    scene: T.Scene,
    private readonly camera: T.PerspectiveCamera,
    quality: QualitySettings,
  ) {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(SKY);
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    // The composer issues several draws per frame; counters are reset manually so
    // getDebugInfo reports the whole frame rather than the final output pass.
    this.renderer.info.autoReset = false;
    host.appendChild(this.renderer.domElement);

    this.fog = new T.FogExp2(FOG, 0.006);
    scene.fog = this.fog;
    scene.background = new T.Color(SKY);

    const pmrem = new T.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    scene.environmentIntensity = 0.6;

    scene.add(new T.HemisphereLight('#a2ceff', '#172037', 1.2));
    const moon = new T.DirectionalLight('#bad6ff', 2.4);
    moon.position.set(-30, 60, 20);
    scene.add(moon);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new T.Vector2(1280, 720), 0.35, 0.5, 1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.applyQuality(quality);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Applies a preset; `scale` is the adaptive-resolution multiplier (1 = full). */
  applyQuality(quality: QualitySettings, scale = 1): void {
    const ratio = pixelRatioFor(window.devicePixelRatio, quality, scale);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = quality.shadows;
    this.bloom.enabled = quality.bloom;
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

  update(frame: FrameContext): void {
    this.fog.density = frame.weather.fogDensity;
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
    this.environment.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
