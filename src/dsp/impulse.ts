import { createRandom } from './random';

/**
 * Synthetic reverb impulse response: decaying noise that also gets darker as it decays
 * (high frequencies die first in real rooms). Fully deterministic for a given seed.
 */
export function generateReverbImpulse(sampleRate: number, decaySeconds: number, toneHz: number, seed = 1): Float32Array[] {
  const length = Math.max(1, Math.floor(sampleRate * decaySeconds));
  const fadeInSamples = Math.max(1, Math.floor(sampleRate * 0.002));
  // Amplitude falls 60 dB over `decaySeconds` (RT60): exp(-k·t) = 0.001 at t = decay → k = ln(1000).
  const decayRate = Math.log(1000) / decaySeconds;

  return [seed, seed + 7919].map((channelSeed) => {
    const random = createRandom(channelSeed);
    const out = new Float32Array(length);
    let lowpassState = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const progress = i / length;
      // One-pole lowpass whose cutoff slides from toneHz down to 30% of it.
      const cutoff = toneHz * (1 - 0.7 * progress);
      const coefficient = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      const white = random() * 2 - 1;
      lowpassState = (1 - coefficient) * white + coefficient * lowpassState;
      const fadeIn = Math.min(1, (i + 1) / fadeInSamples);
      out[i] = lowpassState * Math.exp(-decayRate * t) * fadeIn;
    }
    return out;
  });
}
