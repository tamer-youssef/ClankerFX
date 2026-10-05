import { describe, expect, it } from 'vitest';
import { sniffSourceSampleRate } from './audioMetadata';
import { createRandom } from '../dsp/random';

function chunk(id: string, body: number[]): number[] {
  const size = body.length;
  const out = [...id].map((c) => c.charCodeAt(0));
  out.push(size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, ...body);
  if (size % 2) out.push(0);
  return out;
}

const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

function fmtBody(rate: number): number[] {
  return [1, 0, 2, 0, ...le32(rate), ...le32(rate * 4), 4, 0, 16, 0];
}

function wav(rate: number, before: number[] = [], riff = 'RIFF'): Uint8Array {
  const body = [...'WAVE'].map((c) => c.charCodeAt(0)).concat(before, chunk('fmt ', fmtBody(rate)), chunk('data', [0, 0, 0, 0]));
  return Uint8Array.from([...[...riff].map((c) => c.charCodeAt(0)), ...le32(body.length), ...body]);
}

function flac(rate: number, firstBlockType = 0): Uint8Array {
  const info = new Array<number>(34).fill(0);
  info[10] = (rate >> 12) & 255;
  info[11] = (rate >> 4) & 255;
  info[12] = ((rate & 15) << 4) | (1 << 1); // 2 channels, 16 bit high bit
  return Uint8Array.from([0x66, 0x4c, 0x61, 0x43, 0x80 | firstBlockType, 0, 0, 34, ...info]);
}

describe('sniffSourceSampleRate', () => {
  it('reads WAV rates, from Uint8Array and ArrayBuffer', () => {
    for (const rate of [8000, 22050, 44100, 48000, 96000, 192000, 384000]) {
      const bytes = wav(rate);
      expect(sniffSourceSampleRate(bytes)).toBe(rate);
      expect(sniffSourceSampleRate(new Uint8Array(bytes).buffer)).toBe(rate);
    }
  });

  it('respects byteOffset of views', () => {
    const inner = wav(48000);
    const padded = new Uint8Array(inner.length + 10);
    padded.set(inner, 10);
    expect(sniffSourceSampleRate(padded.subarray(10))).toBe(48000);
  });

  it('walks past JUNK/bext/LIST chunks, including odd-sized ones', () => {
    const before = [...chunk('JUNK', new Array(27).fill(7)), ...chunk('bext', new Array(602).fill(1)), ...chunk('LIST', [1, 2, 3])];
    expect(sniffSourceSampleRate(wav(48000, before))).toBe(48000);
  });

  it('handles RF64 and BW64 headers with a ds64 chunk', () => {
    const ds64 = chunk('ds64', new Array(28).fill(0));
    expect(sniffSourceSampleRate(wav(96000, ds64, 'RF64'))).toBe(96000);
    expect(sniffSourceSampleRate(wav(44100, ds64, 'BW64'))).toBe(44100);
  });

  it('reads FLAC STREAMINFO (20-bit rate field)', () => {
    for (const rate of [8000, 44100, 48000, 88200, 96000, 192000, 352800, 384000]) {
      expect(sniffSourceSampleRate(flac(rate))).toBe(rate);
    }
  });

  it('returns null for FLAC without leading STREAMINFO', () => {
    expect(sniffSourceSampleRate(flac(44100, 4))).toBeNull();
  });

  it('returns null for other formats and implausible rates', () => {
    expect(sniffSourceSampleRate(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // ID3/MP3
    expect(sniffSourceSampleRate(new TextEncoder().encode('OggS\0\u0002 plenty of padding here'))).toBeNull();
    expect(sniffSourceSampleRate(wav(7999))).toBeNull();
    expect(sniffSourceSampleRate(wav(384001))).toBeNull();
    expect(sniffSourceSampleRate(wav(0))).toBeNull();
    expect(sniffSourceSampleRate(flac(0))).toBeNull();
    expect(sniffSourceSampleRate(new Uint8Array(0))).toBeNull();
  });

  it('returns null when the fmt chunk is missing, truncated or beyond the sniffed window', () => {
    expect(sniffSourceSampleRate(wav(48000).subarray(0, 24))).toBeNull();
    expect(sniffSourceSampleRate(wav(48000).subarray(0, 12))).toBeNull();
    expect(sniffSourceSampleRate(wav(48000, chunk('JUNK', new Array(70000).fill(0))))).toBeNull();
  });

  it('never throws on garbage or mutated headers', () => {
    const random = createRandom(7);
    for (let n = 0; n < 400; n++) {
      const bytes = new Uint8Array(Math.floor(random() * 200));
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
      expect(() => sniffSourceSampleRate(bytes)).not.toThrow();
    }
    const seeds = [wav(44100), flac(48000), wav(96000, chunk('JUNK', [1, 2, 3]), 'RF64')];
    for (let n = 0; n < 600; n++) {
      const bytes = Uint8Array.from(seeds[n % seeds.length] as Uint8Array);
      for (let k = 0; k < 1 + Math.floor(random() * 4); k++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      const cut = bytes.subarray(0, Math.floor(random() * (bytes.length + 1)));
      const rate = sniffSourceSampleRate(cut);
      expect(rate === null || (rate >= 8000 && rate <= 384000)).toBe(true);
    }
  });
});
