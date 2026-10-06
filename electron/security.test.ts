import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, contentSecurityPolicy, isAllowedRequestUrl, isTrustedSender, resolveAppFile, sanitizeSaveName, uniqueName } from './security';

const root = path.resolve('/opt/app/dist');

describe('resolveAppFile', () => {
  it('serves index.html for the root', () => {
    expect(resolveAppFile(root, '/')).toBe(path.join(root, 'index.html'));
  });
  it('maps ordinary assets', () => {
    expect(resolveAppFile(root, '/assets/app-1.js')).toBe(path.join(root, 'assets', 'app-1.js'));
  });
  it('rejects traversal, encoded traversal, backslashes and NULs', () => {
    expect(resolveAppFile(root, '/../secret')).toBeNull();
    expect(resolveAppFile(root, '/%2e%2e/secret')).toBeNull();
    expect(resolveAppFile(root, '/assets/../../secret')).toBeNull();
    expect(resolveAppFile(root, '/..%5csecret')).toBeNull();
    expect(resolveAppFile(root, '/a%00b')).toBeNull();
    expect(resolveAppFile(root, '/%E0%A4%A')).toBeNull();
  });
  it('does not treat a sibling directory with the same prefix as inside', () => {
    expect(resolveAppFile(root, '/../dist-evil/x')).toBeNull();
  });
});

describe('isAllowedRequestUrl', () => {
  it('allows the app origin, blob and data', () => {
    expect(isAllowedRequestUrl(`${APP_ORIGIN}/index.html`)).toBe(true);
    expect(isAllowedRequestUrl('blob:app://clankerfx/1234')).toBe(true);
    expect(isAllowedRequestUrl('data:audio/wav;base64,AAAA')).toBe(true);
  });
  it('blocks the network, other app hosts and files', () => {
    expect(isAllowedRequestUrl('https://example.com/x')).toBe(false);
    expect(isAllowedRequestUrl('http://localhost:5173/')).toBe(false);
    expect(isAllowedRequestUrl('app://evil/index.html')).toBe(false);
    expect(isAllowedRequestUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedRequestUrl('wss://example.com/')).toBe(false);
    expect(isAllowedRequestUrl('not a url')).toBe(false);
  });
  it('allows only the dev server when one is configured', () => {
    expect(isAllowedRequestUrl('http://localhost:5173/src/main.tsx', 'http://localhost:5173')).toBe(true);
    expect(isAllowedRequestUrl('ws://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedRequestUrl('http://localhost:9999/', 'http://localhost:5173')).toBe(false);
    expect(isAllowedRequestUrl('https://example.com/', 'http://localhost:5173')).toBe(false);
  });
});

describe('isTrustedSender', () => {
  it('trusts the app origin only', () => {
    expect(isTrustedSender(`${APP_ORIGIN}/`)).toBe(true);
    expect(isTrustedSender('https://example.com/')).toBe(false);
    expect(isTrustedSender('app://other/')).toBe(false);
    expect(isTrustedSender('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isTrustedSender('http://localhost:5173/')).toBe(false);
    expect(isTrustedSender('')).toBe(false);
  });
});

describe('sanitizeSaveName', () => {
  it('keeps good names', () => {
    expect(sanitizeSaveName('voice_processed.wav')).toBe('voice_processed.wav');
    expect(sanitizeSaveName('clankerfx_batch.ZIP')).toBe('clankerfx_batch.ZIP');
  });
  it('strips directories and forces an allowed extension', () => {
    expect(sanitizeSaveName('../../etc/passwd')).toBe('passwd.wav');
    expect(sanitizeSaveName('C:\\Windows\\evil.exe')).toBe('evil.exe.wav');
    expect(sanitizeSaveName('.bashrc')).toBe('bashrc.wav');
  });
  it('falls back for empty or non-string input', () => {
    expect(sanitizeSaveName('')).toBe('clankerfx_output.wav');
    expect(sanitizeSaveName('///')).toBe('clankerfx_output.wav');
    expect(sanitizeSaveName(42)).toBe('clankerfx_output.wav');
  });
});

describe('uniqueName', () => {
  it('returns the name when free and numbers it otherwise', () => {
    expect(uniqueName('a.wav', () => false)).toBe('a.wav');
    const taken = new Set(['a.wav', 'a (1).wav']);
    expect(uniqueName('a.wav', (n) => taken.has(n))).toBe('a (2).wav');
  });
});

describe('contentSecurityPolicy', () => {
  it('is locked to self in production and has no unsafe-inline scripts', () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toContain('http');
  });
});
