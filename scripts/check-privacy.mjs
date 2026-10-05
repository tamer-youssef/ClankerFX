/**
 * Privacy audit: runs a complete real workflow against a fresh PRODUCTION build while recording every network request,
 * and fails if anything could have left the device. "Audio processing happens locally" is a product promise, so it is tested.
 *
 *   NODE_PATH=$(npm root -g) npm run check:privacy        (needs Playwright + Chromium, deliberately not a dependency)
 *
 * Workflow: load two files → apply a preset → loudness-match → play → export one WAV → batch ZIP → microphone take (fake device)
 * → forced export failure. Passes only if every request is a same-origin GET without a body and no WebSocket is opened.
 */
import { createRequire } from 'node:module';
import { build, preview } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures.push(name);
};

/** 16-bit mono WAV with a voice-like AM tone, built in memory. */
function wav(seconds, amplitude) {
  const sampleRate = 44100;
  const n = Math.floor(seconds * sampleRate);
  const bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + n * 2, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    bytes.writeInt16LE(Math.round(32767 * amplitude * 0.5 * (1 + Math.sin(2 * Math.PI * 3 * t)) * Math.sin(2 * Math.PI * (150 + 30 * Math.sin(t)) * t)), 44 + i * 2);
  }
  return bytes;
}

await build({ logLevel: 'error' });
const server = await preview({ preview: { port: 5350 }, logLevel: 'error' });
const origin = 'http://localhost:5350';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true, permissions: ['microphone'] });
  const page = await context.newPage();
  const requests = [];
  const sockets = [];
  const pageErrors = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), body: (r.postData() || '').length }));
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(origin + '/');
  await page.setInputFiles('input[type=file] >> nth=0', [
    { name: 'robot_hello.wav', mimeType: 'audio/wav', buffer: wav(2, 0.2) },
    { name: 'robot_attack.wav', mimeType: 'audio/wav', buffer: wav(1.5, 0.6) },
  ]);
  await page.waitForSelector('.waveform');
  await page.getByRole('button', { name: /^Presets/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Boss Machine/ }).first().click();
  await page.getByRole('radio', { name: /Match loudness/ }).click();
  await page.click('button[aria-label=Play]');
  await page.waitForTimeout(800);
  await page.click('button[aria-label=Stop]');
  await page.waitForTimeout(1500);

  const [single] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    (async () => {
      await page.getByRole('button', { name: /Export WAV/ }).first().click();
      await page.getByRole('dialog').getByRole('button', { name: /^Export WAV$/ }).click();
    })(),
  ]);
  await single.path();
  await page.keyboard.press('Escape');

  const [zip] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByRole('button', { name: /Process & download/ }).click()]);
  await zip.path();
  check('single export and batch ZIP both produced files', single.suggestedFilename().endsWith('.wav') && zip.suggestedFilename().endsWith('.zip'));

  // Microphone take with Chromium's fake device
  await page.getByRole('button', { name: /^Record/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /Start recording/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('dialog').getByRole('button', { name: /^Stop/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Use recording/ }).click();
  check('microphone take became a file', (await page.locator('.file-chip').count()) === 3);

  // Forced failure should not leak internals
  await page.evaluate(() => { window.OfflineAudioContext = class { constructor() { throw new Error('boom: internal detail 0xDEADBEEF'); } }; });
  await page.getByRole('button', { name: /Export WAV/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /^Export WAV$/ }).click();
  await page.waitForSelector('[role=dialog] [role=alert]', { timeout: 20000 });
  const message = await page.locator('[role=dialog] [role=alert]').first().innerText();
  check('export failure is friendly and leaks no internals', message.length > 0 && !/0xDEADBEEF|\.ts:|Error:|at .*\(/.test(message), JSON.stringify(message));

  const foreign = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  const mutating = requests.filter((r) => r.method !== 'GET' || r.body > 0);
  console.log(`\n${requests.length} requests in total`);
  check('every request is same-origin', foreign.length === 0, foreign.map((r) => r.url).join(' '));
  check('no POST/PUT/PATCH/DELETE and no request body (nothing could carry audio out)', mutating.length === 0, mutating.map((r) => `${r.method} ${r.url}`).join(' '));
  check('no WebSocket connections', sockets.length === 0, sockets.join(' '));
  check('no uncaught page errors', pageErrors.filter((e) => !/boom/.test(e)).length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} privacy check(s) failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nPrivacy check passed: nothing left the device.');
