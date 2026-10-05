/**
 * Windowed-sinc sample-rate conversion.
 *
 * The kernel is a Kaiser-windowed sinc (100 dB design attenuation) whose centre of transition sits at 0.95 of the
 * LOWER Nyquist, with a 0.1 × Nyquist transition band: flat to 0.9 × Nyquist, fully stopped from 1.0 × Nyquist.
 * When down-sampling the cutoff scales with the output rate, so nothing above the new Nyquist can alias back.
 *
 * Implementation: every integer rate pair is rational (L/M after dividing by the gcd), so there are only L distinct
 * fractional positions. For those, one kernel row per phase is precomputed (polyphase). When L is too large for a
 * table (e.g. 44100 → 44101), 1024 phases are tabulated and adjacent rows are linearly interpolated (error < -110 dB).
 * Samples outside the signal are treated as zeros.
 */

const STOPBAND_DB = 100;
/** Fraction of the lower Nyquist where the transition band is centred, and its width. */
const CUTOFF = 0.95;
const TRANSITION = 0.1;
const MAX_EXACT_TABLE = 1_500_000;
const INTERP_PHASES = 1024;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 200; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

interface Kernel {
  /** Taps per phase row; the row for fractional offset f covers inputs n0+1-half … n0+half. */
  taps: number;
  half: number;
  /** rows × taps coefficients; each row sums to exactly 1 so DC passes unchanged. */
  table: Float32Array;
}

/** Half the tap count (Kaiser length estimate for the transition width, in input samples). */
function kernelHalf(ratioOutOverIn: number): number {
  const transition = 0.5 * Math.min(1, ratioOutOverIn) * TRANSITION; // cycles per input sample
  return Math.max(8, Math.ceil((STOPBAND_DB - 7.95) / (14.36 * transition) / 2)) | 0;
}

function buildKernel(rows: number, phases: number, ratioOutOverIn: number): Kernel {
  const cutoff = 0.5 * Math.min(1, ratioOutOverIn) * CUTOFF; // cycles per input sample
  const beta = 0.1102 * (STOPBAND_DB - 8.7);
  const half = kernelHalf(ratioOutOverIn);
  const taps = 2 * half;
  const table = new Float32Array(rows * taps);
  const norm = 1 / besselI0(beta);
  const row = new Float64Array(taps);
  for (let p = 0; p < rows; p++) {
    const frac = p / phases;
    let sum = 0;
    for (let i = 0; i < taps; i++) {
      const tau = frac - (i + 1 - half);
      const r = tau / half;
      const w = Math.abs(r) >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - r * r)) * norm;
      const v = 2 * cutoff * sinc(2 * cutoff * tau) * w;
      row[i] = v;
      sum += v;
    }
    for (let i = 0; i < taps; i++) table[p * taps + i] = (row[i] as number) / sum;
  }
  return { taps, half, table };
}

function convolveExact(input: Float32Array, outLength: number, l: number, m: number, kernel: Kernel): Float32Array {
  const { taps, half, table } = kernel;
  const out = new Float32Array(outLength);
  const n = input.length;
  // `| 0` keeps these small integers (not doubles) so V8 uses them as array indices without conversion.
  const step = Math.floor(m / l) | 0;
  const rem = (m % l) | 0;
  let n0 = 0;
  let phase = 0;
  for (let j = 0; j < outLength; j++) {
    const base = n0 + 1 - half;
    const lo = base < 0 ? 0 : base;
    const hi = base + taps > n ? n : base + taps;
    const rowOffset = phase * taps - base;
    let acc = 0;
    for (let i = lo; i < hi; i++) acc += (input[i] as number) * (table[rowOffset + i] as number);
    out[j] = acc;
    n0 += step;
    phase += rem;
    if (phase >= l) {
      phase -= l;
      n0++;
    }
  }
  return out;
}

function convolveInterpolated(input: Float32Array, outLength: number, fromRate: number, toRate: number, kernel: Kernel): Float32Array {
  const { taps, half, table } = kernel;
  const out = new Float32Array(outLength);
  const n = input.length;
  for (let j = 0; j < outLength; j++) {
    const pos = j * fromRate;
    const n0 = Math.floor(pos / toRate);
    const fr = ((pos - n0 * toRate) / toRate) * INTERP_PHASES;
    const p = Math.floor(fr);
    const a = fr - p;
    const base = n0 + 1 - half;
    const lo = base < 0 ? 0 : base;
    const hi = base + taps > n ? n : base + taps;
    const r0 = p * taps - base;
    const r1 = r0 + taps;
    let s0 = 0;
    let s1 = 0;
    for (let i = lo; i < hi; i++) {
      const x = input[i] as number;
      s0 += x * (table[r0 + i] as number);
      s1 += x * (table[r1 + i] as number);
    }
    out[j] = s0 + a * (s1 - s0);
  }
  return out;
}

/** Converts every channel from `fromRate` to `toRate` (Hz). Output length is round(length · toRate / fromRate). */
export function resampleChannels(channels: readonly Float32Array[], fromRate: number, toRate: number): Float32Array[] {
  if (!(fromRate > 0) || !(toRate > 0) || !Number.isFinite(fromRate) || !Number.isFinite(toRate)) {
    throw new Error(`Invalid sample rates: ${fromRate} → ${toRate}.`);
  }
  if (fromRate === toRate) return channels.map((c) => new Float32Array(c));
  if (channels.length === 0) return [];

  const integral = Number.isInteger(fromRate) && Number.isInteger(toRate);
  const g = integral ? gcd(fromRate, toRate) : 1;
  const m = fromRate / g;
  const l = toRate / g;
  const ratio = toRate / fromRate;

  const exact = integral && l * 2 * kernelHalf(ratio) <= MAX_EXACT_TABLE;
  const kernel = exact ? buildKernel(l, l, ratio) : buildKernel(INTERP_PHASES + 1, INTERP_PHASES, ratio);

  return channels.map((ch) => {
    const outLength = Math.round(ch.length * ratio);
    return exact ? convolveExact(ch, outLength, l, m, kernel) : convolveInterpolated(ch, outLength, fromRate, toRate, kernel);
  });
}
