import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useApp } from '../state/AppContext';
import type { PlaybackState } from '../types/audio';

export function usePlaybackState(): PlaybackState {
  const { engine } = useApp();
  return useSyncExternalStore(
    (onChange) => engine.on('state', onChange),
    () => engine.getState(),
  );
}

export function useLoop(): boolean {
  const { engine } = useApp();
  return useSyncExternalStore(
    (onChange) => engine.on('loop', onChange),
    () => engine.getLoop(),
  );
}

export function useDuration(): number {
  const { engine } = useApp();
  return useSyncExternalStore(
    (onChange) => engine.on('buffer', onChange),
    () => engine.getDuration(),
  );
}

/**
 * Calls `onFrame(position)` every animation frame while playing, and once on every seek/state change.
 * Components use this to mutate the DOM directly, so playback never triggers React re-renders.
 */
export function usePlayhead(onFrame: (positionSeconds: number) => void): void {
  const { engine } = useApp();
  const callback = useRef(onFrame);
  callback.current = onFrame;

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      callback.current(engine.getPosition());
      if (engine.getState() === 'playing') frame = requestAnimationFrame(tick);
    };
    const kick = () => {
      cancelAnimationFrame(frame);
      tick();
    };
    kick();
    const offs = [engine.on('state', kick), engine.on('seek', kick), engine.on('buffer', kick)];
    return () => {
      cancelAnimationFrame(frame);
      offs.forEach((off) => off());
    };
  }, [engine]);
}
