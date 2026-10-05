import { createWorkletNode, resetWorkletAt, setWorkletParams } from '../audio/worklets';
import { clamp01 } from '../utils/math';
import { defineEffect } from './BaseEffect';

interface PitchParams {
  semitones: number;
  windowMs: number;
  /** Wet level at full Amount. Below 100% the shifted voice is layered with the original (harmonizer-style). */
  wet: number;
}

/** Over this much Amount the wet path is fully faded in, so the first few % do not leave a delayed copy hanging. */
const WET_FADE_IN_AMOUNT = 0.1;

export const pitchEffect = defineEffect<PitchParams>({
  type: 'pitch',
  label: 'Pitch Shift',
  description: 'Transposes the voice. Down for large, heavy machines; up for small, chirpy bots. Formants move with pitch.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    semitones: { label: 'Pitch', min: -24, max: 24, default: -5, step: 0.5, unit: 'st', safe: { min: -14, max: 10 } },
    windowMs: { label: 'Grain size', min: 20, max: 120, default: 60, step: 1, unit: 'ms' },
    wet: { label: 'Wet / dry', min: 0, max: 1, default: 1, step: 0.01, percent: true },
  },
  // Amount scales the interval (50% = half the transposition). The wet path fades in over the first 10%
  // so that 0% is exactly the dry signal, with no delayed copy left over.
  resolve: (amount, params) => ({
    mix: params.wet * clamp01(amount / WET_FADE_IN_AMOUNT),
    params: { ...params, semitones: params.semitones * amount },
  }),
  create(context) {
    const node = createWorkletNode(context, 'mechvox-pitch');
    return {
      input: node,
      output: node,
      update: (params, immediate) => setWorkletParams(context, node, { semitones: params.semitones, windowMs: params.windowMs }, immediate),
      reset: (at) => resetWorkletAt(context, node, at),
      dispose: () => node.disconnect(),
    };
  },
});
