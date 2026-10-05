import type { EffectState } from '../types/effects';

/** What undo restores: the chain plus which preset was selected alongside it. */
export interface Snapshot {
  chain: EffectState[];
  presetId: string | null;
}

export interface HistoryState {
  past: Snapshot[];
  future: Snapshot[];
  /** The last coalescible edit (slider drags), used to merge rapid edits into one undo step. */
  lastEdit: { key: string; at: number } | null;
}

export const MAX_HISTORY = 100;
/** Edits with the same key closer together than this (ms) share one undo step. */
export const COALESCE_WINDOW_MS = 1000;

export const initialHistory: HistoryState = { past: [], future: [], lastEdit: null };

/** Records `before` as an undo step. A new edit invalidates redo. */
export function pushHistory(history: HistoryState, before: Snapshot, lastEdit: HistoryState['lastEdit']): HistoryState {
  const past = [...history.past, before];
  if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
  return { past, future: [], lastEdit };
}

/** True when this edit continues the previous one and should not add an undo step. */
export function shouldCoalesce(history: HistoryState, key: string, at: number | undefined): boolean {
  if (at === undefined || history.lastEdit === null) return false;
  return history.lastEdit.key === key && at - history.lastEdit.at < COALESCE_WINDOW_MS;
}
