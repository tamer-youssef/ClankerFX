import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, audio[controls], [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog plumbing: Escape closes, Tab stays inside, page scroll is locked while it is open. Capture phase so
 * nothing behind the dialog sees these keys.
 */
export function useDialogBehavior(dialogRef: RefObject<HTMLElement | null>, onEscape: () => void): void {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The dialog is portaled outside #root, so making the app inert hides it from assistive tech and Tab while it is open.
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => {
      document.body.style.overflow = previousOverflow;
      root?.removeAttribute('inert');
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!dialog.contains(active) || active === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [dialogRef, onEscape]);
}
