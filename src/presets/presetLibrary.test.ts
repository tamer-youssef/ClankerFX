import { describe, expect, it } from 'vitest';
import { createEffectState } from '../effects/registry';
import type { EffectState } from '../types/effects';
import type { Preset } from '../types/presets';
import { builtInPresets } from './builtInPresets';
import { mutateChain } from './mutate';
import {
  chainMatchesPreset,
  chainToPresetEffects,
  createPreset,
  createVariants,
  deletePreset,
  duplicatePreset,
  parsePresets,
  presetToChain,
  renamePreset,
  serializePresets,
  uniqueName,
} from './presetLibrary';

const droid = builtInPresets[0]!;
const chainOf = (...types: string[]): EffectState[] => types.map((type) => createEffectState(type)!);
const user = (id: string, name: string): Preset => ({ id, name, builtIn: false, effects: [{ type: 'gain', enabled: true, amount: 1, params: { gainDb: 0 } }] });

describe('chain <-> preset conversion', () => {
  it('presetToChain gives fresh ids each time and skips unknown types', () => {
    const preset: Preset = { id: 'p', name: 'P', effects: [{ type: 'gain', amount: 1 }, { type: 'nonsense', amount: 1 }, { type: 'delay', amount: 0.2 }] };
    const a = presetToChain(preset);
    const b = presetToChain(preset);
    expect(a.map((e) => e.type)).toEqual(['gain', 'delay']);
    expect(a[0]!.id).not.toBe(b[0]!.id);
    expect(a[0]!.enabled).toBe(true);
  });

  it('chainToPresetEffects strips ids and writes enabled and all params explicitly', () => {
    const chain = chainOf('delay', 'gain');
    chain[1]!.enabled = false;
    const effects = chainToPresetEffects(chain);
    expect(effects[0]).toEqual({ type: 'delay', enabled: true, amount: chain[0]!.amount, params: chain[0]!.params });
    expect(effects[1]!.enabled).toBe(false);
    expect(JSON.stringify(effects)).not.toContain('"id"');
    expect(effects[0]!.params).not.toBe(chain[0]!.params);
  });

  it('round-trips and matches', () => {
    for (const preset of builtInPresets) {
      const chain = presetToChain(preset);
      expect(chainMatchesPreset(chain, preset)).toBe(true);
      const saved = createPreset('x', chain, []);
      expect(chainMatchesPreset(presetToChain(saved), saved)).toBe(true);
      expect(chainMatchesPreset(chain, saved)).toBe(true);
    }
  });

  it('treats omitted preset params as defaults', () => {
    const sparse: Preset = { id: 's', name: 'S', effects: [{ type: 'delay', amount: 0.3 }] };
    const chain = chainOf('delay');
    chain[0]!.amount = 0.3;
    expect(chainMatchesPreset(chain, sparse)).toBe(true);
  });

  it('detects differences in type, order, enabled, amount, params and length', () => {
    const chain = presetToChain(droid);
    const edit = (fn: (c: EffectState[]) => void) => {
      const copy = presetToChain(droid);
      fn(copy);
      return copy;
    };
    expect(chainMatchesPreset(chain.slice(1), droid)).toBe(false);
    expect(chainMatchesPreset([...chain, ...chainOf('gain')], droid)).toBe(false);
    expect(chainMatchesPreset(edit((c) => c.reverse()), droid)).toBe(false);
    expect(chainMatchesPreset(edit((c) => (c[0]!.enabled = false)), droid)).toBe(false);
    expect(chainMatchesPreset(edit((c) => (c[1]!.amount += 0.01)), droid)).toBe(false);
    expect(chainMatchesPreset(edit((c) => (c[1]!.amount += 1e-8)), droid)).toBe(true);
    expect(chainMatchesPreset(edit((c) => (c[2]!.params.highDb = 0)), droid)).toBe(false);
    expect(chainMatchesPreset(edit((c) => (c[1]!.type = 'gain')), droid)).toBe(false);
  });

  it('compares clamped params', () => {
    const chain = presetToChain(droid);
    chain[1]!.params.frequencyHz = 1e9;
    const preset: Preset = { ...droid, effects: droid.effects.map((e, i) => (i === 1 ? { ...e, params: { ...e.params, frequencyHz: 2000 } } : e)) };
    expect(chainMatchesPreset(chain, preset)).toBe(true);
  });
});

describe('uniqueName', () => {
  it('returns the trimmed base when free', () => {
    expect(uniqueName('  Robo ', ['Other'])).toBe('Robo');
  });
  it('appends increasing numbers, case-insensitively', () => {
    expect(uniqueName('Robo', ['robo'])).toBe('Robo 2');
    expect(uniqueName('Robo', ['Robo', 'ROBO 2'])).toBe('Robo 3');
    expect(uniqueName('Robo', [' robo ', 'Robo 2', 'Robo 3'])).toBe('Robo 4');
  });
  it('falls back to Untitled', () => {
    expect(uniqueName('   ', [])).toBe('Untitled');
    expect(uniqueName('', ['untitled'])).toBe('Untitled 2');
  });
});

