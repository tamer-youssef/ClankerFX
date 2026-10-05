import { describe, expect, it } from 'vitest';
import { CompressorCore, staticGainDb, type CompressorParams } from './CompressorCore';
import { createRandom } from './random';
import { SAMPLE_RATE, rms, runInBlocks, sine } from './testSignals';

const fromDb = (db: number) => Math.pow(10, db / 20);
const toDb = (linear: number) => 20 * Math.log10(linear);

const base: CompressorParams = { thresholdDb: -24, ratio: 4, attackMs: 5, releaseMs: 100, makeupDb: 0 };

function noise(seconds: number, amplitude: number, seed: number): Float32Array {
  const random = createRandom(seed);
  return Float32Array.from({ length: Math.floor(seconds * SAMPLE_RATE) }, () => (random() * 2 - 1) * amplitude);
}

/** Processes whole channels in one call and returns new output arrays. */
function run(channels: Float32Array[], params: CompressorParams, core = new CompressorCore(SAMPLE_RATE)): Float32Array[] {
  const frames = channels[0]!.length;
  const outputs = channels.map(() => new Float32Array(frames));
  core.process(channels, outputs, frames, params);
  return outputs;
}

/** Gain in dB of `output` relative to `input`, from RMS over a window. */
function gainDb(input: Float32Array, output: Float32Array, from: number, to: number): number {
  return toDb(rms(output, from, to) / rms(input, from, to));
}

/** Constant (DC) level signal: removes detector ripple so envelope timing can be read directly. */
const steps = (segments: Array<[number, number]>): Float32Array => {
  const total = segments.reduce((sum, [seconds]) => sum + Math.floor(seconds * SAMPLE_RATE), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const [seconds, value] of segments) {
    const n = Math.floor(seconds * SAMPLE_RATE);
    out.fill(value, at, at + n);
    at += n;
  }
  return out;
};

describe('staticGainDb', () => {
  it('is zero below the threshold and follows 1/R above it (hard knee)', () => {
    expect(staticGainDb(-40, -24, 4, 0)).toBe(0);
    expect(staticGainDb(-24, -24, 4, 0)).toBe(0);
    // 12 dB over at 4:1 → output is 3 dB over → gain change −9 dB.
    expect(staticGainDb(-12, -24, 4, 0)).toBeCloseTo(-9, 12);
    expect(staticGainDb(0, -24, 20, 0)).toBeCloseTo(-24 * (1 - 1 / 20), 12);
  });

  it('handles the soft knee: edges, centre and the 1:1 / ratio < 1 cases', () => {
    // Knee 6 dB around −24: spans −27 … −21.
    expect(staticGainDb(-27, -24, 4, 6)).toBe(0);
    expect(staticGainDb(-30, -24, 4, 6)).toBe(0);
    // At the upper edge the soft curve meets the straight line: (1/R − 1)·3.
    expect(staticGainDb(-21, -24, 4, 6)).toBeCloseTo(-0.75 * 3, 12);
    // At the threshold: (1/R − 1)·(W/2)² / (2W) = (1/R − 1)·W/8.
    expect(staticGainDb(-24, -24, 4, 6)).toBeCloseTo((-0.75 * 6) / 8, 12);
    // Above the knee: pure line.
    expect(staticGainDb(-10, -24, 4, 6)).toBeCloseTo(-0.75 * 14, 12);
    // Ratio 1 never changes the level; ratio below 1 is treated as 1 (never boosts).
    for (const x of [-100, -30, -24, -10, 0]) {
      expect(staticGainDb(x, -24, 1, 6)).toBe(0);
      expect(staticGainDb(x, -24, 0.5, 6)).toBe(0);
    }
  });

  it('is continuous across both knee boundaries and the hard-knee threshold (no jumps > 1e-9)', () => {
    const eps = 1e-9;
    for (const ratio of [1.5, 2, 4, 8, 20, 100]) {
      for (const threshold of [-60, -40, -24, -12, 0]) {
        for (const knee of [0.001, 1, 6, 12, 24]) {
          for (const edge of [threshold - knee / 2, threshold + knee / 2]) {
            const below = staticGainDb(edge - eps, threshold, ratio, knee);
            const at = staticGainDb(edge, threshold, ratio, knee);
            const above = staticGainDb(edge + eps, threshold, ratio, knee);
            expect(Math.abs(at - below)).toBeLessThan(1e-9);
            expect(Math.abs(above - at)).toBeLessThan(1e-9);
          }
        }
        const hardBelow = staticGainDb(threshold - eps, threshold, ratio, 0);
        const hardAbove = staticGainDb(threshold + eps, threshold, ratio, 0);
        expect(Math.abs(hardAbove - hardBelow)).toBeLessThan(1e-9);
      }
    }
  });

  it('is monotonic: the gain never rises with level, and the output level never falls', () => {
    for (const ratio of [1, 2, 4, 20, 100]) {
      for (const knee of [0, 6, 24]) {
        let previousGain = 0;
        let previousOutput = -Infinity;
        for (let x = -120; x <= 12; x += 0.05) {
          const gain = staticGainDb(x, -24, ratio, knee);
          expect(gain).toBeLessThanOrEqual(0);
          expect(gain).toBeLessThanOrEqual(previousGain + 1e-12);
          expect(x + gain).toBeGreaterThanOrEqual(previousOutput - 1e-12);
          previousGain = gain;
          previousOutput = x + gain;
        }
      }
    }
  });
});

