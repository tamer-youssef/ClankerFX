import { useEffect, useRef, useState } from 'react';
import { createEffectState, listEffectDefinitions } from '../../effects/registry';
import { useApp } from '../../state/AppContext';
import './AddEffectMenu.css';

export function AddEffectMenu() {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="add-effect" ref={containerRef}>
      <button type="button" className="btn btn--primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        + Add Effect
      </button>
      {open && (
        <ul className="add-effect__menu" role="menu">
          {listEffectDefinitions().map((definition) => (
            <li key={definition.type} role="none">
              <button
                type="button"
                role="menuitem"
                className="add-effect__item"
                onClick={() => {
                  const effect = createEffectState(definition.type);
                  if (effect) dispatch({ type: 'chain/add', effect });
                  setOpen(false);
                }}
              >
                <span className="add-effect__name">{definition.label}</span>
                <span className="add-effect__desc">{definition.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
