import { describe, expect, it } from 'vitest';
import { createRandom } from '../dsp/random';
import { linearToDb, samplePeak, truePeak, TruePeakDetector } from './PeakAnalyzer';

const SR = 48000;
const tone = (frequency: number, phase: number, amplitude: number, seconds = 0.2, sampleRate = SR) =>
  Float32Array.from({ length: Math.floor(seconds * sampleRate) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase));

describe('samplePeak / linearToDb', () => {
  it('takes the max absolute value across channels', () => {
    expect(samplePeak([Float32Array.of(0.1, -0.5, 0.2), Float32Array.of(0.3, 0.4, -0.75)])).toBeCloseTo(0.75, 6);
    expect(samplePeak([])).toBe(0);
  });
  it('converts to dB with -Infinity for silence', () => {
    expect(linearToDb(0)).toBe(-Infinity);
    expect(linearToDb(1)).toBeCloseTo(0, 10);
    expect(linearToDb(0.5)).toBeCloseTo(-6.0206, 3);
  });
});

describe('truePeak', () => {
  it('recovers a fs/4 sine at 45 degrees whose sample peak is 0.707 A', () => {
    const x = tone(SR / 4, Math.PI / 4, 1);
    expect(samplePeak([x])).toBeCloseTo(Math.SQRT1_2, 3);
    expect(truePeak([x])).toBeGreaterThanOrEqual(0.98);
    expect(truePeak([x])).toBeLessThan(1.02);
  });

  it('is never below the sample peak, for any phase and frequency', () => {
    const random = createRandom(7);
    for (let n = 0; n < 40; n++) {
      const x = tone(100 + random() * 20000, random() * 6.28, 0.1 + random() * 0.9, 0.05);
      expect(truePeak([x])).toBeGreaterThanOrEqual(samplePeak([x]));
    }
  });

  it('stays accurate for higher-frequency sines (0.4 fs)', () => {
    // Faded in/out: an abruptly truncated sine legitimately overshoots at its edges (Gibbs), which is not under test.
    const faded = (phase: number) => {
      const x = tone(SR * 0.4, phase, 1, 0.2);
      return x.map((v, i) => v * Math.min(1, i / 3000, (x.length - 1 - i) / 3000));
    };
    const worst = [0, 0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8].map((phase) => truePeak([faded(phase)]));
    expect(Math.max(...worst)).toBeLessThan(1.03);
    expect(Math.max(...worst)).toBeGreaterThan(0.97);
  });

  it('returns 0 for silence and an empty input', () => {
    expect(truePeak([new Float32Array(1000)])).toBe(0);
    expect(truePeak([])).toBe(0);
    expect(truePeak([new Float32Array(0)])).toBe(0);
  });

  it('scan (block-skipping) matches the streaming detector exactly', () => {
    const random = createRandom(3);
    const x = Float32Array.from({ length: 5000 }, (_, i) => (random() * 2 - 1) * (i % 1000 < 100 ? 1 : 0.05));
    const detector = new TruePeakDetector(4);
    let streamed = 0;
    for (let i = 0; i < x.length + TruePeakDetector.latency; i++) streamed = Math.max(streamed, detector.push(i < x.length ? (x[i] as number) : 0));
    expect(detector.scan(x)).toBeCloseTo(streamed, 12);
    expect(truePeak([x])).toBeCloseTo(streamed, 12);
  });

  it('oversample 1 reduces to the sample peak', () => {
    const x = tone(SR / 4, Math.PI / 4, 1);
    expect(truePeak([x], 1)).toBeCloseTo(samplePeak([x]), 9);
  });
});
