import { NON_RESONANT_Q_DB, setParam } from '../audio/paramUtils';
import { createShaperCurve, SHAPER_RANGE, type DistortionShape } from '../dsp/curves';
import { dbToGain } from '../utils/math';
import { defineEffect } from './BaseEffect';

interface DistortionParams {
  driveDb: number;
  shape: number;
  toneHz: number;
  outputDb: number;
}

const SHAPES: readonly DistortionShape[] = ['soft', 'hard', 'fold'];

export const distortionEffect = defineEffect<DistortionParams>({
  type: 'distortion',
  label: 'Distortion',
  description: 'Saturation, clipping and wavefolding for gritty, damaged-speaker tones.',
  defaultAmount: 0.5,
  blend: 'crossfade',
  params: {
    driveDb: { label: 'Drive', min: 0, max: 40, default: 20, step: 0.5, unit: 'dB', safe: { min: 4, max: 32 } },
    shape: {
      label: 'Character',
      min: 0,
      max: 2,
      default: 0,
      step: 1,
      options: [
        { value: 0, label: 'Soft (tanh)' },
        { value: 1, label: 'Hard clip' },
        { value: 2, label: 'Fold' },
      ],
    },
    toneHz: { label: 'Tone (low-pass)', min: 800, max: 16000, default: 7000, step: 100, unit: 'Hz', scale: 'log' },
    outputDb: { label: 'Output level', min: -18, max: 6, default: -3, step: 0.5, unit: 'dB', safe: { min: -9, max: 0 } },
  },
  // Amount is a parallel blend of clean and distorted signal, so 0% is the untouched input.
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    const preGain = context.createGain();
    const shaper = context.createWaveShaper();
    shaper.oversample = '4x'; // limits aliasing from the harmonics the shaper creates
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = NON_RESONANT_Q_DB;
    const outputGain = context.createGain();
    preGain.connect(shaper).connect(tone).connect(outputGain);

    const curves = new Map<number, Float32Array<ArrayBuffer>>();

    return {
      input: preGain,
      output: outputGain,
      update(params, immediate) {
        const shapeIndex = SHAPES[params.shape] ? params.shape : 0;
        let curve = curves.get(shapeIndex);
        if (!curve) {
          curve = createShaperCurve(SHAPES[shapeIndex] ?? 'soft');
          curves.set(shapeIndex, curve);
        }
        if (shaper.curve !== curve) shaper.curve = curve;
        setParam(context, preGain.gain, dbToGain(params.driveDb) / SHAPER_RANGE, immediate);
        setParam(context, tone.frequency, params.toneHz, immediate);
        setParam(context, outputGain.gain, dbToGain(params.outputDb), immediate);
      },
      dispose: () => [preGain, shaper, tone, outputGain].forEach((node) => node.disconnect()),
    };
  },
});
