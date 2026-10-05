import { describe, expect, it } from 'vitest';
import { Biquad } from './biquad';
import { BitcrusherCore } from './BitcrusherCore';
import { FlangerCore } from './FlangerCore';
import { PitchShiftCore } from './PitchShiftCore';
import { createRandom } from './random';
import { SAMPLE_RATE, dominantFrequency, powerAt, rms, runInBlocks, sine, syntheticSpeech } from './testSignals';
import { VocoderCore, type VocoderParams } from './VocoderCore';

const noise = (seconds: number, amplitude = 0.3, seed = 1) => {
  const random = createRandom(seed);
  return Float32Array.from({ length: Math.floor(seconds * SAMPLE_RATE) }, () => (random() * 2 - 1) * amplitude);
};

describe('Biquad band-pass', () => {
  const measure = (frequency: number) => {
    const filter = new Biquad();
    filter.setBandpass(1000, 4, SAMPLE_RATE);
    const input = sine(frequency, 0.5, 1);
    const out = input.map((x) => filter.process(x));
    return rms(out, out.length / 2) / rms(input, input.length / 2);
  };
  it('passes the centre frequency at unity and rejects distant ones', () => {
    expect(measure(1000)).toBeCloseTo(1, 2);
    expect(measure(250)).toBeLessThan(0.15);
    expect(measure(4000)).toBeLessThan(0.15);
  });
});

describe('BitcrusherCore', () => {
  const crush = (input: Float32Array, bits: number, rateHz: number) => {
    const core = new BitcrusherCore();
    return runInBlocks(input, 1, (i, o, n) => core.process(i, o, n, { bits, rateHz }, SAMPLE_RATE))[0]!;
  };

  it('1-bit output only takes values {-1, 0, 1}', () => {
    const out = crush(sine(300, 0.1, 0.9), 1, SAMPLE_RATE);
    for (const value of out) expect([-1, 0, 1]).toContain(value);
  });

  it('quantises to 2^(bits-1) levels per polarity', () => {
    const out = crush(sine(300, 0.2, 0.95), 4, SAMPLE_RATE);
    const levels = new Set(Array.from(out, (v) => Math.round(v * 8)));
    expect(levels.size).toBeLessThanOrEqual(17);
    for (const v of out) expect(Math.abs(v * 8 - Math.round(v * 8))).toBeLessThan(1e-6);
  });

  it('holds samples when the target rate is lower', () => {
    const out = crush(sine(1000, 0.1, 0.8), 16, SAMPLE_RATE / 8);
    let changes = 0;
    for (let i = 1; i < out.length; i++) if (out[i] !== out[i - 1]) changes++;
    expect(changes).toBeLessThan(out.length / 8 + 2);
    expect(changes).toBeGreaterThan(out.length / 10);
  });

  it('is near-transparent at 16 bits and full rate, and keeps silence silent', () => {
    const input = sine(440, 0.1, 0.5);
    const out = crush(input, 16, SAMPLE_RATE);
    let maxError = 0;
    for (let i = 1; i < input.length; i++) maxError = Math.max(maxError, Math.abs(out[i]! - input[i]!));
    expect(maxError).toBeLessThan(1e-3);
    expect(rms(crush(new Float32Array(1000), 4, 8000))).toBe(0);
  });

  it('never exceeds the input range', () => {
    const out = crush(noise(0.2, 1), 3, 4000);
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});

describe('FlangerCore', () => {
  const run = (input: Float32Array, params: Parameters<FlangerCore['process']>[3]) => {
    const core = new FlangerCore();
    return runInBlocks(input, 2, (i, o, n) => core.process(i, o, n, params, SAMPLE_RATE))[0]!;
  };

  it('delays an impulse by the centre delay when depth is zero', () => {
    const impulse = new Float32Array(2000);
    impulse[0] = 1;
    const out = run(impulse, { rateHz: 0.5, centerMs: 2, depth: 0, feedback: 0 });
    const expected = Math.round(0.002 * SAMPLE_RATE);
    let peakAt = 0;
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]!) > Math.abs(out[peakAt]!)) peakAt = i;
    expect(Math.abs(peakAt - expected)).toBeLessThanOrEqual(1);
  });

  it('forms a comb filter with notches at odd multiples of 1/(2·delay) when added to the dry signal', () => {
    const input = noise(1, 0.3);
    const wet = run(input, { rateHz: 0.1, centerMs: 1, depth: 0, feedback: 0 });
    const summed = input.map((x, i) => x + wet[i]!);
    // delay = 1 ms → first notch at 500 Hz, first peak at 1000 Hz
    expect(powerAt(summed, 500)).toBeLessThan(powerAt(summed, 1000) * 0.05);
  });

  it('stays bounded at maximum feedback with loud noise input', () => {
    const out = run(noise(3, 1), { rateHz: 2, centerMs: 3, depth: 0.9, feedback: 5 });
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(40);
    }
  });

  it('decays after the input stops (feedback < 1)', () => {
    const input = new Float32Array(SAMPLE_RATE * 3);
    input.set(noise(0.2, 0.5));
    const out = run(input, { rateHz: 0.3, centerMs: 4, depth: 0.5, feedback: 0.85 });
    expect(rms(out, SAMPLE_RATE * 2.5)).toBeLessThan(rms(out, 0, SAMPLE_RATE * 0.2) * 0.01);
  });
});

