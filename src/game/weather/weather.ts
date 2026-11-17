import * as T from 'three';
import type {
  FrameContext,
  GameSystem,
  SystemInitContext,
  WeatherSetting,
  WeatherState,
} from '../core/types';
import type { ThunderEvent, ThunderListener } from './lightning';
import { WeatherModel } from './model';
import { DEFAULT_WEATHER, clamp01, presetFor } from './presets';
import type { RandomSource } from './random';

export type { ThunderEvent, ThunderListener } from './lightning';
export {
  DEFAULT_WEATHER,
  WEATHER_KINDS,
  applyWeather,
  gripFor,
  toggledRainKind,
  weatherFor,
} from './presets';

/** Cold blue-white of a lightning flash. */
const FLASH_COLOUR = new T.Color('#c7d6ff');
/** Ambient light added at the peak of a flash. */
const FLASH_LIGHT = 2.2;
/** How far the fog tint moves towards the flash colour at the peak of a flash. */
const FOG_FLASH = 0.55;
/** How far the sky moves towards the flash colour at the peak of a flash. */
const SKY_FLASH = 0.45;
/** Fog density above the default at which the sky fully takes on the fog tint. */
const FOG_SKY_RANGE = 0.016;
/** Largest share of fog tint mixed into the sky, so dense fog hides the horizon line. */
const FOG_SKY_SHARE = 0.85;

/**
 * Weather source of truth. Drives the WeatherModel, then applies its fog tint, the sky's
 * fog blend and the lightning flash to the scene. Fog density itself is applied by the
 * renderer from WeatherState.fogDensity.
 */
export class WeatherSystem implements GameSystem {
  readonly name = 'weather';
  readonly model: WeatherModel;
  /** Hears each thunderclap as it arrives; wire it to audio that respects the sound setting. */
  onThunder?: ThunderListener;
  private scene?: T.Scene;
  private flash?: T.AmbientLight;
  private readonly baseSky = new T.Color();
  private readonly baseFog = new T.Color();
  private readonly fogTint = new T.Color();
  private hasSky = false;
  private hasFog = false;
  private readonly baseFogDensity = presetFor(DEFAULT_WEATHER).fogDensity;

  constructor(random?: RandomSource) {
    this.model = new WeatherModel(random);
  }

  get state(): WeatherState {
    return this.model.state;
  }

  get setting(): WeatherSetting {
    return this.model.setting;
  }

  setWeather(setting: WeatherSetting): void {
    this.model.setSetting(setting);
  }

  init(context: SystemInitContext): void {
    const scene = context.scene;
    this.scene = scene;
    this.hasSky = scene.background instanceof T.Color;
    if (scene.background instanceof T.Color) this.baseSky.copy(scene.background);
    this.hasFog = scene.fog instanceof T.FogExp2 || scene.fog instanceof T.Fog;
    if (scene.fog) this.baseFog.copy(scene.fog.color);

    // An ambient light is not part of three's shader program key, so adding it at zero
    // intensity costs nothing until a flash and never triggers a shader recompile.
    this.flash = new T.AmbientLight(FLASH_COLOUR, 0);
    this.flash.name = 'lightning-flash';
    scene.add(this.flash);
  }

  update(dt: number, frame: FrameContext): void {
    this.model.update(dt, frame.lowMotion, this.emitThunder);
    this.applyAtmosphere(frame.scene);
  }

  dispose(): void {
    if (this.flash) {
      this.scene?.remove(this.flash);
      this.flash.dispose();
      this.flash = undefined;
    }
    if (this.scene?.fog && this.hasFog) this.scene.fog.color.copy(this.baseFog);
    if (this.scene?.background instanceof T.Color && this.hasSky) this.scene.background.copy(this.baseSky);
    this.scene = undefined;
    this.model.reset();
  }

  private readonly emitThunder = (event: ThunderEvent): void => {
    this.onThunder?.(event);
  };

  private applyAtmosphere(scene: T.Scene): void {
    const state = this.model.state;
    const flash = state.lightning;
    const fogColour = this.model.fogColour;
    this.fogTint.setRGB(fogColour[0], fogColour[1], fogColour[2], T.SRGBColorSpace);

    if (this.hasFog && scene.fog) {
      scene.fog.color.copy(this.fogTint);
      if (flash > 0) scene.fog.color.lerp(FLASH_COLOUR, flash * FOG_FLASH);
    }

    if (this.hasSky && scene.background instanceof T.Color) {
      const fogMix = clamp01((state.fogDensity - this.baseFogDensity) / FOG_SKY_RANGE) * FOG_SKY_SHARE;
      scene.background.copy(this.baseSky).lerp(this.fogTint, fogMix);
      if (flash > 0) scene.background.lerp(FLASH_COLOUR, flash * SKY_FLASH);
    }

    if (this.flash) this.flash.intensity = flash * FLASH_LIGHT;
  }
}
