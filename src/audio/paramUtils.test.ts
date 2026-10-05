import { describe, expect, it } from 'vitest';
import { NON_RESONANT_Q_DB } from './paramUtils';

describe('NON_RESONANT_Q_DB', () => {
  it('is the dB value of a linear Butterworth Q of 1/√2 (≈ −3.01 dB)', () => {
    expect(NON_RESONANT_Q_DB).toBeCloseTo(-3.0103, 3);
    expect(Math.pow(10, NON_RESONANT_Q_DB / 20)).toBeCloseTo(Math.SQRT1_2, 9);
  });
});
