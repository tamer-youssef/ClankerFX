export type MicErrorCode = 'denied' | 'no-device' | 'busy' | 'insecure' | 'unsupported' | 'unknown';

export interface MicErrorInfo {
  code: MicErrorCode;
  message: string;
}

const MESSAGES: Record<MicErrorCode, string> = {
  denied: "Microphone access was blocked. Allow it in the browser's site settings and try again.",
  'no-device': 'No microphone was found. Connect one and try again.',
  busy: 'The microphone is in use by another app, or could not be started. Close other apps that use it and try again.',
  insecure: 'Recording needs a secure connection (HTTPS or localhost). Open this app from a secure address.',
  unsupported: 'This browser cannot record from a microphone.',
  unknown: 'Recording could not be started. Check your microphone and try again.',
};

function info(code: MicErrorCode): MicErrorInfo {
  return { code, message: MESSAGES[code] };
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error && typeof (error as { name: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }
  return '';
}

function isInsecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false;
}

/**
 * Why microphone recording cannot work in this environment at all, or null when it can. Checked up front so the UI can
 * disable the Record button with an explanation instead of letting the user hit an error.
 */
export function micUnsupportedReason(): MicErrorInfo | null {
  if (isInsecureContext()) return info('insecure');
  const hasMediaDevices = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
  if (!hasMediaDevices || typeof AudioWorkletNode === 'undefined') return info('unsupported');
  return null;
}

/**
 * Maps whatever getUserMedia / the audio setup threw to a stable code and a friendly message. Raw error text is never
 * returned: browsers put device names and internals in it.
 */
export function describeMicError(error: unknown): MicErrorInfo {
  const name = errorName(error);
  if (isInsecureContext() || name === 'SecurityError') return info('insecure');
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return info('denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return info('no-device');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return info('busy');
    case 'NotSupportedError':
      return info('unsupported');
  }
  return micUnsupportedReason() ?? info('unknown');
}
