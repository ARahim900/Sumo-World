import * as T from 'three';
import { disposeTree } from '../core/dispose';
import { moonDirection } from './lighting';

const DOME_RADIUS = 80;
const PANEL_COUNT = 30;
const ENVIRONMENT_SEED = 0x5eed;
/** PMREM blur; matches the prototype's RoomEnvironment setting. */
const ENVIRONMENT_SIGMA = 0.04;

const SKY_ZENITH = '#03060f';
const SKY_HORIZON = '#1a1f3c';
const CITY_GLOW = '#3d2042';
const GROUND = '#05070b';

interface PanelStyle {
  colour: string;
  /** Linear HDR multiplier; values above 1 survive in the half-float PMREM target. */
  intensity: number;
}

const PANEL_STYLES: readonly PanelStyle[] = [
  { colour: '#ff3d9a', intensity: 5 },
  { colour: '#33e6ff', intensity: 5 },
  { colour: '#ffb46b', intensity: 2.5 },
  { colour: '#8a5cff', intensity: 4 },
  { colour: '#cfe3ff', intensity: 3 },
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Night sky dome: deep blue zenith, a violet sodium glow on the horizon, dark ground below. */
function createSkyDome(): T.Mesh {
  const geometry = new T.SphereGeometry(DOME_RADIUS, 48, 24);
  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const zenith = new T.Color(SKY_ZENITH);
  const horizon = new T.Color(SKY_HORIZON);
  const glow = new T.Color(CITY_GLOW);
  const ground = new T.Color(GROUND);
  const colour = new T.Color();

  for (let i = 0; i < position.count; i++) {
    const height = position.getY(i) / DOME_RADIUS;
    if (height >= 0) {
      colour
        .copy(glow)
        .lerp(horizon, smoothstep(0, 0.15, height))
        .lerp(zenith, smoothstep(0.15, 0.75, height));
    } else {
      colour.copy(glow).lerp(ground, smoothstep(-0.2, 0, -height));
    }
    colour.toArray(colours, i * 3);
  }

  geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
  return new T.Mesh(geometry, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide }));
}

/** Emissive signs and window strips scattered around the probe, like a street canyon. */
function createPanels(): T.Group {
  const group = new T.Group();
  const geometry = new T.PlaneGeometry(1, 1);
  const random = seededRandom(ENVIRONMENT_SEED);
  const materials = PANEL_STYLES.map(style => {
    const colour = new T.Color(style.colour).multiplyScalar(style.intensity);
    return new T.MeshBasicMaterial({ color: colour, side: T.DoubleSide });
  });

  for (let i = 0; i < PANEL_COUNT; i++) {
    const angle = (i / PANEL_COUNT) * Math.PI * 2 + random() * 0.3;
    const radius = 18 + random() * 16;
    const height = 1 + random() * 16;
    const panel = new T.Mesh(geometry, materials[Math.floor(random() * materials.length)]);
    panel.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    panel.lookAt(0, height, 0);
    const tall = random() < 0.4;
    panel.scale.set(tall ? 0.6 + random() : 2 + random() * 5, tall ? 3 + random() * 6 : 0.4 + random(), 1);
    group.add(panel);
  }
  return group;
}

function createMoon(): T.Mesh {
  const colour = new T.Color('#bad6ff').multiplyScalar(8);
  const moon = new T.Mesh(new T.SphereGeometry(2.5, 16, 8), new T.MeshBasicMaterial({ color: colour }));
  moonDirection(moon.position).multiplyScalar(DOME_RADIUS * 0.85);
  return moon;
}

/**
 * Renders a small procedural night-city scene into a prefiltered (PMREM) environment map.
 * Built from scratch at start-up, so it needs no external HDRI asset.
 */
export function createNightEnvironment(renderer: T.WebGLRenderer): T.WebGLRenderTarget {
  const scene = new T.Scene();
  scene.add(createSkyDome(), createPanels(), createMoon());
  const pmrem = new T.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, ENVIRONMENT_SIGMA, 0.1, DOME_RADIUS * 1.5);
  pmrem.dispose();
  disposeTree(scene);
  return target;
}
