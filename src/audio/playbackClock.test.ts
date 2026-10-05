import { describe, expect, it } from 'vitest';
import { clampSeek, positionAt, type ClockAnchor } from './playbackClock';

const anchor = (overrides: Partial<ClockAnchor> = {}): ClockAnchor => ({
  startContextTime: 10,
  startOffset: 2,
  loop: false,
  duration: 8,
  ...overrides,
});

describe('positionAt', () => {
  it('advances with the audio clock from the start offset', () => {
    expect(positionAt(anchor(), 10)).toBe(2);
    expect(positionAt(anchor(), 13.5)).toBeCloseTo(5.5);
  });
  it('clamps at the end when not looping', () => {
    expect(positionAt(anchor(), 100)).toBe(8);
  });
  it('wraps when looping', () => {
    expect(positionAt(anchor({ loop: true }), 10 + 7)).toBeCloseTo(1); // 2 + 7 = 9 → 1
  });
  it('never goes backwards if the context time precedes the anchor', () => {
    expect(positionAt(anchor(), 9)).toBe(2);
  });
  it('returns zero for an empty buffer', () => {
    expect(positionAt(anchor({ duration: 0 }), 20)).toBe(0);
  });
});

describe('clampSeek', () => {
  it('keeps targets inside the buffer', () => {
    expect(clampSeek(-3, 10)).toBe(0);
    expect(clampSeek(4, 10)).toBe(4);
    expect(clampSeek(10, 10)).toBeLessThan(10);
  });
  it('handles invalid input', () => {
    expect(clampSeek(Number.NaN, 10)).toBe(0);
    expect(clampSeek(5, 0)).toBe(0);
  });
});
