export interface FlangerParams {
  rateHz: number;
  /** Centre delay in ms. */
  centerMs: number;
  /** 0–1: how far the delay sweeps around the centre, as a fraction of the centre delay. */
  depth: number;
  /** −1..1 (capped lower by the caller). Positive = metallic resonance, negative = hollow. */
  feedback: number;
}

const MAX_DELAY_SECONDS = 0.025;
const STEREO_LFO_OFFSET = 0.25; // right channel's LFO runs 90° behind the left

/**
 * Flanger delay line with a swept fractional delay and feedback. Returns only the delayed (wet) signal;
 * the effect slot adds the dry signal, which together form the comb filter.
 *
 * It runs per-sample in a worklet because the delays involved (0.3–10 ms) are shorter than one Web Audio render
 * quantum, which native DelayNode feedback loops cannot do.
 */
export class FlangerCore {
  private buffers: Float32Array[] = [];
  private writeIndex = 0;
  private lfoPhase = 0;
  private length = 0;

  reset(): void {
    this.buffers.forEach((buffer) => buffer.fill(0));
    this.writeIndex = 0;
    this.lfoPhase = 0;
  }

  process(inputs: readonly Float32Array[], outputs: readonly Float32Array[], frames: number, params: FlangerParams, sampleRate: number): void {
    if (this.length === 0) {
      this.length = Math.ceil(MAX_DELAY_SECONDS * sampleRate) + 4;
      this.buffers = outputs.map(() => new Float32Array(this.length));
    }
    const length = this.length;
    const centerSamples = (params.centerMs / 1000) * sampleRate;
    const depth = Math.min(0.95, Math.max(0, params.depth));
    const feedback = Math.min(0.9, Math.max(-0.9, params.feedback));
    const phaseIncrement = params.rateHz / sampleRate;

    for (let i = 0; i < frames; i++) {
      for (let channel = 0; channel < outputs.length; channel++) {
        const buffer = this.buffers[channel]!;
        const phase = this.lfoPhase + channel * STEREO_LFO_OFFSET;
        const lfo = Math.sin(2 * Math.PI * phase);
        // Delay of at least 1 sample so we never read the slot about to be written.
        const delay = Math.min(length - 3, Math.max(1, centerSamples * (1 + depth * lfo)));

        const readPosition = this.writeIndex - delay;
        const base = Math.floor(readPosition);
        const fraction = readPosition - base;
        const a = buffer[(base + length) % length]!;
        const b = buffer[(base + 1 + length) % length]!;
        const wet = a + (b - a) * fraction;

        const x = inputs[channel]?.[i] ?? 0;
        let write = x + feedback * wet;
        // Guard against runaway and denormals; neither can occur with |feedback| < 1 but this makes it unconditional.
        if (write > 4) write = 4;
        else if (write < -4) write = -4;
        else if (Math.abs(write) < 1e-20) write = 0;
        buffer[this.writeIndex] = write;

        outputs[channel]![i] = wet;
      }
      this.writeIndex = (this.writeIndex + 1) % length;
      this.lfoPhase += phaseIncrement;
      if (this.lfoPhase >= 1) this.lfoPhase -= 1;
    }
  }
}
