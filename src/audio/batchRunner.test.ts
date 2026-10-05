import { describe, expect, it } from 'vitest';
import type { BatchJob } from '../batch/plan';
import { createEffectState } from '../effects/registry';
import type { LoadedFile } from '../types/audio';
import { defaultExportSettings, defaultNormalization, type Measurements } from '../types/output';
import { runBatch, summarizeBatch, type BatchItemResult } from './batchRunner';
import type { ExportJob, ExportResult } from './exporter';

const file = (id: string): LoadedFile => ({ id, name: `${id}.wav`, sizeBytes: 1, buffer: {} as AudioBuffer, sourceSampleRate: null });
const files = new Map(['a', 'b', 'c'].map((id) => [id, file(id)]));
const job = (fileId: string, variantIndex: number | null = null): BatchJob => ({
  id: `${fileId}:${variantIndex ?? 'processed'}`,
  fileId,
  sourceName: `${fileId}.wav`,
  outputName: variantIndex === null ? `${fileId}_processed.wav` : `${fileId}_0${variantIndex}.wav`,
  variantIndex,
  seed: variantIndex === null ? null : 100 + variantIndex,
});
const measurements: Measurements = {
  inputPeakDb: -6, outputPeakDb: -3, loudnessLufs: -25, finalLoudnessLufs: -20, gainDb: 5, limiterReductionDb: 0,
  finalPeakDb: -1, finalTruePeakDb: -1, clipped: false,
};
const fakeExport = async (j: ExportJob): Promise<ExportResult> => ({
  blob: new Blob([new Uint8Array([1, 2, 3])]),
  filename: j.filename ?? 'x.wav',
  measurements,
  sampleRate: 44100,
  channelCount: 1,
  clippedSamples: 0,
});
const base = { files, chain: [createEffectState('ringmod')!], normalization: defaultNormalization, settings: defaultExportSettings, intensity: 'medium' as const };

describe('runBatch', () => {
  it('processes jobs in order with the same normalisation settings and the planned filenames', async () => {
    const seen: ExportJob[] = [];
    const results = await runBatch({ ...base, jobs: [job('a'), job('b')], exportFn: async (j) => (seen.push(j), fakeExport(j)) });
    expect(results.map((r) => r.outputName)).toEqual(['a_processed.wav', 'b_processed.wav']);
    expect(results.every((r) => r.ok && r.bytes?.length === 3)).toBe(true);
    expect(seen.every((j) => j.normalization === defaultNormalization)).toBe(true);
    expect(seen.map((j) => j.file.id)).toEqual(['a', 'b']);
  });

  it('gives variation jobs a mutated chain and processed jobs the original chain', async () => {
    const seen: ExportJob[] = [];
    await runBatch({ ...base, intensity: 'heavy', jobs: [job('a'), job('a', 1), job('a', 2)], exportFn: async (j) => (seen.push(j), fakeExport(j)) });
    expect(seen[0]!.chain).toEqual(base.chain);
    expect(seen[1]!.chain).not.toEqual(base.chain);
    expect(seen[1]!.chain).not.toEqual(seen[2]!.chain);
  });

  it('isolates failures: one bad file does not stop the rest', async () => {
    const results = await runBatch({
      ...base,
      jobs: [job('a'), job('b'), job('c')],
      exportFn: async (j) => {
        if (j.file.id === 'b') throw new Error('decode exploded');
        return fakeExport(j);
      },
    });
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]!.error).toBe('decode exploded');
  });

  it('reports a removed source file instead of throwing', async () => {
    const results = await runBatch({ ...base, jobs: [job('zzz')], exportFn: fakeExport });
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/removed/i) });
  });

  it('reports progress and supports cancellation between files', async () => {
    const progress: number[] = [];
    let cancelled = false;
    const results = await runBatch({
      ...base,
      jobs: [job('a'), job('b'), job('c')],
      onProgress: (p) => progress.push(p.completed),
      isCancelled: () => cancelled,
      exportFn: async (j) => {
        if (j.file.id === 'a') cancelled = true;
        return fakeExport(j);
      },
    });
    expect(results).toHaveLength(1);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it('handles an empty plan', async () => {
    expect(await runBatch({ ...base, jobs: [], exportFn: fakeExport })).toEqual([]);
  });
});

describe('summarizeBatch', () => {
  const ok = (extra: Partial<BatchItemResult> = {}): BatchItemResult => ({ jobId: 'x', outputName: 'x.wav', ok: true, bytes: new Uint8Array(10), measurements, clippedSamples: 0, ...extra });
  it('counts successes, failures, clipped files and bytes', () => {
    const summary = summarizeBatch([
      ok(),
      ok({ clippedSamples: 4 }),
      ok({ measurements: { ...measurements, clipped: true } }),
      { jobId: 'y', outputName: 'y.wav', ok: false, error: 'bad' },
    ]);
    expect(summary).toEqual({ succeeded: 3, failed: 1, clipped: 2, totalBytes: 30 });
  });
});
