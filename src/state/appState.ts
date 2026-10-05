import type { LoadedFile, Notice } from '../types/audio';
import type { EffectState } from '../types/effects';
import { defaultExportSettings, defaultNormalization, type ExportSettings, type Measurements, type NormalizationSettings } from '../types/output';
import type { Preset } from '../types/presets';
import { chainReducer, type ChainAction } from './chainState';
import { initialHistory, pushHistory, shouldCoalesce, type HistoryState, type Snapshot } from './history';

export type { Snapshot } from './history';
export { MAX_HISTORY } from './history';

export interface AppState {
  files: LoadedFile[];
  activeFileId: string | null;
  /** Files included in batch processing. New files start selected. */
  selectedFileIds: string[];
  notices: Notice[];
  /** The effect chain applied to every file. */
  chain: EffectState[];
  /** Hear the unprocessed signal (before/after). Not saved in presets. */
  bypassAll: boolean;
  /** Effects currently auditioned as bypassed (per-effect A/B). Not saved in presets. */
  bypassedIds: string[];
  normalization: NormalizationSettings;
  exportSettings: ExportSettings;
  /** Result of the latest offline analysis of the active file through the chain; null until measured. */
  measurements: Measurements | null;
  measuring: boolean;
  /** Number of files currently being read/decoded. */
  pendingLoads: number;
  /** Id of the preset last applied or saved; null when the chain is not tied to a preset. */
  selectedPresetId: string | null;
  /** The user's saved presets (built-ins live outside the reducer). */
  userPresets: Preset[];
  /** Undo/redo of chain edits (and the preset selection that went with them). */
  history: HistoryState;
}

export type AppAction =
  | { type: 'output/setNormalization'; changes: Partial<NormalizationSettings> }
  | { type: 'output/setExport'; changes: Partial<ExportSettings> }
  | { type: 'output/measuring' }
  | { type: 'output/measured'; measurements: Measurements | null }
  | ChainAction
  | { type: 'history/undo' }
  | { type: 'history/redo' }
  | { type: 'presets/added'; presets: Preset[]; select?: string | null }
  | { type: 'presets/renamed'; id: string; name: string }
  | { type: 'presets/deleted'; id: string }
  | { type: 'presets/loaded'; presets: Preset[] }
  | { type: 'presets/selected'; id: string | null }
  | { type: 'bypass/toggleEffect'; id: string }
  | { type: 'bypass/setAll'; value: boolean }
  | { type: 'files/added'; files: LoadedFile[] }
  | { type: 'files/activated'; id: string }
  | { type: 'files/removed'; id: string }
  | { type: 'files/cleared' }
  | { type: 'batch/toggle'; id: string }
  | { type: 'batch/setSelection'; ids: string[] }
  | { type: 'loads/started'; count: number }
  | { type: 'loads/finished'; count: number }
  | { type: 'notice/pushed'; notice: Notice }
  | { type: 'notice/dismissed'; id: string };

export const initialAppState: AppState = {
  files: [],
  activeFileId: null,
  selectedFileIds: [],
  notices: [],
  chain: [],
  bypassAll: false,
  bypassedIds: [],
  normalization: defaultNormalization,
  exportSettings: defaultExportSettings,
  measurements: null,
  measuring: false,
  pendingLoads: 0,
  selectedPresetId: null,
  userPresets: [],
  history: initialHistory,
};

const MAX_NOTICES = 4;

/** Forget A/B state for effects that no longer exist. Keeps the reference when nothing changed. */
function pruneBypassed(bypassedIds: string[], chain: EffectState[]): string[] {
  const kept = bypassedIds.filter((id) => chain.some((effect) => effect.id === id));
  return kept.length === bypassedIds.length ? bypassedIds : kept;
}

/** Slider-style edits are keyed per control so only consecutive edits of the same control merge. */
function coalesceKey(action: ChainAction): string | null {
  if (action.type === 'chain/setAmount') return `setAmount:${action.id}`;
  if (action.type === 'chain/setParam') return `setParam:${action.id}:${action.key}`;
  return null;
}

function restore(state: AppState, target: Snapshot, history: HistoryState): AppState {
  return {
    ...state,
    chain: target.chain,
    selectedPresetId: target.presetId,
    bypassedIds: pruneBypassed(state.bypassedIds, target.chain),
    history,
  };
}

export function canUndo(state: AppState): boolean {
  return state.history.past.length > 0;
}

