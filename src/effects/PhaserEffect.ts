import { Lfo } from '../audio/Lfo';
import { setParam } from '../audio/paramUtils';
import { defineEffect } from './BaseEffect';

interface PhaserParams {
  stages: number;
  rateHz: number;
  depth: number;
  centerHz: number;
  feedback: number;
}

const MAX_STAGES = 8;

export const phaserEffect = defineEffect<PhaserParams>({
  type: 'phaser',
  label: 'Phaser',
  description: 'Sweeping notches from a chain of all-pass filters: a swirling, synthetic motion.',
  defaultAmount: 0.6,
  blend: 'add',
  params: {
    stages: {
      label: 'Stages',
      min: 2,
      max: 8,
      default: 4,
      step: 2,
      options: [
        { value: 2, label: '2' },
        { value: 4, label: '4' },
        { value: 6, label: '6' },
        { value: 8, label: '8' },
      ],
    },
    rateHz: { label: 'Rate', min: 0.05, max: 5, default: 0.4, step: 0.05, unit: 'Hz', scale: 'log' },
    depth: { label: 'Depth', min: 0, max: 1, default: 0.8, step: 0.01, percent: true },
    centerHz: { label: 'Center', min: 200, max: 3000, default: 900, step: 10, unit: 'Hz', scale: 'log' },
    feedback: { label: 'Feedback', min: 0, max: 0.8, default: 0.4, step: 0.01, percent: true, safe: { min: 0, max: 0.7 } },
  },
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    const input = context.createGain();
    const output = context.createGain();
    const stages = Array.from({ length: MAX_STAGES }, () => {
      const stage = context.createBiquadFilter();
      stage.type = 'allpass';
      stage.Q.value = 0.8;
      return stage;
    });
    const lfoDepth = context.createGain();
    for (const stage of stages) lfoDepth.connect(stage.frequency);
    const lfo = new Lfo(context, [lfoDepth]);

    // Web Audio mutes any cycle that lacks a DelayNode, so the feedback path carries the minimum
    // delay (one render quantum, ~3 ms). That slightly colours high-feedback settings, which is why feedback is capped at 80%.
    const feedbackDelay = context.createDelay(0.05);
    feedbackDelay.delayTime.value = 128 / context.sampleRate;
    const feedback = context.createGain();
    const feedbackSum = context.createGain();
    input.connect(feedbackSum);
    feedbackDelay.connect(feedback).connect(feedbackSum);

    let activeStages = -1;
    const wire = (count: number) => {
      if (count === activeStages) return;
      activeStages = count;
      feedbackSum.disconnect();
      // Disconnecting the stages also removes the last stage's send into feedbackDelay;
      // feedbackDelay → feedback → feedbackSum is permanent and must not be touched.
      stages.forEach((stage) => stage.disconnect());
      let previous: AudioNode = feedbackSum;
      for (let i = 0; i < count; i++) {
        previous.connect(stages[i]!);
        previous = stages[i]!;
      }
      previous.connect(output);
      previous.connect(feedbackDelay);
    };

    return {
      input,
      output,
      update(params, immediate) {
        wire(Math.min(MAX_STAGES, Math.max(2, Math.round(params.stages))));
        lfo.setFrequency(params.rateHz, immediate);
        // The LFO adds linearly to each stage's frequency; ±80% of centre at full depth.
        setParam(context, lfoDepth.gain, params.centerHz * params.depth * 0.8, immediate);
        for (const stage of stages) setParam(context, stage.frequency, params.centerHz, immediate);
        setParam(context, feedback.gain, params.feedback, immediate);
      },
      reset: (at) => lfo.restart(at),
      dispose() {
        lfo.dispose();
        [input, output, lfoDepth, feedbackDelay, feedback, feedbackSum, ...stages].forEach((node) => node.disconnect());
      },
    };
  },
});
