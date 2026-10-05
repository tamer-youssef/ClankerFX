import { clampParams, type ParamSpec } from '../effects/BaseEffect';
import { getEffectDefinition } from '../effects/registry';
import { createRandom } from '../dsp/random';
import type { EffectState } from '../types/effects';
import type { MutationIntensity } from '../types/presets';
import { clamp } from '../utils/math';
import { positionToValue, valueToPosition } from '../utils/paramScale';

/** Maximum move of a continuous parameter, in normalised slider-position units (so log params mutate perceptually). */
export const MUTATION_SPREAD: Record<MutationIntensity, number> = { slight: 0.08, medium: 0.2, heavy: 0.4 };

/** Probability that an option parameter (waveform, shape, band count…) jumps to a different option. */
const OPTION_SWITCH_CHANCE: Record<MutationIntensity, number> = { slight: 0, medium: 0.08, heavy: 0.25 };

const AMOUNT_FACTOR = 0.6;
const MIN_AMOUNT = 0.05;

function mutateValue(spec: ParamSpec, value: number, spread: number, random: () => number): number {
  const position = valueToPosition(spec, value) + (random() * 2 - 1) * spread;
  const mutated = positionToValue(spec, position);
  if (!spec.safe) return clamp(mutated, spec.min, spec.max);
  // Never push a parameter further out of the safe window than it started (it may already be outside it).
  const lo = Math.min(spec.safe.min, value);
  const hi = Math.max(spec.safe.max, value);
  return clamp(mutated, Math.max(lo, spec.min), Math.min(hi, spec.max));
}

function mutateOption(spec: ParamSpec, value: number, chance: number, random: () => number): number {
  const options = spec.options ?? [];
  // Always consume the same number of random draws so a chain's sequence does not depend on outcomes.
  const roll = random();
  const pick = random();
  const others = options.filter((option) => option.value !== value);
  if (roll >= chance || others.length === 0) return value;
  return others[Math.min(others.length - 1, Math.floor(pick * others.length))]!.value;
}

/** Pure, seeded variation of a chain. Keeps ids, order, types and enabled flags; returns new objects. */
export function mutateChain(chain: readonly EffectState[], intensity: MutationIntensity, seed: number): EffectState[] {
  const random = createRandom(seed);
  const spread = MUTATION_SPREAD[intensity];
  const switchChance = OPTION_SWITCH_CHANCE[intensity];

  return chain.map((effect) => {
    const definition = getEffectDefinition(effect.type);
    if (!definition) return { ...effect, params: { ...effect.params } };

    const mutatedParams: Record<string, number> = {};
    for (const [key, spec] of Object.entries(definition.params)) {
      const current = effect.params[key] ?? spec.default;
      mutatedParams[key] = spec.options ? mutateOption(spec, current, switchChance, random) : mutateValue(spec, current, spread, random);
    }

    const delta = (random() * 2 - 1) * spread * AMOUNT_FACTOR;
    const amount = effect.amount === 0 ? 0 : clamp(effect.amount + delta, MIN_AMOUNT, 1);

    return { ...effect, amount, params: clampParams(definition.params, mutatedParams) };
  });
}
