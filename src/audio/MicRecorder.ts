import { Emitter } from '../utils/emitter';
import { micUnsupportedReason } from './micErrors';
import { RECORDING_LIMIT_SECONDS, assembleChunks, maxRecordingSamples } from './recordingChunks';
import { loadWorklets } from './worklets';

export interface RecordedTake {
  /** Mono samples at `sampleRate`. */
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
}

export type RecorderEndReason = 'limit' | 'device-lost';

export interface MicRecorderEvents {
  /** Input peak, 0 to 1, about every 50 ms while recording. */
  level: number;
  /** Elapsed recording time in seconds, derived from the number of samples captured. */
  time: number;
  /** The recorder stopped by itself (recording limit reached, or the microphone went away). The take is final. */
  ended: { reason: RecorderEndReason; take: RecordedTake };
}

export type MicRecorderState = 'idle' | 'starting' | 'recording' | 'stopping' | 'stopped' | 'disposed';

/** Thrown from start() when discard() or dispose() was called while the microphone was still being opened. */
export class MicCancelledError extends Error {
  constructor() {
    super('Recording was cancelled');
    this.name = 'MicCancelledError';
  }
}

export interface MicRecorderOptions {
  /** Overrides RECORDING_LIMIT_SECONDS (tests). */
  limitSeconds?: number;
}

/** Everything one recording attempt opens, so it can be torn down as a unit. */
interface Graph {
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  node: AudioWorkletNode | null;
}

