import { NON_RESONANT_Q_DB, setParam } from '../audio/paramUtils';
import { defineEffect } from './BaseEffect';

interface DelayParams {
  timeMs: number;
  feedback: number;
  dampingHz: number;
}

const MAX_DELAY_SECONDS = 1;

export const delayEffect = defineEffect<DelayParams>({
  type: 'delay',
  label: 'Delay',
  description: 'Echoes. Very short times (20–60 ms) give a metallic, comb-filtered sound.',
  defaultAmount: 0.3,
  blend: 'add',
  params: {
    timeMs: { label: 'Time', min: 20, max: 1000, default: 240, step: 1, unit: 'ms', scale: 'log' },
    // Capped well below 1 so the loop always decays: runaway feedback is impossible by construction.
    feedback: { label: 'Feedback', min: 0, max: 0.85, default: 0.35, step: 0.01, percent: true, safe: { min: 0, max: 0.7 } },
    dampingHz: { label: 'Damping', min: 500, max: 12000, default: 4500, step: 50, unit: 'Hz', scale: 'log', safe: { min: 1500, max: 10000 } },
  },
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    const delay = context.createDelay(MAX_DELAY_SECONDS);
    const feedback = context.createGain();
    const damping = context.createBiquadFilter();
    damping.type = 'lowpass';
    // Must not resonate: a peak above 0 dB inside the loop would make the feedback unstable (see NON_RESONANT_Q_DB).
    damping.Q.value = NON_RESONANT_Q_DB;
    // delay → damping → feedback → delay. The DelayNode in the cycle keeps the loop legal and stable.
    delay.connect(damping).connect(feedback).connect(delay);

    return {
      input: delay,
      output: delay,
      update(params, immediate) {
        setParam(context, delay.delayTime, params.timeMs / 1000, immediate);
        setParam(context, feedback.gain, params.feedback, immediate);
        setParam(context, damping.frequency, params.dampingHz, immediate);
      },
      dispose: () => [delay, feedback, damping].forEach((node) => node.disconnect()),
    };
  },
});