describe('createPreset', () => {
  it('creates a non-built-in preset with unique name and new id', () => {
    const a = createPreset('Voice', chainOf('gain'), builtInPresets);
    const b = createPreset('Voice', chainOf('gain'), [a]);
    expect(a.builtIn).toBe(false);
    expect(a.id).not.toBe(b.id);
    expect(b.name).toBe('Voice 2');
    expect(createPreset('Heavy Mech', chainOf('gain'), builtInPresets).name).toBe('Heavy Mech 2');
  });
});

describe('rename / duplicate / delete', () => {
  const list = [...builtInPresets, user('u1', 'Mine'), user('u2', 'Yours')];

  it('renames user presets with trimming and unique names', () => {
    const renamed = renamePreset(list, 'u1', '  New  ');
    expect(renamed.find((p) => p.id === 'u1')!.name).toBe('New');
    expect(renamePreset(list, 'u1', 'yours').find((p) => p.id === 'u1')!.name).toBe('yours 2');
    expect(renamePreset(list, 'u1', 'heavy mech').find((p) => p.id === 'u1')!.name).toBe('heavy mech 2');
  });

  it('allows changing only the case of a preset own name', () => {
    expect(renamePreset(list, 'u1', 'MINE').find((p) => p.id === 'u1')!.name).toBe('MINE');
  });

  it('is a no-op for built-ins, unknown ids and blank names', () => {
    expect(renamePreset(list, droid.id, 'Hacked')).toEqual(list);
    expect(renamePreset(list, 'nope', 'X')).toEqual(list);
    expect(renamePreset(list, 'u1', '   ')).toEqual(list);
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(list));
    renamePreset(list, 'u1', 'Z');
    deletePreset(list, 'u1');
    expect(list).toEqual(copy);
  });

  it('duplicates anything, including built-ins, as an independent user preset', () => {
    const copy = duplicatePreset(droid, list);
    expect(copy.name).toBe('Security Droid copy');
    expect(copy.builtIn).toBe(false);
    expect(copy.id).not.toBe(droid.id);
    expect(copy.effects).toEqual(droid.effects);
    expect(copy.effects[0]!.params).not.toBe(droid.effects[0]!.params);
    expect(duplicatePreset(droid, [...list, copy]).name).toBe('Security Droid copy 2');
  });

  it('deletes user presets only', () => {
    expect(deletePreset(list, 'u1').map((p) => p.id)).not.toContain('u1');
    expect(deletePreset(list, droid.id)).toEqual(list);
    expect(deletePreset(list, 'nope')).toEqual(list);
  });
});

describe('createVariants', () => {
  const base = { name: 'Droid', chain: presetToChain(droid) };

  it('names, counts and clamps', () => {
    const variants = createVariants(base, 3, 'medium', [], 1);
    expect(variants.map((v) => v.name)).toEqual(['Droid Variant 01', 'Droid Variant 02', 'Droid Variant 03']);
    expect(variants.every((v) => v.builtIn === false)).toBe(true);
    expect(createVariants(base, 99, 'slight', [], 1)).toHaveLength(20);
    expect(createVariants(base, 0, 'slight', [], 1)).toHaveLength(1);
    expect(createVariants(base, -4, 'slight', [], 1)).toHaveLength(1);
    expect(createVariants(base, 2.9, 'slight', [], 1)).toHaveLength(2);
    expect(createVariants(base, Number.NaN, 'slight', [], 1)).toHaveLength(1);
  });

  it('is deterministic in content (ids aside) and varies per variant', () => {
    const a = createVariants(base, 4, 'heavy', [], 123);
    const b = createVariants(base, 4, 'heavy', [], 123);
    expect(a.map((v) => v.effects)).toEqual(b.map((v) => v.effects));
    expect(a[0]!.effects).not.toEqual(a[1]!.effects);
    expect(createVariants(base, 1, 'heavy', [], 124)[0]!.effects).not.toEqual(a[0]!.effects);
    expect(a.map((v) => v.id)).not.toEqual(b.map((v) => v.id));
  });

  it('uses seed baseSeed + i * 7919 per variant', () => {
    const [v1, v2] = createVariants(base, 2, 'medium', [], 1000);
    expect(v1!.effects).toEqual(chainToPresetEffects(mutateChain(base.chain, 'medium', 1000 + 7919)));
    expect(v2!.effects).toEqual(chainToPresetEffects(mutateChain(base.chain, 'medium', 1000 + 2 * 7919)));
  });

  it('keeps names unique against existing presets and each other, with unique ids', () => {
    const existing = [user('a', 'Droid Variant 01'), user('b', 'droid variant 02')];
    const variants = createVariants(base, 4, 'slight', existing, 5);
    const names = [...existing, ...variants].map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(variants[0]!.name).toBe('Droid Variant 01 2');
    expect(new Set(variants.map((v) => v.id)).size).toBe(4);
  });

  it('produces valid effects', () => {
    for (const v of createVariants(base, 20, 'heavy', [], 9)) expect(presetToChain(v)).toHaveLength(base.chain.length);
  });
});

