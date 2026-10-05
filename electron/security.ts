import * as path from 'node:path';

/** The packaged app is served from this origin by a custom protocol, because AudioWorklet modules and Web Workers cannot load from file://. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'clankerfx';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Everything the renderer may load comes from the app itself. `blob:` is for the AudioWorklet/Web Worker modules the app
 * builds at runtime and for decoded media; `style-src 'unsafe-inline'` is for React's inline `style` attributes.
 */
export function contentSecurityPolicy(devOrigin?: string): string {
  const dev = devOrigin ? ` ${devOrigin} ${devOrigin.replace(/^http/, 'ws')}` : '';
  return [
    "default-src 'self'",
    `script-src 'self'${dev ? ` ${devOrigin} 'unsafe-inline'` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' blob: data:${dev}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
}

/** Map an app:// URL path to a file under `root`, or null when it would leave the root. `/` serves index.html. */
export function resolveAppFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, relative);
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) return null;
  return full;
}

/** Only the app itself (and, in development, the local Vite server) may be requested. Everything else is blocked. */
export function isAllowedRequestUrl(url: string, devOrigin?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return true;
  if (parsed.protocol === `${APP_SCHEME}:`) return parsed.host === APP_HOST;
  if (devOrigin) {
    const dev = new URL(devOrigin);
    if ((parsed.protocol === dev.protocol || parsed.protocol === dev.protocol.replace('http', 'ws')) && parsed.host === dev.host) return true;
  }
  // DevTools in development loads its own frontend.
  return devOrigin !== undefined && parsed.protocol === 'devtools:';
}

/** IPC is only honoured from the app's own pages. */
export function isTrustedSender(url: string, devOrigin?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === `${APP_SCHEME}:`) return parsed.host === APP_HOST;
  return devOrigin !== undefined && parsed.origin === new URL(devOrigin).origin;
}

const ALLOWED_EXTENSIONS = new Set(['.wav', '.zip']);

/** A file name from the renderer becomes a base name with an allowed extension, never a path. */
export function sanitizeSaveName(name: unknown, fallback = 'clankerfx_output.wav'): string {
  if (typeof name !== 'string') return fallback;
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);
  if (cleaned === '') return fallback;
  const ext = path.extname(cleaned).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? cleaned : `${cleaned}.wav`;
}

/** `name.wav` → `name (1).wav`, `name (2).wav`… until `exists` says it is free. */
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error('Could not find a free file name');
}
