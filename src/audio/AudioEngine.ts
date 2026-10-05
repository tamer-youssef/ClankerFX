import type { PlaybackState } from '../types/audio';
import { Emitter } from '../utils/emitter';
import { clampSeek, positionAt, type ClockAnchor } from './playbackClock';

interface EngineEvents {
  /** Fired whenever the transport state changes. */
  state: PlaybackState;
  /** Fired when the playhead is moved by a seek or a stop (not on every frame — poll getPosition() for that). */
  seek: number;
  /** Fired when a buffer is loaded or cleared. */
  buffer: AudioBuffer | null;
  loop: boolean;
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
 * Signal path: AudioBufferSourceNode → output (GainNode) → destination.
 * `output` is the seam where the effect chain and final limiter will be inserted in later phases.
 */
export class AudioEngine extends Emitter<EngineEvents> {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
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
    }
    return this.context;
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
    await this.context?.close();
    this.context = null;
    this.output = null;
  }

  private startSourceAt(offset: number): void {
    const context = this.getContext();
    const buffer = this.buffer;
    const output = this.output;
    if (!buffer || !output) return;

    this.teardownSource();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = this.loopEnabled;
    source.connect(output);
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
