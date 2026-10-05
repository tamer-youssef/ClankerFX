import { Lfo } from '../audio/Lfo';
import { defineEffect } from './BaseEffect';

interface RingModParams {
  frequencyHz: number;
  shape: number;
}

const SHAPES: readonly OscillatorType[] = ['sine', 'square', 'triangle', 'sawtooth'];

export const ringModEffect = defineEffect<RingModParams>({
  type: 'ringmod',
  label: 'Ring Modulator',
  description: 'Multiplies the voice by a tone: the classic metallic robot / Dalek sound.',
  defaultAmount: 0.7,
  blend: 'crossfade',
  params: {
    frequencyHz: { label: 'Carrier frequency', min: 20, max: 2000, default: 70, step: 1, unit: 'Hz', scale: 'log' },
    shape: {
      label: 'Carrier shape',
      min: 0,
      max: 3,
      default: 0,
      step: 1,
      options: [
        { value: 0, label: 'Sine' },
        { value: 1, label: 'Square' },
        { value: 2, label: 'Triangle' },
        { value: 3, label: 'Saw' },
      ],
    },
  },
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    // True ring modulation: output = input × carrier. The carrier drives the gain AudioParam whose own
    // value is 0, so the node's gain at any instant *is* the carrier sample.
    const multiplier = context.createGain();
    multiplier.gain.value = 0;
    const carrier = new Lfo(context, [multiplier.gain]);

    return {
      input: multiplier,
      output: multiplier,
      update(params, immediate) {
        carrier.setFrequency(params.frequencyHz, immediate);
        carrier.setType(SHAPES[params.shape] ?? 'sine');
      },
      reset: (at) => carrier.restart(at),
      dispose() {
        carrier.dispose();
        multiplier.disconnect();
      },
    };
  },
});