describe('CompressorCore transparency', () => {
  it('ratio 1 is bit-exact at full scale, in stereo, for any threshold and knee', () => {
    const left = noise(0.5, 1, 1);
    const right = noise(0.5, 1, 2);
    for (const thresholdDb of [-60, -24, 0]) {
      for (const kneeDb of [0, 6, 24]) {
        const out = run([left, right], { thresholdDb, ratio: 1, attackMs: 1, releaseMs: 20, makeupDb: 0, kneeDb });
        expect(out[0]).toEqual(left);
        expect(out[1]).toEqual(right);
      }
    }
  });

  it('a signal below threshold − knee/2 passes bit-exact (hard and soft knee, noise and sine)', () => {
    const quietNoise = noise(1, fromDb(-40), 3); // peak ≤ −40 dBFS, edge is −27 dBFS
    const quietSine = sine(997, 1, fromDb(-35));
    for (const kneeDb of [0, 6]) {
      for (const ratio of [2, 20, 100]) {
        const params = { ...base, thresholdDb: -24, ratio, kneeDb };
        expect(run([quietNoise], params)[0]).toEqual(quietNoise);
        expect(run([quietSine], params)[0]).toEqual(quietSine);
      }
    }
  });

  it('returns to exactly unity gain after a loud passage (reduction snaps to 0)', () => {
    const loud = noise(0.3, 0.9, 4);
    const quiet = noise(2, fromDb(-50), 5);
    const input = new Float32Array(loud.length + quiet.length);
    input.set(loud);
    input.set(quiet, loud.length);
    const out = run([input], { ...base, thresholdDb: -20, ratio: 20, releaseMs: 20 })[0]!;
    // 30 dB of reduction at 20 ms decays below the 1e-9 dB snap within ~0.5 s; the last second must be untouched.
    const tail = input.length - SAMPLE_RATE;
    expect(out.subarray(tail)).toEqual(input.subarray(tail));
  });
});

