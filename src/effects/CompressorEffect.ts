import { setParam } from '../audio/paramUtils';
import { dbToGain, lerp } from '../utils/math';
import { defineEffect } from './BaseEffect';

interface CompressorParams {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
}

export const compressorEffect = defineEffect<CompressorParams>({
  type: 'compressor',
  label: 'Compressor',
  description: 'Evens out dynamics so quiet and loud syllables sit together.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    thresholdDb: { label: 'Threshold', min: -60, max: 0, default: -26, step: 1, unit: 'dB' },
    ratio: { label: 'Ratio', min: 1, max: 20, default: 6, step: 0.5, unit: ':1' },
    attackMs: { label: 'Attack', min: 1, max: 100, default: 8, step: 1, unit: 'ms', scale: 'log' },
    releaseMs: { label: 'Release', min: 20, max: 1000, default: 160, step: 10, unit: 'ms', scale: 'log' },
    makeupDb: { label: 'Make-up gain', min: -12, max: 12, default: 0, step: 0.5, unit: 'dB' },
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
    const compressor = context.createDynamicsCompressor();
    compressor.knee.value = 6;
    const makeup = context.createGain();
    compressor.connect(makeup);

    return {
      input: compressor,
      output: makeup,
      update(params, immediate) {
        setParam(context, compressor.threshold, params.thresholdDb, immediate);
        setParam(context, compressor.ratio, params.ratio, immediate);
        setParam(context, compressor.attack, params.attackMs / 1000, immediate);
        setParam(context, compressor.release, params.releaseMs / 1000, immediate);
        setParam(context, makeup.gain, dbToGain(params.makeupDb), immediate);
      },
      dispose: () => {
        compressor.disconnect();
        makeup.disconnect();
      },
    };
  },
});
