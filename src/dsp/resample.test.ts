import { describe, expect, it } from 'vitest';
import { resampleChannels } from './resample';
import { createRandom } from './random';
import { rms, sine } from './testSignals';

const db = (ratio: number) => 20 * Math.log10(ratio);

/** RMS over the interior of a signal, away from the zero-padded edges. */
function middleRms(data: Float32Array, rate: number, margin = 0.1): number {
  const m = Math.floor(margin * rate);
  return rms(data, m, data.length - m);
}

function multitone(freqs: number[], seconds: number, rate: number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * rate));
  for (const f of freqs) {
    const s = sine(f, seconds, 0.15, rate);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (s[i] as number);
  }
  return out;
}

function snrDb(reference: Float32Array, test: Float32Array, rate: number): number {
  const m = Math.floor(0.1 * rate);
  let signal = 0;
  let noise = 0;
  for (let i = m; i < reference.length - m; i++) {
    const r = reference[i] as number;
    signal += r * r;
    noise += (r - (test[i] as number)) ** 2;
  }
  return 10 * Math.log10(signal / Math.max(noise, 1e-30));
}

const PAIRS: Array<[number, number]> = [
  [44100, 48000],
  [48000, 44100],
  [44100, 96000],
  [96000, 44100],
  [48000, 96000],
  [96000, 48000],
  [22050, 44100],
  [44100, 22050],
];

