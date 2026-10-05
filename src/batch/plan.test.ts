import { describe, expect, it } from 'vitest';
import { createEffectState } from '../effects/registry';
import type { EffectState } from '../types/effects';
import { chainForJob, defaultBatchOptions, MAX_VARIATIONS, planBatch, variationSeed, type BatchOptions } from './plan';

const files = (...names: string[]) => names.map((name, i) => ({ id: `f${i}`, name }));
const variations = (overrides: Partial<BatchOptions> = {}): BatchOptions => ({ ...defaultBatchOptions, mode: 'variations', ...overrides });

function realChain(): EffectState[] {
  return ['distortion', 'delay', 'filter', 'reverb', 'ringmod'].map((type) => {
    const state = createEffectState(type);
    if (!state) throw new Error(`unknown effect ${type}`);
    return state;
  });
}

describe('defaultBatchOptions', () => {
  it('matches the documented defaults', () => {
    expect(defaultBatchOptions).toEqual({ mode: 'processed', suffix: '_processed', variationCount: 3, intensity: 'medium', seed: 1 });
    expect(MAX_VARIATIONS).toBe(20);
  });
});

describe('planBatch: processed', () => {
  it('makes one job per file with the suffix applied', () => {
    const jobs = planBatch(files('robot_hello.wav', 'voice.mp3'), defaultBatchOptions);
    expect(jobs.map((j) => j.outputName)).toEqual(['robot_hello_processed.wav', 'voice_processed.wav']);
    expect(jobs.map((j) => j.id)).toEqual(['f0:processed', 'f1:processed']);
    for (const job of jobs) {
      expect(job.variantIndex).toBeNull();
      expect(job.seed).toBeNull();
    }
    expect(jobs[0]).toMatchObject({ fileId: 'f0', sourceName: 'robot_hello.wav' });
  });

  it('uses a custom suffix, sanitised', () => {
    const [job] = planBatch(files('a.wav'), { ...defaultBatchOptions, suffix: ' _fx/..:*  ' });
    expect(job!.outputName).toBe('a_fx.wav');
  });

  it('returns an empty plan for no files', () => {
    expect(planBatch([], defaultBatchOptions)).toEqual([]);
    expect(planBatch([], variations())).toEqual([]);
  });
});

