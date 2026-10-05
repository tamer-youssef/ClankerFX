import { describe, expect, it } from 'vitest';
import { builtInPresets } from './builtInPresets';
import { createPreset } from './presetLibrary';
import { USER_PRESETS_CORRUPT_KEY, USER_PRESETS_KEY, loadUserPresets, saveUserPresets } from './presetStorage';
import { presetToChain } from './presetLibrary';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const sample = () => createPreset('Mine', presetToChain(builtInPresets[0]!), []);

describe('presetStorage', () => {
  it('uses the documented keys', () => {
    expect(USER_PRESETS_KEY).toBe('mechvox.userPresets.v1');
    expect(USER_PRESETS_CORRUPT_KEY).toBe('mechvox.userPresets.v1.corrupt');
  });

  it('returns [] when nothing is saved', () => {
    expect(loadUserPresets(fakeStorage())).toEqual([]);
  });

  it('round-trips presets', () => {
    const storage = fakeStorage();
    const preset = sample();
    expect(saveUserPresets(storage, [preset])).toBe(true);
    const loaded = loadUserPresets(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ id: preset.id, name: 'Mine', builtIn: false, effects: preset.effects });
  });

  it('never persists built-in presets', () => {
    const storage = fakeStorage();
    saveUserPresets(storage, [...builtInPresets, sample()]);
    expect(loadUserPresets(storage)).toHaveLength(1);
  });

  it('backs up corrupt JSON before anything overwrites it and returns []', () => {
    const storage = fakeStorage({ [USER_PRESETS_KEY]: '{not json' });
    expect(loadUserPresets(storage)).toEqual([]);
    expect(storage.data.get(USER_PRESETS_CORRUPT_KEY)).toBe('{not json');
    expect(storage.data.get(USER_PRESETS_KEY)).toBe('{not json');
  });

  it('survives valid JSON of the wrong shape', () => {
    for (const raw of ['null', '42', '"x"', '{}', '{"presets":5}', '[1,null,"a"]']) {
      expect(loadUserPresets(fakeStorage({ [USER_PRESETS_KEY]: raw }))).toEqual([]);
    }
  });

  it('survives getItem throwing', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(loadUserPresets(storage)).toEqual([]);
  });

  it('survives the corrupt-backup write throwing', () => {
    const storage = {
      getItem: () => '{bad',
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadUserPresets(storage)).toEqual([]);
  });

  it('reports a failed save (quota) as false', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(saveUserPresets(storage, [sample()])).toBe(false);
  });
});
