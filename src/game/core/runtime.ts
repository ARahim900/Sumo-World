import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EngineAudio } from '../audio/engineAudio';
import { DESTINATION, STEP, neutral } from '../content';
import { Input } from '../input';
import { Simulation } from '../physics';
import { AdaptiveResolution, DEFAULT_QUALITY, qualitySettings } from '../render/quality';
import { SceneRenderer } from '../render/renderer';
import { createCar, type SumoCar } from '../vehicle/carModel';
import { IDLE_RPM } from '../vehicle/drivetrain';
import { RainSystem } from '../weather/rain';
import { ThunderAudio } from '../weather/thunder';
import { SprayVfx } from '../weather/vfx';
import { WeatherSystem, toggledRainKind } from '../weather/weather';
import { CitySystem } from '../world/city';
import { PeopleSystem } from '../world/people';
import { CameraRig, type CameraObstruction } from './camera';
import { disposeTree } from './dispose';
import type {
  CarVisualState,
  DebugInfo,
  FrameContext,
  GameSystem,
  QualityPreset,
  QualitySettings,
  RuntimeApi,
  Snapshot,
  SystemInitContext,
  VehicleTelemetry,
  WeatherSetting,
  WheelState,
} from './types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const MAX_FRAME = 0.08;
const HUD_INTERVAL = 0.1;
const SETTLE_STEPS = 90;

function createWheelState(): WheelState {
  return {
    anchor: new T.Vector3(),
    suspensionLength: 0.32,
    rotation: 0,
    steering: 0,
    inContact: false,
    contactPoint: new T.Vector3(),
  };
}

/**
 * Thin orchestrator: owns the fixed-step loop and interpolation, registers game systems,
 * builds the per-frame context and publishes HUD snapshots. Feature logic lives in systems.
 */
export class Runtime implements RuntimeApi {
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(60, 1, 0.1, 550);
  private readonly view: SceneRenderer;
  private readonly input: Input;
  private readonly rig: CameraRig;
  private readonly car: SumoCar = createCar({ preset: DEFAULT_QUALITY });
  private readonly weather = new WeatherSystem();
  private readonly audio = new EngineAudio();
  private readonly thunder = new ThunderAudio(() => this.audio.context);
  // Off until the UI offers a toggle: on refresh-capped displays each trial briefly drops to
  // the resolution floor even though the GPU is idle.
  private readonly adaptive = new AdaptiveResolution({ enabled: false });
  private readonly systems: GameSystem[];
  private readonly resizeObserver: ResizeObserver;
  private quality: QualitySettings = qualitySettings(DEFAULT_QUALITY);
  private sim!: Simulation;

  private ready = false;
  private paused = true;
  private disposed = false;
  private released = false;
  private firstPerson = false;
  private lowMotion = false;
  private queuedJump = false;
  private frameHandle = 0;
  private last = 0;
  private accumulator = 0;
  private hudTime = 0;
  private fps = 0;
  private resolutionScale = 1;

  private readonly previousCar = new T.Vector3();
  private readonly previousPlayer = new T.Vector3();
  private readonly previousRotation = new T.Quaternion();
  private readonly bodyRotation = new T.Quaternion();
  private readonly heading = new T.Euler();
  private readonly rayOrigin = new T.Vector3();
  private readonly rayDirection = new T.Vector3();
  private readonly ray = new RAPIER.Ray(this.rayOrigin, this.rayDirection);

  private readonly telemetry: VehicleTelemetry = {
    speed: 0,
    signedSpeed: 0,
    rpm: IDLE_RPM,
    gear: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    slip: [0, 0, 0, 0],
  };
  private readonly wheels: WheelState[] = [
    createWheelState(),
    createWheelState(),
    createWheelState(),
    createWheelState(),
  ];
  private readonly frame: Mutable<FrameContext>;
  private readonly carState: Mutable<CarVisualState>;

  constructor(
    private readonly host: HTMLElement,
    private readonly publish: (snapshot: Snapshot) => void,
    private readonly fail: (message: string) => void,
  ) {
    this.view = new SceneRenderer(host, this.scene, this.camera, this.quality);
    this.scene.add(this.car.group);
    this.rig = new CameraRig(this.camera);
    this.systems = [
      this.weather,
      new RainSystem(),
      new SprayVfx(),
      new CitySystem(),
      new PeopleSystem(),
      this.audio,
    ];

    this.frame = {
      scene: this.scene,
      camera: this.camera,
      time: 0,
      paused: true,
      car: { position: new T.Vector3(), quaternion: new T.Quaternion() },
      player: { position: new T.Vector3(), quaternion: new T.Quaternion() },
      playerYaw: Math.PI,
      playerMoving: false,
      focus: new T.Vector3(),
      driving: false,
      firstPerson: false,
      mission: 'enter',
      vehicle: this.telemetry,
      wheels: this.wheels,
      weather: this.weather.state,
      quality: this.quality,
      lowMotion: false,
    };
    this.carState = {
      pose: this.frame.car,
      wheels: this.wheels,
      telemetry: this.telemetry,
      dt: 0,
      lowMotion: false,
    };
    this.weather.onThunder = event => this.thunder.play(event);

    this.input = new Input(this.view.domElement, () => this.pause());
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.view.domElement.addEventListener('webglcontextlost', this.contextLost);
  }

