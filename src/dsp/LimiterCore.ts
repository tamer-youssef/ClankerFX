import { TruePeakDetector } from '../analysis/PeakAnalyzer';
import { dbToGain } from '../utils/math';

export interface LimiterOptions {
  ceilingDb: number;
  /** Guarantee the ceiling on inter-sample (true) peaks instead of sample peaks. */
  truePeak: boolean;
  /** Look-ahead / attack time. Default 5. */
  lookaheadMs?: number;
  /** One-pole release time constant. Default 100. */
  releaseMs?: number;
}

/** Below this the one-pole release snaps to its target, so the gain returns to exactly 1 instead of stalling at 1 − ε. */
const RELEASE_SNAP = 1e-12;

/**
 * Look-ahead brickwall limiter with one gain shared by all channels.
 *
 * Guarantee: let t[n] = min(1, ceiling / peak[n]) be the gain sample n needs. A sliding minimum m[j] = min t[j..j+A]
 * looks A samples ahead. r follows m with instant attack and one-pole release, so r ≤ m always. The applied gain is
 * the mean of r[j−A..j]. Each r[i] in that window satisfies r[i] ≤ m[i] ≤ t[j] (the window of m[i] contains j), so the
 * mean is ≤ t[j] and |x[j]·g[j]| ≤ ceiling. The mean also spreads the instant attack over A+1 samples, giving a
 * smooth, click-free gain curve. In true-peak mode the 4× detector adds `TruePeakDetector.latency` samples of delay,
 * which is taken out of A so that the total latency stays at lookaheadMs.
 */
export class LimiterCore {
  readonly latencySamples: number;

  private readonly ceiling: number;
  private readonly attack: number;
  private readonly releaseCoefficient: number;
  private readonly detectorDelay: number;
  private readonly useTruePeak: boolean;

  private detectors: TruePeakDetector[] = [];
  private delayLines: Float32Array[] = [];
  private scratch = new Float64Array(0);
  private delayPosition = 0;

  // Monotonic deque (indices into a ring) for the sliding minimum of t over A+1 samples.
  private readonly dequeValues: Float64Array;
  private readonly dequeTimes: Float64Array;
  private readonly dequeMask: number;
  private dequeHead = 0;
  private dequeSize = 0;
  private sampleCount = 0;

  private readonly smoothing: Float64Array; // ring of the last A+1 values of r
  private smoothingPosition = 0;
  private smoothingSum: number;
  private release = 1;
  private previousPeak = 0;
  private minimumGain = 1;

  constructor(sampleRate: number, options: LimiterOptions) {
    this.ceiling = dbToGain(options.ceilingDb);
    this.useTruePeak = options.truePeak;
    this.detectorDelay = options.truePeak ? TruePeakDetector.latency : 0;
    const lookahead = Math.max(0, options.lookaheadMs ?? 5);
    const releaseSamples = Math.max(1, ((options.releaseMs ?? 100) / 1000) * sampleRate);
    this.releaseCoefficient = 1 - Math.exp(-1 / releaseSamples);
    this.attack = Math.max(1, Math.round((lookahead / 1000) * sampleRate) - this.detectorDelay);
    this.latencySamples = this.attack + this.detectorDelay;

    let capacity = 1;
    while (capacity < this.attack + 2) capacity *= 2;
    this.dequeMask = capacity - 1;
    this.dequeValues = new Float64Array(capacity);
    this.dequeTimes = new Float64Array(capacity);
    this.smoothing = new Float64Array(this.attack + 1).fill(1);
    this.smoothingSum = this.attack + 1;
  }

  get maxReductionDb(): number {
    return this.minimumGain >= 1 ? 0 : -20 * Math.log10(this.minimumGain);
  }

  reset(): void {
    for (const line of this.delayLines) line.fill(0);
    for (const detector of this.detectors) detector.reset();
    this.delayPosition = 0;
    this.dequeHead = 0;
    this.dequeSize = 0;
    this.sampleCount = 0;
    this.smoothing.fill(1);
    this.smoothingPosition = 0;
    this.smoothingSum = this.attack + 1;
    this.release = 1;
    this.previousPeak = 0;
    this.minimumGain = 1;
  }

