import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeMicError, micUnsupportedReason } from './micErrors';

class FakeDomException extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}

function stubSupported() {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve() } });
  vi.stubGlobal('AudioWorkletNode', class {});
}

afterEach(() => vi.unstubAllGlobals());

describe('describeMicError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['NotFoundError', 'no-device'],
    ['DevicesNotFoundError', 'no-device'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'busy'],
    ['SecurityError', 'insecure'],
    ['NotSupportedError', 'unsupported'],
    ['SomethingElse', 'unknown'],
  ] as const)('maps %s to %s', (name, code) => {
    stubSupported();
    expect(describeMicError(new FakeDomException('raw detail', name)).code).toBe(code);
  });

  it('uses the documented wording for denied and busy', () => {
    stubSupported();
    expect(describeMicError(new FakeDomException('x', 'NotAllowedError')).message).toBe(
      "Microphone access was blocked. Allow it in the browser's site settings and try again.",
    );
    expect(describeMicError(new FakeDomException('x', 'NotReadableError')).message).toContain('The microphone is in use by another app');
  });

  it('never leaks raw error text', () => {
    stubSupported();
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'Weird']) {
      const described = describeMicError(new FakeDomException('Device "Secret Mic 9000" at /dev/snd failed\n    at stack', name));
      expect(described.message).not.toMatch(/Secret|dev\/snd|stack/);
    }
  });

  it('handles non-error values', () => {
    stubSupported();
    expect(describeMicError(undefined).code).toBe('unknown');
    expect(describeMicError(null).code).toBe('unknown');
    expect(describeMicError('boom').code).toBe('unknown');
    expect(describeMicError({ name: 42 }).code).toBe('unknown');
  });

  it('reports insecure contexts whatever the error was', () => {
    stubSupported();
    vi.stubGlobal('window', { isSecureContext: false });
    expect(describeMicError(new TypeError('x')).code).toBe('insecure');
    expect(describeMicError(new FakeDomException('x', 'NotAllowedError')).code).toBe('insecure');
  });

  it('reports missing APIs as unsupported', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('AudioWorkletNode', class {});
    expect(describeMicError(new TypeError('x')).code).toBe('unsupported');
    vi.stubGlobal('navigator', { mediaDevices: {} });
    expect(describeMicError(new TypeError('x')).code).toBe('unsupported');
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve() } });
    vi.stubGlobal('AudioWorkletNode', undefined);
    expect(describeMicError(new TypeError('x')).code).toBe('unsupported');
  });
});

describe('micUnsupportedReason', () => {
  it('is null when everything is available', () => {
    stubSupported();
    vi.stubGlobal('window', { isSecureContext: true });
    expect(micUnsupportedReason()).toBeNull();
  });

  it('explains insecure and unsupported environments', () => {
    stubSupported();
    vi.stubGlobal('window', { isSecureContext: false });
    expect(micUnsupportedReason()?.code).toBe('insecure');
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', {});
    expect(micUnsupportedReason()?.code).toBe('unsupported');
  });
});
