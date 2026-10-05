import { useEffect, useId, useState } from 'react';
import type { BatchPackaging } from '../../audio/batchRunner';
import { MAX_VARIATIONS, type BatchMode } from '../../batch/plan';
import type { MutationIntensity } from '../../types/presets';
import { effectiveSuffix, parseCount, parseSeed, randomSeed } from './batchUtils';

export interface FormValues {
  mode: BatchMode;
  /** The suffix text as typed (not yet sanitised); the parent owns it so previews update live. */
  suffix: string;
  variationCount: number;
  intensity: MutationIntensity;
  seed: number;
  packaging: BatchPackaging;
}

interface BatchOptionsFormProps {
  values: FormValues;
  onSuffixText: (text: string) => void;
  onChange: (changes: Partial<FormValues>) => void;
  /** Persist the sanitised suffix to the shared export settings (single source of truth). */
  onCommitSuffix: (suffix: string) => void;
  disabled: boolean;
}

const STRENGTHS: ReadonlyArray<{ value: MutationIntensity; label: string }> = [
  { value: 'slight', label: 'Slight' },
  { value: 'medium', label: 'Medium' },
  { value: 'heavy', label: 'Heavy' },
];

export function BatchOptionsForm({ values, onSuffixText, onChange, onCommitSuffix, disabled }: BatchOptionsFormProps) {
  const id = useId();
  const [countDraft, setCountDraft] = useState(String(values.variationCount));
  const [seedDraft, setSeedDraft] = useState(String(values.seed));

  useEffect(() => setSeedDraft(String(values.seed)), [values.seed]);

  const commitSuffix = () => {
    const clean = effectiveSuffix(values.suffix);
    onSuffixText(clean);
    onCommitSuffix(clean);
  };

  const commitCount = () => {
    const count = parseCount(countDraft);
    setCountDraft(String(count));
    onChange({ variationCount: count });
  };

  const commitSeed = () => {
    const seed = parseSeed(seedDraft);
    setSeedDraft(String(seed));
    onChange({ seed });
  };

  const variations = values.mode === 'variations';

  return (
    <fieldset className="batch-options" disabled={disabled}>
      <legend className="sr-only">Batch output options</legend>

      <div className="batch-field">
        <span className="batch-field__label" id={`${id}-mode`}>
          Mode
        </span>
        <div className="batch-radios" role="radiogroup" aria-labelledby={`${id}-mode`}>
          <label className="check">
            <input type="radio" name={`${id}-mode`} checked={!variations} onChange={() => onChange({ mode: 'processed' })} />
            <span>Processed copies</span>
          </label>
          <label className="check">
            <input type="radio" name={`${id}-mode`} checked={variations} onChange={() => onChange({ mode: 'variations' })} />
            <span>Variations</span>
          </label>
        </div>
      </div>

      {!variations ? (
        <div className="batch-field">
          <label className="batch-field__label" htmlFor={`${id}-suffix`}>
            Filename suffix
          </label>
          <input
            id={`${id}-suffix`}
            className="batch-input"
            type="text"
            value={values.suffix}
            maxLength={60}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => onSuffixText(event.target.value)}
            onBlur={commitSuffix}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitSuffix();
            }}
          />
          <p className="batch-hint">robot_hello.wav becomes robot_hello{effectiveSuffix(values.suffix)}.wav</p>
        </div>
      ) : (
        <>
          <div className="batch-field batch-field--narrow">
            <label className="batch-field__label" htmlFor={`${id}-count`}>
              Variations per file
            </label>
            <input
              id={`${id}-count`}
              className="batch-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_VARIATIONS}
              step={1}
              value={countDraft}
              onChange={(event) => {
                setCountDraft(event.target.value);
                if (event.target.value !== '') onChange({ variationCount: parseCount(event.target.value) });
              }}
              onBlur={commitCount}
            />
          </div>
          <div className="batch-field batch-field--narrow">
            <label className="batch-field__label" htmlFor={`${id}-strength`}>
              Strength
            </label>
            <select
              id={`${id}-strength`}
              className="batch-input"
              value={values.intensity}
              onChange={(event) => onChange({ intensity: event.target.value as MutationIntensity })}
            >
              {STRENGTHS.map((strength) => (
                <option key={strength.value} value={strength.value}>
                  {strength.label}
                </option>
              ))}
            </select>
          </div>
          <div className="batch-field">
            <label className="batch-field__label" htmlFor={`${id}-seed`}>
              Seed
            </label>
            <div className="batch-seed">
              <input
                id={`${id}-seed`}
                className="batch-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={4294967295}
                step={1}
                value={seedDraft}
                onChange={(event) => {
                  setSeedDraft(event.target.value);
                  if (event.target.value !== '') onChange({ seed: parseSeed(event.target.value) });
                }}
                onBlur={commitSeed}
              />
              <button type="button" className="btn" onClick={() => onChange({ seed: randomSeed() })}>
                Randomize
              </button>
            </div>
          </div>
          <p className="batch-hint batch-hint--wide">
            Each variation applies a different controlled mutation to the chain: robot_attack_01.wav, robot_attack_02.wav… The same seed always
            gives the same results.
          </p>
        </>
      )}

      <div className="batch-field batch-field--narrow">
        <label className="batch-field__label" htmlFor={`${id}-pack`}>
          Packaging
        </label>
        <select
          id={`${id}-pack`}
          className="batch-input"
          value={values.packaging}
          onChange={(event) => onChange({ packaging: event.target.value as BatchPackaging })}
        >
          <option value="zip">One ZIP file</option>
          <option value="separate">Separate files</option>
        </select>
      </div>
    </fieldset>
  );
}
