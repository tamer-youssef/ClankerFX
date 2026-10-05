import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '../effects/BaseEffect';
import { formatParamValue, positionToValue, stepValue, valueToPosition } from './paramScale';

const linear: ParamSpec = { label: 'x', min: 0, max: 10, default: 5, step: 0.5 };
const log: ParamSpec = { label: 'f', min: 20, max: 20000, default: 200, step: 1, scale: 'log', unit: 'Hz' };

describe('paramScale', () => {
  it('maps linear ranges', () => {
    expect(valueToPosition(linear, 5)).toBe(0.5);
    expect(positionToValue(linear, 0.5)).toBe(5);
    expect(positionToValue(linear, 0.26)).toBe(2.5); // snaps to step
  });

  it('puts the geometric middle of a log range at the slider centre', () => {
    expect(valueToPosition(log, 632.45)).toBeCloseTo(0.5, 2);
    expect(positionToValue(log, 0.5)).toBeCloseTo(632, -1);
  });

  it('round-trips and clamps at the ends', () => {
    for (const p of [0, 0.2, 0.7, 1]) {
      expect(valueToPosition(log, positionToValue(log, p))).toBeCloseTo(p, 1);
    }
    expect(positionToValue(log, -1)).toBe(20);
    expect(positionToValue(log, 9)).toBe(20000);
  });

  it('formats values', () => {
    expect(formatParamValue(log, 3200)).toBe('3.2 kHz');
    expect(formatParamValue(log, 12000)).toBe('12 kHz');
    expect(formatParamValue(log, 440)).toBe('440 Hz');
    expect(formatParamValue({ ...linear, unit: 'dB' }, 2.5)).toBe('2.5 dB');
    expect(formatParamValue({ ...linear, percent: true, min: 0, max: 1, step: 0.01 }, 0.35)).toBe('35%');
    expect(formatParamValue({ ...linear, options: [{ value: 1, label: 'One' }] }, 1)).toBe('One');
  });
});

describe('stepValue', () => {
  it('moves linear parameters by exactly one step, or ten for a large step', () => {
    expect(stepValue(linear, 5, 1)).toBe(5.5);
    expect(stepValue(linear, 5, -1)).toBe(4.5);
    expect(stepValue(linear, 5, 1, true)).toBe(10);
  });

  it('clamps at the ends', () => {
    expect(stepValue(linear, 10, 1)).toBe(10);
    expect(stepValue(linear, 0, -1)).toBe(0);
  });

  it('always changes the value, including coarse parameters (the 1/1000 slider bug)', () => {
    const coarse: ParamSpec = { label: 'x', min: 0, max: 40, default: 20, step: 0.5 }; // 80 steps < 1000 positions
    expect(stepValue(coarse, 20, 1)).toBe(20.5);
    const percent: ParamSpec = { label: 'p', min: 0, max: 1, default: 0.5, step: 0.01, percent: true };
    expect(stepValue(percent, 0.5, -1)).toBe(0.49);
  });

  it('steps log parameters proportionally and monotonically', () => {
    const up = stepValue(log, 200, 1);
    const down = stepValue(log, 200, -1);
    expect(up).toBeGreaterThan(200);
    expect(down).toBeLessThan(200);
    expect(stepValue(log, 20000, 1)).toBe(20000);
    let v = 20;
    for (let i = 0; i < 400 && v < 20000; i++) {
      const next = stepValue(log, v, 1);
      expect(next).toBeGreaterThan(v);
      v = next;
    }
    expect(v).toBe(20000);
  });
});
