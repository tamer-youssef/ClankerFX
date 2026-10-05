import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { encodeWav } from '../../audio/WavEncoder';
import { RECORDING_LIMIT_SECONDS, formatRecordingClock, peakOf, peakToMeter } from '../../audio/recordingChunks';
import { takeToLoadedFile } from '../../audio/recordingFile';
import type { RecordedTake } from '../../audio/MicRecorder';
import { useApp } from '../../state/AppContext';
import { formatTime } from '../../utils/format';
import { useDialogBehavior } from './useDialogBehavior';
import { useMicRecording, type RecorderPhase } from './useMicRecording';
import './Recorder.css';

interface RecorderProps {
  onClose: () => void;
}

/** A take quieter than this (about -66 dBFS) is treated as "the mic picked up nothing". */
const SILENT_PEAK = 0.0005;

function RecordingPreview({ take, peak }: { take: RecordedTake; peak: number }) {
  const [url, setUrl] = useState<string | null>(null);

  // A WAV Blob URL for the <audio> element only; revoked as soon as the take goes away.
  useEffect(() => {
    let objectUrl: string | null = null;
    try {
      const { bytes } = encodeWav([take.samples], take.sampleRate, { bitDepth: 16 });
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      setUrl(objectUrl);
    } catch (cause) {
      console.warn('Could not build the recording preview', cause);
      setUrl(null);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [take]);

  return (
    <div className="recorder__preview">
      {url ? <audio className="recorder__audio" controls src={url} aria-label="Preview of the recording" /> : <p className="recorder__note">Preview is not available, but the recording is ready to use.</p>}
      {peak < SILENT_PEAK && <p className="recorder__warning">No sound was picked up. Check that the right microphone is selected and not muted.</p>}
    </div>
  );
}

function statusText(phase: RecorderPhase, elapsed: number, endedReason: 'limit' | 'device-lost' | null, discarded: boolean): string {
  switch (phase) {
    case 'requesting':
      return 'Waiting for microphone permission.';
    case 'recording':
      return 'Recording started.';
    case 'stopped':
      if (endedReason === 'limit') return `Recording stopped at the ${RECORDING_LIMIT_SECONDS / 60} minute limit. Length ${formatTime(elapsed)}.`;
      if (endedReason === 'device-lost') return `The microphone was disconnected. Recording stopped. Length ${formatTime(elapsed)}.`;
      return `Recording stopped. Length ${formatTime(elapsed)}.`;
    case 'error':
      return '';
    case 'idle':
      return discarded ? 'Recording discarded.' : '';
  }
}

/**
 * Microphone recorder dialog. Everything stays on this device: audio is captured into memory, previewed from a local
 * Blob URL and, if kept, added to the file list like any opened file. Closing the dialog while recording discards the
 * take and releases the microphone.
 */
export function Recorder({ onClose }: RecorderProps) {
  const { engine, dispatch } = useApp();
  const recording = useMicRecording(engine);
  const { phase, elapsed, level, take, error, endedReason, start, stop, discard } = recording;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [discarded, setDiscarded] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);

  // Closing unmounts this component, whose hook disposes the recorder: mic released, audio dropped.
  const close = useCallback(() => onClose(), [onClose]);
  useDialogBehavior(dialogRef, close);

  // Keep focus on the primary control of each phase (the button that was focused disappears when the phase changes).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const target = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
    target.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'idle') setDiscarded(false);
  }, [phase]);

  const discardTake = () => {
    discard();
    setDiscarded(true);
  };

  const peak = useMemo(() => (take ? peakOf(take.samples) : 1), [take]);

  const useRecording = () => {
    if (!take) return;
    try {
      const file = takeToLoadedFile(engine.getContext(), take);
      dispatch({ type: 'files/added', files: [file] });
      // Newly added files only take focus when nothing was active; a fresh recording should be ready to play.
      dispatch({ type: 'files/activated', id: file.id });
      onClose();
    } catch (cause) {
      console.warn('Could not add the recording', cause);
      setUseError('The recording could not be added. Try recording again.');
    }
  };

  const recordAgain = () => {
    setUseError(null);
    start();
  };

  const meterPercent = Math.round(peakToMeter(level) * 100);
  const levelDb = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const meterText = Number.isFinite(levelDb) && levelDb > -60 ? `${Math.round(levelDb)} dBFS` : 'silent';
  const live = statusText(phase, elapsed, endedReason, discarded);
  const recordingActive = phase === 'recording';
  const empty = phase === 'stopped' && (!take || take.samples.length === 0);

  return createPortal(
    <div
      className="recorder-backdrop"
      // Keep app-level shortcuts (Space = play, Ctrl+Z = undo) from firing behind the dialog.
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div ref={dialogRef} className="recorder" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-phase={phase}>
        <div className="recorder__head">
          <h2 id={titleId} className="recorder__title">
            Record
          </h2>
          <button
            type="button"
            className="btn"
            onClick={close}
            aria-label="Close recorder"
            title={recordingActive ? 'Closing stops the recording and discards it' : undefined}
          >
            Close
          </button>
        </div>

        <div className="recorder__body">
          <div className="recorder__readout">
            <span className={`recorder__rec${recordingActive ? ' recorder__rec--on' : ''}`} aria-hidden={!recordingActive}>
              <span className="recorder__dot" />
              REC
            </span>
            <div className="recorder__clock" role="timer" aria-label="Recording time">
              {formatRecordingClock(elapsed)}
            </div>
            <span className="recorder__limit">max {formatRecordingClock(RECORDING_LIMIT_SECONDS).slice(0, 5)}</span>
          </div>

          {recordingActive && (
            <div
              className={`recorder__meter${meterPercent >= 97 ? ' recorder__meter--hot' : ''}`}
              role="meter"
              aria-label="Input level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={meterPercent}
              aria-valuetext={meterText}
            >
              <div className="recorder__meter-fill" style={{ transform: `scaleX(${meterPercent / 100})` }} />
            </div>
          )}

          {phase === 'idle' && <p className="recorder__note">Records from your microphone, unprocessed, up to {RECORDING_LIMIT_SECONDS / 60} minutes. Nothing is played back while recording.</p>}
          {phase === 'requesting' && <p className="recorder__note">Allow microphone access in your browser to start.</p>}
          {phase === 'stopped' && take && !empty && <RecordingPreview take={take} peak={peak} />}
          {phase === 'stopped' && endedReason === 'limit' && <p className="recorder__warning">Reached the {RECORDING_LIMIT_SECONDS / 60} minute limit, so recording stopped.</p>}
          {phase === 'stopped' && endedReason === 'device-lost' && <p className="recorder__warning">The microphone was disconnected, so recording stopped.</p>}
          {empty && <p className="recorder__alert" role="alert">Nothing was recorded. Check your microphone and try again.</p>}
          {phase === 'error' && error && (
            <p className="recorder__alert" role="alert">
              {error.message}
            </p>
          )}
          {useError && (
            <p className="recorder__alert" role="alert">
              {useError}
            </p>
          )}

          <p className="recorder__sr" role="status">
            {live}
          </p>
          <p className="recorder__privacy">Recorded on this device. Nothing is uploaded.</p>
        </div>

        <div className="recorder__foot">
          {phase === 'idle' && (
            <button type="button" className="btn btn--primary" data-autofocus onClick={start}>
              Start recording
            </button>
          )}
          {phase === 'requesting' && (
            <button type="button" className="btn" disabled>
              Waiting for microphone…
            </button>
          )}
          {phase === 'recording' && (
            <>
              <button type="button" className="btn" onClick={discardTake}>
                Discard
              </button>
              <button type="button" className="btn btn--primary recorder__stop" data-autofocus onClick={stop}>
                Stop
              </button>
            </>
          )}
          {phase === 'stopped' && (
            <>
              <button type="button" className="btn" onClick={discardTake}>
                Discard
              </button>
              <button type="button" className="btn" data-autofocus={empty ? '' : undefined} onClick={recordAgain}>
                Record again
              </button>
              <button type="button" className="btn btn--primary" data-autofocus={empty ? undefined : ''} disabled={empty} onClick={useRecording}>
                Use recording
              </button>
            </>
          )}
          {phase === 'error' && (
            <>
              <button type="button" className="btn" onClick={close}>
                Close
              </button>
              <button type="button" className="btn btn--primary" data-autofocus onClick={recordAgain}>
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
