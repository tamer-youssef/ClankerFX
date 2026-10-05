import type { ParamValues } from '../effects/BaseEffect';

/** Plain, serialisable description of one effect in the chain. This is what React state, presets and undo history hold. */
export interface EffectState {
  id: string;
  type: string;
  enabled: boolean;
  /** 0–1. 0 is transparent, 1 reproduces the advanced parameters exactly. */
  amount: number;
  params: ParamValues;
}

/** What the engine needs besides the effect list itself. Neither field is saved in presets. */
export interface ChainOptions {
  /** Hear the dry signal (before/after comparison). */
  bypassAll: boolean;
  /** Effects temporarily auditioned as bypassed (per-effect A/B). */
  bypassedIds: ReadonlySet<string>;
}
