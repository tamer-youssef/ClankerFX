/**
 * Desktop shell check. Builds the app, launches the real Electron app (app:// protocol, locked-down window) and drives it
 * with Playwright: loads audio, renders effects (AudioWorklets + analysis worker), exports through the native-dialog IPC
 * (the dialog itself is stubbed), batch-saves into a folder, records from a fake microphone, and proves that the network,
 * pop-ups, navigation and Node are all unreachable from the page.
 *
 *   NODE_PATH=$(npm root -g) npm run check:electron          (needs a display; on a headless Linux box: xvfb-run -a …)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try {
  playwright = require('playwright');
} catch {
  console.error('Cannot find "playwright": NODE_PATH=$(npm root -g) npm run check:electron');
  process.exit(2);
}
const { _electron: electron } = playwright;

const build = spawnSync('npm', ['run', '-s', 'electron:build'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(1);

function makeWav(seconds, hz) {
  const sampleRate = 16000;
  const frames = Math.floor(sampleRate * seconds);
  const b = Buffer.alloc(44 + frames * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(0.5 * Math.sin((2 * Math.PI * hz * i) / sampleRate) * 30000), 44 + i * 2);
  return b;
}
const wav = (name, seconds, hz) => ({ name, mimeType: 'audio/wav', buffer: makeWav(seconds, hz) });

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const out = mkdtempSync(join(tmpdir(), 'clankerfx-check-'));
// CLANKERFX_EXE=release/linux-unpacked/clankerfx tests the packaged build (asar) instead of the source tree.
const packaged = process.env.CLANKERFX_EXE;
const args = [...(packaged ? [] : ['.']), '--use-fake-device-for-media-stream'];
if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
const app = await electron.launch({ executablePath: packaged ? join(root, packaged) : require('electron'), args, cwd: root });
const page = await app.firstWindow();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

try {
  await page.waitForSelector('h1', { timeout: 30000 });

  // --- isolation ---------------------------------------------------------------------------------------------------
  const env = await page.evaluate(async () => {
    const result = {
      origin: location.origin,
      secure: isSecureContext,
      desktop: window.clankerfx?.isDesktop === true,
      apiKeys: Object.keys(window.clankerfx ?? {}).sort().join(','),
      hasRequire: typeof require !== 'undefined',
      hasProcess: typeof process !== 'undefined',
      popup: null,
      fetchBlocked: false,
      xhrBlocked: false,
      imageBlocked: false,
    };
    result.popup = window.open('https://example.com') === null;
    try { await fetch('https://example.com/'); } catch { result.fetchBlocked = true; }
    try { await fetch('http://127.0.0.1:1/'); } catch { /* connection refused counts as blocked too */ }
    result.imageBlocked = await new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(true);
      img.onload = () => resolve(false);
      img.src = 'https://example.com/x.png';
    });
    return result;
  });
  check(env.origin === 'app://clankerfx', 'served from app://clankerfx', env.origin);
  check(env.secure, 'secure context (AudioWorklet and getUserMedia need one)');
  check(env.desktop && env.apiKeys === 'isDesktop,saveFile,saveFiles', 'preload exposes only isDesktop/saveFile/saveFiles', env.apiKeys);
  check(!env.hasRequire && !env.hasProcess, 'no Node globals in the page');
  check(env.popup, 'window.open is denied');
  check(env.fetchBlocked, 'fetch to the internet is blocked');
  check(env.imageBlocked, 'image from the internet is blocked');

  problems.length = 0; // the probes above violate the CSP on purpose

  // --- load audio, effects, playback -------------------------------------------------------------------------------
  await page.setInputFiles('input[type=file]', [wav('robot_hello.wav', 2, 140), wav('robot_attack.wav', 1.5, 190)]);
  await page.waitForSelector('button[aria-label="Play"]', { timeout: 15000 });
  for (const label of ['Vocoder', 'Pitch', 'Flanger', 'Bitcrusher']) {
    await page.getByRole('button', { name: '+ Add Effect' }).click();
    await page.getByRole('menuitem', { name: new RegExp(`^${label}`, 'i') }).first().click();
  }
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForSelector('button[aria-label="Pause"]', { timeout: 5000 });
  await page.waitForTimeout(800);
  const playing = await page.locator('button[aria-label="Pause"]').count();
  check(playing === 1, 'plays through the worklet chain');
  await page.getByRole('button', { name: 'Pause' }).click();

  // --- export through the native save dialog -----------------------------------------------------------------------
  const exportPath = join(out, 'saved', 'robot_hello_processed.wav');
  await app.evaluate(({ dialog }, target) => {
    globalThis.__saveCalls = [];
    dialog.showSaveDialog = async (...a) => {
      const opts = a[a.length - 1];
      globalThis.__saveCalls.push(opts.defaultPath);
      return { canceled: false, filePath: target };
    };
  }, exportPath);
  await app.evaluate(async (_electron, dir) => { process.mainModule.require('node:fs').mkdirSync(dir, { recursive: true }); }, join(out, 'saved'));

  await page.getByRole('button', { name: 'Export WAV' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Export WAV' }).click();
  await page.getByText(/^Saved /).waitFor({ timeout: 60000 });
  const bytes = readFileSync(exportPath);
  check(bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE' && bytes.length > 10000, 'export wrote a valid WAV', `${bytes.length} bytes`);
  const defaultPath = await app.evaluate(() => globalThis.__saveCalls[0]);
  check(defaultPath.endsWith('robot_hello_processed.wav'), 'dialog offered the processed file name', defaultPath);

  // cancel → no "Saved" message
  await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined }); });
  await page.getByRole('dialog').getByRole('button', { name: 'Export WAV' }).click();
  await page.waitForFunction(() => !document.body.textContent.includes('Rendering…'), null, { timeout: 60000 });
  check((await page.getByText(/^Saved /).count()) === 0, 'cancelling the dialog does not claim it saved');
  await page.getByRole('dialog').getByRole('button', { name: /Cancel|Done/ }).click();

  // --- batch into a folder -----------------------------------------------------------------------------------------
  const batchDir = join(out, 'batch');
  await app.evaluate(({ dialog }, dir) => {
    const fs = process.mainModule.require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(process.mainModule.require('node:path').join(dir, 'robot_hello_processed.wav'), 'existing');
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, batchDir);
  await page.locator('select:has(option[value="separate"])').selectOption('separate');
  await page.getByRole('button', { name: /Process & download/ }).click();
  await page.getByText(/processed, 0 failed/).waitFor({ timeout: 90000 });
  const files = readdirSync(batchDir).sort();
  check(files.length === 3 && files.includes('robot_hello_processed (1).wav') && files.includes('robot_attack_processed.wav'), 'batch wrote files without overwriting existing ones', files.join(', '));
  check(readFileSync(join(batchDir, 'robot_hello_processed.wav'), 'utf8') === 'existing', 'existing file left untouched');

  // --- microphone --------------------------------------------------------------------------------------------------
  const mic = await page.evaluate(async () => {
    const r = {};
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); r.audio = true; } catch (e) { r.audio = String(e); }
    try { (await navigator.mediaDevices.getUserMedia({ video: true })).getTracks().forEach((t) => t.stop()); r.video = true; } catch (e) { r.video = 'denied'; }
    return r;
  });
  check(mic.audio === true, 'microphone (audio) permission granted to the app');
  check(mic.video === 'denied', 'camera permission denied', String(mic.video));
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.waitForSelector('[role="meter"]', { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.locator('.recorder__stop').click();
  await page.getByRole('button', { name: /Use recording|Use this/i }).click();
  await page.waitForTimeout(500);
  check((await page.getByRole('dialog').count()) === 0 && (await page.getByRole('button', { name: /Play/ }).count()) === 1, 'recording from the fake microphone completes');

  // --- navigation (last: Playwright waits for the cancelled navigation) ----------------------------------------
  await page.evaluate(() => { window.location.href = 'https://example.com/'; });
  await page.waitForTimeout(500);
  check(page.url().startsWith('app://clankerfx'), 'navigating away is blocked', page.url());

  // --- console ----------------------------------------------------------------------------------------------------
  const real = problems.filter((p) => !/Autofill|DevTools/.test(p));
  check(real.length === 0, 'no console errors or CSP violations', real.slice(0, 3).join(' | '));
} catch (error) {
  failures++;
  console.error('FAIL  script error:', error?.message ?? error);
  console.error(problems.slice(0, 5).join('\n'));
} finally {
  await app.close();
  rmSync(out, { recursive: true, force: true });
}
console.log(failures === 0 ? '\nElectron check passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
