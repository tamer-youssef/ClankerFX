import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { createEffectState, listEffectDefinitions } from '../../effects/registry';
import { useApp } from '../../state/AppContext';
import './AddEffectMenu.css';

export function AddEffectMenu() {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  /** Roving tabindex: only this item is a Tab stop, so Tab leaves the menu and Shift+Tab comes back to the trigger. */
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDismiss(open, containerRef, () => setOpen(false));

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // Opening the menu moves focus to its first item, so the arrow keys work straight away.
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      items()[0]?.focus();
    }
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (current + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    else return;
    event.preventDefault();
    list[next]?.focus();
  };

  return (
    <div className="add-effect" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          // Arrow Down opens the menu from the keyboard (Enter / Space already do, via click).
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        + Add Effect
      </button>
      {open && (
        <ul ref={menuRef} className="add-effect__menu" role="menu" aria-label="Add effect" onKeyDown={onMenuKeyDown}>
          {listEffectDefinitions().map((definition, index) => (
            <li key={definition.type} role="none">
              <button
                type="button"
                role="menuitem"
                // Roving focus: arrows move between items, Tab leaves the menu.
                tabIndex={index === activeIndex ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                className="add-effect__item"
                onClick={() => {
                  const effect = createEffectState(definition.type);
                  if (effect) dispatch({ type: 'chain/add', effect });
                  setOpen(false);
                  triggerRef.current?.focus();
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
