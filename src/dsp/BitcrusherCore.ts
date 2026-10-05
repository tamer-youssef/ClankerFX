export interface BitcrusherParams {
  /** Bit depth, 1–16. */
  bits: number;
  /** Target sample rate in Hz; the signal is sample-and-held at this rate. */
  rateHz: number;
}

/**
 * Bitcrusher: sample-and-hold downsampling (aliasing is the point) followed by amplitude quantisation.
 * A phase accumulator lets the target rate be any fraction of the real rate, not just integer divisions.
 */
export class BitcrusherCore {
  private phase: number[] = [];
  private held: number[] = [];

  reset(): void {
    this.phase = [];
    this.held = [];
  }

  process(inputs: readonly Float32Array[], outputs: readonly Float32Array[], frames: number, params: BitcrusherParams, sampleRate: number): void {
    const bits = Math.min(16, Math.max(1, params.bits));
    const levels = Math.pow(2, bits - 1);
    const increment = Math.min(1, Math.max(1e-4, params.rateHz / sampleRate));

    for (let channel = 0; channel < outputs.length; channel++) {
      const input = inputs[channel];
      const output = outputs[channel]!;
      let phase = this.phase[channel] ?? 1;
      let held = this.held[channel] ?? 0;
      for (let i = 0; i < frames; i++) {
        phase += increment;
        if (phase >= 1) {
          phase -= 1;
          // Mid-tread quantiser: zero stays exactly zero, so silence stays silent.
          held = Math.round((input?.[i] ?? 0) * levels) / levels;
        }
        output[i] = held;
      }
      this.phase[channel] = phase;
      this.held[channel] = held;
    }
  }
}
