import { useRef } from 'react';
import { useDuration, useLoop, usePlayhead, usePlaybackState } from '../../hooks/useEngine';
import { useApp } from '../../state/AppContext';
import { formatTime } from '../../utils/format';
import { LoopIcon, PauseIcon, PlayIcon, StopIcon } from '../common/icons';
import './Transport.css';

export function Transport() {
  const { engine } = useApp();
  const playback = usePlaybackState();
  const loop = useLoop();
  const duration = useDuration();
  const timeRef = useRef<HTMLSpanElement>(null);
  const disabled = duration === 0;

  // Written straight to the DOM so the clock never re-renders React.
  usePlayhead((position) => {
    if (timeRef.current) timeRef.current.textContent = formatTime(position);
  });

  return (
    <div className="transport" role="group" aria-label="Transport">
      <button
        type="button"
        className="btn btn--icon btn--play"
        onClick={() => void engine.togglePlay()}
        disabled={disabled}
        aria-label={playback === 'playing' ? 'Pause' : 'Play'}
        title={playback === 'playing' ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playback === 'playing' ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        className="btn btn--icon"
        onClick={() => engine.stop()}
        disabled={disabled}
        aria-label="Stop"
        title="Stop"
      >
        <StopIcon />
      </button>
      <button
        type="button"
        className="btn btn--icon"
        onClick={() => engine.setLoop(!loop)}
        disabled={disabled}
        aria-pressed={loop}
        aria-label="Loop"
        title="Loop"
      >
        <LoopIcon />
      </button>

      {/* Deliberately not a live region: the clock ticks every frame while playing. */}
      <div className="transport__time">
        <span className="sr-only">Position </span>
        <span ref={timeRef} className="transport__current">
          {formatTime(0)}
        </span>
        <span className="transport__sep" aria-hidden="true">
          /
        </span>
        <span className="sr-only"> of </span>
        <span className="transport__duration">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
