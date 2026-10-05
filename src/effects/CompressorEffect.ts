import { createWorkletNode, resetWorkletAt, setWorkletParams } from '../audio/worklets';
import { lerp } from '../utils/math';
import { defineEffect } from './BaseEffect';

interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
}

/**
 * Our own feed-forward compressor (dsp/CompressorCore.ts) rather than the browser's DynamicsCompressorNode, which adds a
 * hidden automatic make-up gain (up to +12 dB, depending on threshold and ratio) that made levels swing unpredictably.
 * Here a signal below the threshold passes at exactly unity; make-up is only what the Make-up slider says.
 */
export const compressorEffect = defineEffect<CompressorParams>({
  type: 'compressor',
  label: 'Compressor',
  description: 'Evens out dynamics so quiet and loud syllables sit together. No hidden make-up gain.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    thresholdDb: { label: 'Threshold', min: -60, max: 0, default: -26, step: 1, unit: 'dB', safe: { min: -40, max: -12 } },
    ratio: { label: 'Ratio', min: 1, max: 20, default: 6, step: 0.5, unit: ':1', safe: { min: 2, max: 12 } },
    attackMs: { label: 'Attack', min: 1, max: 100, default: 8, step: 1, unit: 'ms', scale: 'log' },
    releaseMs: { label: 'Release', min: 20, max: 1000, default: 160, step: 10, unit: 'ms', scale: 'log' },
    makeupDb: { label: 'Make-up gain', min: -12, max: 12, default: 0, step: 0.5, unit: 'dB', safe: { min: -3, max: 6 } },
  },
  // Amount moves threshold and ratio from "no compression" (0 dB, 1:1) to the configured values.
  resolve: (amount, params) => ({
    mix: 1,
    params: {
      ...params,
      thresholdDb: lerp(0, params.thresholdDb, amount),
      ratio: lerp(1, params.ratio, amount),
      makeupDb: params.makeupDb * amount,
    },
  }),
  create(context) {
    const node = createWorkletNode(context, 'mechvox-compressor');
    return {
      input: node,
      output: node,
      update: (params, immediate) => setWorkletParams(context, node, params, immediate),
      reset: (at) => resetWorkletAt(context, node, at),
      dispose: () => node.disconnect(),
    };
  },
});
