import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, validateAudioFile } from './AudioLoader';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('validateAudioFile', () => {
  it('accepts audio mime types and known extensions', () => {
    expect(validateAudioFile(file('a.wav', 'audio/wav'))).toBeNull();
    expect(validateAudioFile(file('a.FLAC', ''))).toBeNull();
    expect(validateAudioFile(file('voice', 'audio/mpeg'))).toBeNull();
  });

  it('rejects non-audio files', () => {
    expect(validateAudioFile(file('notes.txt', 'text/plain'))?.code).toBe('unsupported-type');
    expect(validateAudioFile(file('photo.png', 'image/png'))?.code).toBe('unsupported-type');
  });

  it('rejects empty and oversized files', () => {
    expect(validateAudioFile(file('a.wav', 'audio/wav', 0))?.code).toBe('empty');
    expect(validateAudioFile(file('a.wav', 'audio/wav', MAX_FILE_BYTES + 1))?.code).toBe('too-large');
  });
});
