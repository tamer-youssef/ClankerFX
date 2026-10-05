import { clampParams } from '../effects/BaseEffect';
import { getEffectDefinition } from '../effects/registry';
import { sanitizeEffectState } from '../effects/serialization';
import type { EffectState } from '../types/effects';
import type { MutationIntensity, Preset, PresetEffect } from '../types/presets';
import { createId } from '../utils/id';
import { mutateChain } from './mutate';

const AMOUNT_EPSILON = 1e-6;
const MAX_VARIANTS = 20;
const VARIANT_SEED_STRIDE = 7919;
const FORMAT_VERSION = 1;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 300;

/** Fresh-id effect chain for a preset. Entries with unknown effect types are skipped. */
export function presetToChain(preset: Preset): EffectState[] {
  return preset.effects.flatMap((effect) => {
    const state = sanitizeEffectState(effect);
    return state ? [state] : [];
  });
}

/** Strips ids and writes every param and the enabled flag explicitly, so a saved preset never depends on later default changes. */
export function chainToPresetEffects(chain: readonly EffectState[]): PresetEffect[] {
  return chain.map((effect) => ({ type: effect.type, enabled: effect.enabled, amount: effect.amount, params: { ...effect.params } }));
}

/** True when the chain is the preset's chain, ignoring ids (omitted preset params count as their defaults). */
export function chainMatchesPreset(chain: readonly EffectState[], preset: Preset): boolean {
  const expected = presetToChain(preset);
  if (expected.length !== chain.length) return false;
  return chain.every((effect, index) => {
    const other = expected[index]!;
    if (effect.type !== other.type || effect.enabled !== other.enabled) return false;
    if (Math.abs(effect.amount - other.amount) >= AMOUNT_EPSILON) return false;
    const definition = getEffectDefinition(effect.type);
    if (!definition) return false;
    const params = clampParams(definition.params, effect.params);
    return Object.keys(definition.params).every((key) => params[key] === other.params[key]);
  });
}

/** Case-insensitive unique name: "Name" → "Name 2" → "Name 3"… Empty input becomes "Untitled". */
export function uniqueName(base: string, taken: readonly string[]): string {
  const trimmed = base.trim() || 'Untitled';
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!used.has(trimmed.toLowerCase())) return trimmed;
  for (let n = 2; ; n += 1) {
    const candidate = `${trimmed} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

const namesOf = (presets: readonly Preset[]): string[] => presets.map((preset) => preset.name);

export function createPreset(name: string, chain: readonly EffectState[], existing: readonly Preset[]): Preset {
  return { id: createId('preset'), name: uniqueName(name, namesOf(existing)), builtIn: false, effects: chainToPresetEffects(chain) };
}

/** Renames a user preset. No-op for built-ins, unknown ids and blank names. */
export function renamePreset(presets: readonly Preset[], id: string, name: string): Preset[] {
  const target = presets.find((preset) => preset.id === id);
  const trimmed = name.trim();
  if (!target || target.builtIn || trimmed === '') return [...presets];
  if (trimmed === target.name) return [...presets];
  const others = namesOf(presets.filter((preset) => preset.id !== id));
  const next = uniqueName(trimmed, others);
  return presets.map((preset) => (preset.id === id ? { ...preset, name: next } : preset));
}

/** A user-owned copy of any preset (built-ins included). The caller appends it to its list. */
export function duplicatePreset(source: Preset, existing: readonly Preset[]): Preset {
  return {
    id: createId('preset'),
    name: uniqueName(`${source.name} copy`, namesOf(existing)),
    ...(source.description !== undefined ? { description: source.description } : {}),
    builtIn: false,
    effects: source.effects.map((effect) => ({ ...effect, ...(effect.params ? { params: { ...effect.params } } : {}) })),
  };
}

/** Removes a user preset. No-op for built-ins and unknown ids. */
export function deletePreset(presets: readonly Preset[], id: string): Preset[] {
  return presets.filter((preset) => preset.id !== id || preset.builtIn);
}

/** Deterministic mutated copies of a chain, named "<name> Variant 01", "02"… */
export function createVariants(
  base: { name: string; chain: readonly EffectState[] },
  count: number,
  intensity: MutationIntensity,
  existing: readonly Preset[],
  baseSeed: number,
): Preset[] {
  const total = Math.min(MAX_VARIANTS, Math.max(1, Math.floor(Number.isFinite(count) ? count : 1)));
  const taken = namesOf(existing);
  const variants: Preset[] = [];
  for (let i = 1; i <= total; i += 1) {
    const name = uniqueName(`${base.name} Variant ${String(i).padStart(2, '0')}`, taken);
    taken.push(name);
    const chain = mutateChain(base.chain, intensity, baseSeed + i * VARIANT_SEED_STRIDE);
    variants.push({ id: createId('preset'), name, builtIn: false, effects: chainToPresetEffects(chain) });
  }
  return variants;
}

export function serializePresets(presets: readonly Preset[]): string {
  return JSON.stringify({ version: FORMAT_VERSION, presets });
}

function parsePreset(raw: unknown, usedIds: Set<string>): Preset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim().slice(0, MAX_NAME_LENGTH).trim() : '';
  if (name === '' || !Array.isArray(record.effects)) return null;

  const effects = record.effects.flatMap((entry) => {
    const state = sanitizeEffectState(entry);
    return state ? chainToPresetEffects([state]) : [];
  });
  if (effects.length === 0) return null;

  let id = typeof record.id === 'string' && record.id !== '' ? record.id : '';
  if (id === '' || usedIds.has(id)) id = createId('preset');
  usedIds.add(id);

  const description = typeof record.description === 'string' && record.description.trim() !== '' ? record.description.slice(0, MAX_DESCRIPTION_LENGTH) : undefined;
  return { id, name, ...(description !== undefined ? { description } : {}), builtIn: false, effects };
}

/** Repairs untrusted data (envelope or bare array) into valid user presets. Never throws. */
export function parsePresets(raw: unknown): Preset[] {
  const list =
    Array.isArray(raw) ? raw : typeof raw === 'object' && raw !== null && Array.isArray((raw as { presets?: unknown }).presets) ? (raw as { presets: unknown[] }).presets : [];
  const usedIds = new Set<string>();
  return list.flatMap((entry) => {
    const preset = parsePreset(entry, usedIds);
    return preset ? [preset] : [];
  });
}
