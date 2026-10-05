import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { builtInPresets } from '../../presets/builtInPresets';
import { mutateChain } from '../../presets/mutate';
import { createVariants } from '../../presets/presetLibrary';
import { useApp } from '../../state/AppContext';
import type { MutationIntensity } from '../../types/presets';
import './MutateMenu.css';

const INTENSITIES: { value: MutationIntensity; label: string; hint: string }[] = [
  { value: 'slight', label: 'Slight', hint: '±8% tweaks' },
  { value: 'medium', label: 'Medium', hint: 'noticeable variation' },
  { value: 'heavy', label: 'Heavy', hint: 'dramatic change within safe ranges' },
];

const MIN_COUNT = 1;
const MAX_COUNT = 10;
const CONFIRMATION_MS = 5000;

const randomSeed = (): number => (Math.random() * 2 ** 32) >>> 0;

export function MutateMenu() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState('3');
  const [intensity, setIntensity] = useState<MutationIntensity>('medium');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, containerRef, close);

  useEffect(() => {
    if (confirmation === null) return;
    const timer = window.setTimeout(() => setConfirmation(null), CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  const chainEmpty = state.chain.length === 0;
  // Nothing to mutate: make sure the panel is not left open when the chain empties (e.g. via undo).
  useEffect(() => {
    if (chainEmpty) setOpen(false);
  }, [chainEmpty]);

  const allPresets = useMemo(() => [...builtInPresets, ...state.userPresets], [state.userPresets]);
  const selected = allPresets.find((preset) => preset.id === state.selectedPresetId) ?? null;

  const mutate = (level: MutationIntensity) => {
    // Seed here, not in a reducer: reducers must stay pure.
    dispatch({ type: 'chain/replace', effects: mutateChain(state.chain, level, randomSeed()) });
  };

  const parsedCount = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(Number(count)) || MIN_COUNT));

  const createVariations = () => {
    const variants = createVariants({ name: selected?.name ?? 'Custom', chain: state.chain }, parsedCount, intensity, allPresets, randomSeed());
    if (variants.length === 0) return;
    dispatch({ type: 'presets/added', presets: variants });
    const first = variants[0]!.name;
    const last = variants[variants.length - 1]!.name;
    setCount(String(parsedCount));
    setConfirmation(variants.length === 1 ? `Saved ${first} to My presets` : `Saved ${first} – ${last} to My presets`);
  };

  return (
    <div className="mutate-menu" ref={containerRef}>
      <button
        type="button"
        className="btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={chainEmpty}
        title={chainEmpty ? 'Add an effect to mutate' : 'Randomly vary the current chain'}
        onClick={() => setOpen((value) => !value)}
      >
        Mutate
      </button>
      {open && !chainEmpty && (
        <div className="mutate-menu__panel" role="dialog" aria-label="Mutate chain">
          <h2 className="mutate-menu__heading">Mutate chain</h2>
          <ul className="mutate-menu__list">
            {INTENSITIES.map((item) => (
              <li key={item.value}>
                <button type="button" className="mutate-menu__item" onClick={() => mutate(item.value)}>
                  <span className="mutate-menu__name">{item.label}</span>
                  <span className="mutate-menu__hint">{item.hint}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mutate-menu__note">Applies in place. Each click is one undo step.</p>

          <h2 className="mutate-menu__heading mutate-menu__heading--section">Save variations</h2>
          <div className="mutate-menu__variants">
            <label className="mutate-menu__field">
              <span>Count</span>
              <input
                className="mutate-menu__input"
                type="number"
                inputMode="numeric"
                min={MIN_COUNT}
                max={MAX_COUNT}
                step={1}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                onBlur={() => setCount(String(parsedCount))}
              />
            </label>
            <label className="mutate-menu__field">
              <span>Intensity</span>
              <select className="select" value={intensity} onChange={(event) => setIntensity(event.target.value as MutationIntensity)}>
                {INTENSITIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn--primary" onClick={createVariations}>
              Create
            </button>
          </div>
          <p className="mutate-menu__status" role="status">
            {confirmation ?? ''}
          </p>
        </div>
      )}
    </div>
  );
}

