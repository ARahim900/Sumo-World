import type { FrameContext, GameSystem, VehicleTelemetry } from '../core/types';
import { IDLE_RPM, REDLINE_RPM } from '../vehicle/drivetrain';

/** Firing pulses per crankshaft revolution for a four-stroke six-cylinder engine. */
const FIRING_PER_REV = 3;
/** Time constant for parameter changes, seconds; short enough to follow shifts. */
const SMOOTHING = 0.06;
/** Slower time constant for the master level, so toggling does not click. */
const MASTER_SMOOTHING = 0.15;
const NOISE_SECONDS = 2;

/** Length of the level dip while the gearbox changes ratio, seconds. */
export const SHIFT_DIP_TIME = 0.14;
/** Share of engine level removed at the start of a shift. */
const SHIFT_DIP_DEPTH = 0.6;

/** Slip (tangent of slip angle) where tyres start to squeal. */
const SQUEAL_SLIP = 0.18;
const SQUEAL_RANGE = 0.5;
/** Squeal level of rear tyres locked by the handbrake. */
const HANDBRAKE_SQUEAL = 0.7;

export interface EngineVoice {
  /** Fundamental firing frequency, Hz. */
  frequency: number;
  /** Low-pass cutoff of the engine layers, Hz; opens up under load. */
  cutoff: number;
  /** Level of the tonal engine layers. */
  gain: number;
  /** Level of the filtered-noise intake and exhaust roar. */
  roar: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 0 at idle, 1 at the redline. */
function rpmShare(rpm: number): number {
  return clamp01((rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM));
}

/** Engine sound parameters for an engine speed and throttle load. */
export function engineVoice(rpm: number, load: number): EngineVoice {
  const revs = rpmShare(rpm);
  const throttle = clamp01(load);
  return {
    frequency: (Math.max(IDLE_RPM, rpm) / 60) * FIRING_PER_REV,
    cutoff: 320 + 2400 * throttle + 1500 * revs,
    gain: 0.012 + 0.02 * throttle + 0.01 * revs,
    roar: 0.002 + 0.018 * throttle * (0.3 + 0.7 * revs),
  };
}

/**
 * 0..1 engine load: the throttle in a forward gear, the brake pedal in reverse (the pedal
 * that drives the car backwards).
 */
export function engineLoad(vehicle: Pick<VehicleTelemetry, 'gear' | 'throttle' | 'brake'>): number {
  return vehicle.gear === -1 ? vehicle.brake : vehicle.throttle;
}

/** Engine level multiplier `elapsed` seconds into a gear change (1 when no shift is active). */
export function shiftDipGain(elapsed: number): number {
  if (elapsed >= SHIFT_DIP_TIME) return 1;
  return 1 - SHIFT_DIP_DEPTH * (1 - Math.max(0, elapsed) / SHIFT_DIP_TIME);
}

/**
 * 0..1 tyre squeal level, silent at walking pace. Sideways sliding comes from the largest
 * wheel slip angle; locked rear wheels under the handbrake squeal even in a straight line.
 * Wheelspin and locked brakes add nothing, because traction control and ABS keep the tyres
 * below their grip limit.
 */
export function squealLevel(slip: readonly number[], speed: number, handbrake: boolean): number {
  let worst = 0;
  for (const value of slip) worst = Math.max(worst, Math.abs(value));
  const sliding = clamp01((worst - SQUEAL_SLIP) / SQUEAL_RANGE);
  const locked = handbrake ? HANDBRAKE_SQUEAL : 0;
  return Math.max(sliding, locked) * clamp01((speed - 3) / 5);
}

/** 0..1 level of the rain ambience bed. */
export function rainLevel(rainDensity: number): number {
  return clamp01(rainDensity);
}

/** 0..1 level of tyre hiss on a wet road, rising with speed. */
export function hissLevel(wetness: number, speed: number): number {
  return clamp01(wetness) * clamp01(speed / 30);
}

interface AudioGraph {
  context: AudioContext;
  master: GainNode;
  fundamental: OscillatorNode;
  subharmonic: OscillatorNode;
  harmonic: OscillatorNode;
  engineFilter: BiquadFilterNode;
  engineGain: GainNode;
  roarFilter: BiquadFilterNode;
  roarGain: GainNode;
  squealFilter: BiquadFilterNode;
  squealTone: OscillatorNode;
  squealGain: GainNode;
  rainGain: GainNode;
  hissGain: GainNode;
}

/**
 * Synthesised car audio, built only from oscillators and filtered noise (no samples):
 * layered engine tones following rpm and throttle with a dip on gear changes, intake roar,
 * tyre squeal from wheel slip, wet-road hiss and a rain ambience bed.
 * The AudioContext is created lazily on the first toggle because browsers only allow audio
 * to start from a user gesture.
 */
export class EngineAudio implements GameSystem {
  readonly name = 'engine-audio';
  enabled = false;
  private graph?: AudioGraph;
  private closed = false;
  private lastGear = 0;
  private sinceShift = SHIFT_DIP_TIME;

  /** Flips the sound setting, creating the audio graph on first use. */
  toggle(running: boolean): boolean {
    const graph = this.ensureGraph();
    this.enabled = !this.enabled;
    graph.master.gain.setTargetAtTime(this.enabled ? 1 : 0, graph.context.currentTime, MASTER_SMOOTHING);
    if (running) void graph.context.resume();
    return this.enabled;
  }

