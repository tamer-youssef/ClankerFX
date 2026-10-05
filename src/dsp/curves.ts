export type DistortionShape = 'soft' | 'hard' | 'fold';

/**
 * The shaper curve covers the WaveShaper input range [-1, 1], which we map to signal levels of
 * [-SHAPER_RANGE, SHAPER_RANGE]. The pre-gain is therefore `drive / SHAPER_RANGE`, so a drive of 40 dB
 * (×100) still lands inside the table instead of being hard-clipped by the node itself.
 */
export const SHAPER_RANGE = 16;
const CURVE_SIZE = 8192;

export function shapeSample(shape: DistortionShape, v: number): number {
  switch (shape) {
    case 'soft':
      return Math.tanh(v);
    case 'hard':
      return Math.max(-1, Math.min(1, v));
    case 'fold':
      // Sine wavefolder: levels beyond ±1 fold back instead of clipping, adding bright odd harmonics.
      return Math.sin((v * Math.PI) / 2);
  }
}

export function createShaperCurve(shape: DistortionShape): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_SIZE);
  for (let i = 0; i < CURVE_SIZE; i++) {
    const input = (i / (CURVE_SIZE - 1)) * 2 - 1;
    curve[i] = shapeSample(shape, input * SHAPER_RANGE);
  }
  return curve;
}
