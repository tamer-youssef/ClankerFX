import { describe, expect, it } from 'vitest';
import { convertChannels, isEffectivelyMono, toMono, toStereo } from './channels';

const f = (...v: number[]) => Float32Array.from(v);

describe('isEffectivelyMono', () => {
  it('treats a single channel, no channels and identical channels as mono', () => {
    expect(isEffectivelyMono([])).toBe(true);
    expect(isEffectivelyMono([f(1, 2, 3)])).toBe(true);
    expect(isEffectivelyMono([f(1, 2, 3), f(1, 2, 3)])).toBe(true);
  });

  it('honours the epsilon', () => {
    expect(isEffectivelyMono([f(0.5, 0.25), f(0.5 + 5e-6, 0.25 - 5e-6)])).toBe(true);
    expect(isEffectivelyMono([f(0.5, 0.25), f(0.5 + 2e-5, 0.25)])).toBe(false);
    expect(isEffectivelyMono([f(0.5), f(0.5 + 2e-5)], 1e-4)).toBe(true);
    expect(isEffectivelyMono([f(0.5), f(0.5)], 0)).toBe(true);
  });

  it('is false for differing lengths and when any later channel differs', () => {
    expect(isEffectivelyMono([f(1, 2), f(1)])).toBe(false);
    expect(isEffectivelyMono([f(1), f(1), f(2)])).toBe(false);
  });
});

describe('toMono / toStereo', () => {
  it('averages channels into fresh arrays', () => {
    const left = f(1, 0, -1);
    const [mono] = toMono([left, f(0, 1, -1)]) as [Float32Array];
    expect([...mono]).toEqual([0.5, 0.5, -1]);
    const [single] = toMono([left]) as [Float32Array];
    expect(single).toEqual(left);
    expect(single).not.toBe(left);
    expect(toMono([])).toEqual([]);
  });

  it('averages more than two channels', () => {
    expect([...(toMono([f(3), f(0), f(0)])[0] as Float32Array)][0]).toBeCloseTo(1, 6);
  });

  it('duplicates mono into independent channels and passes stereo through', () => {
    const mono = f(1, 2);
    const [l, r] = toStereo([mono]) as [Float32Array, Float32Array];
    expect(l).toEqual(mono);
    expect(r).toEqual(mono);
    expect(l).not.toBe(r);
    const left = f(1);
    const right = f(2);
    const out = toStereo([left, right]);
    expect(out[0]).toBe(left);
    expect(out[1]).toBe(right);
    expect(toStereo([])).toEqual([]);
    expect(toStereo([left, right, f(3)]).length).toBe(2);
  });
});

describe('convertChannels', () => {
  const same = [f(0.1, 0.2), f(0.1, 0.2)];
  const different = [f(0.1, 0.2), f(0.3, 0.2)];

  it("'auto' follows the content", () => {
    expect(convertChannels(same, 'auto').length).toBe(1);
    expect(convertChannels(different, 'auto').length).toBe(2);
    expect(convertChannels([f(1)], 'auto').length).toBe(1);
  });

  it('forces mono or stereo', () => {
    expect(convertChannels(different, 'mono').length).toBe(1);
    expect([...(convertChannels(different, 'mono')[0] as Float32Array)][0]).toBeCloseTo(0.2, 6);
    expect(convertChannels([f(1, 2)], 'stereo').length).toBe(2);
    expect(convertChannels(same, 'stereo').length).toBe(2);
  });
});
