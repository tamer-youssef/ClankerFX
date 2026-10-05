import { clamp } from '../utils/math';

/** Numeric parameter bag. Enumerations are encoded as numbers so state stays trivially serialisable. */
export type ParamValues = Record<string, number>;

export interface ParamOption {
  value: number;
  label: string;
}

export interface ParamSpec {
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit?: string;
  /** Log scale makes frequency-like sliders feel even across the range. */
  scale?: 'linear' | 'log';
  /** When present the parameter is a choice between these values rather than a continuous range. */
  options?: readonly ParamOption[];
  /** Display as a percentage of 0..1 (value 0.5 → "50%"). */
  percent?: boolean;
}

export type ParamSchema<P> = { [K in keyof P]: ParamSpec };

/**
 * How the wet (effect) path combines with the dry path:
 * - crossfade: equal-power blend, dry fades out as mix → 1 (pitch, vocoder, ring mod…)
 * - add: dry stays at unity and the effect is added on top (delay, reverb, chorus…)
 */
export type BlendMode = 'crossfade' | 'add';

export interface ResolvedEffect<P> {
  /** 0–1 wet amount handed to the slot's blend. */
  mix: number;
  /** Parameters actually applied to the DSP (the user's params after Amount scaling). */
  params: P;
}

/** Live Web Audio nodes for one effect. Built from a BaseAudioContext so the same code serves realtime and offline use. */
export interface EffectRuntime<P> {
  input: AudioNode;
  output: AudioNode;
  /** Apply parameters. `immediate` skips smoothing (offline render / initial setup). */
  update(params: P, immediate: boolean): void;
  dispose(): void;
}

/**
 * Amount contract (the same for every effect): Amount 0 is transparent and Amount 1 reproduces the
 * configured Advanced parameters exactly. Effects either map Amount to `mix`, or interpolate
 * parameters from a neutral value to the configured one inside `resolve`.
 */
export interface TypedEffectDefinition<P extends object> {
  type: string;
  label: string;
  description: string;
  params: ParamSchema<P>;
  defaultAmount: number;
  blend: BlendMode;
  resolve(amount: number, params: P): ResolvedEffect<P>;
  create(context: BaseAudioContext): EffectRuntime<P>;
}

/** Type-erased definition stored in the registry. */
export interface EffectDefinition {
  type: string;
  label: string;
  description: string;
  params: Record<string, ParamSpec>;
  defaultAmount: number;
  blend: BlendMode;
  resolve(amount: number, params: ParamValues): ResolvedEffect<ParamValues>;
  create(context: BaseAudioContext): EffectRuntime<ParamValues>;
}

/**
 * Erases the per-effect parameter type once, here, so the rest of the app can treat all effects uniformly.
 * `ParamSchema<P>` requires a spec for every key of P, and `clampParams` always returns every schema key, so the
 * casts below are sound.
 */
export function defineEffect<P extends object>(definition: TypedEffectDefinition<P>): EffectDefinition {
  return definition as unknown as EffectDefinition;
}

export function defaultParams(schema: Record<string, ParamSpec>): ParamValues {
  return Object.fromEntries(Object.entries(schema).map(([key, spec]) => [key, spec.default]));
}

function snapToOption(spec: ParamSpec, value: number): number {
  const options = spec.options;
  if (!options || options.length === 0) return value;
  let best = options[0]!;
  for (const option of options) {
    if (Math.abs(option.value - value) < Math.abs(best.value - value)) best = option;
  }
  return best.value;
}

/**
 * Produces a complete, safe parameter set: unknown keys are dropped, missing/NaN values fall back to defaults,
 * and everything is clamped to its declared range. All dangerous DSP values (feedback, gain, drive) are bounded here.
 */
export function clampParams(schema: Record<string, ParamSpec>, input: Record<string, unknown> | undefined): ParamValues {
  const out: ParamValues = {};
  for (const [key, spec] of Object.entries(schema)) {
    const raw = input?.[key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.default;
    out[key] = spec.options ? snapToOption(spec, value) : clamp(value, spec.min, spec.max);
  }
  return out;
}

/** Equal-power crossfade keeps perceived loudness steady while blending. */
export function mixGains(blend: BlendMode, mix: number): { dry: number; wet: number } {
  const m = clamp(mix, 0, 1);
  if (blend === 'add') return { dry: 1, wet: m };
  return { dry: Math.cos((m * Math.PI) / 2), wet: Math.sin((m * Math.PI) / 2) };
}
