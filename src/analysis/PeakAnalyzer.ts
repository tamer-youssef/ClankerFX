/** Sample-peak and inter-sample ("true") peak measurement. Pure TS, no Web Audio types. */

/** Half-width of the interpolation kernel in input samples: each inter-sample value uses 2·HALF input samples. */
const HALF = 16;
const TAPS = HALF * 2;
const KAISER_BETA = 6;
/** Interval of samples scanned at once by the block-skipping scan. */
const SCAN_BLOCK = 256;

export function samplePeak(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i] as number);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

export function linearToDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const quarter = (x * x) / 4;
  for (let k = 1; k < 50; k++) {
    term *= quarter / (k * k);
    sum += term;
    if (term < sum * 1e-16) break;
  }
  return sum;
}

/**
 * Inter-sample peak detector: a linear-phase Kaiser-windowed-sinc interpolator evaluated at the (oversample − 1)
 * fractional positions between consecutive input samples. Every phase is normalised to unity DC gain. The kernel has
 * ±16 input samples of support, so the output lags the input by `latency` samples.
 *
 * The same coefficient tables serve the streaming `push` (limiter) and the block-skipping `scan` (offline analysis).
 */
export class TruePeakDetector {
  /** Samples of look-ahead the detector needs: push(x[s]) reports the interval starting at x[s − latency]. */
  static readonly latency = HALF;

  readonly oversample: number;
  /** coefficients[(p − 1) · TAPS + t] weighs x[k − 15 + t] for fractional position p / oversample after x[k]. */
  private readonly coefficients: Float64Array;
  /** Upper bound of |interpolated value| / max|x| over any window (the L1 norm of the worst phase). */
  readonly gainBound: number;
  private readonly history = new Float64Array(TAPS * 2);
  private position = 0;
  private quietRun = 0;

  constructor(oversample = 4) {
    this.oversample = Math.max(1, Math.min(16, Math.round(oversample)));
    const phases = this.oversample - 1;
    this.coefficients = new Float64Array(phases * TAPS);
    const i0Beta = besselI0(KAISER_BETA);
    let bound = 1;
    // Phase L − p is phase p reversed (the kernel is symmetric), so only the first half is computed.
    for (let p = 1; p <= Math.floor(this.oversample / 2); p++) {
      const fraction = p / this.oversample;
      let sum = 0;
      let l1 = 0;
      for (let t = 0; t < TAPS; t++) {
        const u = fraction - (t - (HALF - 1));
        const sinc = Math.sin(Math.PI * u) / (Math.PI * u);
        const ratio = u / HALF;
        const window = besselI0(KAISER_BETA * Math.sqrt(Math.max(0, 1 - ratio * ratio))) / i0Beta;
        const c = sinc * window;
        this.coefficients[(p - 1) * TAPS + t] = c;
        sum += c;
      }
      for (let t = 0; t < TAPS; t++) {
        const index = (p - 1) * TAPS + t;
        const c = (this.coefficients[index] as number) / sum;
        this.coefficients[index] = c;
        l1 += Math.abs(c);
      }
      bound = Math.max(bound, l1);
      const mirror = this.oversample - p;
      if (mirror !== p) {
        for (let t = 0; t < TAPS; t++) this.coefficients[(mirror - 1) * TAPS + t] = this.coefficients[(p - 1) * TAPS + (TAPS - 1 - t)] as number;
      }
    }
    this.gainBound = bound;
  }

  reset(): void {
    this.history.fill(0);
    this.position = 0;
    this.quietRun = 0;
  }

