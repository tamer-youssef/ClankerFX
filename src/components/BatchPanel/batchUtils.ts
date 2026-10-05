import type { BatchItemResult } from '../../audio/batchRunner';
import type { BatchJob, BatchOptions } from '../../batch/plan';
import { MAX_VARIATIONS } from '../../batch/plan';
import { parseSuffix } from '../../utils/filenames';
import { clamp } from '../../utils/math';
import { formatDb } from '../OutputPanel/levels';

export const FALLBACK_SUFFIX = '_processed';

/** A cleaned suffix that is never empty, so an output can never take the source file's name. */
export function effectiveSuffix(input: string): string {
  return parseSuffix(input) || FALLBACK_SUFFIX;
}

/** Number text for a table cell whose column header already carries the unit. */
export function plainDb(value: number | null | undefined, signed = false): string {
  return formatDb(value, { unit: 'x', signed }).replace(/ x$/, '');
}

export function parseCount(draft: string): number {
  const n = Number.parseInt(draft, 10);
  return Number.isFinite(n) ? clamp(n, 1, MAX_VARIATIONS) : 1;
}

const MAX_SEED = 0xffffffff;

export function parseSeed(draft: string): number {
  const n = Number(draft);
  return draft.trim() !== '' && Number.isFinite(n) ? clamp(Math.trunc(n), 0, MAX_SEED) : 1;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED + 1));
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function isClipped(result: BatchItemResult): boolean {
  return Boolean(result.measurements?.clipped) || (result.clippedSamples ?? 0) > 0;
}

/** What a finished run was computed from. Any difference to the live settings makes the numbers outdated. */
export interface RunSnapshot {
  chain: unknown;
  normalization: unknown;
  exportKey: string;
  optionsKey: string;
}

/** Only the export settings that change the audio; the filename suffix does not. */
export function exportKey(settings: { bitDepth: number; sampleRate: number | string; channels: string }): string {
  return `${settings.bitDepth}|${settings.sampleRate}|${settings.channels}`;
}

/** Only the batch options that change the audio or which jobs exist. */
export function optionsKey(options: BatchOptions): string {
  return options.mode === 'variations' ? `v|${options.variationCount}|${options.intensity}|${options.seed}` : 'p';
}

export interface BatchRun {
  jobs: BatchJob[];
  results: BatchItemResult[];
  phase: 'running' | 'packaging' | 'done' | 'cancelled';
  snapshot: RunSnapshot;
}

export type RowState = 'idle' | 'queued' | 'rendering' | 'done' | 'failed' | 'notRun';
