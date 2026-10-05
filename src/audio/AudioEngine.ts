import type { PlaybackState } from '../types/audio';
import type { ChainOptions, EffectState } from '../types/effects';
import { Emitter } from '../utils/emitter';
import { EffectChain } from './EffectChain';
import { createSafetyLimiter } from './OutputStage';
import { createWorkletNode, loadWorklets, setWorkletParams } from './worklets';
import { setParam } from './paramUtils';
import { dbToGain } from '../utils/math';
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
  /** The AudioWorklet module could not be loaded, so worklet-based effects are unavailable. */
  workletError: string;
}

/** Delay between asking for playback and audio actually starting. Imperceptible, but guarantees effect resets land first. */
const START_LEAD_SECONDS = 0.025;

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
 * Signal path: AudioBufferSourceNode → EffectChain → makeup gain (normalisation) → limiter → output → destination.
 * This mirrors the export pipeline (chain → gain → limiter), so the preview is loudness-matched like the file will be.
 */

/** Level-stage settings, derived from the offline measurement of the active file. */
export interface OutputStage {
  gainDb: number;
  ceilingDb: number;
  truePeak: boolean;
  limiterEnabled: boolean;
}

/** A ceiling this high can never be reached, which turns the limiter into a (latency-matched) pass-through. */
const LIMITER_DISABLED_CEILING_DB = 60;
export class AudioEngine extends Emitter<EngineEvents> {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private chain: EffectChain | null = null;
  private makeupGain: GainNode | null = null;
  private limiter: AudioWorkletNode | null = null;
  private outputStage: OutputStage = { gainDb: 0, ceilingDb: -1, truePeak: true, limiterEnabled: true };
  /** Resolves once worklet processors are loaded (or have failed). Playback and chain sync wait for it. */
  private ready: Promise<void> = Promise.resolve();
  private chainReady = false;
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
      this.makeupGain = this.context.createGain();
      this.chain.output.connect(this.makeupGain);
      this.ready = this.prepareChain(this.context, this.chain);
    }
    return this.context;
  }

  /** Loads worklets, then applies the pending chain. Failure degrades to "worklet effects are skipped", never a crash. */
  private async prepareChain(context: AudioContext, chain: EffectChain): Promise<void> {
    let limiter: AudioNode | null = null;
    try {
      await loadWorklets(context);
      this.limiter = createWorkletNode(context, 'mechvox-limiter');
      limiter = this.limiter;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.emit('workletError', `Pitch Shift, Vocoder, Flanger, Bitcrusher and the brickwall limiter are unavailable: ${reason}`);
      // Without worklets fall back to a native compressor so the output is still protected from overs.
      limiter = createSafetyLimiter(context);
    }
    if (this.chain !== chain || !this.makeupGain || !this.output) return; // engine was disposed meanwhile
    this.makeupGain.connect(limiter).connect(this.output);
    this.applyOutputStage(true);
    this.chainReady = true;
    // First sync is immediate: there is nothing to smooth from yet.
    chain.sync(this.chainConfig.effects, this.chainConfig.options, true);
  }

  /** Sets the normalisation gain and limiter. Safe to call at any time; applied once the context exists. */
  setOutputStage(stage: OutputStage): void {
    this.outputStage = stage;
    this.applyOutputStage(false);
  }

  private applyOutputStage(immediate: boolean): void {
    const context = this.context;
    if (!context) return;
    const { gainDb, ceilingDb, truePeak, limiterEnabled } = this.outputStage;
    if (this.makeupGain) setParam(context, this.makeupGain.gain, dbToGain(gainDb), immediate);
    if (this.limiter) {
      setWorkletParams(
        context,
        this.limiter,
        { ceilingDb: limiterEnabled ? ceilingDb : LIMITER_DISABLED_CEILING_DB, truePeak: truePeak ? 1 : 0 },
        immediate,
      );
    }
  }

  /** Declares the desired effect chain. Safe to call before audio has ever played; applied once the context exists. */
  setChain(effects: readonly EffectState[], options: ChainOptions): void {
    this.chainConfig = { effects, options };
    if (this.chainReady) this.chain?.sync(effects, options, false);
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
    await this.ready;
    // The user may have paused/stopped or switched files while worklets were loading.
    if (this.getState() === 'playing' || !this.buffer) return;
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
    this.limiter = null;
    this.makeupGain = null;
    await this.context?.close();
    this.context = null;
    this.output = null;
    this.chain = null;
    this.chainReady = false;
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

    // Start slightly in the future so the chain can restart its free-running phases first (worklets learn about
    // it via a message). Every effect then begins at phase 0 exactly as the audio does, as in an offline render.
    const startAt = context.currentTime + START_LEAD_SECONDS;
    chain.reset(startAt);
    this.anchor = {
      startContextTime: startAt,
      startOffset: offset,
      loop: this.loopEnabled,
      duration: buffer.duration,
    };
    source.start(startAt, offset);
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
