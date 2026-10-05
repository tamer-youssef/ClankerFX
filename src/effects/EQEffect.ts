import { setParam } from '../audio/paramUtils';
import { defineEffect } from './BaseEffect';

interface EQParams {
  lowDb: number;
  lowMidDb: number;
  lowMidHz: number;
  highMidDb: number;
  highMidHz: number;
  highDb: number;
}

const LOW_SHELF_HZ = 120;
const HIGH_SHELF_HZ = 8000;

export const eqEffect = defineEffect<EQParams>({
  type: 'eq',
  label: 'EQ',
  description: 'Four-band tone shaping: low shelf, two sweepable mids, high shelf.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    lowDb: { label: 'Low (120 Hz)', min: -15, max: 15, default: -4, step: 0.5, unit: 'dB', safe: { min: -9, max: 9 } },
    lowMidDb: { label: 'Low-mid gain', min: -15, max: 15, default: 3, step: 0.5, unit: 'dB', safe: { min: -9, max: 9 } },
    lowMidHz: { label: 'Low-mid freq', min: 150, max: 1500, default: 450, step: 5, unit: 'Hz', scale: 'log' },
    highMidDb: { label: 'High-mid gain', min: -15, max: 15, default: 5, step: 0.5, unit: 'dB', safe: { min: -9, max: 9 } },
    highMidHz: { label: 'High-mid freq', min: 1000, max: 8000, default: 2800, step: 10, unit: 'Hz', scale: 'log' },
    highDb: { label: 'High (8 kHz)', min: -15, max: 15, default: -2, step: 0.5, unit: 'dB', safe: { min: -9, max: 9 } },
  },
  // Amount scales every band's gain, so 0% is a flat response.
  resolve: (amount, params) => ({
    mix: 1,
    params: {
      ...params,
      lowDb: params.lowDb * amount,
      lowMidDb: params.lowMidDb * amount,
      highMidDb: params.highMidDb * amount,
      highDb: params.highDb * amount,
    },
  }),
  create(context) {
    const low = context.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = LOW_SHELF_HZ;
    const lowMid = context.createBiquadFilter();
    lowMid.type = 'peaking';
    lowMid.Q.value = 1;
    const highMid = context.createBiquadFilter();
    highMid.type = 'peaking';
    highMid.Q.value = 1;
    const high = context.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = HIGH_SHELF_HZ;
    low.connect(lowMid).connect(highMid).connect(high);

    return {
      input: low,
      output: high,
      update(params, immediate) {
        setParam(context, low.gain, params.lowDb, immediate);
        setParam(context, lowMid.gain, params.lowMidDb, immediate);
        setParam(context, lowMid.frequency, params.lowMidHz, immediate);
        setParam(context, highMid.gain, params.highMidDb, immediate);
        setParam(context, highMid.frequency, params.highMidHz, immediate);
        setParam(context, high.gain, params.highDb, immediate);
      },
      dispose: () => [low, lowMid, highMid, high].forEach((node) => node.disconnect()),
    };
  },
});
