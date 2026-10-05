// Minimal typings for the AudioWorkletGlobalScope, which the DOM lib does not describe.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, processorCtor: new (options?: unknown) => AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const currentFrame: number;
