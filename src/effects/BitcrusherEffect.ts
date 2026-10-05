import { createWorkletNode, disposeWorkletNode, resetWorkletAt, setWorkletParams } from '../audio/worklets';
import { defineEffect } from './BaseEffect';

interface BitcrusherParams {
  bits: number;
  rateHz: number;
}

export const bitcrusherEffect = defineEffect<BitcrusherParams>({
  type: 'bitcrusher',
  label: 'Bitcrusher',
  description: 'Lo-fi digital grit: fewer bits and a lower sample rate. Classic retro-robot and corrupted-voice sound.',
  defaultAmount: 0.6,
  blend: 'crossfade',
  params: {
    bits: { label: 'Bit depth', min: 1, max: 16, default: 5, step: 1, unit: 'bit', safe: { min: 3, max: 12 } },
    rateHz: { label: 'Sample rate', min: 500, max: 48000, default: 8000, step: 100, unit: 'Hz', scale: 'log', safe: { min: 3000, max: 24000 } },
  },
  // Amount blends the crushed signal against the clean one (parallel crush keeps speech intelligible at low settings).
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    const node = createWorkletNode(context, 'mechvox-bitcrusher');
    return {
      input: node,
      output: node,
      update: (params, immediate) => setWorkletParams(context, node, params, immediate),
      reset: (at) => resetWorkletAt(context, node, at),
      dispose: () => disposeWorkletNode(node),
    };
  },
});
