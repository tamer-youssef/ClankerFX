import { useRef, useState } from 'react';
import { canRedo, canUndo, getActiveFile } from '../../state/appState';
import { useApp } from '../../state/AppContext';
import { Logo } from '../common/icons';
import { ExportDialog } from '../ExportDialog/ExportDialog';
import { MutateMenu } from '../MutateMenu/MutateMenu';
import { PresetBrowser } from '../PresetBrowser/PresetBrowser';
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
  const canExport = getActiveFile(state) !== null;

  return (
    <header className="header">
      <div className="header__brand">
        <Logo />
        <span className="header__name">MechVox</span>
      </div>

      <div className="header__actions">
        <button type="button" className="btn" onClick={onNew} disabled={!hasFiles}>
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
        <span className="header__divider" aria-hidden="true" />
        <button type="button" className="btn" disabled={!canUndo(state)} title="Undo (Ctrl+Z)" onClick={() => dispatch({ type: 'history/undo' })}>
          Undo
        </button>
        <button type="button" className="btn" disabled={!canRedo(state)} title="Redo (Ctrl+Shift+Z)" onClick={() => dispatch({ type: 'history/redo' })}>
          Redo
        </button>
        <PresetBrowser />
        <MutateMenu />
        <button
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
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </header>
  );
}
