import { Biquad } from './biquad';
import { createRandom } from './random';

export type CarrierWave = 'saw' | 'square' | 'pulse' | 'noise';

export interface VocoderParams {
  /** Number of filter bands (8–32). */
  bands: number;
  lowHz: number;
  highHz: number;
  /** Pitch of the synthetic carrier, i.e. the robot's "note". */
  carrierHz: number;
  carrier: CarrierWave;
  attackMs: number;
  releaseMs: number;
  /** Shifts the synthesis bands relative to the analysis bands (1 = unchanged, 0.5 = deeper, 2 = smaller/brighter). */
  formantShift: number;
  /** 0–1: noise added to the carrier of high bands so consonants (s, f, t) stay intelligible. */
  hiss: number;
  /** Envelopes below this level (dBFS) are treated as silence so room noise does not turn into buzz. */
  gateDb: number;
}

export const MAX_BANDS = 32;
/** Bands at or above this centre frequency receive the noisy carrier. */
const HISS_FROM_HZ = 2500;
/** First-order pre-emphasis on the modulator lifts consonants, which carry intelligibility but little energy. */
const PRE_EMPHASIS = 0.7;
/** Empirical make-up so a typical speech signal comes out near its input level (see VocoderCore tests). */
export const OUTPUT_GAIN = 13;

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * Channel vocoder. The (mono) modulator, normally a voice, is split into N log-spaced bands and the level of each
 * band is tracked by an envelope follower with separate attack and release. A synthetic carrier (saw / square / pulse /
 * noise) is split by an identical filterbank and each carrier band is scaled by the matching modulator envelope, then
 * summed. The result has the carrier's pitch and timbre but the voice's spectral shape over time, so speech stays
 * intelligible while sounding robotic.
 */
export class VocoderCore {
  private analysis: [Biquad, Biquad][] = [];
  private synthesis: [Biquad, Biquad][] = [];
  private envelopes = new Float64Array(MAX_BANDS);
  private bandCenters = new Float64Array(MAX_BANDS);
  private filterKey = '';
  private activeBands = 0;
  private carrierPhase = 0;
  private previousInput = 0;
  private random = createRandom(0x5eed);

  /** Clears all filter/envelope state and restarts the carrier, so the output depends only on audio from now on. */
  reset(): void {
    for (const [a, b] of [...this.analysis, ...this.synthesis]) {
      a.reset();
      b.reset();
    }
    this.envelopes.fill(0);
    this.carrierPhase = 0;
    this.previousInput = 0;
    this.random = createRandom(0x5eed);
  }

  process(inputs: readonly Float32Array[], outputs: readonly Float32Array[], frames: number, params: VocoderParams, sampleRate: number): void {
    this.configure(params, sampleRate);
    const bands = this.activeBands;
    const attack = 1 - Math.exp(-1 / (Math.max(0.1, params.attackMs) * 0.001 * sampleRate));
    const release = 1 - Math.exp(-1 / (Math.max(1, params.releaseMs) * 0.001 * sampleRate));
    const gate = Math.pow(10, params.gateDb / 20);
    const hiss = Math.min(1, Math.max(0, params.hiss));
    const phaseIncrement = Math.min(0.45, Math.max(1e-4, params.carrierHz / sampleRate));

    for (let i = 0; i < frames; i++) {
      // Mono modulator with pre-emphasis.
      let sum = 0;
      for (const channel of inputs) sum += channel[i] ?? 0;
      const mono = inputs.length > 0 ? sum / inputs.length : 0;
      const emphasised = mono - PRE_EMPHASIS * this.previousInput;
      this.previousInput = mono;

      const voiced = this.carrierSample(params.carrier, phaseIncrement);
      const noisy = voiced + hiss * (this.random() * 2 - 1) * 1.732;

      let out = 0;
      for (let band = 0; band < bands; band++) {
        const [analysisA, analysisB] = this.analysis[band]!;
        const level = Math.abs(analysisB.process(analysisA.process(emphasised)));
        const previous = this.envelopes[band]!;
        const envelope = previous + (level > previous ? attack : release) * (level - previous);
        this.envelopes[band] = envelope;

        const [synthesisA, synthesisB] = this.synthesis[band]!;
        const carrier = this.bandCenters[band]! >= HISS_FROM_HZ ? noisy : voiced;
        const band_out = synthesisB.process(synthesisA.process(carrier));
        out += band_out * (envelope > gate ? envelope - gate : 0);
      }
      out *= OUTPUT_GAIN;
      for (const output of outputs) output[i] = out;
    }
  }

  /** Rebuilds filter coefficients only when a relevant parameter or the sample rate changed. */
  private configure(params: VocoderParams, sampleRate: number): void {
    const bands = Math.min(MAX_BANDS, Math.max(4, Math.round(params.bands)));
    const low = Math.max(40, Math.min(params.lowHz, params.highHz * 0.5));
    const high = Math.min(sampleRate * 0.45, Math.max(params.highHz, low * 2));
    const shift = Math.min(2, Math.max(0.5, params.formantShift));
    const key = `${bands}|${low}|${high}|${shift}|${sampleRate}`;
    if (key === this.filterKey) return;

    const grow = bands !== this.activeBands;
    this.filterKey = key;
    this.activeBands = bands;
    if (grow) {
      this.analysis = Array.from({ length: bands }, () => [new Biquad(), new Biquad()]);
      this.synthesis = Array.from({ length: bands }, () => [new Biquad(), new Biquad()]);
      this.envelopes.fill(0);
    }

    // Log-spaced centres. Two cascaded band-passes narrow each other by ~0.64, so Q is lowered to compensate and
    // adjacent bands still cross near -3 dB (a flat summed response).
    const ratio = Math.pow(high / low, 1 / bands);
    const nominalQ = 1 / (Math.sqrt(ratio) - 1 / Math.sqrt(ratio));
    const q = 0.64 * nominalQ;
    for (let band = 0; band < bands; band++) {
      const center = low * Math.pow(ratio, band + 0.5);
      this.bandCenters[band] = center;
      for (const filter of this.analysis[band]!) filter.setBandpass(center, q, sampleRate);
      for (const filter of this.synthesis[band]!) filter.setBandpass(center * shift, q, sampleRate);
    }
  }

  /** One sample of the carrier, normalised to roughly unit RMS. PolyBLEP keeps the edges band-limited (no aliasing). */
  private carrierSample(wave: CarrierWave, increment: number): number {
    const t = this.carrierPhase;
    this.carrierPhase += increment;
    if (this.carrierPhase >= 1) this.carrierPhase -= 1;

    switch (wave) {
      case 'saw':
        return (2 * t - 1 - polyBlep(t, increment)) * 1.732;
      case 'square':
        return (t < 0.5 ? 1 : -1) + polyBlep(t, increment) - polyBlep((t + 0.5) % 1, increment);
      case 'pulse': {
        const duty = 0.25;
        const value = (t < duty ? 1 : -1) + polyBlep(t, increment) - polyBlep((t + 1 - duty) % 1, increment);
        return (value - (2 * duty - 1)) / 0.866; // remove DC, normalise RMS
      }
      case 'noise':
        return (this.random() * 2 - 1) * 1.732;
    }
  }
}
