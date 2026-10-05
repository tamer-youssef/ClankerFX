import { describe, expect, it } from 'vitest';
import { linearToDb, samplePeak, truePeak } from '../analysis/PeakAnalyzer';
import { LimiterCore, limitBuffer, type LimiterOptions } from './LimiterCore';
import { createRandom } from './random';
import { runInBlocks } from './testSignals';

const tone = (frequency: number, phase: number, amplitude: number, seconds: number, sampleRate: number) =>
  Float32Array.from({ length: Math.floor(seconds * sampleRate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase));

const noise = (seconds: number, amplitude: number, sampleRate: number, seed: number) => {
  const random = createRandom(seed);
  return Float32Array.from({ length: Math.floor(seconds * sampleRate) }, () => (random() * 2 - 1) * amplitude);
};

/** Quiet bed with bursts of near-square, full-scale (and over-scale) material. */
const bursts = (sampleRate: number) => {
  const random = createRandom(11);
  const out = new Float32Array(Math.floor(sampleRate * 1.5));
  for (let i = 0; i < out.length; i++) {
    const inBurst = i % 12000 < 1500;
    out[i] = inBurst ? (Math.floor(i / 7) % 2 ? 1 : -1) * (1 + random() * 1.5) : (random() * 2 - 1) * 0.05;
  }
  return out;
};

const ceilingGain = (db: number) => Math.pow(10, db / 20);
const worstOvershootDb = (channels: Float32Array[], ceilingDb: number, measure: (c: Float32Array[]) => number) => linearToDb(measure(channels)) - ceilingDb;

const adversarial = (sr: number): Array<[string, Float32Array[]]> => [
  ['fs/4 sine at 45 deg, full scale', [tone(sr / 4, Math.PI / 4, 1, 1, sr)]],
  ['fs/4 sine at 45 deg, +6 dB over', [tone(sr / 4, Math.PI / 4, 2, 1, sr)]],
  ['0.45 fs sine', [tone(sr * 0.45, 0.3, 1.5, 1, sr)]],
  ['square-ish bursts', [bursts(sr), bursts(sr).map((v) => -v * 0.8)]],
  ['random loud noise', [noise(1, 2.5, sr, 5), noise(1, 2.5, sr, 6)]],
  ['hot left, quiet right', [tone(440, 0, 3, 1, sr), tone(440, 0, 0.1, 1, sr)]],
];

describe('LimiterCore brickwall guarantee', () => {
  for (const sr of [44100, 48000, 96000]) {
    for (const ceilingDb of [0, -1, -6]) {
      it(`sample-peak mode never exceeds the ceiling (${sr} Hz, ${ceilingDb} dB)`, () => {
        for (const [name, input] of adversarial(sr)) {
          const { channels } = limitBuffer(input, sr, { ceilingDb, truePeak: false });
          expect(channels[0]!.length).toBe(input[0]!.length);
          expect(samplePeak(channels), name).toBeLessThanOrEqual(ceilingGain(ceilingDb) + 1e-6);
        }
      });
      it(`true-peak mode holds the true peak at the ceiling (${sr} Hz, ${ceilingDb} dB)`, () => {
        for (const [name, input] of adversarial(sr)) {
          const { channels } = limitBuffer(input, sr, { ceilingDb, truePeak: true });
          const overshoot = worstOvershootDb(channels, ceilingDb, (c) => truePeak(c));
          expect(overshoot, name).toBeLessThanOrEqual(0.05);
          expect(samplePeak(channels), name).toBeLessThanOrEqual(ceilingGain(ceilingDb) + 1e-6);
        }
      });
    }
  }

  it('actually limits (reduces) rather than muting: a hot sine keeps most of its level', () => {
    const x = tone(1000, 0, 2, 1, 48000);
    const { channels } = limitBuffer([x], 48000, { ceilingDb: -1, truePeak: true });
    const peak = samplePeak(channels);
    expect(peak).toBeGreaterThan(ceilingGain(-1) - 0.03);
  });
});

describe('LimiterCore transparency and basics', () => {
  it('is bit-exact when the input never exceeds the ceiling', () => {
    for (const truePeakMode of [false, true]) {
      const x = noise(1, 0.3, 48000, 9); // ISPs of 0.5-amplitude noise could legitimately top the -1 dB true-peak ceiling
      const y = tone(300, 0, 0.7, 1, 48000);
      const { channels, maxReductionDb } = limitBuffer([x, y], 48000, { ceilingDb: -1, truePeak: truePeakMode });
      expect(channels[0]).toEqual(x);
      expect(channels[1]).toEqual(y);
      expect(maxReductionDb).toBe(0);
    }
  });

  it('silence in, silence out', () => {
    const { channels, maxReductionDb } = limitBuffer([new Float32Array(5000), new Float32Array(5000)], 48000, { ceilingDb: -1, truePeak: true });
    expect(channels[0]!.every((v) => v === 0)).toBe(true);
    expect(channels[1]!.every((v) => v === 0)).toBe(true);
    expect(maxReductionDb).toBe(0);
  });

  it('links channels: a hot left channel reduces the right channel equally', () => {
    const left = tone(440, 0, 2, 1, 48000);
    const right = tone(440, 0, 0.25, 1, 48000);
    const { channels } = limitBuffer([left, right], 48000, { ceilingDb: -1, truePeak: false });
    const ratio = (i: number) => (channels[1]![i] as number) / (right[i] as number);
    // Where the right channel is meaningfully nonzero its gain equals the left channel's gain.
    for (let i = 2000; i < 40000; i += 97) {
      if (Math.abs(right[i] as number) > 0.05) expect((channels[0]![i] as number) / (left[i] as number)).toBeCloseTo(ratio(i), 4);
    }
    expect(ratio(10000 + 7)).toBeLessThan(0.99);
  });

  it('attack lands before the peak: a step to full scale never overshoots', () => {
    const sr = 48000;
    const x = new Float32Array(sr / 2);
    for (let i = 10000; i < x.length; i++) x[i] = i % 2 ? 3 : -3;
    const { channels } = limitBuffer([x], sr, { ceilingDb: -3, truePeak: false });
    expect(samplePeak(channels)).toBeLessThanOrEqual(ceilingGain(-3) + 1e-6);
    // The gain is already partly down at the step (ramped over the look-ahead, not applied after the fact).
    expect(Math.abs(channels[0]![9999 + 241] as number)).toBeLessThan(ceilingGain(-3) + 1e-6);
  });

  it('release: gain recovers towards 1 after a burst, roughly per releaseMs', () => {
    const sr = 48000;
    const releaseMs = 100;
    const x = new Float32Array(sr * 2).fill(0.1);
    for (let i = 4800; i < 4800 + 2400; i++) x[i] = 0.1 + (i % 2 ? 4 : -4) * 0.25 * 4; // burst peaking at ~4.1
    const { channels } = limitBuffer([x], sr, { ceilingDb: -1, truePeak: false, releaseMs, lookaheadMs: 5 });
    const y = channels[0]!;
    const gainAt = (i: number) => (y[i] as number) / (x[i] as number);
    const endOfBurst = 4800 + 2400;
    const tail = (ms: number) => gainAt(endOfBurst + 240 + Math.round((ms / 1000) * sr));
    const g0 = tail(0);
    expect(g0).toBeLessThan(0.3);
    const gainsRecovering = [0, 50, 100, 200, 400, 800].map(tail);
    for (let i = 1; i < gainsRecovering.length; i++) expect(gainsRecovering[i]).toBeGreaterThan(gainsRecovering[i - 1] as number);
    // One time constant covers ~63 % of the way back to 1 (the smoothing mean adds a few ms of lag).
    const fraction = (tail(releaseMs) - g0) / (1 - g0);
    expect(fraction).toBeGreaterThan(0.5);
    expect(fraction).toBeLessThan(0.75);
    expect(tail(800)).toBeGreaterThan(0.99);
  });

  it('maxReductionDb matches the expected reduction for a known sine', () => {
    const sr = 48000;
    // 1 kHz at 48 kHz repeats every 48 samples and hits +-1 exactly at quarter periods: the sample peak is the amplitude.
    const x = tone(1000, 0, 2, 1, sr);
    const sampleMode = limitBuffer([x], sr, { ceilingDb: -2, truePeak: false });
    expect(sampleMode.maxReductionDb).toBeCloseTo(8.0412, 1); // 20log10(2) + 2
    const trueMode = limitBuffer([x], sr, { ceilingDb: -2, truePeak: true });
    expect(trueMode.maxReductionDb).toBeCloseTo(8.0412, 1);
    const core = new LimiterCore(sr, { ceilingDb: -2, truePeak: false });
    expect(core.maxReductionDb).toBe(0);
  });

  it('exposes latency = lookahead (rounded) and honours custom times', () => {
    expect(new LimiterCore(48000, { ceilingDb: 0, truePeak: false }).latencySamples).toBe(240);
    expect(new LimiterCore(44100, { ceilingDb: 0, truePeak: true }).latencySamples).toBe(Math.round(0.005 * 44100));
    expect(new LimiterCore(48000, { ceilingDb: 0, truePeak: false, lookaheadMs: 2 }).latencySamples).toBe(96);
    expect(new LimiterCore(48000, { ceilingDb: 0, truePeak: true, lookaheadMs: 0 }).latencySamples).toBeGreaterThan(0);
  });
});

describe('LimiterCore streaming', () => {
  const options: LimiterOptions = { ceilingDb: -1, truePeak: true };

  it('processing in 128-sample blocks equals one big block bit-for-bit', () => {
    const sr = 48000;
    const input = [bursts(sr), noise(1.5, 1.5, sr, 3)];
    const big = new LimiterCore(sr, options);
    const bigOut = input.map((c) => new Float32Array(c.length));
    big.process(input, bigOut, input[0]!.length);

    const blocked = new LimiterCore(sr, options);
    const blockOut = [new Float32Array(input[0]!.length), new Float32Array(input[0]!.length)];
    for (let start = 0; start < input[0]!.length; start += 128) {
      const frames = Math.min(128, input[0]!.length - start);
      blocked.process(
        input.map((c) => c.subarray(start, start + frames)),
        blockOut.map((c) => c.subarray(start, start + frames)),
        frames,
      );
    }
    expect(blockOut[0]).toEqual(bigOut[0]);
    expect(blockOut[1]).toEqual(bigOut[1]);
    expect(blocked.maxReductionDb).toBe(big.maxReductionDb);
  });

  it('works through the runInBlocks harness (mono) and can process in place', () => {
    const sr = 48000;
    const input = tone(500, 0, 2, 0.5, sr);
    const core = new LimiterCore(sr, options);
    const out = runInBlocks(input, 1, (i, o, n) => core.process(i, o, n))[0]!;
    const inPlace = input.slice();
    const core2 = new LimiterCore(sr, options);
    core2.process([inPlace], [inPlace], inPlace.length);
    expect(inPlace).toEqual(out);
  });

  it('reset() returns the limiter to its initial state', () => {
    const sr = 48000;
    const x = bursts(sr);
    const core = new LimiterCore(sr, options);
    const first = new Float32Array(x.length);
    core.process([x], [first], x.length);
    const reduction = core.maxReductionDb;
    expect(reduction).toBeGreaterThan(3);
    core.reset();
    expect(core.maxReductionDb).toBe(0);
    const second = new Float32Array(x.length);
    core.process([x], [second], x.length);
    expect(second).toEqual(first);
    expect(core.maxReductionDb).toBe(reduction);
  });

  it('handles 1, 2 and 3 channels', () => {
    for (const count of [1, 2, 3]) {
      const input = Array.from({ length: count }, (_, c) => noise(0.3, 2, 48000, c + 1));
      const { channels } = limitBuffer(input, 48000, { ceilingDb: -1, truePeak: true });
      expect(channels).toHaveLength(count);
      expect(truePeak(channels)).toBeLessThanOrEqual(ceilingGain(-1) * 1.006);
    }
  });
});

describe('LimiterCore performance', () => {
  it('limits 60 s of stereo 48 kHz well within a few seconds', () => {
    const sr = 48000;
    const input = [noise(60, 1.4, sr, 1), noise(60, 1.4, sr, 2)];
    const started = performance.now();
    const { channels } = limitBuffer(input, sr, { ceilingDb: -1, truePeak: true });
    const elapsed = performance.now() - started;
    console.log(`limiter: 60 s stereo @48k true-peak: ${elapsed.toFixed(0)} ms`);
    expect(channels[0]!.length).toBe(input[0]!.length);
    expect(elapsed).toBeLessThan(4000);
    const sampleStarted = performance.now();
    limitBuffer(input, sr, { ceilingDb: -1, truePeak: false });
    console.log(`limiter: 60 s stereo @48k sample-peak: ${(performance.now() - sampleStarted).toFixed(0)} ms`);
  });
});
