# ClankerFX

A desktop (Electron) and browser-based audio effects rack for designing **robot, radio, mechanical and sci-fi game voices**.
Everything is deterministic DSP running locally — no AI, no server, no uploads, no per-use cost.

> Audio processing happens locally on your device.

**Status:** all 8 phases complete — load audio, waveform, transport, and a reorderable effect rack with Amount sliders:
pitch shift, vocoder, ring modulator, bitcrusher, flanger (AudioWorklets) plus distortion, filter, EQ, chorus, phaser,
compressor, delay, reverb, tremolo, noise, stereo width and gain. Plus 11 built-in presets, user presets (save/rename/duplicate/delete), deterministic Mutate with saved variations, a Randomize menu (new random chain or re-roll settings, Mild/Wild, always inside safe ranges), and undo/redo. On wide screens the listening column (waveform, transport, output) stays in view beside the scrolling effect rack.
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

## Desktop app (Electron, unsigned, personal use)

```bash
npm run electron:dev     # Vite hot reload inside Electron
npm run electron:start   # build everything and run the desktop app
npm run electron:pack    # unpacked app in release/ (fast; tests the packaged layout)
npm run electron:dist    # installer for the OS you run it on: .dmg (macOS), NSIS .exe (Windows), AppImage (Linux)
```

Installers are **not signed or notarized** and there is no auto-update, which is fine for your own machines:
macOS: right-click → Open the first time (or `xattr -cr /Applications/ClankerFX.app`); Windows: SmartScreen → More info → Run anyway.
Build each installer on its own OS. The shell serves the built app from a private `app://clankerfx/` origin (AudioWorklets and
workers cannot load from `file://`), blocks every network request, allows only the microphone (audio) permission, and saves
exports/batches through native Save/Folder dialogs. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#desktop-shell-electron).

```bash
NODE_PATH=$(npm root -g) xvfb-run -a npm run check:electron   # launches the real app: isolation, export, batch, mic, no network
CLANKERFX_EXE=release/linux-unpacked/clankerfx …              # same check against the packaged build
```

Stack: React 19, TypeScript (strict), Vite, Web Audio API, AudioWorklet, Electron shell. No backend.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → on the waveform | Seek ±1 s (Shift: ±5 s) |
| Home / End on the waveform | Jump to start / end |
| Ctrl/⌘+Z | Undo chain edit |
| Ctrl/⌘+Shift+Z or Ctrl+Y | Redo |
