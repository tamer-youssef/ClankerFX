import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { builtInPresets } from '../../presets/builtInPresets';
import { chainMatchesPreset, createPreset, duplicatePreset, presetToChain, uniqueName } from '../../presets/presetLibrary';
import { useApp } from '../../state/AppContext';
import type { Preset } from '../../types/presets';
import './PresetBrowser.css';

const CONFIRM_MS = 3000;

export function PresetBrowser() {
  const { state, dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelRenameRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The preset whose Rename button should get focus back once the rename input unmounts. */
  const refocusRenameRef = useRef<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setRenamingId(null);
    setConfirmId(null);
  }, []);
  useDismiss(open, containerRef, close);

  // The rename input disappears on commit/cancel; hand focus back to that row's Rename button instead of dropping it on <body>.
  useEffect(() => {
    if (renamingId !== null || refocusRenameRef.current === null) return;
    const id = refocusRenameRef.current;
    refocusRenameRef.current = null;
    const rows = panelRef.current?.querySelectorAll<HTMLElement>('[data-rename-button]') ?? [];
    for (const button of rows) if (button.dataset.renameButton === id) button.focus();
  }, [renamingId]);

  // Delete confirmation expires on its own.
  useEffect(() => {
    if (confirmId === null) return;
    const timer = window.setTimeout(() => setConfirmId(null), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [confirmId]);

  const allPresets = useMemo(() => [...builtInPresets, ...state.userPresets], [state.userPresets]);
  const selected = allPresets.find((preset) => preset.id === state.selectedPresetId) ?? null;
  const modified = selected !== null && !chainMatchesPreset(state.chain, selected);
  const chainEmpty = state.chain.length === 0;

  const apply = (preset: Preset) => {
    dispatch({ type: 'chain/replace', effects: presetToChain(preset), presetId: preset.id });
    close();
  };

  const duplicate = (source: Preset) => {
    const copy = duplicatePreset(source, allPresets);
    dispatch({ type: 'presets/added', presets: [copy], select: copy.id });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (chainEmpty) return;
    const preset = createPreset(saveName.trim() || 'My preset', state.chain, allPresets);
    dispatch({ type: 'presets/added', presets: [preset], select: preset.id });
    setSaveName('');
  };

  const startRename = (preset: Preset) => {
    setConfirmId(null);
    cancelRenameRef.current = false;
    setRenamingId(preset.id);
    setRenameValue(preset.name);
  };

  const commitRename = (preset: Preset) => {
    const trimmed = renameValue.trim();
    // Only when the input still has focus (Enter/Escape); a blur caused by clicking elsewhere keeps focus where it went.
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('preset-row__rename')) {
      refocusRenameRef.current = preset.id;
    }
    setRenamingId(null);
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false;
      return;
    }
    if (trimmed === '' || trimmed === preset.name) return;
    const others = allPresets.filter((other) => other.id !== preset.id).map((other) => other.name);
    dispatch({ type: 'presets/renamed', id: preset.id, name: uniqueName(trimmed, others) });
  };

  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>, preset: Preset) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename(preset);
      cancelRenameRef.current = true; // the unmount-triggered blur must not commit a second time
    } else if (event.key === 'Escape') {
      // Cancel the edit only; do not also close the popover.
      event.preventDefault();
      event.nativeEvent.stopImmediatePropagation();
      cancelRenameRef.current = true;
      refocusRenameRef.current = preset.id;
      setRenamingId(null);
    }
  };

  const remove = (preset: Preset) => {
    if (confirmId !== preset.id) {
      setConfirmId(preset.id);
      return;
    }
    setConfirmId(null);
    dispatch({ type: 'presets/deleted', id: preset.id });
    // The focused Delete button is about to unmount; keep focus inside the popover.
    panelRef.current?.focus();
  };

  const renderRow = (preset: Preset) => {
    const isSelected = preset.id === state.selectedPresetId;
    const editing = renamingId === preset.id;
    const builtIn = preset.builtIn === true;
    return (
      <li key={preset.id} className={`preset-row${isSelected ? ' preset-row--selected' : ''}`}>
        {editing ? (
          <input
            className="preset-browser__input preset-row__rename"
            type="text"
            value={renameValue}
            maxLength={80}
            autoFocus
            aria-label={`Rename ${preset.name}`}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => onRenameKey(event, preset)}
            onBlur={() => commitRename(preset)}
          />
        ) : (
          <button type="button" className="preset-row__main" aria-current={isSelected ? 'true' : undefined} onClick={() => apply(preset)}>
            <span className="preset-row__name">
              {preset.name}
              {isSelected && <span className="preset-row__mark">{modified ? 'selected (modified)' : 'selected'}</span>}
            </span>
            {preset.description && <span className="preset-row__desc">{preset.description}</span>}
          </button>
        )}
        {!editing && (
          <span className="preset-row__actions">
            {!builtIn && (
              <button type="button" className="preset-row__action" aria-label={`Rename ${preset.name}`} data-rename-button={preset.id} onClick={() => startRename(preset)}>
                Rename
              </button>
            )}
            <button type="button" className="preset-row__action" aria-label={`Duplicate ${preset.name}`} onClick={() => duplicate(preset)}>
              Duplicate
            </button>
            {!builtIn && (
              <button
                type="button"
                className={`preset-row__action preset-row__action--danger${confirmId === preset.id ? ' is-confirming' : ''}`}
                aria-label={confirmId === preset.id ? `Confirm delete ${preset.name}` : `Delete ${preset.name}`}
                onClick={() => remove(preset)}
              >
                {confirmId === preset.id ? 'Confirm?' : 'Delete'}
              </button>
            )}
          </span>
        )}
      </li>
    );
  };

  const label = selected ? selected.name : 'Presets';

  return (
    <div className="preset-browser" ref={containerRef}>
      <button
        type="button"
        className="btn preset-browser__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={selected ? selected.name : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="preset-browser__label">{selected ? label : 'Presets'}</span>
        {modified && (
          <span className="preset-browser__modified" title="Chain differs from the preset">
            {' •'}
            <span className="sr-only"> (modified)</span>
          </span>
        )}
      </button>
      {open && (
        <div ref={panelRef} className="preset-browser__panel" role="dialog" aria-label="Presets" tabIndex={-1}>
          <form className="preset-browser__save" onSubmit={save}>
            <input
              className="preset-browser__input"
              type="text"
              value={saveName}
              maxLength={80}
              placeholder="Preset name"
              aria-label="New preset name"
              onChange={(event) => setSaveName(event.target.value)}
            />
            <button type="submit" className="btn btn--primary" disabled={chainEmpty} title={chainEmpty ? 'Add an effect first' : 'Save current chain as preset'}>
              Save current chain
            </button>
          </form>

          <h2 className="preset-browser__heading">My presets</h2>
          {state.userPresets.length === 0 ? (
            <p className="preset-browser__empty">No saved presets yet. Build a chain, then save it above.</p>
          ) : (
            <ul className="preset-browser__list">{state.userPresets.map(renderRow)}</ul>
          )}

          <h2 className="preset-browser__heading">Built-in</h2>
          <ul className="preset-browser__list">{builtInPresets.map(renderRow)}</ul>
        </div>
      )}
    </div>
  );
}
