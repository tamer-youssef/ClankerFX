/** Min/max envelope of an audio signal, one entry per bucket, for drawing waveforms. */
export interface PeakData {
  min: Float32Array;
  max: Float32Array;
}

/**
 * Accumulates min/max for buckets [bucketStart, bucketEnd) across all channels.
 * Buckets partition the signal evenly; the ranges are exposed so callers can process big files in
 * slices and yield to the event loop between them.
 */
export function accumulatePeaks(
  channels: readonly Float32Array[],
  peaks: PeakData,
  bucketStart: number,
  bucketEnd: number,
): void {
  const bucketCount = peaks.min.length;
  const length = channels[0]?.length ?? 0;
  if (length === 0 || bucketCount === 0) return;
  const samplesPerBucket = length / bucketCount;

  for (let bucket = bucketStart; bucket < bucketEnd; bucket++) {
    const from = Math.floor(bucket * samplesPerBucket);
    const to = Math.min(length, Math.max(from + 1, Math.floor((bucket + 1) * samplesPerBucket)));
    let lo = Infinity;
    let hi = -Infinity;
    for (const channel of channels) {
      for (let i = from; i < to; i++) {
        const sample = channel[i] as number;
        if (sample < lo) lo = sample;
        if (sample > hi) hi = sample;
      }
    }
    peaks.min[bucket] = lo === Infinity ? 0 : lo;
    peaks.max[bucket] = hi === -Infinity ? 0 : hi;
  }
}

export function createPeakData(bucketCount: number): PeakData {
  return { min: new Float32Array(bucketCount), max: new Float32Array(bucketCount) };
}

/** Synchronous convenience wrapper; fine for tests and short signals. */
export function computePeaks(channels: readonly Float32Array[], bucketCount: number): PeakData {
  const peaks = createPeakData(bucketCount);
  accumulatePeaks(channels, peaks, 0, bucketCount);
  return peaks;
}

const SAMPLES_PER_SLICE = 4_000_000;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Computes peaks without monopolising the main thread: work is cut into slices of roughly
 * SAMPLES_PER_SLICE samples with a macrotask yield in between, so a 30-minute file does not freeze the UI.
 */
export async function computePeaksAsync(
  channels: readonly Float32Array[],
  bucketCount: number,
  isCancelled: () => boolean = () => false,
): Promise<PeakData | null> {
  const peaks = createPeakData(bucketCount);
  const length = channels[0]?.length ?? 0;
  const samplesPerBucket = Math.max(1, length / bucketCount);
  const totalReads = samplesPerBucket * channels.length;
  const bucketsPerSlice = Math.max(1, Math.floor(SAMPLES_PER_SLICE / totalReads));

  for (let start = 0; start < bucketCount; start += bucketsPerSlice) {
    if (isCancelled()) return null;
    accumulatePeaks(channels, peaks, start, Math.min(bucketCount, start + bucketsPerSlice));
    if (start + bucketsPerSlice < bucketCount) await yieldToEventLoop();
  }
  return peaks;
}

/**
 * Maps peak data onto `columns` drawing columns. Downsampling takes the min/max over the covered
 * buckets (so transients never disappear); upsampling repeats buckets.
 */
export function resamplePeaks(peaks: PeakData, columns: number): PeakData {
  const out = createPeakData(columns);
  const source = peaks.min.length;
  if (source === 0 || columns === 0) return out;

  for (let column = 0; column < columns; column++) {
    const from = Math.floor((column * source) / columns);
    const to = Math.max(from + 1, Math.floor(((column + 1) * source) / columns));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = from; i < Math.min(to, source); i++) {
      const bucketMin = peaks.min[i] as number;
      const bucketMax = peaks.max[i] as number;
      if (bucketMin < lo) lo = bucketMin;
      if (bucketMax > hi) hi = bucketMax;
    }
    out.min[column] = lo === Infinity ? 0 : lo;
    out.max[column] = hi === -Infinity ? 0 : hi;
  }
  return out;
}
