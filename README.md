# MechVox

A browser-based audio effects rack for designing **robot, radio, mechanical and sci-fi game voices**.
Everything is deterministic DSP running locally — no AI, no server, no uploads, no per-use cost.

> Audio processing happens locally on your device.

**Status:** all 8 phases complete — load audio, waveform, transport, and a reorderable effect rack with Amount sliders:
pitch shift, vocoder, ring modulator, bitcrusher, flanger (AudioWorklets) plus distortion, filter, EQ, chorus, phaser,
compressor, delay, reverb, tremolo, noise, stereo width and gain. Plus 11 built-in presets, user presets (save/rename/duplicate/delete), deterministic Mutate with saved variations, and undo/redo.
Output stage: peak normalisation, LUFS loudness matching, a true-peak brickwall limiter and live level readouts; local WAV export
(16/24-bit, original/44.1/48/96 kHz, mono/stereo). Batch processing: drop many files, apply one chain, match them all to one loudness, export processed copies or
reproducible variations as a ZIP. Microphone recording (raw, local) and a WCAG 2.2 AA accessibility pass are included the plan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # typecheck + production build
# Browser-level checks need Playwright + Chromium (+ axe-core for a11y); they are deliberately not dependencies:
NODE_PATH=$(npm root -g) npm run check:browser   # every effect rendered through the real chain; realtime == offline
NODE_PATH=$(npm root -g) npm run check:a11y      # axe-core + keyboard/contrast/target-size/reflow across all UI states
NODE_PATH=$(npm root -g) npm run check:privacy   # full workflow on a production build; nothing may leave the device
```

Stack: React 19, TypeScript (strict), Vite, Web Audio API, AudioWorklet. No backend.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → on the waveform | Seek ±1 s (Shift: ±5 s) |
| Home / End on the waveform | Jump to start / end |
| Ctrl/⌘+Z | Undo chain edit |
| Ctrl/⌘+Shift+Z or Ctrl+Y | Redo |
