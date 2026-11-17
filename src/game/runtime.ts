import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Simulation } from './physics';
import { Input } from './input';
import { createCar, createCity, person } from './art';
import { DESTINATION, STEP, type Mission } from './content';
export interface Snapshot { ready: boolean; paused: boolean; driving: boolean; mission: Mission; speed: number; distance: number; hold: number; prompt: string; notice: string; x: number; z: number; yaw: number; rain: boolean; sound: boolean; firstPerson: boolean; fps: number }
export const initialSnapshot: Snapshot = { ready: false, paused: true, driving: false, mission: 'enter', speed: 0, distance: 128, hold: 0, prompt: '', notice: '', x: 7, z: 24, yaw: Math.PI, rain: true, sound: false, firstPerson: false, fps: 0 };
export class Runtime {
  scene = new T.Scene(); camera = new T.PerspectiveCamera(60, 1, .1, 550);
  renderer: T.WebGLRenderer; composer: EffectComposer; sim!: Simulation; input: Input;
  carArt = createCar(); playerArt = person('#60f7ed'); city!: Awaited<ReturnType<typeof createCity>>;
  queuedJump = false; released = false;
  paused = true; ready = false; disposed = false; rain = true; sound = false; firstPerson = false; lowMotion = false;
  frame = 0; last = 0; accumulator = 0; hudTime = 0; cameraYaw = Math.PI; cameraPitch = .22;
  rainGeometry = new T.BufferGeometry(); rainPositions = new Float32Array(1800 * 6); rainMesh: T.LineSegments;
  smokeGeometry = new T.BufferGeometry(); smokePositions = new Float32Array(90 * 3); smokeAges = new Float32Array(90); smoke: T.Points; smokeIndex = 0;
  audio?: AudioContext; oscillator?: OscillatorNode; gain?: GainNode;
  previousCar = new T.Vector3(); previousPlayer = new T.Vector3(); previousRotation = new T.Quaternion();
  resizeObserver: ResizeObserver; environment: T.WebGLRenderTarget;
  constructor(private host: HTMLElement, private publish: (s: Snapshot) => void, private fail: (message: string) => void) {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); this.renderer.setClearColor('#080f1d'); this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap; host.appendChild(this.renderer.domElement);
    this.scene.fog = new T.FogExp2('#101d32', .006); this.scene.background = new T.Color('#080f1d');
    const pmrem = new T.PMREMGenerator(this.renderer); const room = new RoomEnvironment(); this.environment = pmrem.fromScene(room, .04); this.scene.environment = this.environment.texture; room.dispose(); pmrem.dispose(); this.scene.environmentIntensity = .6;
    this.scene.add(new T.HemisphereLight('#a2ceff', '#172037', 1.2));
    const moon = new T.DirectionalLight('#bad6ff', 2.4); moon.position.set(-30, 60, 20); this.scene.add(moon);
    this.scene.add(this.carArt.group, this.playerArt.group);
    this.composer = new EffectComposer(this.renderer); this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new T.Vector2(1280, 720), .35, .5, 1)); this.composer.addPass(new OutputPass());
    for (let i = 0; i < this.rainPositions.length; i += 6) { this.rainPositions[i] = Math.random() * 70 - 35; this.rainPositions[i + 1] = Math.random() * 35; this.rainPositions[i + 2] = Math.random() * 70 - 35; this.rainPositions[i + 3] = this.rainPositions[i] + .12; this.rainPositions[i + 4] = this.rainPositions[i + 1] + .65; this.rainPositions[i + 5] = this.rainPositions[i + 2]; }
    this.rainGeometry.setAttribute('position', new T.BufferAttribute(this.rainPositions, 3)); this.rainMesh = new T.LineSegments(this.rainGeometry, new T.LineBasicMaterial({ color: '#83b7da', transparent: true, opacity: .2, depthWrite: false })); this.rainMesh.frustumCulled = false; this.scene.add(this.rainMesh);
    this.smokeGeometry.setAttribute('position', new T.BufferAttribute(this.smokePositions, 3)); this.smoke = new T.Points(this.smokeGeometry, new T.PointsMaterial({ color: '#bdc5da', size: .4, transparent: true, opacity: .2, depthWrite: false })); this.smoke.frustumCulled = false; this.scene.add(this.smoke);
    this.input = new Input(this.renderer.domElement, () => this.pause());
    this.resizeObserver = new ResizeObserver(this.resize); this.resizeObserver.observe(host);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
  }
  async initialise() {
    try {
    this.sim = await Simulation.create(); const sim = this.sim;
    if (this.disposed) { this.release(); return; }
    this.city = await createCity(this.scene);
    if (this.disposed) { this.release(); return; }
    for (let i = 0; i < 90; i++) sim.step({ throttle: 0, brake: 0, steer: 0, handbrake: false, moveX: 0, moveZ: 0, sprint: false, jump: false });
    this.resetInterpolation(); this.camera.position.set(12, 5, 32); this.camera.lookAt(3, 1, 18); this.ready = true; this.resize(); this.emit(); this.frame = requestAnimationFrame(this.loop);
    } catch (error) { this.release(); throw error; }
  }
  resize = () => { if (this.disposed) return; const w = this.host.clientWidth, h = this.host.clientHeight; this.renderer.setSize(w, h); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); };
  contextLost = (e: Event) => { e.preventDefault(); this.pause(); this.fail('Graphics context lost. Reload to restart the city.'); };
  resetInterpolation() { this.previousCar.copy(this.sim.car.translation()); this.previousPlayer.copy(this.sim.player.translation()); this.previousRotation.copy(this.sim.car.rotation()); }
  start() { if (!this.ready) return; this.paused = false; this.input.clear(); this.queuedJump = false; this.accumulator = 0; this.last = 0; void this.audio?.resume(); this.emit(); }
  pause() { if (!this.ready || this.paused) return; this.paused = true; this.input.clear(); this.queuedJump = false; this.accumulator = 0; void this.audio?.suspend(); this.emit(); }
  restart() { this.sim.recover(true); this.resetInterpolation(); this.cameraYaw = Math.PI; this.start(); }
  recover() { this.sim.recover(); this.resetInterpolation(); this.cameraYaw = Math.PI; this.start(); }
  toggleRain() { this.rain = !this.rain; this.sim.grip = this.rain ? .88 : 1; this.emit(); }
  toggleMotion() { this.lowMotion = !this.lowMotion; }
  toggleSound() {
    if (!this.audio) { this.audio = new AudioContext(); this.oscillator = this.audio.createOscillator(); this.gain = this.audio.createGain(); this.oscillator.type = 'sawtooth'; const filter = this.audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220; this.oscillator.connect(filter); filter.connect(this.gain); this.gain.connect(this.audio.destination); this.gain.gain.value = 0; this.oscillator.start(); }
    this.sound = !this.sound; if (!this.paused) void this.audio.resume(); this.emit();
  }
  emit(fps = 0) {
    const p = this.sim.driving ? this.sim.car.translation() : this.sim.player.translation();
    this.publish({ ready: this.ready, paused: this.paused, driving: this.sim.driving, mission: this.sim.mission, speed: this.sim.speed * 3.6, distance: Math.hypot(p.x - DESTINATION.x, p.z - DESTINATION.z), hold: this.sim.hold, prompt: this.sim.driving ? this.sim.speed < 1 ? 'Exit vehicle' : '' : this.sim.canEnter() ? 'Enter vehicle' : '', notice: this.sim.noticeTime > 0 ? this.sim.notice : '', x: p.x, z: p.z, yaw: this.sim.driving ? new T.Euler().setFromQuaternion(new T.Quaternion().copy(this.sim.car.rotation()), 'YXZ').y : this.sim.yaw, rain: this.rain, sound: this.sound, firstPerson: this.firstPerson, fps });
  }
  loop = (now: number) => {
    if (this.disposed) return;
    try {
      const dt = this.last ? Math.min((now - this.last) / 1000, .08) : STEP; this.last = now;
      const input = this.input.read();
      if (this.input.take('Escape')) { if (this.paused) this.start(); else this.pause(); }
      if (!this.paused) {
        if (this.input.take('KeyF')) this.sim.interact();
        if (this.input.take('KeyV') && !this.sim.driving) this.firstPerson = !this.firstPerson;
        if (this.input.take('KeyR')) { this.sim.recover(); this.resetInterpolation(); }
        if (!this.sim.driving) { this.cameraYaw += this.input.yawDelta; this.sim.yaw = this.cameraYaw; }
        this.cameraPitch = T.MathUtils.clamp(this.cameraPitch + this.input.pitchDelta, -.25, .75); this.input.yawDelta = 0; this.input.pitchDelta = 0;
        this.queuedJump ||= input.jump;
        this.accumulator += dt;
        while (this.accumulator >= STEP) { this.resetInterpolation(); input.jump = this.queuedJump; this.sim.step(input); this.queuedJump = false; input.jump = false; this.accumulator -= STEP; }
        this.animateWorld(dt, input.handbrake);
      }
      const alpha = this.paused ? 1 : this.accumulator / STEP;
      this.carArt.group.position.copy(this.previousCar).lerp(this.sim.car.translation(), alpha); this.carArt.group.quaternion.copy(this.previousRotation).slerp(new T.Quaternion().copy(this.sim.car.rotation()), alpha);
      this.playerArt.group.position.copy(this.previousPlayer).lerp(this.sim.player.translation(), alpha); this.playerArt.group.rotation.y = this.sim.yaw;
      this.playerArt.group.visible = !this.sim.driving && !this.firstPerson;
      for (let i = 0; i < 4; i++) { const anchor = this.sim.wheelAnchors[i]; const wheel = this.carArt.wheels[i]; wheel.position.copy(anchor); wheel.position.y -= this.sim.vehicle.wheelSuspensionLength(i) ?? .32; wheel.rotation.set(this.sim.vehicle.wheelRotation(i) ?? 0, i < 2 ? this.sim.steering : 0, 0, 'YXZ'); }
      if (!this.paused) this.updateCamera(dt);
      this.city.route.visible = this.sim.mission === 'drive'; this.city.marker.visible = this.sim.mission !== 'complete';
      this.rainMesh.visible = this.rain;
      this.composer.render(); this.hudTime += dt;
      if (this.hudTime > .1) { this.emit(1 / dt); this.hudTime = 0; }
      this.frame = requestAnimationFrame(this.loop);
    } catch (e) { this.pause(); this.fail(e instanceof Error ? e.message : 'The game encountered an error. Reload to retry.'); }
  };
  updateCamera(dt: number) {
    const p = this.sim.driving ? this.carArt.group.position : this.playerArt.group.position;
    const target = p.clone().add(new T.Vector3(0, this.sim.driving ? .8 : .6, 0));
    const forward = this.sim.driving ? new T.Vector3(0, 0, 1).applyQuaternion(this.carArt.group.quaternion) : new T.Vector3(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw)); forward.y = 0; forward.normalize();
    let desired: T.Vector3;
    if (!this.sim.driving && this.firstPerson) { desired = target.clone(); this.camera.position.copy(desired); this.camera.lookAt(target.clone().add(forward.multiplyScalar(10)).add(new T.Vector3(0, -this.cameraPitch * 10, 0))); return; }
    const distance = this.sim.driving ? 7 + Math.min(this.sim.speed * .07, 2.5) : 4.5;
    const back = this.input.held('KeyC') && this.sim.driving ? -1 : 1;
    desired = target.clone().addScaledVector(forward, -distance * back).add(new T.Vector3(0, this.sim.driving ? 3.1 : 1.4 + this.cameraPitch * 3, 0));
    const delta = desired.clone().sub(target); const length = delta.length(); const ray = new RAPIER.Ray(target, delta.normalize());
    const hit = this.sim.world.castRay(ray, length, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.sim.capsule, this.sim.car);
    if (hit) desired.copy(target).addScaledVector(delta, Math.max(.3, hit.timeOfImpact - .35));
    this.camera.position.lerp(desired, hit ? 1 : 1 - Math.exp(-dt * (this.lowMotion ? 12 : 7)));
    this.camera.lookAt(target.clone().addScaledVector(forward, this.sim.driving ? 3 : 1));
    const fov = this.sim.driving && !this.lowMotion ? 60 + Math.min(10, this.sim.speed * .25) : 60;
    this.camera.fov = T.MathUtils.lerp(this.camera.fov, fov, 1 - Math.exp(-dt * 3)); this.camera.updateProjectionMatrix();
  }
  animateWorld(dt: number, handbrake: boolean) {
    const p = this.sim.driving ? this.sim.car.translation() : this.sim.player.translation(); this.rainMesh.position.set(p.x, 0, p.z);
    if (this.rain) for (let i = 0; i < this.rainPositions.length; i += 6) { this.rainPositions[i + 1] -= dt * 19; if (this.rainPositions[i + 1] < 0) this.rainPositions[i + 1] = 35; this.rainPositions[i + 3] = this.rainPositions[i] + .12; this.rainPositions[i + 4] = this.rainPositions[i + 1] + .65; this.rainPositions[i + 5] = this.rainPositions[i + 2]; }
    this.rainGeometry.attributes.position.needsUpdate = true;
    for (const [i, npc] of this.city.npcs.entries()) { npc.group.position.z += (i % 2 ? 1 : -1) * dt * .7; if (Math.abs(npc.group.position.z) > 178) npc.group.position.z *= -.98; npc.group.rotation.y = i % 2 ? 0 : Math.PI; npc.legs.forEach((l, j) => l.rotation.x = Math.sin(this.sim.time * 5 + j * Math.PI) * .35); }
    const walking = this.input.held('KeyW', 'KeyA', 'KeyS', 'KeyD'); this.playerArt.legs.forEach((l, j) => l.rotation.x = walking ? Math.sin(this.sim.time * 8 + j * Math.PI) * .45 : 0);
    if (this.sim.driving && this.sim.speed > 5 && (handbrake || this.rain)) for (let w = 2; w < 4; w++) {
      if (!this.sim.vehicle.wheelIsInContact(w)) continue;
      const point = this.sim.vehicle.wheelContactPoint(w); if (!point) continue; const i = this.smokeIndex++ % 90; this.smokePositions.set([point.x, point.y + .1, point.z], i * 3); this.smokeAges[i] = 1;
    }
    for (let i = 0; i < 90; i++) { this.smokeAges[i] -= dt; if (this.smokeAges[i] > 0) this.smokePositions[i * 3 + 1] += dt * .4; else this.smokePositions[i * 3 + 1] = -20; }
    this.smokeGeometry.attributes.position.needsUpdate = true;
    if (this.audio && this.oscillator && this.gain) { this.oscillator.frequency.setTargetAtTime(35 + this.sim.speed * 2.5, this.audio.currentTime, .1); this.gain.gain.setTargetAtTime(this.sound && this.sim.driving ? .018 : 0, this.audio.currentTime, .1); }
  }
  dispose() { this.disposed = true; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.input.dispose(); this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost); void this.audio?.close(); if (this.ready) this.release(); }
  release() {
    if (this.released) return; this.released = true;
    this.sim?.dispose(); const geometries = new Set<T.BufferGeometry>(); const materials = new Set<T.Material>(); const textures = new Set<T.Texture>();
    this.scene.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.LineSegments) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    materials.forEach(m => { for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v); m.dispose(); }); textures.forEach(t => t.dispose()); geometries.forEach(g => g.dispose()); this.environment.dispose(); this.composer.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
