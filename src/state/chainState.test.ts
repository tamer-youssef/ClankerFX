import { describe, expect, it } from 'vitest';
import { createEffectState } from '../effects/registry';
import type { EffectState } from '../types/effects';
import { appReducer, initialAppState } from './appState';
import { chainReducer } from './chainState';

const make = (type: string): EffectState => createEffectState(type)!;

describe('chainReducer', () => {
  it('adds and removes effects', () => {
    const a = make('gain');
    const b = make('delay');
    let chain = chainReducer([], { type: 'chain/add', effect: a });
    chain = chainReducer(chain, { type: 'chain/add', effect: b });
    expect(chain.map((e) => e.id)).toEqual([a.id, b.id]);
    chain = chainReducer(chain, { type: 'chain/remove', id: a.id });
    expect(chain.map((e) => e.id)).toEqual([b.id]);
  });

  it('reorders by index', () => {
    const [a, b, c] = [make('gain'), make('eq'), make('delay')] as [EffectState, EffectState, EffectState];
    const moved = chainReducer([a, b, c], { type: 'chain/move', fromIndex: 0, toIndex: 2 });
    expect(moved.map((e) => e.id)).toEqual([b.id, c.id, a.id]);
    const back = chainReducer(moved, { type: 'chain/move', fromIndex: 2, toIndex: 0 });
    expect(back.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
  });

  it('ignores no-op and invalid moves', () => {
    const chain = [make('gain'), make('eq')];
    expect(chainReducer(chain, { type: 'chain/move', fromIndex: 1, toIndex: 1 })).toBe(chain);
    expect(chainReducer(chain, { type: 'chain/move', fromIndex: 9, toIndex: 0 })).toBe(chain);
    expect(chainReducer(chain, { type: 'chain/move', fromIndex: 0, toIndex: 99 }).map((e) => e.id)).toEqual([chain[1]!.id, chain[0]!.id]);
  });

  it('clamps amount and parameters', () => {
    const delay = make('delay');
    let chain = chainReducer([delay], { type: 'chain/setAmount', id: delay.id, amount: 4 });
    expect(chain[0]!.amount).toBe(1);
    chain = chainReducer(chain, { type: 'chain/setParam', id: delay.id, key: 'feedback', value: 3 });
    expect(chain[0]!.params.feedback).toBe(0.85);
  });

  it('ignores unknown parameter keys and unknown ids', () => {
    const delay = make('delay');
    const chain = [delay];
    expect(chainReducer(chain, { type: 'chain/setParam', id: delay.id, key: 'bogus', value: 1 })).toBe(chain);
    expect(chainReducer(chain, { type: 'chain/setEnabled', id: 'missing', enabled: false })).toBe(chain);
  });

  it('does not mutate previous state', () => {
    const delay = make('delay');
    const before = [delay];
    chainReducer(before, { type: 'chain/setEnabled', id: delay.id, enabled: false });
    expect(before[0]!.enabled).toBe(true);
  });
});

describe('app state bypass handling', () => {
  it('toggles per-effect bypass and forgets removed effects', () => {
    const effect = make('gain');
    let state = appReducer(initialAppState, { type: 'chain/add', effect });
    state = appReducer(state, { type: 'bypass/toggleEffect', id: effect.id });
    expect(state.bypassedIds).toEqual([effect.id]);
    state = appReducer(state, { type: 'chain/remove', id: effect.id });
    expect(state.bypassedIds).toEqual([]);
  });

  it('toggles global bypass', () => {
    expect(appReducer(initialAppState, { type: 'bypass/setAll', value: true }).bypassAll).toBe(true);
  });
});
