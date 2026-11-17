import * as T from 'three';
import { disposeTree } from '../core/dispose';
import { box, glow, surface } from '../core/primitives';
import type { FrameContext, GameSystem, SystemInitContext } from '../core/types';

export interface Person {
  group: T.Group;
  legs: T.Mesh[];
}

const PLAYER_COLOUR = '#60f7ed';
const CROWD_SIZE = 18;
const CROWD_WALK_SPEED = 0.7;
const CROWD_LIMIT = 178;

/** Original stylised figure used for the player and ambient pedestrians. */
export function person(color = '#cfbbce'): Person {
  const group = new T.Group();
  const cloth = surface('#192233');
  const accent = glow(color, 0.25);

  const torso = new T.Mesh(new T.CapsuleGeometry(0.22, 0.42, 4, 8), cloth);
  torso.position.y = 0.18;
  group.add(torso);
  const head = new T.Mesh(new T.SphereGeometry(0.17, 12, 10), surface('#b59688'));
  head.position.y = 0.72;
  group.add(head);
  box(group, [0.36, 0.035, 0.035], [0, 0.48, 0.205], accent);

  const legs: T.Mesh[] = [];
  for (const side of [-1, 1]) {
    const leg = new T.Mesh(new T.CapsuleGeometry(0.08, 0.45, 3, 6), cloth);
    leg.position.set(side * 0.12, -0.43, 0);
    group.add(leg);
    legs.push(leg);
    const arm = new T.Mesh(new T.CapsuleGeometry(0.065, 0.4, 3, 6), cloth);
    arm.position.set(side * 0.29, 0.12, 0);
    group.add(arm);
  }
  return { group, legs };
}

function swingLegs(legs: readonly T.Mesh[], time: number, rate: number, amplitude: number): void {
  for (let j = 0; j < legs.length; j++) {
    legs[j].rotation.x = Math.sin(time * rate + j * Math.PI) * amplitude;
  }
}

/** The on-foot player avatar and the ambient pavement crowd. */
export class PeopleSystem implements GameSystem {
  readonly name = 'people';
  private readonly root = new T.Group();
  private readonly player = person(PLAYER_COLOUR);
  private readonly crowd: Person[] = [];
  private scene?: T.Scene;

  init(context: SystemInitContext): void {
    this.root.name = 'people';
    this.root.add(this.player.group);
    for (let i = 0; i < CROWD_SIZE; i++) {
      const npc = person(i % 2 ? '#f067c1' : '#53e1dc');
      npc.group.position.set(i % 2 ? 10.7 : -10.7, 0.95, -155 + i * 18);
      this.root.add(npc.group);
      this.crowd.push(npc);
    }
    this.scene = context.scene;
    context.scene.add(this.root);
  }

  update(dt: number, frame: FrameContext): void {
    const avatar = this.player.group;
    avatar.position.copy(frame.player.position);
    avatar.rotation.y = frame.playerYaw;
    avatar.visible = !frame.driving && !frame.firstPerson;
    if (frame.paused) return;

    for (let i = 0; i < this.crowd.length; i++) {
      const npc = this.crowd[i];
      const direction = i % 2 ? 1 : -1;
      npc.group.position.z += direction * dt * CROWD_WALK_SPEED;
      if (Math.abs(npc.group.position.z) > CROWD_LIMIT) npc.group.position.z *= -0.98;
      npc.group.rotation.y = i % 2 ? 0 : Math.PI;
      swingLegs(npc.legs, frame.time, 5, 0.35);
    }

    if (frame.playerMoving) swingLegs(this.player.legs, frame.time, 8, 0.45);
    else for (const leg of this.player.legs) leg.rotation.x = 0;
  }

  dispose(): void {
    this.scene?.remove(this.root);
    disposeTree(this.root);
    this.crowd.length = 0;
  }
}
