import * as T from 'three';
import { BASE_MOON_INTENSITY } from './look';

/** Unit vector from the lit point towards the moon. Frozen, so an accidental write throws. */
const MOON_DIRECTION = Object.freeze(new T.Vector3(-30, 60, 20).normalize());

/** Copies the unit vector from the lit point towards the moon into `out`. */
export function moonDirection(out: T.Vector3): T.Vector3 {
  return out.copy(MOON_DIRECTION);
}

const MOON_COLOUR = '#bad6ff';
/** Distance from the shadow focus to the light; must clear the tallest tower (about 80 m). */
const LIGHT_DISTANCE = 140;
const SHADOW_NEAR = 1;
const SHADOW_FAR = 300;

const scratchRight = new T.Vector3();
const scratchUp = new T.Vector3();

/**
 * Snaps `focus` to the shadow map texel grid in the light's view plane and writes the result
 * to `out`. Moving the shadow frustum in whole texels stops shadow edges crawling as the
 * camera follows the car. Depth along the light direction is left untouched.
 */
export function snapToShadowTexel(
  focus: Readonly<T.Vector3>,
  direction: Readonly<T.Vector3>,
  texelSize: number,
  out: T.Vector3,
): T.Vector3 {
  // Matches the axes Object3D.lookAt gives the shadow camera (world up is +Y).
  scratchRight.crossVectors(T.Object3D.DEFAULT_UP, direction).normalize();
  scratchUp.crossVectors(direction, scratchRight);
  const along = focus.dot(direction);
  const right = Math.round(focus.dot(scratchRight) / texelSize) * texelSize;
  const up = Math.round(focus.dot(scratchUp) / texelSize) * texelSize;
  return out
    .copy(direction)
    .multiplyScalar(along)
    .addScaledVector(scratchRight, right)
    .addScaledVector(scratchUp, up);
}

/** The single moon light. Its shadow frustum follows the action and is sized per preset. */
export class MoonLight {
  readonly light = new T.DirectionalLight(MOON_COLOUR, BASE_MOON_INTENSITY);
  private extent = 0;
  private mapSize = 0;
  private readonly snapped = new T.Vector3();

  constructor(private readonly scene: T.Scene) {
    this.light.position.copy(MOON_DIRECTION).multiplyScalar(LIGHT_DISTANCE);
    const shadow = this.light.shadow;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.04;
    shadow.camera.near = SHADOW_NEAR;
    shadow.camera.far = SHADOW_FAR;
    scene.add(this.light, this.light.target);
  }

  /** Enables or resizes the shadow. Toggling castShadow also forces shader recompilation. */
  configure(enabled: boolean, mapSize: number, extent: number): void {
    const castShadow = enabled && extent > 0;
    this.light.castShadow = castShadow;
    if (!castShadow) {
      this.disposeMap();
      this.mapSize = 0;
      return;
    }
    if (mapSize !== this.mapSize) {
      this.disposeMap();
      this.mapSize = mapSize;
      this.light.shadow.mapSize.set(mapSize, mapSize);
    }
    if (extent !== this.extent) {
      this.extent = extent;
      const camera = this.light.shadow.camera;
      camera.left = -extent;
      camera.right = extent;
      camera.top = extent;
      camera.bottom = -extent;
      camera.updateProjectionMatrix();
    }
  }

  /** Centres the shadow frustum on `focus`. */
  follow(focus: Readonly<T.Vector3>): void {
    if (!this.light.castShadow) return;
    const texel = (2 * this.extent) / this.mapSize;
    snapToShadowTexel(focus, MOON_DIRECTION, texel, this.snapped);
    this.light.target.position.copy(this.snapped);
    this.light.position.copy(this.snapped).addScaledVector(MOON_DIRECTION, LIGHT_DISTANCE);
    this.light.target.updateMatrixWorld();
  }

  dispose(): void {
    this.disposeMap();
    this.scene.remove(this.light, this.light.target);
    this.light.dispose();
  }

  private disposeMap(): void {
    const shadow = this.light.shadow;
    if (shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
  }
}