  async initialise(): Promise<void> {
    try {
      this.sim = await Simulation.create();
      if (this.disposed) {
        this.release();
        return;
      }
      const context: SystemInitContext = {
        scene: this.scene,
        camera: this.camera,
        renderer: this.view.renderer,
        quality: this.quality,
        weather: this.weather.state,
      };
      for (const system of this.systems) {
        await system.init(context);
        if (this.disposed) {
          this.release();
          return;
        }
      }
      this.sim.setGripFactor(this.weather.state.gripFactor);
      for (let i = 0; i < SETTLE_STEPS; i++) this.sim.step(neutral());
      this.resetInterpolation();
      this.camera.position.set(12, 5, 32);
      this.camera.lookAt(3, 1, 18);
      this.ready = true;
      this.resize();
      this.emit();
      this.frameHandle = requestAnimationFrame(this.loop);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  start(): void {
    if (!this.ready) return;
    this.paused = false;
    this.input.clear();
    this.queuedJump = false;
    this.accumulator = 0;
    this.last = 0;
    this.audio.resume();
    this.emit();
  }

  pause(): void {
    if (!this.ready || this.paused) return;
    this.paused = true;
    this.input.clear();
    this.queuedJump = false;
    this.accumulator = 0;
    this.audio.suspend();
    this.emit();
  }

  restart(): void {
    if (!this.ready) return;
    this.sim.recover(true);
    this.afterRecover();
  }

  recover(): void {
    if (!this.ready) return;
    this.sim.recover();
    this.afterRecover();
  }

  setQuality(preset: QualityPreset): void {
    this.quality = qualitySettings(preset);
    this.frame.quality = this.quality;
    this.adaptive.reset();
    this.resolutionScale = 1;
    this.view.applyQuality(this.quality);
    this.car.applyQuality(preset);
    this.emit();
  }

  setWeather(setting: WeatherSetting): void {
    this.weather.setWeather(setting);
    if (this.ready) this.sim.setGripFactor(this.weather.state.gripFactor);
    this.emit();
  }

  toggleRain(): void {
    this.setWeather(toggledRainKind(this.weather.state));
  }

  toggleSound(): void {
    this.audio.toggle(!this.paused);
    this.emit();
  }

  toggleMotion(): void {
    this.lowMotion = !this.lowMotion;
    this.emit();
  }

  getDebugInfo(): DebugInfo {
    return this.view.debugInfo(this.fps);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.view.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.audio.dispose();
    if (this.ready) this.release();
  }

  private readonly resize = (): void => {
    if (this.disposed) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.view.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private readonly contextLost = (event: Event): void => {
    event.preventDefault();
    this.pause();
    this.fail('Graphics context lost. Reload to restart the city.');
  };

  private readonly obstruction: CameraObstruction = (origin, direction, maxDistance) => {
    this.rayOrigin.copy(origin);
    this.rayDirection.copy(direction);
    const hit = this.sim.world.castRay(
      this.ray,
      maxDistance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.sim.capsule,
      this.sim.car,
    );
    return hit ? hit.timeOfImpact : null;
  };

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    try {
      const dt = this.last ? Math.min((now - this.last) / 1000, MAX_FRAME) : STEP;
      this.last = now;
      const intent = this.input.read();
      if (this.input.take('Escape')) {
        if (this.paused) this.start();
        else this.pause();
      }

      if (!this.paused) {
        if (this.input.take('KeyF')) this.sim.interact();
        if (this.input.take('KeyV') && !this.sim.driving) this.firstPerson = !this.firstPerson;
        if (this.input.take('KeyR')) {
          this.sim.recover();
          this.resetInterpolation();
        }
        this.rig.applyLook(this.input.yawDelta, this.input.pitchDelta, this.sim.driving);
        if (!this.sim.driving) this.sim.yaw = this.rig.yaw;
        this.input.yawDelta = 0;
        this.input.pitchDelta = 0;

        this.queuedJump ||= intent.jump;
        this.accumulator += dt;
        this.sim.setGripFactor(this.weather.state.gripFactor);
        while (this.accumulator >= STEP) {
          this.resetInterpolation();
          intent.jump = this.queuedJump;
          this.sim.step(intent);
          this.queuedJump = false;
          intent.jump = false;
          this.accumulator -= STEP;
        }
      }

      const alpha = this.paused ? 1 : this.accumulator / STEP;
      const systemDt = this.paused ? 0 : dt;
      this.updateFrame(alpha);
      this.carState.dt = systemDt;
      this.carState.lowMotion = this.lowMotion;
      this.car.update(this.carState);

      for (const system of this.systems) system.update(systemDt, this.frame);
      this.view.update(this.frame);
      if (!this.paused) {
        this.rig.update(dt, this.frame, this.input.held('KeyC'), this.obstruction);
        this.adaptResolution(dt);
      }

      this.view.render();
      this.fps = 1 / dt;
      this.hudTime += dt;
      if (this.hudTime > HUD_INTERVAL) {
        this.emit();
        this.hudTime = 0;
      }
      this.frameHandle = requestAnimationFrame(this.loop);
    } catch (error) {
      this.pause();
      this.fail(error instanceof Error ? error.message : 'The game encountered an error. Reload to retry.');
    }
  };

  /** Interpolates poses and refreshes telemetry, wheels and flags in the shared frame context. */
  private updateFrame(alpha: number): void {
    const sim = this.sim;
    const frame = this.frame;
    frame.car.position.copy(this.previousCar).lerp(sim.car.translation(), alpha);
    frame.car.quaternion.copy(this.previousRotation).slerp(this.bodyRotation.copy(sim.car.rotation()), alpha);
    frame.player.position.copy(this.previousPlayer).lerp(sim.player.translation(), alpha);
    frame.player.quaternion.setFromAxisAngle(T.Object3D.DEFAULT_UP, sim.yaw);
    frame.focus.copy(sim.driving ? frame.car.position : frame.player.position);

    sim.readTelemetry(this.telemetry);
    for (let i = 0; i < this.wheels.length; i++) sim.readWheel(i, this.wheels[i]);

    frame.time = sim.time;
    frame.paused = this.paused;
    frame.playerYaw = sim.yaw;
    frame.playerMoving = this.input.held('KeyW', 'KeyA', 'KeyS', 'KeyD');
    frame.driving = sim.driving;
    frame.firstPerson = this.firstPerson;
    frame.mission = sim.mission;
    frame.lowMotion = this.lowMotion;
  }

  private adaptResolution(dt: number): void {
    const scale = this.adaptive.update(dt);
    if (scale === this.resolutionScale) return;
    this.resolutionScale = scale;
    this.view.applyQuality(this.quality, scale);
  }

  private afterRecover(): void {
    this.resetInterpolation();
    this.rig.resetYaw();
    this.start();
  }

  private resetInterpolation(): void {
    this.previousCar.copy(this.sim.car.translation());
    this.previousPlayer.copy(this.sim.player.translation());
    this.previousRotation.copy(this.sim.car.rotation());
  }

  private emit(): void {
    if (!this.sim) return;
    const sim = this.sim;
    const p = sim.driving ? sim.car.translation() : sim.player.translation();
    const yaw = sim.driving
      ? this.heading.setFromQuaternion(this.bodyRotation.copy(sim.car.rotation()), 'YXZ').y
      : sim.yaw;
    let prompt = '';
    if (sim.driving) prompt = sim.speed < 1 ? 'Exit vehicle' : '';
    else if (sim.canEnter()) prompt = 'Enter vehicle';

    this.publish({
      ready: this.ready,
      paused: this.paused,
      driving: sim.driving,
      mission: sim.mission,
      speed: sim.speed * 3.6,
      distance: Math.hypot(p.x - DESTINATION.x, p.z - DESTINATION.z),
      hold: sim.hold,
      prompt,
      notice: sim.noticeTime > 0 ? sim.notice : '',
      x: p.x,
      z: p.z,
      yaw,
      rain: this.weather.state.rainDensity > 0,
      sound: this.audio.enabled,
      firstPerson: this.firstPerson,
      fps: this.fps,
      quality: this.quality.preset,
      weather: this.weather.state.kind,
      weatherSetting: this.weather.setting,
      lowMotion: this.lowMotion,
      rpm: this.telemetry.rpm,
      gear: this.telemetry.gear,
    });
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    for (const system of [...this.systems].reverse()) system.dispose();
    this.sim?.dispose();
    disposeTree(this.scene);
    this.view.dispose();
  }
}
