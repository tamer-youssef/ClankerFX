# MechVox architecture

MechVox is a browser-only audio effects rack for robot, radio and game voices. All processing is
deterministic DSP running locally (Web Audio + AudioWorklet). There is no backend, no network I/O for
audio, and no AI/inference of any kind.

## Layers

```
React UI (components/, hooks/, state/)      ← renders state, never touches samples
        │  commands / events
        ▼
Audio engine (audio/)                       ← owns AudioContext, transport, effect graph
        │
        ├── effects/    effect definitions + graph builders (shared by realtime and offline)
        ├── dsp/        pure TypeScript DSP cores (no Web Audio types) used by worklets AND tests
        ├── worklets/   thin AudioWorkletProcessor wrappers around dsp/ cores
        └── analysis/   peak, LUFS, waveform peaks — pure functions over Float32Array
```

Rules that keep this clean:

1. **The engine has no React imports.** It is a class with a small typed event emitter; React reads it
   through `useSyncExternalStore` and per-frame DOM writes (`usePlayhead`), so playback never re-renders the tree.
2. **Effect state is plain data** (`{ id, type, enabled, amount, params }`). It lives in React state (so
   undo/redo, presets and serialization are trivial) and is *projected* onto runtime nodes by the engine.
3. **One graph builder per effect, used for both realtime and export.** An effect's `build(ctx: BaseAudioContext)`
   works with `AudioContext` and `OfflineAudioContext`, so preview and render cannot drift apart.
4. **DSP maths lives in pure `dsp/` classes.** Worklet processors only adapt them to `process()`. This makes the
   interesting algorithms unit-testable in Node and lets the same code run offline.
5. **Everything dangerous is clamped at the schema.** Each parameter declares min/max/default; feedback has hard
   ceilings below 1.0; a final limiter guards the output.

## Effect API

```ts
interface EffectDefinition<P> {
  type: string;
  label: string;
  params: ParamSchema<P>;                    // min / max / default / scale / unit / label per parameter
  mapAmount(amount: number, p: P): P;        // beginner mapping: Amount 0–100% → resolved parameters
  build(ctx: BaseAudioContext): EffectRuntime<P>;
}
interface EffectRuntime<P> {
  input: AudioNode; output: AudioNode;
  update(resolved: P, atTime?: number): void; // smooth AudioParam ramps, never zipper noise
  dispose(): void;
}
```

**Amount contract (all effects):** Amount 0 is transparent and Amount 1 reproduces the configured Advanced
parameters exactly. Wet/dry effects map Amount to `mix`; multi-parameter effects interpolate from a neutral
value to the configured one inside `resolve()`. `blend: 'crossfade'` is an equal-power blend; `blend: 'add'`
keeps the dry signal at unity and adds the effect on top (delay, reverb, chorus, phaser, noise).

`EffectChain.sync(effects[])` diffs the data list against live runtimes (add / remove / reorder / update). Each
slot has an equal-power dry/wet crossfade so enabling, bypassing and Amount=0 are click-free.

## Tone.js vs Web Audio vs AudioWorklet

**Decision: native Web Audio for the graph, custom AudioWorklets for what native nodes cannot do. Tone.js is not
used.** Tone owns its own context wrapper and its stock effects are thin wrappers over the same native nodes;
its pitch shifter is a crude delay-line shifter. The effects that matter most here need custom DSP anyway, and
building straight on `BaseAudioContext` is what lets one graph serve both `AudioContext` and
`OfflineAudioContext`. It can be revisited per-effect if something proves worth the extra bundle weight.

| Effect | Implementation |
| --- | --- |
| Gain, Filter (HP/LP), EQ | `GainNode`, `BiquadFilterNode` chains |
| **Compressor** | **AudioWorklet** (`CompressorCore`) — the native node adds a hidden auto make-up gain of up to +12 dB |
| Delay | `DelayNode` + clamped feedback `GainNode` (+ damping filter) |
| Chorus / Phaser | `DelayNode` / allpass chain with `OscillatorNode` LFOs into `AudioParam`s |
| Tremolo | `OscillatorNode` → `GainNode.gain` |
| Ring modulator | carrier `OscillatorNode` → `GainNode.gain` (true multiply); no worklet needed |
| Distortion / Saturation | `WaveShaperNode` (precomputed curve, 4× oversampling) + tone filter |
| Reverb | `ConvolverNode` with a *seeded* synthetic impulse response (identical realtime/offline) |
| Noise / Static | seeded noise `AudioBuffer` loop → filter → gain |
| Stereo width | mid/side matrix with `ChannelSplitter`/`ChannelMerger` + gains |
| **Flanger** | **AudioWorklet** — a `DelayNode` inside a feedback loop is clamped to one render quantum (~2.9 ms), too long for a flanger comb |
| **Bitcrusher** | **AudioWorklet** — sample-rate reduction (sample & hold) is not expressible natively |
| **Vocoder** | **AudioWorklet** — analysis/synthesis filterbank with asymmetric attack/release envelope followers |
| **Pitch shift** | **AudioWorklet** — windowed dual-tap delay-line shifter; formant control is a later refinement |
| **Output limiter** | **AudioWorklet** — look-ahead brickwall (shares its core with the offline limiter pass) |
| LUFS / peak analysis | pure TS over `Float32Array` (ITU-R BS.1770 K-weighting + gating), run off the audio thread |
| WAV encode | pure TS (16/24-bit PCM, TPDF dither) |

