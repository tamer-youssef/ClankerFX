/** Formats seconds as m:ss.cc (e.g. 3.456 → "0:03.45"). Negative/NaN inputs render as zero. */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const centis = Math.floor(safe * 100);
  const minutes = Math.floor(centis / 6000);
  const secs = Math.floor((centis % 6000) / 100);
  const hundredths = centis % 100;
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
