import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover (`ref` is its container, trigger included) while `active`:
 *  - Escape closes it and, when focus was inside, puts focus back on the trigger (the container's `[aria-haspopup]` button);
 *  - a pointer press outside, or focus moving to something outside (Tab past the end), closes it without stealing focus.
 */
export function useDismiss(active: boolean, ref: RefObject<HTMLElement | null>, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && ref.current && !ref.current.contains(target)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const container = ref.current;
      const focusWasInside = container !== null && (container.contains(document.activeElement) || document.activeElement === document.body);
      onDismiss();
      if (focusWasInside) container?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, ref, onDismiss]);
}
