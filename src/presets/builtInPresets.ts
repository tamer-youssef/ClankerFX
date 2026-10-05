import type { Preset } from '../types/presets';

/** Shipped presets. Plain data: every param is an explicit value inside its schema range (enforced by tests). */
export const builtInPresets: readonly Preset[] = [
  {
    id: 'builtin-security-droid',
    name: 'Security Droid',
    description: 'Buzzy 24-band vocoder with a hint of ring mod: a stern patrol unit.',
    builtIn: true,
    effects: [
      {
        type: 'vocoder',
        amount: 1,
        params: { bands: 24, carrier: 0, carrierHz: 100, lowHz: 120, highHz: 7500, attackMs: 4, releaseMs: 40, formantShift: 1, hiss: 0.35, gateDb: -70, wet: 0.9 },
      },
      { type: 'ringmod', amount: 0.25, params: { frequencyHz: 60, shape: 0 } },
      { type: 'eq', amount: 1, params: { lowDb: -3, lowMidDb: 0, lowMidHz: 450, highMidDb: 4, highMidHz: 2800, highDb: 1 } },
      { type: 'compressor', amount: 1, params: { thresholdDb: -24, ratio: 4, attackMs: 8, releaseMs: 160, makeupDb: 2 } },
    ],
  },
  {
    id: 'builtin-heavy-mech',
    name: 'Heavy Mech',
    description: 'Deep, growling war machine with a metal cockpit boom.',
    builtIn: true,
    effects: [
      { type: 'pitch', amount: 1, params: { semitones: -9, windowMs: 80, wet: 1 } },
      { type: 'distortion', amount: 0.4, params: { driveDb: 12, shape: 0, toneHz: 5000, outputDb: -4 } },
      { type: 'ringmod', amount: 0.35, params: { frequencyHz: 38, shape: 0 } },
      { type: 'filter', amount: 1, params: { highpassHz: 70, lowpassHz: 4500, slope: 12 } },
      { type: 'eq', amount: 1, params: { lowDb: 6, lowMidDb: 1, lowMidHz: 300, highMidDb: -2, highMidHz: 2800, highDb: -4 } },
      { type: 'reverb', amount: 0.2, params: { decaySeconds: 0.8, toneHz: 3500, preDelayMs: 8 } },
    ],
  },
  {
    id: 'builtin-small-service-bot',
    name: 'Small Service Bot',
    description: 'Chirpy, high-pitched helper with a light digital edge.',
    builtIn: true,
    effects: [
      { type: 'pitch', amount: 1, params: { semitones: 4, windowMs: 50, wet: 1 } },
      { type: 'ringmod', amount: 0.4, params: { frequencyHz: 140, shape: 0 } },
      { type: 'bitcrusher', amount: 0.35, params: { bits: 8, rateHz: 16000 } },
      { type: 'eq', amount: 1, params: { lowDb: -3, lowMidDb: 0, lowMidHz: 450, highMidDb: 3, highMidHz: 3200, highDb: 5 } },
    ],
  },
  {
    id: 'builtin-broken-android',
    name: 'Broken Android',
    description: 'Glitchy, stuttering voice with metallic echoes and static.',
    builtIn: true,
    effects: [
      { type: 'bitcrusher', amount: 0.6, params: { bits: 5, rateHz: 6000 } },
      { type: 'tremolo', amount: 0.6, params: { rateHz: 9, depth: 0.7, shape: 2 } },
      { type: 'delay', amount: 0.3, params: { timeMs: 45, feedback: 0.5, dampingHz: 5000 } },
      { type: 'noise', amount: 0.4, params: { kind: 2, levelDb: -30, lowCutHz: 300, highCutHz: 8000 } },
    ],
  },
  {
    id: 'builtin-corrupted-ai',
    name: 'Corrupted AI',
    description: 'A failing machine mind: warped pitch, swirling comb tones and a cavernous tail.',
    builtIn: true,
    effects: [
      { type: 'pitch', amount: 0.6, params: { semitones: -6, windowMs: 60, wet: 0.8 } },
      { type: 'flanger', amount: 0.6, params: { rateHz: 0.3, centerMs: 3, depth: 0.8, feedback: 0.7 } },
      { type: 'bitcrusher', amount: 0.4, params: { bits: 4, rateHz: 10000 } },
      { type: 'distortion', amount: 0.3, params: { driveDb: 10, shape: 2, toneHz: 6000, outputDb: -5 } },
      { type: 'delay', amount: 0.25, params: { timeMs: 180, feedback: 0.45, dampingHz: 4000 } },
      { type: 'reverb', amount: 0.4, params: { decaySeconds: 3.5, toneHz: 4000, preDelayMs: 20 } },
    ],
  },
  {
    id: 'builtin-military-radio',
    name: 'Military Radio',
    description: 'Squashed, band-limited comms chatter with static crackle.',
    builtIn: true,
    effects: [
      { type: 'filter', amount: 1, params: { highpassHz: 400, lowpassHz: 2800, slope: 24 } },
      { type: 'distortion', amount: 0.25, params: { driveDb: 8, shape: 1, toneHz: 4000, outputDb: -4 } },
      { type: 'compressor', amount: 1, params: { thresholdDb: -32, ratio: 10, attackMs: 3, releaseMs: 120, makeupDb: 4 } },
      { type: 'noise', amount: 0.35, params: { kind: 2, levelDb: -32, lowCutHz: 400, highCutHz: 5000 } },
    ],
  },
  {
    id: 'builtin-intercom',
    name: 'Intercom',
    description: 'Narrow, slightly buzzy wall speaker in a small room.',
    builtIn: true,
    effects: [
      { type: 'filter', amount: 1, params: { highpassHz: 300, lowpassHz: 3800, slope: 12 } },
      { type: 'eq', amount: 1, params: { lowDb: -4, lowMidDb: 2, lowMidHz: 600, highMidDb: 4, highMidHz: 2500, highDb: -3 } },
      { type: 'distortion', amount: 0.2, params: { driveDb: 6, shape: 0, toneHz: 5000, outputDb: -3 } },
      { type: 'reverb', amount: 0.12, params: { decaySeconds: 0.4, toneHz: 4000, preDelayMs: 4 } },
      { type: 'noise', amount: 0.2, params: { kind: 0, levelDb: -38, lowCutHz: 500, highCutHz: 6000 } },
    ],
  },
  {
    id: 'builtin-damaged-speaker',
    name: 'Damaged Speaker',
    description: 'Blown cone: boxy mids, harsh clipping and rattling crackle.',
    builtIn: true,
    effects: [
      { type: 'eq', amount: 1, params: { lowDb: -5, lowMidDb: 3, lowMidHz: 500, highMidDb: 6, highMidHz: 2000, highDb: -8 } },
      { type: 'distortion', amount: 0.55, params: { driveDb: 20, shape: 1, toneHz: 3500, outputDb: -6 } },
      { type: 'filter', amount: 1, params: { highpassHz: 180, lowpassHz: 3500, slope: 12 } },
      { type: 'noise', amount: 0.4, params: { kind: 2, levelDb: -30, lowCutHz: 200, highCutHz: 6000 } },
    ],
  },
  {
    id: 'builtin-retro-robot',
    name: 'Retro Robot',
    description: 'Classic 8-bit sci-fi: crunchy, hollow and square.',
    builtIn: true,
    effects: [
      { type: 'bitcrusher', amount: 0.55, params: { bits: 6, rateHz: 7000 } },
      { type: 'ringmod', amount: 0.5, params: { frequencyHz: 90, shape: 1 } },
      {
        type: 'vocoder',
        amount: 0.6,
        params: { bands: 8, carrier: 1, carrierHz: 120, lowHz: 150, highHz: 6000, attackMs: 4, releaseMs: 40, formantShift: 1, hiss: 0.3, gateDb: -70, wet: 1 },
      },
    ],
  },
  {
    id: 'builtin-synthetic-voice',
    name: 'Synthetic Voice',
    description: 'Clean, smooth 24-band vocoder with a touch of chorus: a polished synthetic speaker.',
    builtIn: true,
    effects: [
      {
        type: 'vocoder',
        amount: 1,
        params: { bands: 24, carrier: 0, carrierHz: 130, lowHz: 100, highHz: 8000, attackMs: 3, releaseMs: 30, formantShift: 1.05, hiss: 0.45, gateDb: -70, wet: 1 },
      },
      { type: 'chorus', amount: 0.35, params: { rateHz: 0.8, depthMs: 2.5, delayMs: 14 } },
      { type: 'reverb', amount: 0.15, params: { decaySeconds: 1, toneHz: 6000, preDelayMs: 10 } },
    ],
  },
  {
    id: 'builtin-boss-machine',
    name: 'Boss Machine',
    description: 'Towering final-boss voice: huge, nasal and echoing through a vast chamber.',
    builtIn: true,
    effects: [
      { type: 'pitch', amount: 1, params: { semitones: -10, windowMs: 80, wet: 1 } },
      {
        type: 'vocoder',
        amount: 0.8,
        params: { bands: 16, carrier: 2, carrierHz: 70, lowHz: 100, highHz: 6500, attackMs: 4, releaseMs: 50, formantShift: 0.8, hiss: 0.3, gateDb: -70, wet: 0.85 },
      },
      { type: 'distortion', amount: 0.35, params: { driveDb: 12, shape: 0, toneHz: 5000, outputDb: -4 } },
      { type: 'ringmod', amount: 0.3, params: { frequencyHz: 30, shape: 0 } },
      { type: 'compressor', amount: 1, params: { thresholdDb: -24, ratio: 5, attackMs: 8, releaseMs: 200, makeupDb: 2 } },
      { type: 'reverb', amount: 0.4, params: { decaySeconds: 3.5, toneHz: 4000, preDelayMs: 25 } },
    ],
  },
];