export function canRedo(state: AppState): boolean {
  return state.history.future.length > 0;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'output/setNormalization':
      return { ...state, normalization: { ...state.normalization, ...action.changes } };
    case 'output/setExport':
      return { ...state, exportSettings: { ...state.exportSettings, ...action.changes } };
    case 'output/measuring':
      return { ...state, measuring: true };
    case 'output/measured':
      return { ...state, measuring: false, measurements: action.measurements };
    case 'chain/add':
    case 'chain/remove':
    case 'chain/move':
    case 'chain/setAmount':
    case 'chain/setEnabled':
    case 'chain/setParam':
    case 'chain/replace': {
      const chain = chainReducer(state.chain, action);
      const selectedPresetId =
        action.type === 'chain/replace' && action.presetId !== undefined ? action.presetId : state.selectedPresetId;
      if (chain === state.chain) {
        // No chain change means no undo step; a replace may still re-tag the selected preset.
        return selectedPresetId === state.selectedPresetId ? state : { ...state, selectedPresetId };
      }
      const key = coalesceKey(action);
      const at = action.type === 'chain/setAmount' || action.type === 'chain/setParam' ? action.at : undefined;
      let history: HistoryState;
      if (key !== null && at !== undefined && shouldCoalesce(state.history, key, at)) {
        history = { ...state.history, lastEdit: { key, at } };
      } else {
        const before: Snapshot = { chain: state.chain, presetId: state.selectedPresetId };
        history = pushHistory(state.history, before, key !== null && at !== undefined ? { key, at } : null);
      }
      return { ...state, chain, selectedPresetId, history, bypassedIds: pruneBypassed(state.bypassedIds, chain) };
    }
    case 'history/undo': {
      const { past, future } = state.history;
      const target = past.at(-1);
      if (!target) return state;
      const current: Snapshot = { chain: state.chain, presetId: state.selectedPresetId };
      return restore(state, target, { past: past.slice(0, -1), future: [...future, current], lastEdit: null });
    }
    case 'history/redo': {
      const { past, future } = state.history;
      const target = future.at(-1);
      if (!target) return state;
      const current: Snapshot = { chain: state.chain, presetId: state.selectedPresetId };
      return restore(state, target, { past: [...past, current], future: future.slice(0, -1), lastEdit: null });
    }
    case 'presets/added': {
      const selectedPresetId = action.select === undefined ? state.selectedPresetId : action.select;
      if (action.presets.length === 0 && selectedPresetId === state.selectedPresetId) return state;
      return { ...state, userPresets: [...state.userPresets, ...action.presets], selectedPresetId };
    }
    case 'presets/renamed': {
      const name = action.name.trim();
      if (name === '') return state;
      const index = state.userPresets.findIndex((preset) => preset.id === action.id && !preset.builtIn);
      if (index < 0 || state.userPresets[index]!.name === name) return state;
      const userPresets = state.userPresets.slice();
      userPresets[index] = { ...userPresets[index]!, name };
      return { ...state, userPresets };
    }
    case 'presets/deleted': {
      if (!state.userPresets.some((preset) => preset.id === action.id && !preset.builtIn)) return state;
      return {
        ...state,
        userPresets: state.userPresets.filter((preset) => preset.id !== action.id),
        selectedPresetId: state.selectedPresetId === action.id ? null : state.selectedPresetId,
      };
    }
    case 'presets/loaded':
      return { ...state, userPresets: action.presets };
    case 'presets/selected':
      return action.id === state.selectedPresetId ? state : { ...state, selectedPresetId: action.id };
    case 'bypass/toggleEffect':
      return {
        ...state,
        bypassedIds: state.bypassedIds.includes(action.id)
          ? state.bypassedIds.filter((id) => id !== action.id)
          : [...state.bypassedIds, action.id],
      };
    case 'bypass/setAll':
      return { ...state, bypassAll: action.value };
    case 'files/added': {
      if (action.files.length === 0) return state;
      const [first] = action.files;
      return {
        ...state,
        files: [...state.files, ...action.files],
        selectedFileIds: [...state.selectedFileIds, ...action.files.map((file) => file.id)],
        // Newly added files take focus only if nothing was active; otherwise the user keeps their place.
        activeFileId: state.activeFileId ?? first?.id ?? null,
      };
    }
    case 'files/activated':
      return state.files.some((file) => file.id === action.id) ? { ...state, activeFileId: action.id } : state;
    case 'files/removed': {
      const index = state.files.findIndex((file) => file.id === action.id);
      if (index < 0) return state;
      const files = state.files.filter((file) => file.id !== action.id);
      let activeFileId = state.activeFileId;
      if (activeFileId === action.id) {
        activeFileId = (files[index] ?? files[index - 1])?.id ?? null;
      }
      return { ...state, files, activeFileId, selectedFileIds: state.selectedFileIds.filter((id) => id !== action.id) };
    }
    case 'files/cleared':
      return { ...state, files: [], activeFileId: null, selectedFileIds: [] };
    case 'batch/toggle': {
      if (!state.files.some((file) => file.id === action.id)) return state;
      const selected = state.selectedFileIds.includes(action.id);
      return { ...state, selectedFileIds: selected ? state.selectedFileIds.filter((id) => id !== action.id) : [...state.selectedFileIds, action.id] };
    }
    case 'batch/setSelection': {
      // Keep file order and drop unknown ids so the selection can never reference a missing file.
      const wanted = new Set(action.ids);
      return { ...state, selectedFileIds: state.files.filter((file) => wanted.has(file.id)).map((file) => file.id) };
    }
    case 'loads/started':
      return { ...state, pendingLoads: state.pendingLoads + action.count };
    case 'loads/finished':
      return { ...state, pendingLoads: Math.max(0, state.pendingLoads - action.count) };
    case 'notice/pushed':
      return { ...state, notices: [...state.notices, action.notice].slice(-MAX_NOTICES) };
    case 'notice/dismissed':
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) };
  }
}

/** The selected files in list order. */
export function getSelectedFiles(state: AppState): LoadedFile[] {
  const selected = new Set(state.selectedFileIds);
  return state.files.filter((file) => selected.has(file.id));
}

export function getActiveFile(state: AppState): LoadedFile | null {
  return state.files.find((file) => file.id === state.activeFileId) ?? null;
}
