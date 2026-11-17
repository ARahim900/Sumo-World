import type * as T from 'three';

/** Uniform values derived from the weather's wetness and puddle amounts. */
export interface WetSurfaceTargets {
  /** 0..1 wet blend applied to roughness and colour. */
  wetness: number;
  /** Puddle noise threshold; at or above 1 no puddles form. */
  puddleThreshold: number;
  /** Fraction of albedo removed by a soaked surface. */
  darkening: number;
  /** Extra environment reflection added on top of the material's dry value. */
  extraReflection: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Maps WeatherState wetness and puddles (both 0..1) to shader inputs. */
export function wetSurfaceTargets(wetness: number, puddles: number): WetSurfaceTargets {
  const wet = clamp01(wetness);
  const pool = clamp01(puddles);
  return {
    wetness: wet,
    puddleThreshold: pool > 0 ? 1 - pool * 0.55 : 2,
    darkening: 0.45 * wet,
    extraReflection: 0.55 * wet,
  };
}

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vCityWorld;
`;

const VERTEX_WORLD = /* glsl */ `
vCityWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vCityWorld;
uniform float uCityWetness;
uniform float uCityDarkening;
uniform float uCityPuddleThreshold;
uniform float uCityPuddleStrength;

float cityHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float cityNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cityHash(cell);
  float b = cityHash(cell + vec2(1.0, 0.0));
  float c = cityHash(cell + vec2(0.0, 1.0));
  float d = cityHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cityPuddleMask(vec2 p) {
  float n = cityNoise(p * 0.11) * 0.65 + cityNoise(p * 0.37 + 17.0) * 0.35;
  return smoothstep(uCityPuddleThreshold, uCityPuddleThreshold + 0.06, n) * uCityPuddleStrength;
}
`;

const FRAGMENT_WET = /* glsl */ `
float cityPuddle = 0.0;
// Uniform branch: skip the noise on dry presets and materials that collect no water.
if (uCityPuddleThreshold < 1.0 && uCityPuddleStrength > 0.0) {
  cityPuddle = cityPuddleMask(vCityWorld.xz);
}
diffuseColor.rgb *= (1.0 - uCityDarkening) * (1.0 - 0.18 * cityPuddle);
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.15 + 0.02, uCityWetness);
roughnessFactor = mix(roughnessFactor, 0.03, cityPuddle);
`;

const FRAGMENT_FLATTEN = /* glsl */ `
normal = normalize(mix(normal, nonPerturbedNormal, cityPuddle));
`;

/** Vertex and fragment source of a material shader, as handed to onBeforeCompile. */
export interface ShaderSource {
  vertexShader: string;
  fragmentShader: string;
}

/** Injects the world position, puddle mask, wet roughness and puddle flattening into the shader. */
export function patchWetShader(shader: ShaderSource): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_WORLD}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_WET}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_FLATTEN}`);
}

interface PatchedMaterial {
  material: T.MeshStandardMaterial;
  dryReflection: number;
  puddleStrength: { value: number };
}

/**
 * Wet-road hook for the weather and render teams. Patches standard materials so one call to
 * setWetness darkens them, lowers roughness, adds environment reflection and grows a
 * procedural puddle mask (world-space value noise) where the surface turns mirror-smooth.
 * Uniforms are shared, so updates never trigger a shader recompile.
 */
export class WetSurface {
  private readonly wetness = { value: 0 };
  private readonly darkening = { value: 0 };
  private readonly puddleThreshold = { value: 2 };
  private readonly patched: PatchedMaterial[] = [];

  /** Adds `material`; `puddleStrength` 0..1 scales how much standing water it collects. */
  patch(material: T.MeshStandardMaterial, puddleStrength: number): void {
    const entry: PatchedMaterial = {
      material,
      dryReflection: material.envMapIntensity,
      puddleStrength: { value: puddleStrength },
    };
    material.onBeforeCompile = shader => {
      shader.uniforms.uCityWetness = this.wetness;
      shader.uniforms.uCityDarkening = this.darkening;
      shader.uniforms.uCityPuddleThreshold = this.puddleThreshold;
      shader.uniforms.uCityPuddleStrength = entry.puddleStrength;
      patchWetShader(shader);
    };
    material.customProgramCacheKey = () => 'city-wet-surface';
    this.patched.push(entry);
  }

  /** Applies WeatherState wetness and puddles (0..1 each) to every patched material. */
  setWetness(wetness: number, puddles: number): void {
    const targets = wetSurfaceTargets(wetness, puddles);
    this.wetness.value = targets.wetness;
    this.darkening.value = targets.darkening;
    this.puddleThreshold.value = targets.puddleThreshold;
    for (const entry of this.patched) {
      entry.material.envMapIntensity = entry.dryReflection + targets.extraReflection;
    }
  }
}
