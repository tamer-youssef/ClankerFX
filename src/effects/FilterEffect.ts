import { NON_RESONANT_Q_DB, setParam } from '../audio/paramUtils';
import { lerpLog } from '../utils/math';
import { defineEffect } from './BaseEffect';

interface FilterParams {
  highpassHz: number;
  lowpassHz: number;
  slope: number;
}

const OPEN_HIGHPASS_HZ = 10;
const OPEN_LOWPASS_HZ = 20000;
/** Q of 1/√2 per stage; two cascaded stages form a Linkwitz-Riley (24 dB/oct) response. */
const BUTTERWORTH_Q = NON_RESONANT_Q_DB;

export const filterEffect = defineEffect<FilterParams>({
  type: 'filter',
  label: 'High / Low-pass Filter',
  description: 'Cuts lows and highs. Great for radios, intercoms and telephones.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    highpassHz: { label: 'High-pass', min: 10, max: 2000, default: 350, step: 1, unit: 'Hz', scale: 'log', safe: { min: 60, max: 1200 } },
    lowpassHz: { label: 'Low-pass', min: 500, max: 20000, default: 3200, step: 10, unit: 'Hz', scale: 'log', safe: { min: 1500, max: 12000 } },
    slope: {
      label: 'Slope',
      min: 12,
      max: 24,
      default: 24,
      step: 12,
      unit: 'dB/oct',
      options: [
        { value: 12, label: '12 dB/oct' },
        { value: 24, label: '24 dB/oct' },
      ],
    },
  },
  // Amount sweeps both cutoffs from fully open (transparent) to the configured corner frequencies.
  resolve: (amount, params) => {
    const lowpassHz = lerpLog(OPEN_LOWPASS_HZ, params.lowpassHz, amount);
    // Keep the pass-band from collapsing if the cutoffs cross.
    const highpassHz = Math.min(lerpLog(OPEN_HIGHPASS_HZ, params.highpassHz, amount), lowpassHz * 0.9);
    return { mix: 1, params: { ...params, highpassHz, lowpassHz } };
  },
  create(context) {
    const highpassA = context.createBiquadFilter();
    const highpassB = context.createBiquadFilter();
    const lowpassA = context.createBiquadFilter();
    const lowpassB = context.createBiquadFilter();
    for (const node of [highpassA, highpassB]) node.type = 'highpass';
    for (const node of [lowpassA, lowpassB]) node.type = 'lowpass';
    for (const node of [highpassA, highpassB, lowpassA, lowpassB]) node.Q.value = BUTTERWORTH_Q;
    highpassA.connect(highpassB).connect(lowpassA).connect(lowpassB);

    return {
      input: highpassA,
      output: lowpassB,
      update(params, immediate) {
        for (const node of [highpassA, highpassB]) setParam(context, node.frequency, params.highpassHz, immediate);
        for (const node of [lowpassA, lowpassB]) setParam(context, node.frequency, params.lowpassHz, immediate);
        // An allpass stage is magnitude-flat, so it turns a 24 dB/oct cascade into 12 dB/oct.
        highpassB.type = params.slope >= 24 ? 'highpass' : 'allpass';
        lowpassB.type = params.slope >= 24 ? 'lowpass' : 'allpass';
      },
      dispose: () => [highpassA, highpassB, lowpassA, lowpassB].forEach((node) => node.disconnect()),
    };
  },
});