## Signal flow

```
SOURCE → effect chain → loudness match / peak normalise → limiter → destination | WAV encoder
```

Normalisation is applied *after* effects because they change loudness. For export the chain is rendered with an
`OfflineAudioContext`, measured, gain-adjusted, limited, then encoded — all locally.

## Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Project setup, layout, file loading, waveform, transport | **done** |
| 2 | `EffectChain`, effect abstraction, native-node effects, Amount sliders, rack UI | **done** |
| 3 | AudioWorklet infrastructure: pitch shift, vocoder, flanger, bitcrusher | **done** |
| 4 | Presets, mutate, undo/redo (drag-reorder shipped in Phase 2) | **done** |
| 5 | Peak normalise, LUFS matching, brickwall limiter, level readouts | **done** |
| 6 | Offline render, WAV export (16/24-bit, sample rate, mono/stereo) | **done** |
| 7 | Batch processing, multi-file loudness matching, variations | **done** |
| 8 | Microphone recording, polish, a11y, perf | next |

## Presets, Mutate and undo

- **Presets** are plain JSON (`types/presets.ts`): ordered effects with `enabled`, `amount`, `params`. Everything entering the app
  (built-ins, localStorage, future imports) goes through `sanitizeEffectState`, so a bad value can never reach the DSP. User presets
  live in `localStorage` (`mechvox.userPresets.v1`); unparseable data is backed up to `….corrupt` instead of being overwritten.
- **Mutate** (`presets/mutate.ts`) is a pure seeded function: each continuous parameter moves in *slider-position* units (so log
  frequencies vary perceptually evenly) by up to ±8 % / ±20 % / ±40 %, clamped to the parameter's `safe` window (`ParamSpec.safe`) and
  never pushed further outside it than it started. Option parameters may switch on medium/heavy. `createVariants` derives per-variant
  seeds from a base seed, which the Phase 7 batch "variations" feature will reuse.
- **Undo/redo** (`state/history.ts`): snapshots of `{chain, selectedPresetId}`, capped at 100. Edits to the same slider within 1 s
  coalesce into one step (the UI passes a timestamp; reducers stay pure). Bypass/audition state and loaded files are not in history.

## Output stage and export (Phases 5–6)

One pipeline, used for the live measurement *and* for export (`audio/OutputPipeline.ts`):

```
source → effect chain (EffectChain) → [resample] → normalisation gain → brickwall limiter → channel conversion → WAV
```

- **Why measure offline:** effects change loudness, so normalisation must be computed on the *processed* signal. `useOutputAnalysis`
  renders the active file through the chain in an `OfflineAudioContext` (debounced, cached per chain), runs the output stage in a
  Web Worker, and shows input/output peak, loudness before and after, applied gain, limiter reduction, true peak and a clipping flag.
  The measured gain is also applied to the live engine's makeup-gain node, so the preview is level-matched like the export.
- **Normalisation:** *Peak* targets the sample peak (default −1 dBFS). *Match loudness* targets integrated loudness (ITU-R BS.1770-4
  K-weighting, 400 ms blocks, −70 LUFS absolute / −10 LU relative gates; default −20 LUFS for game dialogue). Gain is clamped to ±24 dB.
  Mono files are measured as dual-mono because the app always plays them through both speakers.
- **Limiter** (`dsp/LimiterCore.ts`): look-ahead (5 ms) brickwall with instant attack, 100 ms release and optional 4× true-peak
  detection. The gain at every sample is provably ≤ the required gain (min over the look-ahead window, then a moving average of the
  release-smoothed envelope), so the ceiling holds. The same class runs in the realtime AudioWorklet and offline, and block-wise
  processing is bit-identical to one big buffer. Disabling it raises its ceiling to +60 dB (latency-matched pass-through).
