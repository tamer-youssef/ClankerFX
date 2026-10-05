/** Output-stage settings. Processing order: effect chain → normalisation gain → limiter → conversion/encode. */
export type NormalizeMode = 'off' | 'peak' | 'loudness';

export interface NormalizationSettings {
  mode: NormalizeMode;
  /** Peak mode: target sample peak in dBFS. */
  peakTargetDb: number;
  /** Loudness mode: target integrated loudness in LUFS (ITU-R BS.1770). */
  loudnessTargetLufs: number;
  /** Brickwall limiter after the gain stage. Strongly recommended; off only for peak-exact workflows. */
  limiterEnabled: boolean;
  /** Limiter ceiling in dBFS. With `truePeak` the ceiling applies to inter-sample (true) peaks. */
  ceilingDb: number;
  truePeak: boolean;
}

export const defaultNormalization: NormalizationSettings = {
  mode: 'peak',
  peakTargetDb: -1,
  // Game dialogue typically sits around -23…-16 LUFS; -20 leaves headroom for loud SFX mixes.
  loudnessTargetLufs: -20,
  limiterEnabled: true,
  ceilingDb: -1,
  truePeak: true,
};

export interface ExportSettings {
  bitDepth: 16 | 24;
  /** 'original' keeps the source file's sample rate where known. */
  sampleRate: 'original' | 44100 | 48000 | 96000;
  /** 'auto' follows the content: mono when the processed signal is effectively mono. */
  channels: 'auto' | 'mono' | 'stereo';
  filenameSuffix: string;
}

export const defaultExportSettings: ExportSettings = {
  bitDepth: 16,
  sampleRate: 'original',
  channels: 'auto',
  filenameSuffix: '_processed',
};

/** Numbers shown in the UI. All dB values are dBFS (or LUFS for loudness); -Infinity means silence. */
export interface Measurements {
  inputPeakDb: number;
  /** Sample peak after the effect chain, before normalisation. */
  outputPeakDb: number;
  /** Integrated loudness after the effect chain; null when the signal is too quiet to measure. */
  loudnessLufs: number | null;
  /** Gain applied by normalisation, in dB. */
  gainDb: number;
  /** Largest gain reduction the limiter applied, in dB (0 when it never engaged). */
  limiterReductionDb: number;
  /** Final sample peak after gain and limiter. */
  finalPeakDb: number;
  /** Final true (inter-sample) peak. */
  finalTruePeakDb: number;
  /** True when the final signal exceeds 0 dBFS and would clip in a WAV. */
  clipped: boolean;
  /** Human-readable caveat, e.g. "Signal is silent". */
  warning?: string;
}
