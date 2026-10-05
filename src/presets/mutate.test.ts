import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '../effects/BaseEffect';
import { getEffectDefinition, listEffectDefinitions, createEffectState } from '../effects/registry';
import type { EffectState } from '../types/effects';
import type { MutationIntensity } from '../types/presets';
import { valueToPosition } from '../utils/paramScale';
import { builtInPresets } from './builtInPresets';
import { MUTATION_SPREAD, mutateChain } from './mutate';
import { presetToChain } from './presetLibrary';

const INTENSITIES: MutationIntensity[] = ['slight', 'medium', 'heavy'];

function fullChain(): EffectState[] {
  return listEffectDefinitions().map((definition) => createEffectState(definition.type)!);
}

/** Slider-position width of one step around a value; rounding to the step grid can move a result by up to half of it. */
function stepWidth(spec: ParamSpec, value: number): number {
  if (spec.step <= 0) return 0;
  return Math.abs(valueToPosition(spec, Math.min(spec.max, value + spec.step)) - valueToPosition(spec, Math.max(spec.min, value - spec.step)));
}

describe('mutateChain', () => {
  it('exposes the spreads', () => {
    expect(MUTATION_SPREAD).toEqual({ slight: 0.08, medium: 0.2, heavy: 0.4 });
  });

  it('is deterministic for the same seed', () => {
    const chain = fullChain();
    for (const intensity of INTENSITIES) {
      expect(mutateChain(chain, intensity, 42)).toEqual(mutateChain(chain, intensity, 42));
    }
  });

  it('differs between seeds', () => {
    const chain = fullChain();
    expect(mutateChain(chain, 'medium', 1)).not.toEqual(mutateChain(chain, 'medium', 2));
  });

  it('keeps ids, order, types and enabled flags, and returns new objects without touching the input', () => {
    const chain = fullChain().map((effect, index) => ({ ...effect, enabled: index % 2 === 0 }));
    const snapshot = JSON.parse(JSON.stringify(chain));
    const result = mutateChain(chain, 'heavy', 7);
    expect(chain).toEqual(snapshot);
    expect(result.map((e) => e.id)).toEqual(chain.map((e) => e.id));
    expect(result.map((e) => e.type)).toEqual(chain.map((e) => e.type));
    expect(result.map((e) => e.enabled)).toEqual(chain.map((e) => e.enabled));
    result.forEach((effect, index) => {
      expect(effect).not.toBe(chain[index]);
      expect(effect.params).not.toBe(chain[index]!.params);
    });
  });

  it('keeps an empty chain empty', () => {
    expect(mutateChain([], 'heavy', 1)).toEqual([]);
  });

  it.each(INTENSITIES)('%s: continuous params move no further than the spread (plus step rounding)', (intensity) => {
    const spread = MUTATION_SPREAD[intensity];
    for (let seed = 0; seed < 40; seed += 1) {
      for (const preset of builtInPresets) {
        const chain = presetToChain(preset);
        const result = mutateChain(chain, intensity, seed);
        result.forEach((effect, i) => {
          const original = chain[i]!;
          for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
            if (spec.options) continue;
            const before = original.params[key]!;
            const after = effect.params[key]!;
            const moved = Math.abs(valueToPosition(spec, after) - valueToPosition(spec, before));
            expect(moved, `${effect.type}.${key}`).toBeLessThanOrEqual(spread + stepWidth(spec, after) / 2 + 1e-9);
          }
          expect(Math.abs(effect.amount - original.amount)).toBeLessThanOrEqual(spread * 0.6 + 1e-9);
        });
      }
    }
  });

  it('never switches option params on slight, and does so sometimes on heavy', () => {
    const chain = fullChain();
    const optionKeys = chain.flatMap((effect) =>
      Object.entries(getEffectDefinition(effect.type)!.params)
        .filter(([, spec]) => spec.options)
        .map(([key]) => [effect, key] as const),
    );
    expect(optionKeys.length).toBeGreaterThan(0);
    let heavySwitches = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const slight = mutateChain(chain, 'slight', seed);
      const heavy = mutateChain(chain, 'heavy', seed);
      for (const [effect, key] of optionKeys) {
        const index = chain.indexOf(effect);
        expect(slight[index]!.params[key]).toBe(effect.params[key]);
        if (heavy[index]!.params[key] !== effect.params[key]) heavySwitches += 1;
      }
    }
    expect(heavySwitches).toBeGreaterThan(0);
  });

  it('keeps params inside the safe window', () => {
    const chain = fullChain();
    for (const intensity of INTENSITIES) {
      for (let seed = 0; seed < 100; seed += 1) {
        for (const effect of mutateChain(chain, intensity, seed)) {
          for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
            if (!spec.safe) continue;
            const value = effect.params[key]!;
            expect(value, `${effect.type}.${key}`).toBeGreaterThanOrEqual(spec.safe.min);
            expect(value, `${effect.type}.${key}`).toBeLessThanOrEqual(spec.safe.max);
          }
        }
      }
    }
  });

  it('never pushes an out-of-safe value further out', () => {
    const chain = fullChain().map((effect) => {
      const params = { ...effect.params };
      for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
        if (spec.safe) params[key] = spec.max; // beyond the safe window for every spec that has one
      }
      return { ...effect, params };
    });
    for (const intensity of INTENSITIES) {
      for (let seed = 0; seed < 100; seed += 1) {
        mutateChain(chain, intensity, seed).forEach((effect, i) => {
          for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
            if (!spec.safe) continue;
            const start = chain[i]!.params[key]!;
            const value = effect.params[key]!;
            expect(value, `${effect.type}.${key}`).toBeLessThanOrEqual(start);
            expect(value, `${effect.type}.${key}`).toBeGreaterThanOrEqual(spec.safe.min);
          }
        });
      }
    }
    // Same for the low side.
    const low = fullChain().map((effect) => {
      const params = { ...effect.params };
      for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
        if (spec.safe) params[key] = spec.min;
      }
      return { ...effect, params };
    });
    for (let seed = 0; seed < 50; seed += 1) {
      mutateChain(low, 'heavy', seed).forEach((effect, i) => {
        for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
          if (spec.safe) expect(effect.params[key]!, `${effect.type}.${key}`).toBeGreaterThanOrEqual(low[i]!.params[key]!);
        }
      });
    }
  });

  it('keeps amount 0 at 0 and otherwise within 0.05..1', () => {
    const chain = fullChain().map((effect, i) => ({ ...effect, amount: i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 0.06 }));
    for (const intensity of INTENSITIES) {
      for (let seed = 0; seed < 50; seed += 1) {
        mutateChain(chain, intensity, seed).forEach((effect, i) => {
          if (chain[i]!.amount === 0) expect(effect.amount).toBe(0);
          else {
            expect(effect.amount).toBeGreaterThanOrEqual(0.05);
            expect(effect.amount).toBeLessThanOrEqual(1);
          }
        });
      }
    }
  });

  it('always outputs valid state for all 17 effect types (property loop)', () => {
    const chain = fullChain();
    expect(chain).toHaveLength(17);
    for (const intensity of INTENSITIES) {
      for (let seed = -5; seed < 150; seed += 1) {
        for (const effect of mutateChain(chain, intensity, seed * 104729)) {
          const definition = getEffectDefinition(effect.type)!;
          expect(Object.keys(effect.params).sort()).toEqual(Object.keys(definition.params).sort());
          for (const [key, spec] of Object.entries(definition.params)) {
            const value = effect.params[key]!;
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(spec.min);
            expect(value).toBeLessThanOrEqual(spec.max);
            if (spec.options) expect(spec.options.some((option) => option.value === value)).toBe(true);
          }
          expect(Number.isFinite(effect.amount)).toBe(true);
        }
      }
    }
  });
});
