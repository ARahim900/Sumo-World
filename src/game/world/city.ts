import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { blocks, DESTINATION } from '../content';
import { disposeTree } from '../core/dispose';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';
import {
  BENCH_DEPTH,
  BENCH_LENGTH,
  BLOCK_CENTRES,
  CHUNK_GRID,
  LAMP_HEAD_HEIGHT,
  LAMP_POLE_WIDTH,
  NearestPoints,
  PAVEMENT_HALF,
  benches,
  bollards,
  chunkCentre,
  chunkIndexFor,
  crossingStripes,
  kerbStrips,
  lampHandoverWeight,
  laneDashes,
  lampPosts,
  lodDistances,
  planBuilding,
  type LampPost,
  type Marking,
  type NeonColour,
} from './cityLayout';
import { asphaltTexture, lightPoolTexture, signAtlas, TERMINAL_SIGN_CELL } from './cityTextures';
import { GeometryBatch } from './geometryBatch';
import { WetSurface, type ShaderSource } from './wetSurface';

export { signMaterial } from './cityTextures';

const NEON_COLOURS: Record<NeonColour, string> = { cyan: '#23dce8', pink: '#ef3fa3' };
const NEON_INTENSITY = 1.6;
const LAMP_LIGHT_COLOURS: Record<NeonColour, string> = { cyan: '#29c6e2', pink: '#e0469a' };
const LAMP_HEAD_COLOUR = '#bddde7';
const LAMP_HEAD_INTENSITY = 4;
const POOL_STRENGTH = 0.34;

/** Window glow palette (sRGB): cool office, warm residential, neutral and violet. */
const WINDOW_PALETTE = ['#87bed4', '#e0b07c', '#b9c9d8', '#9a9fe6'];
const FACADE_EMISSIVE_INTENSITY = 0.38;

/** Real point lights kept near the action; their count is fixed so shaders never recompile. */
export const DYNAMIC_LIGHT_COUNT = 3;
const LIGHT_HEIGHT = 5.3;
const LIGHT_INTENSITY = 24;
const LIGHT_RANGE = 19;
const LIGHT_DECAY = 1.6;
/** Focus movement (metres) before the nearest lamps are searched again. */
const RELIGHT_DISTANCE = 0.2;
/** Distance over which a light fades out before it is handed to the next nearest lamp. */
const HANDOVER_BAND = 6;

function linear(colour: string, intensity = 1): T.Color {
  return new T.Color(colour).multiplyScalar(intensity);
}

const IDENTITY = new T.Quaternion();

/** The vertex colour tints only the lit windows, not the daylight albedo. */
export function patchFacadeShader(shader: ShaderSource): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <color_fragment>', '')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor;');
}

/** Facade material whose window glow is tinted per building by the vertex colour. */
function facadeMaterial(map: T.Texture): T.MeshStandardMaterial {
  const material = new T.MeshStandardMaterial({
    map,
    emissiveMap: map,
    emissive: '#ffffff',
    emissiveIntensity: FACADE_EMISSIVE_INTENSITY,
    roughness: 0.7,
    metalness: 0.2,
    vertexColors: true,
  });
  material.onBeforeCompile = patchFacadeShader;
  material.customProgramCacheKey = () => 'city-facade';
  return material;
}

function markingMesh(markings: readonly Marking[], y: number, material: T.Material): T.InstancedMesh {
  const geometry = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new T.InstancedMesh(geometry, material, markings.length);
  const matrix = new T.Matrix4();
  const position = new T.Vector3();
  const scale = new T.Vector3();
  markings.forEach((marking, i) => {
    position.set(marking.x, y, marking.z);
    scale.set(marking.sizeX, 1, marking.sizeZ);
    mesh.setMatrixAt(i, matrix.compose(position, IDENTITY, scale));
  });
  return mesh;
}

