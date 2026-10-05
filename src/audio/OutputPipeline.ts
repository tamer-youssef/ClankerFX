import { measureLoudness } from '../analysis/LoudnessAnalyzer';
import { applyGainDb, computeNormalizationGain } from '../analysis/Normalizer';
import { linearToDb, samplePeak, truePeak } from '../analysis/PeakAnalyzer';
import { limitBuffer } from '../dsp/LimiterCore';
import { resampleChannels } from '../dsp/resample';
import type { Measurements, NormalizationSettings } from '../types/output';

export interface FinalizeInput {
  /** Audio after the effect chain, before any level processing. */
  rendered: readonly Float32Array[];
  sampleRate: number;
  /** Sample peak (linear) of the original source, for the "input peak" readout. */
  inputPeak: number;
  settings: NormalizationSettings;
  /** Convert to this sample rate first, so gain and limiting are applied to (and measured on) the audio that is written. */
  resampleTo?: number;
}

export interface FinalizeOutput {
  /** Sample rate of `channels` (differs from the input when `resampleTo` was used). */
  sampleRate: number;
  measurements: Measurements;
  /** Final audio; omitted when only measurements were requested. */
  channels?: Float32Array[];
}

/**
 * The output stage, shared by the live measurement and by export so they cannot disagree:
 *   effect chain → normalisation gain (peak or loudness) → limiter → final measurements.
 * Normalisation is measured on the processed audio because effects change loudness.
 */
export function finalizeOutput(input: FinalizeInput, returnAudio: boolean): FinalizeOutput {
  const { settings } = input;
  const resample = input.resampleTo !== undefined && input.resampleTo !== input.sampleRate;
  const sampleRate = resample ? input.resampleTo! : input.sampleRate;
  const rendered = resample ? resampleChannels(input.rendered, input.sampleRate, sampleRate) : input.rendered;
  const outputPeak = samplePeak(rendered);
  const loudness = settings.mode === 'loudness' ? measureLoudness(rendered, sampleRate).lufs : null;
  const loudnessForDisplay = settings.mode === 'loudness' ? loudness : measureLoudness(rendered, sampleRate).lufs;

  const { gainDb, warning } = computeNormalizationGain(settings, { samplePeak: outputPeak, loudnessLufs: loudness });
  const gained = gainDb === 0 ? rendered : applyGainDb(rendered, gainDb);

  let final: readonly Float32Array[] = gained;
  let limiterReductionDb = 0;
  if (settings.limiterEnabled) {
    const limited = limitBuffer(gained, sampleRate, { ceilingDb: settings.ceilingDb, truePeak: settings.truePeak });
    final = limited.channels;
    limiterReductionDb = limited.maxReductionDb;
  }

  const finalPeak = samplePeak(final);
  const measurements: Measurements = {
    inputPeakDb: linearToDb(input.inputPeak),
    outputPeakDb: linearToDb(outputPeak),
    loudnessLufs: loudnessForDisplay,
    gainDb,
    limiterReductionDb,
    finalPeakDb: linearToDb(finalPeak),
    finalTruePeakDb: linearToDb(truePeak(final)),
    clipped: finalPeak > 1,
    ...(warning ? { warning } : {}),
  };
  return returnAudio ? { sampleRate, measurements, channels: final.map((channel) => channel.slice()) } : { sampleRate, measurements };
}
