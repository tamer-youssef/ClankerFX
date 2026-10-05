import { describe, expect, it } from 'vitest';
import { createEffectState } from '../effects/registry';
import type { LoadedFile } from '../types/audio';
import type { EffectState } from '../types/effects';
import type { Preset } from '../types/presets';
import { appReducer, canRedo, canUndo, getActiveFile, initialAppState, MAX_HISTORY, type AppAction, type AppState } from './appState';

// The reducer never touches the buffer, so a stand-in object is enough here.
const makeFile = (id: string): LoadedFile => ({ id, name: `${id}.wav`, sizeBytes: 1, buffer: {} as AudioBuffer });

const withFiles = (...ids: string[]): AppState =>
  appReducer(initialAppState, { type: 'files/added', files: ids.map(makeFile) });

describe('appReducer files', () => {
  it('activates the first file when nothing was active', () => {
    const state = withFiles('a', 'b');
    expect(state.activeFileId).toBe('a');
    expect(state.files).toHaveLength(2);
  });

  it('keeps the active file when more are added', () => {
    const state = appReducer(withFiles('a'), { type: 'files/added', files: [makeFile('b')] });
    expect(state.activeFileId).toBe('a');
  });

  it('ignores activation of unknown ids', () => {
    const state = withFiles('a');
    expect(appReducer(state, { type: 'files/activated', id: 'zzz' })).toBe(state);
  });

  it('moves focus to a neighbour when the active file is removed', () => {
    const state = withFiles('a', 'b', 'c');
    const afterFirst = appReducer(state, { type: 'files/removed', id: 'a' });
    expect(afterFirst.activeFileId).toBe('b');
    const last = appReducer({ ...state, activeFileId: 'c' }, { type: 'files/removed', id: 'c' });
    expect(last.activeFileId).toBe('b');
  });

  it('clears active file when the last one is removed', () => {
    const state = appReducer(withFiles('a'), { type: 'files/removed', id: 'a' });
    expect(state.activeFileId).toBeNull();
    expect(getActiveFile(state)).toBeNull();
  });

  it('keeps the active file when another is removed', () => {
    const state = appReducer(withFiles('a', 'b'), { type: 'files/removed', id: 'b' });
    expect(state.activeFileId).toBe('a');
  });

  it('clears everything on files/cleared but keeps notices', () => {
    const base = appReducer(withFiles('a'), {
      type: 'notice/pushed',
      notice: { id: 'n1', kind: 'info', message: 'hi' },
    });
    const state = appReducer(base, { type: 'files/cleared' });
    expect(state.files).toEqual([]);
    expect(state.activeFileId).toBeNull();
    expect(state.notices).toHaveLength(1);
  });
});

describe('appReducer notices and loads', () => {
  it('caps the number of visible notices', () => {
    let state = initialAppState;
    for (let i = 0; i < 10; i++) {
      state = appReducer(state, { type: 'notice/pushed', notice: { id: `n${i}`, kind: 'error', message: 'x' } });
    }
    expect(state.notices.length).toBeLessThanOrEqual(4);
    expect(state.notices.at(-1)?.id).toBe('n9');
  });

  it('never lets pendingLoads go negative', () => {
    const state = appReducer(initialAppState, { type: 'loads/finished', count: 3 });
    expect(state.pendingLoads).toBe(0);
  });
});

const gain = (id: string): EffectState => ({ ...createEffectState('gain')!, id });
const ids = (state: AppState): string[] => state.chain.map((e) => e.id);
const run = (state: AppState, ...actions: AppAction[]): AppState => actions.reduce(appReducer, state);
const preset = (id: string, builtIn = false): Preset => ({ id, name: id, builtIn, effects: [] });

