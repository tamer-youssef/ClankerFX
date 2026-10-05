import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MicCancelledError, MicRecorder, type RecordedTake } from './MicRecorder';

vi.mock('./worklets', () => ({ loadWorklets: vi.fn(() => Promise.resolve()) }));
import { loadWorklets } from './worklets';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  private listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string) {
    this.listeners.get(type)?.forEach((l) => l());
  }
}

class FakeStream {
  tracks = [new FakeTrack(), new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

class FakeNode {
  static last: FakeNode | null = null;
  static all: FakeNode[] = [];
  /** Partial data the "worklet" hands over when flushed. */
  pendingOnFlush: Float32Array | null = null;
  /** When false the worklet never answers a flush (to exercise the timeout). */
  answerFlush = true;
  options: unknown;
  disconnect = vi.fn();
  port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn((message: { type?: string }) => {
      if (message.type !== 'flush' || !this.answerFlush) return;
      queueMicrotask(() => {
        if (this.pendingOnFlush) this.send(this.pendingOnFlush);
        this.send({ type: 'flushed' });
      });
    }),
  };
  constructor(_context: unknown, _name: string, options: unknown) {
    this.options = options;
    FakeNode.last = this;
    FakeNode.all.push(this);
  }
  send(data: unknown) {
    this.port.onmessage?.({ data } as MessageEvent);
  }
}

function fakeContext(sampleRate = 1000) {
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  return {
    sampleRate,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createMediaStreamSource: vi.fn(() => source),
    source,
  };
}

type Ctx = ReturnType<typeof fakeContext>;
const asContext = (context: Ctx) => context as unknown as AudioContext;
const chunk = (...values: number[]) => Float32Array.from(values);

let stream: FakeStream;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stream = new FakeStream();
  getUserMedia = vi.fn(() => Promise.resolve(stream));
  FakeNode.last = null;
  FakeNode.all = [];
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('AudioWorkletNode', FakeNode);
  vi.mocked(loadWorklets).mockReset();
  vi.mocked(loadWorklets).mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

const allEnded = () => stream.tracks.every((t) => t.stop.mock.calls.length > 0 && t.readyState === 'ended');

async function startedRecorder(options?: ConstructorParameters<typeof MicRecorder>[0], sampleRate = 1000) {
  const recorder = new MicRecorder(options);
  const context = fakeContext(sampleRate);
  await recorder.start(asContext(context));
  return { recorder, context, node: FakeNode.last! };
}

describe('MicRecorder.isSupported', () => {
  it('needs getUserMedia and AudioWorklet', () => {
    expect(MicRecorder.isSupported()).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(MicRecorder.isSupported()).toBe(false);
  });
});

describe('MicRecorder.start', () => {
  it('asks for a raw mono signal and builds a graph that is not monitored', async () => {
    const { recorder, context, node } = await startedRecorder();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    expect(loadWorklets).toHaveBeenCalledOnce();
    expect(node.options).toMatchObject({ numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    expect(context.source.connect).toHaveBeenCalledWith(node);
    expect(context.source.connect).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalled();
    expect(recorder.getState()).toBe('recording');
  });

  it('rejects a second start while running or starting', async () => {
    const recorder = new MicRecorder();
    const context = fakeContext();
    const first = recorder.start(asContext(context));
    await expect(recorder.start(asContext(context))).rejects.toThrow(/already/);
    await first;
    await expect(recorder.start(asContext(context))).rejects.toThrow(/already/);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    recorder.dispose();
  });

  it('can record again after stopping', async () => {
    const { recorder, context } = await startedRecorder();
    await recorder.stop();
    stream = new FakeStream();
    await recorder.start(asContext(context));
    expect(recorder.getState()).toBe('recording');
    recorder.dispose();
  });

  it('passes a getUserMedia rejection through, with no tracks to leak', async () => {
    const denied = new DOMException('no', 'NotAllowedError');
    getUserMedia.mockRejectedValueOnce(denied);
    const recorder = new MicRecorder();
    await expect(recorder.start(asContext(fakeContext()))).rejects.toBe(denied);
    expect(recorder.getState()).toBe('idle');
    await recorder.start(asContext(fakeContext()));
    expect(recorder.getState()).toBe('recording');
    recorder.dispose();
  });

  it.each([
    ['the worklet fails to load', () => vi.mocked(loadWorklets).mockRejectedValueOnce(new Error('addModule failed'))],
    [
      'the worklet node cannot be created',
      () =>
        vi.stubGlobal(
          'AudioWorkletNode',
          class {
            constructor() {
              throw new Error('nope');
            }
          },
        ),
    ],
  ])('stops the tracks when %s after getUserMedia succeeded', async (_name, arrange) => {
    arrange();
    const recorder = new MicRecorder();
    await expect(recorder.start(asContext(fakeContext()))).rejects.toThrow();
    expect(allEnded()).toBe(true);
    expect(recorder.getState()).toBe('idle');
  });

  it('stops the tracks and disconnects when resume fails', async () => {
    const context = fakeContext();
    context.resume.mockRejectedValueOnce(new Error('blocked'));
    const recorder = new MicRecorder();
    await expect(recorder.start(asContext(context))).rejects.toThrow('blocked');
    expect(allEnded()).toBe(true);
    expect(context.source.disconnect).toHaveBeenCalled();
    expect(FakeNode.last!.disconnect).toHaveBeenCalled();
    expect(recorder.getState()).toBe('idle');
  });

  it('releases a microphone that arrives after discard() or dispose() cancelled the start', async () => {
    let resolve!: (s: FakeStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<FakeStream>((r) => (resolve = r)));
    const recorder = new MicRecorder();
    const pending = recorder.start(asContext(fakeContext()));
    recorder.dispose();
    resolve(stream);
    await expect(pending).rejects.toBeInstanceOf(MicCancelledError);
    expect(allEnded()).toBe(true);
    expect(recorder.getState()).toBe('disposed');
    await expect(recorder.start(asContext(fakeContext()))).rejects.toThrow(/disposed/);
  });

  it('a cancelled start does not tear down a newer attempt', async () => {
    let resolveOld!: (s: FakeStream) => void;
    const oldStream = new FakeStream();
    getUserMedia.mockReturnValueOnce(new Promise<FakeStream>((r) => (resolveOld = r)));
    const recorder = new MicRecorder();
    const oldStart = recorder.start(asContext(fakeContext()));
    recorder.discard();
    await recorder.start(asContext(fakeContext()));
    resolveOld(oldStream);
    await expect(oldStart).rejects.toBeInstanceOf(MicCancelledError);
    expect(oldStream.tracks.every((t) => t.readyState === 'ended')).toBe(true);
    expect(stream.tracks.every((t) => t.readyState === 'live')).toBe(true);
    expect(recorder.getState()).toBe('recording');
    recorder.dispose();
  });
});

describe('MicRecorder recording', () => {
  it('assembles chunks in order, including the flushed partial chunk, and releases the mic on stop()', async () => {
    const { recorder, context, node } = await startedRecorder({}, 1000);
    node.send(chunk(1, 2, 3));
    node.send(chunk(4, 5));
    node.pendingOnFlush = chunk(6);
    const take = await recorder.stop();
    expect(Array.from(take.samples)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(take.sampleRate).toBe(1000);
    expect(take.durationSeconds).toBeCloseTo(0.006);
    expect(allEnded()).toBe(true);
    expect(node.disconnect).toHaveBeenCalled();
    expect(context.source.disconnect).toHaveBeenCalled();
    expect(recorder.getState()).toBe('stopped');
    // Idempotent.
    expect(await recorder.stop()).toBe(take);
  });

  it('stops even when the worklet never answers the flush', async () => {
    vi.useFakeTimers();
    try {
      const { recorder, node } = await startedRecorder();
      node.answerFlush = false;
      node.send(chunk(1, 2));
      const promise = recorder.stop();
      await vi.advanceTimersByTimeAsync(1100);
      const take = await promise;
      expect(Array.from(take.samples)).toEqual([1, 2]);
      expect(allEnded()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns an empty take when nothing arrived', async () => {
    const { recorder } = await startedRecorder();
    const take = await recorder.stop();
    expect(take.samples.length).toBe(0);
    expect(take.durationSeconds).toBe(0);
    expect(allEnded()).toBe(true);
  });

  it('rejects stop() when not recording', async () => {
    const recorder = new MicRecorder();
    await expect(recorder.stop()).rejects.toThrow(/not recording/);
  });

  it('emits clamped levels and elapsed time from the sample count', async () => {
    const { recorder, node } = await startedRecorder({}, 1000);
    const levels: number[] = [];
    const times: number[] = [];
    recorder.on('level', (v) => levels.push(v));
    recorder.on('time', (v) => times.push(v));
    node.send({ type: 'level', peak: 0.25 });
    node.send({ type: 'level', peak: 3 });
    node.send(new Float32Array(500));
    node.send(new Float32Array(250));
    expect(levels).toEqual([0.25, 1]);
    expect(times).toEqual([0.5, 0.75]);
    expect(recorder.getElapsedSeconds()).toBe(0.75);
    recorder.dispose();
  });

  it('ignores messages after the recording stopped', async () => {
    const { recorder, node } = await startedRecorder();
    node.send(chunk(1));
    const take = await recorder.stop();
    const onLevel = vi.fn();
    recorder.on('level', onLevel);
    node.send({ type: 'level', peak: 0.5 });
    node.send(chunk(9, 9, 9));
    expect(onLevel).not.toHaveBeenCalled();
    expect(Array.from(take.samples)).toEqual([1]);
  });

  it('auto-stops at the limit, trims to it, releases the mic and emits ended', async () => {
    // 100 Hz for 0.05 s: a 5-sample limit.
    const { recorder, node } = await startedRecorder({ limitSeconds: 0.05 }, 100);
    const ended = vi.fn<(e: { reason: string; take: RecordedTake }) => void>();
    recorder.on('ended', ended);
    node.send(chunk(1, 2, 3));
    expect(ended).not.toHaveBeenCalled();
    node.send(chunk(4, 5, 6, 7)); // overshoots the limit
    node.send(chunk(8)); // arrives while stopping: dropped by the trim
    const take = await recorder.stop();
    await Promise.resolve();
    expect(Array.from(take.samples)).toEqual([1, 2, 3, 4, 5]);
    expect(take.durationSeconds).toBeCloseTo(0.05);
    expect(ended).toHaveBeenCalledOnce();
    expect(ended.mock.calls[0]![0]).toEqual({ reason: 'limit', take });
    expect(allEnded()).toBe(true);
    expect(recorder.getState()).toBe('stopped');
  });

  it('uses the ten minute limit by default', async () => {
    const { recorder, node } = await startedRecorder({}, 100); // limit 60000 samples
    const ended = vi.fn();
    recorder.on('ended', ended);
    node.send(new Float32Array(59_999));
    expect(recorder.getState()).toBe('recording');
    node.send(new Float32Array(1));
    await recorder.stop();
    expect(ended).toHaveBeenCalledOnce();
  });

  it('ends the take when the microphone disappears', async () => {
    const { recorder, node } = await startedRecorder();
    const ended = vi.fn<(e: { reason: string; take: RecordedTake }) => void>();
    recorder.on('ended', ended);
    node.send(chunk(1, 2));
    stream.tracks[0]!.fire('ended');
    const take = await recorder.stop();
    expect(Array.from(take.samples)).toEqual([1, 2]);
    await Promise.resolve();
    expect(ended).toHaveBeenCalledOnce();
    expect(ended.mock.calls[0]![0].reason).toBe('device-lost');
    expect(allEnded()).toBe(true);
  });
});

describe('MicRecorder.discard / dispose', () => {
  it('discard() releases the mic, drops the data and returns to idle', async () => {
    const { recorder, node } = await startedRecorder();
    node.send(chunk(1, 2, 3));
    recorder.discard();
    expect(allEnded()).toBe(true);
    expect(node.disconnect).toHaveBeenCalled();
    expect(recorder.getState()).toBe('idle');
    expect(recorder.getElapsedSeconds()).toBe(0);
    await expect(recorder.stop()).rejects.toThrow();
  });

  it('discard() after stop() drops the take', async () => {
    const { recorder, node } = await startedRecorder();
    node.send(chunk(1));
    await recorder.stop();
    recorder.discard();
    expect(recorder.getState()).toBe('idle');
    await expect(recorder.stop()).rejects.toThrow();
  });

  it('discard() while stopping makes stop() reject instead of returning data', async () => {
    const { recorder, node } = await startedRecorder();
    node.send(chunk(1));
    const pending = recorder.stop();
    recorder.discard();
    await expect(pending).rejects.toBeInstanceOf(MicCancelledError);
    expect(allEnded()).toBe(true);
    expect(recorder.getState()).toBe('idle');
  });

  it('dispose() releases the mic and is idempotent', async () => {
    const { recorder } = await startedRecorder();
    recorder.dispose();
    recorder.dispose();
    expect(allEnded()).toBe(true);
    expect(recorder.getState()).toBe('disposed');
  });

  it('is safe on a recorder that never started', () => {
    const recorder = new MicRecorder();
    expect(() => {
      recorder.discard();
      recorder.dispose();
    }).not.toThrow();
  });

  it('still disconnects when stopping a track throws', async () => {
    const { recorder, context } = await startedRecorder();
    stream.tracks[0]!.stop.mockImplementation(() => {
      throw new Error('boom');
    });
    recorder.discard();
    expect(stream.tracks[1]!.stop).toHaveBeenCalled();
    expect(context.source.disconnect).toHaveBeenCalled();
  });
});
