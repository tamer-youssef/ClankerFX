/** One effect inside a preset. Plain JSON: no ids, params optional (missing values fall back to the effect's defaults). */
export interface PresetEffect {
  type: string;
  /** Defaults to true. */
  enabled?: boolean;
  /** 0–1, see the Amount contract in effects/BaseEffect.ts. */
  amount: number;
  params?: Record<string, number>;
}

/** An ordered effect chain with a name. Built-in presets and user presets share this shape. */
export interface Preset {
  id: string;
  name: string;
  description?: string;
  /** True for presets shipped with the app; they cannot be renamed or deleted, only duplicated. */
  builtIn?: boolean;
  effects: PresetEffect[];
}

export type MutationIntensity = 'slight' | 'medium' | 'heavy';
