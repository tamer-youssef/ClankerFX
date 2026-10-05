import { useRef, type KeyboardEvent } from 'react';
import { useApp } from '../../state/AppContext';
import { getActiveFile } from '../../state/appState';
import type { NormalizeMode } from '../../types/output';
import { Slider } from '../common/Slider';
import { formatDb, formatLufs, nextValue, toPosition } from './levels';
import './OutputPanel.css';

const MODES: ReadonlyArray<{ value: NormalizeMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'peak', label: 'Peak normalize' },
  { value: 'loudness', label: 'Match loudness' },
];

const PEAK = { min: -12, max: 0, step: 0.5 };
const LOUDNESS = { min: -30, max: -10, step: 0.5 };
const CEILING = { min: -6, max: 0, step: 0.1 };

export function OutputPanel() {
  const { state, dispatch } = useApp();
  const { normalization, measurements, measuring } = state;
  const hasFile = getActiveFile(state) !== null;
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const set = (changes: Partial<typeof normalization>) => dispatch({ type: 'output/setNormalization', changes });

  const onModeKey = (event: KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % MODES.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + MODES.length) % MODES.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MODES.length - 1;
    else return;
    event.preventDefault();
    set({ mode: MODES[next]!.value });
    radioRefs.current[next]?.focus();
  };

  const m = hasFile ? measurements : null;
  const overs = m !== null && !m.clipped && m.finalTruePeakDb > 0;

  return (
    <section className="output" aria-labelledby="output-title">
      <div className="output__head">
        <h2 id="output-title" className="panel-title">
          Output
        </h2>
        <span className="output__measuring" role="status" aria-live="polite">
          {measuring ? 'Measuring…' : ''}
        </span>
      </div>

      <div className="output__body">
        <div className="output__controls">
          <div className="output__field">
            <span id="output-mode-label" className="output__label">
              Normalization
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="output-mode-label">
              {MODES.map((mode, index) => {
                const checked = normalization.mode === mode.value;
                return (
                  <button
                    key={mode.value}
                    ref={(node) => {
                      radioRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    className="segmented__option"
                    onClick={() => set({ mode: mode.value })}
                    onKeyDown={(event) => onModeKey(event, index)}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
          </div>

          {normalization.mode === 'peak' && (
            <div className="output__field">
              <Slider
                label="Target peak"
                position={toPosition(normalization.peakTargetDb, PEAK.min, PEAK.max)}
                valueText={formatDb(normalization.peakTargetDb, { unit: 'dBFS' })}
                onPositionChange={(p) => set({ peakTargetDb: nextValue(p, normalization.peakTargetDb, PEAK.min, PEAK.max, PEAK.step) })}
              />
              <p className="output__hint">Scales the loudest sample to this level.</p>
            </div>
          )}
          {normalization.mode === 'loudness' && (
            <div className="output__field">
              <Slider
                label="Target loudness"
                position={toPosition(normalization.loudnessTargetLufs, LOUDNESS.min, LOUDNESS.max)}
                valueText={formatLufs(normalization.loudnessTargetLufs)}
                onPositionChange={(p) => set({ loudnessTargetLufs: nextValue(p, normalization.loudnessTargetLufs, LOUDNESS.min, LOUDNESS.max, LOUDNESS.step) })}
              />
              <p className="output__hint">Game dialogue: about −23 to −16 LUFS.</p>
            </div>
          )}

          <div className="output__field output__limiter">
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                checked={normalization.limiterEnabled}
                onChange={(event) => set({ limiterEnabled: event.target.checked })}
              />
              <span className="switch__track" aria-hidden="true" />
              <span className="switch__text">Limiter</span>
            </label>
            <Slider
              label="Ceiling"
              position={toPosition(normalization.ceilingDb, CEILING.min, CEILING.max)}
              valueText={formatDb(normalization.ceilingDb, { unit: 'dBFS' })}
              disabled={!normalization.limiterEnabled}
              onPositionChange={(p) => set({ ceilingDb: nextValue(p, normalization.ceilingDb, CEILING.min, CEILING.max, CEILING.step) })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={normalization.truePeak}
                disabled={!normalization.limiterEnabled}
                onChange={(event) => set({ truePeak: event.target.checked })}
              />
              <span>True-peak safe</span>
            </label>
            {normalization.limiterEnabled && (
              <p className="output__hint">Keeps peaks under the ceiling. True-peak mode also catches inter-sample overs.</p>
            )}
            {!normalization.limiterEnabled && (
              <p className="output__caution">Limiter off: peaks above 0 dBFS will clip in the exported WAV.</p>
            )}
          </div>
        </div>

        <div className="output__readouts" aria-label="Output levels">
          {m === null ? (
            <p className="output__placeholder">{hasFile ? (measuring ? 'Measuring…' : 'No levels yet.') : 'Load audio to see levels'}</p>
          ) : (
            <>
              <dl className="readouts">
                <Readout label="Input peak" value={formatDb(m.inputPeakDb, { unit: 'dBFS' })} />
                <Readout label="Output peak" hint="after effects" value={formatDb(m.outputPeakDb, { unit: 'dBFS' })} />
                <Readout label="Loudness (after effects)" value={formatLufs(m.loudnessLufs)} />
                <Readout label="Final loudness" value={formatLufs(m.finalLoudnessLufs)} />
                <Readout label="Applied gain" value={formatDb(m.gainDb, { signed: true })} />
                <Readout label="Final peak" value={formatDb(m.finalPeakDb, { unit: 'dBFS' })} />
                <Readout label="True peak" value={formatDb(m.finalTruePeakDb, { unit: 'dBTP' })} />
                <Readout
                  label="Limiter"
                  value={normalization.limiterEnabled ? (m.limiterReductionDb > 0.05 ? `−${m.limiterReductionDb.toFixed(1)} dB` : 'idle') : 'off'}
                />
                <div className="readout readout--status">
                  <dt className="readout__label">Clipping</dt>
                  <dd className={`readout__value clip ${m.clipped ? 'clip--bad' : 'clip--ok'}`}>
                    {m.clipped ? '▲ CLIPPING' : '● OK'}
                  </dd>
                </div>
              </dl>
              {overs && <p className="output__warning">Inter-sample overs: true peak is above 0 dBTP.</p>}
              {m.warning && (
                <p className="output__warning" role="status">
                  {m.warning}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Readout({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <div className="readout">
      <dt className="readout__label">
        {label}
        {hint && <span className="readout__hint"> ({hint})</span>}
      </dt>
      <dd className="readout__value">{value}</dd>
    </div>
  );
}
