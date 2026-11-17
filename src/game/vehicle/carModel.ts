import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEFAULT_QUALITY } from '../render/quality';
import type { CarVisual, CarVisualState, QualityPreset } from '../core/types';
import {
  CAR_MODEL_URL,
  DETAIL_NODES,
  LOD_NODE,
  REQUIRED_NODES,
  SHELL_NODES,
  WHEEL_KEYS,
  isCarMaterialRole,
  materialTierFor,
  wheelKey,
  type CarMaterialRole,
  type WheelKey,
} from './carAsset';
import { CarMaterials } from './carMaterials';
import { createBodyLean, lightLevels, stepBodyLean, type LightLevels } from './carMotion';
import { createProceduralCar, type ProceduralCar } from './carProcedural';

export type { CarVisual, CarVisualState } from '../core/types';
export { CAR_MODEL_URL } from './carAsset';

/** Camera distance (metres) beyond which the decimated shell replaces the detailed body. */
const LOD_DISTANCE = 32;
const LOD_HYSTERESIS = 0.1;
/** Body lean pivots about a point near the axle line rather than the chassis origin. */
const LEAN_PIVOT_Y = -0.45;
/** Longest frame step fed to the lean filter, so a long frame does not jolt the body. */
const MAX_LEAN_STEP = 0.1;

export interface CreateCarOptions {
  url?: string;
  preset?: QualityPreset;
}

/** The car visual plus the extras the runtime may call once the contract allows it. */
export interface SumoCar extends CarVisual {
  /** Switches materials to the cost tier for `preset` (basic, physical or transmissive). */
  applyQuality(preset: QualityPreset): void;
  /** Resolves true once the glTF model replaced the fallback, or false if the fallback stays. */
  readonly ready: Promise<boolean>;
}

interface WheelSlot {
  pivot: T.Group;
  spinner: T.Group;
}

type PendingWheels = Map<WheelKey, { wheel: T.Object3D; caliper: T.Object3D }>;

