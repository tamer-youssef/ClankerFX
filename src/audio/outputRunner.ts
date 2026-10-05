import type { OutputWorkerRequest, OutputWorkerResponse } from '../workers/output.worker';
import { finalizeOutput, type FinalizeInput, type FinalizeOutput } from './OutputPipeline';

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (value: FinalizeOutput) => void; reject: (error: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('../workers/output.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<OutputWorkerResponse>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.result) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error ?? 'Analysis failed'));
    };
    worker.onerror = () => {
      // A broken worker must not wedge the app: fail pending jobs and fall back to the main thread from now on.
      pending.forEach((entry) => entry.reject(new Error('Analysis worker failed')));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Runs the output stage (gain, limiter, measurements) in a Web Worker so long files do not freeze the UI.
 * Falls back to the main thread when workers are unavailable. Input channels are copied, so callers keep their data.
 */
export function runOutputStage(input: FinalizeInput, returnAudio: boolean): Promise<FinalizeOutput> {
  const target = getWorker();
  if (!target) {
    return new Promise((resolve, reject) => {
      // Defer so the caller's state updates render before a long synchronous computation.
      setTimeout(() => {
        try {
          resolve(finalizeOutput(input, returnAudio));
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Analysis failed'));
        }
      }, 0);
    });
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    target.postMessage({ id, input, returnAudio } satisfies OutputWorkerRequest);
  });
}
