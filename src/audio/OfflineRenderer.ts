import type { EffectState } from '../types/effects';
import { EffectChain } from './EffectChain';
import { estimateTailSeconds, trimTrailingSilence } from './renderTail';
import { loadWorklets } from './worklets';

export interface RenderedAudio {
  channels: Float32Array[];
  sampleRate: number;
}

/**
 * Renders a source buffer through the effect chain faster than realtime, using exactly the same EffectChain and
 * effect builders as live playback (that is what makes the exported file sound like the preview).
 *
 * Output is always stereo: the live engine also upmixes mono sources to both speakers, so this matches it. Audition
 * bypass flags are deliberately ignored; an export contains the chain as designed.
 */
export async function renderChain(source: AudioBuffer, effects: readonly EffectState[]): Promise<RenderedAudio> {
  const tailFrames = Math.ceil(estimateTailSeconds(effects) * source.sampleRate);
  const length = source.length + tailFrames;
  const context = new OfflineAudioContext(2, length, source.sampleRate);
  await loadWorklets(context);

  const node = context.createBufferSource();
  node.buffer = source;
  const chain = new EffectChain(context);
  node.connect(chain.input);
  chain.output.connect(context.destination);
  chain.sync(effects, { bypassAll: false, bypassedIds: new Set() }, true);
  node.start();

  const rendered = await context.startRendering();
  chain.dispose();

  const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
  return { channels: trimTrailingSilence(channels, source.length, source.sampleRate), sampleRate: source.sampleRate };
}
