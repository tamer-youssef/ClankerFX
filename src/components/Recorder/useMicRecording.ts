import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../../audio/AudioEngine';
import { MicCancelledError, MicRecorder, type RecordedTake } from '../../audio/MicRecorder';
import { describeMicError, type MicErrorInfo } from '../../audio/micErrors';

export type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'stopped' | 'error';

export interface MicRecording {
  phase: RecorderPhase;
  /** Seconds captured so far (while recording) or the length of the take (once stopped). */
  elapsed: number;
  /** Smoothed input peak, 0 to 1. */
  level: number;
  take: RecordedTake | null;
  error: MicErrorInfo | null;
  /** Set when the recorder stopped itself, so the UI can say why. */
  endedReason: 'limit' | 'device-lost' | null;
  start: () => void;
  stop: () => void;
  discard: () => void;
}

/** How fast the meter falls back per level update (one update is about 50 ms). */
const METER_DECAY = 0.82;

/**
 * Drives a MicRecorder for the Recorder panel. Unmounting disposes the recorder, which stops the microphone, so
 * closing the panel at any moment (even mid-recording or mid-permission-prompt) releases the mic and drops the audio.
 */
export function useMicRecording(engine: AudioEngine): MicRecording {
  const recorderRef = useRef<MicRecorder | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<RecordedTake | null>(null);
  const [error, setError] = useState<MicErrorInfo | null>(null);
  const [endedReason, setEndedReason] = useState<'limit' | 'device-lost' | null>(null);

  useEffect(
    () => () => {
      recorderRef.current?.dispose();
      recorderRef.current = null;
    },
    [],
  );

  const fail = useCallback((cause: unknown) => {
    if (cause instanceof MicCancelledError) return;
    // Technical detail goes to the console for debugging; the user only ever sees the friendly message.
    console.warn('Microphone recording failed', cause);
    setError(describeMicError(cause));
    setPhase('error');
  }, []);

  const start = useCallback(() => {
    if (recorderRef.current && recorderRef.current.getState() !== 'disposed') recorderRef.current.dispose();
    const recorder = new MicRecorder();
    recorderRef.current = recorder;
    const current = () => recorderRef.current === recorder;

    recorder.on('level', (peak) => current() && setLevel((previous) => Math.max(peak, previous * METER_DECAY)));
    recorder.on('time', (seconds) => current() && setElapsed(seconds));
    recorder.on('ended', ({ reason, take: finished }) => {
      if (!current()) return;
      setEndedReason(reason);
      setLevel(0);
      setElapsed(finished.durationSeconds);
      setTake(finished);
      setPhase('stopped');
    });

    setPhase('requesting');
    setError(null);
    setTake(null);
    setEndedReason(null);
    setElapsed(0);
    setLevel(0);

    void (async () => {
      try {
        // The context must be created (and resumed) from this click for browsers' autoplay rules.
        const context = engine.getContext();
        await recorder.start(context);
        if (current()) setPhase('recording');
      } catch (cause) {
        recorder.dispose();
        if (current()) fail(cause);
      }
    })();
  }, [engine, fail]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.getState() !== 'recording') return;
    void recorder.stop().then(
      (finished) => {
        if (recorderRef.current !== recorder) return;
        setLevel(0);
        setElapsed(finished.durationSeconds);
        setTake(finished);
        setPhase('stopped');
      },
      (cause) => {
        if (recorderRef.current === recorder) fail(cause);
      },
    );
  }, [fail]);

  const discard = useCallback(() => {
    recorderRef.current?.dispose();
    recorderRef.current = null;
    setPhase('idle');
    setElapsed(0);
    setLevel(0);
    setTake(null);
    setError(null);
    setEndedReason(null);
  }, []);

  return { phase, elapsed, level, take, error, endedReason, start, stop, discard };
}
