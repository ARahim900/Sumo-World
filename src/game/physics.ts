import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { blocks, SPAWN, STEP, arrivalEligible, type Intent, type Mission } from './content';
import type { VehicleTelemetry, WheelState, WheelQuad } from './core/types';
import { Powertrain, REVERSE_SPEED_LIMIT, WHEEL_RADIUS } from './vehicle/drivetrain';
import {
  DOWNFORCE_FRONT_SHARE,
  HANDBRAKE_GRIP,
  HANDBRAKE_LATERAL,
  PARKING_LATERAL_GRIP,
  REAR_LATERAL_BIAS,
  TRACTION_CONTROL_SHARE,
  aeroDrag,
  baseLateralGrip,
  brakeDemand,
  downforce,
  driftAssistShare,
  frictionCircleShare,
  lateralGripShare,
  rollingResistance,
  tractionLimit,
} from './vehicle/forces';

/** Grip used until the weather system supplies one; matches the default drizzle weather. */
export const DEFAULT_GRIP = 0.88;

const PLAYER_START = { x: 7, y: 1, z: 24 };
const SUSPENSION_REST = 0.32;
const PEDAL_DEADZONE = 0.05;
const MOVING_SPEED = 0.5;

/** Brake impulse per wheel and step that holds a parked car, N·s (the original value). */
const PARKING_BRAKE_IMPULSE = 110;
/** Brake force per wheel that stops a car in drive from creeping at rest, N. */
const STANDSTILL_HOLD_FORCE = 600;
const STANDSTILL_SPEED = 0.3;

/** Counter-roll torque per radian of body roll, N·m/rad. */
const ROLL_STIFFNESS = 6000;
/** Counter-roll torque per rad/s of roll rate, N·m·s/rad. */
const ROLL_DAMPING = 600;
/** Yaw damping at full drift assist, N·m·s/rad. */
const DRIFT_ASSIST_DAMPING = 2500;

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const RIGHT = new Vector3(-1, 0, 0);

const scratchMove = new Vector3();
const scratchRotation = new Quaternion();

const slipOffset = new Vector3();
const slipHub = new Vector3();
const slipHeading = new Vector3();
const slipSide = new Vector3();
const slipSteer = new Quaternion();

const readRotation = new Quaternion();
const readVelocity = new Vector3();
const readSpin = new Vector3();

const stepRotation = new Quaternion();
const stepVelocity = new Vector3();
const stepSpin = new Vector3();
const stepForward = new Vector3();
const stepUp = new Vector3();
const stepAxis = new Vector3();
const stepForce = new Vector3();
const stepPoint = new Vector3();
const stepCentre = new Vector3();
const stepSide = new Vector3();

export class Simulation {
  world: RAPIER.World;
  car: RAPIER.RigidBody;
  player: RAPIER.RigidBody;
  capsule: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  readonly powertrain = new Powertrain();
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
  /** Drive demand passed to the powertrain on the last step (throttle, or pedal in reverse). */
  private demand = 0;
  private reverseSelected = false;
  private readonly slips: WheelQuad = [0, 0, 0, 0];
  private readonly rayFilter = (collider: RAPIER.Collider) =>
    collider.parent()?.handle !== this.car.handle && collider.handle !== this.capsule.handle;

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

