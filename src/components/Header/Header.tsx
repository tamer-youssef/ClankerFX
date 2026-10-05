import { useCallback, useEffect, useRef, useState } from 'react';
import { canRedo, canUndo, getActiveFile } from '../../state/appState';
import { useApp } from '../../state/AppContext';
import { micUnsupportedReason } from '../../audio/micErrors';
import { Logo } from '../common/icons';
import { ExportDialog } from '../ExportDialog/ExportDialog';
import { MutateMenu } from '../MutateMenu/MutateMenu';
import { PresetBrowser } from '../PresetBrowser/PresetBrowser';
import { RandomizeMenu } from '../RandomizeMenu/RandomizeMenu';
import { Recorder } from '../Recorder/Recorder';
import './Header.css';

interface HeaderProps {
  onOpenFiles: (files: File[]) => void;
  onNew: () => void;
  hasFiles: boolean;
}

export function Header({ onOpenFiles, onNew, hasFiles }: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { state, dispatch } = useApp();
  const [exportOpen, setExportOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const recordButtonRef = useRef<HTMLButtonElement>(null);
  const recordUnavailable = micUnsupportedReason();
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const closeRecorder = useCallback(() => setRecordOpen(false), []);
  const closeExport = useCallback(() => setExportOpen(false), []);

  // Dialogs make the app inert while open, so focus goes back to the opener after they have unmounted. (Some browsers do
  // not focus a button on click, so the dialogs cannot rely on document.activeElement to find it.)
  const dialogWasOpen = useRef<'record' | 'export' | null>(null);
  useEffect(() => {
    const open = recordOpen ? 'record' : exportOpen ? 'export' : null;
    if (open === null && dialogWasOpen.current !== null) {
      (dialogWasOpen.current === 'record' ? recordButtonRef : exportButtonRef).current?.focus();
    }
    dialogWasOpen.current = open;
  }, [recordOpen, exportOpen]);
  const canExport = getActiveFile(state) !== null;

  return (
    <header className="header">
      <div className="header__brand">
        <Logo />
        <h1 className="header__name">
          MechVox<span className="sr-only"> — voice effects rack</span>
        </h1>
      </div>

      <div className="header__actions">
        <button
          type="button"
          className="btn"
          disabled={!hasFiles}
          onClick={() => {
            onNew();
            // New disables itself; move focus to the empty state's main action rather than dropping it.
            requestAnimationFrame(() => document.querySelector<HTMLElement>('.empty-state .btn')?.focus());
          }}
        >
          New
        </button>
        <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
          Open audio…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.opus,.flac,.m4a,.aac"
          multiple
          hidden
          onChange={(event) => {
            onOpenFiles(Array.from(event.target.files ?? []));
            // Reset so choosing the same file again still fires onChange.
            event.target.value = '';
          }}
        />
        <button
          ref={recordButtonRef}
          type="button"
          className="btn header__record"
          disabled={recordUnavailable !== null}
          title={recordUnavailable ? recordUnavailable.message : 'Record from your microphone (stays on this device)'}
          aria-haspopup="dialog"
          onClick={() => setRecordOpen(true)}
        >
          <span className="header__record-dot" aria-hidden="true" />
          Record
        </button>
        <span className="header__divider" aria-hidden="true" />
        <button type="button" className="btn" disabled={!canUndo(state)} title="Undo (Ctrl+Z)" onClick={() => dispatch({ type: 'history/undo' })}>
          Undo
        </button>
        <button type="button" className="btn" disabled={!canRedo(state)} title="Redo (Ctrl+Shift+Z)" onClick={() => dispatch({ type: 'history/redo' })}>
          Redo
        </button>
        <PresetBrowser />
        <MutateMenu />
        <RandomizeMenu />
        <button
          ref={exportButtonRef}
          type="button"
          className="btn btn--primary"
          disabled={!canExport}
          title={canExport ? 'Export the processed audio as a WAV file' : 'Load audio to export'}
          aria-haspopup="dialog"
          onClick={() => setExportOpen(true)}
        >
          Export WAV
        </button>
      </div>
      {recordOpen && <Recorder onClose={closeRecorder} />}
      {exportOpen && <ExportDialog onClose={closeExport} />}
    </header>
  );
}
