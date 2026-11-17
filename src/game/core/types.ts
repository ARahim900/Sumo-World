/**
 * FROZEN shared contracts for Sumo World.
 *
 * Every team builds against these types. Changing a field name, type or meaning here is a
 * cross-team change and must go through the core (integration) owner. Adding an optional
 * field is allowed only with core approval; never remove or repurpose a field.
 *
 * Units: metres, seconds, radians, metres per second unless stated otherwise.
 * Axes: +Y is up, the car's local forward axis is +Z.
 */
import type {
  Group,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Mission } from '../content';

/* ------------------------------------------------------------------ Weather */

export type WeatherKind = 'clear' | 'drizzle' | 'storm' | 'fog';

/** A fixed weather kind, or 'auto' to let the weather system choose and transition. */
export type WeatherSetting = WeatherKind | 'auto';

/** Published by the weather system every frame; read by physics, render, VFX and audio. */
export interface WeatherState {
  kind: WeatherKind;
  /** 0..1 share of the quality preset's `rainParticles` budget that should be falling. */
  rainDensity: number;
  /** 0..1 how wet road and surfaces look (0 dry, 1 soaked). */
  wetness: number;
  /** 0..1 how much standing water collects in puddles. */
  puddles: number;
  /** Exponential fog density applied to the scene (THREE.FogExp2 density). */
  fogDensity: number;
  /** Wind velocity along world X, m/s. Rain and smoke drift with it. */
  windX: number;
  /** Wind velocity along world Z, m/s. */
  windZ: number;
  /** Tyre grip multiplier fed to physics. 1 is dry tarmac; lower is more slippery. */
  gripFactor: number;
  /** 0..1 current lightning flash intensity (0 when no flash is active). */
  lightning: number;
}

/* ------------------------------------------------------------------ Quality */

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export type AntiAliasing = 'none' | 'smaa' | 'fxaa';

/** Resolved render settings for a preset. Owned by render/quality.ts. */
export interface QualitySettings {
  preset: QualityPreset;
  /** Upper bound for renderer pixel ratio (devicePixelRatio is clamped to this). */
  pixelRatioCap: number;
  /** Whether any light may cast real-time shadows. */
  shadows: boolean;
  /** Shadow map edge length in texels. */
  shadowMapSize: number;
  bloom: boolean;
  /** Screen-space ambient occlusion pass. */
  ssao: boolean;
  /** Screen-space reflections pass (wet roads). */
  ssr: boolean;
  aa: AntiAliasing;
  /** Maximum rain streaks simulated at rainDensity 1. */
  rainParticles: number;
  /** Camera far plane and culling distance in metres. */
  drawDistance: number;
}

/* ------------------------------------------------------------------ Vehicle */

/** Four values in wheel order: front-left, front-right, rear-left, rear-right. */
export type WheelQuad = [number, number, number, number];

/** Driving telemetry, refreshed after every physics step. */
export interface VehicleTelemetry {
  /** Horizontal speed, m/s, always >= 0. */
  speed: number;
  /** Speed along the car's forward axis, m/s; negative when reversing. */
  signedSpeed: number;
  /** Engine speed in revolutions per minute. */
  rpm: number;
  /** -1 reverse, 0 neutral, 1..n forward gears. */
  gear: number;
  /** 0..1 applied throttle (0 when not driving). */
  throttle: number;
  /** 0..1 applied service brake (0 when not driving). */
  brake: number;
  /** True while the handbrake is held and the player is driving. */
  handbrake: boolean;
  /** Per-wheel slip, 0 means full grip; magnitude grows as the tyre slides. */
  slip: WheelQuad;
}

/** Per-wheel state needed by visuals and effects. Index order matches WheelQuad. */
export interface WheelState {
  /** Wheel hub anchor in the car's local space at full suspension extension. */
  anchor: Vector3;
  /** Current suspension length, metres. */
  suspensionLength: number;
  /** Accumulated spin angle around the axle, radians. */
  rotation: number;
  /** Steering angle, radians (front wheels only; rear is 0). */
  steering: number;
  inContact: boolean;
  /** World-space contact point; only meaningful while inContact is true. */
  contactPoint: Vector3;
}

/** A world-space transform. */
export interface Pose {
  position: Vector3;
  quaternion: Quaternion;
}