describe('planBatch: variations', () => {
  it('makes N numbered jobs per file in order', () => {
    const jobs = planBatch(files('robot_attack.wav', 'b.wav'), variations({ variationCount: 3 }));
    expect(jobs.map((j) => j.outputName)).toEqual([
      'robot_attack_01.wav', 'robot_attack_02.wav', 'robot_attack_03.wav', 'b_01.wav', 'b_02.wav', 'b_03.wav',
    ]);
    expect(jobs.map((j) => j.variantIndex)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(jobs.map((j) => j.id)).toEqual(['f0:1', 'f0:2', 'f0:3', 'f1:1', 'f1:2', 'f1:3']);
    for (const job of jobs) expect(job.seed).toBe(variationSeed(1, job.sourceName, job.variantIndex!));
  });

  it('keeps two-digit numbering at 10 and above', () => {
    const names = planBatch(files('x.wav'), variations({ variationCount: 12 })).map((j) => j.outputName);
    expect(names[8]).toBe('x_09.wav');
    expect(names[9]).toBe('x_10.wav');
    expect(names[11]).toBe('x_12.wav');
    expect(names).toHaveLength(12);
  });

  it('clamps and repairs odd counts', () => {
    const count = (variationCount: number) => planBatch(files('a.wav'), variations({ variationCount })).length;
    expect(count(0)).toBe(1);
    expect(count(-5)).toBe(1);
    expect(count(2.4)).toBe(2);
    expect(count(2.6)).toBe(3);
    expect(count(1000)).toBe(MAX_VARIATIONS);
    expect(count(Infinity)).toBe(1);
    expect(count(NaN)).toBe(1);
    expect(count(-Infinity)).toBe(1);
  });

  it('ignores the suffix', () => {
    const [job] = planBatch(files('a.wav'), variations({ suffix: '_zzz' }));
    expect(job!.outputName).toBe('a_01.wav');
  });
});

describe('planBatch: uniqueness', () => {
  it('disambiguates identical source names (processed)', () => {
    const jobs = planBatch(files('voice.wav', 'voice.wav', 'VOICE.wav'), defaultBatchOptions);
    const names = jobs.map((j) => j.outputName);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
    expect(names[0]).toBe('voice_processed.wav');
    expect(new Set(jobs.map((j) => j.id)).size).toBe(3);
  });

  it('disambiguates identical source names (variations)', () => {
    const jobs = planBatch(files('voice.wav', 'voice.wav'), variations({ variationCount: 4 }));
    expect(jobs).toHaveLength(8);
    expect(new Set(jobs.map((j) => j.outputName.toLowerCase())).size).toBe(8);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(8);
    // Same file name → same seeds, even though the outputs are renamed apart.
    expect(jobs[0]!.seed).toBe(jobs[4]!.seed);
  });

  it('disambiguates names that collide only after sanitising/extension swap', () => {
    const jobs = planBatch(files('a.mp3', 'a.ogg', 'a.wav'), defaultBatchOptions);
    expect(new Set(jobs.map((j) => j.outputName)).size).toBe(3);
  });
});

describe('variationSeed', () => {
  it('is a deterministic unsigned 32-bit integer', () => {
    const seed = variationSeed(7, 'a.wav', 1);
    expect(variationSeed(7, 'a.wav', 1)).toBe(seed);
    for (let i = 1; i <= 50; i++) {
      const s = variationSeed(i, `file${i}.wav`, i);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  it('does not depend on the other files or their order', () => {
    const a = planBatch(files('a.wav', 'b.wav', 'c.wav'), variations());
    const b = planBatch([{ id: 'zzz', name: 'c.wav' }, { id: 'yyy', name: 'a.wav' }], variations());
    const seedOf = (jobs: typeof a, name: string, i: number) => jobs.find((j) => j.sourceName === name && j.variantIndex === i)!.seed;
    for (const i of [1, 2, 3]) {
      expect(seedOf(b, 'a.wav', i)).toBe(seedOf(a, 'a.wav', i));
      expect(seedOf(b, 'c.wav', i)).toBe(seedOf(a, 'c.wav', i));
    }
  });

  it('differs across files, indices and base seeds', () => {
    const seeds = new Set<number>();
    for (const seed of [1, 2, 3]) for (const name of ['a.wav', 'b.wav', 'a.WAV', 'a.wa']) for (let i = 1; i <= 20; i++) seeds.add(variationSeed(seed, name, i));
    expect(seeds.size).toBe(3 * 4 * 20);
  });

  it('is sensitive to a one-bit change in the base seed (no trivial collisions over many seeds)', () => {
    const seeds = new Set<number>();
    for (let s = 0; s < 2000; s++) seeds.add(variationSeed(s, 'voice.wav', 1));
    expect(seeds.size).toBe(2000);
  });

  it('repairs non-finite and fractional input deterministically', () => {
    expect(variationSeed(NaN, 'a.wav', 1)).toBe(variationSeed(1, 'a.wav', 1));
    expect(variationSeed(Infinity, 'a.wav', 1)).toBe(variationSeed(1, 'a.wav', 1));
    expect(variationSeed(-Infinity, 'a.wav', 1)).toBe(variationSeed(1, 'a.wav', 1));
    expect(variationSeed(3.9, 'a.wav', 1)).toBe(variationSeed(3, 'a.wav', 1));
    expect(variationSeed(-1, 'a.wav', 1)).toBe(variationSeed(0xffffffff, 'a.wav', 1));
    expect(variationSeed(2 ** 32 + 5, 'a.wav', 1)).toBe(variationSeed(5, 'a.wav', 1));
    expect(variationSeed(1, 'a.wav', NaN)).toBe(variationSeed(1, 'a.wav', 1));
    for (const weird of [NaN, Infinity, -1e300, 1e300, -0.5]) {
      const s = variationSeed(weird, 'a.wav', 2);
      expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
    }
  });

  it('plans with weird seeds without throwing', () => {
    for (const seed of [NaN, Infinity, -7.5, 1e20]) {
      const jobs = planBatch(files('a.wav'), variations({ seed }));
      expect(jobs).toHaveLength(3);
      for (const job of jobs) expect(Number.isInteger(job.seed)).toBe(true);
    }
  });

  it('handles unicode names', () => {
    expect(variationSeed(1, 'голос.wav', 1)).not.toBe(variationSeed(1, '声音.wav', 1));
  });
});

describe('chainForJob', () => {
  const job = (seed: number | null, variantIndex: number | null) => ({
    id: 'x', fileId: 'x', sourceName: 'a.wav', outputName: 'a_01.wav', variantIndex, seed,
  });

  it('returns an equal copy for processed jobs', () => {
    const chain = realChain();
    const out = chainForJob(chain, job(null, null), 'heavy');
    expect(out).toEqual(chain);
    expect(out).not.toBe(chain);
  });

  it('is deterministic and does not mutate the input chain', () => {
    const chain = realChain();
    const snapshot = structuredClone(chain);
    const planned = planBatch(files('a.wav'), variations({ intensity: 'heavy' }))[1]!;
    const a = chainForJob(chain, planned, 'heavy');
    const b = chainForJob(chain, planned, 'heavy');
    expect(a).toEqual(b);
    expect(chain).toEqual(snapshot);
    expect(a.map((e) => e.id)).toEqual(chain.map((e) => e.id));
    expect(a.map((e) => e.type)).toEqual(chain.map((e) => e.type));
    expect(a[0]).not.toBe(chain[0]);
  });

  it('gives different variants that differ from the original at heavy intensity', () => {
    const chain = realChain();
    const jobs = planBatch(files('a.wav'), variations({ intensity: 'heavy', variationCount: 5 }));
    const chains = jobs.map((j) => JSON.stringify(chainForJob(chain, j, 'heavy')));
    expect(new Set(chains).size).toBe(5);
    for (const c of chains) expect(c).not.toBe(JSON.stringify(chain));
  });

  it('handles an empty chain', () => {
    expect(chainForJob([], planBatch(files('a.wav'), variations())[0]!, 'medium')).toEqual([]);
  });
});
