import type { MouseEvent } from 'react';

/**
 * Click handler for a modal <dialog> that calls `onClose` when the click lands on
 * the backdrop. A backdrop click targets the dialog itself but falls outside its box.
 */
export function closeOnBackdropClick(onClose: () => void) {
  return (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) onClose();
  };
}
