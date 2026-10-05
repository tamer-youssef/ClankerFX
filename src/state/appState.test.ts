import { describe, expect, it } from 'vitest';
import type { LoadedFile } from '../types/audio';
import { appReducer, getActiveFile, initialAppState, type AppState } from './appState';

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
