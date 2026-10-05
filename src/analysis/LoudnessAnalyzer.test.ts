import { describe, expect, it } from 'vitest';
import { kWeightHighPass, kWeightShelf, measureLoudness } from './LoudnessAnalyzer';

const tone = (frequency: number, amplitude: number, seconds: number, sampleRate: number) =>
  Float32Array.from({ length: Math.floor(seconds * sampleRate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));

const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const AMP_23 = Math.pow(10, -23 / 20);

describe('K-weighting coefficients', () => {
  it('reproduce the published 48 kHz BS.1770 values', () => {
    const shelf = kWeightShelf(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 9);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 9);
    const hp = kWeightHighPass(48000);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 7);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 7);
  });
});

describe('measureLoudness', () => {
  it.each([44100, 48000, 96000])('a -23 dBFS 1 kHz stereo sine measures -23 LUFS at %i Hz', (sr) => {
    const x = tone(1000, AMP_23, 5, sr);
    const { lufs, gatedBlocks } = measureLoudness([x, x], sr);
    expect(lufs).not.toBeNull();
    expect(Math.abs((lufs as number) + 23)).toBeLessThan(0.1);
    expect(gatedBlocks).toBeGreaterThan(40);
    // Reported for the log: the actual deviation
    console.log(`-23 dBFS 1 kHz stereo @ ${sr}: ${(lufs as number).toFixed(4)} LUFS`);
  });

  it('a full-scale 1 kHz stereo sine measures about 0 LUFS', () => {
    const x = tone(1000, 1, 5, 48000);
    expect(Math.abs((measureLoudness([x, x], 48000).lufs as number) - 0)).toBeLessThan(0.1);
  });

  it('a single channel is treated as dual mono', () => {
    const x = tone(1000, 0.2, 3, 48000);
    const mono = measureLoudness([x], 48000).lufs as number;
    const stereo = measureLoudness([x, x], 48000).lufs as number;
    expect(mono).toBeCloseTo(stereo, 9);
  });

  it('a stereo signal with one silent channel is 3 LU quieter than the same tone in both', () => {
    const x = tone(1000, 0.2, 3, 48000);
    const both = measureLoudness([x, x], 48000).lufs as number;
    const one = measureLoudness([x, new Float32Array(x.length)], 48000).lufs as number;
    expect(both - one).toBeCloseTo(3.0103, 2);
  });

  it('silence gaps do not change integrated loudness (absolute gate)', () => {
    const sr = 48000;
    const x = tone(1000, AMP_23, 10, sr);
    const gap = new Float32Array(sr * 5);
    const plain = measureLoudness([x, x], sr).lufs as number;
    const gapped = concat(x, gap, x, gap);
    const withGaps = measureLoudness([gapped, gapped], sr).lufs as number;
    // Blocks straddling a tone/silence edge are only partly silent and legitimately pass the gates (<= ~0.2 LU here);
    // ungating the silence would instead pull the result down by several LU.
    expect(Math.abs(withGaps - plain)).toBeLessThan(0.25);
    expect(measureLoudness([gapped, gapped], sr).gatedBlocks).toBeLessThan(2 * 97 + 12);
  });

  it('a section 10+ LU quieter is excluded by the relative gate', () => {
    const sr = 48000;
    const loud = tone(1000, AMP_23, 8, sr);
    const quiet = tone(1000, AMP_23 * Math.pow(10, -15 / 20), 8, sr);
    const loudOnly = measureLoudness([loud, loud], sr).lufs as number;
    const mixed = concat(loud, quiet);
    const result = measureLoudness([mixed, mixed], sr);
    // Edge blocks mixing both parts still pass the gate, hence the small slack; the ungated mean would be ~3 LU lower.
    expect(Math.abs((result.lufs as number) - loudOnly)).toBeLessThan(0.25);
    expect(result.gatedBlocks).toBeLessThan(77 + 12);
  });

  it('a section only 5 LU quieter still counts', () => {
    const sr = 48000;
    const loud = tone(1000, AMP_23, 4, sr);
    const quiet = tone(1000, AMP_23 * Math.pow(10, -5 / 20), 4, sr);
    const mixed = concat(loud, quiet);
    const expected = 10 * Math.log10((1 + Math.pow(10, -0.5)) / 2) - 23;
    expect(Math.abs((measureLoudness([mixed, mixed], sr).lufs as number) - expected)).toBeLessThan(0.15);
  });

  it('measures very short (< 400 ms) input as a single block', () => {
    const sr = 48000;
    const x = tone(1000, 0.5, 0.2, sr);
    const { lufs, gatedBlocks } = measureLoudness([x, x], sr);
    expect(gatedBlocks).toBe(1);
    expect(lufs as number).toBeCloseTo(-0.691 + 10 * Math.log10(2 * 0.125) + 0.69, 1); // 2 channels x A^2/2, plus K(1 kHz) = +0.69 dB
    const longer = tone(1000, 0.5, 2, sr);
    expect(Math.abs((lufs as number) - (measureLoudness([longer, longer], sr).lufs as number))).toBeLessThan(0.3);
  });

  it('returns null for silence, for content below -70 LUFS, and for empty input', () => {
    expect(measureLoudness([new Float32Array(48000)], 48000).lufs).toBeNull();
    const faint = tone(1000, Math.pow(10, -90 / 20), 2, 48000);
    expect(measureLoudness([faint, faint], 48000).lufs).toBeNull();
    expect(measureLoudness([faint], 48000).lufs).toBeNull();
    expect(measureLoudness([new Float32Array(0)], 48000).lufs).toBeNull();
    expect(measureLoudness([], 48000).lufs).toBeNull();
  });

  it('is deterministic and handles a 10-minute file quickly', () => {
    const sr = 48000;
    const x = tone(440, 0.1, 5, sr);
    expect(measureLoudness([x, x], sr)).toEqual(measureLoudness([x, x], sr));
    const long = new Float32Array(600 * sr);
    for (let i = 0; i < long.length; i++) long[i] = 0.1 * Math.sin(i * 0.05);
    const started = performance.now();
    const result = measureLoudness([long, long], sr);
    const elapsed = performance.now() - started;
    console.log(`loudness of 10 min stereo @48k: ${elapsed.toFixed(0)} ms -> ${(result.lufs as number).toFixed(2)} LUFS`);
    expect(result.gatedBlocks).toBeGreaterThan(5900);
    expect(elapsed).toBeLessThan(5000);
  });
});
