import { describe, expect, it } from 'vitest';
import { computePeaks, computePeaksAsync, resamplePeaks } from './waveformPeaks';

describe('computePeaks', () => {
  it('finds min and max per bucket', () => {
    const signal = new Float32Array([0, 0.5, -0.25, 0.1, -0.9, 0.2, 0, 0.75]);
    const peaks = computePeaks([signal], 4);
    // Float32Array storage means values like 0.1 are not exact doubles.
    [0.5, 0.1, 0.2, 0.75].forEach((expected, i) => expect(peaks.max[i]).toBeCloseTo(expected, 6));
    [0, -0.25, -0.9, 0].forEach((expected, i) => expect(peaks.min[i]).toBeCloseTo(expected, 6));
  });

  it('merges channels', () => {
    const left = new Float32Array([0.2, 0.2]);
    const right = new Float32Array([-0.8, 0.9]);
    const peaks = computePeaks([left, right], 1);
    expect(peaks.max[0]).toBeCloseTo(0.9);
    expect(peaks.min[0]).toBeCloseTo(-0.8);
  });

  it('handles fewer samples than buckets without NaNs', () => {
    const peaks = computePeaks([new Float32Array([0.5, -0.5])], 8);
    for (const value of [...peaks.min, ...peaks.max]) expect(Number.isFinite(value)).toBe(true);
  });

  it('returns zeros for empty audio', () => {
    const peaks = computePeaks([new Float32Array(0)], 4);
    expect(Array.from(peaks.max)).toEqual([0, 0, 0, 0]);
  });
});

describe('computePeaksAsync', () => {
  it('matches the synchronous result', async () => {
    const signal = Float32Array.from({ length: 10_000 }, (_, i) => Math.sin(i / 50));
    const expected = computePeaks([signal], 256);
    const actual = await computePeaksAsync([signal], 256);
    expect(actual).not.toBeNull();
    expect(Array.from(actual!.max)).toEqual(Array.from(expected.max));
  });

  it('stops when cancelled', async () => {
    const signal = new Float32Array(1000);
    expect(await computePeaksAsync([signal], 64, () => true)).toBeNull();
  });
});

describe('resamplePeaks', () => {
  const peaks = computePeaks([new Float32Array([0.1, 0.9, -0.2, -0.7])], 4);

  it('keeps transients when downsampling', () => {
    const out = resamplePeaks(peaks, 2);
    expect(out.max[0]).toBeCloseTo(0.9);
    expect(out.min[1]).toBeCloseTo(-0.7);
  });

  it('repeats buckets when upsampling', () => {
    const out = resamplePeaks(peaks, 8);
    expect(out.max.length).toBe(8);
    expect(out.max[2]).toBeCloseTo(0.9);
    expect(out.max[3]).toBeCloseTo(0.9);
  });
});
