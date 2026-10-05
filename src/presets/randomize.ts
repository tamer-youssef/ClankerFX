import { clampParams, type ParamSpec, type ParamValues } from '../effects/BaseEffect';
import { createEffectState, getEffectDefinition } from '../effects/registry';
import { createRandom } from '../dsp/random';
import type { EffectState } from '../types/effects';
import { clamp } from '../utils/math';
import { positionToValue, valueToPosition } from '../utils/paramScale';
import { enforceInvariants } from './mutate';

/** How far Randomize may go. Mild stays near the middle of each safe window, wild uses all of it. */
export type Wildness = 'mild' | 'wild';

/** Effects that define a voice's character. A random chain always has at least one. */
export const CHARACTER_EFFECTS = ['pitch', 'vocoder', 'ringmod', 'bitcrusher', 'flanger', 'distortion'] as const;
/** The subset that reads as "robot"; a random chain always contains at least one of these. */
export const ROBOTIC_CORE_EFFECTS = ['vocoder', 'ringmod', 'pitch', 'bitcrusher'] as const;
export const SHAPING_EFFECTS = ['filter', 'eq', 'compressor'] as const;
export const SPACE_EFFECTS = ['chorus', 'phaser', 'tremolo', 'delay', 'reverb', 'noise', 'stereo'] as const;
/** At most this many of these may appear together (three stacked modulators smear a voice into mush). */
export const MODULATION_EFFECTS = ['phaser', 'flanger', 'chorus'] as const;
export const MAX_MODULATION_EFFECTS = 2;

/** Signal-flow position of each effect type; lower runs earlier. `gain` is not part of random chains. */
export const EFFECT_RANK: Readonly<Record<string, number>> = {
  pitch: 0,
  vocoder: 1,
  ringmod: 1,
  bitcrusher: 2,
  distortion: 2,
  flanger: 3,
  chorus: 3,
  phaser: 3,
  tremolo: 3,
  eq: 4,
  filter: 4,
  compressor: 5,
  delay: 6,
  reverb: 7,
  noise: 8,
  stereo: 9,
};

/** Inclusive effect count per wildness. */
export const CHAIN_SIZE: Record<Wildness, { min: number; max: number }> = {
  mild: { min: 3, max: 4 },
  wild: { min: 4, max: 6 },
};

/** Amount range per wildness. The lower bound is never below MIN_AMOUNT so no rolled effect is inaudible. */
export const AMOUNT_RANGE: Record<Wildness, { min: number; max: number }> = {
  mild: { min: 0.45, max: 1 },
  wild: { min: 0.3, max: 1 },
};
export const MIN_AMOUNT = 0.25;

/** Random order jitter, in rank units. Mild only swaps neighbouring stages; wild may reorder freely within a few ranks. */
export const ORDER_JITTER: Record<Wildness, number> = { mild: 0.9, wild: 2.5 };

/** Window used for parameters that declare no `safe` range, as slider positions of the full range. */
export const FALLBACK_WINDOW = { min: 0.1, max: 0.9 } as const;
/** Mild sampling keeps to the middle of the window: this fraction is trimmed from each end. */
const MILD_TRIM = 0.2;
/** Mild re-roll moves a continuous parameter at most this far (slider-position units) from where it was. */
export const MILD_REROLL_SPREAD = 0.3;
/** Reverb and delay together are only allowed at full strength when one of them is held back to this. */
export const SPACE_PAIR_LIMIT = { both: 0.8, clampTo: 0.6 } as const;

type Random = () => number;
const between = (random: Random, min: number, max: number): number => min + random() * (max - min);

interface Window {
  /** Slider-position bounds. */
  lo: number;
  hi: number;
  /** Value bounds the rounded result is kept inside. */
  minValue: number;
  maxValue: number;
}

function rawValue(spec: ParamSpec, position: number): number {
  return spec.scale === 'log' && spec.min > 0 ? spec.min * Math.pow(spec.max / spec.min, position) : spec.min + position * (spec.max - spec.min);
}

function windowFor(spec: ParamSpec): Window {
  if (spec.safe) {
    return { lo: valueToPosition(spec, spec.safe.min), hi: valueToPosition(spec, spec.safe.max), minValue: spec.safe.min, maxValue: spec.safe.max };
  }
  return {
    lo: FALLBACK_WINDOW.min,
    hi: FALLBACK_WINDOW.max,
    minValue: rawValue(spec, FALLBACK_WINDOW.min),
    maxValue: rawValue(spec, FALLBACK_WINDOW.max),
  };
}

/** Continuous parameter: uniform in slider-position space (so log params are perceptually even) inside the window. */
function rollContinuous(spec: ParamSpec, random: Random, wildness: Wildness, current: number | undefined): number {
  const window = windowFor(spec);
  let lo = window.lo;
  let hi = window.hi;
  if (wildness === 'mild') {
    if (current === undefined) {
      const trim = (hi - lo) * MILD_TRIM;
      lo += trim;
      hi -= trim;
    } else {
      const position = valueToPosition(spec, current);
      const near = { lo: Math.max(lo, position - MILD_REROLL_SPREAD), hi: Math.min(hi, position + MILD_REROLL_SPREAD) };
      if (near.lo <= near.hi) {
        lo = near.lo;
        hi = near.hi;
      } else {
        // The current value sits outside the window: pull it to the nearest edge instead of staying out of range.
        lo = hi = clamp(position, lo, hi);
      }
    }
  }
  const rolled = positionToValue(spec, between(random, lo, hi));
  // Rounding to the step grid can land just outside the window; keep it inside.
  return clamp(rolled, window.minValue, window.maxValue);
}

