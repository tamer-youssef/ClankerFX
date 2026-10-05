import type { LoadedFile } from '../types/audio';
import { createId } from '../utils/id';
import { sniffSourceSampleRate } from './audioMetadata';
import { formatBytes } from '../utils/format';

export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 30 * 60;

const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm', 'mp4', 'aif', 'aiff']);

export type AudioLoadErrorCode = 'unsupported-type' | 'empty' | 'too-large' | 'too-long' | 'decode-failed';

export class AudioLoadError extends Error {
  readonly code: AudioLoadErrorCode;

  constructor(code: AudioLoadErrorCode, message: string) {
    super(message);
    this.name = 'AudioLoadError';
    this.code = code;
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Cheap checks that run before any bytes are read or decoded. Returns an error, or null when the file is acceptable. */
export function validateAudioFile(file: { name: string; type: string; size: number }): AudioLoadError | null {
  const looksLikeAudio =
    file.type.startsWith('audio/') || file.type === 'video/mp4' || file.type === 'video/webm' || AUDIO_EXTENSIONS.has(extensionOf(file.name));
  if (!looksLikeAudio) {
    return new AudioLoadError('unsupported-type', `"${file.name}" doesn't look like an audio file. Try WAV, MP3, OGG, FLAC or M4A.`);
  }
  if (file.size === 0) {
    return new AudioLoadError('empty', `"${file.name}" is empty.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    return new AudioLoadError(
      'too-large',
      `"${file.name}" is ${formatBytes(file.size)}. Files over ${formatBytes(MAX_FILE_BYTES)} are not supported in the browser.`,
    );
  }
  return null;
}

/** Reads and decodes a file locally. Throws AudioLoadError with a user-presentable message. */
export async function loadAudioFile(file: File, context: BaseAudioContext): Promise<LoadedFile> {
  const invalid = validateAudioFile(file);
  if (invalid) throw invalid;

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new AudioLoadError('decode-failed', `"${file.name}" could not be read from disk.`);
  }

  // Must happen before decodeAudioData, which detaches the ArrayBuffer.
  const sourceSampleRate = sniffSourceSampleRate(bytes);

  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch {
    throw new AudioLoadError(
      'decode-failed',
      `"${file.name}" could not be decoded. It may be corrupt, or this browser may not support its codec.`,
    );
  }

  if (buffer.duration > MAX_DURATION_SECONDS) {
    throw new AudioLoadError('too-long', `"${file.name}" is longer than ${MAX_DURATION_SECONDS / 60} minutes, which is too long to edit in memory.`);
  }

  return { id: createId('file'), name: file.name, sizeBytes: file.size, buffer, sourceSampleRate };
}
