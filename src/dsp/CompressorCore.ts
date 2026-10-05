export interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  /** Manual make-up gain. There is no automatic make-up: a signal below the threshold passes at exactly this gain. */
  makeupDb: number;
  /** Soft-knee width in dB, centred on the threshold. 0 = hard knee. Default 6. */
  kneeDb?: number;
}

export const DEFAULT_KNEE_DB = 6;

/** Detector floor: silence reads as this level instead of −∞. */
const FLOOR_DB = -120;
const FLOOR_LINEAR = 1e-6; // 10^(FLOOR_DB / 20)
/** Levels above +60 dBFS are clamped so an Infinity sample cannot turn the gain into 0·∞. */
const CEILING_LINEAR = 1e3;
/** Below this the smoothed reduction snaps to exactly 0, so the gain returns to exactly unity instead of stalling at 1 − ε. */
const REDUCTION_SNAP_DB = 1e-9;
const DB_TO_NEPER = Math.LN10 / 20;

/**
 * Static compression curve: the gain change in dB (y − x, always ≤ 0) for an input level in dB.
 * Standard quadratic soft knee of width `kneeDb` centred on the threshold; `kneeDb` 0 gives a hard knee.
 * Ratio 1 (or anything below) is a straight line, i.e. no gain change.
 */
export function staticGainDb(inputDb: number, thresholdDb: number, ratio: number, kneeDb: number): number {
  const slope = 1 / Math.max(1, ratio) - 1; // ≤ 0
  const over = inputDb - thresholdDb;
  let gain: number;
  if (kneeDb <= 0) {
    gain = over > 0 ? slope * over : 0;
  } else if (2 * over < -kneeDb) {
    gain = 0;
  } else if (2 * Math.abs(over) <= kneeDb) {
    const t = over + kneeDb / 2;
    gain = (slope * t * t) / (2 * kneeDb);
  } else {
    gain = slope * over;
  }
  return gain < 0 ? gain : 0; // also turns −0 into 0
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Feed-forward, stereo-linked compressor with NO automatic make-up gain.
 *
 * The detector is the largest |sample| across all channels, in dB (floored at −120 dB). The static curve turns it into
 * a desired gain reduction, which a one-pole smooths with the attack time constant while the reduction grows and the
 * release time constant while it shrinks. The result is applied as a single linear gain to every channel, together with
 * the user's make-up. There is no look-ahead (zero latency); an output limiter is expected to catch overs.
 *
 * Transparency: ratio 1, or any signal below threshold − knee/2, gives a reduction of exactly 0 and therefore a gain of
 * exactly 1.0 (bit-exact output when makeupDb is 0). No dB↔linear conversion is involved in that path.
 */
export class CompressorCore {
  private readonly sampleRate: number;
  private reduction = 0; // smoothed gain reduction, dB, ≥ 0
  private maxReduction = 0;

  constructor(sampleRate: number) {
    this.sampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  }

  /** Deepest smoothed gain reduction since construction / reset(), in dB (a positive number; 0 = never compressed). */
  get maxReductionDb(): number {
    return this.maxReduction;
  }

  reset(): void {
    this.reduction = 0;
    this.maxReduction = 0;
  }

  /**
   * `outputs` may alias `inputs`. Output channels without a matching input channel are silent. The detector only
   * looks at the channels that exist in both `inputs` and `outputs`.
   */
  process(inputs: readonly Float32Array[], outputs: readonly Float32Array[], frames: number, params: CompressorParams): void {
    const outputCount = outputs.length;
    const inputCount = Math.min(inputs.length, outputCount);

    const thresholdDb = Math.min(0, Math.max(-100, finiteOr(params.thresholdDb, -26)));
    const ratio = Math.min(100, Math.max(1, finiteOr(params.ratio, 6)));
    const attackMs = Math.max(0.1, finiteOr(params.attackMs, 8));
    const releaseMs = Math.max(1, finiteOr(params.releaseMs, 160));
    const kneeDb = Math.min(24, Math.max(0, finiteOr(params.kneeDb ?? DEFAULT_KNEE_DB, DEFAULT_KNEE_DB)));
    let makeupDb = Math.min(36, Math.max(-36, finiteOr(params.makeupDb, 0)));
    if (Math.abs(makeupDb) < 1e-9) makeupDb = 0;

    const attackCoefficient = Math.exp(-1 / ((attackMs / 1000) * this.sampleRate));
    const releaseCoefficient = Math.exp(-1 / ((releaseMs / 1000) * this.sampleRate));
    const makeupGain = makeupDb === 0 ? 1 : Math.pow(10, makeupDb / 20);
    const transparent = ratio <= 1;
    // Linear level below which the curve is flat, so the log is skipped for quiet material.
    const kneeFloorLinear = Math.max(FLOOR_LINEAR, Math.pow(10, (thresholdDb - kneeDb / 2) / 20));

    let reduction = this.reduction;
    let maxReduction = this.maxReduction;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < inputCount; c++) {
        const level = Math.abs((inputs[c] as Float32Array)[i] as number);
        if (level > peak) peak = level; // a NaN sample compares false and is ignored by the detector
      }

      let target = 0;
      if (!transparent && peak > kneeFloorLinear) {
        const levelDb = Math.max(FLOOR_DB, 20 * Math.log10(Math.min(peak, CEILING_LINEAR)));
        target = -staticGainDb(levelDb, thresholdDb, ratio, kneeDb);
      }

      reduction = target + (target > reduction ? attackCoefficient : releaseCoefficient) * (reduction - target);
      if (reduction < REDUCTION_SNAP_DB) reduction = 0;
      if (reduction > maxReduction) maxReduction = reduction;

      const gain = reduction === 0 ? makeupGain : Math.exp((makeupDb - reduction) * DB_TO_NEPER);
      for (let c = 0; c < outputCount; c++) {
        const out = outputs[c] as Float32Array;
        out[i] = c < inputCount ? (gain === 1 ? ((inputs[c] as Float32Array)[i] as number) : ((inputs[c] as Float32Array)[i] as number) * gain) : 0;
      }
    }

    this.reduction = reduction;
    this.maxReduction = maxReduction;
  }
}
