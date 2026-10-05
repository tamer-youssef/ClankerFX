import { createWorkletNode, resetWorkletAt, setWorkletParams } from '../audio/worklets';
import { defineEffect } from './BaseEffect';

interface FlangerParams {
  rateHz: number;
  centerMs: number;
  depth: number;
  feedback: number;
}

export const flangerEffect = defineEffect<FlangerParams>({
  type: 'flanger',
  label: 'Flanger',
  description: 'A sweeping comb filter. With strong feedback it gives a metallic, jet-engine resonance.',
  defaultAmount: 0.6,
  blend: 'add',
  params: {
    rateHz: { label: 'Rate', min: 0.05, max: 10, default: 0.4, step: 0.05, unit: 'Hz', scale: 'log' },
    centerMs: { label: 'Delay', min: 0.3, max: 10, default: 2.5, step: 0.1, unit: 'ms', scale: 'log' },
    depth: { label: 'Depth', min: 0, max: 0.95, default: 0.8, step: 0.01, percent: true },
    // Capped below ±1 so the loop always decays; negative values give a hollow, "through-zero" flavour.
    feedback: { label: 'Feedback', min: -0.85, max: 0.85, default: 0.6, step: 0.01, percent: true },
  },
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    const node = createWorkletNode(context, 'mechvox-flanger');
    return {
      input: node,
      output: node,
      update: (params, immediate) => setWorkletParams(context, node, params, immediate),
      reset: (at) => resetWorkletAt(context, node, at),
      dispose: () => node.disconnect(),
    };
  },
});