describe('resampleChannels', () => {
  it('returns independent copies when rates are equal', () => {
    const input = [sine(440, 0.1)];
    const out = resampleChannels(input, 44100, 44100);
    expect(out[0]).toEqual(input[0]);
    expect(out[0]).not.toBe(input[0]);
  });

  it('produces round(length · to / from) samples for every channel', () => {
    for (const [from, to] of PAIRS) {
      for (const length of [0, 1, 7, 1000, 44123]) {
        const out = resampleChannels([new Float32Array(length), new Float32Array(length)], from, to);
        expect(out.length).toBe(2);
        for (const ch of out) expect(ch.length).toBe(Math.round((length * to) / from));
      }
    }
  });

  it('handles empty channel lists and rejects invalid rates', () => {
    expect(resampleChannels([], 44100, 48000)).toEqual([]);
    expect(() => resampleChannels([new Float32Array(1)], 0, 48000)).toThrow();
    expect(() => resampleChannels([new Float32Array(1)], 44100, NaN)).toThrow();
  });

  it('is flat within ±0.05 dB up to 0.9× the lower Nyquist', () => {
    let worst = 0;
    for (const [from, to] of PAIRS) {
      const nyquist = Math.min(from, to) / 2;
      for (const fraction of [0.01, 0.1, 0.3, 0.5, 0.7, 0.8, 0.9]) {
        const f = fraction * nyquist;
        const input = sine(f, 0.6, 0.5, from);
        const [out] = resampleChannels([input], from, to) as [Float32Array];
        const gain = db(middleRms(out, to) / middleRms(input, from));
        worst = Math.max(worst, Math.abs(gain));
        expect(Math.abs(gain), `${from}→${to} @ ${f} Hz`).toBeLessThan(0.05);
      }
    }
    console.info(`resample passband worst deviation: ${worst.toFixed(5)} dB`);
  });

  it('rejects tones above the new Nyquist by more than 80 dB when down-sampling', () => {
    let worst = Infinity;
    const cases: Array<[number, number, number]> = [
      [48000, 44100, 22100],
      [48000, 44100, 23000],
      [96000, 44100, 22100],
      [96000, 44100, 30000],
      [96000, 48000, 24100],
      [96000, 48000, 40000],
      [44100, 22050, 11100],
      [44100, 22050, 16000],
    ];
    for (const [from, to, f] of cases) {
      const input = sine(f, 0.6, 0.5, from);
      const [out] = resampleChannels([input], from, to) as [Float32Array];
      const attenuation = -db(middleRms(out, to) / middleRms(input, from));
      worst = Math.min(worst, attenuation);
      expect(attenuation, `${from}→${to} @ ${f} Hz`).toBeGreaterThan(80);
    }
    console.info(`resample worst stopband attenuation: ${worst.toFixed(1)} dB`);
  });

  it('preserves DC away from the edges and stays bounded at the edges', () => {
    for (const [from, to] of PAIRS) {
      const [out] = resampleChannels([new Float32Array(from).fill(0.5)], from, to) as [Float32Array];
      const margin = Math.floor(0.1 * to);
      for (let i = margin; i < out.length - margin; i += 97) expect(out[i]).toBeCloseTo(0.5, 5);
      // Band-limited interpolation of a step rings (about +13% overshoot), so allow that but nothing wild.
      for (const i of [0, 1, 2, out.length - 3, out.length - 2, out.length - 1]) {
        expect(out[i]).toBeGreaterThan(0.1);
        expect(out[i]).toBeLessThan(0.6);
      }
    }
  });

  it('round-trips in-band signals with SNR above 60 dB', () => {
    const rounds: Array<[number, number]> = [
      [44100, 48000],
      [44100, 96000],
      [48000, 96000],
      [48000, 44100],
      [96000, 44100],
    ];
    const worst: number[] = [];
    for (const [a, b] of rounds) {
      const freqs = [220, 1000, 4500, 9000, 15000, 0.85 * (Math.min(a, b) / 2)];
      const original = multitone(freqs, 1, a);
      const there = resampleChannels([original], a, b);
      const [back] = resampleChannels(there, b, a) as [Float32Array];
      expect(back.length).toBe(original.length);
      const snr = snrDb(original, back, a);
      worst.push(snr);
      expect(snr, `${a}↔${b}`).toBeGreaterThan(60);
    }
    console.info(`resample round-trip SNR (dB): ${worst.map((v) => v.toFixed(1)).join(', ')}`);
  });

  it('resamples channels independently and keeps their order', () => {
    const left = sine(500, 0.3, 0.5, 44100);
    const right = sine(1500, 0.3, 0.25, 44100);
    const [l, r] = resampleChannels([left, right], 44100, 48000) as [Float32Array, Float32Array];
    expect(middleRms(l, 48000)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(middleRms(r, 48000)).toBeCloseTo(0.25 / Math.SQRT2, 3);
  });

  it('never produces NaN or Infinity, even for loud noise and tiny inputs', () => {
    const random = createRandom(1);
    const noise = Float32Array.from({ length: 5000 }, () => (random() * 2 - 1) * 4);
    for (const [from, to] of PAIRS) {
      for (const input of [noise, new Float32Array(1).fill(1), new Float32Array(0)]) {
        for (const ch of resampleChannels([input], from, to)) for (const v of ch) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('handles awkward ratios through the interpolated-table path accurately', () => {
    const original = multitone([300, 3000, 12000], 1, 44100);
    const there = resampleChannels([original], 44100, 44101);
    expect(there[0]?.length).toBe(44101);
    const [back] = resampleChannels(there, 44101, 44100) as [Float32Array];
    expect(snrDb(original, back, 44100)).toBeGreaterThan(60);
    const [odd] = resampleChannels([sine(1000, 0.5, 0.5, 44100)], 44100, 32001.5) as [Float32Array];
    expect(odd.length).toBe(Math.round(22050 * (32001.5 / 44100)));
    expect(middleRms(odd, 32001)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });

  it('converts 60 s of stereo 48 kHz to 44.1 kHz quickly', () => {
    const random = createRandom(2);
    const make = () => Float32Array.from({ length: 48000 * 60 }, () => random() - 0.5);
    const input = [make(), make()];
    const start = performance.now();
    const out = resampleChannels(input, 48000, 44100);
    const ms = performance.now() - start;
    console.info(`resample 60 s stereo 48k→44.1k: ${ms.toFixed(0)} ms`);
    expect(out[0]?.length).toBe(44100 * 60);
    expect(ms).toBeLessThan(6000);
  });
});
