import { getEffectDefinition } from '../effects/registry';
import type { ChainOptions, EffectState } from '../types/effects';
import { EffectSlot } from './EffectSlot';

export interface ChainCallbacks {
  /** Called when an effect could not be created; that effect is skipped (audio passes through it). */
  onEffectError?: (effectId: string, message: string) => void;
}

/**
 * Serial effect graph: input → slot₁ → slot₂ … → output.
 * `sync()` reconciles the live graph with a plain list of EffectState, so it is the single code path used
 * by realtime playback, parameter edits and (later) offline export.
 */
export class EffectChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private slots: EffectSlot[] = [];
  private failed = new Set<string>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly callbacks: ChainCallbacks = {},
  ) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.input.connect(this.output);
  }

  sync(effects: readonly EffectState[], options: ChainOptions, immediate: boolean): void {
    const existing = new Map(this.slots.map((slot) => [slot.id, slot]));
    const next: EffectSlot[] = [];

    for (const effect of effects) {
      let slot = existing.get(effect.id);
      if (!slot && !this.failed.has(effect.id)) {
        slot = this.createSlot(effect);
      }
      if (slot) next.push(slot);
    }

    for (const slot of this.slots) {
      if (!next.includes(slot)) slot.dispose();
    }
    for (const id of this.failed) {
      if (!effects.some((effect) => effect.id === id)) this.failed.delete(id);
    }

    const topologyChanged = next.length !== this.slots.length || next.some((slot, i) => slot !== this.slots[i]);
    this.slots = next;
    if (topologyChanged) this.rewire();

    for (const slot of this.slots) {
      const state = effects.find((effect) => effect.id === slot.id);
      if (state) slot.apply(state, options.bypassAll || options.bypassedIds.has(slot.id), immediate);
    }
  }

  /** Restarts every effect's free-running phases at context time `at`. */
  reset(at: number): void {
    for (const slot of this.slots) slot.reset(at);
  }

  dispose(): void {
    for (const slot of this.slots) slot.dispose();
    this.slots = [];
    this.input.disconnect();
    this.output.disconnect();
  }

  private createSlot(effect: EffectState): EffectSlot | undefined {
    try {
      const definition = getEffectDefinition(effect.type);
      if (!definition) throw new Error(`Unknown effect type "${effect.type}"`);
      return new EffectSlot(this.context, definition, effect.id);
    } catch (error) {
      this.failed.add(effect.id);
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.callbacks.onEffectError?.(effect.id, `The "${effect.type}" effect could not start (${reason}). It has been skipped.`);
      return undefined;
    }
  }

  private rewire(): void {
    this.input.disconnect();
    for (const slot of this.slots) slot.output.disconnect();
    let previous: AudioNode = this.input;
    for (const slot of this.slots) {
      previous.connect(slot.input);
      previous = slot.output;
    }
    previous.connect(this.output);
  }
}
