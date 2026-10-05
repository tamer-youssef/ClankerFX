import { convertChannels } from '../dsp/channels';
import type { LoadedFile } from '../types/audio';
import type { EffectState } from '../types/effects';
import type { ExportSettings, Measurements, NormalizationSettings } from '../types/output';
import { processedFilename } from '../utils/filenames';
import { samplePeak } from '../analysis/PeakAnalyzer';
import { renderChain } from './OfflineRenderer';
import { runOutputStage } from './outputRunner';
import { encodeWav } from './WavEncoder';

export interface ExportResult {
  blob: Blob;
  filename: string;
  measurements: Measurements;
  sampleRate: number;
  channelCount: number;
  /** Samples that exceeded full scale and were clipped while writing (0 when the limiter did its job). */
  clippedSamples: number;
}

/** "Original" keeps the source file's rate when the header revealed it, otherwise the decoded (context) rate. */
export function resolveTargetSampleRate(settings: ExportSettings, sourceSampleRate: number | null, contextRate: number): number {
  if (settings.sampleRate !== 'original') return settings.sampleRate;
  return sourceSampleRate ?? contextRate;
}

export interface ExportJob {
  file: LoadedFile;
  chain: readonly EffectState[];
  normalization: NormalizationSettings;
  settings: ExportSettings;
  /** Output filename; defaults to `<name><suffix>.wav`. Batch export passes its own (e.g. variations). */
  filename?: string;
}

/**
 * Full export, entirely local: chain (offline render) → resample → normalise → limit → channel conversion → WAV bytes.
 * The gain/limiter stage is the same function the live measurement uses, so the numbers shown in the UI are the file's.
 */
export async function exportProcessed(job: ExportJob): Promise<ExportResult> {
  const { file, chain, normalization, settings } = job;
  const rendered = await renderChain(file.buffer, chain);
  const targetRate = resolveTargetSampleRate(settings, file.sourceSampleRate, rendered.sampleRate);

  const sourceChannels = Array.from({ length: file.buffer.numberOfChannels }, (_, i) => file.buffer.getChannelData(i));
  const output = await runOutputStage(
    { rendered: rendered.channels, sampleRate: rendered.sampleRate, inputPeak: samplePeak(sourceChannels), settings: normalization, resampleTo: targetRate },
    true,
  );
  if (!output.channels) throw new Error('The output stage returned no audio');

  const channels = convertChannels(output.channels, settings.channels);
  const encoded = encodeWav(channels, output.sampleRate, { bitDepth: settings.bitDepth, dither: settings.bitDepth === 16 });

  return {
    blob: new Blob([encoded.bytes], { type: 'audio/wav' }),
    filename: job.filename ?? processedFilename(file.name, settings.filenameSuffix),
    measurements: output.measurements,
    sampleRate: output.sampleRate,
    channelCount: channels.length,
    clippedSamples: encoded.clippedSamples,
  };
}

/** Saves a blob through a temporary download link. Nothing leaves the device. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the browser has had time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
