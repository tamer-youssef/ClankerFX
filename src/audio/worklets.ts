import { setParam } from './paramUtils';
// `?worker&url` makes Vite bundle the processor module (with its dsp/ imports) as a standalone asset.
import processorsUrl from '../worklets/processors.ts?worker&url';

/** Contexts whose AudioWorklet module has finished loading. Worklet nodes can only be created for these. */
const readyContexts = new WeakSet<BaseAudioContext>();

export function isAudioWorkletSupported(context: BaseAudioContext): boolean {
  return typeof AudioWorkletNode !== 'undefined' && context.audioWorklet !== undefined;
}

/**
 * Loads MechVox's processors into a context. Needed once per context, for AudioContext and OfflineAudioContext alike.
 * Throws a readable error when AudioWorklet is unavailable (it requires a secure context: HTTPS or localhost).
 */
export async function loadWorklets(context: BaseAudioContext): Promise<void> {
  if (readyContexts.has(context)) return;
  if (!isAudioWorkletSupported(context)) {
    throw new Error('AudioWorklet is not available here. It needs a modern browser on HTTPS or localhost.');
  }
  await context.audioWorklet.addModule(processorsUrl);
  readyContexts.add(context);
}

/** Creates a stereo-in/stereo-out worklet node. Throws if the module is not loaded so the chain can skip the effect. */
export function createWorkletNode(context: BaseAudioContext, processorName: string): AudioWorkletNode {
  if (!readyContexts.has(context)) {
    throw new Error('AudioWorklet module is not loaded');
  }
  return new AudioWorkletNode(context, processorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
}

/** Pushes a parameter set onto the node's AudioParams (names must match the processor's descriptors). */
export function setWorkletParams(context: BaseAudioContext, node: AudioWorkletNode, values: object, immediate: boolean): void {
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'number') continue;
    const param = node.parameters.get(name);
    if (!param) throw new Error(`Worklet parameter "${name}" is not defined`);
    setParam(context, param, value, immediate);
  }
}

/** Asks a worklet node to reset its DSP state at exactly context time `at` (see CoreProcessor in worklets/processors.ts). */
export function resetWorkletAt(context: BaseAudioContext, node: AudioWorkletNode, at: number): void {
  node.port.postMessage({ type: 'reset', frame: Math.round(at * context.sampleRate) });
}
