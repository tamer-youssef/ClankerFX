import { describe, expect, it } from 'vitest';
import { samplePeak, truePeak } from '../analysis/PeakAnalyzer';
import { measureLoudness } from '../analysis/LoudnessAnalyzer';
import { sine } from '../dsp/testSignals';
import { defaultNormalization, type NormalizationSettings } from '../types/output';
import { finalizeOutput } from './OutputPipeline';

const SR = 48000;
const stereo = (data: Float32Array) => [data, data.slice()];
const settings = (changes: Partial<NormalizationSettings>): NormalizationSettings => ({ ...defaultNormalization, ...changes });
const run = (channels: Float32Array[], changes: Partial<NormalizationSettings>, inputPeak = 0.5) =>
  finalizeOutput({ rendered: channels, sampleRate: SR, inputPeak, settings: settings(changes) }, true);

describe('finalizeOutput', () => {
  it('peak mode brings the sample peak to the target', () => {
    const out = run(stereo(sine(440, 1, 0.25, SR)), { mode: 'peak', peakTargetDb: -3, limiterEnabled: false });
    expect(samplePeak(out.channels!)).toBeCloseTo(Math.pow(10, -3 / 20), 3);
    expect(out.measurements.gainDb).toBeCloseTo(-3 + 12.04, 1);
    expect(out.measurements.clipped).toBe(false);
  });

  it('loudness mode reaches the target LUFS', () => {
    const out = run(stereo(sine(1000, 3, 0.05, SR)), { mode: 'loudness', loudnessTargetLufs: -20, limiterEnabled: true, ceilingDb: -1 });
    expect(measureLoudness(out.channels!, SR).lufs!).toBeCloseTo(-20, 0);
  });

  it('matches loudness across files of very different levels', () => {
    const quiet = run(stereo(sine(500, 3, 0.02, SR)), { mode: 'loudness', loudnessTargetLufs: -22 });
    const loud = run(stereo(sine(500, 3, 0.4, SR)), { mode: 'loudness', loudnessTargetLufs: -22 });
    expect(Math.abs(measureLoudness(quiet.channels!, SR).lufs! - measureLoudness(loud.channels!, SR).lufs!)).toBeLessThan(0.3);
  });

  it('limiter keeps true peak under the ceiling when loudness matching asks for more headroom than exists', () => {
    // Peaky signal: loud bursts over a quiet bed, matched hot.
    const bed = sine(300, 3, 0.02, SR);
    for (let i = 0; i < bed.length; i += 24000) for (let j = 0; j < 200; j++) bed[i + j] = 0.9 * Math.sin(j / 4);
    const out = run(stereo(bed), { mode: 'loudness', loudnessTargetLufs: -14, limiterEnabled: true, ceilingDb: -1, truePeak: true });
    expect(truePeak(out.channels!)).toBeLessThanOrEqual(Math.pow(10, (-1 + 0.06) / 20));
    expect(out.measurements.limiterReductionDb).toBeGreaterThan(0.5);
    expect(out.measurements.clipped).toBe(false);
  });

  it('reports clipping when the limiter is off and the gain pushes past full scale', () => {
    const out = run(stereo(sine(440, 1, 0.5, SR)), { mode: 'peak', peakTargetDb: 3, limiterEnabled: false });
    expect(out.measurements.clipped).toBe(true);
    expect(out.measurements.finalPeakDb).toBeGreaterThan(0);
  });

  it('off mode leaves the level alone', () => {
    const input = stereo(sine(440, 1, 0.3, SR));
    const out = run(input, { mode: 'off', limiterEnabled: false });
    expect(out.measurements.gainDb).toBe(0);
    expect(Array.from(out.channels![0]!.slice(0, 100))).toEqual(Array.from(input[0]!.slice(0, 100)));
  });

  it('warns on silence and applies no gain', () => {
    const out = run(stereo(new Float32Array(SR)), { mode: 'peak' }, 0);
    expect(out.measurements.gainDb).toBe(0);
    expect(out.measurements.warning).toMatch(/silent/i);
    expect(out.measurements.loudnessLufs).toBeNull();
  });

  it('reports input and output peaks and measurements-only mode returns no audio', () => {
    const out = finalizeOutput({ rendered: stereo(sine(440, 1, 0.25, SR)), sampleRate: SR, inputPeak: 0.5, settings: defaultNormalization }, false);
    expect(out.channels).toBeUndefined();
    expect(out.measurements.inputPeakDb).toBeCloseTo(-6.02, 1);
    expect(out.measurements.outputPeakDb).toBeCloseTo(-12.04, 1);
  });

  it('does not mutate its input', () => {
    const input = stereo(sine(440, 0.5, 0.25, SR));
    const copy = input[0]!.slice();
    run(input, { mode: 'peak' });
    expect(Array.from(input[0]!)).toEqual(Array.from(copy));
  });
});
