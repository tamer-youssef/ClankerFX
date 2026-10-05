/**
 * Pure transport math. An AudioBufferSourceNode cannot be paused or queried for its position,
 * so the engine remembers "at context time T the playhead was at offset O" and derives the
 * current position from the audio clock. Keeping this pure makes it unit-testable without Web Audio.
 */
export interface ClockAnchor {
  /** AudioContext time at which playback (re)started. */
  startContextTime: number;
  /** Playhead position (seconds into the buffer) at startContextTime. */
  startOffset: number;
  loop: boolean;
  duration: number;
}

export function positionAt(anchor: ClockAnchor, contextTime: number): number {
  const { startContextTime, startOffset, loop, duration } = anchor;
  if (duration <= 0) return 0;
  const elapsed = Math.max(0, contextTime - startContextTime);
  const raw = startOffset + elapsed;
  return loop ? raw % duration : Math.min(raw, duration);
}

/** Keeps a seek target inside the buffer. A target at the very end is nudged back so playback can still start. */
export function clampSeek(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || duration <= 0) return 0;
  return Math.min(Math.max(0, seconds), Math.max(0, duration - 0.001));
}
