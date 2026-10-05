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
| Compressor | `DynamicsCompressorNode` |
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
| 3 | AudioWorklet infrastructure: pitch shift, vocoder, flanger, bitcrusher | next |
| 4 | Presets, drag-reorder, mutate, undo/redo | |
| 5 | Peak normalise, LUFS matching, limiter | |
| 6 | Offline render, WAV export | |
| 7 | Batch processing, variations | |
| 8 | Microphone recording, polish, a11y, perf | |

## Web Audio gotchas found by testing (keep in mind when adding effects)

- `lowpass`/`highpass` `Q` is in **dB** and defaults to 1 dB (a resonant peak). Inside a feedback loop this made the
  delay diverge (peak > 100 000). Always set `NON_RESONANT_Q_DB` (see `audio/paramUtils.ts`). Peaking, shelf and
  all-pass filters use linear Q.
- A cycle with no `DelayNode` is muted by the browser, and a delay inside a cycle cannot be shorter than 128 samples.
- Don't `cancelScheduledValues` before `setTargetAtTime` while a slider is moving; it snaps the param back and zippers.

## Verification

Pure logic is unit-tested with Vitest (`npm test`). Web Audio nodes cannot run in Node, so effect behaviour is verified by
rendering the real `EffectChain` through an `OfflineAudioContext` in headless Chromium and checking: finite/bounded output,
transparency at 0 %, exact dry signal when disabled/bypassed, decaying feedback, and reorder/removal.

## Known limits / notes

- The output stage currently uses a native `DynamicsCompressorNode` as an interim safety limiter; Phase 5 replaces it
  with a brickwall limiter.
- Free-running LFOs/noise start when an effect is created, so their phase differs between realtime preview and export.

- `decodeAudioData` resamples to the context sample rate, so "original sample rate" on export will need the
  source rate captured separately (planned in Phase 6).
- Files over 200 MB or 30 minutes are rejected with a friendly message rather than risking an out-of-memory tab.
