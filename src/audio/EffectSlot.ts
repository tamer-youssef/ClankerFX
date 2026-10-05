import { clampParams, mixGains, type EffectDefinition, type EffectRuntime, type ParamValues } from '../effects/BaseEffect';
import type { EffectState } from '../types/effects';
import { clamp01 } from '../utils/math';
import { setParam } from './paramUtils';

/**
 * One effect in the chain: owns its runtime plus the dry/wet blend and bypass.
 *
 *   input ─┬─ dry ───────────┬─ output
 *          └─ runtime ─ wet ─┘
 *
 * Bypass and enable simply drive the blend to fully dry, so toggling is click-free and the effect's
 * internal state (delay tails, LFO phase) keeps running.
 */
export class EffectSlot {
  readonly id: string;
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private readonly runtime: EffectRuntime<ParamValues>;
  private lastApplied: { state: EffectState; bypassed: boolean } | null = null;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly definition: EffectDefinition,
    id: string,
  ) {
    this.id = id;
    this.input = context.createGain();
    this.output = context.createGain();
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.runtime = definition.create(context);

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.runtime.input);
    this.runtime.output.connect(this.wet).connect(this.output);
  }

  apply(state: EffectState, bypassed: boolean, immediate: boolean): void {
    // Skip redundant work: React state is immutable, so identical references mean nothing changed.
    if (this.lastApplied && this.lastApplied.state === state && this.lastApplied.bypassed === bypassed && !immediate) return;
    this.lastApplied = { state, bypassed };

    const params = clampParams(this.definition.params, state.params);
    const resolved = this.definition.resolve(clamp01(state.amount), params);
    this.runtime.update(clampParams(this.definition.params, resolved.params), immediate);

    const active = state.enabled && !bypassed;
    const { dry, wet } = mixGains(this.definition.blend, active ? resolved.mix : 0);
    setParam(this.context, this.dry.gain, dry, immediate);
    setParam(this.context, this.wet.gain, wet, immediate);
  }

  dispose(): void {
    this.runtime.dispose();
    for (const node of [this.input, this.dry, this.wet, this.output]) node.disconnect();
  }
}
