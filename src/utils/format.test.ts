import { describe, expect, it } from 'vitest';
import { formatBytes, formatTime } from './format';

describe('formatTime', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(3.456)).toBe('0:03.45');
    expect(formatTime(75.5)).toBe('1:15.50');
  });
  it('treats invalid input as zero', () => {
    expect(formatTime(-4)).toBe('0:00.00');
    expect(formatTime(Number.NaN)).toBe('0:00.00');
    expect(formatTime(Infinity)).toBe('0:00.00');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

