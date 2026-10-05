import { useEffect, type RefObject } from 'react';

/** Calls `onDismiss` on Escape or a pointer press outside `ref`, while `active`. Used by popover menus. */
export function useDismiss(active: boolean, ref: RefObject<HTMLElement | null>, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, ref, onDismiss]);
}
