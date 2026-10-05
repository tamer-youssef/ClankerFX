import { describe, expect, it } from 'vitest';
import { defaultExportSettings } from '../types/output';
import { resolveTargetSampleRate } from './exporter';

describe('resolveTargetSampleRate', () => {
  it('keeps the source rate for "original" when the header revealed it', () => {
    expect(resolveTargetSampleRate(defaultExportSettings, 22050, 48000)).toBe(22050);
  });
  it('falls back to the context rate when the source rate is unknown', () => {
    expect(resolveTargetSampleRate(defaultExportSettings, null, 48000)).toBe(48000);
  });
  it('honours an explicit rate', () => {
    expect(resolveTargetSampleRate({ ...defaultExportSettings, sampleRate: 44100 }, 22050, 48000)).toBe(44100);
  });
});
