import { useCallback, useEffect } from 'react';
import { isWebAudioSupported } from './audio/AudioEngine';
import { DropOverlay, EmptyState } from './components/DropZone/DropZone';
import { EffectRack } from './components/EffectRack/EffectRack';
import { FileTray } from './components/FileTray/FileTray';
import { Header } from './components/Header/Header';
import { LockIcon } from './components/common/icons';
import { Notices } from './components/Notices/Notices';
import { Transport } from './components/Transport/Transport';
import { UnsupportedBrowser } from './components/UnsupportedBrowser/UnsupportedBrowser';
import { Waveform } from './components/Waveform/Waveform';
import { useAudioImport } from './hooks/useAudioImport';
import { useFileDrop } from './hooks/useFileDrop';
import { AppProvider, useApp } from './state/AppContext';
import { getActiveFile } from './state/appState';
import { formatBytes } from './utils/format';
import { createId } from './utils/id';

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function Workspace() {
  const { state, dispatch, engine } = useApp();
  const importFiles = useAudioImport();
  const dragging = useFileDrop(importFiles);
  const activeFile = getActiveFile(state);
  const activeBuffer = activeFile?.buffer ?? null;

  // Keep the engine's buffer in step with the active file. Switching files stops playback by design.
  useEffect(() => {
    engine.loadBuffer(activeBuffer);
  }, [engine, activeBuffer]);

  // Mirror the chain into the engine. Audio never waits on React: this only updates node parameters.
  useEffect(() => {
    engine.setChain(state.chain, { bypassAll: state.bypassAll, bypassedIds: new Set(state.bypassedIds) });
  }, [engine, state.chain, state.bypassAll, state.bypassedIds]);

  useEffect(
    () =>
      engine.on('effectError', ({ message }) =>
        dispatch({ type: 'notice/pushed', notice: { id: createId('notice'), kind: 'error', message } }),
      ),
    [engine, dispatch],
  );

  // Space toggles playback anywhere except while a control that uses Space has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTextEntryTarget(event.target)) return;
      event.preventDefault();
      void engine.togglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine]);

  const onNew = useCallback(() => dispatch({ type: 'files/cleared' }), [dispatch]);

  return (
    <div className="app">
      <Header onOpenFiles={(files) => void importFiles(files)} onNew={onNew} hasFiles={state.files.length > 0} />

      <main className="workspace">
        <section className="stage" aria-label="Waveform">
          {activeFile ? (
            <>
              <div className="stage__meta">
                <span className="stage__file" title={activeFile.name}>
                  {activeFile.name}
                </span>
                <span>
                  {(activeFile.buffer.sampleRate / 1000).toFixed(1)} kHz · {activeFile.buffer.numberOfChannels === 1 ? 'mono' : `${activeFile.buffer.numberOfChannels} ch`} ·{' '}
                  {formatBytes(activeFile.sizeBytes)}
                </span>
              </div>
              <Waveform key={activeFile.id} buffer={activeFile.buffer} />
            </>
          ) : (
            <EmptyState onOpenFiles={(files) => void importFiles(files)} loading={state.pendingLoads > 0} />
          )}
          <div className="stage__controls">
            <Transport />
            <button
              type="button"
              className="btn"
              aria-pressed={state.bypassAll}
              disabled={state.chain.length === 0}
              onClick={() => dispatch({ type: 'bypass/setAll', value: !state.bypassAll })}
              title="Hear the original, unprocessed voice (before/after)"
            >
              {state.bypassAll ? 'Original' : 'Bypass all'}
            </button>
          </div>
        </section>

        <FileTray />
        <EffectRack />
      </main>

      <footer className="footer">
        <LockIcon />
        <span>Audio processing happens locally on your device.</span>
      </footer>

      <Notices />
      {dragging && <DropOverlay />}
    </div>
  );
}

export default function App() {
  if (!isWebAudioSupported()) return <UnsupportedBrowser />;
  return (
    <AppProvider>
      <Workspace />
    </AppProvider>
  );
}