/** State handed to the car visual each rendered frame. */
export interface CarVisualState {
  /** Interpolated chassis pose for this frame. */
  pose: Pose;
  wheels: readonly WheelState[];
  telemetry: VehicleTelemetry;
  /** Simulation seconds since the previous update; 0 while paused. */
  dt: number;
  /** Accessibility: suppress body lean and other cosmetic motion. */
  lowMotion: boolean;
}

/** Contract between the runtime and the vehicle team's car model. */
export interface CarVisual {
  group: Group;
  /** Wheel pivot groups in WheelQuad order. */
  wheels: Object3D[];
  setLights(on: boolean): void;
  update(state: CarVisualState): void;
}

/* ------------------------------------------------------------------ Systems */

/** Shared objects a system may use while initialising. */
export interface SystemInitContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  quality: QualitySettings;
  weather: WeatherState;
}

/**
 * Everything a system may read in one rendered frame.
 *
 * The runtime reuses this object and every vector inside it between frames: read it, never
 * mutate it, and copy any value you need to keep beyond the current update call.
 */
export interface FrameContext {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Simulation clock in seconds; advances only while running. */
  readonly time: number;
  /** True while the game is paused. update() still runs, with dt = 0. */
  readonly paused: boolean;
  /** Interpolated car chassis pose. */
  readonly car: Readonly<Pose>;
  /** Interpolated on-foot player pose (stale while driving). */
  readonly player: Readonly<Pose>;
  /** On-foot facing angle around +Y, radians. */
  readonly playerYaw: number;
  /** True while the on-foot player is being asked to move. */
  readonly playerMoving: boolean;
  /** Point the action is centred on: the car while driving, otherwise the player. */
  readonly focus: Vector3;
  readonly driving: boolean;
  readonly firstPerson: boolean;
  readonly mission: Mission;
  /** Driving telemetry; speed, rpm and gear live here. */
  readonly vehicle: Readonly<VehicleTelemetry>;
  readonly wheels: readonly WheelState[];
  readonly weather: Readonly<WeatherState>;
  readonly quality: Readonly<QualitySettings>;
  /** Accessibility: reduce camera sway, FOV kick and other motion. */
  readonly lowMotion: boolean;
}

/**
 * A pluggable part of the game (rain, crowd, audio, ...). The runtime calls init once in
 * registration order, update once per rendered frame after physics, and dispose on teardown.
 * dispose must remove the system's objects from the scene and free what it allocated.
 */
export interface GameSystem {
  readonly name: string;
  init(context: SystemInitContext): void | Promise<void>;
  update(dt: number, frame: FrameContext): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ UI */

/** Renderer counters and frame rate for debug overlays. */
export interface DebugInfo {
  fps: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  programs: number;
  /** Renderer pixel ratio in use, after the preset cap and adaptive scale. */
  pixelRatio: number;
  /** Adaptive-resolution multiplier, 1 when rendering at the preset's full resolution. */
  resolutionScale: number;
}

/** State the React HUD renders. Published roughly ten times a second. */
export interface Snapshot {
  ready: boolean;
  paused: boolean;
  driving: boolean;
  mission: Mission;
  /** km/h. */
  speed: number;
  /** Metres from the player or car to the mission destination. */
  distance: number;
  /** Seconds held inside the destination ring. */
  hold: number;
  prompt: string;
  notice: string;
  x: number;
  z: number;
  yaw: number;
  /** True while rain is falling (derived from the weather state). */
  rain: boolean;
  sound: boolean;
  firstPerson: boolean;
  fps: number;
  quality: QualityPreset;
  /** True while render resolution scales down automatically when frames run over budget. */
  adaptiveResolution: boolean;
  weather: WeatherKind;
  weatherSetting: WeatherSetting;
  lowMotion: boolean;
  rpm: number;
  gear: number;
}

/** Public runtime API used by the UI. */
export interface RuntimeApi {
  start(): void;
  pause(): void;
  restart(): void;
  recover(): void;
  setQuality(preset: QualityPreset): void;
  setAdaptiveResolution(enabled: boolean): void;
  setWeather(setting: WeatherSetting): void;
  /** Legacy menu toggle: switches between clear and drizzle. */
  toggleRain(): void;
  toggleSound(): void;
  toggleMotion(): void;
  getDebugInfo(): DebugInfo;
}