  /**
   * The running audio context while sound is on, for other synthesised sounds such as thunder.
   * Undefined while sound is off, so those sounds follow the same setting.
   */
  get context(): AudioContext | undefined {
    return this.enabled ? this.graph?.context : undefined;
  }

  resume(): void {
    void this.graph?.context.resume();
  }

  suspend(): void {
    void this.graph?.context.suspend();
  }

  /** The audio graph is built lazily in toggle(), so there is nothing to prepare here. */
  init(): void {}

  update(dt: number, frame: FrameContext): void {
    const vehicle = frame.vehicle;
    if (vehicle.gear !== this.lastGear) {
      if (vehicle.gear > 0 && this.lastGear > 0) this.sinceShift = 0;
      this.lastGear = vehicle.gear;
    }
    this.sinceShift += dt;

    const graph = this.graph;
    if (frame.paused || !graph) return;
    const now = graph.context.currentTime;
    const voice = engineVoice(vehicle.rpm, engineLoad(vehicle));
    const running = frame.driving ? 1 : 0;
    const dip = shiftDipGain(this.sinceShift);
    ramp(graph.fundamental.frequency, voice.frequency, now);
    ramp(graph.subharmonic.frequency, voice.frequency / 2, now);
    ramp(graph.harmonic.frequency, voice.frequency * 2.01, now);
    ramp(graph.engineFilter.frequency, voice.cutoff * (0.6 + 0.4 * dip), now);
    ramp(graph.engineGain.gain, voice.gain * dip * running, now);
    ramp(graph.roarFilter.frequency, voice.frequency * 4, now);
    ramp(graph.roarGain.gain, voice.roar * dip * running, now);

    const squeal = squealLevel(vehicle.slip, vehicle.speed, vehicle.handbrake) * running;
    ramp(graph.squealGain.gain, 0.03 * squeal, now);
    ramp(graph.squealFilter.frequency, 1300 + 500 * squeal, now);
    ramp(graph.squealTone.frequency, 780 + 160 * squeal, now);

    ramp(graph.rainGain.gain, 0.025 * rainLevel(frame.weather.rainDensity), now);
    ramp(graph.hissGain.gain, 0.02 * hissLevel(frame.weather.wetness, vehicle.speed), now);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    void this.graph?.context.close();
  }

  private ensureGraph(): AudioGraph {
    if (this.graph) return this.graph;
    const context = new AudioContext();
    const master = gainNode(context, 0, context.destination);

    const engineGain = gainNode(context, 0, master);
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.Q.value = 1.2;
    engineFilter.connect(engineGain);
    const fundamental = oscillator(context, 'sawtooth', 45, 1, engineFilter);
    const subharmonic = oscillator(context, 'square', 22.5, 0.45, engineFilter);
    const harmonic = oscillator(context, 'sawtooth', 90, 0.2, engineFilter);

    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer(context);
    noise.loop = true;

    const roarGain = gainNode(context, 0, master);
    const roarFilter = filter(context, 'bandpass', 180, 1.5, roarGain);
    noise.connect(roarFilter);

    const squealGain = gainNode(context, 0, master);
    const squealFilter = filter(context, 'bandpass', 1300, 9, squealGain);
    noise.connect(squealFilter);
    const squealTone = oscillator(context, 'triangle', 780, 0.5, squealGain);
    const wobble = context.createOscillator();
    wobble.frequency.value = 7;
    const wobbleDepth = context.createGain();
    wobbleDepth.gain.value = 25;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(squealTone.frequency);

    const rainGain = gainNode(context, 0, master);
    const rainLow = filter(context, 'lowpass', 2600, 0.7, rainGain);
    const rainHigh = filter(context, 'highpass', 400, 0.7, rainLow);
    noise.connect(rainHigh);

    const hissGain = gainNode(context, 0, master);
    noise.connect(filter(context, 'bandpass', 3200, 0.8, hissGain));

    for (const source of [fundamental, subharmonic, harmonic, squealTone, wobble, noise]) source.start();

    this.graph = {
      context,
      master,
      fundamental,
      subharmonic,
      harmonic,
      engineFilter,
      engineGain,
      roarFilter,
      roarGain,
      squealFilter,
      squealTone,
      squealGain,
      rainGain,
      hissGain,
    };
    return this.graph;
  }
}

/** Glides an audio parameter towards `value` with the shared smoothing time constant. */
function ramp(param: AudioParam, value: number, now: number): void {
  param.setTargetAtTime(value, now, SMOOTHING);
}

function gainNode(context: AudioContext, value: number, destination: AudioNode): GainNode {
  const node = context.createGain();
  node.gain.value = value;
  node.connect(destination);
  return node;
}

function filter(
  context: AudioContext,
  type: BiquadFilterType,
  frequency: number,
  q: number,
  destination: AudioNode,
): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  node.connect(destination);
  return node;
}

/** Creates an oscillator feeding `destination` through its own level control. */
function oscillator(
  context: AudioContext,
  type: OscillatorType,
  frequency: number,
  level: number,
  destination: AudioNode,
): OscillatorNode {
  const node = context.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  node.connect(gainNode(context, level, destination));
  return node;
}

function noiseBuffer(context: AudioContext): AudioBuffer {
  const length = Math.floor(context.sampleRate * NOISE_SECONDS);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