describe('undo / redo', () => {
  it('undoes and redoes add, remove, move and enabled', () => {
    const [a, b] = [gain('a'), gain('b')] as [EffectState, EffectState];
    const s0 = initialAppState;
    const added = run(s0, { type: 'chain/add', effect: a }, { type: 'chain/add', effect: b });
    expect(canUndo(added)).toBe(true);
    expect(canRedo(added)).toBe(false);
    const undone = appReducer(added, { type: 'history/undo' });
    expect(ids(undone)).toEqual(['a']);
    expect(canRedo(undone)).toBe(true);
    expect(ids(appReducer(undone, { type: 'history/redo' }))).toEqual(['a', 'b']);

    const moved = appReducer(added, { type: 'chain/move', fromIndex: 0, toIndex: 1 });
    expect(ids(moved)).toEqual(['b', 'a']);
    expect(ids(appReducer(moved, { type: 'history/undo' }))).toEqual(['a', 'b']);

    const removed = appReducer(added, { type: 'chain/remove', id: 'a' });
    expect(ids(appReducer(removed, { type: 'history/undo' }))).toEqual(['a', 'b']);

    const off = appReducer(added, { type: 'chain/setEnabled', id: 'a', enabled: false });
    expect(off.chain[0]!.enabled).toBe(false);
    expect(appReducer(off, { type: 'history/undo' }).chain[0]!.enabled).toBe(true);
  });

  it('undoes param and amount edits', () => {
    const delay = createEffectState('delay')!;
    const base = appReducer(initialAppState, { type: 'chain/add', effect: delay });
    const original = base.chain[0]!;
    const edited = run(
      base,
      { type: 'chain/setAmount', id: delay.id, amount: 0.1 },
      { type: 'chain/setParam', id: delay.id, key: 'feedback', value: 0.2 },
    );
    const back = run(edited, { type: 'history/undo' }, { type: 'history/undo' });
    expect(back.chain[0]).toBe(original);
  });

  it('undoes replace, restoring the previous chain and selected preset', () => {
    const start = run(
      initialAppState,
      { type: 'chain/replace', effects: [gain('a')], presetId: 'p1' },
      { type: 'chain/replace', effects: [gain('b')], presetId: 'p2' },
    );
    expect(start.selectedPresetId).toBe('p2');
    const undone = appReducer(start, { type: 'history/undo' });
    expect(ids(undone)).toEqual(['a']);
    expect(undone.selectedPresetId).toBe('p1');
    const redone = appReducer(undone, { type: 'history/redo' });
    expect(ids(redone)).toEqual(['b']);
    expect(redone.selectedPresetId).toBe('p2');
  });

  it('keeps the selected preset on replace without presetId and clears it with null', () => {
    const selected = run(initialAppState, { type: 'chain/replace', effects: [gain('a')], presetId: 'p1' });
    const kept = appReducer(selected, { type: 'chain/replace', effects: [gain('b')] });
    expect(kept.selectedPresetId).toBe('p1');
    const cleared = appReducer(kept, { type: 'chain/replace', effects: [gain('c')], presetId: null });
    expect(cleared.selectedPresetId).toBeNull();
    expect(appReducer(cleared, { type: 'history/undo' }).selectedPresetId).toBe('p1');
  });

  it('restores the preset selection that an ordinary edit left behind', () => {
    const s = run(
      initialAppState,
      { type: 'chain/replace', effects: [gain('a')], presetId: 'p1' },
      { type: 'chain/add', effect: gain('b') },
      { type: 'presets/selected', id: 'other' },
      { type: 'chain/remove', id: 'b' },
    );
    expect(appReducer(s, { type: 'history/undo' }).selectedPresetId).toBe('other');
  });

  it('clears redo on a new edit', () => {
    const s = run(initialAppState, { type: 'chain/add', effect: gain('a') }, { type: 'history/undo' });
    expect(canRedo(s)).toBe(true);
    const edited = appReducer(s, { type: 'chain/add', effect: gain('b') });
    expect(canRedo(edited)).toBe(false);
    expect(appReducer(edited, { type: 'history/redo' })).toBe(edited);
  });

  it('returns the identical state when a stack is empty', () => {
    expect(appReducer(initialAppState, { type: 'history/undo' })).toBe(initialAppState);
    expect(appReducer(initialAppState, { type: 'history/redo' })).toBe(initialAppState);
    expect(canUndo(initialAppState)).toBe(false);
  });

  it('drops bypassed ids that no longer exist after undo or redo', () => {
    const s = run(
      initialAppState,
      { type: 'chain/add', effect: gain('a') },
      { type: 'chain/add', effect: gain('b') },
      { type: 'bypass/toggleEffect', id: 'b' },
    );
    expect(s.bypassedIds).toEqual(['b']);
    const undone = appReducer(s, { type: 'history/undo' });
    expect(undone.bypassedIds).toEqual([]);
    // Redo brings the effect back but not its audition state.
    expect(appReducer(undone, { type: 'history/redo' }).bypassedIds).toEqual([]);
  });

  it('does not track bypass, files or notices in history', () => {
    const s = run(
      initialAppState,
      { type: 'bypass/setAll', value: true },
      { type: 'files/added', files: [makeFile('a')] },
      { type: 'notice/pushed', notice: { id: 'n', kind: 'info', message: 'x' } },
      { type: 'files/cleared' },
    );
    expect(s.history).toBe(initialAppState.history);
  });
});

