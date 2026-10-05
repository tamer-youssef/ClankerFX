import { useCallback } from 'react';
import { AudioLoadError, loadAudioFile } from '../audio/AudioLoader';
import { useApp } from '../state/AppContext';
import type { LoadedFile } from '../types/audio';
import { createId } from '../utils/id';

/** Returns a function that decodes dropped/picked files locally and adds them to the app state. */
export function useAudioImport(): (files: File[]) => Promise<void> {
  const { engine, dispatch } = useApp();

  return useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      dispatch({ type: 'loads/started', count: files.length });

      let context: AudioContext;
      try {
        context = engine.getContext();
      } catch {
        dispatch({ type: 'loads/finished', count: files.length });
        dispatch({
          type: 'notice/pushed',
          notice: { id: createId('notice'), kind: 'error', message: 'This browser does not support Web Audio, so audio cannot be loaded.' },
        });
        return;
      }

      const loaded: LoadedFile[] = [];
      for (const file of files) {
        try {
          loaded.push(await loadAudioFile(file, context));
        } catch (error) {
          const message =
            error instanceof AudioLoadError ? error.message : `Something went wrong while loading "${file.name}".`;
          dispatch({ type: 'notice/pushed', notice: { id: createId('notice'), kind: 'error', message } });
        } finally {
          dispatch({ type: 'loads/finished', count: 1 });
        }
      }
      dispatch({ type: 'files/added', files: loaded });
    },
    [engine, dispatch],
  );
}
