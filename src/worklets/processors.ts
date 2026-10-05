/// <reference path="./worklet-globals.d.ts" />
import { BitcrusherCore } from '../dsp/BitcrusherCore';
import { FlangerCore } from '../dsp/FlangerCore';
import { LimiterCore } from '../dsp/LimiterCore';
import { PitchShiftCore } from '../dsp/PitchShiftCore';
import { VocoderCore, type CarrierWave } from '../dsp/VocoderCore';

/**
 * AudioWorklet processors: thin adapters from Web Audio's process() to the pure DSP cores in dsp/.
 * All parameters are k-rate AudioParams, so they smooth and automate exactly like native node params —
 * which also makes offline rendering deterministic.
 */

/** Descriptor helper; min/max are deliberately wide because the effect schemas already clamp. */
const kRate = (name: string, defaultValue: number, minValue: number, maxValue: number) => ({
  name,
  defaultValue,
  minValue,
  maxValue,
  automationRate: 'k-rate' as const,
});

const value = (parameters: Record<string, Float32Array>, name: string): number => parameters[name]?.[0] ?? 0;

interface Resettable {
  reset(): void;
}

/**
 * Base class for MechVox processors. Besides adapting process() to a DSP core, it implements frame-exact resets:
 * the engine posts `{ type: 'reset', frame }` shortly before playback starts, and the core is reset at precisely that
 * sample. A reset that took effect on message arrival would be wrong, because the worklet keeps running (and
 * advancing LFO / grain / carrier phase) through the silence between the message and the first audio sample.
 */
abstract class CoreProcessor extends AudioWorkletProcessor {
  private resetAtFrame: number | null = null;

  protected abstract readonly core: Resettable;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; frame?: number } | null;
      if (data?.type === 'reset' && typeof data.frame === 'number') this.resetAtFrame = data.frame;
    };
  }

  protected abstract run(inputs: Float32Array[], outputs: Float32Array[], frames: number, parameters: Record<string, Float32Array>): void;

  override process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const input = inputs[0] ?? [];
    const frames = output[0]!.length;

    const resetAt = this.resetAtFrame;
    if (resetAt !== null && resetAt < currentFrame + frames) {
      this.resetAtFrame = null;
      // Frames of this block that precede the reset point are processed normally; the rest start from a clean state.
      const split = Math.max(0, resetAt - currentFrame);
      if (split > 0) {
        this.run(
          input.map((channel) => channel.subarray(0, split)),
          output.map((channel) => channel.subarray(0, split)),
          split,
          parameters,
        );
      }
      this.core.reset();
      this.run(
        input.map((channel) => channel.subarray(split)),
        output.map((channel) => channel.subarray(split)),
        frames - split,
        parameters,
      );
    } else {
      this.run(input, output, frames, parameters);
    }
    return true;
  }
}

class BitcrusherProcessor extends CoreProcessor {
  protected readonly core = new BitcrusherCore();

  static get parameterDescriptors() {
    return [kRate('bits', 8, 1, 16), kRate('rateHz', 11025, 100, 192000)];
  }

  protected run(inputs: Float32Array[], outputs: Float32Array[], frames: number, parameters: Record<string, Float32Array>): void {
    this.core.process(inputs, outputs, frames, { bits: value(parameters, 'bits'), rateHz: value(parameters, 'rateHz') }, sampleRate);
  }
}

class FlangerProcessor extends CoreProcessor {
  protected readonly core = new FlangerCore();

  static get parameterDescriptors() {
    return [kRate('rateHz', 0.4, 0.01, 20), kRate('centerMs', 2.5, 0.1, 15), kRate('depth', 0.8, 0, 1), kRate('feedback', 0.6, -1, 1)];
  }

