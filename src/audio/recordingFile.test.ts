import { describe, expect, it, vi } from 'vitest';
import type { RecordedTake } from './MicRecorder';
import { takeToLoadedFile } from './recordingFile';

function fakeContext() {
  const copyToChannel = vi.fn();
  const createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => ({
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    copyToChannel,
  }));
  return { context: { createBuffer } as unknown as BaseAudioContext, createBuffer, copyToChannel };
}

describe('takeToLoadedFile', () => {
  it('builds a mono buffer and a named file entry', () => {
    const { context, createBuffer, copyToChannel } = fakeContext();
    const take: RecordedTake = { samples: Float32Array.of(0.1, 0.2, 0.3, 0.4), sampleRate: 48000, durationSeconds: 4 / 48000 };
    const file = takeToLoadedFile(context, take, new Date(2026, 5, 7, 8, 9, 10));
    expect(createBuffer).toHaveBeenCalledWith(1, 4, 48000);
    expect(copyToChannel).toHaveBeenCalledWith(take.samples, 0);
    expect(file.name).toBe('recording-20260607-080910.wav');
    expect(file.sizeBytes).toBe(8);
    expect(file.sourceSampleRate).toBe(48000);
    expect(file.id).toMatch(/^file-/);
  });

  it('refuses an empty take', () => {
    const { context } = fakeContext();
    expect(() => takeToLoadedFile(context, { samples: new Float32Array(0), sampleRate: 48000, durationSeconds: 0 })).toThrow();
  });
});