describe('PitchShiftCore', () => {
  const shift = (input: Float32Array, semitones: number, windowMs = 60) => {
    const core = new PitchShiftCore();
    return runInBlocks(input, 2, (i, o, n) => core.process(i, o, n, { semitones, windowMs }, SAMPLE_RATE))[0]!;
  };
  const tail = (data: Float32Array) => data.slice(Math.floor(data.length * 0.4));

  /** Mean frequency from rising zero crossings: robust to the symmetric sidebands the crossfading taps create. */
  const meanFrequency = (data: Float32Array) => {
    let crossings = 0;
    for (let i = 1; i < data.length; i++) if (data[i - 1]! <= 0 && data[i]! > 0) crossings++;
    return (crossings / data.length) * SAMPLE_RATE;
  };

  it.each([
    [12, 880],
    [7, 659.26],
    [-12, 220],
    [-5, 329.63],
  ])('shifts a 440 Hz tone by %i semitones to ≈%f Hz (long window: <0.5% error)', (semitones, expected) => {
    const out = tail(shift(sine(440, 1.5), semitones, 100));
    expect(Math.abs(meanFrequency(out) - expected) / expected).toBeLessThan(0.005);
  });

  it.each([12, 7, -5, -12])('stays within 2.5%% of the target pitch at the default 60 ms window (%i st)', (semitones) => {
    const expected = 440 * Math.pow(2, semitones / 12);
    const out = tail(shift(sine(440, 1.5), semitones, 60));
    expect(Math.abs(meanFrequency(out) - expected) / expected).toBeLessThan(0.025);
  });

  it('puts the strongest spectral component within a semitone of the target', () => {
    const out = tail(shift(sine(440, 1.5), -12, 60));
    const found = dominantFrequency(out, 180, 270);
    expect(Math.abs(12 * Math.log2(found / 220))).toBeLessThan(1);
  });

  it('is a clean fixed delay at 0 semitones (no warble)', () => {
    const input = sine(440, 1);
    const out = tail(shift(input, 0));
    expect(rms(out) / rms(tail(input))).toBeCloseTo(1, 1);
    expect(dominantFrequency(out, 400, 480)).toBe(440);
  });

  it('keeps level within ±3 dB when shifting', () => {
    const input = noise(1.5, 0.3);
    for (const semitones of [-12, -5, 5, 12]) {
      const ratio = rms(tail(shift(input, semitones))) / rms(tail(input));
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeLessThan(1.4);
    }
  });

  it('stays finite and bounded at the extremes', () => {
    for (const semitones of [-24, 24]) {
      const out = shift(noise(1, 1), semitones, 20);
      for (const v of out) expect(Math.abs(v)).toBeLessThan(2);
    }
  });
});

