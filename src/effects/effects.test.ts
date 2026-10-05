import { describe, expect, it } from 'vitest';
import { clampParams, defaultParams, mixGains, type ParamValues } from './BaseEffect';
import { createEffectState, getEffectDefinition, listEffectDefinitions } from './registry';
import { sanitizeChain, sanitizeEffectState } from './serialization';

const definitions = listEffectDefinitions();

describe('registry', () => {
  it('has unique effect types', () => {
    const types = definitions.map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it.each(definitions.map((definition) => [definition.type, definition] as const))('%s has sane schema defaults', (_type, definition) => {
    expect(definition.defaultAmount).toBeGreaterThanOrEqual(0);
    expect(definition.defaultAmount).toBeLessThanOrEqual(1);
    for (const [key, spec] of Object.entries(definition.params)) {
      expect(spec.min, key).toBeLessThan(spec.max);
      expect(spec.default, key).toBeGreaterThanOrEqual(spec.min);
      expect(spec.default, key).toBeLessThanOrEqual(spec.max);
      if (spec.scale === 'log') expect(spec.min, `${key} log scale needs min > 0`).toBeGreaterThan(0);
      if (spec.options) expect(spec.options.some((option) => option.value === spec.default), key).toBe(true);
    }
  });

  it('creates effect states with unique ids and default params', () => {
    const a = createEffectState('ringmod');
    const b = createEffectState('ringmod');
    expect(a?.id).not.toBe(b?.id);
    expect(a?.params).toEqual(defaultParams(getEffectDefinition('ringmod')!.params));
    expect(createEffectState('nope')).toBeNull();
  });
});

describe('Amount contract', () => {
  // Amount 0 must be transparent: either the wet mix is 0, or parameters sit at their neutral values.
  const neutral: Record<string, Record<string, number>> = {
    gain: { gainDb: 0 },
    filter: { highpassHz: 10, lowpassHz: 20000 },
    eq: { lowDb: 0, lowMidDb: 0, highMidDb: 0, highDb: 0 },
    compressor: { thresholdDb: 0, ratio: 1, makeupDb: 0 },
    tremolo: { depth: 0 },
    stereo: { width: 1, haasMs: 0 },
  };

  it.each(definitions.map((definition) => [definition.type, definition] as const))('%s is transparent at 0%%', (type, definition) => {
    const resolved = definition.resolve(0, defaultParams(definition.params));
    const expected = neutral[type];
    if (expected) {
      expect(resolved.mix).toBe(1);
      for (const [key, value] of Object.entries(expected)) expect(resolved.params[key], key).toBeCloseTo(value, 6);
    } else {
      expect(resolved.mix).toBe(0);
    }
  });

  it('reproduces the configured parameters at 100% for parameter-mapped effects', () => {
    for (const [type, expected] of Object.entries({ gain: { gainDb: 6 }, tremolo: { depth: 0.8 }, stereo: { width: 1.6, haasMs: 10 } })) {
      const definition = getEffectDefinition(type)!;
      const resolved = definition.resolve(1, defaultParams(definition.params));
      for (const [key, value] of Object.entries(expected)) expect(resolved.params[key], `${type}.${key}`).toBeCloseTo(value, 6);
    }
  });

  it.each(definitions.map((definition) => [definition.type, definition] as const))(
    '%s stays finite and within declared bounds for any amount and extreme parameters',
    (_type, definition) => {
      const entries = Object.entries(definition.params);
      const corners: ParamValues[] = [
        Object.fromEntries(entries.map(([key, spec]) => [key, spec.min])),
        Object.fromEntries(entries.map(([key, spec]) => [key, spec.max])),
        defaultParams(definition.params),
      ];
      for (const corner of corners) {
        for (const amount of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
          const resolved = definition.resolve(amount, clampParams(definition.params, corner));
          expect(resolved.mix).toBeGreaterThanOrEqual(0);
          expect(resolved.mix).toBeLessThanOrEqual(1);
          for (const [key, spec] of entries) {
            const value = resolved.params[key]!;
            expect(Number.isFinite(value), key).toBe(true);
            expect(value, key).toBeGreaterThanOrEqual(spec.min - 1e-9);
            expect(value, key).toBeLessThanOrEqual(spec.max + 1e-9);
          }
        }
      }
    },
  );
});

describe('safety ceilings', () => {
  it('keeps feedback strictly below unity', () => {
    expect(getEffectDefinition('delay')!.params.feedback!.max).toBeLessThan(1);
    expect(getEffectDefinition('phaser')!.params.feedback!.max).toBeLessThan(1);
  });

  it('never lets filter cutoffs cross', () => {
    const filter = getEffectDefinition('filter')!;
    const resolved = filter.resolve(1, { highpassHz: 2000, lowpassHz: 500, slope: 24 });
    expect(resolved.params.highpassHz!).toBeLessThan(resolved.params.lowpassHz!);
  });

  it('keeps chorus modulation depth below the base delay', () => {
    const chorus = getEffectDefinition('chorus')!;
    const resolved = chorus.resolve(1, { rateHz: 1, depthMs: 8, delayMs: 8 });
    expect(resolved.params.depthMs!).toBeLessThan(8);
  });

  it('caps gain at a sane maximum', () => {
    expect(getEffectDefinition('gain')!.params.gainDb!.max).toBeLessThanOrEqual(12);
  });
});

describe('clampParams', () => {
  const schema = getEffectDefinition('delay')!.params;

  it('clamps out-of-range values', () => {
    const out = clampParams(schema, { timeMs: 99999, feedback: 5, dampingHz: -3 });
    expect(out.timeMs).toBe(1000);
    expect(out.feedback).toBe(0.85);
    expect(out.dampingHz).toBe(500);
  });

  it('replaces NaN, strings and missing values with defaults, and drops unknown keys', () => {
    const out = clampParams(schema, { timeMs: Number.NaN, feedback: '0.5', bogus: 1 });
    expect(out.timeMs).toBe(240);
    expect(out.feedback).toBe(0.35);
    expect('bogus' in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual(['dampingHz', 'feedback', 'timeMs']);
  });

  it('snaps option parameters to a valid option', () => {
    const out = clampParams(getEffectDefinition('ringmod')!.params, { shape: 2.4 });
    expect(out.shape).toBe(2);
  });
});

describe('mixGains', () => {
  it('crossfade is equal-power', () => {
    for (const mix of [0, 0.25, 0.5, 0.9, 1]) {
      const { dry, wet } = mixGains('crossfade', mix);
      expect(dry * dry + wet * wet).toBeCloseTo(1, 9);
    }
    expect(mixGains('crossfade', 0)).toEqual({ dry: 1, wet: 0 });
  });
  it('add keeps dry at unity', () => {
    expect(mixGains('add', 0.4)).toEqual({ dry: 1, wet: 0.4 });
  });
  it('clamps mix', () => {
    expect(mixGains('add', 7).wet).toBe(1);
    expect(mixGains('add', -2).wet).toBe(0);
  });
});

describe('serialization', () => {
  it('round-trips a created effect through JSON', () => {
    const effect = createEffectState('distortion')!;
    const parsed = sanitizeEffectState(JSON.parse(JSON.stringify(effect)), { keepId: true });
    expect(parsed).toEqual(effect);
  });

  it('repairs invalid fields', () => {
    const parsed = sanitizeEffectState({ type: 'delay', amount: 9, enabled: 'yes', params: { feedback: 100 } })!;
    expect(parsed.amount).toBe(1);
    expect(parsed.enabled).toBe(true);
    expect(parsed.params.feedback).toBe(0.85);
  });

  it('rejects unknown types and garbage', () => {
    expect(sanitizeEffectState({ type: 'quantum' })).toBeNull();
    expect(sanitizeEffectState(null)).toBeNull();
    expect(sanitizeEffectState('delay')).toBeNull();
  });

  it('sanitises a chain, skipping invalid entries and preserving order', () => {
    const chain = sanitizeChain([{ type: 'gain' }, { type: 'nope' }, 7, { type: 'eq' }]);
    expect(chain.map((effect) => effect.type)).toEqual(['gain', 'eq']);
    expect(sanitizeChain('x')).toEqual([]);
  });

  it('generates fresh ids unless asked to keep them', () => {
    expect(sanitizeEffectState({ id: 'abc', type: 'gain' })!.id).not.toBe('abc');
    expect(sanitizeEffectState({ id: 'abc', type: 'gain' }, { keepId: true })!.id).toBe('abc');
  });
});