  /**
   * Feeds one sample and returns max |value| over the interval [k, k + 1) of the reconstructed signal, with
   * k = s − latency (the sample itself plus the interpolated points after it). Zeros are assumed before the start.
   *
   * `skipBelow` is an optional speed-up for callers that only care whether the peak exceeds some level: while every
   * sample in the kernel window is below skipBelow / gainBound the interpolation cannot reach skipBelow, so it is
   * skipped and the (smaller) sample value is returned instead. 0 disables it.
   */
  push(x: number, skipBelow = 0): number {
    const history = this.history;
    const write = this.position;
    history[write] = x;
    history[write + TAPS] = x;
    const start = (this.position = write + 1 === TAPS ? 0 : write + 1);
    const peak = Math.abs(history[start + HALF - 1] as number);
    if (skipBelow > 0) {
      if (Math.abs(x) * this.gainBound >= skipBelow) this.quietRun = 0;
      else if (++this.quietRun >= TAPS) return peak;
    }
    return this.oversample === 4 ? this.interpolate4(start, peak) : this.interpolateAny(start, peak);
  }

  /** 4×: phases 1 and 3 share their loads (mirrored kernels); phase 2 is symmetric and folds to 16 taps. */
  private interpolate4(start: number, sampleValue: number): number {
    const history = this.history;
    const c = this.coefficients;
    let a1 = 0;
    let a3 = 0;
    for (let t = 0; t < TAPS; t++) {
      const h = history[start + t] as number;
      a1 += (c[t] as number) * h;
      a3 += (c[2 * TAPS + t] as number) * h;
    }
    let a2 = 0;
    for (let t = 0; t < HALF; t++) {
      a2 += (c[TAPS + t] as number) * ((history[start + t] as number) + (history[start + TAPS - 1 - t] as number));
    }
    return Math.max(sampleValue, Math.abs(a1), Math.abs(a2), Math.abs(a3));
  }

  private interpolateAny(start: number, sampleValue: number): number {
    const history = this.history;
    const coefficients = this.coefficients;
    let peak = sampleValue;
    for (let p = 0, base = 0; p < this.oversample - 1; p++, base += TAPS) {
      let acc = 0;
      for (let t = 0; t < TAPS; t++) acc += (coefficients[base + t] as number) * (history[start + t] as number);
      const magnitude = Math.abs(acc);
      if (magnitude > peak) peak = magnitude;
    }
    return peak;
  }

  /**
   * Max |value| of the reconstruction of one whole channel (zeros assumed outside it), covering the same intervals
   * a push-based run over the signal plus `latency` flush zeros would. Blocks whose samples cannot reach the current
   * maximum even at the worst-case interpolation gain are skipped, so quiet material costs little.
   */
  scan(data: Float32Array): number {
    const n = data.length;
    const last = n + HALF; // exclusive upper k, matching the flush
    let best = 0;
    for (let a = -HALF; a < last; a += SCAN_BLOCK) {
      const b = Math.min(last, a + SCAN_BLOCK);
      let blockMax = 0;
      for (let i = Math.max(0, a - (HALF - 1)); i < Math.min(n, b + HALF); i++) {
        const v = Math.abs(data[i] as number);
        if (v > blockMax) blockMax = v;
      }
      if (blockMax * this.gainBound <= best) continue;
      for (let k = a; k < b; k++) {
        const sampleValue = k >= 0 && k < n ? Math.abs(data[k] as number) : 0;
        if (sampleValue > best) best = sampleValue;
        const first = k - (HALF - 1);
        const interior = first >= 0 && k + HALF < n;
        for (let p = 0, base = 0; p < this.oversample - 1; p++, base += TAPS) {
          let acc = 0;
          if (interior) {
            for (let t = 0; t < TAPS; t++) acc += (this.coefficients[base + t] as number) * (data[first + t] as number);
          } else {
            for (let t = 0; t < TAPS; t++) {
              const i = first + t;
              if (i >= 0 && i < n) acc += (this.coefficients[base + t] as number) * (data[i] as number);
            }
          }
          const magnitude = Math.abs(acc);
          if (magnitude > best) best = magnitude;
        }
      }
    }
    return best;
  }
}

/** True (inter-sample) peak, linear. Always ≥ the sample peak. */
export function truePeak(channels: readonly Float32Array[], oversample = 4): number {
  const detector = new TruePeakDetector(oversample);
  let peak = samplePeak(channels);
  for (const channel of channels) peak = Math.max(peak, detector.scan(channel));
  return peak;
}
