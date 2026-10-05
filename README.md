# MechVox

A browser-based audio effects rack for designing **robot, radio, mechanical and sci-fi game voices**.
Everything is deterministic DSP running locally — no AI, no server, no uploads, no per-use cost.

> Audio processing happens locally on your device.

**Status:** Phase 1 of 8 — load audio (drag & drop or file picker), waveform display, transport
(play / pause / stop / loop / click-to-seek). The effect rack, vocoder, presets, normalisation, export,
batch processing and recording follow the plan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # typecheck + production build
```

Stack: React 19, TypeScript (strict), Vite, Web Audio API, AudioWorklet. No backend.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → on the waveform | Seek ±1 s (Shift: ±5 s) |
| Home / End on the waveform | Jump to start / end |
