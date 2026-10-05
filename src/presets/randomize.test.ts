import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '../effects/BaseEffect';
import { createEffectState, getEffectDefinition, listEffectDefinitions } from '../effects/registry';
import { sanitizeEffectState } from '../effects/serialization';
import type { EffectState } from '../types/effects';
import { valueToPosition } from '../utils/paramScale';
import {
  AMOUNT_RANGE,
  CHAIN_SIZE,
  CHARACTER_EFFECTS,
  EFFECT_RANK,
  FALLBACK_WINDOW,
  MAX_MODULATION_EFFECTS,
  MILD_REROLL_SPREAD,
  MIN_AMOUNT,
  MODULATION_EFFECTS,
  ROBOTIC_CORE_EFFECTS,
  SPACE_PAIR_LIMIT,
  randomChain,
  rerollChain,
  type Wildness,
} from './randomize';

const WILDNESS: Wildness[] = ['mild', 'wild'];
const SEEDS = Array.from({ length: 500 }, (_, i) => i * 7919 + 11);
const types = (chain: readonly EffectState[]): string[] => chain.map((effect) => effect.type);

function fullChain(): EffectState[] {
  return listEffectDefinitions().map((definition) => createEffectState(definition.type)!);
}

/** Slider-position width of one step around a value; rounding to the step grid can move a result by up to half of it. */
function stepWidth(spec: ParamSpec, value: number): number {
  if (spec.step <= 0) return 0;
  return Math.abs(valueToPosition(spec, Math.min(spec.max, value + spec.step)) - valueToPosition(spec, Math.max(spec.min, value - spec.step)));
}

function expectInsideWindow(effect: EffectState): void {
  const definition = getEffectDefinition(effect.type)!;
  for (const [key, spec] of Object.entries(definition.params)) {
    const value = effect.params[key]!;
    expect(Number.isFinite(value), `${effect.type}.${key}`).toBe(true);
    expect(value, `${effect.type}.${key}`).toBeGreaterThanOrEqual(spec.min);
    expect(value, `${effect.type}.${key}`).toBeLessThanOrEqual(spec.max);
    if (spec.options) {
      expect(spec.options.some((option) => option.value === value), `${effect.type}.${key} option`).toBe(true);
    } else if (spec.safe) {
      expect(value, `${effect.type}.${key}`).toBeGreaterThanOrEqual(spec.safe.min);
      expect(value, `${effect.type}.${key}`).toBeLessThanOrEqual(spec.safe.max);
    } else {
      const position = valueToPosition(spec, value);
      expect(position, `${effect.type}.${key}`).toBeGreaterThanOrEqual(FALLBACK_WINDOW.min - 1e-9);
      expect(position, `${effect.type}.${key}`).toBeLessThanOrEqual(FALLBACK_WINDOW.max + 1e-9);
    }
  }
}

