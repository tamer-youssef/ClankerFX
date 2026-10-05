import { setParam } from '../audio/paramUtils';
import { dbToGain } from '../utils/math';
import { defineEffect } from './BaseEffect';

interface GainParams {
  gainDb: number;
}

export const gainEffect = defineEffect<GainParams>({
  type: 'gain',
  label: 'Gain',
  description: 'Raise or lower the level.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    gainDb: { label: 'Gain', min: -24, max: 12, default: 6, step: 0.5, unit: 'dB' },
  },
  // Amount scales the dB change, so 0% is unity gain.
  resolve: (amount, params) => ({ mix: 1, params: { gainDb: params.gainDb * amount } }),
  create(context) {
    const node = context.createGain();
    return {
      input: node,
      output: node,
      update: (params, immediate) => setParam(context, node.gain, dbToGain(params.gainDb), immediate),
      dispose: () => node.disconnect(),
    };
  },
});