describe('history coalescing', () => {
  const base = (): { state: AppState; id: string; other: string } => {
    const delay = createEffectState('delay')!;
    const eq = createEffectState('eq')!;
    return { state: run(initialAppState, { type: 'chain/add', effect: delay }, { type: 'chain/add', effect: eq }), id: delay.id, other: eq.id };
  };

  it('merges rapid amount edits of one effect into a single step', () => {
    const { state, id } = base();
    const before = state.history.past.length;
    const s = run(
      state,
      { type: 'chain/setAmount', id, amount: 0.1, at: 1000 },
      { type: 'chain/setAmount', id, amount: 0.2, at: 1500 },
      { type: 'chain/setAmount', id, amount: 0.3, at: 2200 }, // sliding: 700ms after the previous edit
    );
    expect(s.history.past).toHaveLength(before + 1);
    expect(s.chain[0]!.amount).toBe(0.3);
    expect(s.history.lastEdit).toEqual({ key: `setAmount:${id}`, at: 2200 });
    expect(appReducer(s, { type: 'history/undo' }).chain[0]!.amount).toBe(state.chain[0]!.amount);
  });

  it('starts a new step at or beyond 1000 ms', () => {
    const { state, id } = base();
    const before = state.history.past.length;
    const s = run(
      state,
      { type: 'chain/setAmount', id, amount: 0.1, at: 1000 },
      { type: 'chain/setAmount', id, amount: 0.2, at: 1999 },
      { type: 'chain/setAmount', id, amount: 0.3, at: 2999 },
    );
    expect(s.history.past).toHaveLength(before + 2);
  });

  it('does not merge across different effects, keys or action kinds', () => {
    const { state, id, other } = base();
    const before = state.history.past.length;
    const s = run(
      state,
      { type: 'chain/setAmount', id, amount: 0.1, at: 0 },
      { type: 'chain/setAmount', id: other, amount: 0.1, at: 10 },
      { type: 'chain/setParam', id, key: 'feedback', value: 0.1, at: 20 },
      { type: 'chain/setParam', id, key: 'timeMs', value: 200, at: 30 },
      { type: 'chain/setParam', id, key: 'feedback', value: 0.3, at: 40 },
    );
    expect(s.history.past).toHaveLength(before + 5);
  });

  it('merges rapid param edits of the same key', () => {
    const { state, id } = base();
    const before = state.history.past.length;
    const s = run(
      state,
      { type: 'chain/setParam', id, key: 'feedback', value: 0.1, at: 0 },
      { type: 'chain/setParam', id, key: 'feedback', value: 0.2, at: 100 },
    );
    expect(s.history.past).toHaveLength(before + 1);
    expect(s.history.lastEdit).toEqual({ key: `setParam:${id}:feedback`, at: 100 });
  });

  it('never merges without a timestamp', () => {
    const { state, id } = base();
    const before = state.history.past.length;
    const s = run(
      state,
      { type: 'chain/setAmount', id, amount: 0.1 },
      { type: 'chain/setAmount', id, amount: 0.2 },
      { type: 'chain/setAmount', id, amount: 0.3, at: 5 },
      { type: 'chain/setAmount', id, amount: 0.4 },
    );
    expect(s.history.past).toHaveLength(before + 4);
  });

  it('resets coalescing after other chain edits and after undo', () => {
    const { state, id, other } = base();
    const before = state.history.past.length;
    const s = run(
      state,
      { type: 'chain/setAmount', id, amount: 0.1, at: 0 },
      { type: 'chain/setEnabled', id: other, enabled: false },
      { type: 'chain/setAmount', id, amount: 0.2, at: 50 },
    );
    expect(s.history.past).toHaveLength(before + 3);
    const undone = run(s, { type: 'history/undo' });
    expect(undone.history.lastEdit).toBeNull();
    const again = appReducer(undone, { type: 'chain/setAmount', id, amount: 0.9, at: 60 });
    expect(again.history.past).toHaveLength(undone.history.past.length + 1);
  });

  it('does not push history for no-op edits', () => {
    const { state, id } = base();
    const same = state.chain[0]!.amount;
    for (const action of [
      { type: 'chain/setAmount', id, amount: same, at: 1 },
      { type: 'chain/setParam', id, key: 'bogus', value: 1 },
      { type: 'chain/setEnabled', id: 'missing', enabled: false },
      { type: 'chain/move', fromIndex: 1, toIndex: 1 },
      { type: 'chain/move', fromIndex: 9, toIndex: 0 },
    ] satisfies AppAction[]) {
      expect(appReducer(state, action)).toBe(state);
    }
  });

  it('keeps a pending coalesce window across a no-op edit', () => {
    const { state, id } = base();
    const s = run(state, { type: 'chain/setAmount', id, amount: 0.1, at: 0 });
    expect(appReducer(s, { type: 'chain/setEnabled', id: 'missing', enabled: true })).toBe(s);
  });
});

