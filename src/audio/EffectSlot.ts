import { clampParams, mixGains, type EffectDefinition, type EffectRuntime, type ParamValues } from '../effects/BaseEffect';
import type { EffectState } from '../types/effects';
import { clamp01 } from '../utils/math';
import { setParam } from './paramUtils';

/** After the wet path has faded out (smoothing time constant is 15 ms), wait this long before tearing the effect down. */
const TEARDOWN_DELAY_MS = 150;
/** Below this the wet path is considered silent. */
const SILENT_WET = 1e-6;

/**
 * One effect in the chain: owns its runtime plus the dry/wet blend and bypass.
 *
 *   input ─┬─ dry ───────────┬─ output
 *          └─ runtime ─ wet ─┘
 *
 * Bypass and enable drive the blend to fully dry, which is click-free. Once the wet path is silent the runtime is
 * disposed, so a disabled effect costs no CPU (a chain of eight switched-off vocoders/reverbs measured ~93 % of the
 * cost of leaving them on). Re-enabling builds a fresh runtime. It is deliberately not just disconnected: a frozen
 * delay line or reverb would replay stale audio from the moment it was disabled.
 */
export class EffectSlot {
  readonly id: string;
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dry: GainNode;
  private readonly wet: GainNode;
  private runtime: EffectRuntime<ParamValues> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
    // Built eagerly once so an effect that cannot start (e.g. no AudioWorklet) is reported when it is added,
    // not later when it is switched on. apply() tears it down again straight away if it starts out silent.
    this.buildRuntime();
  }

  /** Throws if the effect cannot be created; EffectChain reports that and skips the effect. */
  apply(state: EffectState, bypassed: boolean, immediate: boolean): void {
    // Skip redundant work: React state is immutable, so identical references mean nothing changed.
    if (this.lastApplied && this.lastApplied.state === state && this.lastApplied.bypassed === bypassed && !immediate) return;
    this.lastApplied = { state, bypassed };

    const params = clampParams(this.definition.params, state.params);
    const resolved = this.definition.resolve(clamp01(state.amount), params);
    const active = state.enabled && !bypassed;
    const { dry, wet } = mixGains(this.definition.blend, active ? resolved.mix : 0);
    const audible = wet > SILENT_WET;

    if (audible) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = undefined;
      if (!this.runtime) this.buildRuntime();
      this.runtime!.update(clampParams(this.definition.params, resolved.params), immediate || this.justBuilt);
      this.justBuilt = false;
    }
    setParam(this.context, this.dry.gain, dry, immediate);
    setParam(this.context, this.wet.gain, wet, immediate);

    if (!audible && this.runtime) {
      if (immediate) this.teardownRuntime();
      else if (this.teardownTimer === undefined) this.teardownTimer = setTimeout(() => this.teardownRuntime(), TEARDOWN_DELAY_MS);
    }
  }

  /** Restarts free-running phases at `at`. A torn-down (silent) effect has nothing to restart. */
  reset(at: number): void {
    this.runtime?.reset?.(at);
  }

  dispose(): void {
    clearTimeout(this.teardownTimer);
    this.teardownRuntime();
    for (const node of [this.input, this.dry, this.wet, this.output]) node.disconnect();
  }

  /** True right after a fresh runtime was created: its first parameters must be applied without smoothing. */
  private justBuilt = false;

  private buildRuntime(): void {
    const runtime = this.definition.create(this.context);
    this.input.connect(runtime.input);
    runtime.output.connect(this.wet);
    this.runtime = runtime;
    this.justBuilt = true;
  }

  private teardownRuntime(): void {
    this.teardownTimer = undefined;
    const runtime = this.runtime;
    if (!runtime) return;
    this.runtime = null;
    this.input.disconnect(runtime.input);
    runtime.output.disconnect();
    runtime.dispose();
  }
}
