import { setParam } from '../audio/paramUtils';
import { defineEffect } from './BaseEffect';

interface StereoParams {
  width: number;
  haasMs: number;
}

export const stereoEffect = defineEffect<StereoParams>({
  type: 'stereo',
  label: 'Stereo Width',
  description: 'Narrow to mono or widen. The Haas delay gives mono recordings a stereo image.',
  defaultAmount: 1,
  blend: 'crossfade',
  params: {
    width: { label: 'Width', min: 0, max: 2, default: 1.6, step: 0.01, percent: true, safe: { min: 0.4, max: 1.8 } },
    haasMs: { label: 'Haas delay (R)', min: 0, max: 25, default: 10, step: 0.5, unit: 'ms' },
  },
  // Amount moves from the identity (width 100%, no delay) to the configured settings.
  resolve: (amount, params) => ({
    mix: 1,
    params: { width: 1 + (params.width - 1) * amount, haasMs: params.haasMs * amount },
  }),
  create(context) {
    // Mid/side matrix: M = (L+R)/2, S = (L−R)/2; output L = M + w·S, R = M − w·S.
    const input = context.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers'; // mono input is duplicated to both channels
    const splitter = context.createChannelSplitter(2);
    const haas = context.createDelay(0.05);
    const gain = (value: number) => {
      const node = context.createGain();
      node.gain.value = value;
      return node;
    };
    const midFromL = gain(0.5);
    const midFromR = gain(0.5);
    const sideFromL = gain(0.5);
    const sideFromR = gain(-0.5);
    const mid = gain(1);
    const side = gain(1); // this gain is the width control
    const sideInverted = gain(-1);
    const merger = context.createChannelMerger(2);

    input.connect(splitter);
    splitter.connect(midFromL, 0);
    splitter.connect(sideFromL, 0);
    splitter.connect(haas, 1);
    haas.connect(midFromR);
    haas.connect(sideFromR);
    midFromL.connect(mid);
    midFromR.connect(mid);
    sideFromL.connect(side);
    sideFromR.connect(side);
    side.connect(sideInverted);
    mid.connect(merger, 0, 0);
    side.connect(merger, 0, 0);
    mid.connect(merger, 0, 1);
    sideInverted.connect(merger, 0, 1);

    return {
      input,
      output: merger,
      update(params, immediate) {
        setParam(context, side.gain, params.width, immediate);
        setParam(context, haas.delayTime, params.haasMs / 1000, immediate);
      },
      dispose: () =>
        [input, splitter, haas, midFromL, midFromR, sideFromL, sideFromR, mid, side, sideInverted, merger].forEach((node) => node.disconnect()),
    };
  },
});
