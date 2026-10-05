import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav } from './WavEncoder';
import { createRandom } from '../dsp/random';
import { sine } from '../dsp/testSignals';

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

describe('encodeWav header', () => {
  it('writes a canonical 16-bit stereo header field by field', () => {
    const left = new Float32Array(10).fill(0.25);
    const { bytes } = encodeWav([left, left], 44100, { bitDepth: 16, dither: false });
    const v = new DataView(bytes.buffer);
    expect(bytes.length).toBe(44 + 10 * 4);
    expect(ascii(bytes, 0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(ascii(bytes, 8)).toBe('WAVE');
    expect(ascii(bytes, 12)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(40);
  });

  it('writes 24-bit mono fields and pads odd data to a word boundary', () => {
    const { bytes } = encodeWav([new Float32Array(3)], 48000, { bitDepth: 24 });
    const v = new DataView(bytes.buffer);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(28, true)).toBe(48000 * 3);
    expect(v.getUint16(32, true)).toBe(3);
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(9); // data size excludes the pad byte
    expect(bytes.length).toBe(44 + 9 + 1);
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(bytes[bytes.length - 1]).toBe(0);
  });

  it('encodes empty audio as a valid header-only file', () => {
    const { bytes, peak, clippedSamples } = encodeWav([new Float32Array(0)], 44100, { bitDepth: 16 });
    expect(bytes.length).toBe(44);
    expect(peak).toBe(0);
    expect(clippedSamples).toBe(0);
    expect(decodeWav(bytes)?.channels[0]?.length).toBe(0);
  });

  it('returns a Uint8Array backed by a plain ArrayBuffer', () => {
    const { bytes } = encodeWav([new Float32Array(2)], 44100, { bitDepth: 16 });
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(bytes.length);
  });
});

describe('encodeWav samples', () => {
  it('uses symmetric full scale: +1 → 32767, -1 → -32767, and 24-bit ±8388607', () => {
    const data = Float32Array.from([1, -1, 0, 0.5, -0.5]);
    const v16 = new DataView(encodeWav([data], 44100, { bitDepth: 16, dither: false }).bytes.buffer);
    expect([0, 1, 2, 3, 4].map((i) => v16.getInt16(44 + i * 2, true))).toEqual([32767, -32767, 0, 16384, -16384]);
    const b24 = encodeWav([Float32Array.from([1, -1])], 44100, { bitDepth: 24 }).bytes;
    expect([...b24.subarray(44, 50)]).toEqual([0xff, 0xff, 0x7f, 0x01, 0x00, 0x80]);
  });

  it('interleaves channels', () => {
    const { bytes } = encodeWav([Float32Array.from([0.5, 0.25]), Float32Array.from([-0.5, -0.25])], 44100, { bitDepth: 16, dither: false });
    const v = new DataView(bytes.buffer);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([16384, -16384, 8192, -8192]);
  });

  it('counts clipped samples, clamps them and reports the pre-clamp peak; NaN is silent and uncounted', () => {
    const data = Float32Array.from([1.5, -2, 1, -1, NaN, 0.3, Infinity]);
    const { bytes, clippedSamples, peak } = encodeWav([data], 44100, { bitDepth: 16, dither: false });
    const v = new DataView(bytes.buffer);
    expect(clippedSamples).toBe(3);
    expect(peak).toBe(Infinity);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32767);
    expect(v.getInt16(52, true)).toBe(0);
    const finite = encodeWav([Float32Array.from([1.5, -2, NaN])], 44100, { bitDepth: 24 });
    expect(finite.peak).toBe(2);
    expect(finite.clippedSamples).toBe(2);
  });

  it('is deterministic with dither and differs from undithered output', () => {
    const data = sine(1000, 0.05, 0.3);
    const a = encodeWav([data], 44100, { bitDepth: 16, seed: 5 }).bytes;
    const b = encodeWav([data], 44100, { bitDepth: 16, seed: 5 }).bytes;
    const c = encodeWav([data], 44100, { bitDepth: 16, seed: 6 }).bytes;
    const plain = encodeWav([data], 44100, { bitDepth: 16, dither: false }).bytes;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).not.toEqual(plain);
  });

  it('never dithers 24-bit output', () => {
    const data = sine(1000, 0.05, 0.3);
    expect(encodeWav([data], 44100, { bitDepth: 24, seed: 1 }).bytes).toEqual(encodeWav([data], 44100, { bitDepth: 24, seed: 2, dither: true }).bytes);
  });

  it('does not let dither overflow near full scale', () => {
    const data = new Float32Array(2000).fill(1);
    const decoded = decodeWav(encodeWav([data], 44100, { bitDepth: 16 }).bytes);
    for (const s of decoded?.channels[0] ?? []) expect(s).toBeLessThanOrEqual(32767 / 32768 + 1e-9);
  });

  it('rejects unsupported channel counts, mismatched lengths and bad rates', () => {
    expect(() => encodeWav([], 44100, { bitDepth: 16 })).toThrow(/1 or 2 channels/);
    expect(() => encodeWav([new Float32Array(1), new Float32Array(1), new Float32Array(1)], 44100, { bitDepth: 16 })).toThrow(/1 or 2 channels/);
    expect(() => encodeWav([new Float32Array(2), new Float32Array(3)], 44100, { bitDepth: 16 })).toThrow(/same length/);
    expect(() => encodeWav([new Float32Array(2)], 0, { bitDepth: 16 })).toThrow(/sample rate/);
    expect(() => encodeWav([new Float32Array(2)], 44100.5, { bitDepth: 16 })).toThrow(/sample rate/);
  });
});

