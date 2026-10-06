import { contextBridge, ipcRenderer } from 'electron';
import type { ClankerFxDesktopApi } from '../src/types/clankerfx';

/** The whole surface the page can reach: two save calls. No Node, no filesystem, no generic IPC. */
const api: ClankerFxDesktopApi = {
  isDesktop: true,
  saveFile: (name, data) => ipcRenderer.invoke('clankerfx:save-file', name, data),
  saveFiles: (files) => ipcRenderer.invoke('clankerfx:save-files', files),
};

contextBridge.exposeInMainWorld('clankerfx', api);
