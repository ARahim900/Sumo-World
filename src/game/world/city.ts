import * as T from 'three';
import { blocks, DESTINATION } from '../content';
import { disposeTree } from '../core/dispose';
import { box, glow, surface } from '../core/primitives';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';

const SIGN_NAMES = ['SUMO', 'NOVA', 'AFTERHOURS', 'NEON MARKET', 'ORBIT', 'NIGHT CITY'];

/** Fictional neon sign rendered to a canvas texture. */
export function signMaterial(text: string, color: string): T.MeshBasicMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable for sign textures.');
  ctx.fillStyle = '#090d18';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, 502, 118);
  ctx.font = 'bold 54px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 66);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map: texture, toneMapped: false });
}

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable for city textures.');
  return [canvas, ctx];
}

function asphaltTexture(): T.CanvasTexture {
  const [canvas, ctx] = canvas2d(256);
  const image = ctx.createImageData(256, 256);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 70 + Math.random() * 80;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(160, 160);
  return texture;
}

function lightPoolTexture(): T.CanvasTexture {
  const [canvas, ctx] = canvas2d(128);
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.3, '#ffffff70');
  gradient.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new T.CanvasTexture(canvas);
}

export interface City {
  root: T.Group;
  /** Destination ring and light beam. */
  marker: T.Group;
  /** Cyan arrows from the garage to the terminal. */
  route: T.Group;
}