- **Export:** `audio/exporter.ts`. "Original" sample rate comes from the source header (`audioMetadata.ts`), since
  `decodeAudioData` resamples to the context rate. Resampling happens *before* the gain/limiter so what is measured is what is
  written. 16-bit output uses seeded TPDF dither; 24-bit does not. Reverb/delay tails are rendered (`renderTail.ts`) and trailing
  silence is trimmed. Nothing is uploaded; the file is saved through a temporary object-URL link.

## Batch processing (Phase 7)

- **Plan** (`batch/plan.ts`): pure. *Processed copies* → `robot_hello_processed.wav`; *Variations* → `robot_attack_01.wav … _NN.wav`, each
  using `mutateChain` with a seed derived from (base seed, source **file name**, index), so a variant is reproducible and does not
  depend on which other files are selected or their order. Output names are unique across the whole plan.
- **Run** (`audio/batchRunner.ts`): sequential (rendering is CPU-heavy), one bad file never stops the rest, cancellable, progress
  reporting, injectable export function for tests. Every file uses the same chain and normalisation settings, so "Match loudness"
  lands them all on the same target — measured: five inputs spanning 27 dB all export at −20.000 LUFS.
- **Package**: one ZIP (`utils/zip.ts`, STORE method, CRC-32, verified against Python's `zipfile`) or separate downloads.
- Results are tied to a snapshot of the settings that produced them; when chain/normalisation/format change they are shown as outdated.

### Lesson: hidden gain in native nodes

`DynamicsCompressorNode` applies an automatic make-up gain (measured up to +12.6 dB at −24 dB threshold / 20:1) that depends on
threshold and ratio. It made presets and Mutate variants swing in loudness for reasons the sliders did not show, so the compressor is now
our own worklet (`dsp/CompressorCore.ts`): below the threshold the gain is exactly 1.0. When using a native node, measure its actual gain.

## Web Audio gotchas found by testing (keep in mind when adding effects)

- `lowpass`/`highpass` `Q` is in **dB** and defaults to 1 dB (a resonant peak). Inside a feedback loop this made the
  delay diverge (peak > 100 000). Always set `NON_RESONANT_Q_DB` (see `audio/paramUtils.ts`). Peaking, shelf and
  all-pass filters use linear Q.
- A cycle with no `DelayNode` is muted by the browser, and a delay inside a cycle cannot be shorter than 128 samples.
- Don't `cancelScheduledValues` before `setTargetAtTime` while a slider is moving; it snaps the param back and zippers.

## Realtime = export

Preview and export use the same effect builders, and playback start is made deterministic: at every start the engine calls
`EffectChain.reset(at)` and then starts the source at that same moment (25 ms in the future). Native LFOs are swapped for
fresh oscillators scheduled at `at` (`audio/Lfo.ts`); worklets receive `{type:'reset', frame}` and reset their DSP state at
that exact frame (`CoreProcessor` splits the render block at the sample). A message applied on arrival would be wrong,
because the worklet keeps advancing its phases through the silence before the source starts. Result: for a playback from
the start, realtime and offline renders of every effect differ by ≥ 100 dB SNR (floating-point noise).

## Verification

Pure logic is unit-tested with Vitest (`npm test`). Web Audio nodes cannot run in Node, so effect behaviour is verified by
rendering the real `EffectChain` through an `OfflineAudioContext` in headless Chromium and checking: finite/bounded output,
transparency at 0 %, exact dry signal when disabled/bypassed, decaying feedback, reorder/removal, and realtime-vs-offline
equivalence. Run it with `NODE_PATH=$(npm root -g) npm run check:browser` (it needs Playwright + Chromium, deliberately not a
project dependency; it starts its own Vite server). DSP cores in `dsp/` have numerical unit tests: pitch accuracy, comb-filter
geometry, quantiser levels, vocoder band-envelope tracking on synthetic speech.

Lesson: never run these checks against a long-lived `vite` dev server. A warm server served a stale worklet and produced
false "identical" results; the script therefore always starts a fresh one.

## Known limits / notes

- If AudioWorklet is unavailable the live output falls back to a native compressor as a safety limiter (the effects that need worklets are skipped).
- The frame-exact worklet reset needs its message to arrive before playback starts (25 ms lead). Under heavy CPU load a late reset only shifts modulator phase; it never affects level.
- Slider tracks have 1000 positions, so keyboard stepping is done in parameter units (`stepValue`), not by the native range input.
- Realtime and export match when playback starts from the beginning. After a mid-file seek, modulator phases are relative to the seek point, not the file position.
- The pitch shifter is a time-domain two-tap design: formants move with pitch and a little granular warble remains (see `PitchShiftCore`).

- `decodeAudioData` resamples to the context sample rate, so "original sample rate" on export will need the
  source rate captured separately (planned in Phase 6).
- Files over 200 MB or 30 minutes are rejected with a friendly message rather than risking an out-of-memory tab.
