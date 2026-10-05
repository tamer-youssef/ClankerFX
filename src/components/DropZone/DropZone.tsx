import { useRef } from 'react';
import './DropZone.css';

interface EmptyStateProps {
  onOpenFiles: (files: File[]) => void;
  loading: boolean;
}

/** Shown in place of the waveform until a file is loaded. */
export function EmptyState({ onOpenFiles, loading }: EmptyStateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="empty-state">
      <p className="empty-state__title">{loading ? 'Decoding audio…' : 'Drop a voice recording here'}</p>
      <p className="empty-state__sub">WAV, MP3, OGG, FLAC or M4A — one file or many. Nothing is uploaded.</p>
      <button type="button" className="btn btn--primary" onClick={() => inputRef.current?.click()} disabled={loading}>
        Choose audio files…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.opus,.flac,.m4a,.aac"
        multiple
        hidden
        onChange={(event) => {
          onOpenFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
    </div>
  );
}

/** Full-window overlay shown while a file is dragged over the page. */
export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay__box">Drop audio to load</div>
    </div>
  );
}
