import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { computePeaksAsync, resamplePeaks, type PeakData } from '../../analysis/waveformPeaks';
import { usePlayhead } from '../../hooks/useEngine';
import { useApp } from '../../state/AppContext';
import { formatTime } from '../../utils/format';
import { clamp } from '../../utils/math';
import './Waveform.css';

/** Resolution of the cached envelope; wide enough to stay crisp on large 2× displays. */
const PEAK_BUCKETS = 4096;
const KEY_STEP_SECONDS = 1;
const KEY_STEP_SHIFT_SECONDS = 5;

interface WaveformProps {
  buffer: AudioBuffer;
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: PeakData): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  const style = getComputedStyle(canvas);
  context.clearRect(0, 0, width, height);

  const mid = height / 2;
  context.fillStyle = style.getPropertyValue('--wave-axis').trim();
  context.fillRect(0, Math.floor(mid), width, 1);

  const columns = resamplePeaks(peaks, width);
  const amplitude = mid * 0.92;
  context.fillStyle = style.getPropertyValue('--wave-fill').trim();
  for (let x = 0; x < width; x++) {
    const top = mid - (columns.max[x] as number) * amplitude;
    const bottom = mid - (columns.min[x] as number) * amplitude;
    // Always at least one device pixel tall so silence still reads as a line.
    context.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}

export function Waveform({ buffer }: WaveformProps) {
  const { engine } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [analysing, setAnalysing] = useState(true);
  const dragging = useRef(false);

  // Peak extraction is chunked and cancellable so large files never freeze the UI.
  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    setAnalysing(true);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    void computePeaksAsync(channels, PEAK_BUCKETS, () => cancelled).then((result) => {
      if (cancelled || !result) return;
      setPeaks(result);
      setAnalysing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!canvas || !surface || !peaks) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(surface.clientWidth * ratio));
    const height = Math.max(1, Math.round(surface.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    drawWaveform(canvas, peaks);
  }, [peaks]);

  useEffect(() => {
    redraw();
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [redraw]);

  usePlayhead((position) => {
    const fraction = buffer.duration > 0 ? clamp(position / buffer.duration, 0, 1) : 0;
    if (playheadRef.current) playheadRef.current.style.left = `${fraction * 100}%`;
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${fraction})`;
    const surface = surfaceRef.current;
    if (surface && engine.getState() !== 'playing') {
      // Updating the slider value every frame would make screen readers chatter, so only do it at rest.
      surface.setAttribute('aria-valuenow', position.toFixed(2));
      surface.setAttribute('aria-valuetext', `${formatTime(position)} of ${formatTime(buffer.duration)}`);
    }
  });

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    engine.seek(fraction * buffer.duration);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_SHIFT_SECONDS : KEY_STEP_SECONDS;
    switch (event.key) {
      case 'ArrowLeft':
        engine.seek(engine.getPosition() - step);
        break;
      case 'ArrowRight':
        engine.seek(engine.getPosition() + step);
        break;
      case 'Home':
        engine.seek(0);
        break;
      case 'End':
        engine.seek(buffer.duration);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div
      ref={surfaceRef}
      className="waveform"
      role="slider"
      tabIndex={0}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={Number(buffer.duration.toFixed(2))}
      aria-valuenow={0}
      aria-valuetext={`${formatTime(0)} of ${formatTime(buffer.duration)}`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seekFromPointer(event);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <canvas ref={canvasRef} className="waveform__canvas" />
      <div ref={progressRef} className="waveform__progress" />
      <div ref={playheadRef} className="waveform__playhead" />
      {analysing && <div className="waveform__status">Analysing waveform…</div>}
    </div>
  );
}
