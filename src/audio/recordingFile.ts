import type { LoadedFile } from '../types/audio';
import { createId } from '../utils/id';
import type { RecordedTake } from './MicRecorder';
import { recordingFilename } from './recordingChunks';

/** Turns a finished take into an in-memory file, exactly like one decoded from disk. Nothing is encoded or uploaded. */
export function takeToLoadedFile(context: BaseAudioContext, take: RecordedTake, now: Date = new Date()): LoadedFile {
  const length = take.samples.length;
  if (length === 0) throw new Error('The recording is empty.');
  const buffer = context.createBuffer(1, length, take.sampleRate);
  buffer.copyToChannel(take.samples as Float32Array<ArrayBuffer>, 0);
  return {
    id: createId('file'),
    name: recordingFilename(now),
    // What a 16-bit mono WAV of this take would weigh; the data itself lives in the buffer as float.
    sizeBytes: length * 2,
    buffer,
    sourceSampleRate: take.sampleRate,
  };
}
