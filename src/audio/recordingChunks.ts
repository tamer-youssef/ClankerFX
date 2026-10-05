/** Longest take the recorder will keep. Recording stops by itself here so memory use stays bounded. */
export const RECORDING_LIMIT_SECONDS = 600;

/** Total number of samples across all chunks. */
export function chunksSampleCount(chunks: readonly Float32Array[]): number {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  return total;
}

/** Number of samples that fit in `maxSeconds` at `sampleRate` (never negative, whole samples). */
export function maxRecordingSamples(sampleRate: number, maxSeconds: number = RECORDING_LIMIT_SECONDS): number {
  if (!Number.isFinite(sampleRate) || !Number.isFinite(maxSeconds) || sampleRate <= 0 || maxSeconds <= 0) return 0;
  return Math.floor(sampleRate * maxSeconds);
}

/**
 * Joins chunks, in order, into one array with a single allocation. `maxSamples` (optional) truncates the result, which
 * is how a take is trimmed to exactly the recording limit when the last chunk overshoots it.
 */
export function assembleChunks(chunks: readonly Float32Array[], maxSamples: number = Infinity): Float32Array {
  const total = Math.min(chunksSampleCount(chunks), Math.max(0, Math.floor(maxSamples)));
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const room = total - offset;
    out.set(room >= chunk.length ? chunk : chunk.subarray(0, room), offset);
    offset += Math.min(chunk.length, room);
  }
  return out;
}

/** Largest absolute sample, 0 for an empty array. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]!);
    if (v > peak) peak = v;
  }
  return peak;
}

/** Maps a linear peak (0..1) onto a 0..1 meter position on a dB scale from `floorDb` to 0 dBFS. */
export function peakToMeter(peak: number, floorDb = -60): number {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}

/** Big-clock text for the recorder: mm:ss.cc. */
export function formatRecordingClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const centis = Math.floor(safe * 100);
  const minutes = Math.floor(centis / 6000);
  const secs = Math.floor((centis % 6000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}`;
}

/** `recording-YYYYMMDD-HHMMSS.wav` in the local time zone. */
export function recordingFilename(date: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const day = `${p(date.getFullYear(), 4)}${p(date.getMonth() + 1)}${p(date.getDate())}`;
  const time = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `recording-${day}-${time}.wav`;
}
