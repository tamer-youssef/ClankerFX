import { useRef } from 'react';
import { Logo } from '../common/icons';
import './Header.css';

interface HeaderProps {
  onOpenFiles: (files: File[]) => void;
  onNew: () => void;
  hasFiles: boolean;
}

const COMING_LATER = 'Available in a later build phase';

export function Header({ onOpenFiles, onNew, hasFiles }: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

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
        <button type="button" className="btn" disabled title={COMING_LATER}>
          Undo
        </button>
        <button type="button" className="btn" disabled title={COMING_LATER}>
          Redo
        </button>
        <button type="button" className="btn" disabled title={COMING_LATER}>
          Presets
        </button>
        <button type="button" className="btn btn--primary" disabled title={COMING_LATER}>
          Export WAV
        </button>
      </div>
    </header>
  );
}