describe('CompressorCore static accuracy', () => {
  it('steady-state gain of a 1 kHz sine matches staticGainDb of its PEAK level (±0.4 dB)', () => {
    let worst = 0;
    for (const ratio of [2, 4, 10, 20]) {
      for (const thresholdDb of [-12, -24, -40]) {
        for (const above of [3, 9, 18]) {
          const peakDb = Math.min(-0.5, thresholdDb + above);
          const input = sine(1000, 3, fromDb(peakDb));
          const params: CompressorParams = { thresholdDb, ratio, attackMs: 1, releaseMs: 1000, makeupDb: 0, kneeDb: 6 };
          const out = run([input], params)[0]!;
          const expected = staticGainDb(peakDb, thresholdDb, ratio, 6);
          const measured = gainDb(input, out, 2 * SAMPLE_RATE, 3 * SAMPLE_RATE);
          worst = Math.max(worst, Math.abs(measured - expected));
          expect(Math.abs(measured - expected), `R=${ratio} T=${thresholdDb} peak=${peakDb}`).toBeLessThan(0.4);
        }
      }
    }
    // Typically well under a tenth of a dB with a long release.
    expect(worst).toBeLessThan(0.4);
  });

  it('has no hidden make-up gain', () => {
    // The native DynamicsCompressorNode adds ~+12 dB of automatic make-up that depends on threshold/ratio.
    const input = sine(1000, 1, fromDb(-50));
    for (const thresholdDb of [-12, -24, -40]) {
      for (const ratio of [2, 8, 20]) {
        const out = run([input], { thresholdDb, ratio, attackMs: 5, releaseMs: 100, makeupDb: 0 })[0]!;
        expect(Math.abs(gainDb(input, out, 0, input.length)), `T=${thresholdDb} R=${ratio}`).toBeLessThan(0.01);
      }
    }
  });

  it('makeupDb adds exactly that gain on quiet signals', () => {
    const input = sine(1000, 0.5, fromDb(-50));
    for (const makeupDb of [-12, -3, 0, 0.5, 6, 12]) {
      const out = run([input], { ...base, makeupDb })[0]!;
      expect(Math.abs(gainDb(input, out, 0, input.length) - makeupDb)).toBeLessThan(1e-4);
      expect(Math.abs(toDb(Math.abs(out[1000]! / input[1000]!)) - makeupDb)).toBeLessThan(1e-4);
    }
  });

  it('makeupDb stacks on top of the reduction on loud signals', () => {
    const input = sine(1000, 3, fromDb(-3));
    const params: CompressorParams = { thresholdDb: -24, ratio: 4, attackMs: 1, releaseMs: 1000, makeupDb: 0 };
    const plain = run([input], params)[0]!;
    const boosted = run([input], { ...params, makeupDb: 6 })[0]!;
    const from = 2 * SAMPLE_RATE;
    expect(gainDb(plain, boosted, from, input.length)).toBeCloseTo(6, 3);
  });
});

describe('CompressorCore timing', () => {
  // A DC step has no detector ripple, so the one-pole envelope can be read off the gain directly.
  const level = 0.5; // −6.02 dBFS
  const threshold = -30;
  const ratio = 4;
  const finalReduction = -staticGainDb(toDb(level), threshold, ratio, 6); // ≈ 18 dB

  it('attack reaches ~63 % of the final reduction after attackMs', () => {
    for (const attackMs of [10, 50, 200]) {
      const input = steps([
        [0.2, 0.001],
        [1.5, level],
      ]);
      const start = Math.floor(0.2 * SAMPLE_RATE);
      const out = run([input], { thresholdDb: threshold, ratio, attackMs, releaseMs: 500, makeupDb: 0 })[0]!;
      const reductionAt = (ms: number) => -toDb(out[start + Math.round((ms / 1000) * SAMPLE_RATE)]! / level);
      const settled = reductionAt(1400);
      expect(settled).toBeCloseTo(finalReduction, 1);
      const fraction = reductionAt(attackMs) / settled;
      expect(fraction).toBeGreaterThan(0.632 * 0.75);
      expect(fraction).toBeLessThan(Math.min(1, 0.632 * 1.25));
      // Time at which 63.2 % is crossed is within ±25 % of attackMs.
      let crossing = 0;
      while (-toDb(out[start + crossing]! / level) < 0.632 * settled) crossing++;
      const crossingMs = (crossing / SAMPLE_RATE) * 1000;
      expect(crossingMs).toBeGreaterThan(attackMs * 0.75);
      expect(crossingMs).toBeLessThan(attackMs * 1.25);
    }
  });

  it('release recovers ~63 % after releaseMs (36.8 % of the reduction remains)', () => {
    for (const releaseMs of [50, 200, 800]) {
      const input = steps([
        [1.5, level],
        [3, 0.001],
      ]);
      const start = Math.floor(1.5 * SAMPLE_RATE);
      const out = run([input], { thresholdDb: threshold, ratio, attackMs: 5, releaseMs, makeupDb: 0 })[0]!;
      const reduction = (index: number) => -toDb(out[index]! / input[index]!);
      const before = reduction(start - 1);
      expect(before).toBeCloseTo(finalReduction, 1);
      let crossing = 0;
      while (reduction(start + crossing) > (1 - 0.632) * before) crossing++;
      const crossingMs = (crossing / SAMPLE_RATE) * 1000;
      expect(crossingMs).toBeGreaterThan(releaseMs * 0.75);
      expect(crossingMs).toBeLessThan(releaseMs * 1.25);
    }
  });
});

