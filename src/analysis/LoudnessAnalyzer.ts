/** ITU-R BS.1770-4 / EBU R128 integrated loudness. Pure TS, single pass, Float64 accumulation. */

export interface LoudnessResult {
  /** Integrated loudness in LUFS, or null when there is nothing above the −70 LUFS absolute gate. */
  lufs: number | null;
  /** Number of 400 ms blocks that survived both gates (1 for the single ungated block of a very short signal). */
  gatedBlocks: number;
}

const LOUDNESS_OFFSET = -0.691;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const BLOCK_HOPS = 4; // 400 ms blocks advancing in 100 ms hops = 75 % overlap

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * K-weighting stage 1: the BS.1770 head-related high shelf. The published 48 kHz coefficients come from an analogue
 * shelf (f0, gain G, Q) mapped through the bilinear transform; evaluating that mapping for any sample rate (the
 * libebur128 derivation) reproduces them at 48 kHz and keeps the same analogue response elsewhere. K = tan(π f0 / fs)
 * is the pre-warped analogue frequency; Vb = Vh^0.4996… places the shelf's band-gain term.
 */
export function kWeightShelf(sampleRate: number): BiquadCoefficients {
  const f0 = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = Math.pow(10, gainDb / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/**
 * K-weighting stage 2: the RLB high-pass. The numerator stays the unnormalised (1, −2, 1) of the standard, which is
 * why its gain at high frequencies is a0 ≈ +0.04 dB at 48 kHz, exactly as in the reference coefficients.
 */
export function kWeightHighPass(sampleRate: number): BiquadCoefficients {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}

function blockLufs(energy: number): number {
  return energy > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(energy) : -Infinity;
}

function lufsToEnergy(lufs: number): number {
  return Math.pow(10, (lufs - LOUDNESS_OFFSET) / 10);
}

export function measureLoudness(channels: readonly Float32Array[], sampleRate: number): LoudnessResult {
  const length = channels.reduce((min, channel) => Math.min(min, channel.length), Infinity);
  if (channels.length === 0 || !(length > 0) || !(sampleRate > 0)) return { lufs: null, gatedBlocks: 0 };

  // The app plays mono through both speakers, so one channel counts twice (dual mono).
  const channelWeight = channels.length === 1 ? 2 : 1;
  const hop = Math.max(1, Math.round(0.1 * sampleRate));
  const hopCount = Math.floor(length / hop);
  const hopEnergy = new Float64Array(hopCount);
  let totalEnergy = 0;

  const shelf = kWeightShelf(sampleRate);
  const highPass = kWeightHighPass(sampleRate);
  for (const channel of channels) {
    let s1 = 0, s2 = 0, h1 = 0, h2 = 0; // transposed direct-form II states of the two stages
    let index = 0;
    for (let h = 0; h <= hopCount; h++) {
      const end = h < hopCount ? index + hop : length;
      let sum = 0;
      for (; index < end; index++) {
        const x = channel[index] as number;
        const y = shelf.b0 * x + s1;
        s1 = shelf.b1 * x - shelf.a1 * y + s2;
        s2 = shelf.b2 * x - shelf.a2 * y;
        const z = highPass.b0 * y + h1;
        h1 = highPass.b1 * y - highPass.a1 * z + h2;
        h2 = highPass.b2 * y - highPass.a2 * z;
        sum += z * z;
      }
      if (h < hopCount) hopEnergy[h] = (hopEnergy[h] as number) + sum * channelWeight;
      totalEnergy += sum * channelWeight;
    }
  }

  const absoluteEnergy = lufsToEnergy(ABSOLUTE_GATE_LUFS);
  const blockCount = hopCount - BLOCK_HOPS + 1;
  if (blockCount < 1) {
    // Shorter than one 400 ms block: measure everything as a single ungated block.
    const energy = totalEnergy / length;
    return energy > absoluteEnergy ? { lufs: blockLufs(energy), gatedBlocks: 1 } : { lufs: null, gatedBlocks: 0 };
  }

  const blockEnergies = new Float64Array(blockCount);
  let window = 0;
  for (let h = 0; h < BLOCK_HOPS - 1; h++) window += hopEnergy[h] as number;
  for (let b = 0; b < blockCount; b++) {
    window += hopEnergy[b + BLOCK_HOPS - 1] as number;
    blockEnergies[b] = window / (hop * BLOCK_HOPS);
    window -= hopEnergy[b] as number;
  }

  let absSum = 0;
  let absCount = 0;
  for (let b = 0; b < blockCount; b++) {
    const e = blockEnergies[b] as number;
    if (e > absoluteEnergy) {
      absSum += e;
      absCount++;
    }
  }
  if (absCount === 0) return { lufs: null, gatedBlocks: 0 };

  const relativeEnergy = lufsToEnergy(blockLufs(absSum / absCount) + RELATIVE_GATE_LU);
  const threshold = Math.max(relativeEnergy, absoluteEnergy);
  let sum = 0;
  let count = 0;
  for (let b = 0; b < blockCount; b++) {
    const e = blockEnergies[b] as number;
    if (e > threshold) {
      sum += e;
      count++;
    }
  }
  return count === 0 ? { lufs: null, gatedBlocks: 0 } : { lufs: blockLufs(sum / count), gatedBlocks: count };
}
