import type { ThunderEvent } from './lightning';

/** Shape of one synthesised thunderclap. */
export interface ThunderVoice {
  /** Low-pass cut-off, Hz. Distant thunder loses its high frequencies and rumbles. */
  cutoff: number;
  /** Seconds to reach full volume. Near strikes crack; distant ones swell. */
  attack: number;
  /** Seconds the rumble takes to die away. */
  decay: number;
  /** Peak gain. */
  gain: number;
}

const NOISE_SECONDS = 4;
const MASTER_GAIN = 0.35;

/** Maps a thunder event to synthesis parameters. Pure, so it can be tested without Web Audio. */
export function thunderVoice(event: ThunderEvent): ThunderVoice {
  const near = Math.min(1, Math.max(0, event.loudness));
  return {
    cutoff: 140 + 520 * near * near,
    attack: 0.35 - 0.3 * near,
    decay: 2.4 + 1.6 * (1 - near),
    gain: MASTER_GAIN * near,
  };
}

/**
 * Plays thunder as a filtered noise burst. It never creates its own AudioContext: the caller
 * supplies one (normally the engine audio's, once the player has turned sound on), so thunder
 * respects the sound setting and the browser's user-gesture rule.
 */
export class ThunderAudio {
  private noise?: AudioBuffer;
  private noiseContext?: BaseAudioContext;

  constructor(private readonly getContext: () => AudioContext | undefined) {}

  play(event: ThunderEvent): void {
    const context = this.getContext();
    if (!context || context.state !== 'running') return;
    const voice = thunderVoice(event);
    const now = context.currentTime;

    const source = context.createBufferSource();
    source.buffer = this.noiseFor(context);
    source.playbackRate.value = 0.6 + 0.4 * event.loudness;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(voice.cutoff, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, voice.cutoff * 0.35), now + voice.decay);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, voice.gain), now + voice.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + voice.attack + voice.decay);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.addEventListener('ended', () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    });
    source.start(now);
    source.stop(now + voice.attack + voice.decay + 0.1);
  }

  /** One shared buffer of brown-ish noise per context; regenerated only if the context changes. */
  private noiseFor(context: BaseAudioContext): AudioBuffer {
    if (this.noise && this.noiseContext === context) return this.noise;
    const length = Math.floor(context.sampleRate * NOISE_SECONDS);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      // Integrated white noise gives the deep, rolling spectrum of thunder.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    this.noise = buffer;
    this.noiseContext = context;
    return buffer;
  }
}
