/// <reference lib="webworker" />
import { finalizeOutput, type FinalizeInput, type FinalizeOutput } from '../audio/OutputPipeline';

export interface OutputWorkerRequest {
  id: number;
  input: FinalizeInput;
  returnAudio: boolean;
}

export interface OutputWorkerResponse {
  id: number;
  result?: FinalizeOutput;
  error?: string;
}

/** Loudness measurement, gain and limiting touch every sample, so they run off the UI thread. */
self.onmessage = (event: MessageEvent<OutputWorkerRequest>) => {
  const { id, input, returnAudio } = event.data;
  try {
    const result = finalizeOutput(input, returnAudio);
    const transfer = result.channels?.map((channel) => channel.buffer) ?? [];
    (self as unknown as Worker).postMessage({ id, result } satisfies OutputWorkerResponse, transfer);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : 'Analysis failed' } satisfies OutputWorkerResponse);
  }
};
