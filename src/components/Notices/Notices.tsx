import { useEffect } from 'react';
import { useApp } from '../../state/AppContext';
import type { Notice } from '../../types/audio';
import { CloseIcon } from '../common/icons';
import './Notices.css';

const AUTO_DISMISS_MS = 10_000;

function NoticeItem({ notice }: { notice: Notice }) {
  const { dispatch } = useApp();
  const onDismiss = () => dispatch({ type: 'notice/dismissed', id: notice.id });

  // Keyed on id/dispatch only, so unrelated re-renders don't restart the countdown.
  useEffect(() => {
    const timer = setTimeout(() => dispatch({ type: 'notice/dismissed', id: notice.id }), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [dispatch, notice.id]);

  return (
    <li className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span className="notice__message">{notice.message}</span>
      <button type="button" className="notice__close" aria-label="Dismiss message" onClick={onDismiss}>
        <CloseIcon />
      </button>
    </li>
  );
}

export function Notices() {
  const { state } = useApp();
  if (state.notices.length === 0) return null;
  return (
    <ul className="notices">
      {state.notices.map((notice) => (
        <NoticeItem key={notice.id} notice={notice} />
      ))}
    </ul>
  );
}
