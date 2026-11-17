import * as T from 'three';
import type { FrameContext } from './types';

/** Returns the distance to the first obstruction along a unit `direction`, or null if clear. */
export type CameraObstruction = (origin: T.Vector3, direction: T.Vector3, maxDistance: number) => number | null;

const BASE_FOV = 60;
const MIN_PITCH = -0.25;
const MAX_PITCH = 0.75;

/** Third-person chase camera, on-foot orbit camera and first-person view. */
export class CameraRig {
  yaw = Math.PI;
  pitch = 0.22;
  private readonly target = new T.Vector3();
  private readonly forward = new T.Vector3();
  private readonly desired = new T.Vector3();
  private readonly offset = new T.Vector3();
  private readonly look = new T.Vector3();

  constructor(private readonly camera: T.PerspectiveCamera) {}

  /** Applies mouse or stick look. On foot the yaw turns the player; driving it is ignored. */
  applyLook(yawDelta: number, pitchDelta: number, driving: boolean): void {
    if (!driving) this.yaw += yawDelta;
    this.pitch = T.MathUtils.clamp(this.pitch + pitchDelta, MIN_PITCH, MAX_PITCH);
  }

  resetYaw(): void {
    this.yaw = Math.PI;
  }

  update(dt: number, frame: FrameContext, lookBehind: boolean, obstruction: CameraObstruction): void {
    const { driving } = frame;
    const anchor = driving ? frame.car.position : frame.player.position;
    const target = this.target.copy(anchor);
    target.y += driving ? 0.8 : 0.6;

    const forward = this.forward;
    if (driving) forward.set(0, 0, 1).applyQuaternion(frame.car.quaternion);
    else forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    forward.y = 0;
    forward.normalize();

    if (!driving && frame.firstPerson) {
      this.camera.position.copy(target);
      this.look.copy(target).addScaledVector(forward, 10);
      this.look.y -= this.pitch * 10;
      this.camera.lookAt(this.look);
      return;
    }

    const speed = frame.vehicle.speed;
    const distance = driving ? 7 + Math.min(speed * 0.07, 2.5) : 4.5;
    const back = lookBehind && driving ? -1 : 1;
    const desired = this.desired.copy(target).addScaledVector(forward, -distance * back);
    desired.y += driving ? 3.1 : 1.4 + this.pitch * 3;

    const direction = this.offset.copy(desired).sub(target);
    const length = direction.length();
    direction.normalize();
    const hit = obstruction(target, direction, length);
    if (hit !== null) desired.copy(target).addScaledVector(direction, Math.max(0.3, hit - 0.35));

    const follow = hit !== null ? 1 : 1 - Math.exp(-dt * (frame.lowMotion ? 12 : 7));
    this.camera.position.lerp(desired, follow);
    this.camera.lookAt(this.look.copy(target).addScaledVector(forward, driving ? 3 : 1));

    const fov = driving && !frame.lowMotion ? BASE_FOV + Math.min(10, speed * 0.25) : BASE_FOV;
    this.camera.fov = T.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-dt * 3));
    this.camera.updateProjectionMatrix();
  }
}
