import { describe, expect, it } from 'vitest';
import { initialHistory, MAX_HISTORY, pushHistory, shouldCoalesce, type Snapshot } from './history';

const snap = (n: number): Snapshot => ({ chain: [], presetId: String(n) });

describe('history helpers', () => {
  it('pushes snapshots, clears the future and caps the past', () => {
    let history = { ...initialHistory, future: [snap(-1)] };
    for (let i = 0; i < MAX_HISTORY + 5; i++) history = pushHistory(history, snap(i), null);
    expect(history.past).toHaveLength(MAX_HISTORY);
    expect(history.past[0]!.presetId).toBe('5');
    expect(history.future).toEqual([]);
  });

  it('coalesces only for the same key inside the window and with a timestamp', () => {
    const history = { ...initialHistory, lastEdit: { key: 'k', at: 1000 } };
    expect(shouldCoalesce(history, 'k', 1999)).toBe(true);
    expect(shouldCoalesce(history, 'k', 2000)).toBe(false);
    expect(shouldCoalesce(history, 'other', 1100)).toBe(false);
    expect(shouldCoalesce(history, 'k', undefined)).toBe(false);
    expect(shouldCoalesce(initialHistory, 'k', 1)).toBe(false);
  });
});
