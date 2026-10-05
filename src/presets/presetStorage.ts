import type { Preset } from '../types/presets';
import { parsePresets, serializePresets } from './presetLibrary';

export const USER_PRESETS_KEY = 'mechvox.userPresets.v1';
export const USER_PRESETS_CORRUPT_KEY = 'mechvox.userPresets.v1.corrupt';

type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads saved user presets. Storage may be missing, blocked or hold garbage: this never throws. */
export function loadUserPresets(storage: PresetStorage): Preset[] {
  let raw: string | null;
  try {
    raw = storage.getItem(USER_PRESETS_KEY);
  } catch {
    return [];
  }
  if (raw === null || raw === undefined) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Keep the unreadable text so a later save cannot silently destroy it.
    try {
      storage.setItem(USER_PRESETS_CORRUPT_KEY, raw);
    } catch {
      /* nothing more we can do */
    }
    return [];
  }
  return parsePresets(parsed);
}

/** Returns false when the write failed (quota, blocked storage). */
export function saveUserPresets(storage: PresetStorage, presets: readonly Preset[]): boolean {
  try {
    storage.setItem(USER_PRESETS_KEY, serializePresets(presets.filter((preset) => !preset.builtIn)));
    return true;
  } catch {
    return false;
  }
}