function groundPropMesh(
  geometry: T.BufferGeometry,
  material: T.Material,
  props: readonly { x: number; z: number; yaw: number }[],
): T.InstancedMesh {
  const mesh = new T.InstancedMesh(geometry, material, props.length);
  const dummy = new T.Object3D();
  props.forEach((prop, i) => {
    dummy.position.set(prop.x, 0, prop.z);
    dummy.rotation.set(0, prop.yaw, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  return mesh;
}

/** Pole, arm and lamp head instanced across every lamp post, plus baked light pools. */
function streetLights(lamps: readonly LampPost[], root: T.Group, poleMaterial: T.Material): void {
  const poleKit = mergeGeometries([
    new T.BoxGeometry(LAMP_POLE_WIDTH, 6, LAMP_POLE_WIDTH).translate(0, 3, 0),
    new T.BoxGeometry(1.8, 0.12, 0.16).translate(-0.8, 6, 0),
  ]);
  if (!poleKit) throw new Error('Lamp pole geometry could not be merged.');
  root.add(groundPropMesh(poleKit, poleMaterial, lamps));

  const head = new T.BoxGeometry(1, 0.06, 0.3).translate(-1, LAMP_HEAD_HEIGHT, 0);
  const headMaterial = new T.MeshBasicMaterial({ color: linear(LAMP_HEAD_COLOUR, LAMP_HEAD_INTENSITY) });
  root.add(groundPropMesh(head, headMaterial, lamps));

  const poolMaterial = new T.MeshBasicMaterial({
    map: lightPoolTexture(),
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  const pools = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMaterial, lamps.length * 2);
  const matrix = new T.Matrix4();
  const position = new T.Vector3();
  const scale = new T.Vector3();
  const colour = new T.Color();
  lamps.forEach((lamp, i) => {
    const towardX = lamp.headX - lamp.x;
    const towardZ = lamp.headZ - lamp.z;
    const alongX = towardX === 0;
    // One pool spills across the carriageway, a dimmer one over the pavement behind the pole.
    position.set(lamp.headX + towardX * 2.5, 0.016, lamp.headZ + towardZ * 2.5);
    scale.set(alongX ? 13 : 8, 1, alongX ? 8 : 13);
    pools.setMatrixAt(i * 2, matrix.compose(position, IDENTITY, scale));
    pools.setColorAt(i * 2, colour.set(LAMP_LIGHT_COLOURS[lamp.colour]).multiplyScalar(POOL_STRENGTH));
    position.set(lamp.x - towardX * 2, 0.106, lamp.z - towardZ * 2);
    scale.set(alongX ? 9 : 6, 1, alongX ? 6 : 9);
    pools.setMatrixAt(i * 2 + 1, matrix.compose(position, IDENTITY, scale));
    pools.setColorAt(i * 2 + 1, colour.set(LAMP_HEAD_COLOUR).multiplyScalar(POOL_STRENGTH * 0.55));
  });
  root.add(pools);
}

/** Kerbside benches beside the lamps and bollards on every pavement corner. */
function streetFurniture(
  lamps: readonly LampPost[],
  root: T.Group,
  benchMaterial: T.Material,
  bollardMaterial: T.Material,
): void {
  const bench = new T.BoxGeometry(BENCH_DEPTH, 0.7, BENCH_LENGTH).translate(0, 0.42, 0);
  root.add(groundPropMesh(bench, benchMaterial, benches(lamps)));
  const bollard = new T.CylinderGeometry(0.1, 0.13, 0.85, 8).translate(0, 0.52, 0);
  root.add(groundPropMesh(bollard, bollardMaterial, bollards()));
}

interface ChunkBatches {
  facade: GeometryBatch;
  graphite: GeometryBatch;
  neon: GeometryBatch;
}

/** Buildings in distance-switched chunks (one per pavement block) plus every sign in one atlas mesh. */
function buildings(root: T.Group, facade: T.Material, graphite: T.Material, neon: T.Material): T.LOD[] {
  const chunks: ChunkBatches[] = [];
  for (let i = 0; i < CHUNK_GRID * CHUNK_GRID; i++) {
    const centre = chunkCentre(i);
    chunks.push({
      facade: new GeometryBatch(centre.x, centre.z),
      graphite: new GeometryBatch(centre.x, centre.z),
      neon: new GeometryBatch(centre.x, centre.z),
    });
  }
  const atlas = signAtlas();
  const signs = new GeometryBatch();
  const neonColours: Record<NeonColour, T.Color> = {
    cyan: linear(NEON_COLOURS.cyan, NEON_INTENSITY),
    pink: linear(NEON_COLOURS.pink, NEON_INTENSITY),
  };

  blocks.forEach((block, index) => {
    const plan = planBuilding(block, index);
    const chunk = chunks[chunkIndexFor(block.x, block.z)];
    const tint = linear(WINDOW_PALETTE[plan.windowTint], plan.windowLevel);
    plan.tiers.forEach((tier, level) => {
      chunk.facade.walls(tier, plan.uOffset, tint.clone().multiplyScalar(1 + level * 0.08), plan.uvScale);
    });
    for (const cap of plan.caps) chunk.graphite.box(cap);
    for (const unit of plan.rooftop) chunk.graphite.box(unit);
    for (const trim of plan.neon) chunk.neon.box(trim.box, neonColours[trim.colour]);
    for (const sign of plan.signs) {
      signs.panel([sign.x, sign.y, sign.z], sign.width, sign.height, sign.yaw, sign.roll, atlas.cell(sign.cell));
    }
  });
  signs.panel([4, 7, -113], 10, 2.5, 0, 0, atlas.cell(TERMINAL_SIGN_CELL));

  const signGeometry = signs.build();
  if (signGeometry) root.add(new T.Mesh(signGeometry, atlas.material));

  const lods: T.LOD[] = [];
  chunks.forEach((batches, index) => {
    const facadeGeometry = batches.facade.build();
    if (!facadeGeometry) return;
    const graphiteGeometry = batches.graphite.build();
    const neonGeometry = batches.neon.build();
    const centre = chunkCentre(index);

    const detailed = new T.Group();
    const simple = new T.Group();
    detailed.add(new T.Mesh(facadeGeometry, facade));
    simple.add(new T.Mesh(facadeGeometry, facade));
    if (graphiteGeometry) detailed.add(new T.Mesh(graphiteGeometry, graphite));
    if (neonGeometry) {
      detailed.add(new T.Mesh(neonGeometry, neon));
      simple.add(new T.Mesh(neonGeometry, neon));
    }

    const lod = new T.LOD();
    lod.name = `city-chunk-${index}`;
    lod.position.set(centre.x, 0, centre.z);
    const distances = lodDistances(550);
    lod.addLevel(detailed, 0);
    lod.addLevel(simple, distances.detail, 0.1);
    lod.addLevel(new T.Group(), distances.cull);
    root.add(lod);
    lods.push(lod);
  });
  return lods;
}

function missionMarker(): T.Group {
  const marker = new T.Group();
  marker.position.set(DESTINATION.x, 0.07, DESTINATION.z);
  const ring = new T.Mesh(
    new T.RingGeometry(4.7, 5, 64),
    new T.MeshBasicMaterial({ color: '#45ffcb', side: T.DoubleSide, transparent: true, opacity: 0.8 }),
  );
  ring.rotation.x = -Math.PI / 2;
  marker.add(ring);
  const beam = new T.Mesh(
    new T.CylinderGeometry(5, 5, 8, 48, 1, true),
    new T.MeshBasicMaterial({
      color: '#45ffcb',
      transparent: true,
      opacity: 0.055,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.y = 4;
  marker.add(beam);
  return marker;
}

/** Cyan arrows from the garage to the terminal, instanced as one draw call. */
function routeArrows(): T.Group {
  const arrow = new T.Shape();
  arrow.moveTo(-0.5, 0);
  arrow.lineTo(0, -0.8);
  arrow.lineTo(0.5, 0);
  arrow.lineTo(0.25, 0);
  arrow.lineTo(0, -0.4);
  arrow.lineTo(-0.25, 0);
  arrow.closePath();
  const geometry = new T.ShapeGeometry(arrow).rotateX(Math.PI / 2);
  const material = new T.MeshBasicMaterial({
    color: '#46ece6',
    transparent: true,
    opacity: 0.65,
    side: T.DoubleSide,
    depthWrite: false,
  });
  const positions: number[] = [];
  for (let z = 14; z > -100; z -= 9) positions.push(z);
  const mesh = new T.InstancedMesh(geometry, material, positions.length);
  const matrix = new T.Matrix4();
  positions.forEach((z, i) => mesh.setMatrixAt(i, matrix.makeTranslation(4, 0.035, z)));
  const route = new T.Group();
  route.add(mesh);
  return route;
}

/** Freezes the transforms of everything under `root` except the objects that move. */
function freeze(root: T.Object3D, moving: ReadonlySet<T.Object3D>): void {
  root.traverse(object => {
    if (moving.has(object)) return;
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });
}

export interface City {
  root: T.Group;
  /** Destination ring and light beam. */
  marker: T.Group;
  /** Cyan arrows from the garage to the terminal. */
  route: T.Group;
  /** Wet-road hook for road and pavement materials. */
  wet: WetSurface;
  /** Building chunks, switched by camera distance. */
  chunks: T.LOD[];
  lamps: LampPost[];
  /** Point lights moved to the lamps nearest the focus. */
  lights: T.PointLight[];
}

/** Builds the district: roads, pavements, towers, signs, street furniture and mission markers. */
export async function createCity(maxAnisotropy = 4): Promise<City> {
  const root = new T.Group();
  root.name = 'city';

  const texture = await new T.TextureLoader().loadAsync('/assets/facade.webp');
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  texture.anisotropy = Math.min(8, maxAnisotropy);

  const facade = facadeMaterial(texture);
  const graphite = new T.MeshStandardMaterial({ color: '#111827', roughness: 0.4, metalness: 0.5 });
  const neon = new T.MeshBasicMaterial({ vertexColors: true });
  const wet = new WetSurface();

  const asphalt = asphaltTexture();
  const roadMaterial = new T.MeshStandardMaterial({
    color: '#1a2230',
    roughness: 1,
    metalness: 0.3,
    roughnessMap: asphalt,
    bumpMap: asphalt,
    bumpScale: 0.025,
    envMapIntensity: 0.15,
  });
  wet.patch(roadMaterial, 1);
  const road = new T.Mesh(new T.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), roadMaterial);
  road.position.y = -0.01;
  road.receiveShadow = true;
  root.add(road);

  const pavementMaterial = new T.MeshStandardMaterial({ color: '#2a3243', roughness: 0.85, metalness: 0.1 });
  wet.patch(pavementMaterial, 0.35);
  const pavement = new GeometryBatch();
  const staticNeon = new GeometryBatch();
  const staticGraphite = new GeometryBatch();
  const cyan = linear(NEON_COLOURS.cyan, NEON_INTENSITY);
  const pink = linear(NEON_COLOURS.pink, NEON_INTENSITY);
  for (const x of BLOCK_CENTRES) {
    for (const z of BLOCK_CENTRES) {
      pavement.box({ x, y: 0.02, z, w: PAVEMENT_HALF * 2, h: 0.16, d: PAVEMENT_HALF * 2 });
    }
  }
  for (const trim of kerbStrips()) staticNeon.box(trim.box, trim.colour === 'cyan' ? cyan : pink);
  for (const x of [-3, 11]) staticNeon.box({ x, y: 3.5, z: -113, w: 0.22, h: 7, d: 0.22 }, cyan);
  for (const s of [-1, 1]) {
    staticGraphite.box({ x: s * 199, y: 1, z: 0, w: 1.5, h: 2.2, d: 400 });
    staticGraphite.box({ x: 0, y: 1, z: s * 199, w: 400, h: 2.2, d: 1.5 });
  }
  for (const [batch, material] of [
    [pavement, pavementMaterial],
    [staticNeon, neon],
    [staticGraphite, graphite],
  ] as const) {
    const geometry = batch.build();
    if (geometry) root.add(new T.Mesh(geometry, material));
  }

  const stripe = new T.MeshBasicMaterial({ color: '#9bafbb' });
  root.add(markingMesh(laneDashes(), 0.012, stripe));
  root.add(markingMesh(crossingStripes(), 0.02, stripe));

  const lamps = lampPosts();
  const poleMaterial = new T.MeshStandardMaterial({ color: '#323c50', roughness: 0.4, metalness: 0.7 });
  streetLights(lamps, root, poleMaterial);
  streetFurniture(lamps, root, graphite, poleMaterial);
  const chunks = buildings(root, facade, graphite, neon);

  const marker = missionMarker();
  root.add(marker);
  const route = routeArrows();
  root.add(route);

  const lights: T.PointLight[] = [];
  for (let i = 0; i < DYNAMIC_LIGHT_COUNT; i++) {
    const light = new T.PointLight(LAMP_LIGHT_COLOURS.cyan, LIGHT_INTENSITY, LIGHT_RANGE, LIGHT_DECAY);
    light.position.set(lamps[i].headX, LIGHT_HEIGHT, lamps[i].headZ);
    root.add(light);
    lights.push(light);
  }

  freeze(root, new Set<T.Object3D>(lights));
  return { root, marker, route, wet, chunks, lamps, lights };
}

/**
 * Adds the city to the scene, keeps mission markers in step with progress, moves the three
 * real lamp lights to the lamps nearest the focus (fading each one out before it is handed
 * to another lamp) and mirrors weather wetness onto the road.
 */
export class CitySystem implements GameSystem {
  readonly name = 'city';
  private city?: City;
  private scene?: T.Scene;
  private lampX = new Float32Array(0);
  private lampZ = new Float32Array(0);
  private readonly lampColours: T.Color[] = [];
  /** One more than the light count: the extra slot is the cutoff the lights fade against. */
  private readonly nearest = new NearestPoints(DYNAMIC_LIGHT_COUNT + 1);
  private readonly lightColours: Record<NeonColour, T.Color> = {
    cyan: new T.Color(LAMP_LIGHT_COLOURS.cyan),
    pink: new T.Color(LAMP_LIGHT_COLOURS.pink),
  };
  private focusX = Infinity;
  private focusZ = Infinity;
  private weatherWetness = -1;
  private weatherPuddles = -1;
  private drawDistance = -1;

  async init(context: SystemInitContext): Promise<void> {
    const city = await createCity(context.renderer.capabilities.getMaxAnisotropy());
    this.city = city;
    this.scene = context.scene;
    this.lampX = Float32Array.from(city.lamps, lamp => lamp.headX);
    this.lampZ = Float32Array.from(city.lamps, lamp => lamp.headZ);
    this.lampColours.length = 0;
    for (const lamp of city.lamps) this.lampColours.push(this.lightColours[lamp.colour]);
    this.syncWeather(context.weather.wetness, context.weather.puddles);
    this.applyDrawDistance(context.quality.drawDistance);
    context.scene.add(city.root);
  }

  /**
   * Wet-road hook: 0..1 wetness darkens and smooths the road and pavement, 0..1 puddles grows
   * standing water. Called automatically when the weather state changes; other systems may
   * also call it directly and the value holds until the weather changes again.
   */
  setWetness(wetness: number, puddles: number): void {
    this.city?.wet.setWetness(wetness, puddles);
  }

  update(_dt: number, frame: FrameContext): void {
    if (!this.city) return;
    this.city.route.visible = frame.mission === 'drive';
    this.city.marker.visible = frame.mission !== 'complete';
    this.syncWeather(frame.weather.wetness, frame.weather.puddles);
    if (frame.quality.drawDistance !== this.drawDistance) this.applyDrawDistance(frame.quality.drawDistance);
    this.placeLights(frame.focus.x, frame.focus.z);
  }

  dispose(): void {
    if (!this.city) return;
    this.scene?.remove(this.city.root);
    this.city.root.traverse(object => {
      if (object instanceof T.InstancedMesh) object.dispose();
    });
    disposeTree(this.city.root);
    this.city = undefined;
  }

  private syncWeather(wetness: number, puddles: number): void {
    if (wetness === this.weatherWetness && puddles === this.weatherPuddles) return;
    this.weatherWetness = wetness;
    this.weatherPuddles = puddles;
    this.setWetness(wetness, puddles);
  }

  private applyDrawDistance(drawDistance: number): void {
    if (!this.city) return;
    this.drawDistance = drawDistance;
    const { detail, cull } = lodDistances(drawDistance);
    for (const lod of this.city.chunks) {
      lod.levels[1].distance = detail;
      lod.levels[2].distance = cull;
    }
  }

  private placeLights(x: number, z: number): void {
    if (!this.city) return;
    const dx = x - this.focusX;
    const dz = z - this.focusZ;
    if (dx * dx + dz * dz < RELIGHT_DISTANCE * RELIGHT_DISTANCE) return;
    this.focusX = x;
    this.focusZ = z;
    const indices = this.nearest.find(this.lampX, this.lampZ, x, z);
    const cutoff = this.nearest.distance(DYNAMIC_LIGHT_COUNT);
    for (let i = 0; i < this.city.lights.length; i++) {
      const light = this.city.lights[i];
      const lamp = indices[i];
      if (lamp < 0) {
        light.intensity = 0;
        continue;
      }
      light.position.set(this.lampX[lamp], LIGHT_HEIGHT, this.lampZ[lamp]);
      light.color.copy(this.lampColours[lamp]);
      light.intensity = LIGHT_INTENSITY * lampHandoverWeight(this.nearest.distance(i), cutoff, HANDOVER_BAND);
    }
  }
}
