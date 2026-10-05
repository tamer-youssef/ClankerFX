import { useApp } from '../../state/AppContext';
import { formatTime } from '../../utils/format';
import { CloseIcon } from '../common/icons';
import './FileTray.css';

export function FileTray() {
  const { state, dispatch } = useApp();
  if (state.files.length === 0) return null;

  return (
    <ul className="file-tray" aria-label="Loaded audio files">
      {state.files.map((file) => {
        const active = file.id === state.activeFileId;
        return (
          <li key={file.id} className={`file-chip${active ? ' file-chip--active' : ''}`}>
            <button
              type="button"
              className="file-chip__select"
              aria-pressed={active}
              onClick={() => dispatch({ type: 'files/activated', id: file.id })}
              title={file.name}
            >
              <span className="file-chip__name">{file.name}</span>
              <span className="file-chip__meta">{formatTime(file.buffer.duration)}</span>
            </button>
            <button
              type="button"
              className="file-chip__remove"
              aria-label={`Remove ${file.name}`}
              onClick={(event) => {
                // The button unmounts with its chip: move focus to a neighbouring chip, or to the workspace when none is left.
                const chip = event.currentTarget.closest('li');
                const neighbour = chip?.nextElementSibling ?? chip?.previousElementSibling ?? null;
                dispatch({ type: 'files/removed', id: file.id });
                requestAnimationFrame(() => {
                  const target = neighbour?.isConnected
                    ? neighbour.querySelector<HTMLElement>('.file-chip__select')
                    : document.querySelector<HTMLElement>('.empty-state .btn, #main');
                  target?.focus();
                });
              }}
            >
              <CloseIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
