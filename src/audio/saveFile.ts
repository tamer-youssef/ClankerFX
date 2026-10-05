import type { SaveOutcome } from '../types/clankerfx';
import { downloadBlob } from './exporter';

export type SaveResult = SaveOutcome['status'];

/** True inside the Electron shell, where saving goes through native dialogs instead of browser downloads. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.clankerfx?.isDesktop === true;
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Save one file: a native "Save as" dialog on desktop, a normal download in the browser. */
export async function saveBlob(blob: Blob, filename: string): Promise<SaveResult> {
  const desktop = window.clankerfx;
  if (!desktop) {
    downloadBlob(blob, filename);
    return 'saved';
  }
  return (await desktop.saveFile(filename, await bytesOf(blob))).status;
}

/** Save several files: one folder chooser on desktop, one download each (spaced out) in the browser. */
export async function saveFiles(files: readonly { name: string; blob: Blob }[]): Promise<SaveResult> {
  const desktop = window.clankerfx;
  if (!desktop) {
    for (const file of files) {
      downloadBlob(file.blob, file.name);
      // Browsers drop rapid-fire programmatic downloads; a short gap keeps all of them.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return 'saved';
  }
  const payload = await Promise.all(files.map(async (file) => ({ name: file.name, data: await bytesOf(file.blob) })));
  return (await desktop.saveFiles(payload)).status;
}