describe('serialize / parse', () => {
  const presets = [user('u1', 'One'), createPreset('Two', presetToChain(droid), [])];

  it('round-trips through the envelope', () => {
    const json = serializePresets(presets);
    expect(JSON.parse(json).version).toBe(1);
    expect(parsePresets(JSON.parse(json))).toEqual(presets);
  });

  it('accepts a bare array', () => {
    expect(parsePresets(JSON.parse(JSON.stringify(presets)))).toEqual(presets);
  });

  it('forces builtIn false and regenerates missing or duplicate ids', () => {
    const effects = [{ type: 'gain', amount: 1 }];
    const parsed = parsePresets([
      { id: 'same', name: 'A', builtIn: true, effects },
      { id: 'same', name: 'B', effects },
      { name: 'C', effects },
      { id: 42, name: 'D', effects },
    ]);
    expect(parsed).toHaveLength(4);
    expect(parsed.every((p) => p.builtIn === false)).toBe(true);
    expect(parsed[0]!.id).toBe('same');
    expect(new Set(parsed.map((p) => p.id)).size).toBe(4);
  });

  it('repairs effects: clamps, defaults, drops unknown types and strips extras', () => {
    const [preset] = parsePresets([
      {
        name: '  Messy  ',
        evil: true,
        effects: [
          { type: 'delay', amount: 5, params: { timeMs: 1e12, feedback: Number.NaN, junk: 1, dampingHz: '4000' } },
          { type: 'doesNotExist', amount: 1 },
          { type: 'gain', enabled: 'yes', amount: 'loud', params: { gainDb: -1e9 } },
          null,
          'str',
        ],
      },
    ]);
    expect(preset!.name).toBe('Messy');
    expect(preset!.effects).toHaveLength(2);
    const [delay, gain] = preset!.effects;
    expect(delay!.amount).toBe(1);
    expect(delay!.params).toEqual({ timeMs: 1000, feedback: 0.35, dampingHz: 4500 });
    expect(gain).toEqual({ type: 'gain', enabled: true, amount: 1, params: { gainDb: -24 } });
    expect(preset).not.toHaveProperty('evil');
  });

  it('drops presets without a usable name or any valid effect', () => {
    const effects = [{ type: 'gain', amount: 1 }];
    expect(
      parsePresets([
        { name: '', effects },
        { name: '   ', effects },
        { name: 5, effects },
        { name: 'No effects', effects: [] },
        { name: 'All bad', effects: [{ type: 'x' }, 3] },
        { name: 'Not array', effects: {} },
        { effects },
        null,
        7,
        'x',
      ]),
    ).toEqual([]);
  });

  it('survives garbage at the top level', () => {
    for (const garbage of [undefined, null, NaN, 0, 'x', true, {}, { presets: 'x' }, { presets: null }, [[]], () => 1, Symbol('s')]) {
      expect(parsePresets(garbage)).toEqual([]);
    }
  });

  it('caps absurd name and description lengths', () => {
    const [p] = parsePresets([{ name: 'n'.repeat(10000), description: 'd'.repeat(10000), effects: [{ type: 'gain', amount: 1 }] }]);
    expect(p!.name.length).toBeLessThanOrEqual(80);
    expect(p!.description!.length).toBeLessThanOrEqual(300);
  });

  it('ignores prototype-pollution style keys', () => {
    const raw = JSON.parse(
      '{"presets":[{"name":"P","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},' +
        '"effects":[{"type":"gain","amount":1,"__proto__":{"polluted":1},"params":{"__proto__":{"polluted":1},"constructor":5,"gainDb":3}},' +
        '{"type":"__proto__","amount":1},{"type":"constructor","amount":1},{"type":"toString","amount":1}]}]}',
    );
    const parsed = parsePresets(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.effects).toEqual([{ type: 'gain', enabled: true, amount: 1, params: { gainDb: 3 } }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parsed[0]).not.toHaveProperty('polluted');
  });

  it('handles very large inputs without throwing', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ name: `P${i}`, effects: [{ type: 'gain', amount: 1 }] }));
    expect(parsePresets(many)).toHaveLength(2000);
  });
});
