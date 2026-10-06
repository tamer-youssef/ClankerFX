import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { exportProcessed } from '../../audio/exporter';
import { saveBlob } from '../../audio/saveFile';
import { useApp } from '../../state/AppContext';
import { getActiveFile } from '../../state/appState';
import type { ExportSettings } from '../../types/output';
import { processedFilename, parseSuffix } from '../../utils/filenames';
import { formatBytes } from '../../utils/format';
import { formatDb, formatLufs } from '../OutputPanel/levels';
import './ExportDialog.css';

interface ExportDialogProps {
  onClose: () => void;
}

interface Saved {
  filename: string;
  size: string;
  rate: string;
  channels: string;
  clippedSamples: number;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function formatKhz(rate: number): string {
  return `${Number((rate / 1000).toFixed(2))} kHz`;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const { state, dispatch } = useApp();
  const file = getActiveFile(state);
  const { exportSettings, measurements, measuring } = state;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suffixDraft, setSuffixDraft] = useState(exportSettings.filenameSuffix);

  const wasBusyRef = useRef(false);
  const setExport = (changes: Partial<ExportSettings>) => dispatch({ type: 'output/setExport', changes });

  const requestClose = useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);

  // Focus in on open, back to the opener on close; lock page scroll meanwhile.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('select, input') ?? dialog?.querySelector<HTMLElement>('button');
    (first ?? dialog)?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The dialog is portaled outside #root, so making the app inert hides it from assistive tech and Tab while it is open.
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => {
      document.body.style.overflow = previousOverflow;
      root?.removeAttribute('inert');
      opener?.focus();
    };
  }, []);

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (!dialog.contains(active) || active === dialog) {
        event.preventDefault();
        (event.shiftKey ? lastItem : firstItem).focus();
      } else if (event.shiftKey && active === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [requestClose]);

  const commitSuffix = () => {
    const clean = parseSuffix(suffixDraft);
    setSuffixDraft(clean);
    if (clean !== exportSettings.filenameSuffix) setExport({ filenameSuffix: clean });
    return clean;
  };

  const runExport = async () => {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSaved(null);
    setError(null);
    dialogRef.current?.focus();
    try {
      const suffix = commitSuffix();
      const result = await exportProcessed({
        file,
        chain: state.chain,
        normalization: state.normalization,
        settings: { ...exportSettings, filenameSuffix: suffix },
      });
      if ((await saveBlob(result.blob, result.filename)) === 'cancelled') return;
      setSaved({
        filename: result.filename,
        size: formatBytes(result.blob.size),
        rate: formatKhz(result.sampleRate),
        channels: result.channelCount === 1 ? 'mono' : 'stereo',
        clippedSamples: result.clippedSamples,
      });
    } catch (cause) {
      console.error('Export failed', cause);
      setError('The export did not finish. Try again, or pick a lower sample rate if the file is very long.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Rendering parks focus on the dialog (every button is disabled); once it ends, put focus back on the main action.
  useEffect(() => {
    if (busy) {
      wasBusyRef.current = true;
    } else if (wasBusyRef.current) {
      wasBusyRef.current = false;
      dialogRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus();
    }
  }, [busy]);

  // The file can disappear while the dialog is open (New): close rather than show stale options.
  useEffect(() => {
    if (!file && !busyRef.current) onClose();
  }, [file, onClose]);
  if (!file) return null;

  const previewName = processedFilename(file.name, suffixDraft);
  const originalLabel =
    file.sourceSampleRate !== null ? `Original (${formatKhz(file.sourceSampleRate)})` : 'Original (same as decoded)';
  const m = measurements;
  const overs = m !== null && !m.clipped && m.finalTruePeakDb > 0;

  return createPortal(
    <div
      className="export-backdrop"
      // Keep app-level shortcuts (Space = play, Ctrl+Z = undo) from firing behind the modal.
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div ref={dialogRef} className="export-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}>
        <div className="export-dialog__head">
          <h2 id={titleId} className="export-dialog__title">
            Export WAV
          </h2>
          <button type="button" className="btn export-dialog__close" onClick={requestClose} disabled={busy} aria-label="Close export dialog">
            Close
          </button>
        </div>

        <div className="export-dialog__body">
          <div className="export-grid">
            <label className="export-field">
              <span className="export-field__label">Bit depth</span>
              <select
                className="select"
                value={exportSettings.bitDepth}
                disabled={busy}
                onChange={(event) => setExport({ bitDepth: Number(event.target.value) === 24 ? 24 : 16 })}
              >
                <option value={16}>16-bit PCM</option>
                <option value={24}>24-bit PCM</option>
              </select>
            </label>
            <label className="export-field">
              <span className="export-field__label">Sample rate</span>
              <select
                className="select"
                value={String(exportSettings.sampleRate)}
                disabled={busy}
                onChange={(event) => {
                  const v = event.target.value;
                  setExport({ sampleRate: v === 'original' ? 'original' : (Number(v) as 44100 | 48000 | 96000) });
                }}
              >
                <option value="original">{originalLabel}</option>
                <option value="44100">44.1 kHz</option>
                <option value="48000">48 kHz</option>
                <option value="96000">96 kHz</option>
              </select>
            </label>
            <label className="export-field">
              <span className="export-field__label">Channels</span>
              <select
                className="select"
                value={exportSettings.channels}
                disabled={busy}
                onChange={(event) => setExport({ channels: event.target.value as ExportSettings['channels'] })}
              >
                <option value="auto">Auto (follows the signal)</option>
                <option value="mono">Mono</option>
                <option value="stereo">Stereo</option>
              </select>
            </label>
            <label className="export-field">
              <span className="export-field__label">Filename suffix</span>
              <input
                className="export-input"
                type="text"
                value={suffixDraft}
                disabled={busy}
                maxLength={60}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setSuffixDraft(event.target.value)}
                onBlur={commitSuffix}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitSuffix();
                  }
                }}
              />
            </label>
          </div>

          <p className="export-preview">
            <span className="export-field__label">File name</span>
            <span className="export-preview__name" title={previewName}>
              {previewName}
            </span>
          </p>

          <div className="export-levels">
            <h3 className="export-levels__title">
              Expected levels{measuring ? <span className="export-levels__measuring"> · Measuring…</span> : null}
            </h3>
            {m ? (
              <dl className="export-levels__grid">
                <div>
                  <dt>Final peak</dt>
                  <dd>{formatDb(m.finalPeakDb, { unit: 'dBFS' })}</dd>
                </div>
                <div>
                  <dt>True peak</dt>
                  <dd>{formatDb(m.finalTruePeakDb, { unit: 'dBTP' })}</dd>
                </div>
                <div>
                  <dt>Loudness</dt>
                  <dd>{formatLufs(m.finalLoudnessLufs)}</dd>
                </div>
                <div>
                  <dt>Applied gain</dt>
                  <dd>{formatDb(m.gainDb, { signed: true })}</dd>
                </div>
              </dl>
            ) : (
              <p className="export-note">{measuring ? 'Measuring…' : 'Levels are not available yet.'}</p>
            )}
            {m?.clipped && (
              <p className="export-warning export-warning--danger">
                <span aria-hidden="true">{'▲ '}</span>CLIPPING: the result exceeds 0 dBFS. Turn the limiter on or lower the target.
              </p>
            )}
            {overs && <p className="export-warning">Inter-sample overs: true peak is above 0 dBTP.</p>}
            {m?.warning && <p className="export-warning">{m.warning}</p>}
          </div>

          <p className="export-note">Everything is rendered on this device. Nothing is uploaded.</p>

          <div className="export-feedback">
            {busy && (
              <p className="export-status" role="status">
                Rendering…
              </p>
            )}
            {!busy && saved && (
              <div role="status" className="export-status export-status--ok">
                <p>
                  Saved {saved.filename} ({saved.size}, {saved.rate}, {saved.channels})
                </p>
                {saved.clippedSamples > 0 && (
                  <p className="export-warning">
                    {saved.clippedSamples.toLocaleString()} samples clipped while writing. Enable the limiter to avoid distortion.
                  </p>
                )}
              </div>
            )}
            {error && (
              <p className="export-status export-status--error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="export-dialog__foot">
          <button type="button" className="btn" onClick={requestClose} disabled={busy}>
            {saved ? 'Done' : 'Cancel'}
          </button>
          <button type="button" className="btn btn--primary" data-primary onClick={() => void runExport()} disabled={busy}>
            {busy ? 'Rendering…' : error ? 'Retry export' : 'Export WAV'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