/** Smoothed amplitude envelope of the signal inside one band, sampled every 10 ms. */
function bandEnvelope(signal: Float32Array, centerHz: number): Float32Array {
  const filter = new Biquad();
  filter.setBandpass(centerHz, 3, SAMPLE_RATE);
  const hop = 441;
  const out = new Float32Array(Math.floor(signal.length / hop));
  const smoothing = 1 - Math.exp((-2 * Math.PI * 30) / SAMPLE_RATE);
  let envelope = 0;
  for (let i = 0; i < out.length * hop; i++) {
    envelope += smoothing * (Math.abs(filter.process(signal[i]!)) - envelope);
    if (i % hop === 0) out[i / hop] = envelope;
  }
  return out;
}

function pearson(a: Float32Array, b: Float32Array): number {
  const skip = 5; // let the smoothers settle
  const n = Math.min(a.length, b.length) - skip;
  let meanA = 0;
  let meanB = 0;
  for (let i = skip; i < skip + n; i++) {
    meanA += a[i]! / n;
    meanB += b[i]! / n;
  }
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = skip; i < skip + n; i++) {
    ab += (a[i]! - meanA) * (b[i]! - meanB);
    aa += (a[i]! - meanA) ** 2;
    bb += (b[i]! - meanB) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

describe('VocoderCore on speech-like input', () => {
  const params: VocoderParams = {
    bands: 16, lowHz: 120, highHz: 7500, carrierHz: 110, carrier: 'saw',
    attackMs: 4, releaseMs: 40, formantShift: 1, hiss: 0.35, gateDb: -70,
  };
  const speech = syntheticSpeech(3);

  it.each(['saw', 'square', 'pulse', 'noise'] as const)(
    '%s carrier keeps each band tracking the speech (intelligibility proxy) and a usable level',
    (carrier) => {
      const core = new VocoderCore();
      const out = runInBlocks(speech, 2, (i, o, n) => core.process(i, o, n, { ...params, carrier }, SAMPLE_RATE))[0]!;

      // Band envelopes of the output must follow the same band of the input far more than the other bands.
      const centers = [350, 700, 1400, 2800, 5000];
      const input = centers.map((c) => bandEnvelope(speech, c));
      const output = centers.map((c) => bandEnvelope(out, c));
      let matched = 0;
      let mismatched = 0;
      let mismatchedCount = 0;
      centers.forEach((_, i) =>
        centers.forEach((__, j) => {
          const c = pearson(input[i]!, output[j]!);
          if (i === j) matched += c / centers.length;
          else {
            mismatched += c;
            mismatchedCount++;
          }
        }),
      );
      expect(matched).toBeGreaterThan(0.65);
      expect(matched - mismatched / mismatchedCount).toBeGreaterThan(0.3);

      // Output level within about ±5 dB of the input, so Amount changes do not cause big jumps in loudness.
      const ratio = rms(out) / rms(speech);
      expect(ratio).toBeGreaterThan(0.56);
      expect(ratio).toBeLessThan(1.8);
    },
  );
});

describe('VocoderCore', () => {
  const baseParams: VocoderParams = {
    bands: 16,
    lowHz: 120,
    highHz: 7500,
    carrierHz: 110,
    carrier: 'saw',
    attackMs: 4,
    releaseMs: 40,
    formantShift: 1,
    hiss: 0.3,
    gateDb: -80,
  };
  const vocode = (input: Float32Array, overrides: Partial<VocoderParams> = {}) => {
    const core = new VocoderCore();
    const params = { ...baseParams, ...overrides };
    return runInBlocks(input, 2, (i, o, n) => core.process(i, o, n, params, SAMPLE_RATE))[0]!;
  };

  it('outputs silence for a silent modulator (no carrier leakage)', () => {
    expect(rms(vocode(new Float32Array(SAMPLE_RATE)))).toBeLessThan(1e-6);
  });

  it('imposes the modulator spectrum on the carrier: a 1 kHz modulator lights up the 1 kHz region only', () => {
    const out = vocode(sine(1000, 1, 0.5)).slice(SAMPLE_RATE / 2);
    // Measure energy in a band around 1 kHz vs well-separated regions. Carrier harmonics are every 110 Hz.
    const regionEnergy = (low: number, high: number) => {
      let total = 0;
      for (let f = low; f <= high; f += 11) total += powerAt(out, f);
      return total;
    };
    const around1k = regionEnergy(800, 1250);
    expect(around1k).toBeGreaterThan(regionEnergy(150, 450) * 20);
    expect(around1k).toBeGreaterThan(regionEnergy(3000, 6000) * 20);
  });

  it('outputs a harmonic series of the carrier pitch', () => {
    const out = vocode(noise(1.5, 0.3), { hiss: 0, lowHz: 100, highHz: 3000 }).slice(SAMPLE_RATE / 2);
    const harmonic = powerAt(out, 440); // 4th harmonic of 110 Hz
    const between = powerAt(out, 495); // halfway between harmonics 4 and 5
    expect(harmonic).toBeGreaterThan(between * 10);
  });

  it('follows the modulator envelope: gated tone → gated output', () => {
    const gateRate = 4; // Hz
    const tone = sine(700, 2, 0.5);
    const gated = tone.map((x, i) => (Math.floor((i / SAMPLE_RATE) * gateRate * 2) % 2 === 0 ? x : 0));
    const out = vocode(gated, { releaseMs: 15 });
    // Compare mid-"on" window against mid-"off" window of a later gate cycle.
    // Gate period 0.25 s: on for [0, 0.125), off for [0.125, 0.25) within each cycle.
    const window = (startSec: number) => out.slice(Math.floor(startSec * SAMPLE_RATE), Math.floor((startSec + 0.04) * SAMPLE_RATE));
    const on = rms(window(1.0 + 0.07));
    const off = rms(window(1.0 + 0.125 + 0.07));
    expect(on).toBeGreaterThan(off * 8);
  });

  it('attack/release shape the envelope: slower release rings on longer', () => {
    const burst = new Float32Array(SAMPLE_RATE);
    burst.set(sine(900, 0.1, 0.5), 4000);
    const afterBurst = (releaseMs: number) => {
      const out = vocode(burst, { releaseMs });
      const from = 4000 + Math.floor(0.1 * SAMPLE_RATE) + Math.floor(0.05 * SAMPLE_RATE);
      return rms(out, from, from + 2000);
    };
    expect(afterBurst(200)).toBeGreaterThan(afterBurst(10) * 3);
  });

  it('formant shift moves the output spectrum up and down', () => {
    const input = sine(800, 1, 0.5);
    const peak = (formantShift: number) => dominantFrequency(vocode(input, { formantShift }).slice(SAMPLE_RATE / 2), 200, 4000);
    expect(peak(1)).toBeGreaterThan(700);
    expect(peak(1)).toBeLessThan(1000);
    expect(peak(1.6)).toBeGreaterThan(peak(1) * 1.3);
    expect(peak(0.65)).toBeLessThan(peak(1) * 0.75);
  });

  it.each(['saw', 'square', 'pulse', 'noise'] as const)('%s carrier is finite and bounded for loud broadband input', (carrier) => {
    const out = vocode(noise(1, 1), { carrier, bands: 32, attackMs: 0.5, releaseMs: 5 });
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(50);
    }
  });

  it('is deterministic (seeded noise) so realtime and offline renders match', () => {
    const input = noise(0.3, 0.3);
    expect(Array.from(vocode(input, { carrier: 'noise' }).slice(0, 500))).toEqual(Array.from(vocode(input, { carrier: 'noise' }).slice(0, 500)));
  });

  it('survives band-count and parameter changes mid-stream', () => {
    const core = new VocoderCore();
    const input = noise(0.5, 0.3);
    const out = runInBlocks(input, 2, (i, o, n) => {
      const bands = [8, 16, 32][Math.floor(Math.random() * 3)]!;
      core.process(i, o, n, { ...baseParams, bands, carrierHz: 80 + Math.random() * 300 }, SAMPLE_RATE);
    })[0]!;
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });
});
