import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { disposeTree } from '../core/dispose';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';

const PLAYER_COLOUR = '#60f7ed';
const CROWD_COLOURS = ['#53e1dc', '#f067c1'];
const CROWD_SIZE = 18;
const CROWD_WALK_SPEED = 0.7;
const CROWD_LIMIT = 178;
const CROWD_HEIGHT = 0.95;
const CLOTH = '#192233';
const SKIN = '#b59688';
const ACCENT_BRIGHTNESS = 0.7;
/** Hip pivot of each leg relative to the figure's origin. */
const HIPS: readonly (readonly [number, number, number])[] = [
  [-0.12, -0.125, 0],
  [0.12, -0.125, 0],
];

function tinted(geometry: T.BufferGeometry, colour: string): T.BufferGeometry {
  const c = new T.Color(colour);
  const count = geometry.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
  return geometry;
}

/** Geometry and materials shared by the player and every pedestrian. */
export interface PersonKit {
  /** Torso, head and arms merged, coloured per vertex. */
  body: T.BufferGeometry;
  /** Leg capsule with its top at the origin, so it swings from the hip. */
  leg: T.BufferGeometry;
  /** Chest stripe. */
  accent: T.BufferGeometry;
  bodyMaterial: T.MeshStandardMaterial;
  legMaterial: T.MeshStandardMaterial;
}

function createPersonKit(): PersonKit {
  const body = mergeGeometries([
    tinted(new T.CapsuleGeometry(0.22, 0.42, 4, 8).translate(0, 0.18, 0), CLOTH),
    tinted(new T.SphereGeometry(0.17, 12, 10).translate(0, 0.72, 0), SKIN),
    tinted(new T.CapsuleGeometry(0.065, 0.4, 3, 6).translate(-0.29, 0.12, 0), CLOTH),
    tinted(new T.CapsuleGeometry(0.065, 0.4, 3, 6).translate(0.29, 0.12, 0), CLOTH),
  ]);
  if (!body) throw new Error('Pedestrian body geometry could not be merged.');
  return {
    body,
    leg: new T.CapsuleGeometry(0.08, 0.45, 3, 6).translate(0, -0.305, 0),
    accent: new T.BoxGeometry(0.36, 0.035, 0.035).translate(0, 0.48, 0.205),
    bodyMaterial: new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 }),
    legMaterial: new T.MeshStandardMaterial({ color: CLOTH, roughness: 0.5, metalness: 0.1 }),
  };
}

function accentColour(colour: string): T.Color {
  return new T.Color(colour).multiplyScalar(ACCENT_BRIGHTNESS);
}

export interface Person {
  group: T.Group;
  /** Hip pivots; rotate around X to swing the legs. */
  legs: T.Object3D[];
}

/** Original stylised figure used for the player (four draw calls). */
export function person(color = '#cfbbce', kit: PersonKit = createPersonKit()): Person {
  const group = new T.Group();
  group.add(new T.Mesh(kit.body, kit.bodyMaterial));
  group.add(new T.Mesh(kit.accent, new T.MeshBasicMaterial({ color: accentColour(color) })));
  const legs: T.Object3D[] = HIPS.map(hip => {
    const leg = new T.Mesh(kit.leg, kit.legMaterial);
    leg.position.set(hip[0], hip[1], hip[2]);
    group.add(leg);
    return leg;
  });
  return { group, legs };
}

function swing(time: number, rate: number, amplitude: number, leg: number): number {
  return Math.sin(time * rate + leg * Math.PI) * amplitude;
}

/**
 * The ambient pavement crowd drawn with three instanced meshes (bodies, chest stripes, legs),
 * whatever the crowd size.
 */
class Crowd {
  readonly root = new T.Group();
  private readonly bodies: T.InstancedMesh;
  private readonly accents: T.InstancedMesh;
  private readonly legs: T.InstancedMesh;
  private readonly z = new Float32Array(CROWD_SIZE);
  private readonly figure = new T.Matrix4();
  private readonly limb = new T.Matrix4();
  private readonly hip = new T.Matrix4();
  private readonly rotation = new T.Matrix4();

  constructor(kit: PersonKit) {
    this.bodies = new T.InstancedMesh(kit.body, kit.bodyMaterial, CROWD_SIZE);
    this.accents = new T.InstancedMesh(kit.accent, new T.MeshBasicMaterial(), CROWD_SIZE);
    this.legs = new T.InstancedMesh(kit.leg, kit.legMaterial, CROWD_SIZE * 2);
    const colour = new T.Color();
    for (let i = 0; i < CROWD_SIZE; i++) {
      this.z[i] = -155 + i * 18;
      this.accents.setColorAt(i, colour.copy(accentColour(CROWD_COLOURS[i % 2])));
    }
    for (const mesh of [this.bodies, this.accents, this.legs]) {
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      // The crowd spans the whole avenue and moves every frame, so one bounding sphere is useless.
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    this.pose(0);
  }

  update(dt: number, time: number): void {
    for (let i = 0; i < CROWD_SIZE; i++) {
      this.z[i] += (i % 2 ? 1 : -1) * dt * CROWD_WALK_SPEED;
      if (Math.abs(this.z[i]) > CROWD_LIMIT) this.z[i] *= -0.98;
    }
    this.pose(time);
  }

  private pose(time: number): void {
    for (let i = 0; i < CROWD_SIZE; i++) {
      const facing = i % 2 ? 0 : Math.PI;
      this.figure.makeRotationY(facing).setPosition(i % 2 ? 10.7 : -10.7, CROWD_HEIGHT, this.z[i]);
      this.bodies.setMatrixAt(i, this.figure);
      this.accents.setMatrixAt(i, this.figure);
      for (let leg = 0; leg < HIPS.length; leg++) {
        const [hx, hy, hz] = HIPS[leg];
        this.hip.makeTranslation(hx, hy, hz);
        this.rotation.makeRotationX(swing(time, 5, 0.35, leg));
        this.limb.multiplyMatrices(this.figure, this.hip).multiply(this.rotation);
        this.legs.setMatrixAt(i * 2 + leg, this.limb);
      }
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.accents.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.bodies.dispose();
    this.accents.dispose();
    this.legs.dispose();
  }
}

/** The on-foot player avatar and the ambient pavement crowd. */
export class PeopleSystem implements GameSystem {
  readonly name = 'people';
  private readonly root = new T.Group();
  private readonly kit = createPersonKit();
  private readonly player = person(PLAYER_COLOUR, this.kit);
  private readonly crowd = new Crowd(this.kit);
  private scene?: T.Scene;

  init(context: SystemInitContext): void {
    this.root.name = 'people';
    this.root.add(this.player.group);
    this.root.add(this.crowd.root);
    this.scene = context.scene;
    context.scene.add(this.root);
  }

  update(dt: number, frame: FrameContext): void {
    const avatar = this.player.group;
    avatar.position.copy(frame.player.position);
    avatar.rotation.y = frame.playerYaw;
    avatar.visible = !frame.driving && !frame.firstPerson;
    if (frame.paused) return;

    this.crowd.update(dt, frame.time);
    const moving = frame.playerMoving;
    for (let leg = 0; leg < this.player.legs.length; leg++) {
      this.player.legs[leg].rotation.x = moving ? swing(frame.time, 8, 0.45, leg) : 0;
    }
  }

  dispose(): void {
    this.scene?.remove(this.root);
    this.crowd.dispose();
    disposeTree(this.root);
  }
}
