import { createRandom } from './random';

export type NoiseKind = 'white' | 'pink' | 'crackle';

/**
 * Generates `channels` independent noise channels, each normalised to unit RMS so the Noise effect's level
 * control means the same thing for every kind. Deterministic for a given seed.
 */
export function generateNoise(kind: NoiseKind, length: number, channels: number, seed = 1): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) => {
    const random = createRandom(seed + channel * 104729);
    const out = new Float32Array(length);

    if (kind === 'white') {
      for (let i = 0; i < length; i++) out[i] = random() * 2 - 1;
    } else if (kind === 'pink') {
      // Paul Kellet's economy pink-noise filter (−3 dB/octave).
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < length; i++) {
        const white = random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
      }
    } else {
      // Radio static: sparse random pops with a short decay over a faint hiss.
      let pop = 0;
      for (let i = 0; i < length; i++) {
        if (random() < 0.0004) pop = (random() * 2 - 1) * (0.4 + random() * 0.6);
        out[i] = pop + (random() * 2 - 1) * 0.04;
        pop *= 0.985;
      }
    }

    let sumSquares = 0;
    for (let i = 0; i < length; i++) sumSquares += (out[i] as number) ** 2;
    const rms = Math.sqrt(sumSquares / Math.max(1, length));
    if (rms > 0) for (let i = 0; i < length; i++) out[i] = (out[i] as number) / rms;
    return out;
  });
}
