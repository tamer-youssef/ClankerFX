import { describe, expect, it } from 'vitest';
import { createEffectState } from '../effects/registry';
import type { EffectState } from '../types/effects';
import { estimateTailSeconds, trimTrailingSilence } from './renderTail';

const make = (type: string, patch: Partial<EffectState> = {}, params: Record<string, number> = {}): EffectState => {
  const effect = createEffectState(type)!;
  return { ...effect, ...patch, params: { ...effect.params, ...params } };
};

describe('estimateTailSeconds', () => {
  it('is short with no effects', () => {
    expect(estimateTailSeconds([])).toBeLessThan(0.2);
  });

  it('covers a reverb decay', () => {
    expect(estimateTailSeconds([make('reverb', { amount: 1 }, { decaySeconds: 3, preDelayMs: 50 })])).toBeCloseTo(3.05, 2);
  });

  it('covers the echo train of a feedback delay', () => {
    const tail = estimateTailSeconds([make('delay', { amount: 1 }, { timeMs: 300, feedback: 0.5 })]);
    expect(tail).toBeGreaterThan(300 / 1000 * 8); // 0.5^n < 0.001 needs 10 repeats
  });

  it('ignores disabled and inaudible effects', () => {
    expect(estimateTailSeconds([make('reverb', { enabled: false, amount: 1 }, { decaySeconds: 6 })])).toBeLessThan(0.2);
    expect(estimateTailSeconds([make('reverb', { amount: 0 }, { decaySeconds: 6 })])).toBeLessThan(0.2);
  });

  it('is capped', () => {
    expect(estimateTailSeconds([make('delay', { amount: 1 }, { timeMs: 1000, feedback: 0.85 })])).toBeLessThanOrEqual(8);
  });
});

describe('trimTrailingSilence', () => {
  const build = (length: number, audibleUntil: number) => {
    const data = new Float32Array(length);
    for (let i = 0; i < audibleUntil; i++) data[i] = 0.5;
    return [data, data.slice()];
  };

  it('removes a silent tail but keeps a pad', () => {
    const out = trimTrailingSilence(build(10000, 4000), 3000, 1000, -80, 0.05);
    expect(out[0]!.length).toBe(4050);
  });

  it('never shortens below the source length', () => {
    const out = trimTrailingSilence(build(10000, 100), 3000, 1000, -80, 0);
    expect(out[0]!.length).toBe(3000);
  });

  it('keeps everything when the tail is audible to the end', () => {
    expect(trimTrailingSilence(build(500, 500), 100, 1000)[0]!.length).toBe(500);
  });

  it('treats very quiet tails as silence', () => {
    const [left] = build(10000, 2000);
    left![5000] = 1e-6; // −120 dB
    expect(trimTrailingSilence([left!], 1000, 1000, -80, 0)[0]!.length).toBe(2000);
  });
});
