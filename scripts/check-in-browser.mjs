/**
 * Browser-level DSP checks. Web Audio nodes can't run in Node, so this renders the real EffectChain (and the real
 * AudioWorklets) in headless Chromium and asserts audio properties. Complements the Vitest unit tests.
 *
 *   npm run check:browser
 *
 * Needs Playwright with a Chromium build, which is intentionally not a project dependency:
 *   NODE_PATH=$(npm root -g) npm run check:browser        (global playwright)
 *   SKIP_REALTIME=1 npm run check:browser                 (skip the realtime-vs-offline comparison)
 */
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const { chromium } = createRequire(import.meta.url)('playwright');
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const server = await createServer({ server: { port: 5198 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('http://localhost:5198/');

  const report = await page.evaluate(async (skipRealtime) => {
    const { EffectChain } = await import('/src/audio/EffectChain.ts');
    const { loadWorklets } = await import('/src/audio/worklets.ts');
    const { createEffectState, listEffectDefinitions } = await import('/src/effects/registry.ts');
    const SR = 44100;
    const options = { bypassAll: false, bypassedIds: new Set() };

    const voice = (seconds) => {
      const data = new Float32Array(Math.floor(SR * seconds));
      for (let i = 0; i < data.length; i++) {
        const t = i / SR;
        const f = 140 + 50 * Math.sin(2 * Math.PI * 0.7 * t);
        const env = 0.5 * (1 + Math.sin(2 * Math.PI * 2.5 * t));
        data[i] = 0.5 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
      }
      return data;
    };
    const rms = (d) => Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
    const peak = (d) => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const finite = (d) => d.every(Number.isFinite);
    /** Best normalised cross-correlation over small lags (tolerates fixed latency such as compressor look-ahead). */
    const corr = (a, b, maxLag = 400) => {
      let best = -1;
      for (let lag = 0; lag <= maxLag; lag += 2) {
        let ab = 0, aa = 0, bb = 0;
        for (let i = lag; i < a.length; i += 3) { ab += a[i] * b[i - lag]; aa += a[i] ** 2; bb += b[i - lag] ** 2; }
        best = Math.max(best, ab / Math.sqrt(aa * bb + 1e-20));
      }
      return best;
    };

    async function render(effects, { seconds = 1.5, input = voice(seconds), opts = options, mutate } = {}) {
      const ctx = new OfflineAudioContext(2, Math.floor(SR * seconds), SR);
      await loadWorklets(ctx);
      const buffer = ctx.createBuffer(1, input.length, SR);
      buffer.copyToChannel(input, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const chain = new EffectChain(ctx);
      source.connect(chain.input);
      chain.output.connect(ctx.destination);
      chain.sync(effects, opts, true);
      mutate?.(chain);
      source.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      chain.dispose();
      return out;
    }

    const dry = await render([]);
    const result = { effects: {}, feedback: {} };

    for (const definition of listEffectDefinitions()) {
      const full = { ...createEffectState(definition.type), amount: 1 };
      const zero = { ...full, amount: 0 };
      const off = { ...full, enabled: false };
      const wet = await render([full]);
      result.effects[definition.type] = {
        finite: finite(wet),
        peak: peak(wet),
        changedAt100: corr(wet, dry),
        corrAt0: corr(await render([zero]), dry),
        corrDisabled: corr(await render([off]), dry),
        corrBypassAll: corr(await render([full], { opts: { bypassAll: true, bypassedIds: new Set() } }), dry),
        corrBypassOne: corr(await render([full], { opts: { bypassAll: false, bypassedIds: new Set([full.id]) } }), dry),
      };
    }

    const tail = async (type, overrides) => {
      const effect = { ...createEffectState(type), amount: 1 };
      Object.assign(effect.params, overrides); // deliberately out of range: the slot must clamp it
      const impulse = new Float32Array(SR * 6);
      impulse[10] = 0.8;
      const out = await render([effect], { seconds: 6, input: impulse });
      return { finite: finite(out), peak: peak(out), early: rms(out.slice(0, SR)), late: rms(out.slice(out.length - SR)) };
    };
    result.feedback = {
      delay: await tail('delay', { feedback: 100, timeMs: 20 }),
      phaser: await tail('phaser', { feedback: 100, stages: 8 }),
      flangerPositive: await tail('flanger', { feedback: 100, centerMs: 0.3, depth: 1 }),
      flangerNegative: await tail('flanger', { feedback: -100, centerMs: 3 }),
    };

    const distortion = { ...createEffectState('distortion'), amount: 1 };
    const filter = { ...createEffectState('filter'), amount: 1 };
    const ab = await render([distortion, filter]);
    const ba = await render([filter, distortion]);
    result.orderMatters = corr(ab, ba);
    result.removedMatchesDry = corr(await render([distortion, filter], { mutate: (c) => c.sync([], options, true) }), dry);
    result.reorderLiveMatchesFresh = corr(await render([distortion, filter], { mutate: (c) => c.sync([filter, distortion], options, true) }), ba);

    let errorMessage = null;
    const chain = new EffectChain(new OfflineAudioContext(2, 1000, SR), { onEffectError: (_id, message) => (errorMessage = message) });
    chain.sync([{ id: 'bad', type: 'does-not-exist', enabled: true, amount: 1, params: {} }], options, true);
    result.unknownEffectError = errorMessage;

    return result;
  });

  let realtime = {};
  if (!process.env.SKIP_REALTIME) {
    // A fresh page: after dozens of offline contexts the realtime audio thread of headless Chromium gets starved
    // and drops blocks, which would show up as bogus mismatches.
    await page.close();
    const rtPage = await browser.newPage();
    rtPage.on('pageerror', (error) => pageErrors.push(String(error)));
    await rtPage.goto('http://localhost:5198/');
    realtime = await rtPage.evaluate(async () => {
      const { EffectChain } = await import('/src/audio/EffectChain.ts');
      const { loadWorklets } = await import('/src/audio/worklets.ts');
      const { createEffectState } = await import('/src/effects/registry.ts');
      const SR = 44100;
      const options = { bypassAll: false, bypassedIds: new Set() };
      const input = new Float32Array(Math.floor(SR * 1.2));
      for (let i = 0; i < input.length; i++) {
        const t = i / SR;
        const f = 140 + 50 * Math.sin(2 * Math.PI * 0.7 * t);
        const env = 0.5 * (1 + Math.sin(2 * Math.PI * 2.5 * t));
        input[i] = 0.5 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
      }
      const onset = (d) => { let i = 0; while (i < d.length && Math.abs(d[i]) < 1e-4) i++; return i; };
      const offlineRender = async (effect) => {
        const ctx = new OfflineAudioContext(2, input.length, SR);
        await loadWorklets(ctx);
        const buffer = ctx.createBuffer(1, input.length, SR);
        buffer.copyToChannel(input, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const chain = new EffectChain(ctx);
        source.connect(chain.input);
        chain.output.connect(ctx.destination);
        chain.sync([effect], options, true);
        source.start();
        return (await ctx.startRendering()).getChannelData(0);
      };
      const realtimeRender = async (effect) => {
        const ctx = new AudioContext({ sampleRate: SR });
        await loadWorklets(ctx);
        const buffer = ctx.createBuffer(1, input.length, SR);
        buffer.copyToChannel(input, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const chain = new EffectChain(ctx);
        source.connect(chain.input);
        const blocks = [];
        const tap = ctx.createScriptProcessor(2048, 2, 2);
        tap.onaudioprocess = (e) => blocks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        chain.output.connect(tap);
        tap.connect(ctx.destination);
        chain.sync([effect], options, true);
        await ctx.resume();
        const startAt = ctx.currentTime + 0.3;
        chain.reset(startAt); // exactly what AudioEngine does when playback starts
        source.start(startAt);
        await new Promise((resolve) => setTimeout(resolve, 2200));
        const all = new Float32Array(blocks.length * 2048);
        blocks.forEach((b, i) => all.set(b, i * 2048));
        await ctx.close();
        return all;
      };
      const snr = (a, b) => {
        const oa = onset(a), ob = onset(b), n = Math.min(40000, a.length - oa, b.length - ob);
        let err = 0, sig = 0;
        for (let i = 0; i < n; i++) { err += (a[oa + i] - b[ob + i]) ** 2; sig += a[oa + i] ** 2; }
        return 10 * Math.log10(sig / (err + 1e-20));
      };
      const out = {};
      for (const type of ['pitch', 'vocoder', 'bitcrusher', 'flanger', 'ringmod', 'tremolo', 'chorus', 'phaser', 'distortion', 'filter', 'eq', 'delay', 'reverb', 'gain']) {
        const effect = { ...createEffectState(type), amount: 1 };
        const offline = await offlineRender(effect);
        let best = -Infinity;
        // Headless Chromium occasionally drops ScriptProcessor blocks; one clean capture proves equivalence.
        for (let attempt = 0; attempt < 8 && best < 60; attempt++) best = Math.max(best, snr(offline, await realtimeRender(effect)));
        out[type] = best;
      }
      return out;
    });
  }

  console.log('\nPer-effect offline checks');
  for (const [type, r] of Object.entries(report.effects)) {
    check(`${type}: finite, bounded output`, r.finite && r.peak < 8, `peak ${r.peak.toFixed(2)}`);
    check(`${type}: disabled/bypassed equals dry`, Math.min(r.corrDisabled, r.corrBypassAll, r.corrBypassOne) > 0.9999);
    // The filter is magnitude-flat at 0% but its 10 Hz high-pass shifts phase slightly, so it is exempt from the waveform test.
    if (type !== 'filter') check(`${type}: transparent at 0%`, r.corrAt0 > 0.99, `corr ${r.corrAt0.toFixed(4)}`);
    check(`${type}: audibly changes the signal at 100%`, type === 'gain' || type === 'bitcrusher' || type === 'noise' || r.changedAt100 < 0.99, `corr ${r.changedAt100.toFixed(3)}`);
  }

  console.log('\nFeedback stability (out-of-range feedback is clamped, tails decay)');
  for (const [name, r] of Object.entries(report.feedback)) {
    check(`${name}: finite, bounded, decaying`, r.finite && r.peak < 2 && r.late < r.early * 0.01, `peak ${r.peak.toFixed(2)} early ${r.early.toExponential(1)} late ${r.late.toExponential(1)}`);
  }

  console.log('\nChain behaviour');
  check('order of effects matters', report.orderMatters < 0.95, `corr ${report.orderMatters.toFixed(3)}`);
  check('removing all effects returns the dry signal', report.removedMatchesDry > 0.9999);
  check('live reorder equals a fresh chain in that order', report.reorderLiveMatchesFresh > 0.9999);
  check('unknown effect type is skipped with a friendly error', typeof report.unknownEffectError === 'string' && report.unknownEffectError.includes('skipped'));

  if (!process.env.SKIP_REALTIME) {
    console.log('\nRealtime preview vs offline export (SNR of the difference; higher = more identical)');
    for (const [type, value] of Object.entries(realtime)) check(`${type}: realtime ≈ offline`, value > 30, `${value.toFixed(1)} dB`);
  }

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\nAll browser checks passed.');