describe('encode → decode round trips', () => {
  const noise = (n: number, seed: number) => {
    const r = createRandom(seed);
    return Float32Array.from({ length: n }, () => (r() * 2 - 1) * 0.9);
  };

  it('16-bit undithered error stays within about 1.5 quantiser steps', () => {
    const data = noise(5000, 1);
    const out = decodeWav(encodeWav([data], 44100, { bitDepth: 16, dither: false }).bytes);
    expect(out?.bitDepth).toBe(16);
    expect(out?.sampleRate).toBe(44100);
    let maxError = 0;
    out?.channels[0]?.forEach((v, i) => (maxError = Math.max(maxError, Math.abs(v - (data[i] as number)))));
    expect(maxError).toBeLessThanOrEqual(1.5 / 32768);
  });

  it('16-bit dithered error is bounded, zero-mean and noise-like', () => {
    const data = sine(997, 1, 0.5);
    const out = decodeWav(encodeWav([data], 44100, { bitDepth: 16 }).bytes)?.channels[0] as Float32Array;
    let sum = 0;
    let sumSq = 0;
    let maxError = 0;
    for (let i = 0; i < data.length; i++) {
      const e = (out[i] as number) - (data[i] as number);
      sum += e;
      sumSq += e * e;
      maxError = Math.max(maxError, Math.abs(e));
    }
    const lsb = 1 / 32768;
    expect(maxError).toBeLessThanOrEqual(2.5 * lsb);
    expect(Math.abs(sum / data.length)).toBeLessThan(0.02 * lsb);
    // TPDF (±1 LSB) plus rounding: variance = 1/6 + 1/12 LSB².
    expect(Math.sqrt(sumSq / data.length)).toBeGreaterThan(0.4 * lsb);
    expect(Math.sqrt(sumSq / data.length)).toBeLessThan(0.65 * lsb);
  });

  it('dither decorrelates quantisation error from a quiet signal (no distortion floor)', () => {
    // A tone of a few LSBs: undithered, the error is correlated with the signal; dithered, it is not.
    const tone = sine(441, 1, 4 / 32768);
    const correlation = (dither: boolean) => {
      const out = decodeWav(encodeWav([tone], 44100, { bitDepth: 16, dither, seed: 3 }).bytes)?.channels[0] as Float32Array;
      let cross = 0;
      let eSq = 0;
      let sSq = 0;
      for (let i = 0; i < tone.length; i++) {
        const e = (out[i] as number) - (tone[i] as number);
        cross += e * (tone[i] as number);
        eSq += e * e;
        sSq += (tone[i] as number) ** 2;
      }
      return Math.abs(cross) / Math.sqrt(eSq * sSq);
    };
    expect(correlation(true)).toBeLessThan(0.05);
    expect(correlation(true)).toBeLessThan(correlation(false));
  });

  it('24-bit error is within half a step plus decode scale', () => {
    const data = noise(5000, 2);
    const out = decodeWav(encodeWav([data, noise(5000, 3)], 96000, { bitDepth: 24 }).bytes);
    expect(out?.bitDepth).toBe(24);
    expect(out?.sampleRate).toBe(96000);
    expect(out?.channels.length).toBe(2);
    let maxError = 0;
    out?.channels[0]?.forEach((v, i) => (maxError = Math.max(maxError, Math.abs(v - (data[i] as number)))));
    expect(maxError).toBeLessThanOrEqual(1.5 / 8388608);
  });

  it('24-bit odd-length mono (padded) round-trips', () => {
    const data = noise(7, 4);
    const out = decodeWav(encodeWav([data], 44100, { bitDepth: 24 }).bytes);
    expect(out?.channels[0]?.length).toBe(7);
  });

  it('preserves negative 24-bit values', () => {
    const out = decodeWav(encodeWav([Float32Array.from([-0.5, -1e-6, -1])], 44100, { bitDepth: 24 }).bytes)?.channels[0] as Float32Array;
    expect(out[0]).toBeCloseTo(-0.5, 6);
    expect(out[1]).toBeLessThan(0);
    expect(out[2]).toBeCloseTo(-1, 6);
  });
});

