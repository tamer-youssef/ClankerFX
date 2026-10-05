/**
 * Accessibility + responsive regression check. Starts its own Vite dev server, drives the real app in headless Chromium
 * through every meaningful UI state at desktop and phone widths and runs axe-core (WCAG 2.0/2.1/2.2 A + AA and
 * best-practice rules) in each one. On top of axe it checks that the page never scrolls sideways and that every
 * visible interactive control is at least 24x24 CSS px (WCAG 2.2 SC 2.5.8).
 *
 *   npm run check:a11y
 *
 * Playwright and axe-core are intentionally not project dependencies:
 *   NODE_PATH=$(npm root -g) npm run check:a11y        (global playwright + axe-core)
 *   npm install --no-save axe-core                      (axe-core only; playwright from the global install)
 *
 * Options (environment variables):
 *   A11Y_WIDTHS=1280,768,390   viewport widths to run (default 1280,390)
 *   A11Y_VERBOSE=1             also list minor axe findings and axe "incomplete" (needs review) items
 *
 * Exit code is 1 when any state has an axe violation of impact serious/critical, a moderate violation that is not in
 * ALLOWED_MODERATE below, an overflow, or an undersized target.
 */
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
function need(name, resolve) {
  try {
    return resolve();
  } catch {
    console.error(`Cannot find "${name}". Playwright and axe-core are not project dependencies:\n  NODE_PATH=$(npm root -g) npm run check:a11y   (global installs)\n  npm install --no-save axe-core playwright     (local, without touching package.json)`);
    process.exit(2);
  }
}
const { chromium } = need('playwright', () => require('playwright'));
const axeSource = need('axe-core', () => require.resolve('axe-core/axe.min.js'));

const PORT = 5199;
const WIDTHS = (process.env.A11Y_WIDTHS ?? '1280,390').split(',').map(Number);
const HEIGHTS = { 1280: 900, 768: 1024, 390: 800 };
const VERBOSE = process.env.A11Y_VERBOSE === '1';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Moderate-impact axe rules that are tolerated, each with the reason. Keep this list short and justified;
 * serious/critical violations can never be allow-listed.
 */
const ALLOWED_MODERATE = [
  // Example: { rule: 'region', reason: 'why this is a false positive here' },
];

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures

/** A tiny 16-bit mono WAV: a decaying two-tone "voice" so levels and the waveform are not flat. */
function makeWav(seconds, baseHz) {
  const sampleRate = 16000;
  const frames = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const env = 0.5 * (1 + Math.sin(2 * Math.PI * 2 * t));
    const v = 0.5 * env * (Math.sin(2 * Math.PI * baseHz * t) + 0.4 * Math.sin(2 * Math.PI * baseHz * 2.01 * t));
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 30000), 44 + i * 2);
  }
  return buffer;
}
const wav = (name, seconds, hz) => ({ name, mimeType: 'audio/wav', buffer: makeWav(seconds, hz) });
const FILES = [wav('robot_hello.wav', 2, 140), wav('robot_attack.wav', 1.5, 190), wav('robot_idle.wav', 1.2, 110)];
const TEXT_FILE = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') };

// ---------------------------------------------------------------------------------------------------------------------
// Reporting

const results = []; // { name, ok, notes: string[] }
let currentWidth = 0;

const nodeTarget = (node) => node.target.join(' ').slice(0, 140);

