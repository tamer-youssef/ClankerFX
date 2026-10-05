import { useEffect, useState } from 'react';
import { useApp } from '../../state/AppContext';
import type { Notice } from '../../types/audio';
import { CloseIcon } from '../common/icons';
import './Notices.css';

const AUTO_DISMISS_MS = 10_000;

function NoticeItem({ notice }: { notice: Notice }) {
  const { dispatch } = useApp();
  // Hovering or focusing a message pauses its countdown, so it can be read (or reached by keyboard) without racing a timer.
  const [paused, setPaused] = useState(false);
  const onDismiss = () => dispatch({ type: 'notice/dismissed', id: notice.id });

  // Keyed on id/dispatch/paused only, so unrelated re-renders don't restart the countdown.
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dispatch({ type: 'notice/dismissed', id: notice.id }), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dispatch, notice.id, paused]);

  return (
    <div
      className={`notice notice--${notice.kind}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="notice__message">{notice.message}</span>
      <button type="button" className="notice__close" aria-label="Dismiss message" onClick={onDismiss}>
        <CloseIcon />
      </button>
    </div>
  );
}

/**
 * Toasts. The two live regions are always mounted (and empty until needed): screen readers reliably announce text that
 * is added to an existing live region, but often miss a region that appears already filled. Errors are assertive
 * (role=alert); warnings and info are polite (role=status).
 */
export function Notices() {
  const { state } = useApp();
  const errors = state.notices.filter((notice) => notice.kind === 'error');
  const others = state.notices.filter((notice) => notice.kind !== 'error');
  return (
    <div className="notices">
      <div className="notices__group" role="status">
        {others.map((notice) => (
          <NoticeItem key={notice.id} notice={notice} />
        ))}
      </div>
      <div className="notices__group" role="alert">
        {errors.map((notice) => (
          <NoticeItem key={notice.id} notice={notice} />
        ))}
      </div>
    </div>
  );
}