function disposeGeometries(root: T.Object3D): void {
  const geometries = new Set<T.BufferGeometry>();
  root.traverse(object => {
    if (object instanceof T.Mesh) geometries.add(object.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}

function requireNode(root: T.Object3D, name: string): T.Object3D {
  const node = root.getObjectByName(name);
  if (!node) throw new Error(`Car model is missing the "${name}" node`);
  return node;
}

class SumoGt implements SumoCar {
  readonly group = new T.Group();
  readonly wheels: T.Group[] = [];
  readonly ready: Promise<boolean>;

  private readonly lean = new T.Group();
  private readonly chassis = new T.Group();
  private readonly slots: WheelSlot[] = [];
  private readonly lamps: T.Light[] = [];
  private readonly bindings = new Map<T.Mesh, CarMaterialRole>();
  private readonly bodyLean = createBodyLean();
  private readonly levels: LightLevels = { front: 0, rear: 0, reverse: 0 };
  private materials: CarMaterials;
  private fallback: ProceduralCar | null;
  private pendingWheels: PendingWheels | null = null;
  private lightsOn = true;

  constructor(url: string, preset: QualityPreset) {
    this.group.name = 'sumo-gt';
    this.lean.position.y = LEAN_PIVOT_Y;
    this.chassis.position.y = -LEAN_PIVOT_Y;
    this.lean.add(this.chassis);
    this.group.add(this.lean);

    for (let i = 0; i < 4; i++) {
      const pivot = new T.Group();
      const spinner = new T.Group();
      pivot.add(spinner);
      this.group.add(pivot);
      this.wheels.push(pivot);
      this.slots.push({ pivot, spinner });
    }

    this.addLamps();
    this.materials = new CarMaterials(materialTierFor(preset));
    this.fallback = this.installFallback();
    this.ready = this.load(url);
  }

  setLights(on: boolean): void {
    this.lightsOn = on;
    for (const lamp of this.lamps) lamp.visible = on;
  }

  applyQuality(preset: QualityPreset): void {
    const tier = materialTierFor(preset);
    if (tier === this.materials.tier) return;
    const previous = this.materials;
    this.materials = new CarMaterials(tier);
    for (const [mesh, role] of this.bindings) mesh.material = this.materials.get(role);
    this.materials.setLightLevels(this.levels);
    previous.dispose();
  }

  update(state: CarVisualState): void {
    this.group.position.copy(state.pose.position);
    this.group.quaternion.copy(state.pose.quaternion);

    const steering = state.wheels.length > 0 ? state.wheels[0].steering : 0;
    stepBodyLean(this.bodyLean, state.telemetry.signedSpeed, steering, Math.min(state.dt, MAX_LEAN_STEP));
    if (state.lowMotion) this.lean.rotation.set(0, 0, 0);
    else this.lean.rotation.set(this.bodyLean.pitch, 0, this.bodyLean.roll);

    if (this.pendingWheels && state.wheels.length === this.slots.length) {
      this.bindWheels(state, this.pendingWheels);
      this.pendingWheels = null;
    }
    for (let i = 0; i < this.slots.length && i < state.wheels.length; i++) {
      const { pivot, spinner } = this.slots[i];
      const wheel = state.wheels[i];
      pivot.position.copy(wheel.anchor);
      pivot.position.y -= wheel.suspensionLength;
      pivot.rotation.set(0, wheel.steering, 0);
      spinner.rotation.x = wheel.rotation;
    }

    this.materials.setLightLevels(lightLevels(state.telemetry, this.lightsOn, this.levels));
  }

  private addLamps(): void {
    for (const x of [-0.62, 0.62]) {
      const light = new T.SpotLight('#c4eaff', 70, 42, 0.48, 0.6, 1.1);
      light.position.set(x, -0.05, 2.05);
      light.target.position.set(x, -1, 22);
      this.chassis.add(light, light.target);
      this.lamps.push(light);
    }
    const under = new T.PointLight('#19d9df', 7, 5, 1.8);
    under.position.set(0, -0.52, 0);
    this.group.add(under);
    this.lamps.push(under);
  }

  private bind(mesh: T.Mesh, role: CarMaterialRole): void {
    mesh.material = this.materials.get(role);
    this.bindings.set(mesh, role);
  }

  private installFallback(): ProceduralCar {
    const fallback = createProceduralCar(this.materials);
    for (const [mesh, role] of fallback.bindings) this.bindings.set(mesh, role);
    this.chassis.add(fallback.body);
    fallback.wheels.forEach((wheel, i) => this.slots[i].spinner.add(wheel));
    return fallback;
  }

  private removeFallback(): void {
    const fallback = this.fallback;
    if (!fallback) return;
    for (const [mesh] of fallback.bindings) this.bindings.delete(mesh);
    fallback.body.removeFromParent();
    disposeGeometries(fallback.body);
    for (const wheel of fallback.wheels) {
      wheel.removeFromParent();
      disposeGeometries(wheel);
    }
    this.fallback = null;
  }

  private async load(url: string): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      this.install(gltf.scene);
      return true;
    } catch (error) {
      console.warn(`Sumo GT model could not be used (${url}); keeping the procedural car.`, error);
      return false;
    }
  }

  /** Re-skins the loaded model with the tier's materials and swaps it in for the fallback. */
  private install(root: T.Object3D): void {
    for (const name of REQUIRED_NODES) requireNode(root, name);

    root.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      const source: T.Material[] = Array.isArray(object.material) ? object.material : [object.material];
      const name = source[0]?.name ?? '';
      for (const material of source) material.dispose();
      this.bind(object, isCarMaterialRole(name) ? name : 'trim');
      object.castShadow = true;
    });

    this.removeFallback();

    const detail = new T.Group();
    for (const name of DETAIL_NODES) detail.add(requireNode(root, name));
    const lod = new T.LOD();
    lod.addLevel(detail, 0);
    lod.addLevel(requireNode(root, LOD_NODE), LOD_DISTANCE, LOD_HYSTERESIS);
    this.chassis.add(lod);
    for (const name of SHELL_NODES) this.chassis.add(requireNode(root, name));

    const pending: PendingWheels = new Map();
    for (const key of WHEEL_KEYS) {
      pending.set(key, {
        wheel: requireNode(root, `wheel_${key}`),
        caliper: requireNode(root, `caliper_${key}`),
      });
    }
    this.pendingWheels = pending;
  }

  /**
   * Places each modelled corner on the physics wheel whose anchor sits on that corner, so the
   * mirrored rim faces always point outwards. Calipers steer with the wheel but do not spin.
   */
  private bindWheels(state: CarVisualState, pending: PendingWheels): void {
    this.slots.forEach((slot, i) => {
      const anchor = state.wheels[i].anchor;
      const corner = pending.get(wheelKey(anchor.x, anchor.z));
      if (!corner) return;
      corner.wheel.position.set(0, 0, 0);
      corner.caliper.position.set(0, 0, 0);
      slot.spinner.add(corner.wheel);
      slot.pivot.add(corner.caliper);
    });
  }
}

/**
 * Builds the player's car: an original fastback GT loaded from `public/models/sumo-gt.glb`.
 * The procedural coupe shows until the model arrives and stays if loading fails.
 */
export function createCar(options: CreateCarOptions = {}): SumoCar {
  return new SumoGt(options.url ?? CAR_MODEL_URL, options.preset ?? DEFAULT_QUALITY);
}