  /** `outputs` may alias `inputs`. Output sample i is input sample i − latencySamples, scaled. */
  process(inputs: readonly Float32Array[], outputs: readonly Float32Array[], frames: number): void {
    const channelCount = Math.min(inputs.length, outputs.length);
    if (channelCount !== this.delayLines.length) this.allocate(channelCount);
    const { ceiling, detectors, delayLines, scratch, dequeValues, dequeTimes, dequeMask, smoothing, releaseCoefficient } = this;
    const skipBelow = ceiling; // the detector skips interpolation while no inter-sample peak can exceed the ceiling
    const useTruePeak = this.useTruePeak;
    const delayLength = this.latencySamples;
    const window = this.attack + 1;

    let { dequeHead, dequeSize, sampleCount, release, smoothingPosition, smoothingSum, previousPeak, minimumGain, delayPosition } = this;

    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < channelCount; c++) {
        const x = (inputs[c] as Float32Array)[i] as number;
        scratch[c] = x;
        const channelPeak = useTruePeak ? (detectors[c] as TruePeakDetector).push(x, skipBelow) : Math.abs(x);
        if (channelPeak > peak) peak = channelPeak;
      }
      // Cover the interval before this one too so a gain sample is safe for both neighbouring intervals.
      const combined = useTruePeak && previousPeak > peak ? previousPeak : peak;
      previousPeak = peak;
      const required = combined > ceiling ? ceiling / combined : 1;

      // Sliding minimum over the last `window` values of `required`.
      const time = sampleCount++;
      while (dequeSize > 0 && (dequeValues[(dequeHead + dequeSize - 1) & dequeMask] as number) >= required) dequeSize--;
      const slot = (dequeHead + dequeSize) & dequeMask;
      dequeValues[slot] = required;
      dequeTimes[slot] = time;
      dequeSize++;
      while ((dequeTimes[dequeHead] as number) <= time - window) {
        dequeHead = (dequeHead + 1) & dequeMask;
        dequeSize--;
      }
      const minimum = dequeValues[dequeHead] as number;

      if (minimum < release) {
        release = minimum;
      } else {
        release += (minimum - release) * releaseCoefficient;
        if (minimum - release < RELEASE_SNAP || release > minimum) release = minimum;
      }

      smoothingSum += release - (smoothing[smoothingPosition] as number);
      smoothing[smoothingPosition] = release;
      if (++smoothingPosition === window) {
        smoothingPosition = 0;
        // Re-sum once per cycle so rounding error in the running sum cannot accumulate.
        let sum = 0;
        for (let k = 0; k < window; k++) sum += smoothing[k] as number;
        smoothingSum = sum;
      }
      const gain = Math.min(1, smoothingSum / window);
      if (gain < minimumGain) minimumGain = gain;

      for (let c = 0; c < channelCount; c++) {
        const line = delayLines[c] as Float32Array;
        const delayed = line[delayPosition] as number;
        line[delayPosition] = scratch[c] as number;
        (outputs[c] as Float32Array)[i] = delayed * gain;
      }
      if (++delayPosition === delayLength) delayPosition = 0;
    }

    this.dequeHead = dequeHead;
    this.dequeSize = dequeSize;
    this.sampleCount = sampleCount;
    this.release = release;
    this.smoothingPosition = smoothingPosition;
    this.smoothingSum = smoothingSum;
    this.previousPeak = previousPeak;
    this.minimumGain = minimumGain;
    this.delayPosition = delayPosition;
  }

  private allocate(channelCount: number): void {
    this.delayLines = Array.from({ length: channelCount }, () => new Float32Array(this.latencySamples));
    this.detectors = this.useTruePeak ? Array.from({ length: channelCount }, () => new TruePeakDetector(4)) : [];
    this.scratch = new Float64Array(channelCount);
    this.delayPosition = 0;
  }
}

/** Offline helper: output has the input's length, with the look-ahead latency compensated. */
export function limitBuffer(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: LimiterOptions,
): { channels: Float32Array[]; maxReductionDb: number } {
  const length = channels.reduce((max, channel) => Math.max(max, channel.length), 0);
  const limiter = new LimiterCore(sampleRate, options);
  const latency = limiter.latencySamples;
  const total = length + latency;
  const padded = channels.map((channel) => {
    const copy = new Float32Array(total);
    copy.set(channel);
    return copy;
  });
  const processed = padded.map(() => new Float32Array(total));
  limiter.process(padded, processed, total);
  return { channels: processed.map((channel) => channel.slice(latency, latency + length)), maxReductionDb: limiter.maxReductionDb };
}
