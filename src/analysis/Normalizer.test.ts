import { describe, expect, it } from 'vitest';
import { defaultNormalization, type NormalizationSettings } from '../types/output';
import { applyGainDb, computeNormalizationGain, MAX_GAIN_DB } from './Normalizer';

const settings = (patch: Partial<NormalizationSettings>): NormalizationSettings => ({ ...defaultNormalization, ...patch });

describe('computeNormalizationGain', () => {
  it('off -> 0 dB', () => {
    expect(computeNormalizationGain(settings({ mode: 'off' }), { samplePeak: 0.1, loudnessLufs: -30 })).toEqual({ gainDb: 0 });
  });

  it('peak mode brings the peak to the target', () => {
    const { gainDb, warning } = computeNormalizationGain(settings({ mode: 'peak', peakTargetDb: -1 }), { samplePeak: 0.5, loudnessLufs: null });
    expect(gainDb).toBeCloseTo(-1 + 6.0206, 3);
    expect(warning).toBeUndefined();
  });

  it('peak mode on silence gives 0 dB with a warning', () => {
    for (const samplePeak of [0, 1e-12, NaN]) {
      expect(computeNormalizationGain(settings({ mode: 'peak' }), { samplePeak, loudnessLufs: null })).toEqual({ gainDb: 0, warning: 'Signal is silent' });
    }
  });

  it('loudness mode moves the loudness to the target', () => {
    const { gainDb } = computeNormalizationGain(settings({ mode: 'loudness', loudnessTargetLufs: -20 }), { samplePeak: 0.3, loudnessLufs: -26.5 });
    expect(gainDb).toBeCloseTo(6.5, 10);
  });

  it('loudness mode with null loudness gives 0 dB with a warning', () => {
    expect(computeNormalizationGain(settings({ mode: 'loudness' }), { samplePeak: 0.3, loudnessLufs: null })).toEqual({
      gainDb: 0,
      warning: 'Too quiet to measure loudness',
    });
  });

  it('clamps to +-24 dB and warns', () => {
    const up = computeNormalizationGain(settings({ mode: 'peak', peakTargetDb: 0 }), { samplePeak: 1e-6, loudnessLufs: null });
    expect(up.gainDb).toBe(MAX_GAIN_DB);
    expect(up.warning).toMatch(/limited/i);
    const down = computeNormalizationGain(settings({ mode: 'loudness', loudnessTargetLufs: -60 }), { samplePeak: 1, loudnessLufs: 0 });
    expect(down.gainDb).toBe(-MAX_GAIN_DB);
    expect(down.warning).toBeDefined();
  });

  it('never returns NaN or Infinity', () => {
    for (const mode of ['peak', 'loudness'] as const) {
      for (const samplePeak of [0, Infinity, NaN, 1e-300]) {
        for (const loudnessLufs of [null, -Infinity, NaN, Infinity, 5]) {
          expect(Number.isFinite(computeNormalizationGain(settings({ mode }), { samplePeak, loudnessLufs }).gainDb)).toBe(true);
        }
      }
    }
  });
});

describe('applyGainDb', () => {
  it('returns new scaled arrays and leaves the input untouched', () => {
    const input = [Float32Array.of(0.5, -0.25), Float32Array.of(1, 0)];
    const out = applyGainDb(input, 6.0206);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]![0]).toBeCloseTo(1, 4);
    expect(out[0]![1]).toBeCloseTo(-0.5, 4);
    expect(out[1]![0]).toBeCloseTo(2, 4);
    expect(input[0]![0]).toBe(0.5);
  });
  it('0 dB is an exact copy', () => {
    const input = [Float32Array.of(0.123, -0.456)];
    const out = applyGainDb(input, 0);
    expect(out[0]).toEqual(input[0]);
    expect(out[0]).not.toBe(input[0]);
  });
});