    // Drag and rolling resistance are modelled explicitly, so the body has no linear damping.
    this.car = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(SPAWN.x, SPAWN.y, SPAWN.z)
        .setRotation({ x: 0, y: 1, z: 0, w: 0 })
        .setLinearDamping(0)
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
      this.vehicle.addWheel(anchor, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION_REST, WHEEL_RADIUS);
    }
    for (let i = 0; i < 4; i++) {
      this.vehicle.setWheelSuspensionStiffness(i, 38);
      this.vehicle.setWheelSuspensionCompression(i, 4.4);
      this.vehicle.setWheelSuspensionRelaxation(i, 4.8);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.22);
      this.vehicle.setWheelMaxSuspensionForce(i, 18000);
      this.vehicle.setWheelFrictionSlip(i, PARKING_LATERAL_GRIP * this.grip);
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
    this.powertrain.reset();
    this.hold = 0;
    this.speed = 0;
    this.steering = 0;
    this.demand = 0;
    this.reverseSelected = false;
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

    const rotation = stepRotation.copy(this.car.rotation());
    const velocity = stepVelocity.copy(this.car.linvel());
    const spin = stepSpin.copy(this.car.angvel());
    const forward = stepForward.copy(FORWARD).applyQuaternion(rotation);
    this.signedSpeed = velocity.dot(forward);
    this.speed = Math.hypot(velocity.x, velocity.z);
    for (let i = 0; i < 4; i++) this.slips[i] = this.slipAt(i, rotation, velocity, spin);

    const targetSteer = (this.driving ? input.steer : 0) * Math.max(0.16, 0.48 - this.speed * 0.009);
    this.steering += (targetSteer - this.steering) * (1 - Math.exp(-5 * STEP));

    if (input.brake > PEDAL_DEADZONE && !this.brakeHeld) this.brakeToStop = this.signedSpeed > MOVING_SPEED;
    this.brakeHeld = input.brake > PEDAL_DEADZONE;
    if (!this.brakeHeld) this.brakeToStop = false;

    this.throttle = this.driving ? input.throttle : 0;
    this.brake = this.driving ? input.brake : 0;
    this.handbrake = this.driving && input.handbrake;

    const servicePedal = this.applyPedals();
    const driveForce = this.powertrain.step(STEP, {
      signedSpeed: this.signedSpeed,
      demand: this.demand,
      reverse: this.reverseSelected,
      braking: servicePedal > PEDAL_DEADZONE && !this.reverseSelected,
    });
    this.applyWheelForces(this.driving ? driveForce : 0, servicePedal);
    this.applyBodyForces(rotation, velocity, spin, forward);

    this.vehicle.updateVehicle(STEP, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.rayFilter);
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

  /** Tangent of the wheel's slip angle for the car's current state; see `slipAt`. */
  wheelSlip(index: number) {
    this.readBodyMotion();
    return this.slipAt(index, readRotation, readVelocity, readSpin);
  }

  /** Fills `out` from the simulated car, including rpm and gear from the powertrain. */
  readTelemetry(out: VehicleTelemetry) {
    out.speed = this.speed;
    out.signedSpeed = this.signedSpeed;
    out.rpm = this.powertrain.rpm;
    out.gear = this.driving ? this.powertrain.telemetryGear(this.signedSpeed, this.demand) : 0;
    out.throttle = this.throttle;
    out.brake = this.brake;
    out.handbrake = this.handbrake;
    this.readBodyMotion();
    for (let i = 0; i < 4; i++) out.slip[i] = this.slipAt(i, readRotation, readVelocity, readSpin);
  }

  dispose() {
    this.world.free();
  }

  /** Copies the body's rotation, linear and angular velocity into the read scratch objects. */
  private readBodyMotion() {
    readRotation.copy(this.car.rotation());
    readVelocity.copy(this.car.linvel());
    readSpin.copy(this.car.angvel());
  }

  /**
   * Tangent of the wheel's slip angle: lateral over longitudinal velocity at the hub, with a
   * 1 m/s floor so a stationary car does not report huge slip from numerical jitter.
   */
  private slipAt(index: number, rotation: Quaternion, velocity: Vector3, spin: Vector3) {
    const offset = slipOffset.copy(this.wheelAnchors[index]).applyQuaternion(rotation);
    const hubVelocity = slipHub.copy(spin).cross(offset).add(velocity);
    const steer = slipSteer.setFromAxisAngle(UP, index < 2 ? this.steering : 0);
    const heading = slipHeading.copy(FORWARD).applyQuaternion(steer).applyQuaternion(rotation);
    const side = slipSide.copy(RIGHT).applyQuaternion(steer).applyQuaternion(rotation);
    return Math.abs(hubVelocity.dot(side)) / Math.max(1, Math.abs(hubVelocity.dot(heading)));
  }

  /**
   * Maps the pedals to drive demand and service brake, and selects reverse: a fresh brake
   * press at rest drives backwards, and throttle while rolling backwards brakes first.
   * Returns the service-brake pedal (0..1) and stores the drive demand.
   */
  private applyPedals(): number {
    this.demand = 0;
    if (!this.driving) return 0;
    if (this.brake > PEDAL_DEADZONE) {
      if (this.signedSpeed > MOVING_SPEED || this.brakeToStop) {
        this.reverseSelected = false;
        return this.brake;
      }
      if (this.signedSpeed > -REVERSE_SPEED_LIMIT) {
        this.reverseSelected = true;
        this.demand = this.brake;
      }
      return 0;
    }
    if (this.throttle > PEDAL_DEADZONE) {
      if (this.signedSpeed < -MOVING_SPEED) return this.throttle;
      this.reverseSelected = false;
      this.demand = this.throttle;
    }
    return 0;
  }

  /**
   * Sets engine force, brake impulse and lateral grip on each wheel. Longitudinal forces are
   * capped by each tyre's load and the weather grip (traction control and ABS), and lateral
   * grip falls once a tyre slides or is busy with traction, which is what allows drifts.
   */
  private applyWheelForces(driveForce: number, servicePedal: number) {
    const vehicle = this.vehicle;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const load = vehicle.wheelIsInContact(i) ? (vehicle.wheelSuspensionForce(i) ?? 0) : 0;
      const limit = tractionLimit(load, this.grip);
      const handbraked = !front && this.handbrake;
      let engine = 0;
      let brakeForce = 0;
      let usage = 0;

      if (!this.driving) {
        brakeForce = PARKING_BRAKE_IMPULSE / STEP;
      } else if (handbraked) {
        brakeForce = HANDBRAKE_GRIP * limit;
        usage = 1;
      } else if (servicePedal > 0) {
        brakeForce = Math.min(brakeDemand(servicePedal, front), limit);
        usage = limit > 0 ? brakeForce / limit : 0;
      } else if (!front && driveForce !== 0) {
        const tractionCap = limit * TRACTION_CONTROL_SHARE;
        engine = Math.max(-tractionCap, Math.min(tractionCap, driveForce / 2));
        usage = limit > 0 ? Math.abs(engine) / limit : 0;
      } else if (this.demand === 0 && this.speed < STANDSTILL_SPEED) {
        brakeForce = STANDSTILL_HOLD_FORCE;
      }

      let lateral = baseLateralGrip(this.speed) * this.grip * lateralGripShare(this.slips[i], this.speed);
      lateral *= frictionCircleShare(usage, this.speed);
      if (!front) lateral *= REAR_LATERAL_BIAS;
      if (handbraked) lateral *= HANDBRAKE_LATERAL;

      vehicle.setWheelSteering(i, front ? this.steering : 0);
      vehicle.setWheelEngineForce(i, engine);
      vehicle.setWheelBrake(i, brakeForce * STEP);
      vehicle.setWheelFrictionSlip(i, lateral);
    }
  }

  /** Drag, rolling resistance, downforce, counter-roll torque and drift assist on the body. */
  private applyBodyForces(rotation: Quaternion, velocity: Vector3, spin: Vector3, forward: Vector3) {
    const car = this.car;
    const wake = this.driving;
    car.resetForces(false);
    car.resetTorques(false);

    let contacts = 0;
    for (let i = 0; i < 4; i++) if (this.vehicle.wheelIsInContact(i)) contacts++;

    const airSpeed = velocity.length();
    if (airSpeed > 0.01) {
      const rolling = contacts > 0 ? rollingResistance(car.mass(), airSpeed) : 0;
      const resistance = aeroDrag(airSpeed) + rolling;
      car.addForce(stepForce.copy(velocity).multiplyScalar(-resistance / airSpeed), wake);
    }

    const up = stepUp.copy(UP).applyQuaternion(rotation);
    const lift = downforce(this.signedSpeed);
    if (lift > 0) {
      const centre = stepCentre.copy(car.translation());
      this.pushDown(centre, forward, up, this.wheelAnchors[0].z, lift * DOWNFORCE_FRONT_SHARE);
      this.pushDown(centre, forward, up, this.wheelAnchors[2].z, lift * (1 - DOWNFORCE_FRONT_SHARE));
    }

    if (contacts > 0) {
      const roll = stepAxis.copy(up).cross(UP).dot(forward);
      const rollTorque = ROLL_STIFFNESS * roll - ROLL_DAMPING * spin.dot(forward);
      car.addTorque(stepForce.copy(forward).multiplyScalar(rollTorque), wake);

      const side = stepSide.copy(RIGHT).applyQuaternion(rotation);
      const assist = driftAssistShare(velocity.dot(side), this.signedSpeed, this.speed);
      if (assist > 0) {
        const yawTorque = -DRIFT_ASSIST_DAMPING * assist * spin.dot(up);
        car.addTorque(stepForce.copy(up).multiplyScalar(yawTorque), wake);
      }
    }
  }

  /** Applies `force` newtons along the body's down axis at the axle `axleZ` metres along forward. */
  private pushDown(centre: Vector3, forward: Vector3, up: Vector3, axleZ: number, force: number) {
    stepPoint.copy(forward).multiplyScalar(axleZ).add(centre);
    this.car.addForceAtPoint(stepForce.copy(up).multiplyScalar(-force), stepPoint, this.driving);
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
