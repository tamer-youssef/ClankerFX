import { createId } from '../utils/id';
import type { EffectState } from '../types/effects';
import { defaultParams, type EffectDefinition } from './BaseEffect';
import { bitcrusherEffect } from './BitcrusherEffect';
import { chorusEffect } from './ChorusEffect';
import { compressorEffect } from './CompressorEffect';
import { delayEffect } from './DelayEffect';
import { distortionEffect } from './DistortionEffect';
import { eqEffect } from './EQEffect';
import { filterEffect } from './FilterEffect';
import { flangerEffect } from './FlangerEffect';
import { gainEffect } from './GainEffect';
import { noiseEffect } from './NoiseEffect';
import { pitchEffect } from './PitchEffect';
import { phaserEffect } from './PhaserEffect';
import { reverbEffect } from './ReverbEffect';
import { ringModEffect } from './RingModEffect';
import { stereoEffect } from './StereoEffect';
import { tremoloEffect } from './TremoloEffect';
import { vocoderEffect } from './VocoderEffect';

/** Display order of the "Add Effect" menu. Adding an effect = writing its file and listing it here. */
const DEFINITIONS: readonly EffectDefinition[] = [
  pitchEffect,
  vocoderEffect,
  ringModEffect,
  bitcrusherEffect,
  flangerEffect,
  distortionEffect,
  filterEffect,
  eqEffect,
  chorusEffect,
  phaserEffect,
  compressorEffect,
  delayEffect,
  reverbEffect,
  tremoloEffect,
  noiseEffect,
  stereoEffect,
  gainEffect,
];

const BY_TYPE = new Map(DEFINITIONS.map((definition) => [definition.type, definition]));

export function listEffectDefinitions(): readonly EffectDefinition[] {
  return DEFINITIONS;
}

export function getEffectDefinition(type: string): EffectDefinition | undefined {
  return BY_TYPE.get(type);
}

/** Creates a new effect with its definition's default amount and parameters. Returns null for unknown types. */
export function createEffectState(type: string): EffectState | null {
  const definition = BY_TYPE.get(type);
  if (!definition) return null;
  return {
    id: createId('fx'),
    type,
    enabled: true,
    amount: definition.defaultAmount,
    params: defaultParams(definition.params),
  };
}
