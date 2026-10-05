import { describe, expect, it } from 'vitest';
import { clamp, clamp01, dbToGain, gainToDb, lerp, lerpLog } from './math';

describe('math helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
  });
  it('interpolates linearly and logarithmically', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerpLog(100, 10000, 0.5)).toBeCloseTo(1000);
    expect(lerpLog(20, 5000, 0)).toBeCloseTo(20);
    expect(lerpLog(20, 5000, 1)).toBeCloseTo(5000);
  });
  it('converts decibels', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(gainToDb(dbToGain(-12))).toBeCloseTo(-12);
    expect(gainToDb(0)).toBeLessThan(-200);
  });
});
