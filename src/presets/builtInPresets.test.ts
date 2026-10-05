import { describe, expect, it } from 'vitest';
import { getEffectDefinition } from '../effects/registry';
import { sanitizeEffectState } from '../effects/serialization';
import { builtInPresets } from './builtInPresets';
import { chainMatchesPreset, presetToChain } from './presetLibrary';

const EXPECTED_NAMES = [
  'Security Droid',
  'Heavy Mech',
  'Small Service Bot',
  'Broken Android',
  'Corrupted AI',
  'Military Radio',
  'Intercom',
  'Damaged Speaker',
  'Retro Robot',
  'Synthetic Voice',
  'Boss Machine',
];

describe('builtInPresets', () => {
  it('contains exactly the required presets', () => {
    expect(builtInPresets.map((preset) => preset.name)).toEqual(EXPECTED_NAMES);
  });

  it('has unique stable ids, descriptions and the builtIn flag', () => {
    const ids = builtInPresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of builtInPresets) {
      expect(preset.id).toMatch(/^builtin-[a-z-]+$/);
      expect(preset.builtIn).toBe(true);
      expect(preset.description?.length ?? 0).toBeGreaterThan(5);
    }
  });

  describe.each(builtInPresets.map((preset) => [preset.name, preset] as const))('%s', (_name, preset) => {
    it('has a sensible chain length', () => {
      expect(preset.effects.length).toBeGreaterThanOrEqual(3);
      expect(preset.effects.length).toBeLessThanOrEqual(8);
    });

    it('uses only known effect types with in-schema params that sanitising leaves untouched', () => {
      for (const effect of preset.effects) {
        const definition = getEffectDefinition(effect.type);
        expect(definition, effect.type).toBeDefined();
        expect(effect.amount).toBeGreaterThanOrEqual(0);
        expect(effect.amount).toBeLessThanOrEqual(1);
        const params = effect.params ?? {};
        for (const [key, value] of Object.entries(params)) {
          const spec = definition!.params[key];
          expect(spec, `${effect.type}.${key} exists`).toBeDefined();
          expect(value, `${effect.type}.${key} min`).toBeGreaterThanOrEqual(spec!.min);
          expect(value, `${effect.type}.${key} max`).toBeLessThanOrEqual(spec!.max);
          if (spec!.options) expect(spec!.options.some((option) => option.value === value), `${effect.type}.${key} option`).toBe(true);
        }
        const sanitized = sanitizeEffectState(effect)!;
        expect(sanitized.amount).toBe(effect.amount);
        for (const [key, value] of Object.entries(params)) expect(sanitized.params[key], `${effect.type}.${key}`).toBe(value);
      }
    });

    it('lists every param of every effect explicitly', () => {
      for (const effect of preset.effects) {
        const keys = Object.keys(getEffectDefinition(effect.type)!.params);
        expect(Object.keys(effect.params ?? {}).sort(), effect.type).toEqual(keys.sort());
      }
    });

    it('converts to a chain that matches itself', () => {
      const chain = presetToChain(preset);
      expect(chain).toHaveLength(preset.effects.length);
      expect(chainMatchesPreset(chain, preset)).toBe(true);
    });
  });
});
