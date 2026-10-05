import type { EffectState } from '../types/effects';
import { clampParams } from '../effects/BaseEffect';
import { getEffectDefinition } from '../effects/registry';

const MAX_TAIL_SECONDS = 8;
const BASE_TAIL_SECONDS = 0.1;
/** Below this the decaying tail counts as silence: −60 dB, the usual RT60 definition. */
const SILENCE_RATIO = 0.001;

/**
 * How much extra audio to render after the source ends so reverb/delay/feedback tails are not cut off.
 * Only effects that are enabled and audible (resolved mix > 0) contribute. Capped so a long reverb cannot
 * make exports unreasonably long.
 */
export function estimateTailSeconds(effects: readonly EffectState[]): number {
  let tail = BASE_TAIL_SECONDS;
  for (const effect of effects) {
    if (!effect.enabled) continue;
    const definition = getEffectDefinition(effect.type);
    if (!definition) continue;
    const params = clampParams(definition.params, effect.params);
    const resolved = definition.resolve(effect.amount, params);
    if (resolved.mix <= 0) continue;
    const p = resolved.params;

    switch (effect.type) {
      case 'reverb':
        tail = Math.max(tail, (p.decaySeconds ?? 0) + (p.preDelayMs ?? 0) / 1000);
        break;
      case 'delay': {
        const feedback = Math.min(0.95, Math.max(0, p.feedback ?? 0));
        // Repeats needed for the echo train to fall to −60 dB.
        const repeats = feedback < 1e-3 ? 1 : Math.ceil(Math.log(SILENCE_RATIO) / Math.log(feedback));
        tail = Math.max(tail, ((p.timeMs ?? 0) / 1000) * (1 + repeats));
        break;
      }
      case 'flanger':
      case 'phaser':
        tail = Math.max(tail, 0.5);
        break;
      case 'pitch':
      case 'vocoder':
        tail = Math.max(tail, 0.25); // grain / filterbank latency
        break;
      default:
        break;
    }
  }
  return Math.min(MAX_TAIL_SECONDS, tail);
}

/**
 * Trims the silent end of a rendered buffer. Never shortens below `minLength` (the source duration), and leaves a
 * short pad after the last audible sample. A tail that decayed below the threshold is dropped.
 */
export function trimTrailingSilence(
  channels: readonly Float32Array[],
  minLength: number,
  sampleRate: number,
  thresholdDb = -80,
  padSeconds = 0.05,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  const threshold = Math.pow(10, thresholdDb / 20);
  let last = length - 1;
  while (last >= minLength) {
    let loud = false;
    for (const channel of channels) {
      if (Math.abs(channel[last] as number) > threshold) {
        loud = true;
        break;
      }
    }
    if (loud) break;
    last--;
  }
  const end = Math.min(length, Math.max(minLength, last + 1 + Math.round(padSeconds * sampleRate)));
  return channels.map((channel) => channel.slice(0, end));
}
