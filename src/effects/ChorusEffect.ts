import { Lfo } from '../audio/Lfo';
import { setParam } from '../audio/paramUtils';
import { defineEffect } from './BaseEffect';

interface ChorusParams {
  rateHz: number;
  depthMs: number;
  delayMs: number;
}

/** The second voice runs slightly faster so the two LFOs drift in and out of phase. */
const SECOND_VOICE_RATE_RATIO = 1.13;

export const chorusEffect = defineEffect<ChorusParams>({
  type: 'chorus',
  label: 'Chorus',
  description: 'Thickens the voice with slightly detuned, modulated copies.',
  defaultAmount: 0.5,
  blend: 'add',
  params: {
    rateHz: { label: 'Rate', min: 0.1, max: 5, default: 0.9, step: 0.05, unit: 'Hz', scale: 'log' },
    depthMs: { label: 'Depth', min: 0.5, max: 8, default: 3, step: 0.1, unit: 'ms' },
    delayMs: { label: 'Base delay', min: 8, max: 30, default: 16, step: 0.5, unit: 'ms' },
  },
  resolve: (amount, params) => ({
    mix: amount,
    // Modulation can never exceed the base delay, which would ask for a negative delay time.
    params: { ...params, depthMs: Math.min(params.depthMs, params.delayMs * 0.9) },
  }),
  create(context) {
    const output = context.createGain();
    const voices = [1, SECOND_VOICE_RATE_RATIO].map((rateRatio) => {
      const delay = context.createDelay(0.05);
      const lfoDepth = context.createGain();
      const level = context.createGain();
      level.gain.value = 0.6;
      lfoDepth.connect(delay.delayTime);
      const lfo = new Lfo(context, [lfoDepth]);
      delay.connect(level).connect(output);
      return { delay, lfo, lfoDepth, level, rateRatio };
    });
    const input = context.createGain();
    for (const voice of voices) input.connect(voice.delay);

    return {
      input,
      output,
      update(params, immediate) {
        for (const voice of voices) {
          setParam(context, voice.delay.delayTime, params.delayMs / 1000, immediate);
          voice.lfo.setFrequency(params.rateHz * voice.rateRatio, immediate);
          setParam(context, voice.lfoDepth.gain, params.depthMs / 1000, immediate);
        }
      },
      reset: (at) => voices.forEach((voice) => voice.lfo.restart(at)),
      dispose() {
        for (const voice of voices) {
          voice.lfo.dispose();
          [voice.delay, voice.lfoDepth, voice.level].forEach((node) => node.disconnect());
        }
        input.disconnect();
        output.disconnect();
      },
    };
  },
});