describe('CompressorCore stereo and blocks', () => {
  it('links channels: a hot left channel reduces the quiet right channel by the same amount', () => {
    const left = sine(1000, 2, fromDb(-3));
    const right = sine(1000, 2, fromDb(-50));
    const params: CompressorParams = { thresholdDb: -24, ratio: 8, attackMs: 1, releaseMs: 500, makeupDb: 0 };
    const [outLeft, outRight] = run([left, right], params);
    const from = SAMPLE_RATE;
    const leftGain = gainDb(left, outLeft!, from, left.length);
    const rightGain = gainDb(right, outRight!, from, right.length);
    expect(leftGain).toBeLessThan(-10);
    expect(rightGain).toBeCloseTo(leftGain, 6);
    // The same quiet right channel on its own would not be touched at all.
    expect(run([right], params)[0]).toEqual(right);
  });

  it('is bit-identical whether processed in 128-sample blocks or in one block', () => {
    const left = noise(1.2, 0.8, 6);
    const right = Float32Array.from(left, (v, i) => v * 0.3 + 0.2 * Math.sin(i / 20));
    const params: CompressorParams = { thresholdDb: -30, ratio: 6, attackMs: 3, releaseMs: 120, makeupDb: 2, kneeDb: 8 };
    const whole = run([left, right], params);
    const core = new CompressorCore(SAMPLE_RATE);
    const outputs = [new Float32Array(left.length), new Float32Array(left.length)];
    for (let start = 0; start < left.length; start += 128) {
      const frames = Math.min(128, left.length - start);
      core.process(
        [left.subarray(start, start + frames), right.subarray(start, start + frames)],
        outputs.map((o) => o.subarray(start, start + frames)),
        frames,
        params,
      );
    }
    expect(outputs[0]).toEqual(whole[0]);
    expect(outputs[1]).toEqual(whole[1]);

    // Same through the shared helper (mono source copied to two channels).
    const mono = noise(0.5, 0.9, 7);
    const helperCore = new CompressorCore(SAMPLE_RATE);
    const blocked = runInBlocks(mono, 2, (i, o, f) => helperCore.process(i, o, f, params));
    const single = run([mono, mono], params);
    expect(blocked[0]).toEqual(single[0]);
    expect(blocked[1]).toEqual(single[1]);
  });

  it('works for mono input with two outputs (missing channel is silent) and for other channel counts', () => {
    const input = sine(1000, 0.5, 0.5);
    const outputs = [new Float32Array(input.length).fill(9), new Float32Array(input.length).fill(9)];
    new CompressorCore(SAMPLE_RATE).process([input], outputs, input.length, base);
    expect(outputs[0]!.every(Number.isFinite)).toBe(true);
    expect(outputs[1]!.every((v) => v === 0)).toBe(true);
    expect(outputs[0]).toEqual(run([input], base)[0]);

    const six = Array.from({ length: 6 }, (_, c) => sine(500 + 100 * c, 0.3, 0.4));
    const out = run(six, base);
    expect(out).toHaveLength(6);
    out.forEach((channel) => expect(channel.every(Number.isFinite)).toBe(true));
    // All channels share one gain: the ratio out/in is the same wherever both are non-trivial.
    const index = 1234;
    const ratios = out.map((channel, c) => channel[index]! / six[c]![index]!);
    ratios.forEach((r) => expect(r).toBeCloseTo(ratios[0]!, 5));
  });

  it('supports in-place processing (outputs aliasing inputs)', () => {
    const input = noise(0.3, 0.9, 8);
    const expected = run([input], base)[0]!;
    const inPlace = Float32Array.from(input);
    new CompressorCore(SAMPLE_RATE).process([inPlace], [inPlace], inPlace.length, base);
    expect(inPlace).toEqual(expected);
  });
});

