import type { EffectState } from '../types/effects';
import { clamp01 } from '../utils/math';
import { createId } from '../utils/id';
import { clampParams } from './BaseEffect';
import { getEffectDefinition } from './registry';

/**
 * Validates untrusted data (a preset from localStorage, a pasted JSON file) into a safe EffectState.
 * Unknown effect types return null; everything else is repaired: params clamped, missing values defaulted.
 */
export function sanitizeEffectState(raw: unknown, options: { keepId?: boolean } = {}): EffectState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.type !== 'string') return null;
  const definition = getEffectDefinition(record.type);
  if (!definition) return null;

  const amount = typeof record.amount === 'number' && Number.isFinite(record.amount) ? clamp01(record.amount) : definition.defaultAmount;
  const params = typeof record.params === 'object' && record.params !== null ? (record.params as Record<string, unknown>) : undefined;
  const id = options.keepId && typeof record.id === 'string' && record.id.length > 0 ? record.id : createId('fx');

  return {
    id,
    type: definition.type,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    amount,
    params: clampParams(definition.params, params),
  };
}

/** Sanitises a whole chain, silently skipping entries that are not valid effects. */
export function sanitizeChain(raw: unknown): EffectState[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const effect = sanitizeEffectState(entry);
    return effect ? [effect] : [];
  });
}
