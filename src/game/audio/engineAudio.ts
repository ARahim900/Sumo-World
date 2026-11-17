import type { FrameContext, GameSystem } from '../core/types';

const DRIVING_GAIN = 0.018;
const SMOOTHING = 0.1;

/**
 * Synthesised engine note: a low-passed sawtooth whose pitch follows road speed.
 * The AudioContext is created lazily on the first toggle because browsers only allow audio
 * to start from a user gesture.
 */
export class EngineAudio implements GameSystem {
  readonly name = 'engine-audio';
  enabled = false;
  private context?: AudioContext;
  private oscillator?: OscillatorNode;
  private gain?: GainNode;
  private closed = false;

  /** Flips the sound setting, creating the audio graph on first use. */
  toggle(running: boolean): boolean {
    const context = this.ensureContext();
    this.enabled = !this.enabled;
    if (running) void context.resume();
    return this.enabled;
  }

  resume(): void {
    void this.context?.resume();
  }

  suspend(): void {
    void this.context?.suspend();
  }

  /** The audio graph is built lazily in toggle(), so there is nothing to prepare here. */
  init(): void {}

  update(_dt: number, frame: FrameContext): void {
    if (frame.paused || !this.context || !this.oscillator || !this.gain) return;
    const now = this.context.currentTime;
    this.oscillator.frequency.setTargetAtTime(35 + frame.vehicle.speed * 2.5, now, SMOOTHING);
    this.gain.gain.setTargetAtTime(this.enabled && frame.driving ? DRIVING_GAIN : 0, now, SMOOTHING);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    void this.context?.close();
  }

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = 'sawtooth';
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    gain.gain.value = 0;
    oscillator.start();
    this.context = context;
    this.oscillator = oscillator;
    this.gain = gain;
    return context;
  }
}