  protected run(inputs: Float32Array[], outputs: Float32Array[], frames: number, parameters: Record<string, Float32Array>): void {
    this.core.process(
      inputs,
      outputs,
      frames,
      {
        rateHz: value(parameters, 'rateHz'),
        centerMs: value(parameters, 'centerMs'),
        depth: value(parameters, 'depth'),
        feedback: value(parameters, 'feedback'),
      },
      sampleRate,
    );
  }
}

class PitchShiftProcessor extends CoreProcessor {
  protected readonly core = new PitchShiftCore();

  static get parameterDescriptors() {
    return [kRate('semitones', 0, -48, 48), kRate('windowMs', 60, 10, 200)];
  }

  protected run(inputs: Float32Array[], outputs: Float32Array[], frames: number, parameters: Record<string, Float32Array>): void {
    this.core.process(inputs, outputs, frames, { semitones: value(parameters, 'semitones'), windowMs: value(parameters, 'windowMs') }, sampleRate);
  }
}

const CARRIERS: readonly CarrierWave[] = ['saw', 'square', 'pulse', 'noise'];

class VocoderProcessor extends CoreProcessor {
  protected readonly core = new VocoderCore();

  static get parameterDescriptors() {
    return [
      kRate('bands', 16, 4, 32),
      kRate('lowHz', 120, 20, 2000),
      kRate('highHz', 7500, 1000, 20000),
      kRate('carrierHz', 110, 20, 1000),
      kRate('carrier', 0, 0, 3),
      kRate('attackMs', 4, 0.1, 100),
      kRate('releaseMs', 40, 1, 500),
      kRate('formantShift', 1, 0.25, 4),
      kRate('hiss', 0.35, 0, 1),
      kRate('gateDb', -80, -100, 0),
    ];
  }

  protected run(inputs: Float32Array[], outputs: Float32Array[], frames: number, parameters: Record<string, Float32Array>): void {
    this.core.process(
      inputs,
      outputs,
      frames,
      {
        bands: value(parameters, 'bands'),
        lowHz: value(parameters, 'lowHz'),
        highHz: value(parameters, 'highHz'),
        carrierHz: value(parameters, 'carrierHz'),
        carrier: CARRIERS[Math.round(value(parameters, 'carrier'))] ?? 'saw',
        attackMs: value(parameters, 'attackMs'),
        releaseMs: value(parameters, 'releaseMs'),
        formantShift: value(parameters, 'formantShift'),
        hiss: value(parameters, 'hiss'),
        gateDb: value(parameters, 'gateDb'),
      },
      sampleRate,
    );
  }
}

/**
 * Output limiter. Unlike the effects it has no free-running phase to reset; instead the limiter core is rebuilt when
 * its (rarely changed) ceiling / mode parameters change.
 */
class LimiterProcessor extends CoreProcessor {
  private limiter: LimiterCore | null = null;
  private appliedKey = '';

  protected get core(): Resettable {
    return this.limiter ?? { reset() {} };
  }

  static get parameterDescriptors() {
    return [kRate('ceilingDb', -1, -60, 60), kRate('truePeak', 1, 0, 1)];
  }

  protected run(inputs: Float32Array[], outputs: Float32Array[], frames: number, parameters: Record<string, Float32Array>): void {
    const ceilingDb = value(parameters, 'ceilingDb');
    const truePeak = value(parameters, 'truePeak') >= 0.5;
    const key = `${ceilingDb}|${truePeak}`;
    if (!this.limiter || key !== this.appliedKey) {
      this.limiter = new LimiterCore(sampleRate, { ceilingDb, truePeak });
      this.appliedKey = key;
    }
    this.limiter.process(inputs, outputs, frames);
  }
}

registerProcessor('mechvox-bitcrusher', BitcrusherProcessor);
registerProcessor('mechvox-flanger', FlangerProcessor);
registerProcessor('mechvox-pitch', PitchShiftProcessor);
registerProcessor('mechvox-vocoder', VocoderProcessor);
registerProcessor('mechvox-limiter', LimiterProcessor);
