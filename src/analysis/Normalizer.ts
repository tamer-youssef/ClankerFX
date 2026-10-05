import type { NormalizationSettings } from '../types/output';
import { clamp, dbToGain } from '../utils/math';

export const MAX_GAIN_DB = 24;

/** Below this linear level (−180 dBFS) a signal is treated as digital silence. */
const SILENCE_PEAK = 1e-9;

export interface NormalizationGain {
  gainDb: number;
  warning?: string;
}

export function computeNormalizationGain(
  settings: NormalizationSettings,
  measured: { samplePeak: number; loudnessLufs: number | null },
): NormalizationGain {
  let wanted: number;
  if (settings.mode === 'off') return { gainDb: 0 };
  if (settings.mode === 'peak') {
    if (!Number.isFinite(measured.samplePeak) || measured.samplePeak <= SILENCE_PEAK) {
      return { gainDb: 0, warning: 'Signal is silent' };
    }
    wanted = settings.peakTargetDb - 20 * Math.log10(measured.samplePeak);
  } else {
    if (measured.loudnessLufs === null || !Number.isFinite(measured.loudnessLufs)) {
      return { gainDb: 0, warning: 'Too quiet to measure loudness' };
    }
    wanted = settings.loudnessTargetLufs - measured.loudnessLufs;
  }
  if (!Number.isFinite(wanted)) return { gainDb: 0, warning: 'Signal is silent' };
  const gainDb = clamp(wanted, -MAX_GAIN_DB, MAX_GAIN_DB);
  if (gainDb !== wanted) {
    return { gainDb, warning: `Gain limited to ${gainDb > 0 ? '+' : '−'}${MAX_GAIN_DB} dB (wanted ${wanted > 0 ? '+' : ''}${wanted.toFixed(1)} dB)` };
  }
  return { gainDb };
}

/** Returns new arrays with every sample scaled by gainDb. */
export function applyGainDb(channels: readonly Float32Array[], gainDb: number): Float32Array[] {
  const gain = dbToGain(gainDb);
  return channels.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) out[i] = (channel[i] as number) * gain;
    return out;
  });
}
