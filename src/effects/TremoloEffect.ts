import { setParam } from '../audio/paramUtils';
import { defineEffect } from './BaseEffect';

interface TremoloParams {
  rateHz: number;
  depth: number;
  shape: number;
}

const SHAPES: readonly OscillatorType[] = ['sine', 'triangle', 'square'];

export const tremoloEffect = defineEffect<TremoloParams>({
  type: 'tremolo',
  label: 'Tremolo',
  description: 'Rhythmic volume modulation. Square shape gives a stutter / gating effect.',
  defaultAmount: 0.7,
  blend: 'crossfade',
  params: {
    rateHz: { label: 'Rate', min: 0.5, max: 20, default: 6, step: 0.1, unit: 'Hz', scale: 'log' },
    depth: { label: 'Depth', min: 0, max: 1, default: 0.8, step: 0.01, percent: true },
    shape: {
      label: 'Shape',
      min: 0,
      max: 2,
      default: 0,
      step: 1,
      options: [
        { value: 0, label: 'Sine' },
        { value: 1, label: 'Triangle' },
        { value: 2, label: 'Square' },
      ],
    },
  },
  // Amount scales depth: 0% leaves the gain at exactly 1.
  resolve: (amount, params) => ({ mix: 1, params: { ...params, depth: params.depth * amount } }),
  create(context) {
    const output = context.createGain();
    const lfo = context.createOscillator();
    const lfoDepth = context.createGain();
    // gain(t) = (1 - depth/2) + (depth/2)·lfo(t), which swings between 1 - depth and 1.
    lfo.connect(lfoDepth).connect(output.gain);
    lfo.start();

    return {
      input: output,
      output,
      update(params, immediate) {
        setParam(context, lfo.frequency, params.rateHz, immediate);
        lfo.type = SHAPES[params.shape] ?? 'sine';
        setParam(context, lfoDepth.gain, params.depth / 2, immediate);
        setParam(context, output.gain, 1 - params.depth / 2, immediate);
      },
      dispose() {
        lfo.stop();
        [lfo, lfoDepth, output].forEach((node) => node.disconnect());
      },
    };
  },
});
