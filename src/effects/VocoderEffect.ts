import { createWorkletNode, resetWorkletAt, setWorkletParams } from '../audio/worklets';
import { defineEffect } from './BaseEffect';

interface VocoderParams {
  bands: number;
  carrier: number;
  carrierHz: number;
  lowHz: number;
  highHz: number;
  attackMs: number;
  releaseMs: number;
  formantShift: number;
  hiss: number;
  gateDb: number;
  wet: number;
}

export const vocoderEffect = defineEffect<VocoderParams>({
  type: 'vocoder',
  label: 'Vocoder',
  description: 'Imposes your voice on a synthetic carrier tone: understandable speech with an unmistakably robotic timbre.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    bands: {
      label: 'Bands',
      min: 8,
      max: 32,
      default: 16,
      step: 4,
      options: [
        { value: 8, label: '8 (rough, retro)' },
        { value: 12, label: '12' },
        { value: 16, label: '16 (balanced)' },
        { value: 24, label: '24' },
        { value: 32, label: '32 (clear)' },
      ],
    },
    carrier: {
      label: 'Carrier',
      min: 0,
      max: 3,
      default: 0,
      step: 1,
      options: [
        { value: 0, label: 'Saw (buzzy)' },
        { value: 1, label: 'Square (hollow)' },
        { value: 2, label: 'Pulse (nasal)' },
        { value: 3, label: 'Noise (whisper)' },
      ],
    },
    carrierHz: { label: 'Carrier pitch', min: 40, max: 600, default: 110, step: 1, unit: 'Hz', scale: 'log', safe: { min: 50, max: 400 } },
    lowHz: { label: 'Range: low', min: 60, max: 600, default: 120, step: 5, unit: 'Hz', scale: 'log' },
    highHz: { label: 'Range: high', min: 3000, max: 14000, default: 7500, step: 100, unit: 'Hz', scale: 'log' },
    attackMs: { label: 'Attack', min: 0.5, max: 50, default: 4, step: 0.5, unit: 'ms', scale: 'log' },
    releaseMs: { label: 'Release', min: 5, max: 300, default: 40, step: 1, unit: 'ms', scale: 'log' },
    formantShift: { label: 'Formant shift', min: 0.5, max: 2, default: 1, step: 0.01, unit: '×', scale: 'log', safe: { min: 0.65, max: 1.5 } },
    hiss: { label: 'Consonant hiss', min: 0, max: 1, default: 0.35, step: 0.01, percent: true },
    gateDb: { label: 'Noise gate', min: -80, max: -30, default: -70, step: 1, unit: 'dB', safe: { min: -80, max: -45 } },
    wet: { label: 'Wet / dry', min: 0, max: 1, default: 1, step: 0.01, percent: true },
  },
  // Amount fades from the natural voice (0%) to the fully vocoded voice (100%) scaled by Wet / dry.
  resolve: (amount, params) => ({ mix: amount * params.wet, params }),
  create(context) {
    const node = createWorkletNode(context, 'mechvox-vocoder');
    return {
      input: node,
      output: node,
      update(params, immediate) {
        const { wet: _wet, ...dsp } = params;
        setWorkletParams(context, node, dsp, immediate);
      },
      reset: (at) => resetWorkletAt(context, node, at),
      dispose: () => node.disconnect(),
    };
  },
});
