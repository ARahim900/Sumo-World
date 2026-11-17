import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { blocks, SPAWN, STEP, arrivalEligible, type Intent, type Mission } from './content';
import type { VehicleTelemetry, WheelState } from './core/types';

/** Grip used until the weather system supplies one; matches the default drizzle weather. */
export const DEFAULT_GRIP = 0.88;

const PLAYER_START = { x: 7, y: 1, z: 24 };
const SUSPENSION_REST = 0.32;
const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const RIGHT = new Vector3(-1, 0, 0);

const scratchMove = new Vector3();
const scratchVelocity = new Vector3();
const scratchForward = new Vector3();
const scratchSide = new Vector3();
const scratchOffset = new Vector3();
const scratchSpin = new Vector3();
const scratchRotation = new Quaternion();
const scratchSteer = new Quaternion();

export class Simulation {
  world: RAPIER.World;
  car: RAPIER.RigidBody;
  player: RAPIER.RigidBody;
  capsule: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  driving = false;
  mission: Mission = 'enter';
  hold = 0;
  yaw = Math.PI;
  vertical = 0;
  steering = 0;
  speed = 0;
  signedSpeed = 0;
  throttle = 0;
  brake = 0;
  handbrake = false;
  grounded = false;
  notice = '';
  noticeTime = 0;
  distanceDriven = 0;
  time = 0;
  brakeHeld = false;
  brakeToStop = false;
  wheelAnchors = [
    new Vector3(-0.89, 0.02, 1.42),
    new Vector3(0.89, 0.02, 1.42),
    new Vector3(-0.89, 0.02, -1.38),
    new Vector3(0.89, 0.02, -1.38),
  ];
  private grip = DEFAULT_GRIP;

  static async create() {
    await RAPIER.init();
    return new Simulation();
  }

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.solid(0, -0.3, 0, 410, 0.6, 410);
    for (const b of blocks) this.solid(b.x, b.h / 2, b.z, b.w, b.h, b.d);
    for (const s of [-1, 1]) {
      this.solid(s * 199, 2, 0, 2, 4, 400);
      this.solid(0, 2, s * 199, 400, 4, 2);
    }

