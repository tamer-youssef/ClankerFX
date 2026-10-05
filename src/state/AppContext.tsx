import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { loadUserPresets } from '../presets/presetStorage';
import { appReducer, initialAppState, type AppAction, type AppState } from './appState';

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  engine: AudioEngine;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Initial state plus saved user presets. localStorage can be missing or throw (private mode); then we start empty. */
function createInitialState(): AppState {
  try {
    return { ...initialAppState, userPresets: loadUserPresets(window.localStorage) };
  } catch {
    return initialAppState;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  // One engine for the lifetime of the app; it is deliberately not React state.
  const engine = useMemo(() => new AudioEngine(), []);
  const value = useMemo(() => ({ state, dispatch, engine }), [state, dispatch, engine]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}
