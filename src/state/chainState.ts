import { clampParams } from '../effects/BaseEffect';
import { getEffectDefinition } from '../effects/registry';
import type { EffectState } from '../types/effects';
import { clamp01 } from '../utils/math';

export type ChainAction =
  | { type: 'chain/add'; effect: EffectState }
  | { type: 'chain/remove'; id: string }
  | { type: 'chain/move'; fromIndex: number; toIndex: number }
  | { type: 'chain/setAmount'; id: string; amount: number }
  | { type: 'chain/setEnabled'; id: string; enabled: boolean }
  | { type: 'chain/setParam'; id: string; key: string; value: number }
  | { type: 'chain/replace'; effects: EffectState[] };

function updateEffect(chain: EffectState[], id: string, update: (effect: EffectState) => EffectState): EffectState[] {
  const index = chain.findIndex((effect) => effect.id === id);
  if (index < 0) return chain;
  const current = chain[index]!;
  const updated = update(current);
  if (updated === current) return chain; // preserve identity so unchanged state never triggers re-renders
  const next = chain.slice();
  next[index] = updated;
  return next;
}

/** Pure reducer for the effect chain. Every change produces new objects only along the edited path. */
export function chainReducer(chain: EffectState[], action: ChainAction): EffectState[] {
  switch (action.type) {
    case 'chain/add':
      return [...chain, action.effect];
    case 'chain/remove':
      return chain.filter((effect) => effect.id !== action.id);
    case 'chain/move': {
      const { fromIndex, toIndex } = action;
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= chain.length) return chain;
      const target = Math.min(Math.max(toIndex, 0), chain.length - 1);
      const next = chain.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(target, 0, moved!);
      return next;
    }
    case 'chain/setAmount':
      return updateEffect(chain, action.id, (effect) => ({ ...effect, amount: clamp01(action.amount) }));
    case 'chain/setEnabled':
      return updateEffect(chain, action.id, (effect) => ({ ...effect, enabled: action.enabled }));
    case 'chain/setParam':
      return updateEffect(chain, action.id, (effect) => {
        const definition = getEffectDefinition(effect.type);
        if (!definition || !(action.key in definition.params)) return effect;
        // Re-clamp the whole set so a bad value can never reach the DSP.
        return { ...effect, params: clampParams(definition.params, { ...effect.params, [action.key]: action.value }) };
      });
    case 'chain/replace':
      return action.effects;
  }
}
