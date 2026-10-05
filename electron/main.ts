import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, systemPreferences, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SaveOutcome } from '../src/types/clankerfx';
import { APP_HOST, APP_ORIGIN, APP_SCHEME, contentSecurityPolicy, isAllowedRequestUrl, isTrustedSender, resolveAppFile, sanitizeSaveName, uniqueName } from './security';

/** Development only: point at the local Vite server instead of the built app. Ignored in packaged builds. */
const devUrl = !app.isPackaged && process.env.CLANKERFX_DEV_URL ? new URL(process.env.CLANKERFX_DEV_URL).origin : undefined;
const isMac = process.platform === 'darwin';
const distRoot = path.join(app.getAppPath(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Must run before `ready`. `standard` + `secure` give the app a real origin (so Web Audio, workers and storage behave as on https).
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let lastSaveDir: string | null = null;

function securityHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': contentSecurityPolicy(),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    const file = resolveAppFile(distRoot, url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(data), { status: 200, headers: securityHeaders(type) });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function lockDownSession(): void {
  const ses = session.defaultSession;

  // Nothing leaves the machine: any request that is not to the app itself is cancelled.
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequestUrl(details.url, devUrl) });
  });

  // The only permission the app ever asks for is the microphone (audio only, never camera or screen).
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const trusted = isTrustedSender(details.requestingUrl, devUrl);
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    const audioOnly = permission === 'media' && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
    if (!trusted || !audioOnly) {
      callback(false);
      return;
    }
    if (isMac) {
      // macOS asks the user itself (the usage string comes from NSMicrophoneUsageDescription); the app must wait for it.
      void systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false));
      return;
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (permission !== 'media') return false;
    const mediaType = 'mediaType' in details ? details.mediaType : undefined;
    return isTrustedSender(requestingOrigin, devUrl) && (mediaType === undefined || mediaType === 'audio' || mediaType === 'unknown');
  });
  ses.setDevicePermissionHandler(() => false);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'ClankerFX',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      // Audio keeps playing, and recordings keep going, when the window is covered or minimised.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // No pop-ups, no webviews, no navigating away from the app (a file dropped outside the drop zone would otherwise open it).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url, devUrl)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  void win.loadURL(devUrl ?? `${APP_ORIGIN}/`);
}

function buildMenu(): void {
  const dev = devUrl !== undefined;
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      ...(dev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[]) : []),
      { role: 'togglefullscreen' },
    ],
  };
  // Edit has cut/copy/paste/select-all only: Undo/Redo accelerators would swallow Ctrl+Z, which is the app's own undo.
  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
  };
  const template: MenuItemConstructorOptions[] = isMac
    ? [{ role: 'appMenu' }, edit, view, { role: 'windowMenu' }]
    : [{ label: 'File', submenu: [{ role: 'quit' }] }, edit, view];
  Menu.setApplicationMenu(isMac || dev ? Menu.buildFromTemplate(template) : null);
}

// --- IPC: save files through native dialogs --------------------------------------------------------------------------

function assertTrusted(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!isTrustedSender(url, devUrl)) throw new Error('Untrusted sender');
}

function toBuffer(data: unknown): Buffer {
  if (!(data instanceof Uint8Array)) throw new Error('Invalid file data');
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function startDir(): string {
  return lastSaveDir ?? app.getPath('documents');
}

function registerIpc(): void {
  ipcMain.handle('clankerfx:save-file', async (event, name: unknown, data: unknown): Promise<SaveOutcome> => {
    assertTrusted(event);
    const fileName = sanitizeSaveName(name);
    const buffer = toBuffer(data);
    const isZip = fileName.toLowerCase().endsWith('.zip');
    const options = {
      title: 'Save',
      defaultPath: path.join(startDir(), fileName),
      filters: isZip ? [{ name: 'ZIP archive', extensions: ['zip'] }] : [{ name: 'WAV audio', extensions: ['wav'] }],
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { status: 'cancelled' };
    await fs.promises.writeFile(result.filePath, buffer);
    lastSaveDir = path.dirname(result.filePath);
    return { status: 'saved', path: result.filePath };
  });

  ipcMain.handle('clankerfx:save-files', async (event, files: unknown): Promise<SaveOutcome> => {
    assertTrusted(event);
    if (!Array.isArray(files) || files.length === 0) throw new Error('No files to save');
    const prepared = files.map((entry: { name?: unknown; data?: unknown }) => ({ name: sanitizeSaveName(entry?.name), buffer: toBuffer(entry?.data) }));
    const options = { title: 'Choose a folder for the processed files', defaultPath: startDir(), properties: ['openDirectory' as const, 'createDirectory' as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    const folder = result.filePaths[0];
    if (result.canceled || !folder) return { status: 'cancelled' };
    // Never overwrite: an existing name gets "(1)", "(2)"… and names inside this batch count too.
    const used = new Set<string>();
    for (const file of prepared) {
      const name = uniqueName(file.name, (candidate) => used.has(candidate.toLowerCase()) || fs.existsSync(path.join(folder, candidate)));
      used.add(name.toLowerCase());
      await fs.promises.writeFile(path.join(folder, name), file.buffer, { flag: 'wx' });
    }
    lastSaveDir = folder;
    shell.showItemInFolder(path.join(folder, [...used][0] ?? ''));
    return { status: 'saved', path: folder };
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Every web contents the app could ever create gets the same lockdown, whatever opens it.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

void app.whenReady().then(() => {
  registerAppProtocol();
  lockDownSession();
  registerIpc();
  buildMenu();
  createWindow();
});
