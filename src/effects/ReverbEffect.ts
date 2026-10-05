import { generateReverbImpulse } from '../dsp/impulse';
import { setParam } from '../audio/paramUtils';
import { defineEffect } from './BaseEffect';

interface ReverbParams {
  decaySeconds: number;
  toneHz: number;
  preDelayMs: number;
}

/** Rebuilding the impulse response mid-playback is costly, so edits are applied after the slider settles. */
const IR_REBUILD_DEBOUNCE_MS = 150;

function buildImpulse(context: BaseAudioContext, params: ReverbParams): AudioBuffer {
  const channels = generateReverbImpulse(context.sampleRate, params.decaySeconds, params.toneHz);
  const buffer = context.createBuffer(channels.length, channels[0]!.length, context.sampleRate);
  channels.forEach((data, channel) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, channel));
  return buffer;
}

export const reverbEffect = defineEffect<ReverbParams>({
  type: 'reverb',
  label: 'Reverb',
  description: 'Room / hall ambience from a synthetic impulse response.',
  defaultAmount: 0.3,
  blend: 'add',
  params: {
    decaySeconds: { label: 'Decay', min: 0.2, max: 6, default: 1.4, step: 0.1, unit: 's' },
    toneHz: { label: 'Brightness', min: 1000, max: 16000, default: 6000, step: 100, unit: 'Hz', scale: 'log' },
    preDelayMs: { label: 'Pre-delay', min: 0, max: 100, default: 12, step: 1, unit: 'ms' },
  },
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    const preDelay = context.createDelay(0.2);
    const convolver = context.createConvolver();
    preDelay.connect(convolver);

    let appliedKey = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const applyImpulse = (params: ReverbParams) => {
      appliedKey = `${params.decaySeconds}|${params.toneHz}`;
      convolver.buffer = buildImpulse(context, params);
    };

    return {
      input: preDelay,
      output: convolver,
      update(params, immediate) {
        setParam(context, preDelay.delayTime, params.preDelayMs / 1000, immediate);
        const key = `${params.decaySeconds}|${params.toneHz}`;
        if (key === appliedKey) return;
        clearTimeout(timer);
        if (immediate || appliedKey === '') applyImpulse(params);
        else timer = setTimeout(() => applyImpulse(params), IR_REBUILD_DEBOUNCE_MS);
      },
      dispose() {
        clearTimeout(timer);
        preDelay.disconnect();
        convolver.disconnect();
      },
    };
  },
});
