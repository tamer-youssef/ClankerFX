import type { LoadedFile, Notice } from '../types/audio';

export interface AppState {
  files: LoadedFile[];
  activeFileId: string | null;
  notices: Notice[];
  /** Number of files currently being read/decoded. */
  pendingLoads: number;
}

export type AppAction =
  | { type: 'files/added'; files: LoadedFile[] }
  | { type: 'files/activated'; id: string }
  | { type: 'files/removed'; id: string }
  | { type: 'files/cleared' }
  | { type: 'loads/started'; count: number }
  | { type: 'loads/finished'; count: number }
  | { type: 'notice/pushed'; notice: Notice }
  | { type: 'notice/dismissed'; id: string };

export const initialAppState: AppState = {
  files: [],
  activeFileId: null,
  notices: [],
  pendingLoads: 0,
};

const MAX_NOTICES = 4;

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'files/added': {
      if (action.files.length === 0) return state;
      const [first] = action.files;
      return {
        ...state,
        files: [...state.files, ...action.files],
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
      return { ...state, files, activeFileId };
    }
    case 'files/cleared':
      return { ...state, files: [], activeFileId: null };
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

export function getActiveFile(state: AppState): LoadedFile | null {
  return state.files.find((file) => file.id === state.activeFileId) ?? null;
}