    this.car = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(SPAWN.x, SPAWN.y, SPAWN.z)
        .setRotation({ x: 0, y: 1, z: 0, w: 0 })
        .setLinearDamping(0.12)
        .setAngularDamping(0.5)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.92, 0.25, 2.04).setMass(1100).setFriction(0.5).setRestitution(0.02),
      this.car,
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.7, 0.23, 0.86).setTranslation(0, 0.43, -0.15).setMass(100),
      this.car,
    );

    this.vehicle = this.world.createVehicleController(this.car);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;
    for (const anchor of this.wheelAnchors) {
      this.vehicle.addWheel(anchor, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION_REST, 0.36);
    }
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelSuspensionStiffness(i, 38);
      this.vehicle.setWheelSuspensionCompression(i, 4.4);
      this.vehicle.setWheelSuspensionRelaxation(i, 4.8);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.22);
      this.vehicle.setWheelMaxSuspensionForce(i, 18000);
      this.vehicle.setWheelFrictionSlip(i, 3.5);
      this.vehicle.setWheelSideFrictionStiffness(i, 1.7);
    }

    this.player = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(PLAYER_START.x, PLAYER_START.y, PLAYER_START.z),
    );
    this.capsule = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.52, 0.3), this.player);
    this.controller = this.world.createCharacterController(0.025);
    this.controller.enableAutostep(0.3, 0.2, true);
    this.controller.enableSnapToGround(0.25);
    this.controller.setMaxSlopeClimbAngle(0.65);
    this.controller.setMinSlopeSlideAngle(0.7);
  }

  solid(x: number, y: number, z: number, w: number, h: number, d: number) {
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z).setFriction(0.8),
    );
  }

  /** Tyre grip multiplier from the weather system (1 = dry). */
  setGripFactor(grip: number) {
    this.grip = grip;
  }

  get gripFactor() {
    return this.grip;
  }

  carPoint(x: number, y: number, z: number) {
    return new Vector3(x, y, z)
      .applyQuaternion(scratchRotation.copy(this.car.rotation()))
      .add(this.car.translation());
  }

  entryPoint() {
    return this.carPoint(-1.5, 0, 0);
  }

  canEnter() {
    if (this.driving || this.speed > 1) return false;
    const p = new Vector3().copy(this.player.translation());
    const door = this.entryPoint();
    if (p.distanceTo(door) > 2) return false;
    const delta = door.clone().sub(p);
    const length = delta.length();
    if (length < 0.01) return true;
    const ray = new RAPIER.Ray(p, delta.normalize());
    return !this.world.castRay(
      ray,
      length,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.capsule,
      this.car,
    );
  }

  interact() {
    if (!this.driving) {
      if (!this.canEnter()) {
        this.say('Move closer to the driver’s door');
        return false;
      }
      this.driving = true;
      this.player.setEnabled(false);
      this.car.wakeUp();
      if (this.mission === 'enter') this.mission = 'drive';
      this.say('Follow the cyan route to the transit terminal');
      return true;
    }
    if (this.speed > 1) {
      this.say('Stop to exit');
      return false;
    }
    for (const side of [-1, 1]) {
      const p = this.carPoint(side * 1.9, 0.2, 0);
      p.y = 0.88;
      const hit = this.world.intersectionWithShape(
        p,
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Capsule(0.52, 0.3),
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        this.capsule,
      );
      if (hit) continue;
      this.player.setTranslation(p, true);
      this.player.setNextKinematicTranslation(p);
      this.player.setEnabled(true);
      this.vertical = 0;
      this.driving = false;
      this.say('On foot');
      return true;
    }
    this.say('Exit blocked');
    return false;
  }

  say(message: string) {
    this.notice = message;
    this.noticeTime = 3.5;
  }

  recover(restart = false) {
    this.car.setTranslation(SPAWN, true);
    this.car.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
    this.car.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.car.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.car.resetForces(true);
    this.car.resetTorques(true);
    this.hold = 0;
    this.speed = 0;
    this.steering = 0;
    this.brakeHeld = false;
    this.brakeToStop = false;
    if (restart) {
      this.driving = false;
      this.mission = 'enter';
      this.distanceDriven = 0;
      this.player.setEnabled(true);
    }
    this.player.setTranslation(PLAYER_START, true);
    this.player.setNextKinematicTranslation(PLAYER_START);
    this.vertical = 0;
    this.say(restart ? 'A new night. A new drive.' : 'Returned to the garage');
  }

  step(input: Intent) {
    this.time += STEP;
    this.noticeTime = Math.max(0, this.noticeTime - STEP);
    if (!this.driving) this.walk(input);

    const velocity = scratchVelocity.copy(this.car.linvel());
    const forward = scratchForward.copy(FORWARD).applyQuaternion(scratchRotation.copy(this.car.rotation()));
    this.signedSpeed = velocity.dot(forward);
    this.speed = Math.hypot(velocity.x, velocity.z);

    const targetSteer = (this.driving ? input.steer : 0) * Math.max(0.16, 0.48 - this.speed * 0.009);
    this.steering += (targetSteer - this.steering) * (1 - Math.exp(-5 * STEP));

    if (input.brake > 0.05 && !this.brakeHeld) this.brakeToStop = this.signedSpeed > 0.5;
    this.brakeHeld = input.brake > 0.05;
    if (!this.brakeHeld) this.brakeToStop = false;

    this.throttle = this.driving ? input.throttle : 0;
    this.brake = this.driving ? input.brake : 0;
    this.handbrake = this.driving && input.handbrake;

    let force = 0;
    let brake = this.driving ? 0 : 110;
    if (this.driving) {
      if (input.brake > 0.05) {
        if (this.signedSpeed > 0.5 || this.brakeToStop) brake = input.brake * 160;
        else if (this.signedSpeed > -9) force = -input.brake * 1700;
      } else if (input.throttle > 0.05) {
        if (this.signedSpeed < -0.5) brake = input.throttle * 160;
        else force = input.throttle * 2600 * Math.max(0.05, 1 - this.speed / 48);
      } else {
        brake = 2;
      }
    }

    for (let i = 0; i < 4; i++) {
      const rearHandbrake = this.handbrake && i >= 2;
      this.vehicle.setWheelSteering(i, i < 2 ? this.steering : 0);
      this.vehicle.setWheelEngineForce(i, force);
      this.vehicle.setWheelBrake(i, rearHandbrake ? 180 : brake);
      this.vehicle.setWheelFrictionSlip(i, (rearHandbrake ? 1.15 : 3.5) * this.grip);
    }
    this.vehicle.updateVehicle(
      STEP,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      collider => collider.parent()?.handle !== this.car.handle && collider.handle !== this.capsule.handle,
    );
    this.world.step();

    const p = this.car.translation();
    const v = this.car.linvel();
    this.speed = Math.hypot(v.x, v.z);
    if (this.driving) this.distanceDriven += this.speed * STEP;
    if (this.mission === 'drive') {
      const eligible = arrivalEligible(p.x, p.y, p.z, Math.hypot(v.x, v.y, v.z), this.driving);
      this.hold = eligible ? this.hold + STEP : 0;
      if (this.hold >= 1) {
        this.mission = 'complete';
        this.say('Destination reached. The city is yours.');
      }
    }
    if (p.y < -10 || this.player.translation().y < -10) this.recover();
  }

  /** Copies the visual and contact state of one wheel into `out`. */
  readWheel(index: number, out: WheelState) {
    out.anchor.copy(this.wheelAnchors[index]);
    out.suspensionLength = this.vehicle.wheelSuspensionLength(index) ?? SUSPENSION_REST;
    out.rotation = this.vehicle.wheelRotation(index) ?? 0;
    out.steering = index < 2 ? this.steering : 0;
    const point = this.vehicle.wheelIsInContact(index) ? this.vehicle.wheelContactPoint(index) : null;
    out.inContact = point !== null;
    if (point) out.contactPoint.copy(point);
  }

  /**
   * Tangent of the wheel's slip angle: lateral over longitudinal velocity at the hub, with a
   * 1 m/s floor so a stationary car does not report huge slip from numerical jitter.
   */
  wheelSlip(index: number) {
    const rotation = scratchRotation.copy(this.car.rotation());
    const offset = scratchOffset.copy(this.wheelAnchors[index]).applyQuaternion(rotation);
    const spin = scratchSpin.copy(this.car.angvel()).cross(offset);
    const hubVelocity = scratchVelocity.copy(this.car.linvel()).add(spin);
    const steer = scratchSteer.setFromAxisAngle(UP, index < 2 ? this.steering : 0);
    const heading = scratchForward.copy(FORWARD).applyQuaternion(steer).applyQuaternion(rotation);
    const side = scratchSide.copy(RIGHT).applyQuaternion(steer).applyQuaternion(rotation);
    return Math.abs(hubVelocity.dot(side)) / Math.max(1, Math.abs(hubVelocity.dot(heading)));
  }

  /** Fills the physics-owned fields of `out`; rpm and gear come from the drivetrain. */
  readTelemetry(out: VehicleTelemetry) {
    out.speed = this.speed;
    out.signedSpeed = this.signedSpeed;
    out.throttle = this.throttle;
    out.brake = this.brake;
    out.handbrake = this.handbrake;
    for (let i = 0; i < 4; i++) out.slip[i] = this.wheelSlip(i);
  }

  dispose() {
    this.world.free();
  }

  private walk(input: Intent) {
    const move = scratchMove.set(input.moveX, 0, input.moveZ);
    if (move.lengthSq() > 1) move.normalize();
    move.applyAxisAngle(UP, this.yaw).multiplyScalar((input.sprint ? 7 : 3.8) * STEP);
    if (input.jump && this.grounded) this.vertical = 5.2;
    this.vertical -= 9.81 * STEP;
    move.y = this.vertical * STEP;
    this.controller.computeColliderMovement(this.capsule, move);
    const actual = this.controller.computedMovement();
    const p = this.player.translation();
    this.player.setNextKinematicTranslation({ x: p.x + actual.x, y: p.y + actual.y, z: p.z + actual.z });
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.vertical < 0) this.vertical = 0;
  }
}
