import { describe, expect, it } from 'vitest';
import {
  RECORDING_LIMIT_SECONDS,
  assembleChunks,
  chunksSampleCount,
  formatRecordingClock,
  maxRecordingSamples,
  peakOf,
  peakToMeter,
  recordingFilename,
} from './recordingChunks';

describe('recordingChunks', () => {
  it('limit is ten minutes', () => {
    expect(RECORDING_LIMIT_SECONDS).toBe(600);
  });

  it('counts samples', () => {
    expect(chunksSampleCount([])).toBe(0);
    expect(chunksSampleCount([new Float32Array(3), new Float32Array(0), new Float32Array(5)])).toBe(8);
  });

  it('computes the sample limit', () => {
    expect(maxRecordingSamples(48000, 600)).toBe(28_800_000);
    expect(maxRecordingSamples(44100)).toBe(44100 * 600);
    expect(maxRecordingSamples(44100, 0.5)).toBe(22050);
    expect(maxRecordingSamples(0, 10)).toBe(0);
    expect(maxRecordingSamples(48000, -1)).toBe(0);
    expect(maxRecordingSamples(NaN, 1)).toBe(0);
  });

  it('assembles nothing into an empty array', () => {
    expect(assembleChunks([]).length).toBe(0);
    expect(assembleChunks([new Float32Array(0)]).length).toBe(0);
  });

  it('assembles in order', () => {
    const out = assembleChunks([Float32Array.of(1, 2), Float32Array.of(3), Float32Array.of(4, 5, 6)]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('assembles many small chunks into one allocation', () => {
    const chunks = Array.from({ length: 5000 }, (_, i) => Float32Array.of(i, i + 0.5));
    const out = assembleChunks(chunks);
    expect(out.length).toBe(10_000);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0.5);
    expect(out[9998]).toBe(4999);
    expect(out[9999]).toBe(4999.5);
    for (let i = 1; i < out.length; i++) expect(out[i]! > out[i - 1]!).toBe(true);
  });

  it('does not alias its inputs', () => {
    const chunk = Float32Array.of(1, 2, 3);
    const out = assembleChunks([chunk]);
    chunk[0] = 99;
    expect(out[0]).toBe(1);
  });

  it('truncates to maxSamples, including mid-chunk', () => {
    const chunks = [Float32Array.of(1, 2, 3), Float32Array.of(4, 5, 6)];
    expect(Array.from(assembleChunks(chunks, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(assembleChunks(chunks, 3))).toEqual([1, 2, 3]);
    expect(Array.from(assembleChunks(chunks, 100))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(assembleChunks(chunks, 0).length).toBe(0);
    expect(assembleChunks(chunks, -5).length).toBe(0);
  });

  it('finds the peak', () => {
    expect(peakOf(new Float32Array(0))).toBe(0);
    expect(peakOf(Float32Array.of(0.1, -0.7, 0.3))).toBeCloseTo(0.7);
  });

  it('maps peaks to a dB meter', () => {
    expect(peakToMeter(0)).toBe(0);
    expect(peakToMeter(1)).toBe(1);
    expect(peakToMeter(2)).toBe(1);
    expect(peakToMeter(0.001)).toBeCloseTo(0);
    expect(peakToMeter(0.0001)).toBe(0);
    expect(peakToMeter(0.1)).toBeCloseTo(2 / 3);
    expect(peakToMeter(NaN)).toBe(0);
  });

  it('formats the clock', () => {
    expect(formatRecordingClock(0)).toBe('00:00.00');
    expect(formatRecordingClock(5.2)).toBe('00:05.20');
    expect(formatRecordingClock(65.999)).toBe('01:05.99');
    expect(formatRecordingClock(600)).toBe('10:00.00');
    expect(formatRecordingClock(-3)).toBe('00:00.00');
    expect(formatRecordingClock(NaN)).toBe('00:00.00');
  });

  it('names recordings by local time', () => {
    expect(recordingFilename(new Date(2026, 0, 5, 9, 3, 7))).toBe('recording-20260105-090307.wav');
    expect(recordingFilename(new Date(2026, 11, 31, 23, 59, 59))).toBe('recording-20261231-235959.wav');
  });
});
