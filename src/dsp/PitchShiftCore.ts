export interface PitchShiftParams {
  semitones: number;
  /** Grain window length in ms. Longer = smoother but more latency/echo; shorter = more "warble". */
  windowMs: number;
}

const MAX_WINDOW_SECONDS = 0.2;

/** 4-point Hermite (Catmull-Rom) interpolation between y1 and y2 at fraction t. */
function hermite(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

/**
 * Time-domain pitch shifter using two crossfading read taps on a delay line.
 *
 * Each tap reads from `phase·W` samples behind the write head. Moving the tap's delay at (1 − ratio) samples per
 * sample makes the read speed equal `ratio`, which transposes by that factor. A tap's delay sweeps 0→W then wraps,
 * so a second tap half a window apart is crossfaded in with sin² windows (sin²(πφ) + sin²(π(φ+½)) = 1) to hide the jump.
 *
 * Trade-off: formants move with pitch (like varispeed) and a little granular "warble" remains. That suits
 * robot/creature voices, where a size change is wanted anyway.
 */
export class PitchShiftCore {
  private buffers: Float32Array[] = [];
  private mask = 0;
  private writeIndex = 0;
  /** Tap phase in [0,1), shared by all channels so they stay coherent. */
  private phase = 0;

  reset(): void {
    this.buffers.forEach((buffer) => buffer.fill(0));
    this.writeIndex = 0;
    this.phase = 0;
  }

  process(inputs: readonly Float32Array[], outputs: readonly Float32Array[], frames: number, params: PitchShiftParams, sampleRate: number): void {
    if (this.buffers.length === 0) {
      let size = 1;
      while (size < MAX_WINDOW_SECONDS * sampleRate + 8) size <<= 1;
      this.mask = size - 1;
      this.buffers = outputs.map(() => new Float32Array(size));
    }
    const mask = this.mask;
    const ratio = Math.pow(2, Math.min(24, Math.max(-24, params.semitones)) / 12);
    const windowSamples = Math.min(MAX_WINDOW_SECONDS * sampleRate, Math.max(64, (params.windowMs / 1000) * sampleRate));
    const phaseStep = (1 - ratio) / windowSamples;

    for (let i = 0; i < frames; i++) {
      const phaseA = this.phase;
      const phaseB = (phaseA + 0.5) % 1;
      const weightA = Math.sin(Math.PI * phaseA) ** 2;
      const weightB = 1 - weightA;
      // +2 samples keeps the 4-point interpolator's rightmost tap behind the write head.
      const positionA = this.writeIndex - (phaseA * windowSamples + 2);
      const positionB = this.writeIndex - (phaseB * windowSamples + 2);
      const baseA = Math.floor(positionA);
      const baseB = Math.floor(positionB);
      const fractionA = positionA - baseA;
      const fractionB = positionB - baseB;

      for (let channel = 0; channel < outputs.length; channel++) {
        const buffer = this.buffers[channel]!;
        buffer[this.writeIndex & mask] = inputs[channel]?.[i] ?? 0;
        const tapA = hermite(
          buffer[(baseA - 1) & mask]!,
          buffer[baseA & mask]!,
          buffer[(baseA + 1) & mask]!,
          buffer[(baseA + 2) & mask]!,
          fractionA,
        );
        const tapB = hermite(
          buffer[(baseB - 1) & mask]!,
          buffer[baseB & mask]!,
          buffer[(baseB + 1) & mask]!,
          buffer[(baseB + 2) & mask]!,
          fractionB,
        );
        outputs[channel]![i] = tapA * weightA + tapB * weightB;
      }

      this.writeIndex = (this.writeIndex + 1) & mask;
      this.phase += phaseStep;
      this.phase -= Math.floor(this.phase); // wrap into [0,1) for either sign of phaseStep
    }
  }
}
