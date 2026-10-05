/** A decoded audio file held in memory. Never leaves the device. */
export interface LoadedFile {
  id: string;
  name: string;
  sizeBytes: number;
  buffer: AudioBuffer;
}

export type PlaybackState = 'stopped' | 'playing' | 'paused';

export interface Notice {
  id: string;
  kind: 'error' | 'warning' | 'info';
  message: string;
}
