import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, loadAudioFile, validateAudioFile } from './AudioLoader';

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

describe('loadAudioFile', () => {
  const wavHeader = (rate: number): Uint8Array => {
    const bytes = new Uint8Array(44);
    const view = new DataView(bytes.buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, 36, true);
    bytes.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    bytes.set([0x64, 0x61, 0x74, 0x61], 36);
    return bytes;
  };

  /** Mimics decodeAudioData, which transfers (detaches) the input buffer and resamples to the context rate. */
  const fakeContext = (): { context: BaseAudioContext; sawDetached: () => boolean } => {
    let detached = false;
    const context = {
      decodeAudioData: async (data: ArrayBuffer) => {
        structuredClone(data, { transfer: [data] });
        detached = data.byteLength === 0;
        return { duration: 1, sampleRate: 48000 } as AudioBuffer;
      },
    } as unknown as BaseAudioContext;
    return { context, sawDetached: () => detached };
  };

  it('records the sample rate stored in the file, read before the buffer is detached', async () => {
    const { context, sawDetached } = fakeContext();
    const loaded = await loadAudioFile(new File([wavHeader(44100) as BlobPart], 'a.wav', { type: 'audio/wav' }), context);
    expect(sawDetached()).toBe(true);
    expect(loaded.sourceSampleRate).toBe(44100);
    expect(loaded.name).toBe('a.wav');
  });

  it('leaves sourceSampleRate null for formats it cannot read', async () => {
    const { context } = fakeContext();
    const loaded = await loadAudioFile(new File([new Uint8Array([1, 2, 3, 4]) as BlobPart], 'a.mp3', { type: 'audio/mpeg' }), context);
    expect(loaded.sourceSampleRate).toBeNull();
  });
});
