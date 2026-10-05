/** The desktop shell (electron/preload.ts) exposes this on `window`; in a plain browser it is undefined. */
export type SaveOutcome = { status: 'saved'; path: string } | { status: 'cancelled' };

export interface DesktopFile {
  name: string;
  data: Uint8Array;
}

export interface ClankerFxDesktopApi {
  isDesktop: true;
  /** Native "Save as" dialog, then write. Resolves 'cancelled' when the user backs out. */
  saveFile(name: string, data: Uint8Array): Promise<SaveOutcome>;
  /** Native folder chooser, then write every file into it (never overwriting existing files). */
  saveFiles(files: DesktopFile[]): Promise<SaveOutcome>;
}

declare global {
  interface Window {
    clankerfx?: ClankerFxDesktopApi;
  }
}