/** Builds the district: roads, pavements, towers, signs, street lights and mission markers. */
export async function createCity(): Promise<City> {
  const root = new T.Group();
  root.name = 'city';

  const texture = await new T.TextureLoader().loadAsync('/assets/facade.png');
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = T.RepeatWrapping;
  texture.wrapT = T.RepeatWrapping;
  texture.anisotropy = 4;
  const facade = new T.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: '#87bed4',
    emissiveIntensity: 0.38,
    roughness: 0.7,
    metalness: 0.2,
  });
  const pavement = surface('#242b3a', 0.6);
  const graphite = surface('#111827', 0.4, 0.5);
  const cyan = glow('#23dce8');
  const pink = glow('#ef3fa3');

  const asphalt = asphaltTexture();
  const roadMaterial = new T.MeshStandardMaterial({
    color: '#101722',
    roughness: 0.28,
    metalness: 0.3,
    roughnessMap: asphalt,
    bumpMap: asphalt,
    bumpScale: 0.025,
    envMapIntensity: 0.15,
  });
  const road = box(root, [400, 0.1, 400], [0, -0.06, 0], roadMaterial);
  road.receiveShadow = true;

  for (let x = -150; x <= 150; x += 60) {
    for (let z = -150; z <= 150; z += 60) {
      box(root, [44, 0.16, 44], [x, 0.02, z], pavement);
      for (const s of [-1, 1]) {
        box(root, [44, 0.035, 0.12], [x, 0.115, z + s * 22], s > 0 ? cyan : pink);
        box(root, [0.12, 0.035, 44], [x + s * 22, 0.115, z], s > 0 ? pink : cyan);
      }
    }
  }

  const facades = [1, 2, 3, 4].map(repeat => {
    const map = texture.clone();
    map.repeat.set(1, repeat);
    map.needsUpdate = true;
    const material = facade.clone();
    material.map = map;
    material.emissiveMap = map;
    return material;
  });
  const signs = SIGN_NAMES.map((name, i) => signMaterial(name, i % 2 ? '#ff59b6' : '#61eaf4'));

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const tower = box(root, [b.w, b.h, b.d], [b.x, b.h / 2 + 0.1, b.z], facades[Math.min(3, Math.floor(b.h / 20))]);
    tower.castShadow = true;
    tower.receiveShadow = true;
    box(root, [b.w + 0.3, 0.3, b.d + 0.3], [b.x, b.h + 0.1, b.z], graphite);

    const neon = b.style % 2 ? pink : cyan;
    box(root, [0.12, b.h, 0.12], [b.x - b.w / 2 - 0.03, b.h / 2, b.z + b.d / 2], neon);
    if (i % 3 === 0) {
      box(root, [b.w + 0.2, 0.18, b.d + 0.2], [b.x, b.h * 0.75, b.z], neon);
      const billboard = new T.Mesh(new T.PlaneGeometry(8, 2), signs[i % signs.length]);
      billboard.position.set(b.x, 5.5, b.z + b.d / 2 + 0.03);
      root.add(billboard);
    }
    if (i % 4 === 0) {
      box(root, [4, 2, 4], [b.x, b.h + 1, b.z], graphite);
      box(root, [0.09, 8, 0.09], [b.x, b.h + 5, b.z], graphite);
      box(root, [0.2, 0.3, 0.2], [b.x, b.h + 9, b.z], pink);
    }
  }

  const stripe = new T.MeshBasicMaterial({ color: '#9bafbb' });
  for (let lane = -180; lane <= 180; lane += 60) {
    for (let at = -192; at < 198; at += 9) {
      if (Math.abs(at % 60) < 9) continue;
      box(root, [0.12, 0.012, 3], [lane, 0.015, at], stripe);
      box(root, [3, 0.012, 0.12], [at, 0.015, lane], stripe);
    }
  }
  for (let lane = -180; lane <= 180; lane += 60) {
    for (let at = -180; at <= 180; at += 60) {
      for (let i = -5; i <= 5; i++) {
        box(root, [0.55, 0.015, 2.7], [lane + i * 1.1, 0.02, at + 10], stripe);
        box(root, [2.7, 0.015, 0.55], [lane + 10, 0.02, at + i * 1.1], stripe);
      }
    }
  }

  const pole = surface('#323c50', 0.4, 0.7);
  const lamp = glow('#bddde7', 4);
  for (let z = -180; z <= 180; z += 24) {
    for (const x of [-9, 9]) {
      const inward = Math.sign(x);
      box(root, [0.12, 6, 0.12], [x, 3, z], pole);
      box(root, [1.8, 0.12, 0.16], [x - inward * 0.8, 6, z], pole);
      box(root, [1, 0.06, 0.3], [x - inward, 5.93, z], lamp);
      if (Math.abs(z) < 90) {
        const light = new T.PointLight(x < 0 ? '#29c6e2' : '#e0469a', 24, 19, 1.6);
        light.position.set(x, 5.3, z);
        root.add(light);
      }
      box(root, [0.7, 0.7, 1.2], [x + inward * 1.5, 0.42, z + 3], graphite);
    }
  }

  const poolTexture = lightPoolTexture();
  for (let i = 0; i < 64; i++) {
    const z = -192 + i * 6;
    const x = i % 2 ? 6.5 : -6.5;
    const material = new T.MeshBasicMaterial({
      map: poolTexture,
      color: i % 2 ? '#e845a9' : '#18cbe5',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    const pool = new T.Mesh(new T.PlaneGeometry(5, 9), material);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.022, z);
    root.add(pool);
  }

  for (const s of [-1, 1]) {
    box(root, [1.5, 2.2, 400], [s * 199, 1, 0], graphite);
    box(root, [400, 2.2, 1.5], [0, 1, s * 199], graphite);
  }

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
  root.add(marker);

  const terminal = new T.Mesh(new T.PlaneGeometry(10, 2.5), signMaterial('TRANSIT TERMINAL', '#64ffcf'));
  terminal.position.set(4, 7, -113);
  root.add(terminal);
  for (const x of [-3, 11]) box(root, [0.22, 7, 0.22], [x, 3.5, -113], cyan);

  const route = new T.Group();
  root.add(route);
  for (let z = 14; z > -100; z -= 9) {
    const arrow = new T.Shape();
    arrow.moveTo(-0.5, 0);
    arrow.lineTo(0, -0.8);
    arrow.lineTo(0.5, 0);
    arrow.lineTo(0.25, 0);
    arrow.lineTo(0, -0.4);
    arrow.lineTo(-0.25, 0);
    arrow.closePath();
    const mesh = new T.Mesh(
      new T.ShapeGeometry(arrow),
      new T.MeshBasicMaterial({
        color: '#46ece6',
        transparent: true,
        opacity: 0.65,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(4, 0.035, z);
    route.add(mesh);
  }

  return { root, marker, route };
}

/** Adds the city to the scene and keeps mission markers in step with progress. */
export class CitySystem implements GameSystem {
  readonly name = 'city';
  private city?: City;
  private scene?: T.Scene;

  async init(context: SystemInitContext): Promise<void> {
    this.city = await createCity();
    this.scene = context.scene;
    context.scene.add(this.city.root);
  }

  update(_dt: number, frame: FrameContext): void {
    if (!this.city) return;
    this.city.route.visible = frame.mission === 'drive';
    this.city.marker.visible = frame.mission !== 'complete';
  }

  dispose(): void {
    if (!this.city) return;
    this.scene?.remove(this.city.root);
    disposeTree(this.city.root);
    this.city = undefined;
  }
}
