import { useEffect, useRef } from 'react';
import { samplePeak } from '../analysis/PeakAnalyzer';
import { renderChain, type RenderedAudio } from '../audio/OfflineRenderer';
import { runOutputStage } from '../audio/outputRunner';
import { useApp } from '../state/AppContext';
import { getActiveFile } from '../state/appState';
import type { EffectState } from '../types/effects';
import { createId } from '../utils/id';

/** Waits for edits (slider drags) to settle before paying for an offline render. */
const DEBOUNCE_MS = 350;

const inputPeaks = new WeakMap<AudioBuffer, number>();

function inputPeakOf(buffer: AudioBuffer): number {
  let peak = inputPeaks.get(buffer);
  if (peak === undefined) {
    peak = samplePeak(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
    inputPeaks.set(buffer, peak);
  }
  return peak;
}

/**
 * Keeps `state.measurements` current: renders the active file through the chain offline (the same path export uses),
 * measures it, and pushes the resulting normalisation gain to the live engine so the preview is level-matched like the
 * exported file will be. Only the chain/file trigger a re-render; changing normalisation settings reuses the render.
 */
export function useOutputAnalysis(): void {
  const { state, dispatch, engine } = useApp();
  const file = getActiveFile(state);
  const buffer = file?.buffer ?? null;
  const { chain, normalization } = state;
  const hasMeasurements = state.measurements !== null;
  const cache = useRef<{ buffer: AudioBuffer; chain: EffectState[]; rendered: RenderedAudio } | null>(null);

  useEffect(() => {
    if (!buffer) {
      cache.current = null;
      if (hasMeasurements) dispatch({ type: 'output/measured', measurements: null });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      dispatch({ type: 'output/measuring' });
      try {
        let rendered = cache.current && cache.current.buffer === buffer && cache.current.chain === chain ? cache.current.rendered : null;
        if (!rendered) {
          rendered = await renderChain(buffer, chain);
          if (cancelled) return;
          cache.current = { buffer, chain, rendered };
        }
        const { measurements } = await runOutputStage(
          { rendered: rendered.channels, sampleRate: rendered.sampleRate, inputPeak: inputPeakOf(buffer), settings: normalization },
          false,
        );
        if (!cancelled) dispatch({ type: 'output/measured', measurements });
      } catch (error) {
        if (cancelled) return;
        dispatch({ type: 'output/measured', measurements: null });
        const reason = error instanceof Error ? error.message : 'unknown error';
        dispatch({
          type: 'notice/pushed',
          notice: { id: createId('notice'), kind: 'warning', message: `Could not measure the processed audio (${reason}). Level readouts are unavailable.` },
        });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // hasMeasurements only gates the "clear when no file" branch, so it is deliberately not a dependency.
  }, [buffer, chain, normalization, dispatch]);

  // Preview level stage. "Bypass all" auditions the original at its own level for a fair before/after.
  const gainDb = state.bypassAll ? 0 : (state.measurements?.gainDb ?? 0);
  useEffect(() => {
    engine.setOutputStage({
      gainDb,
      ceilingDb: normalization.ceilingDb,
      truePeak: normalization.truePeak,
      limiterEnabled: normalization.limiterEnabled,
    });
  }, [engine, gainDb, normalization.ceilingDb, normalization.truePeak, normalization.limiterEnabled]);
}
