import type { PlaybackState } from '../types/audio';
import type { ChainOptions, EffectState } from '../types/effects';
import { Emitter } from '../utils/emitter';
import { EffectChain } from './EffectChain';
import { createSafetyLimiter } from './OutputStage';
import { clampSeek, positionAt, type ClockAnchor } from './playbackClock';

interface EngineEvents {
  /** Fired whenever the transport state changes. */
  state: PlaybackState;
  /** Fired when the playhead is moved by a seek or a stop (not on every frame — poll getPosition() for that). */
  seek: number;
  /** Fired when a buffer is loaded or cleared. */
  buffer: AudioBuffer | null;
  loop: boolean;
  /** An effect failed to initialise and is being skipped. */
  effectError: { id: string; message: string };
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const withWebkit = window as unknown as { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? withWebkit.webkitAudioContext ?? null;
}

export function isWebAudioSupported(): boolean {
  return getAudioContextConstructor() !== null;
}

/**
 * Real-time playback engine. Owns the AudioContext and transport; knows nothing about React.
 *
 * Signal path: AudioBufferSourceNode → EffectChain → safety limiter → output (GainNode) → destination.
 * Loudness normalisation (Phase 5) will slot in between the chain and the limiter.
 */
export class AudioEngine extends Emitter<EngineEvents> {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private chain: EffectChain | null = null;
  private chainConfig: { effects: readonly EffectState[]; options: ChainOptions } = {
    effects: [],
    options: { bypassAll: false, bypassedIds: new Set() },
  };
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;

  private state: PlaybackState = 'stopped';
  private loopEnabled = false;
  /** Playhead position while not playing; while playing, derived from `anchor`. */
  private restingPosition = 0;
  private anchor: ClockAnchor | null = null;

  /** Created lazily: browsers keep contexts created before a user gesture suspended. */
  getContext(): AudioContext {
    if (!this.context) {
      const Constructor = getAudioContextConstructor();
      if (!Constructor) throw new Error('Web Audio is not supported in this browser.');
      this.context = new Constructor({ latencyHint: 'interactive' });
      this.output = this.context.createGain();
      this.output.connect(this.context.destination);

      this.chain = new EffectChain(this.context, {
        onEffectError: (id, message) => this.emit('effectError', { id, message }),
      });
      const limiter = createSafetyLimiter(this.context);
      this.chain.output.connect(limiter).connect(this.output);
      // First sync is immediate: there is nothing to smooth from yet.
      this.chain.sync(this.chainConfig.effects, this.chainConfig.options, true);
    }
    return this.context;
  }

  /** Declares the desired effect chain. Safe to call before audio has ever played; applied once the context exists. */
  setChain(effects: readonly EffectState[], options: ChainOptions): void {
    this.chainConfig = { effects, options };
    this.chain?.sync(effects, options, false);
  }

  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  getState(): PlaybackState {
    return this.state;
  }

  getLoop(): boolean {
    return this.loopEnabled;
  }

  getDuration(): number {
    return this.buffer?.duration ?? 0;
  }

  getPosition(): number {
    if (this.state === 'playing' && this.anchor && this.context) {
      return positionAt(this.anchor, this.context.currentTime);
    }
    return this.restingPosition;
  }

  loadBuffer(buffer: AudioBuffer | null): void {
    this.teardownSource();
    this.buffer = buffer;
    this.restingPosition = 0;
    this.anchor = null;
    this.setState('stopped');
    this.emit('buffer', buffer);
    this.emit('seek', 0);
  }

  async play(): Promise<void> {
    if (!this.buffer || this.state === 'playing') return;
    const context = this.getContext();
    if (context.state === 'suspended') await context.resume();
    this.startSourceAt(this.restingPosition);
    this.setState('playing');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.restingPosition = this.getPosition();
    this.teardownSource();
    this.anchor = null;
    this.setState('paused');
    this.emit('seek', this.restingPosition);
  }

  async togglePlay(): Promise<void> {
    if (this.state === 'playing') this.pause();
    else await this.play();
  }

  stop(): void {
    if (this.state === 'stopped' && this.restingPosition === 0) return;
    this.teardownSource();
    this.anchor = null;
    this.restingPosition = 0;
    this.setState('stopped');
    this.emit('seek', 0);
  }

  seek(seconds: number): void {
    if (!this.buffer) return;
    const target = clampSeek(seconds, this.buffer.duration);
    this.restingPosition = target;
    if (this.state === 'playing') {
      // Sources are one-shot, so a seek during playback means replacing the source.
      this.startSourceAt(target);
    }
    this.emit('seek', target);
  }

  setLoop(enabled: boolean): void {
    if (enabled === this.loopEnabled) return;
    const position = this.getPosition();
    this.loopEnabled = enabled;
    if (this.state === 'playing' && this.source && this.context && this.buffer) {
      this.source.loop = enabled;
      // Re-anchor so position math switches between wrapping and clamping without a jump.
      this.anchor = {
        startContextTime: this.context.currentTime,
        startOffset: position,
        loop: enabled,
        duration: this.buffer.duration,
      };
    }
    this.emit('loop', enabled);
  }

  async dispose(): Promise<void> {
    this.teardownSource();
    this.chain?.dispose();
    await this.context?.close();
    this.context = null;
    this.output = null;
    this.chain = null;
  }

  private startSourceAt(offset: number): void {
    const context = this.getContext();
    const buffer = this.buffer;
    const chain = this.chain;
    if (!buffer || !chain) return;

    this.teardownSource();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = this.loopEnabled;
    source.connect(chain.input);
    source.onended = () => {
      // Only a natural end gets here: teardownSource() clears this handler before manual stops.
      if (this.source !== source) return;
      this.source = null;
      this.anchor = null;
      this.restingPosition = 0;
      this.setState('stopped');
      this.emit('seek', 0);
    };

    this.anchor = {
      startContextTime: context.currentTime,
      startOffset: offset,
      loop: this.loopEnabled,
      duration: buffer.duration,
    };
    source.start(0, offset);
    this.source = source;
  }

  private teardownSource(): void {
    const source = this.source;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // stop() throws if the source never started; nothing to clean up in that case.
    }
    source.disconnect();
    this.source = null;
  }

  private setState(next: PlaybackState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('state', next);
  }
}