/** Releases the microphone first so the browser's recording indicator clears at once, then unwires the graph. */
function releaseGraph(graph: Graph): void {
  const { stream, source, node } = graph;
  graph.stream = graph.source = graph.node = null;
  // One track failing to stop must not stop the others (or the rest of the teardown) from running.
  for (const track of stream?.getTracks() ?? []) {
    try {
      track.stop();
    } catch {
      // Nothing more can be done for this track.
    }
  }
  try {
    source?.disconnect();
  } catch {
    // Already disconnected.
  }
  if (node) {
    node.port.onmessage = null;
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}

/** How long stop() waits for the worklet to hand over its last partial chunk before giving up on it. */
const FLUSH_TIMEOUT_MS = 1000;

/**
 * Records the microphone into memory. Audio never leaves the device and is never routed to the speakers: the recorder
 * node has no outputs, so there is no monitoring and no feedback. The microphone is released (every track stopped, so
 * the browser's recording indicator goes away) on every path: stop, discard, dispose, errors and a lost device.
 */
export class MicRecorder extends Emitter<MicRecorderEvents> {
  static isSupported(): boolean {
    return micUnsupportedReason() === null;
  }

  private readonly limitSeconds: number;
  private state: MicRecorderState = 'idle';
  /** Bumped by discard()/dispose() so an in-flight start() or stop() can tell it was cancelled. */
  private generation = 0;

  private graph: Graph | null = null;
  private sampleRate = 0;
  private maxSamples = 0;

  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private take: RecordedTake | null = null;
  private finishing: Promise<RecordedTake> | null = null;
  private flushWaiter: (() => void) | null = null;

  constructor(options: MicRecorderOptions = {}) {
    super();
    this.limitSeconds = options.limitSeconds ?? RECORDING_LIMIT_SECONDS;
  }

  getState(): MicRecorderState {
    return this.state;
  }

  /** Seconds captured so far. */
  getElapsedSeconds(): number {
    return this.sampleRate > 0 ? this.sampleCount / this.sampleRate : 0;
  }

  /**
   * Opens the microphone and starts capturing. Call it from a user gesture. Errors are thrown as the browser raised
   * them; pass them through describeMicError for display. The microphone is already released when this rejects.
   */
  async start(context: AudioContext): Promise<void> {
    if (this.state === 'disposed') throw new Error('MicRecorder has been disposed');
    if (this.state !== 'idle' && this.state !== 'stopped') throw new Error('MicRecorder is already running');

    const generation = ++this.generation;
    this.state = 'starting';
    this.resetData();
    // Local, not just on `this`: a cancelled start must release only what it opened, never a newer attempt's graph.
    const graph: Graph = { stream: null, source: null, node: null };
    try {
      // Raw, unprocessed input: a voice-FX tool wants the real signal, not the browser's speech clean-up.
      graph.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      this.assertCurrent(generation);
      this.graph = graph;

      await loadWorklets(context);
      this.assertCurrent(generation);

      this.sampleRate = context.sampleRate;
      this.maxSamples = maxRecordingSamples(this.sampleRate, this.limitSeconds);
      const node = new AudioWorkletNode(context, 'mechvox-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      graph.node = node;
      node.port.onmessage = (event: MessageEvent) => this.onMessage(event.data, generation);
      const source = context.createMediaStreamSource(graph.stream);
      graph.source = source;
      // Deliberately not connected to the destination: nothing is played back while recording.
      source.connect(node);
      for (const track of graph.stream.getAudioTracks()) track.addEventListener('ended', () => this.onTrackEnded(generation));

      await context.resume();
      this.assertCurrent(generation);
      this.state = 'recording';
    } catch (error) {
      releaseGraph(graph);
      if (this.graph === graph) this.graph = null;
      if (generation === this.generation && this.state === 'starting') this.state = 'idle';
      throw error;
    }
  }

  /** Stops recording and returns the take. Calling it again after the recorder stopped returns the same take. */
  stop(): Promise<RecordedTake> {
    if (this.finishing) return this.finishing;
    if (this.state === 'stopped' && this.take) return Promise.resolve(this.take);
    if (this.state !== 'recording') return Promise.reject(new Error('MicRecorder is not recording'));
    return this.finish();
  }

  /** Stops the microphone and drops everything recorded. Safe in any state. */
  discard(): void {
    this.generation++;
    this.release();
    this.resetData();
    if (this.state !== 'disposed') this.state = 'idle';
  }

  /** Like discard(), and the recorder can no longer be used. Call it when the owner goes away. */
  dispose(): void {
    this.discard();
    this.state = 'disposed';
  }

  private resetData(): void {
    this.chunks = [];
    this.sampleCount = 0;
    this.take = null;
    this.finishing = null;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new MicCancelledError();
  }

  private onMessage(data: unknown, generation: number): void {
    if (generation !== this.generation) return;
    if (data instanceof Float32Array) {
      if (this.state !== 'recording' && this.state !== 'stopping') return;
      this.chunks.push(data);
      this.sampleCount += data.length;
      if (this.state === 'recording') {
        this.emit('time', this.getElapsedSeconds());
        if (this.sampleCount >= this.maxSamples) void this.finish('limit');
      }
      return;
    }
    const message = data as { type?: string; peak?: number } | null;
    if (message?.type === 'level' && this.state === 'recording' && typeof message.peak === 'number') {
      this.emit('level', Math.min(1, Math.max(0, message.peak)));
    } else if (message?.type === 'flushed') {
      this.flushWaiter?.();
    }
  }

  private onTrackEnded(generation: number): void {
    // Fires when the device is unplugged or the permission is revoked mid-take. stop() releases first, so those
    // tracks ending on purpose arrive here with the state already changed and are ignored.
    if (generation === this.generation && this.state === 'recording') void this.finish('device-lost');
  }

  /** Waits for the worklet's last partial chunk. Bounded, so a wedged worklet cannot hang stop(). */
  private flush(): Promise<void> {
    const node = this.graph?.node;
    if (!node) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, FLUSH_TIMEOUT_MS);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.flushWaiter = done;
      try {
        node.port.postMessage({ type: 'flush' });
      } catch {
        done();
      }
    });
  }

  private finish(reason?: RecorderEndReason): Promise<RecordedTake> {
    const generation = this.generation;
    this.state = 'stopping';
    const run = async (): Promise<RecordedTake> => {
      try {
        await this.flush();
      } finally {
        this.flushWaiter = null;
        this.release();
      }
      this.assertCurrent(generation);
      const samples = assembleChunks(this.chunks, this.maxSamples);
      this.chunks = [];
      const take: RecordedTake = { samples, sampleRate: this.sampleRate, durationSeconds: samples.length / this.sampleRate };
      this.take = take;
      this.state = 'stopped';
      return take;
    };
    const promise = run().catch((error: unknown) => {
      if (generation === this.generation) {
        this.resetData();
        this.state = 'idle';
      }
      throw error;
    });
    this.finishing = promise;
    if (reason) {
      promise.then(
        (take) => {
          if (generation === this.generation) this.emit('ended', { reason, take });
        },
        () => undefined,
      );
    }
    return promise;
  }

  private release(): void {
    const graph = this.graph;
    this.graph = null;
    if (graph) releaseGraph(graph);
    const waiter = this.flushWaiter;
    this.flushWaiter = null;
    waiter?.();
  }
}