async function audit(page, state) {
  const name = `${state} @${currentWidth}`;
  await page.waitForTimeout(150);
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.addScriptTag({ path: axeSource });
  const axeResult = await page.evaluate(
    (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] }),
    AXE_TAGS,
  );

  const notes = [];
  let ok = true;
  for (const violation of axeResult.violations) {
    const allowed = violation.impact === 'moderate' && ALLOWED_MODERATE.some((entry) => entry.rule === violation.id);
    const blocking = (violation.impact === 'serious' || violation.impact === 'critical' || violation.impact === 'moderate') && !allowed;
    if (blocking) ok = false;
    if (blocking || VERBOSE) {
      notes.push(`${blocking ? 'FAIL' : 'note'} axe ${violation.id} [${violation.impact}] x${violation.nodes.length}: ${violation.help}`);
      for (const node of violation.nodes.slice(0, 4)) notes.push(`      ${nodeTarget(node)}  ${(node.failureSummary ?? '').split('\n')[1] ?? ''}`.trimEnd());
    }
  }
  if (VERBOSE) {
    for (const item of axeResult.incomplete) {
      notes.push(`review axe ${item.id} x${item.nodes.length}: ${item.help}`);
      for (const node of item.nodes.slice(0, 3)) {
        const why = node.any.concat(node.all, node.none).map((check) => check.message).join(' / ');
        notes.push(`      ${nodeTarget(node)}  ${why.slice(0, 160)}`);
      }
    }
  }

  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const overflowX = root.scrollWidth - root.clientWidth;
    const small = [];
    const controls = document.querySelectorAll('button, input:not([type="hidden"]), select, textarea, [role="slider"], [role="switch"], a[href], audio[controls]');
    for (const el of controls) {
      if (el instanceof HTMLInputElement && el.type === 'file') continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < 24 - 0.01 || rect.height < 24 - 0.01) {
        const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 24) || el.className;
        small.push(`${el.tagName.toLowerCase()} "${label}" ${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`);
      }
    }
    return { overflowX, small };
  });
  if (layout.overflowX > 0) {
    ok = false;
    notes.push(`FAIL horizontal page scroll: ${layout.overflowX}px`);
  }
  if (layout.small.length > 0) {
    ok = false;
    notes.push(`FAIL targets under 24x24: ${layout.small.slice(0, 6).join('; ')}`);
  }
  // axe reports "incomplete" for text over overlapping layers (dialogs, popovers); composite the backgrounds ourselves.
  const lowContrast = await page.evaluate(measureTextContrast);
  if (lowContrast.length > 0) {
    ok = false;
    notes.push(`FAIL text contrast: ${lowContrast.slice(0, 5).join('; ')}`);
  }
  results.push({ name, ok, notes });
}

