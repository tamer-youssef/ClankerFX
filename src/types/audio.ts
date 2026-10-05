/** A decoded audio file held in memory. Never leaves the device. */
export interface LoadedFile {
  id: string;
  name: string;
  sizeBytes: number;
  buffer: AudioBuffer;
  /**
   * Sample rate stored in the file, when it could be read from the header. decodeAudioData resamples to the
   * context rate, so this is how "original sample rate" export knows what the source really was.
   */
  sourceSampleRate: number | null;
}

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface Notice {
  id: string;
  kind: 'error' | 'warning' | 'info';
  message: string;
}
