/** Helpers for numerical DSP tests (Node only). */
export const SAMPLE_RATE = 44100;

export function sine(frequency: number, seconds: number, amplitude = 0.5, sampleRate = SAMPLE_RATE): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  return Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
}

export function rms(data: Float32Array, from = 0, to = data.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (data[i] as number) ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Goertzel: signal power at a single frequency. */
export function powerAt(data: Float32Array, frequency: number, sampleRate = SAMPLE_RATE): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < data.length; i++) {
    const s = (data[i] as number) + coefficient * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (s1 * s1 + s2 * s2 - coefficient * s1 * s2) / data.length ** 2;
}

/** Frequency of the strongest component between fMin and fMax (1 Hz resolution). */
export function dominantFrequency(data: Float32Array, fMin: number, fMax: number, sampleRate = SAMPLE_RATE): number {
  let best = fMin;
  let bestPower = -1;
  for (let f = fMin; f <= fMax; f += 1) {
    const power = powerAt(data, f, sampleRate);
    if (power > bestPower) {
      bestPower = power;
      best = f;
    }
  }
  return best;
}

/** Runs a core over a mono signal in 128-sample blocks, like a worklet would, returning left-channel output. */
export function runInBlocks(
  input: Float32Array,
  channels: number,
  step: (inputs: Float32Array[], outputs: Float32Array[], frames: number) => void,
): Float32Array[] {
  const outputs = Array.from({ length: channels }, () => new Float32Array(input.length));
  for (let start = 0; start < input.length; start += 128) {
    const frames = Math.min(128, input.length - start);
    const inBlock = Array.from({ length: channels }, () => input.subarray(start, start + frames));
    const outBlock = outputs.map((out) => out.subarray(start, start + frames));
    step(inBlock, outBlock, frames);
  }
  return outputs;
}

/**
 * Synthetic speech-like signal: a glottal saw at ~120 Hz driven through three moving formant resonators (a vowel
 * sequence), with syllabic amplitude, plus noise bursts that stand in for fricatives. Not real speech, but it has the
 * time-varying spectral structure a vocoder must preserve.
 */
export function syntheticSpeech(seconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  // F1/F2/F3 targets (Hz) for /a/, /i/, /u/, /e/
  const vowels = [
    [730, 1090, 2440],
    [270, 2290, 3010],
    [300, 870, 2240],
    [530, 1840, 2480],
  ];
  const formants = [0, 1, 2].map(() => [new (class {
    z1 = 0; z2 = 0; b0 = 0; b2 = 0; a1 = 0; a2 = 0;
    set(f: number, q: number) {
      const w0 = (2 * Math.PI * f) / sampleRate; const alpha = Math.sin(w0) / (2 * q); const a0 = 1 + alpha;
      this.b0 = alpha / a0; this.b2 = -alpha / a0; this.a1 = (-2 * Math.cos(w0)) / a0; this.a2 = (1 - alpha) / a0;
    }
    run(x: number) { const y = this.b0 * x + this.z1; this.z1 = -this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  })()]);
  let seed = 12345;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const syllable = Math.floor(t / 0.22); // 220 ms per vowel
    const current = vowels[syllable % 4]!;
    if (i % 32 === 0) formants.forEach(([f], k) => f!.set(current[k]!, 8));
    const f0 = 120 + 15 * Math.sin(2 * Math.PI * 0.8 * t);
    phase = (phase + f0 / sampleRate) % 1;
    const glottal = 2 * phase - 1;
    const syllableEnv = Math.pow(Math.sin(Math.PI * ((t / 0.22) % 1)), 0.7);
    let voiced = 0;
    formants.forEach(([f], k) => (voiced += f!.run(glottal) * [1, 0.7, 0.4][k]!));
    // Fricative burst in the last quarter of every 4th syllable
    const fric = syllable % 4 === 3 && (t / 0.22) % 1 > 0.7 ? rand() * 0.25 : 0;
    out[i] = (voiced * syllableEnv * 0.5 + fric) * 0.8;
  }
  return out;
}