// Hand-assembled WAV files for the decoder.
function u16(v: number): number[] {
  return [v & 255, (v >> 8) & 255];
}
function u32(v: number): number[] {
  return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
}
function chunk(id: string, body: number[], declaredSize = body.length): number[] {
  return [...[...id].map((c) => c.charCodeAt(0)), ...u32(declaredSize), ...body, ...(body.length % 2 ? [0] : [])];
}
function riff(chunks: number[][], riffSize?: number): Uint8Array {
  const body = [...'WAVE'].map((c) => c.charCodeAt(0)).concat(...chunks);
  return Uint8Array.from([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...u32(riffSize ?? body.length), ...body]);
}
function fmt(tag: number, channels: number, rate: number, bits: number): number[] {
  const align = (channels * bits) / 8;
  return chunk('fmt ', [...u16(tag), ...u16(channels), ...u32(rate), ...u32(rate * align), ...u16(align), ...u16(bits)]);
}
function extensibleFmt(subTag: number, channels: number, rate: number, bits: number): number[] {
  const align = (channels * bits) / 8;
  const guid = [...u16(subTag), 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71];
  return chunk('fmt ', [
    ...u16(0xfffe), ...u16(channels), ...u32(rate), ...u32(rate * align), ...u16(align), ...u16(bits),
    ...u16(22), ...u16(bits), ...u32(3), ...guid,
  ]);
}