function rollOption(spec: ParamSpec, random: Random): number {
  const options = spec.options ?? [];
  const pick = random();
  return options.length === 0 ? spec.default : options[Math.min(options.length - 1, Math.floor(pick * options.length))]!.value;
}

function rollAmount(random: Random, wildness: Wildness): number {
  const { min, max } = AMOUNT_RANGE[wildness];
  return Number(clamp(between(random, min, max), MIN_AMOUNT, 1).toFixed(2));
}

/** Rolls every parameter of `type`. `current` is only used by the mild re-roll to stay near the existing values. */
function rollParams(type: string, random: Random, wildness: Wildness, current?: ParamValues): ParamValues {
  const definition = getEffectDefinition(type);
  if (!definition) return { ...(current ?? {}) };
  const rolled: ParamValues = {};
  for (const [key, spec] of Object.entries(definition.params)) {
    rolled[key] = spec.options ? rollOption(spec, random) : rollContinuous(spec, random, wildness, current ? (current[key] ?? spec.default) : undefined);
  }
  // Compare against the defaults, which always satisfy the invariants, so a previously narrow filter is repaired too.
  enforceInvariants(type, rolled, defaultsOf(type));
  return clampParams(definition.params, rolled);
}

const defaultsCache = new Map<string, ParamValues>();
function defaultsOf(type: string): ParamValues {
  let cached = defaultsCache.get(type);
  if (!cached) {
    cached = createEffectState(type)?.params ?? {};
    defaultsCache.set(type, cached);
  }
  return cached;
}

/** Reverb and delay both near full strength turn the tail into wash; hold the later one (in chain order) back. */
function limitSpacePair(chain: EffectState[]): EffectState[] {
  const delay = chain.findIndex((effect) => effect.type === 'delay');
  const reverb = chain.findIndex((effect) => effect.type === 'reverb');
  if (delay < 0 || reverb < 0) return chain;
  if (chain[delay]!.amount <= SPACE_PAIR_LIMIT.both || chain[reverb]!.amount <= SPACE_PAIR_LIMIT.both) return chain;
  const later = Math.max(delay, reverb);
  return chain.map((effect, index) => (index === later ? { ...effect, amount: SPACE_PAIR_LIMIT.clampTo } : effect));
}

function pickWeighted<T extends string>(random: Random, items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let target = random() * total;
  for (const item of items) {
    target -= weight(item);
    if (target < 0) return item;
  }
  return items[items.length - 1]!;
}

const CORE_WEIGHT: Record<string, number> = { vocoder: 3, ringmod: 3, pitch: 2, bitcrusher: 2 };
const isCharacter = (type: string): boolean => (CHARACTER_EFFECTS as readonly string[]).includes(type);
const isShaping = (type: string): boolean => (SHAPING_EFFECTS as readonly string[]).includes(type);
const isModulation = (type: string): boolean => (MODULATION_EFFECTS as readonly string[]).includes(type);
const ALL_POOL: readonly string[] = [...CHARACTER_EFFECTS, ...SHAPING_EFFECTS, ...SPACE_EFFECTS];

/** Character effects are favoured, shaping is common, space is the seasoning. */
function poolWeight(type: string): number {
  return isCharacter(type) ? 2 : isShaping(type) ? 1.5 : 1;
}

/**
 * Pure, seeded: a fresh robot-voice chain. At most one of each effect type, at least one robotic core effect,
 * ordered by signal flow (with jitter), every parameter inside its safe window.
 */
export function randomChain(seed: number, wildness: Wildness): EffectState[] {
  const random = createRandom(seed);
  const size = CHAIN_SIZE[wildness];
  const count = size.min + Math.floor(random() * (size.max - size.min + 1));

  const types: string[] = [pickWeighted(random, ROBOTIC_CORE_EFFECTS, (type) => CORE_WEIGHT[type] ?? 1)];
  while (types.length < count) {
    const candidates = ALL_POOL.filter((type) => {
      if (types.includes(type)) return false;
      return !isModulation(type) || types.filter(isModulation).length < MAX_MODULATION_EFFECTS;
    });
    types.push(pickWeighted(random, candidates, poolWeight));
  }

  const jitter = ORDER_JITTER[wildness];
  const ordered = types
    .map((type) => ({ type, key: (EFFECT_RANK[type] ?? 0) + (random() * 2 - 1) * jitter }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.type);

  const chain = ordered.map((type) => {
    const base = createEffectState(type)!;
    const params = rollParams(type, random, wildness);
    return { ...base, amount: rollAmount(random, wildness), enabled: true, params };
  });
  return limitSpacePair(chain);
}

/**
 * Pure, seeded: keeps the chain's effects, order, ids and enabled flags but re-rolls every parameter and amount.
 * Mild stays within ±30 % of each slider's travel from where it was; wild may land anywhere in the safe window.
 */
export function rerollChain(chain: readonly EffectState[], seed: number, wildness: Wildness): EffectState[] {
  const random = createRandom(seed);
  const rolled = chain.map((effect) => {
    const amount = rollAmount(random, wildness);
    if (!getEffectDefinition(effect.type)) return { ...effect, params: { ...effect.params } };
    return { ...effect, amount, params: rollParams(effect.type, random, wildness, effect.params) };
  });
  return limitSpacePair(rolled);
}
