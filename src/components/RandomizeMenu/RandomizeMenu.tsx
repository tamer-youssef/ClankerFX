import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { getEffectDefinition } from '../../effects/registry';
import { randomChain, rerollChain, type Wildness } from '../../presets/randomize';
import { useApp } from '../../state/AppContext';
import type { EffectState } from '../../types/effects';
import './RandomizeMenu.css';

const STRENGTHS: { value: Wildness; label: string }[] = [
  { value: 'mild', label: 'Mild' },
  { value: 'wild', label: 'Wild' },
];

const randomSeed = (): number => (Math.random() * 2 ** 32) >>> 0;

const describe = (chain: readonly EffectState[]): string =>
  chain.map((effect) => getEffectDefinition(effect.type)?.label ?? effect.type).join(' · ');

function DiceIcon() {
  return (
    <svg className="randomize-menu__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <g fill="currentColor" stroke="none">
        <circle cx="5.5" cy="5.5" r="1" />
        <circle cx="10.5" cy="5.5" r="1" />
        <circle cx="8" cy="8" r="1" />
        <circle cx="5.5" cy="10.5" r="1" />
        <circle cx="10.5" cy="10.5" r="1" />
      </g>
    </svg>
  );
}

export function RandomizeMenu() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [wildness, setWildness] = useState<Wildness>('mild');
  const [status, setStatus] = useState('');
  const rolls = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, containerRef, close);

  const chainEmpty = state.chain.length === 0;

  const newChain = () => {
    // Seed here, not in a reducer: reducers must stay pure. presetId: null so the Presets button stops claiming a preset.
    const effects = randomChain(randomSeed(), wildness);
    dispatch({ type: 'chain/replace', effects, presetId: null });
    rolls.current += 1;
    setStatus(`Rolled #${rolls.current}: ${describe(effects)}`);
  };

  const reroll = () => {
    if (chainEmpty) return;
    // No presetId: the selection stays, because the effects are the same ones.
    const effects = rerollChain(state.chain, randomSeed(), wildness);
    dispatch({ type: 'chain/replace', effects });
    rolls.current += 1;
    setStatus(`Re-rolled #${rolls.current}: ${describe(effects)}`);
  };

  const onStrengthKey = (event: KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % STRENGTHS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + STRENGTHS.length) % STRENGTHS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = STRENGTHS.length - 1;
    else return;
    event.preventDefault();
    setWildness(STRENGTHS[next]!.value);
    radioRefs.current[next]?.focus();
  };

  return (
    <div className="randomize-menu" ref={containerRef}>
      <button
        type="button"
        className="btn randomize-menu__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Build a random robot chain, or re-roll the current settings"
        onClick={() => setOpen((value) => !value)}
      >
        <DiceIcon />
        Randomize
      </button>
      {open && (
        <div className="randomize-menu__panel" role="dialog" aria-label="Randomize">
          <h2 className="randomize-menu__heading">Randomize</h2>

          <div className="randomize-menu__field">
            <span id="randomize-strength-label" className="randomize-menu__label">
              Strength
            </span>
            <div className="randomize-menu__segmented" role="radiogroup" aria-labelledby="randomize-strength-label">
              {STRENGTHS.map((strength, index) => {
                const checked = wildness === strength.value;
                return (
                  <button
                    key={strength.value}
                    ref={(node) => {
                      radioRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    className="randomize-menu__option"
                    onClick={() => setWildness(strength.value)}
                    onKeyDown={(event) => onStrengthKey(event, index)}
                  >
                    {strength.label}
                  </button>
                );
              })}
            </div>
          </div>

          <ul className="randomize-menu__list">
            <li>
              <button type="button" className="randomize-menu__item" onClick={newChain}>
                <span className="randomize-menu__name">New random chain</span>
                <span className="randomize-menu__hint">Builds 3–6 effects from scratch</span>
              </button>
            </li>
            <li>
              <button type="button" className="randomize-menu__item" disabled={chainEmpty} onClick={reroll}>
                <span className="randomize-menu__name">Re-roll settings</span>
                <span className="randomize-menu__hint">{chainEmpty ? 'Add an effect first' : 'Keeps your effects, re-rolls their settings'}</span>
              </button>
            </li>
          </ul>
          <p className="randomize-menu__note">Stays inside safe ranges. Each click is one undo step.</p>
          <p className="randomize-menu__status" role="status">
            {status}
          </p>
        </div>
      )}
    </div>
  );
}
