import { NON_RESONANT_Q_DB, setParam } from '../audio/paramUtils';
import { generateNoise, type NoiseKind } from '../dsp/noise';
import { dbToGain } from '../utils/math';
import { defineEffect } from './BaseEffect';

interface NoiseParams {
  kind: number;
  levelDb: number;
  lowCutHz: number;
  highCutHz: number;
}

const KINDS: readonly NoiseKind[] = ['white', 'pink', 'crackle'];
const LOOP_SECONDS = 4;

export const noiseEffect = defineEffect<NoiseParams>({
  type: 'noise',
  label: 'Noise / Static',
  description: 'Adds hiss, pink noise or crackly radio static underneath the voice.',
  defaultAmount: 0.5,
  blend: 'add',
  params: {
    kind: {
      label: 'Type',
      min: 0,
      max: 2,
      default: 2,
      step: 1,
      options: [
        { value: 0, label: 'White hiss' },
        { value: 1, label: 'Pink' },
        { value: 2, label: 'Crackle' },
      ],
    },
    levelDb: { label: 'Level (RMS)', min: -60, max: -6, default: -28, step: 1, unit: 'dB' },
    lowCutHz: { label: 'Low cut', min: 20, max: 2000, default: 250, step: 5, unit: 'Hz', scale: 'log' },
    highCutHz: { label: 'High cut', min: 1000, max: 16000, default: 7000, step: 100, unit: 'Hz', scale: 'log' },
  },
  // Amount scales the noise level from silence up to the configured level.
  resolve: (amount, params) => ({ mix: amount, params }),
  create(context) {
    const lowCut = context.createBiquadFilter();
    lowCut.type = 'highpass';
    const highCut = context.createBiquadFilter();
    highCut.type = 'lowpass';
    lowCut.Q.value = NON_RESONANT_Q_DB;
    highCut.Q.value = NON_RESONANT_Q_DB;
    const level = context.createGain();
    const input = context.createGain(); // unused: noise is generated, but the slot expects an input node
    lowCut.connect(highCut).connect(level);

    let source: AudioBufferSourceNode | null = null;
    let noiseBuffer: AudioBuffer | null = null;
    let activeKind = -1;
    /** Starts a fresh looping source at `at`, replacing the current one at exactly that moment. */
    const startSource = (at?: number) => {
      if (!noiseBuffer) return;
      const previous = source;
      source = context.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      source.connect(lowCut);
      source.start(at);
      previous?.stop(at);
      if (previous) previous.onended = () => previous.disconnect();
    };
    const setKind = (kind: number) => {
      if (kind === activeKind) return;
      activeKind = kind;
      const length = Math.floor(context.sampleRate * LOOP_SECONDS);
      const channels = generateNoise(KINDS[kind] ?? 'white', length, 2);
      noiseBuffer = context.createBuffer(2, length, context.sampleRate);
      channels.forEach((data, channel) => noiseBuffer!.copyToChannel(data as Float32Array<ArrayBuffer>, channel));
      startSource();
    };

    return {
      input,
      output: level,
      update(params, immediate) {
        setKind(Math.round(params.kind));
        setParam(context, lowCut.frequency, params.lowCutHz, immediate);
        setParam(context, highCut.frequency, params.highCutHz, immediate);
        setParam(context, level.gain, dbToGain(params.levelDb), immediate);
      },
      reset: (at) => startSource(at),
      dispose() {
        source?.stop();
        [source, lowCut, highCut, level, input].forEach((node) => node?.disconnect());
      },
    };
  },
});