describe('decodeWav', () => {
  it('decodes 32-bit float and 32-bit PCM', () => {
    const f32 = new Uint8Array(new Float32Array([0.5, -0.25, NaN]).buffer);
    const float = decodeWav(riff([fmt(3, 1, 48000, 32), chunk('data', [...f32])]));
    expect(float?.bitDepth).toBe(32);
    expect([...(float?.channels[0] ?? [])]).toEqual([0.5, -0.25, 0]);
    const pcm = decodeWav(riff([fmt(1, 1, 48000, 32), chunk('data', [...u32(0x40000000), ...u32(0x80000000)])]));
    expect([...(pcm?.channels[0] ?? [])]).toEqual([0.5, -1]);
  });

  it('skips LIST and odd-sized chunks, before and after data', () => {
    const wav = riff([chunk('LIST', [1, 2, 3, 4, 5]), fmt(1, 1, 44100, 16), chunk('fact', [0, 0, 0, 0]), chunk('data', [...u16(16384), ...u16(0xc000)]), chunk('LIST', [9, 9])]);
    expect([...(decodeWav(wav)?.channels[0] ?? [])]).toEqual([0.5, -0.5]);
  });

  it('handles WAVE_FORMAT_EXTENSIBLE (PCM and float)', () => {
    const pcm = decodeWav(riff([extensibleFmt(1, 2, 48000, 24), chunk('data', [0, 0, 0x40, 0, 0, 0xc0])]));
    expect(pcm?.channels.length).toBe(2);
    expect(pcm?.channels[0]?.[0]).toBe(0.5);
    expect(pcm?.channels[1]?.[0]).toBe(-0.5);
    const float = decodeWav(riff([extensibleFmt(3, 1, 48000, 32), chunk('data', [...new Uint8Array(new Float32Array([0.125]).buffer)])]));
    expect(float?.channels[0]?.[0]).toBe(0.125);
  });

  it('tolerates truncated data, dropping the partial frame', () => {
    const full = riff([fmt(1, 2, 44100, 16), chunk('data', new Array(40).fill(1))]);
    const cut = full.subarray(0, full.length - 3);
    expect(decodeWav(cut)?.channels[0]?.length).toBe(9);
  });

  it('treats data size 0 or 0xFFFFFFFF as streaming (to end of file)', () => {
    const body = [...u16(8192), ...u16(8192), ...u16(8192)];
    for (const declared of [0, 0xffffffff]) {
      const wav = riff([fmt(1, 1, 44100, 16), chunk('data', body, declared)], declared);
      expect(decodeWav(wav)?.channels[0]?.length).toBe(3);
    }
  });

  it('keeps a genuinely empty data chunk empty when another chunk follows', () => {
    const wav = riff([fmt(1, 1, 44100, 16), chunk('data', [], 0), chunk('LIST', [1, 2, 3, 4])]);
    expect(decodeWav(wav)?.channels[0]?.length).toBe(0);
  });

  it('returns null for unsupported or malformed files', () => {
    expect(decodeWav(new Uint8Array(0))).toBeNull();
    expect(decodeWav(new Uint8Array(11))).toBeNull();
    expect(decodeWav(Uint8Array.from([...'RIFX0000WAVE'].map((c) => c.charCodeAt(0))))).toBeNull();
    expect(decodeWav(riff([chunk('data', [1, 2])]))).toBeNull(); // no fmt
    expect(decodeWav(riff([fmt(1, 1, 44100, 16)]))).toBeNull(); // no data
    expect(decodeWav(riff([fmt(1, 1, 44100, 8), chunk('data', [1, 2])]))).toBeNull(); // 8-bit unsupported
    expect(decodeWav(riff([fmt(1, 0, 44100, 16), chunk('data', [1, 2])]))).toBeNull(); // zero channels
    expect(decodeWav(riff([fmt(1, 1, 0, 16), chunk('data', [1, 2])]))).toBeNull(); // zero rate
    expect(decodeWav(riff([fmt(2, 1, 44100, 4), chunk('data', [1, 2])]))).toBeNull(); // ADPCM
    expect(decodeWav(riff([chunk('fmt ', [1, 0, 1, 0]), chunk('data', [1, 2])]))).toBeNull(); // short fmt
  });

  it('never throws or reads out of bounds on garbage, truncation and mutation', () => {
    const random = createRandom(99);
    for (let n = 0; n < 300; n++) {
      const bytes = new Uint8Array(Math.floor(random() * 120));
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
      expect(() => decodeWav(bytes)).not.toThrow();
    }
    const valid = [
      encodeWav([sine(440, 0.01)], 44100, { bitDepth: 16 }).bytes,
      encodeWav([sine(440, 0.01), sine(550, 0.01)], 48000, { bitDepth: 24 }).bytes,
      riff([extensibleFmt(1, 2, 48000, 24), chunk('LIST', [1, 2, 3]), chunk('data', new Array(60).fill(3))]),
    ];
    for (let n = 0; n < 900; n++) {
      const bytes = Uint8Array.from(valid[n % valid.length] as Uint8Array);
      const hits = 1 + Math.floor(random() * 5);
      for (let k = 0; k < hits; k++) bytes[Math.floor(random() * Math.min(bytes.length, 80))] = Math.floor(random() * 256);
      const view = bytes.subarray(Math.floor(random() * 3), Math.floor(random() * (bytes.length + 1)));
      let result: ReturnType<typeof decodeWav> = null;
      expect(() => (result = decodeWav(view))).not.toThrow();
      if (result) {
        const r = result as NonNullable<ReturnType<typeof decodeWav>>;
        expect(r.channels.length).toBeGreaterThan(0);
        for (const ch of r.channels) for (const s of ch) expect(Number.isFinite(s)).toBe(true);
      }
    }
  });

  it('decodes from a subarray view with a non-zero byteOffset', () => {
    const wav = encodeWav([Float32Array.from([0.5])], 44100, { bitDepth: 16, dither: false }).bytes;
    const padded = new Uint8Array(wav.length + 7);
    padded.set(wav, 7);
    expect(decodeWav(padded.subarray(7))?.channels[0]?.[0]).toBeCloseTo(0.5, 3);
  });
});