describe('randomChain', () => {
  it.each(WILDNESS)('%s: is deterministic per seed apart from fresh ids', (wildness) => {
    const strip = (chain: EffectState[]) => chain.map(({ id: _id, ...rest }) => rest);
    for (const seed of SEEDS.slice(0, 40)) expect(strip(randomChain(seed, wildness))).toEqual(strip(randomChain(seed, wildness)));
  });

  it('gives different chains for different seeds and wildness', () => {
    const strip = (chain: EffectState[]) => JSON.stringify(chain.map(({ id: _id, ...rest }) => rest));
    for (const wildness of WILDNESS) {
      const distinct = new Set(SEEDS.slice(0, 100).map((seed) => strip(randomChain(seed, wildness))));
      expect(distinct.size).toBeGreaterThanOrEqual(99);
    }
    expect(strip(randomChain(5, 'mild'))).not.toEqual(strip(randomChain(5, 'wild')));
  });

  it('uses fresh unique ids', () => {
    const ids = SEEDS.slice(0, 50).flatMap((seed) => randomChain(seed, 'wild').map((effect) => effect.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(WILDNESS)('%s: every effect state is valid and survives sanitising unchanged', (wildness) => {
    for (const seed of SEEDS) {
      for (const effect of randomChain(seed, wildness)) {
        const sanitized = sanitizeEffectState(effect, { keepId: true });
        expect(sanitized, `${effect.type}#${seed}`).toEqual(effect);
        expect(effect.enabled).toBe(true);
        expectInsideWindow(effect);
      }
    }
  });

  it.each(WILDNESS)('%s: size stays in range and covers the whole range', (wildness) => {
    const { min, max } = CHAIN_SIZE[wildness];
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      const length = randomChain(seed, wildness).length;
      expect(length).toBeGreaterThanOrEqual(min);
      expect(length).toBeLessThanOrEqual(max);
      seen.add(length);
    }
    expect(seen.size).toBe(max - min + 1);
    expect(CHAIN_SIZE).toEqual({ mild: { min: 3, max: 4 }, wild: { min: 4, max: 6 } });
  });

  it.each(WILDNESS)('%s: unique types, no gain, character and robotic core present', (wildness) => {
    for (const seed of SEEDS) {
      const chainTypes = types(randomChain(seed, wildness));
      expect(new Set(chainTypes).size).toBe(chainTypes.length);
      expect(chainTypes).not.toContain('gain');
      expect(chainTypes.some((type) => (CHARACTER_EFFECTS as readonly string[]).includes(type)), `character #${seed}`).toBe(true);
      expect(chainTypes.some((type) => (ROBOTIC_CORE_EFFECTS as readonly string[]).includes(type)), `core #${seed}`).toBe(true);
    }
  });

  it('eventually uses every pooled effect type', () => {
    const used = new Set(SEEDS.flatMap((seed) => types(randomChain(seed, 'wild'))));
    expect(used.size).toBe(Object.keys(EFFECT_RANK).length);
  });

  it.each(WILDNESS)('%s: at most two of phaser/flanger/chorus', (wildness) => {
    for (const seed of SEEDS) {
      const count = types(randomChain(seed, wildness)).filter((type) => (MODULATION_EFFECTS as readonly string[]).includes(type)).length;
      expect(count).toBeLessThanOrEqual(MAX_MODULATION_EFFECTS);
    }
  });

  it.each(WILDNESS)('%s: reverb and delay are never both above 0.8', (wildness) => {
    let both = 0;
    for (const seed of SEEDS) {
      const chain = randomChain(seed, wildness);
      const delay = chain.find((effect) => effect.type === 'delay');
      const reverb = chain.find((effect) => effect.type === 'reverb');
      if (!delay || !reverb) continue;
      both += 1;
      expect(Math.min(delay.amount, reverb.amount) > SPACE_PAIR_LIMIT.both && Math.max(delay.amount, reverb.amount) > SPACE_PAIR_LIMIT.both).toBe(false);
    }
    expect(both).toBeGreaterThan(0);
  });

  it.each(WILDNESS)('%s: amounts stay in range and never below 0.25', (wildness) => {
    const { min, max } = AMOUNT_RANGE[wildness];
    for (const seed of SEEDS) {
      for (const effect of randomChain(seed, wildness)) {
        expect(effect.amount).toBeGreaterThanOrEqual(MIN_AMOUNT);
        expect(effect.amount).toBeGreaterThanOrEqual(Math.min(min, SPACE_PAIR_LIMIT.clampTo) - 1e-9);
        expect(effect.amount).toBeLessThanOrEqual(max);
      }
    }
  });

  it.each(WILDNESS)('%s: filter pass-band is at least 2.8x wide', (wildness) => {
    let filters = 0;
    for (const seed of SEEDS) {
      for (const effect of randomChain(seed, wildness)) {
        if (effect.type !== 'filter') continue;
        filters += 1;
        expect(effect.params.lowpassHz! / effect.params.highpassHz!).toBeGreaterThanOrEqual(2.8 - 1e-9);
      }
    }
    expect(filters).toBeGreaterThan(50);
  });

  it('mild keeps pitch before reverb/delay/noise/stereo', () => {
    const late = ['reverb', 'delay', 'noise', 'stereo'];
    for (const seed of SEEDS) {
      const chainTypes = types(randomChain(seed, 'mild'));
      const pitch = chainTypes.indexOf('pitch');
      if (pitch < 0) continue;
      chainTypes.forEach((type, index) => {
        if (late.includes(type)) expect(index, `#${seed} ${chainTypes.join(',')}`).toBeGreaterThan(pitch);
      });
    }
  });

  it('wild reorders more often than mild', () => {
    const deviations = (wildness: Wildness) =>
      SEEDS.filter((seed) => {
        const ranks = randomChain(seed, wildness).map((effect) => EFFECT_RANK[effect.type]!);
        return ranks.some((rank, index) => index > 0 && rank < ranks[index - 1]!);
      }).length;
    expect(deviations('wild')).toBeGreaterThan(deviations('mild'));
  });
});

describe('rerollChain', () => {
  const source = (): EffectState[] => randomChain(99, 'wild').map((effect, index) => ({ ...effect, enabled: index !== 1 }));

  it.each(WILDNESS)('%s: is deterministic', (wildness) => {
    const chain = fullChain();
    expect(rerollChain(chain, 42, wildness)).toEqual(rerollChain(chain, 42, wildness));
    expect(rerollChain(chain, 42, wildness)).not.toEqual(rerollChain(chain, 43, wildness));
  });

  it('returns [] for an empty chain', () => {
    expect(rerollChain([], 1, 'mild')).toEqual([]);
    expect(rerollChain([], 1, 'wild')).toEqual([]);
  });

  it.each(WILDNESS)('%s: keeps ids, types, order and enabled flags; new objects; input untouched', (wildness) => {
    const chain = source();
    const snapshot = JSON.parse(JSON.stringify(chain));
    const result = rerollChain(chain, 7, wildness);
    expect(chain).toEqual(snapshot);
    expect(result.map((effect) => effect.id)).toEqual(chain.map((effect) => effect.id));
    expect(types(result)).toEqual(types(chain));
    expect(result.map((effect) => effect.enabled)).toEqual(chain.map((effect) => effect.enabled));
    result.forEach((effect, index) => {
      expect(effect).not.toBe(chain[index]);
      expect(effect.params).not.toBe(chain[index]!.params);
    });
  });

  it.each(WILDNESS)('%s: changes at least one parameter or amount for nearly every seed and stays valid', (wildness) => {
    const chain = fullChain().filter((effect) => effect.type !== 'gain');
    let unchanged = 0;
    for (const seed of SEEDS) {
      const result = rerollChain(chain, seed, wildness);
      if (JSON.stringify(result) === JSON.stringify(chain)) unchanged += 1;
      for (const effect of result) {
        expect(sanitizeEffectState(effect, { keepId: true })).toEqual(effect);
        expect(effect.amount).toBeGreaterThanOrEqual(MIN_AMOUNT);
        expectInsideWindow(effect);
      }
    }
    expect(unchanged).toBe(0);
  });

  it('applies the reverb + delay limit and the filter pass-band rule', () => {
    const chain = ['delay', 'reverb', 'filter'].map((type) => createEffectState(type)!);
    chain[2] = { ...chain[2]!, params: { ...chain[2]!.params, highpassHz: 1200, lowpassHz: 1500 } };
    let clamped = 0;
    for (const seed of SEEDS) {
      const [delay, reverb, filter] = rerollChain(chain, seed, 'wild');
      if (delay!.amount > 0.8) expect(reverb!.amount).toBeLessThanOrEqual(SPACE_PAIR_LIMIT.both);
      if (reverb!.amount === SPACE_PAIR_LIMIT.clampTo) clamped += 1;
      expect(filter!.params.lowpassHz! / filter!.params.highpassHz!).toBeGreaterThanOrEqual(2.8 - 1e-9);
    }
    expect(clamped).toBeGreaterThan(0);
  });

  it('mild stays within 30 % slider position of the original', () => {
    // Defaults can sit outside a safe window; start from random chains, which are always inside it.
    for (const seed of SEEDS.slice(0, 150)) {
      const chain = randomChain(seed, 'wild');
      const result = rerollChain(chain, seed + 1, 'mild');
      result.forEach((effect, index) => {
        const original = chain[index]!;
        for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
          if (spec.options) continue;
          // The filter rule may pull the high-pass down to repair a narrow pass-band.
          if (effect.type === 'filter' && key === 'highpassHz') continue;
          const moved = Math.abs(valueToPosition(spec, effect.params[key]!) - valueToPosition(spec, original.params[key]!));
          expect(moved, `${effect.type}.${key}`).toBeLessThanOrEqual(MILD_REROLL_SPREAD + stepWidth(spec, effect.params[key]!) / 2 + 1e-9);
        }
      });
    }
  });

  it('wild re-rolls move parameters further than mild ones on average', () => {
    const chain = randomChain(3, 'wild');
    const travel = (wildness: Wildness) => {
      let total = 0;
      for (const seed of SEEDS.slice(0, 100)) {
        rerollChain(chain, seed, wildness).forEach((effect, index) => {
          for (const [key, spec] of Object.entries(getEffectDefinition(effect.type)!.params)) {
            if (!spec.options) total += Math.abs(valueToPosition(spec, effect.params[key]!) - valueToPosition(spec, chain[index]!.params[key]!));
          }
        });
      }
      return total;
    };
    expect(travel('wild')).toBeGreaterThan(travel('mild'));
  });
});
