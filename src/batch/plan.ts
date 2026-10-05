import { mutateChain } from '../presets/mutate';
import type { EffectState } from '../types/effects';
import type { MutationIntensity } from '../types/presets';
import { clamp } from '../utils/math';
import { parseSuffix, processedFilename, uniqueFilenames, variationFilename } from '../utils/filenames';

export type BatchMode = 'processed' | 'variations';

export interface BatchOptions {
  mode: BatchMode;
  /** Filename suffix for 'processed' mode; cleaned with parseSuffix. */
  suffix: string;
  /** Variations per file in 'variations' mode; rounded and clamped to 1..MAX_VARIATIONS. */
  variationCount: number;
  intensity: MutationIntensity;
  /** Base seed; the per-variant seed also depends on the file name and the variant index. */
  seed: number;
}

export interface BatchSourceFile {
  id: string;
  name: string;
}

export interface BatchJob {
  /** `${fileId}:${variantIndex ?? 'processed'}`: unique and stable for a given file id. */
  id: string;
  fileId: string;
  sourceName: string;
  outputName: string;
  /** 1-based; null for 'processed' jobs. */
  variantIndex: number | null;
  /** Mutation seed (unsigned 32-bit); null for 'processed' jobs. */
  seed: number | null;
}

export const MAX_VARIATIONS = 20;

export const defaultBatchOptions: BatchOptions = {
  mode: 'processed',
  suffix: '_processed',
  variationCount: 3,
  intensity: 'medium',
  seed: 1,
};

/** Any number → unsigned 32-bit integer; NaN/±Infinity become `fallback`. Floats truncate, negatives wrap. */
function toUint32(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value) >>> 0 : fallback;
}

/** FNV-1a over UTF-16 code units. */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

/** murmur3 finaliser: spreads small input differences over all 32 bits. */
function avalanche(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic 32-bit seed for one variant. Depends only on the base seed, the file NAME and the 1-based index,
 * never on the file's id or its position in the batch, so re-running with other files selected gives the same variant.
 */
export function variationSeed(baseSeed: number, fileName: string, variantIndex: number): number {
  const base = toUint32(baseSeed, 1);
  const index = toUint32(variantIndex, 1);
  let h = hashString(fileName);
  h = avalanche(h ^ avalanche(base + 0x9e3779b9));
  h = avalanche(h ^ avalanche(Math.imul(index, 0x85ebca6b) + 0x7f4a7c15));
  return h;
}

function variationCountOf(options: BatchOptions): number {
  const raw = Number.isFinite(options.variationCount) ? options.variationCount : 1;
  return clamp(Math.round(raw), 1, MAX_VARIATIONS);
}

/** Expands the selected files into an ordered job list (files in order, variants in order) with globally unique output names. */
export function planBatch(files: readonly BatchSourceFile[], options: BatchOptions): BatchJob[] {
  const drafts: Omit<BatchJob, 'outputName'>[] = [];
  const names: string[] = [];
  const count = variationCountOf(options);
  const suffix = parseSuffix(options.suffix);

  for (const file of files) {
    if (options.mode === 'variations') {
      for (let i = 1; i <= count; i++) {
        drafts.push({ id: `${file.id}:${i}`, fileId: file.id, sourceName: file.name, variantIndex: i, seed: variationSeed(options.seed, file.name, i) });
        names.push(variationFilename(file.name, i));
      }
    } else {
      drafts.push({ id: `${file.id}:processed`, fileId: file.id, sourceName: file.name, variantIndex: null, seed: null });
      names.push(processedFilename(file.name, suffix));
    }
  }

  const outputNames = uniqueFilenames(names);
  return drafts.map((draft, i) => ({ ...draft, outputName: outputNames[i]! }));
}

/**
 * The effect chain to render for a job. Variant jobs get a freshly mutated copy (same ids and order);
 * processed jobs get a shallow copy of the array whose effect objects are the originals (never mutated by the renderer).
 */
export function chainForJob(chain: readonly EffectState[], job: BatchJob, intensity: MutationIntensity): EffectState[] {
  if (job.variantIndex === null || job.seed === null) return [...chain];
  return mutateChain(chain, intensity, job.seed);
}