describe('history cap', () => {
  it('keeps at most MAX_HISTORY undo steps, dropping the oldest', () => {
    let state = initialAppState;
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      state = appReducer(state, { type: 'chain/add', effect: gain(`e${i}`) });
    }
    expect(state.history.past).toHaveLength(MAX_HISTORY);
    // The oldest 20 steps are gone, so undoing everything stops at a chain of 20 effects.
    while (canUndo(state)) state = appReducer(state, { type: 'history/undo' });
    expect(state.chain).toHaveLength(20);
  });
});

describe('preset library state', () => {
  it('appends presets and optionally selects one', () => {
    const s = appReducer(initialAppState, { type: 'presets/added', presets: [preset('u1')] });
    expect(s.userPresets.map((p) => p.id)).toEqual(['u1']);
    expect(s.selectedPresetId).toBeNull();
    const t = appReducer(s, { type: 'presets/added', presets: [preset('u2')], select: 'u2' });
    expect(t.userPresets.map((p) => p.id)).toEqual(['u1', 'u2']);
    expect(t.selectedPresetId).toBe('u2');
    expect(appReducer(s, { type: 'presets/added', presets: [] })).toBe(s);
  });

  it('does not touch undo history', () => {
    const s = run(
      initialAppState,
      { type: 'presets/added', presets: [preset('u1')], select: 'u1' },
      { type: 'presets/renamed', id: 'u1', name: 'New' },
      { type: 'presets/selected', id: null },
      { type: 'presets/deleted', id: 'u1' },
      { type: 'presets/loaded', presets: [preset('x')] },
    );
    expect(s.history).toBe(initialAppState.history);
  });

  it('renames only user presets and ignores empty names', () => {
    const s = appReducer(initialAppState, { type: 'presets/loaded', presets: [preset('u1'), preset('b1', true)] });
    const renamed = appReducer(s, { type: 'presets/renamed', id: 'u1', name: '  Fresh  ' });
    expect(renamed.userPresets[0]!.name).toBe('Fresh');
    expect(renamed.userPresets[1]).toBe(s.userPresets[1]);
    expect(s.userPresets[0]!.name).toBe('u1'); // immutability
    expect(appReducer(s, { type: 'presets/renamed', id: 'u1', name: '   ' })).toBe(s);
    expect(appReducer(s, { type: 'presets/renamed', id: 'b1', name: 'Hacked' })).toBe(s);
    expect(appReducer(s, { type: 'presets/renamed', id: 'nope', name: 'x' })).toBe(s);
  });

  it('deletes only user presets and clears the selection if it was deleted', () => {
    const base = run(
      initialAppState,
      { type: 'presets/loaded', presets: [preset('u1'), preset('u2'), preset('b1', true)] },
      { type: 'presets/selected', id: 'u1' },
    );
    const other = appReducer(base, { type: 'presets/deleted', id: 'u2' });
    expect(other.userPresets.map((p) => p.id)).toEqual(['u1', 'b1']);
    expect(other.selectedPresetId).toBe('u1');
    const selected = appReducer(base, { type: 'presets/deleted', id: 'u1' });
    expect(selected.selectedPresetId).toBeNull();
    expect(appReducer(base, { type: 'presets/deleted', id: 'b1' })).toBe(base);
    expect(appReducer(base, { type: 'presets/deleted', id: 'nope' })).toBe(base);
  });

  it('replaces the whole list on load and selects ids', () => {
    const s = run(initialAppState, { type: 'presets/added', presets: [preset('u1')] });
    const loaded = appReducer(s, { type: 'presets/loaded', presets: [preset('a'), preset('b')] });
    expect(loaded.userPresets.map((p) => p.id)).toEqual(['a', 'b']);
    expect(appReducer(loaded, { type: 'presets/selected', id: 'a' }).selectedPresetId).toBe('a');
    expect(appReducer(loaded, { type: 'presets/selected', id: null })).toBe(loaded);
  });
});