/** Runs in the page. Composites ancestor backgrounds (all solid or flat-alpha in this app) and checks WCAG AA text contrast. */
function measureTextContrast() {
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const over = (front, back) => ({
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  });
  const channel = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const failures = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const el = node.parentElement;
    if (!el || !node.textContent.trim() || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('.sr-only, .recorder__sr, [inert], :disabled, [aria-disabled="true"]')) continue;
    if (el.closest('label')?.querySelector(':disabled')) continue; // label of a disabled control: exempt like the control
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.visibility === 'hidden' || style.display === 'none' || rect.width === 0 || rect.height === 0) continue;
    let background = { r: 11, g: 13, b: 16, a: 1 }; // --bg, under everything
    let opacity = 1;
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    for (const e of chain.reverse()) {
      const s = getComputedStyle(e);
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) background = over(c, background);
      opacity *= parseFloat(s.opacity);
    }
    const color = parse(style.color);
    const text = over({ ...color, a: color.a * opacity }, background);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    const needed = large ? 3 : 4.5;
    const actual = ratio(text, background);
    if (actual < needed) failures.push(`${actual.toFixed(2)}<${needed} "${node.textContent.trim().slice(0, 24)}" (${el.className.toString().slice(0, 30) || el.tagName})`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers that drive the app

const openFiles = async (page, files) => {
  await page.locator('input[type="file"]').first().setInputFiles(files);
};
const waitForWaveform = (page) => page.getByRole('slider', { name: 'Playback position' }).waitFor({ timeout: 15000 });

async function addEffect(page, label) {
  await page.getByRole('button', { name: '+ Add Effect' }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).click();
}

async function expandAllAdvanced(page) {
  const toggles = page.getByRole('button', { name: /Advanced/ });
  for (let i = 0, n = await toggles.count(); i < n; i++) {
    const toggle = toggles.nth(i);
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenarios

async function scenarioEmptyAndNotice(page) {
  await page.getByRole('button', { name: 'Choose audio files…' }).waitFor();
  await audit(page, 'empty');
  await openFiles(page, [TEXT_FILE]);
  await page.getByRole('alert').or(page.getByRole('status').filter({ hasText: /./ })).first().waitFor({ timeout: 5000 });
  await audit(page, 'notice toast (unsupported file)');
}

async function scenarioSingleFile(page) {
  await openFiles(page, [FILES[0]]);
  await waitForWaveform(page);
  await audit(page, 'one file, empty rack');

  await addEffect(page, 'Ring Modulator');
  await addEffect(page, 'Pitch Shift');
  await addEffect(page, 'Vocoder');
  await addEffect(page, 'Delay');
  await page.getByRole('switch', { name: /Delay/ }).click(); // one effect switched off (dimmed card)
  await page.getByRole('button', { name: 'Bypass Ring Modulator' }).click();
  await audit(page, 'rack with effects');
  await expandAllAdvanced(page);
  await audit(page, 'rack, advanced panels open');

  await page.getByRole('button', { name: 'Bypass all' }).click();
  await audit(page, 'bypass all (Original)');
  await page.getByRole('button', { name: 'Original' }).click();

  await page.getByRole('button', { name: '+ Add Effect' }).click();
  await audit(page, 'Add Effect menu open');
  await page.keyboard.press('Escape');

  await page.getByRole('radio', { name: 'Peak normalize' }).click();
  await audit(page, 'output: peak normalize');
  await page.getByRole('radio', { name: 'Match loudness' }).click();
  await page.waitForTimeout(600);
  await audit(page, 'output: match loudness + readouts');
  await page.getByRole('switch', { name: 'Limiter' }).uncheck();
  await audit(page, 'output: limiter off');
  await page.getByRole('radio', { name: 'Off', exact: true }).click();
  await page.getByRole('switch', { name: 'Limiter' }).check();

  // Presets popover, saving, rename mode.
  await page.getByRole('button', { name: /Presets|^Robot/ }).first().click();
  await audit(page, 'presets popover');
  await page.getByLabel('New preset name').fill('My voice');
  await page.getByRole('button', { name: 'Save current chain' }).click();
  await page.getByRole('button', { name: 'Rename My voice' }).click();
  await audit(page, 'presets popover, rename mode');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Mutate' }).click();
  await audit(page, 'mutate popover');
  await page.getByRole('button', { name: 'Create' }).click();
  await audit(page, 'mutate popover, confirmation');
  await page.keyboard.press('Escape');
}

async function scenarioExport(page) {
  await openFiles(page, [FILES[0]]);
  await waitForWaveform(page);
  await addEffect(page, 'Ring Modulator');
  await page.getByRole('button', { name: 'Export WAV' }).click();
  await page.getByRole('dialog', { name: 'Export WAV' }).waitFor();
  await page.waitForTimeout(500);
  await audit(page, 'export dialog');

  await page.evaluate(() => {
    window.__failRender = true;
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Export WAV' }).click();
  await page.getByRole('alert').filter({ hasText: /export did not finish/i }).waitFor();
  await audit(page, 'export dialog, failed export');

  await page.evaluate(() => {
    window.__failRender = false;
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Retry export' }).click();
  await page.getByText(/^Saved /).waitFor({ timeout: 20000 });
  await audit(page, 'export dialog, saved');
  await page.keyboard.press('Escape');
}

async function scenarioRecord(page, denied) {
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByRole('dialog', { name: 'Record' }).waitFor();
  await audit(page, 'record dialog: idle');
  await page.getByRole('button', { name: 'Start recording' }).click();
  if (denied) {
    await page.getByRole('alert').filter({ hasText: /microphone/i }).waitFor();
    await audit(page, 'record dialog: permission denied');
    return;
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Stop' }).waitFor();
  await page.waitForTimeout(700);
  await audit(page, 'record dialog: recording');
  await page.getByRole('dialog').getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Use recording' }).waitFor();
  await audit(page, 'record dialog: stopped');
  await page.keyboard.press('Escape');
}

async function scenarioBatch(page) {
  await openFiles(page, FILES);
  await waitForWaveform(page);
  await page.getByRole('region', { name: /^Batch/ }).waitFor();
  await addEffect(page, 'Ring Modulator');
  await audit(page, 'batch panel, idle');

  await page.getByRole('radio', { name: 'Variations' }).check();
  await audit(page, 'batch panel, variations options');
  await page.getByRole('radio', { name: 'Processed copies' }).check();
  await page.getByRole('checkbox', { name: 'Include robot_idle.wav' }).uncheck();
  await page.getByRole('button', { name: 'Match loudness -23 LUFS' }).or(page.getByRole('button', { name: /^Match loudness/ })).first().click().catch(() => {});

  await page.evaluate(() => {
    window.__slowRender = 900;
  });
  await page.getByRole('button', { name: /^Process/ }).click();
  await page.getByRole('progressbar').waitFor({ timeout: 10000 });
  await audit(page, 'batch panel, mid-run progress');

  await page.evaluate(() => {
    window.__slowRender = 0;
  });
  await page.getByRole('button', { name: 'Download again' }).waitFor({ timeout: 30000 });
  await audit(page, 'batch panel, results table');
}

/** Records one named boolean expectation as a state result. */
function expectState(name, ok, detail = '') {
  results.push({ name: `${name} @${currentWidth}`, ok, notes: ok ? [] : [`FAIL ${detail || 'expectation not met'}`] });
}
const focusedLabel = (page) =>
  page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 40));

/** Keyboard-only behaviour: skip link, modal trap + Escape + focus return, popover Escape, menu arrows, reorder buttons. */
async function scenarioKeyboard(page) {
  await page.getByRole('button', { name: 'Choose audio files…' }).waitFor();
  await page.keyboard.press('Tab');
  expectState('keyboard: skip link is the first tab stop', (await focusedLabel(page)) === 'Skip to main content');
  await page.keyboard.press('Enter');
  expectState('keyboard: skip link moves focus into <main>', await page.evaluate(() => document.activeElement?.id === 'main'));

  await openFiles(page, [FILES[0]]);
  await waitForWaveform(page);
  await addEffect(page, 'Ring Modulator');
  await addEffect(page, 'Delay');

  // Add Effect menu: opens onto its first item, arrows move, Escape closes and returns focus.
  const add = page.getByRole('button', { name: '+ Add Effect' });
  await add.focus();
  await page.keyboard.press('Enter');
  const firstItem = await focusedLabel(page);
  await page.keyboard.press('End');
  const lastItem = await focusedLabel(page);
  expectState('keyboard: Add Effect menu takes focus and End moves within it', firstItem !== '' && firstItem !== lastItem && (await page.getByRole('menu').count()) === 1);
  await page.keyboard.press('Escape');
  expectState('keyboard: Escape closes the Add Effect menu and refocuses its button', (await page.getByRole('menu').count()) === 0 && (await focusedLabel(page)).startsWith('+ Add Effect'));

  // Popovers: Escape closes and returns focus to the trigger; tabbing out closes them.
  for (const [name, trigger] of [['Presets', page.getByRole('button', { name: /Presets|^Robot/ }).first()], ['Mutate', page.getByRole('button', { name: 'Mutate' })]]) {
    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
    await page.keyboard.press('Escape');
    const closed = (await page.getByRole('dialog').count()) === 0;
    expectState(`keyboard: ${name} popover is reachable by Tab, Escape closes it and returns focus`, inside && closed && (await trigger.evaluate((el) => el === document.activeElement)));
    await trigger.focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 40 && (await page.getByRole('dialog').count()) > 0; i++) await page.keyboard.press('Tab');
    expectState(`keyboard: tabbing out of the ${name} popover closes it`, (await page.getByRole('dialog').count()) === 0);
  }

  // Modal dialogs trap Tab, close on Escape and restore focus to the opener.
  for (const [button, dialog] of [['Export WAV', 'Export WAV'], ['Record', 'Record']]) {
    const opener = page.getByRole('button', { name: button, exact: true }).first();
    await opener.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: dialog }).waitFor();
    let trapped = true;
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
      trapped &&= await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
    }
    expectState(`keyboard: ${dialog} dialog traps Tab`, trapped);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    expectState(`keyboard: Escape closes the ${dialog} dialog and focus returns to its opener`, (await page.getByRole('dialog').count()) === 0 && (await opener.evaluate((el) => el === document.activeElement)));
  }

  // The waveform slider and the reorder buttons (the keyboard alternative to dragging).
  const waveform = page.getByRole('slider', { name: 'Playback position' });
  await waveform.focus();
  await page.keyboard.press('End');
  const atEnd = await waveform.getAttribute('aria-valuenow');
  await page.keyboard.press('Home');
  expectState('keyboard: waveform slider supports End / Home', Number(atEnd) > 1.9 && Number(await waveform.getAttribute('aria-valuenow')) < 0.1);
  await page.getByRole('button', { name: 'Move Ring Modulator down' }).focus();
  await page.keyboard.press('Enter');
  const order = await page.locator('.effect-card__title').allTextContents();
  expectState('keyboard: Move down reorders the chain and keeps focus on a move button', order[0] === 'Delay' && (await focusedLabel(page)).startsWith('Move Ring Modulator'));
}

// ---------------------------------------------------------------------------------------------------------------------

/** Lets tests slow down or fail the offline renderer deterministically (mid-run progress, failed export). */
const PATCH_RENDERING = () => {
  const original = OfflineAudioContext.prototype.startRendering;
  OfflineAudioContext.prototype.startRendering = async function patched(...args) {
    if (window.__failRender) throw new Error('forced failure');
    if (window.__slowRender) await new Promise((resolve) => setTimeout(resolve, window.__slowRender));
    return original.apply(this, args);
  };
};

const server = await createServer({ server: { port: PORT, strictPort: false }, logLevel: 'error' });
await server.listen();
const port = server.config.server.port ?? PORT;
const origin = `http://localhost:${port}/`;
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

async function withPage(width, { denyMic = false } = {}, body) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] ?? 800 },
    permissions: ['microphone'],
    acceptDownloads: true,
  });
  await context.addInitScript(PATCH_RENDERING);
  if (denyMic) {
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
  }
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  try {
    await page.goto(origin);
    await body(page);
  } catch (error) {
    results.push({ name: `scenario crashed @${width}`, ok: false, notes: [String(error?.message ?? error).split('\n').slice(0, 6).join('\n      ')] });
  } finally {
    if (pageErrors.length > 0) results.push({ name: `page errors @${width}`, ok: false, notes: pageErrors.slice(0, 3) });
    await context.close();
  }
}

try {
  for (const width of WIDTHS) {
    currentWidth = width;
    await withPage(width, {}, scenarioKeyboard);
    await withPage(width, {}, scenarioEmptyAndNotice);
    await withPage(width, {}, scenarioSingleFile);
    await withPage(width, {}, scenarioExport);
    await withPage(width, {}, (page) => scenarioRecord(page, false));
    await withPage(width, { denyMic: true }, (page) => scenarioRecord(page, true));
    await withPage(width, {}, scenarioBatch);
  }
} finally {
  await browser.close();
  await server.close();
}

let failed = 0;
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}`);
  for (const note of result.notes) console.log(`        ${note}`);
  if (!result.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} states passed`);
process.exit(failed === 0 ? 0 : 1);
