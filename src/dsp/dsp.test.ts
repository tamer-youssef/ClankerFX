import { describe, expect, it } from 'vitest';
import { createShaperCurve, shapeSample } from './curves';
import { generateReverbImpulse } from './impulse';
import { generateNoise } from './noise';
import { createRandom } from './random';

const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);

describe('createRandom', () => {
  it('is deterministic per seed and bounded to [0,1)', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });
});

describe('shaper curves', () => {
  it.each(['soft', 'hard', 'fold'] as const)('%s curve is bounded and odd-symmetric', (shape) => {
    const curve = createShaperCurve(shape);
    for (let i = 0; i < curve.length; i++) {
      expect(Math.abs(curve[i]!)).toBeLessThanOrEqual(1 + 1e-6);
      expect(curve[i]! + curve[curve.length - 1 - i]!).toBeCloseTo(0, 5);
    }
  });

  it('soft and hard curves are monotonic', () => {
    for (const shape of ['soft', 'hard'] as const) {
      const curve = createShaperCurve(shape);
      for (let i = 1; i < curve.length; i++) expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
    }
  });

  it('is near-linear for small signals', () => {
    expect(shapeSample('soft', 0.01)).toBeCloseTo(0.01, 4);
    expect(shapeSample('hard', 0.3)).toBe(0.3);
    expect(shapeSample('hard', 3)).toBe(1);
  });
});

describe('generateReverbImpulse', () => {
  it('is deterministic and stereo-decorrelated', () => {
    const a = generateReverbImpulse(8000, 0.5, 6000, 3);
    const b = generateReverbImpulse(8000, 0.5, 6000, 3);
    expect(a).toHaveLength(2);
    expect(Array.from(a[0]!.slice(0, 50))).toEqual(Array.from(b[0]!.slice(0, 50)));
    expect(Array.from(a[0]!.slice(100, 150))).not.toEqual(Array.from(a[1]!.slice(100, 150)));
  });

  it('decays: the tail is far quieter than the head', () => {
    const [left] = generateReverbImpulse(8000, 1, 6000);
    const quarter = Math.floor(left!.length / 4);
    expect(rms(left!.slice(left!.length - quarter))).toBeLessThan(rms(left!.slice(0, quarter)) * 0.05);
  });

  it('has the requested length and finite samples', () => {
    const [left] = generateReverbImpulse(8000, 0.25, 4000);
    expect(left!.length).toBe(2000);
    expect(left!.every(Number.isFinite)).toBe(true);
  });
});

describe('generateNoise', () => {
  it.each(['white', 'pink', 'crackle'] as const)('%s noise is deterministic and unit-RMS', (kind) => {
    const a = generateNoise(kind, 20000, 2, 5);
    const b = generateNoise(kind, 20000, 2, 5);
    expect(Array.from(a[0]!.slice(0, 100))).toEqual(Array.from(b[0]!.slice(0, 100)));
    expect(rms(a[0]!)).toBeCloseTo(1, 5);
    expect(a[0]!.every(Number.isFinite)).toBe(true);
    expect(Array.from(a[0]!.slice(0, 100))).not.toEqual(Array.from(a[1]!.slice(0, 100)));
  });

  it('pink noise has more low-frequency energy than white', () => {
    // Crude spectral tilt check: pink changes more slowly sample-to-sample.
    const diffEnergy = (data: Float32Array) => {
      let sum = 0;
      for (let i = 1; i < data.length; i++) sum += (data[i]! - data[i - 1]!) ** 2;
      return sum / data.length;
    };
    expect(diffEnergy(generateNoise('pink', 20000, 1)[0]!)).toBeLessThan(diffEnergy(generateNoise('white', 20000, 1)[0]!));
  });
});