describe('CompressorCore robustness', () => {
  it('stays finite with full-scale noise, ratio 100, tiny attack, +/-Infinity and NaN samples', () => {
    const hot = noise(0.5, 1, 9);
    const cases: CompressorParams[] = [
      { thresholdDb: -100, ratio: 100, attackMs: 0, releaseMs: 0, makeupDb: 12, kneeDb: 24 },
      { thresholdDb: 0, ratio: 100, attackMs: 0.001, releaseMs: 1, makeupDb: -12, kneeDb: 0 },
      { thresholdDb: -60, ratio: 20, attackMs: 1, releaseMs: 1000, makeupDb: 0 },
    ];
    for (const params of cases) {
      const core = new CompressorCore(SAMPLE_RATE);
      const out = run([hot, hot], params, core);
      out.forEach((channel) => expect(channel.every(Number.isFinite)).toBe(true));
      expect(Number.isFinite(core.maxReductionDb)).toBe(true);
    }
    const spiky = Float32Array.from(hot, (v, i) => (i === 100 ? Infinity : i === 200 ? -Infinity : v));
    const core = new CompressorCore(SAMPLE_RATE);
    const out = run([spiky], cases[2]!, core)[0]!;
    expect(out[100]).toBe(Infinity); // the gain stays finite, so ∞ passes through as ∞ instead of becoming ∞·0 = NaN
    expect(out.subarray(300).every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(core.maxReductionDb)).toBe(true);
  });

  it('survives non-finite and out-of-range parameters', () => {
    const input = noise(0.3, 0.7, 10);
    const bad: CompressorParams[] = [
      { thresholdDb: NaN, ratio: NaN, attackMs: NaN, releaseMs: NaN, makeupDb: NaN, kneeDb: NaN },
      { thresholdDb: Infinity, ratio: -Infinity, attackMs: -5, releaseMs: -5, makeupDb: Infinity },
      { thresholdDb: 50, ratio: 1e9, attackMs: 1e9, releaseMs: 1e9, makeupDb: -1e9, kneeDb: 1e9 },
    ];
    for (const params of bad) {
      const out = run([input], params)[0]!;
      expect(out.every(Number.isFinite)).toBe(true);
    }
    // Out-of-range values clamp: a threshold above 0 behaves like 0 dB, ratio above 100 like 100.
    const clamped = run([input], { thresholdDb: 0, ratio: 100, attackMs: 5, releaseMs: 50, makeupDb: 0, kneeDb: 24 });
    const wild = run([input], { thresholdDb: 40, ratio: 1e6, attackMs: 5, releaseMs: 50, makeupDb: 0, kneeDb: 99 });
    expect(wild[0]).toEqual(clamped[0]);
  });

  it('reset() clears the envelope and maxReductionDb', () => {
    const loud = sine(1000, 0.3, 0.9);
    const core = new CompressorCore(SAMPLE_RATE);
    const params: CompressorParams = { thresholdDb: -30, ratio: 10, attackMs: 2, releaseMs: 1000, makeupDb: 0 };
    const first = run([loud], params, core)[0]!;
    expect(core.maxReductionDb).toBeGreaterThan(10);
    core.reset();
    expect(core.maxReductionDb).toBe(0);
    const second = run([loud], params, core)[0]!;
    expect(second).toEqual(first); // identical to a fresh core
    // Without reset the long release leaves the second run reduced from sample 0.
    const carried = run([loud], params, new CompressorCore(SAMPLE_RATE));
    const quietAfter = sine(1000, 0.05, fromDb(-20));
    const resumed = run([quietAfter], params, core)[0]!;
    core.reset();
    const fresh = run([quietAfter], params, core)[0]!;
    expect(carried[0]).toEqual(first);
    expect(Math.abs(rms(resumed) - rms(quietAfter))).toBeGreaterThan(0.01 * rms(quietAfter));
    expect(fresh).toEqual(run([quietAfter], params)[0]);
  });

  it('maxReductionDb is sane: 0 for transparent material, close to the static reduction for loud steady input', () => {
    const quiet = sine(1000, 0.5, fromDb(-50));
    const core = new CompressorCore(SAMPLE_RATE);
    run([quiet], base, core);
    expect(core.maxReductionDb).toBe(0);

    const level = 0.5;
    const hot = steps([[1.5, level]]);
    const params: CompressorParams = { thresholdDb: -30, ratio: 4, attackMs: 5, releaseMs: 100, makeupDb: 0 };
    const hotCore = new CompressorCore(SAMPLE_RATE);
    run([hot], params, hotCore);
    const expected = -staticGainDb(toDb(level), -30, 4, 6);
    expect(hotCore.maxReductionDb).toBeGreaterThan(expected - 0.01);
    expect(hotCore.maxReductionDb).toBeLessThanOrEqual(expected + 1e-9);
    // Releasing afterwards does not lower the recorded maximum.
    run([steps([[0.5, 0.001]])], params, hotCore);
    expect(hotCore.maxReductionDb).toBeGreaterThan(expected - 0.01);
  });
});
