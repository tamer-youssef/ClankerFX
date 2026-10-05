import { chainForJob, type BatchJob } from '../batch/plan';
import type { LoadedFile } from '../types/audio';
import type { EffectState } from '../types/effects';
import type { ExportSettings, Measurements, NormalizationSettings } from '../types/output';
import type { MutationIntensity } from '../types/presets';
import { createZip } from '../utils/zip';
import { downloadBlob, exportProcessed, type ExportJob, type ExportResult } from './exporter';

export interface BatchItemResult {
  jobId: string;
  outputName: string;
  ok: boolean;
  /** Friendly message when `ok` is false. */
  error?: string;
  measurements?: Measurements;
  sampleRate?: number;
  channelCount?: number;
  clippedSamples?: number;
  bytes?: Uint8Array;
}

export interface BatchProgress {
  completed: number;
  total: number;
  /** Output name currently being rendered, or null when finished. */
  current: string | null;
}

export interface BatchRunArgs {
  jobs: readonly BatchJob[];
  files: ReadonlyMap<string, LoadedFile>;
  chain: readonly EffectState[];
  normalization: NormalizationSettings;
  settings: ExportSettings;
  /** Mutation strength for variation jobs. */
  intensity: MutationIntensity;
  onProgress?: (progress: BatchProgress) => void;
  isCancelled?: () => boolean;
  /** Injectable for tests; defaults to the real offline export. */
  exportFn?: (job: ExportJob) => Promise<ExportResult>;
}

function friendlyError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Processing failed';
}

/**
 * Processes jobs one at a time (rendering is CPU-heavy and runs faster than realtime, so parallelism would only
 * fight over memory). One failing file never stops the rest. Every file gets the same effect chain and the same
 * normalisation settings, so with "Match loudness" they all land on the same target.
 */
export async function runBatch(args: BatchRunArgs): Promise<BatchItemResult[]> {
  const { jobs, files, chain, normalization, settings, intensity, onProgress, isCancelled } = args;
  const exportFn = args.exportFn ?? exportProcessed;
  const results: BatchItemResult[] = [];

  for (const [index, job] of jobs.entries()) {
    if (isCancelled?.()) break;
    onProgress?.({ completed: index, total: jobs.length, current: job.outputName });
    const file = files.get(job.fileId);
    if (!file) {
      results.push({ jobId: job.id, outputName: job.outputName, ok: false, error: 'The source file was removed' });
      continue;
    }
    try {
      const exported = await exportFn({ file, chain: chainForJob(chain, job, intensity), normalization, settings, filename: job.outputName });
      results.push({
        jobId: job.id,
        outputName: exported.filename,
        ok: true,
        measurements: exported.measurements,
        sampleRate: exported.sampleRate,
        channelCount: exported.channelCount,
        clippedSamples: exported.clippedSamples,
        bytes: new Uint8Array(await exported.blob.arrayBuffer()),
      });
    } catch (error) {
      results.push({ jobId: job.id, outputName: job.outputName, ok: false, error: friendlyError(error) });
    }
  }
  onProgress?.({ completed: results.length, total: jobs.length, current: null });
  return results;
}

export interface BatchSummary {
  succeeded: number;
  failed: number;
  /** Files that still contain clipped samples or exceed 0 dBFS. */
  clipped: number;
  totalBytes: number;
}

export function summarizeBatch(results: readonly BatchItemResult[]): BatchSummary {
  let clipped = 0;
  let totalBytes = 0;
  for (const result of results) {
    if (!result.ok) continue;
    totalBytes += result.bytes?.length ?? 0;
    if (result.measurements?.clipped || (result.clippedSamples ?? 0) > 0) clipped++;
  }
  const succeeded = results.filter((result) => result.ok).length;
  return { succeeded, failed: results.length - succeeded, clipped, totalBytes };
}

export type BatchPackaging = 'zip' | 'separate';

/** One ZIP of all successful files (a single download prompt) — or one download per file. Nothing is uploaded. */
export async function downloadBatch(results: readonly BatchItemResult[], packaging: BatchPackaging, archiveName = 'mechvox_batch.zip'): Promise<void> {
  const ready = results.filter((result): result is BatchItemResult & { bytes: Uint8Array } => result.ok && result.bytes !== undefined);
  if (ready.length === 0) throw new Error('There are no processed files to download');

  if (packaging === 'zip') {
    const archive = createZip(ready.map((result) => ({ name: result.outputName, data: result.bytes })));
    downloadBlob(new Blob([archive], { type: 'application/zip' }), archiveName);
    return;
  }
  for (const result of ready) {
    downloadBlob(new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), result.outputName);
    // Browsers drop rapid-fire programmatic downloads; a short gap keeps all of them.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
