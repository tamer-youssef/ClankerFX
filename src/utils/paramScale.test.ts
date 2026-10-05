import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '../effects/BaseEffect';
import { formatParamValue, positionToValue, valueToPosition } from './paramScale';

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
