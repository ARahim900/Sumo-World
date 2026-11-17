import * as T from 'three';

/** A fictional sign: text and neon colour. */
export interface SignSpec {
  text: string;
  colour: string;
}

/**
 * Every sign in the district, packed into one atlas so all billboards share a single draw call.
 * The first BUILDING_SIGN_CELLS entries hang on towers; the last is the mission terminal.
 */
export const SIGNS: readonly SignSpec[] = [
  { text: 'SUMO', colour: '#61eaf4' },
  { text: 'NOVA', colour: '#ff59b6' },
  { text: 'AFTERHOURS', colour: '#61eaf4' },
  { text: 'NEON MARKET', colour: '#ff59b6' },
  { text: 'ORBIT', colour: '#61eaf4' },
  { text: 'NIGHT CITY', colour: '#ff59b6' },
  { text: 'HIKARI NOODLE', colour: '#ffd36b' },
  { text: 'TRANSIT TERMINAL', colour: '#64ffcf' },
];

/** Atlas cell of the mission terminal sign. */
export const TERMINAL_SIGN_CELL = SIGNS.length - 1;

const SIGN_WIDTH = 512;
const SIGN_HEIGHT = 128;

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable for city textures.');
  return [canvas, ctx];
}

function drawSign(ctx: CanvasRenderingContext2D, sign: SignSpec, top: number): void {
  ctx.fillStyle = '#090d18';
  ctx.fillRect(0, top, SIGN_WIDTH, SIGN_HEIGHT);
  ctx.strokeStyle = sign.colour;
  ctx.lineWidth = 3;
  ctx.strokeRect(5, top + 5, SIGN_WIDTH - 10, SIGN_HEIGHT - 10);
  const size = sign.text.length > 12 ? 44 : 54;
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = sign.colour;
  ctx.fillText(sign.text, SIGN_WIDTH / 2, top + SIGN_HEIGHT / 2 + 2, SIGN_WIDTH - 40);
}

/** Fictional neon sign rendered to its own canvas texture. */
export function signMaterial(text: string, color: string): T.MeshBasicMaterial {
  const [canvas, ctx] = canvas2d(SIGN_WIDTH, SIGN_HEIGHT);
  drawSign(ctx, { text, colour: color }, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map: texture, toneMapped: false });
}

export interface SignAtlas {
  material: T.MeshBasicMaterial;
  /** UV rectangle [u0, v0, u1, v1] of an atlas cell. */
  cell(index: number): [number, number, number, number];
}

/** All signs stacked vertically in one texture. */
export function signAtlas(): SignAtlas {
  const rows = SIGNS.length;
  const [canvas, ctx] = canvas2d(SIGN_WIDTH, SIGN_HEIGHT * rows);
  SIGNS.forEach((sign, row) => drawSign(ctx, sign, row * SIGN_HEIGHT));
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new T.MeshBasicMaterial({ map: texture, toneMapped: false });
  // A half-texel inset stops neighbouring cells bleeding in through filtering.
  const inset = 0.5 / (SIGN_HEIGHT * rows);
  return {
    material,
    cell(index) {
      const v1 = 1 - index / rows - inset;
      const v0 = 1 - (index + 1) / rows + inset;
      return [0, v0, 1, v1];
    },
  };
}

/** Speckled grey noise used as asphalt roughness and bump. */
export function asphaltTexture(): T.CanvasTexture {
  const [canvas, ctx] = canvas2d(256, 256);
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

/** Soft radial falloff for the baked lamp light pools. */
export function lightPoolTexture(): T.CanvasTexture {
  const [canvas, ctx] = canvas2d(128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.25, '#ffffffa0');
  gradient.addColorStop(0.6, '#ffffff30');
  gradient.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new T.CanvasTexture(canvas);
}
